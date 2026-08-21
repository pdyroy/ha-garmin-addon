#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Pacer HA Notification Service.

Pushes sensor states and risk alerts to Home Assistant REST API.
Reads from PostgreSQL: daily_metric + advanced_metric tables.
"""

import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta
from typing import Any, Mapping, Optional, Sequence, Tuple, Union
from zoneinfo import ZoneInfo

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 not installed", file=sys.stderr)
    sys.exit(1)

try:
    import urllib.request
    import urllib.error
except ImportError as exc:
    logging.getLogger(__name__).debug("urllib import failed: %s", exc)

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres@127.0.0.1:5432/pacer"
)
USER_ID = os.environ.get("GARMIN_USER_ID", "seed-user-001")
HA_BASE_URL = os.environ.get("HA_BASE_URL", "http://supervisor/core")
SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
NOTIFY_INTERVAL_MINUTES = int(os.environ.get("NOTIFY_INTERVAL_MINUTES", "30"))

# Timezone for date boundary calculations
_tz_name = os.environ.get("USER_TIMEZONE", "UTC")
try:
    USER_TZ = ZoneInfo(_tz_name)
except (KeyError, ValueError):
    print(
        f"[ha-notify] WARNING: Invalid timezone '{_tz_name}', using UTC",
        file=sys.stderr,
    )
    USER_TZ = ZoneInfo("UTC")


def ha_request(method: str, path: str, data: dict | None = None) -> dict | None:
    """Make a request to the HA REST API."""
    if not SUPERVISOR_TOKEN:
        print(
            "[ha-notify] No SUPERVISOR_TOKEN — skipping HA API calls", file=sys.stderr
        )
        return None

    url = f"{HA_BASE_URL}/api/{path}"
    headers = {
        "Authorization": f"Bearer {SUPERVISOR_TOKEN}",
        "Content-Type": "application/json",
    }
    body = json.dumps(data).encode() if data else None

    try:
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"[ha-notify] HA API error {e.code}: {e.reason}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[ha-notify] HA API request failed: {e}", file=sys.stderr)
        return None


def push_sensor(entity_id: str, state: str | float | int, attributes: dict) -> bool:
    """Push a sensor state to HA."""
    # Include timezone and last_computed in all sensor attributes
    attributes["timezone"] = str(USER_TZ)
    attributes["last_computed"] = datetime.now(USER_TZ).isoformat()
    result = ha_request(
        "POST",
        f"states/{entity_id}",
        {
            "state": str(state),
            "attributes": attributes,
        },
    )
    return result is not None


def create_notification(title: str, message: str, notification_id: str) -> bool:
    """Create a persistent notification in HA."""
    return (
        ha_request(
            "POST",
            "services/persistent_notification/create",
            {
                "title": title,
                "message": message,
                "notification_id": notification_id,
            },
        )
        is not None
    )


def _compute_hrv_trend(
    rows: Sequence[Mapping[str, Any]],
) -> Tuple[Optional[str], Optional[float]]:
    """Return (trend_label, avg) from a list of {'hrv': float} rows ordered ASC.

    NOTE: ``daily_metric.hrv`` is populated from Garmin's ``hrvSummary.weeklyAvg``
    (see garmin-sync.py), so this trend tracks day-over-day movement of the
    weekly-average value, not raw nightly HRV. Needs at least 3 datapoints
    to emit a label. Returns ``(None, None)`` when there is insufficient data;
    otherwise ``trend_label`` is one of ``"rising"`` / ``"falling"`` / ``"stable"``.
    """
    if not rows or len(rows) < 3:
        return None, None
    vals = [float(r["hrv"]) for r in rows]
    avg = round(sum(vals) / len(vals), 1)
    latest = vals[-1]
    if latest > avg * 1.05:
        return "rising", avg
    if latest < avg * 0.95:
        return "falling", avg
    return "stable", avg


def _derive_load_focus_label(
    payload: Union[str, Mapping[str, Any], None],
) -> str:
    """Reduce Garmin ``garmin_load_focus`` JSON to a single label.

    The synced JSON can contain either percentage keys
    (``*TrainingLoadPercentage``) or absolute load keys
    (``*TrainingLoad``). Prefer percentages when present.

    Accepts a pre-resolved label string, a dict payload, or ``None``.
    Returns one of ``"anaerobic"`` / ``"high_aerobic"`` / ``"low_aerobic"`` /
    ``"unknown"``.
    """
    if not payload:
        return "unknown"
    if isinstance(payload, str):
        return payload.lower()
    if not isinstance(payload, dict):
        return "unknown"

    pct_keys = (
        "highAerobicTrainingLoadPercentage",
        "lowAerobicTrainingLoadPercentage",
        "anaerobicTrainingLoadPercentage",
    )
    abs_keys = (
        "highAerobicTrainingLoad",
        "lowAerobicTrainingLoad",
        "anaerobicTrainingLoad",
    )
    keys = pct_keys if any(payload.get(k) is not None for k in pct_keys) else abs_keys
    aerobic_high = payload.get(keys[0], 0) or 0
    aerobic_low = payload.get(keys[1], 0) or 0
    anaerobic = payload.get(keys[2], 0) or 0
    if max(aerobic_high, aerobic_low, anaerobic) <= 0:
        return "unknown"
    if anaerobic > aerobic_high and anaerobic > aerobic_low:
        return "anaerobic"
    if aerobic_high > aerobic_low:
        return "high_aerobic"
    return "low_aerobic"


# Fitness age — OLS fit of the Loe et al. (PLoS One 2013;8(5):e64319) HUNT3
# decade means for directly measured VO2max. Mirrors
# app/packages/engine/src/fitness-age/index.ts; the engine unit test is the
# canonical arbiter, so change both together.
FITNESS_AGE_REFERENCE = {
    "male": (63.18, 0.3709),
    "female": (50.75, 0.2977),
    "pooled": (56.96, 0.3343),
}

# VO2max source priority, mirroring app/packages/api/src/lib/vo2max.ts so the
# sensor and the web UI never disagree on which estimate is "current".
VO2_SOURCE_PRIORITY_SQL = """
    SELECT value, source FROM vo2max_estimate
    WHERE user_id = %s AND date >= CURRENT_DATE - INTERVAL '90 days'
    ORDER BY CASE source
                 WHEN 'garmin_official' THEN 0
                 WHEN 'running_pace_hr' THEN 1
                 WHEN 'cooper' THEN 2
                 WHEN 'uth_method' THEN 4
                 WHEN 'uth_ratio' THEN 4
                 ELSE 3
             END ASC,
             date DESC
    LIMIT 1
"""


def compute_fitness_age(
    vo2max: float | None, age: int | None, sex: str | None
) -> tuple[int, int, float, str] | None:
    """Return (fitness_age, delta_years, population_mean, method), or None.

    None when VO2max or age is missing — there is no defensible guess for
    either one.
    """
    if not vo2max or vo2max <= 0 or not age or age <= 0:
        return None
    method = sex if sex in ("male", "female") else "pooled"
    intercept, slope = FITNESS_AGE_REFERENCE[method]
    # The reference cohort spans 20-90; extrapolating past it is meaningless.
    fitness_age = min(90, max(20, round((intercept - vo2max) / slope)))
    return (
        fitness_age,
        round(fitness_age - age),
        round(intercept - slope * age, 1),
        method,
    )


def fetch_fitness_age(cur, user_id: str) -> tuple[int, int, float, str] | None:
    """Load the current VO2max plus profile age/sex and derive fitness age."""
    cur.execute(VO2_SOURCE_PRIORITY_SQL, (user_id,))
    vo2_row = cur.fetchone()
    cur.execute(
        "SELECT age, sex FROM profile WHERE user_id = %s LIMIT 1", (user_id,)
    )
    profile = cur.fetchone()
    if not vo2_row or not profile:
        return None
    return compute_fitness_age(vo2_row["value"], profile["age"], profile["sex"])


# Target bedtime and wake window. Mirrors computeSleepWindow() in
# app/packages/engine/src/sleep-coach/index.ts — the engine unit test is the
# canonical arbiter, so change both together.
#
# ponytail: this mirror anchors on the habitual wake time only. The web UI
# additionally anchors on MSFsc (chronotype) when it is computable, which for
# a strongly late chronotype can sit up to an hour away from the habitual
# wake time. Both surfaces publish which anchor they used. Upgrade path:
# compute the window once in metrics-compute.py and read it here.
SLEEP_ONSET_LATENCY_MINUTES = 15
MAX_NIGHTLY_DEBT_PAYBACK_MINUTES = 30
WAKE_WINDOW_HALF_MINUTES = 20
MIN_NIGHTS_FOR_HABIT = 4


def _parse_hhmm(value: str | None) -> int | None:
    """'HH:MM' -> minutes since local midnight, or None."""
    if not value or ":" not in value:
        return None
    try:
        h, m = (int(part) for part in value.split(":")[:2])
    except ValueError:
        return None
    if not (0 <= h <= 23 and 0 <= m <= 59):
        return None
    return h * 60 + m


def _format_hhmm(minutes: float) -> str:
    wrapped = int(round(minutes)) % 1440
    return f"{wrapped // 60:02d}:{wrapped % 60:02d}"


def _circular_median(values: Sequence[int]) -> float:
    """Median of clock times, anchored at 18:00 so a cluster spanning
    midnight (23:50, 00:10) averages to midnight rather than to noon."""
    anchor = 18 * 60
    shifted = sorted((v - anchor) % 1440 for v in values)
    mid = len(shifted) // 2
    median = (
        shifted[mid]
        if len(shifted) % 2 == 1
        else (shifted[mid - 1] + shifted[mid]) / 2
    )
    return (median + anchor) % 1440


def _next_local_occurrence(hhmm: str) -> str:
    """Next local datetime at HH:MM, ISO 8601 with offset, for HA's
    timestamp device class."""
    now = datetime.now(USER_TZ)
    h, m = (int(part) for part in hhmm.split(":"))
    candidate = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if candidate <= now:
        candidate += timedelta(days=1)
    return candidate.isoformat()


def fetch_sleep_window(cur, user_id: str) -> dict | None:
    """Target bedtime and wake window from the habitual wake time."""
    cur.execute(
        """
        SELECT sleep_end_time, sleep_need_minutes, sleep_debt_minutes
        FROM daily_metric
        WHERE user_id = %s
        ORDER BY date DESC LIMIT 14
        """,
        (user_id,),
    )
    rows = cur.fetchall()
    if not rows:
        return None

    wake_times = [
        parsed
        for parsed in (_parse_hhmm(r["sleep_end_time"]) for r in rows)
        if parsed is not None
    ]
    if len(wake_times) < MIN_NIGHTS_FOR_HABIT:
        return None

    need = next(
        (r["sleep_need_minutes"] for r in rows if r["sleep_need_minutes"]), None
    )
    if not need or need <= 0:
        return None
    debt = next(
        (r["sleep_debt_minutes"] for r in rows if r["sleep_debt_minutes"]), 0
    ) or 0

    payback = min(max(debt, 0), MAX_NIGHTLY_DEBT_PAYBACK_MINUTES)
    target_wake = _circular_median(wake_times)
    bedtime = target_wake - need - payback - SLEEP_ONSET_LATENCY_MINUTES

    return {
        "bedtime": _format_hhmm(bedtime),
        "wake": _format_hhmm(target_wake),
        "wake_start": _format_hhmm(target_wake - WAKE_WINDOW_HALF_MINUTES),
        "wake_end": _format_hhmm(target_wake + WAKE_WINDOW_HALF_MINUTES),
        "need_minutes": int(need),
        "debt_payback_minutes": int(payback),
        "nights_used": len(wake_times),
    }


def get_latest_metrics(cur, user_id: str) -> dict:
    """Get latest metrics from daily_athlete_summary materialized view.

    Falls back to separate table queries if the matview doesn't exist yet.
    """

    # Inclusive 7-day window: CURRENT_DATE - 6 days .. CURRENT_DATE = 7 rows.
    hrv_history_sql = """
        SELECT date, hrv FROM daily_metric
        WHERE user_id = %s AND date >= CURRENT_DATE - INTERVAL '6 days'
          AND hrv IS NOT NULL
        ORDER BY date ASC
    """

    try:
        cur.execute(
            """
            SELECT * FROM daily_athlete_summary
            WHERE user_id = %s
            ORDER BY date DESC LIMIT 1
        """,
            (user_id,),
        )
        row = cur.fetchone()
        if row:
            cur.execute(
                """
                SELECT COUNT(*) as count FROM daily_metric
                WHERE user_id = %s AND date >= CURRENT_DATE - INTERVAL '3 days'
                  AND garmin_training_load > 50
            """,
                (user_id,),
            )
            hard_days_row = cur.fetchone()
            hard_days = hard_days_row["count"] if hard_days_row else 0

            cur.execute(hrv_history_sql, (user_id,))
            hrv_rows = cur.fetchall()
            hrv_trend, hrv_avg = _compute_hrv_trend(hrv_rows)

            return {
                "daily": row,
                "advanced": row,
                "consecutive_hard_days": hard_days,
                "hrv_avg_7d": hrv_avg,
                "hrv_trend": hrv_trend,
            }
    except psycopg2.errors.UndefinedTable:
        # Matview doesn't exist yet — fall back to separate queries
        db = cur.connection
        db.rollback()
    except Exception as e:
        print(f"[ha-notify] Matview query failed: {e}", file=sys.stderr)
        db = cur.connection
        db.rollback()

    # Fallback: query tables directly (pre-matview compatibility).
    # readiness_score / readiness_zone live in the `readiness_score` table,
    # not on `daily_metric` — LEFT JOIN to expose them alongside the daily
    # metrics row so downstream consumers see the same shape as the matview.
    cur.execute(
        """
        SELECT dm.date, dm.hrv, dm.resting_hr, dm.body_battery_end, dm.stress_score,
               dm.sleep_debt_minutes, dm.body_battery_start,
               dm.spo2, dm.respiration_rate, dm.skin_temp,
               dm.garmin_training_readiness, dm.garmin_training_readiness_level,
               dm.garmin_training_status, dm.garmin_load_focus, dm.garmin_recovery_hours,
               dm.garmin_training_load, dm.weight_kg, dm.body_fat_pct,
               rs.score AS readiness_score,
               rs.zone  AS readiness_zone
        FROM daily_metric dm
        LEFT JOIN readiness_score rs
               ON rs.user_id = dm.user_id AND rs.date = dm.date
        WHERE dm.user_id = %s
        ORDER BY dm.date DESC LIMIT 1
    """,
        (user_id,),
    )
    dm = cur.fetchone()

    cur.execute(hrv_history_sql, (user_id,))
    hrv_rows = cur.fetchall()

    cur.execute(
        """
        SELECT date, ctl, atl, tsb, acwr, ramp_rate, cp, mftp, effective_vo2max
        FROM advanced_metric
        WHERE user_id = %s
        ORDER BY date DESC LIMIT 1
    """,
        (user_id,),
    )
    am = cur.fetchone()

    # Check consecutive hard days (last 3 days high strain)
    cur.execute(
        """
        SELECT COUNT(*) as count FROM daily_metric
        WHERE user_id = %s AND date >= CURRENT_DATE - INTERVAL '3 days'
          AND garmin_training_load > 50
    """,
        (user_id,),
    )
    hard_days_row = cur.fetchone()
    hard_days = hard_days_row["count"] if hard_days_row else 0

    hrv_trend, hrv_avg = _compute_hrv_trend(hrv_rows)

    return {
        "daily": dm,
        "advanced": am,
        "consecutive_hard_days": hard_days,
        "hrv_avg_7d": hrv_avg,
        "hrv_trend": hrv_trend,
    }


def recommend_workout(
    acwr: float | None,
    tsb: float | None,
    body_battery: int | None,
    stress_score: int | None,
    sleep_debt_minutes: int | None,
    consecutive_hard_days: int,
    readiness_score: int | None = None,
    garmin_training_status: str | None = None,
) -> dict:
    """Generate an AI-informed workout recommendation based on readiness signals.

    Uses evidence-based decision logic to replace Pacer's rest-day
    suggestion, which suffers from a known sync desynchronization bug.

    Decision framework (Banister 1975, Hulin 2016, Buchheit 2014):
    - ACWR sweet spot: 0.8-1.3 (Hulin 2016)
    - TSB < -20: overreaching, need recovery (Meeusen 2013)
    - Body Battery < 30: insufficient energy reserves
    - Sleep debt > 2h: impaired adaptation (Halson 2014)
    - 3+ consecutive hard days: schedule recovery (Kellmann 2010)

    Returns dict with: is_rest_day, workout_type, intensity, duration_min,
    hr_zone_target, rationale.
    """
    # Default signals — conservative when data is missing
    bb = body_battery if body_battery is not None else 50
    sd_hrs = (sleep_debt_minutes / 60) if sleep_debt_minutes else 0
    stress = stress_score if stress_score is not None else 50
    readiness = readiness_score if readiness_score is not None else 50
    g_status = garmin_training_status.upper() if garmin_training_status else ""
    tsb_str = f"{tsb:+.0f}" if tsb is not None else "N/A"

    # --- Rest day triggers (any one is sufficient) ---
    rest_reasons: list[str] = []

    if readiness < 25:
        rest_reasons.append(
            f"Readiness critically low ({readiness}/100) — "
            "body needs recovery before quality training"
        )

    if g_status == "OVERREACHING":
        rest_reasons.append(
            "Garmin Training Status: OVERREACHING — active recovery or rest recommended"
        )

    if consecutive_hard_days >= 3:
        rest_reasons.append(
            f"{consecutive_hard_days} consecutive high-load days "
            "(Kellmann 2010: recovery required after 3+ hard days)"
        )

    if tsb is not None and tsb < -25:
        rest_reasons.append(
            f"TSB is {tsb:.1f} — deep overreach zone "
            "(Meeusen 2013: TSB < -25 indicates functional overreaching)"
        )

    if bb < 20:
        rest_reasons.append(
            f"Body Battery critically low ({bb}%) — insufficient energy reserves"
        )

    if sd_hrs > 3:
        rest_reasons.append(
            f"Sleep debt {sd_hrs:.1f}h — performance impaired "
            "(Mah 2011: >3h debt degrades reaction time and power output)"
        )

    if acwr is not None and acwr > 1.5:
        rest_reasons.append(
            f"ACWR {acwr:.2f} — high injury risk zone "
            "(Hulin 2016: ACWR >1.5 = 2-4x injury risk)"
        )

    if rest_reasons:
        return {
            "is_rest_day": True,
            "workout_type": "rest",
            "intensity": "none",
            "duration_min": 0,
            "hr_zone_target": 0,
            "rationale": "Rest day recommended. " + rest_reasons[0],
            "all_factors": rest_reasons,
        }

    # --- Active recovery triggers ---
    recovery_signals = 0
    if tsb is not None and tsb < -15:
        recovery_signals += 2
    if bb < 40:
        recovery_signals += 1
    if sd_hrs > 1.5:
        recovery_signals += 1
    if stress > 70:
        recovery_signals += 1
    if consecutive_hard_days >= 2:
        recovery_signals += 1
    if acwr is not None and acwr > 1.3:
        recovery_signals += 1
    if readiness < 40:
        recovery_signals += 1

    if recovery_signals >= 3:
        return {
            "is_rest_day": False,
            "workout_type": "active_recovery",
            "intensity": "easy",
            "duration_min": 30,
            "hr_zone_target": 1,
            "rationale": (
                "Active recovery day — easy effort only. "
                f"Readiness: {readiness}, TSB: {tsb}, "
                f"BB: {bb}%, stress: {stress}."
            ),
            "all_factors": [],
        }

    # --- Normal training day: select intensity based on form + readiness ---
    is_fresh = tsb is not None and tsb > 5
    high_readiness = readiness >= 70
    peaking = g_status in ("PEAKING", "PRODUCTIVE")

    if (
        (is_fresh or high_readiness or peaking)
        and bb >= 60
        and (acwr is None or acwr <= 1.2)
    ):
        # Fresh and ready — quality session
        status_note = f", Garmin: {g_status}" if g_status else ""
        return {
            "is_rest_day": False,
            "workout_type": "quality",
            "intensity": "hard",
            "duration_min": 60,
            "hr_zone_target": 4,
            "rationale": (
                f"Great day for intensity — Readiness {readiness}, "
                f"TSB {tsb_str} (fresh), "
                f"Body Battery {bb}%{status_note}. "
                "Tempo, intervals, or race-pace work."
            ),
            "all_factors": [],
        }

    if (readiness >= 50 or (tsb is not None and tsb >= -10)) and bb >= 45:
        # Moderate form — aerobic development
        return {
            "is_rest_day": False,
            "workout_type": "aerobic",
            "intensity": "moderate",
            "duration_min": 45,
            "hr_zone_target": 2,
            "rationale": (
                f"Steady aerobic session — Readiness {readiness}, "
                f"TSB {tsb_str}, Body Battery {bb}%. "
                "Zone 2 base building or moderate tempo."
            ),
            "all_factors": [],
        }

    # Default: easy day
    return {
        "is_rest_day": False,
        "workout_type": "easy",
        "intensity": "easy",
        "duration_min": 35,
        "hr_zone_target": 1,
        "rationale": (
            f"Easy effort today — form is neutral (TSB: {tsb}, BB: {bb}%). "
            "Keep it conversational pace."
        ),
        "all_factors": [],
    }


def compute_injury_risk(
    acwr: float | None, tsb: float | None, ramp_rate: float | None
) -> tuple[str, int]:
    """Compute injury risk level. Returns (level, score_0_100)."""
    if acwr is None:
        return ("unknown", 0)

    risk_score = 0

    # ACWR contribution (Hulin 2016 guidelines)
    if acwr > 1.5:
        risk_score += 60  # High risk
    elif acwr > 1.3:
        risk_score += 30  # Elevated
    elif acwr < 0.8:
        risk_score += 10  # Under-training

    # TSB contribution (TrainingPeaks Form)
    if tsb is not None and tsb < -20:
        risk_score += 25  # Overreached
    elif tsb is not None and tsb < -10:
        risk_score += 10

    # Ramp rate contribution
    if ramp_rate is not None and abs(ramp_rate) > 10:
        risk_score += 15

    risk_score = min(100, risk_score)

    if risk_score >= 60:
        level = "high"
    elif risk_score >= 30:
        level = "elevated"
    elif risk_score >= 10:
        level = "moderate"
    else:
        level = "low"

    return (level, risk_score)


def fetch_data_quality(cur, user_id: str) -> dict:
    """Summarise unresolved data_quality_log entries for the HA sensor.

    Returns a dict with counts + the most relevant stale-sync message. Safe
    if the table doesn't exist yet (returns an empty/ok summary).
    """
    summary = {
        "missing_days": 0,
        "stale_days": 0,
        "issues": 0,
        "status": "ok",
        "message": "All recent data present",
        "field_gaps": [],
    }
    try:
        cur.execute(
            """
            SELECT check_name, severity, message, raw_value, date::text AS d
            FROM data_quality_log
            WHERE user_id = %s
              AND resolved_at IS NULL
              AND date >= (CURRENT_DATE - INTERVAL '13 days')
            ORDER BY created_at DESC
            """,
            (user_id,),
        )
        rows = cur.fetchall()
    except Exception as exc:  # table missing / transient
        print(f"[ha-notify] data_quality unavailable: {exc}", file=sys.stderr)
        return summary

    if not rows:
        return summary

    severities = {"info": 0, "warn": 1, "error": 2}
    worst = 0
    for r in rows:
        cn = r["check_name"]
        worst = max(worst, severities.get(r["severity"], 0))
        if cn == "missing_day":
            summary["missing_days"] += 1
        elif cn == "stale_data":
            summary["stale_days"] = int(r["raw_value"] or 0)
            summary["message"] = r["message"]
        elif cn == "missing_field":
            summary["field_gaps"].append(r["message"])

    summary["issues"] = sum(1 for r in rows if r["severity"] in ("warn", "error"))
    summary["status"] = {0: "ok", 1: "warn", 2: "error"}[worst]
    if summary["missing_days"] and summary["message"] == "All recent data present":
        summary["message"] = (
            f"{summary['missing_days']} day(s) missing in the last 14 days"
        )
    return summary


def run_notifications(user_id: str):
    """Push all sensor states and check for alerts."""
    print(f"[ha-notify] Running notification pass for user {user_id}...")

    db = None
    try:
        db = psycopg2.connect(DATABASE_URL)
        cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        data = get_latest_metrics(cur, user_id)
        dm = data["daily"]
        am = data["advanced"]

        if dm is None and am is None:
            print("[ha-notify] No data yet — skipping")
            return

        # --- Push sensor states ---

        # sensor.pacer_acwr
        acwr = am["acwr"] if am else None
        push_sensor(
            "sensor.pacer_acwr",
            round(acwr, 2) if acwr is not None else "unknown",
            {
                "friendly_name": "Pacer ACWR",
                "unit_of_measurement": "",
                "icon": "mdi:run",
                "status": (
                    "unknown"
                    if acwr is None
                    else "optimal"
                    if 0.8 <= acwr <= 1.3
                    else "caution"
                    if acwr <= 1.5
                    else "high_risk"
                ),
            },
        )

        # sensor.pacer_form (TSB)
        tsb = am["tsb"] if am else None
        push_sensor(
            "sensor.pacer_form",
            round(tsb, 1) if tsb is not None else "unknown",
            {
                "friendly_name": "Pacer Form (TSB)",
                "unit_of_measurement": "pts",
                "icon": "mdi:chart-line",
                "status": (
                    "unknown"
                    if tsb is None
                    else "fresh"
                    if tsb > 5
                    else "optimal"
                    if tsb >= -10
                    else "tired"
                    if tsb >= -20
                    else "overreached"
                ),
            },
        )

        # sensor.pacer_injury_risk
        ramp = am["ramp_rate"] if am else None
        risk_level, risk_score = compute_injury_risk(acwr, tsb, ramp)
        push_sensor(
            "sensor.pacer_injury_risk",
            risk_level,
            {
                "friendly_name": "Pacer Injury Risk",
                "icon": "mdi:shield-alert",
                "risk_score": risk_score,
                "acwr": acwr,
                "tsb": tsb,
                "ramp_rate": ramp,
            },
        )

        # sensor.pacer_ctl (Fitness/CTL)
        ctl = am["ctl"] if am else None
        push_sensor(
            "sensor.pacer_ctl",
            round(ctl, 1) if ctl else "unknown",
            {
                "friendly_name": "Pacer Fitness (CTL)",
                "unit_of_measurement": "pts",
                "icon": "mdi:trending-up",
            },
        )

        # sensor.pacer_atl (Fatigue/ATL)
        atl = am["atl"] if am else None
        push_sensor(
            "sensor.pacer_atl",
            round(atl, 1) if atl else "unknown",
            {
                "friendly_name": "Pacer Fatigue (ATL)",
                "unit_of_measurement": "pts",
                "icon": "mdi:trending-down",
            },
        )

        # sensor.pacer_body_battery
        bb = dm["body_battery_end"] if dm else None
        push_sensor(
            "sensor.pacer_body_battery",
            bb if bb is not None else "unknown",
            {
                "friendly_name": "Pacer Body Battery",
                "unit_of_measurement": "%",
                "icon": "mdi:battery",
            },
        )

        # sensor.pacer_sleep_debt
        sleep_debt = dm["sleep_debt_minutes"] if dm else None
        push_sensor(
            "sensor.pacer_sleep_debt",
            round(sleep_debt / 60, 1) if sleep_debt else 0,
            {
                "friendly_name": "Pacer Sleep Debt",
                "unit_of_measurement": "h",
                "icon": "mdi:sleep",
            },
        )

        # sensor.pacer_readiness
        readiness_val = None
        readiness_zone = None
        readiness_src = None
        if dm:
            # Prefer Garmin native readiness, fall back to computed
            garmin_r = dm.get("garmin_training_readiness")
            readiness_val = (
                garmin_r if garmin_r is not None else dm.get("readiness_score")
            )
            garmin_rl = dm.get("garmin_training_readiness_level")
            readiness_zone = (
                garmin_rl if garmin_rl is not None else dm.get("readiness_zone")
            )
            readiness_src = "garmin" if garmin_r is not None else "computed"
        push_sensor(
            "sensor.pacer_readiness",
            readiness_val if readiness_val is not None else "unknown",
            {
                "friendly_name": "Pacer Readiness",
                "unit_of_measurement": "/100",
                "icon": "mdi:heart-pulse",
                "zone": readiness_zone or "unknown",
                "source": readiness_src or "unknown",
            },
        )

        # sensor.pacer_training_status
        g_training_status = dm.get("garmin_training_status") if dm else None
        g_recovery_hrs = dm.get("garmin_recovery_hours") if dm else None
        push_sensor(
            "sensor.pacer_training_status",
            g_training_status if g_training_status else "unknown",
            {
                "friendly_name": "Pacer Training Status",
                "icon": "mdi:run-fast",
                "recovery_hours": g_recovery_hrs,
                "load_focus": dm.get("garmin_load_focus") if dm else None,
            },
        )

        # sensor.pacer_recovery_time (top-level for automations/dashboards)
        push_sensor(
            "sensor.pacer_recovery_time",
            round(g_recovery_hrs, 1) if g_recovery_hrs is not None else "unknown",
            {
                "friendly_name": "Pacer Recovery Time",
                "unit_of_measurement": "h",
                "icon": "mdi:timer-sand",
                "device_class": "duration",
                "status": (
                    "ready"
                    if g_recovery_hrs is not None and g_recovery_hrs < 6
                    else (
                        "partial"
                        if g_recovery_hrs is not None and g_recovery_hrs < 24
                        else ("recovering" if g_recovery_hrs is not None else "unknown")
                    )
                ),
            },
        )

        # sensor.pacer_hrv
        # NOTE: `daily_metric.hrv` is Garmin's `hrvSummary.weeklyAvg`
        # (see garmin-sync.py), so this sensor reflects the most recent
        # weekly-average HRV rather than the previous-night value.
        latest_hrv = dm.get("hrv") if dm else None
        hrv_trend = data.get("hrv_trend")
        hrv_avg_7d = data.get("hrv_avg_7d")
        push_sensor(
            "sensor.pacer_hrv",
            round(latest_hrv, 1) if latest_hrv is not None else "unknown",
            {
                "friendly_name": "Pacer HRV (weekly avg)",
                "unit_of_measurement": "ms",
                "icon": "mdi:heart-flash",
                "source": "garmin_weekly_avg",
                "trend": hrv_trend or "unknown",
                "avg_7d": hrv_avg_7d,
            },
        )

        # sensor.pacer_load_focus (top-level for dashboards).
        # The synced `garmin_load_focus` JSON can contain either:
        #   - percentage keys (highAerobicTrainingLoadPercentage, ...) or
        #   - absolute load keys (highAerobicTrainingLoad, ...).
        # Prefer percentages when present; fall back to absolutes otherwise.
        load_focus_raw = dm.get("garmin_load_focus") if dm else None
        load_focus_label = _derive_load_focus_label(load_focus_raw)
        load_focus_attrs = load_focus_raw if isinstance(load_focus_raw, dict) else {}
        push_sensor(
            "sensor.pacer_load_focus",
            load_focus_label,
            {
                "friendly_name": "Pacer Load Focus",
                "icon": "mdi:chart-donut",
                **load_focus_attrs,
            },
        )

        # sensor.pacer_weight
        weight = dm.get("weight_kg") if dm else None
        push_sensor(
            "sensor.pacer_weight",
            round(weight, 1) if weight else "unknown",
            {
                "friendly_name": "Pacer Weight",
                "unit_of_measurement": "kg",
                "icon": "mdi:scale-bathroom",
                "body_fat_pct": dm.get("body_fat_pct") if dm else None,
            },
        )

        # sensor.pacer_bedtime_target / sensor.pacer_wake_window
        # Timestamp state so a blueprint can use a plain time trigger.
        sw = fetch_sleep_window(cur, user_id)
        push_sensor(
            "sensor.pacer_bedtime_target",
            _next_local_occurrence(sw["bedtime"]) if sw else "unknown",
            {
                "friendly_name": "Pacer Bedtime Target",
                "device_class": "timestamp",
                "icon": "mdi:bed-clock",
                "local_time": sw["bedtime"] if sw else None,
                "sleep_need_minutes": sw["need_minutes"] if sw else None,
                "debt_payback_minutes": sw["debt_payback_minutes"] if sw else None,
                "nights_used": sw["nights_used"] if sw else None,
                "anchor": "habit",
            },
        )
        push_sensor(
            "sensor.pacer_wake_window",
            f"{sw['wake_start']}-{sw['wake_end']}" if sw else "unknown",
            {
                "friendly_name": "Pacer Wake Window",
                "icon": "mdi:alarm",
                "start": sw["wake_start"] if sw else None,
                "end": sw["wake_end"] if sw else None,
                "target": sw["wake"] if sw else None,
                "anchor": "habit",
            },
        )

        # sensor.pacer_fitness_age — VO2max expressed as an age against the
        # Loe 2013 HUNT3 reference cohort. A re-expression of the VO2max
        # percentile, not a biological-age biomarker.
        fitness_age = fetch_fitness_age(cur, user_id)
        push_sensor(
            "sensor.pacer_fitness_age",
            fitness_age[0] if fitness_age else "unknown",
            {
                "friendly_name": "Pacer Fitness Age",
                "unit_of_measurement": "a",
                "icon": "mdi:account-clock",
                "delta_years": fitness_age[1] if fitness_age else None,
                "population_mean_vo2max": fitness_age[2] if fitness_age else None,
                "reference_curve": fitness_age[3] if fitness_age else None,
            },
        )

        # sensor.pacer_spo2
        spo2 = dm.get("spo2") if dm else None
        push_sensor(
            "sensor.pacer_spo2",
            round(spo2, 1) if spo2 is not None else "unknown",
            {
                "friendly_name": "Pacer SpO2",
                "unit_of_measurement": "%",
                "icon": "mdi:lungs",
                "status": "normal"
                if spo2 and spo2 >= 95
                else (
                    "low"
                    if spo2 and spo2 >= 90
                    else ("critical" if spo2 else "unknown")
                ),
            },
        )

        # sensor.pacer_respiration_rate
        rr = dm.get("respiration_rate") if dm else None
        push_sensor(
            "sensor.pacer_respiration_rate",
            round(rr, 1) if rr is not None else "unknown",
            {
                "friendly_name": "Pacer Respiration Rate",
                "unit_of_measurement": "brpm",
                "icon": "mdi:weather-windy",
            },
        )

        # sensor.pacer_skin_temp
        skin_temp = dm.get("skin_temp") if dm else None
        push_sensor(
            "sensor.pacer_skin_temp",
            round(skin_temp, 1) if skin_temp is not None else "unknown",
            {
                "friendly_name": "Pacer Skin Temperature",
                "unit_of_measurement": "°C",
                "icon": "mdi:thermometer",
            },
        )

        # sensor.pacer_workout_recommendation
        # AI-informed workout suggestion using readiness + all recovery signals
        hard_days = data["consecutive_hard_days"]
        workout = recommend_workout(
            acwr=acwr,
            tsb=tsb,
            body_battery=dm["body_battery_end"] if dm else None,
            stress_score=dm["stress_score"] if dm else None,
            sleep_debt_minutes=dm["sleep_debt_minutes"] if dm else None,
            consecutive_hard_days=hard_days,
            readiness_score=readiness_val,
            garmin_training_status=g_training_status,
        )
        push_sensor(
            "sensor.pacer_workout_recommendation",
            workout["workout_type"],
            {
                "friendly_name": "Pacer Workout Recommendation",
                "icon": "mdi:dumbbell" if not workout["is_rest_day"] else "mdi:sleep",
                "is_rest_day": workout["is_rest_day"],
                "intensity": workout["intensity"],
                "duration_min": workout["duration_min"],
                "hr_zone_target": workout["hr_zone_target"],
                "rationale": workout["rationale"],
                "all_factors": workout.get("all_factors", []),
            },
        )

        print(
            f"[ha-notify] Sensors pushed — ACWR: {acwr}, Form: {tsb}, "
            f"Risk: {risk_level}, Workout: {workout['workout_type']}"
        )

        # sensor.pacer_data_quality — transparency on sync gaps
        dq = fetch_data_quality(cur, user_id)
        push_sensor(
            "sensor.pacer_data_quality",
            dq["issues"],
            {
                "friendly_name": "Pacer Data Quality",
                "unit_of_measurement": "issues",
                "icon": "mdi:database-check"
                if dq["status"] == "ok"
                else "mdi:database-alert",
                "status": dq["status"],
                "missing_days_14d": dq["missing_days"],
                "stale_days": dq["stale_days"],
                "field_gaps": dq["field_gaps"],
                "message": dq["message"],
            },
        )

        # --- Alert notifications ---
        alerts = []

        if dq["stale_days"] >= 3:
            alerts.append(
                (
                    "📡 Pacer Data Sync Stale",
                    f"{dq['message']}. Check the Garmin sync — readiness and "
                    f"load metrics may be out of date.",
                    "gc_data_stale",
                )
            )

        if acwr and acwr > 1.5:
            alerts.append(
                (
                    "🔴 High Injury Risk — ACWR",
                    f"Your ACWR is {acwr:.2f} (>1.5 high risk zone per Hulin 2016). "
                    f"Consider reducing training load for 2-3 days.",
                    "gc_acwr_high",
                )
            )
        elif acwr and acwr > 1.3:
            alerts.append(
                (
                    "🟡 Elevated ACWR",
                    f"ACWR is {acwr:.2f} — entering caution zone (>1.3). Monitor closely.",
                    "gc_acwr_caution",
                )
            )

        if tsb is not None and tsb < -20:
            alerts.append(
                (
                    "😴 Overreaching Detected",
                    f"Training Stress Balance (Form) is {tsb:.1f} — below -20 indicates overreaching. "
                    f"Schedule a rest day or active recovery.",
                    "gc_tsb_overreach",
                )
            )

        if sleep_debt and sleep_debt > 120:  # 2+ hours
            alerts.append(
                (
                    "💤 Sleep Debt Warning",
                    f"Sleep debt: {sleep_debt // 60}h {sleep_debt % 60}m. "
                    f"Prioritize sleep tonight for optimal recovery.",
                    "gc_sleep_debt",
                )
            )

        if (
            bb
            and bb < 20
            and dm["body_battery_start"]
            and dm["body_battery_start"] > 60
        ):  # low end BB, started high
            alerts.append(
                (
                    "🔋 Low Body Battery",
                    f"Body Battery is critically low ({bb}%). Recovery priority today.",
                    "gc_body_battery_low",
                )
            )

        if hard_days >= 3:
            alerts.append(
                (
                    "🏋️ Consecutive Hard Training Days",
                    f"{hard_days} high-load days in the last 3 days. "
                    f"Consider a recovery or easy day to avoid overtraining.",
                    "gc_hard_days",
                )
            )

        for title, msg, nid in alerts:
            create_notification(title, msg, nid)
            print(f"[ha-notify] Alert sent: {title}")

        cur.close()
    except Exception as e:
        print(f"[ha-notify] ERROR: {e}", file=sys.stderr)
        import traceback

        traceback.print_exc()
    finally:
        if db:
            db.close()


def main():
    once_mode = "--once" in sys.argv
    print(
        f"[ha-notify] Starting. Mode: {'once' if once_mode else f'loop every {NOTIFY_INTERVAL_MINUTES}m'} (timezone: {USER_TZ})"
    )

    run_notifications(USER_ID)

    if not once_mode:
        while True:
            print(f"[ha-notify] Sleeping {NOTIFY_INTERVAL_MINUTES}m...")
            time.sleep(NOTIFY_INTERVAL_MINUTES * 60)
            run_notifications(USER_ID)


if __name__ == "__main__":
    main()
