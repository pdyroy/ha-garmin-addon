#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Garmin Connect sync script for Pacer HA Addon.

Pulls latest health data from Garmin Connect API and inserts into the
local PostgreSQL database. Runs periodically via the s6 service manager.

Supports two auth modes:
  1. Saved tokens in /data/garmin-tokens/ (preferred, from generate-garmin-tokens.py)
  2. Email/password from environment variables (fallback)
"""

import json
import logging
import math
import os
import random
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, TypeVar
from zoneinfo import ZoneInfo

try:
    from garminconnect import Garmin
except ImportError:
    print("ERROR: garminconnect not installed", file=sys.stderr)
    sys.exit(1)

try:
    import psycopg2
except ImportError:
    print("ERROR: psycopg2 not installed", file=sys.stderr)
    sys.exit(1)


DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://postgres@127.0.0.1:5432/pacer"
)
GARMIN_EMAIL = os.environ.get("GARMIN_EMAIL", "")
GARMIN_PASSWORD = os.environ.get("GARMIN_PASSWORD", "")
TOKEN_DIR = os.environ.get("GARMIN_TOKEN_DIR", "/data/garmin-tokens")
# Must match the userId used by the Next.js app (DEV_BYPASS_AUTH seed user)
USER_ID = os.environ.get("GARMIN_USER_ID", "seed-user-001")
GARMIN_MAX_RETRY_ATTEMPTS = 5
GARMIN_RETRY_BASE_DELAY_SECONDS = 1.0
GARMIN_RETRY_MAX_DELAY_SECONDS = 60.0


def _env_float(name: str, default: float) -> float:
    """Parse a float environment variable, falling back to default if unset
    or non-numeric, so a bad value cannot crash the sync at import time."""
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        print(
            f"WARNING: Invalid {name}='{raw}', falling back to {default}",
            file=sys.stderr,
        )
        return default


GARMIN_INITIAL_BACKFILL_DAY_DELAY_SECONDS = _env_float(
    "GARMIN_INITIAL_BACKFILL_DAY_DELAY_SECONDS", 0.25
)
T = TypeVar("T")

# Timezone for date boundary calculations (e.g., "Australia/Brisbane")
_tz_name = os.environ.get("USER_TIMEZONE", "UTC")
try:
    USER_TZ = ZoneInfo(_tz_name)
except (KeyError, ValueError):
    print(
        f"WARNING: Invalid timezone '{_tz_name}', falling back to UTC", file=sys.stderr
    )
    USER_TZ = ZoneInfo("UTC")


def _user_today():
    """Get today's date in the user's configured timezone."""
    return datetime.now(USER_TZ).date()


def _ensure_secure_dir(path: str) -> None:
    """Create ``path`` with mode 0700, tightening it if it already exists.

    ``os.makedirs`` ignores its ``mode`` argument when the directory already
    exists, so a directory created by an earlier version with broader bits
    would stay world-/group-readable. The explicit ``chmod`` corrects that so
    the hardening is effective on upgrades, not just fresh installs.
    """
    os.makedirs(path, mode=0o700, exist_ok=True)
    # Don't chmod through a symlink — only tighten a real directory.
    if not os.path.islink(path):
        os.chmod(path, 0o700)


def _has_saved_garmin_tokens(token_dir: str | None = None) -> bool:
    """Return true if a usable Garmin token pair exists.

    Only the garth pair counts. garmin_tokens.json used to satisfy this check
    too, reporting a session the pinned garth 0.6.3 cannot load — so the add-on
    logged "Found saved Garmin tokens" and then failed every request.
    """
    token_dir = token_dir or TOKEN_DIR
    return os.path.exists(
        os.path.join(token_dir, "oauth1_token.json")
    ) and os.path.exists(os.path.join(token_dir, "oauth2_token.json"))


def _exception_status_code(exc: Exception) -> int | None:
    """Extract an HTTP status code from common client exception shapes."""
    response = getattr(exc, "response", None)
    status = getattr(response, "status_code", None)
    if status is None:
        status = getattr(exc, "status_code", None)
    try:
        return int(status)
    except (TypeError, ValueError):
        return None


def _retry_after_seconds(exc: Exception) -> float | None:
    """Extract Retry-After seconds from an exception response, if present."""
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None) or getattr(exc, "headers", None)
    if not headers:
        return None
    retry_after = headers.get("Retry-After") if hasattr(headers, "get") else None
    if not retry_after:
        return None
    try:
        return max(0.0, float(retry_after))
    except (TypeError, ValueError):
        try:
            retry_at = parsedate_to_datetime(str(retry_after))
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            return max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, IndexError, OverflowError):
            return None


def _is_garmin_retryable(exc: Exception) -> bool:
    """Return true for Garmin rate-limit and transient server failures."""
    status = _exception_status_code(exc)
    if status == 429 or status in {500, 502, 503, 504}:
        return True
    message = str(exc).lower()
    return (
        "rate limit" in message
        or "rate-limit" in message
        or "too many requests" in message
        or "http 429" in message
        or "status code: 429" in message
    )


def _garmin_api_call(
    description: str,
    func: Callable[..., T],
    *args: Any,
    **kwargs: Any,
) -> T:
    """Call a Garmin API method with bounded exponential backoff."""
    for attempt in range(1, GARMIN_MAX_RETRY_ATTEMPTS + 1):
        try:
            return func(*args, **kwargs)
        except Exception as exc:
            if attempt >= GARMIN_MAX_RETRY_ATTEMPTS or not _is_garmin_retryable(exc):
                raise
            retry_after = _retry_after_seconds(exc)
            if retry_after is None:
                retry_after = min(
                    GARMIN_RETRY_MAX_DELAY_SECONDS,
                    GARMIN_RETRY_BASE_DELAY_SECONDS * (2 ** (attempt - 1)),
                )
            delay = retry_after + random.uniform(0, GARMIN_RETRY_BASE_DELAY_SECONDS)
            # Bound the delay even when an upstream Retry-After header asks
            # for an arbitrarily long wait, so backoff stays truly bounded.
            delay = min(delay, GARMIN_RETRY_MAX_DELAY_SECONDS)
            print(
                f"  Garmin API retry {attempt}/{GARMIN_MAX_RETRY_ATTEMPTS} "
                f"for {description} after {delay:.1f}s",
                file=sys.stderr,
            )
            time.sleep(delay)

    raise RuntimeError(f"Garmin API retry loop exhausted for {description}")


SYNC_STATUS_FILE = os.path.join(TOKEN_DIR, ".sync_status")
LAST_SYNC_FILE = os.path.join(TOKEN_DIR, ".last_sync")
SKIN_TEMP_BACKFILL_MARKER = "/data/.skin_temp_backfill_done"
SKIN_TEMP_KEYS = (
    "averageSkinTemperatureCelsius",
    "averageSkinTempCelsius",
    "avgSkinTempCelsius",
)


def _write_last_sync() -> None:
    """Record successful sync completion time for /auth/status."""
    try:
        _ensure_secure_dir(TOKEN_DIR)
        with open(LAST_SYNC_FILE, "w") as f:
            f.write(datetime.now(timezone.utc).isoformat())
    except Exception as exc:
        logging.getLogger(__name__).debug("last-sync write failed: %s", exc)


def _write_sync_status(phase, detail="", progress=0):
    """Write sync progress to a shared status file for the auth server."""
    import json as _json

    _ensure_secure_dir(TOKEN_DIR)
    status = {
        "syncing": True,
        "phase": phase,
        "detail": detail,
        "progress": progress,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        with open(SYNC_STATUS_FILE, "w") as f:
            _json.dump(status, f)
    except Exception as exc:
        logging.getLogger(__name__).debug("sync-status write failed: %s", exc)


def _clear_sync_status():
    """Clear sync status file when sync completes."""
    import json as _json

    status = {
        "syncing": False,
        "phase": "idle",
        "detail": "",
        "progress": 100,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        with open(SYNC_STATUS_FILE, "w") as f:
            _json.dump(status, f)
    except Exception as exc:
        logging.getLogger(__name__).debug("sync-status clear failed: %s", exc)


def _refresh_matview(db) -> None:
    """Refresh the daily_athlete_summary materialized view after sync."""
    cur = None
    try:
        cur = db.cursor()
        cur.execute("SELECT refresh_daily_athlete_summary()")
        db.commit()
        print("  Refreshed daily_athlete_summary materialized view")
    except Exception as e:
        db.rollback()
        print(f"  Matview refresh skipped: {e}", file=sys.stderr)
    finally:
        if cur is not None:
            cur.close()


def get_client():
    """Authenticate with Garmin Connect, preferring saved tokens."""
    _ensure_secure_dir(TOKEN_DIR)
    oauth1_path = os.path.join(TOKEN_DIR, "oauth1_token.json")
    oauth2_path = os.path.join(TOKEN_DIR, "oauth2_token.json")

    # Only the garth pair matters here. An earlier version also wrote
    # garmin_tokens.json in garminconnect 0.3.x's native format, which the
    # pinned garth 0.6.3 cannot read; it is simply ignored rather than deleted,
    # so a future garminconnect that writes it legitimately is not sabotaged.

    # Mode 1: resume from the garth token pair written by the auth server.
    if os.path.exists(oauth1_path) and os.path.exists(oauth2_path):
        try:
            client = Garmin(GARMIN_EMAIL or "token-user", GARMIN_PASSWORD or "")
            client.login(tokenstore=TOKEN_DIR)
            # Re-save tokens (refreshes if needed). The pinned garminconnect
            # 0.2.40 exposes the garth client as .garth, not .client — getting
            # this wrong means no token is ever persisted and every run falls
            # back to a full SSO password login.
            try:
                client.garth.dump(TOKEN_DIR)
            except Exception as exc:
                print(f"WARNING: could not save Garmin tokens: {exc}", file=sys.stderr)
            print("Authenticated with saved tokens")
            return client
        except Exception as e:
            print(f"Saved tokens failed: {e}", file=sys.stderr)
            logging.getLogger(__name__).debug("saved token login failed: %s", e)
            print("Will try credential login as fallback", file=sys.stderr)

    # Mode 2: Email/password login
    if GARMIN_EMAIL and GARMIN_PASSWORD:
        try:
            client = Garmin(GARMIN_EMAIL, GARMIN_PASSWORD)
            client.login()
            saved = True
            try:
                client.garth.dump(TOKEN_DIR)
            except Exception as exc:
                saved = False
                print(f"WARNING: could not save Garmin tokens: {exc}", file=sys.stderr)
            print(
                "Authenticated with credentials, tokens saved"
                if saved
                else "Authenticated with credentials, but tokens were NOT saved"
            )
            return client
        except Exception as e:
            print(f"Credential login failed: {e}", file=sys.stderr)
            logging.getLogger(__name__).debug("credential login failed: %s", e)

    return None


def get_db():
    """Connect to PostgreSQL."""
    return psycopg2.connect(DATABASE_URL)


def _safe_sleep_minutes(sleep_dto, key):
    """Safely extract sleep seconds and convert to minutes."""
    val = sleep_dto.get(key)
    if val is None:
        return None
    return val // 60


def _extract_sleep_time(sleep_dto, key):
    """Extract sleep timestamp and convert to minutes-from-midnight string.

    Garmin *TimestampLocal fields store epoch milliseconds where the encoded
    UTC datetime represents the user's local wall-clock time. For example,
    a bedtime of 22:30 AEST is stored as the epoch-ms for 22:30 UTC (not
    the actual UTC instant). Using utcfromtimestamp recovers the intended
    hours and minutes without any system timezone dependency.
    """
    ts = sleep_dto.get(key)
    if ts is None:
        return None
    try:
        # Garmin "Local" timestamps encode local wall-clock time as UTC epoch
        dt = datetime.utcfromtimestamp(ts / 1000)
        minutes = dt.hour * 60 + dt.minute
        return str(minutes)
    except (ValueError, TypeError, OSError):
        return None


def _compute_sleep_debt(sleep_dto):
    """Compute sleep debt = need - actual (in minutes). Positive = deficit."""
    need = sleep_dto.get("sleepNeedInMinutes")
    actual_sec = sleep_dto.get("sleepTimeSeconds")
    if need is None or actual_sec is None:
        return None
    actual_min = actual_sec // 60
    return need - actual_min


def _coerce_skin_temp(value: Any) -> float | None:
    """Convert a Garmin skin-temperature value to Celsius rounded for storage."""
    if value is None or value == "" or isinstance(value, bool):
        return None
    if not isinstance(value, (int, float, str)):
        return None
    try:
        temp = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(temp) or math.isinf(temp):
        return None
    return round(temp, 2)


def _find_first_skin_temp_value(payload: Any) -> Any | None:
    """Find the first known skin-temperature key in nested Garmin payloads."""
    if isinstance(payload, dict):
        for key in SKIN_TEMP_KEYS:
            if key in payload and _coerce_skin_temp(payload.get(key)) is not None:
                return payload.get(key)
        for value in payload.values():
            found = _find_first_skin_temp_value(value)
            if found is not None:
                return found
    elif isinstance(payload, list):
        for item in payload:
            found = _find_first_skin_temp_value(item)
            if found is not None:
                return found
    return None


def _fetch_dedicated_skin_temp(client: Any, date_str: str) -> float | None:
    """Try optional garminconnect endpoints for skin temperature."""
    for method_name in (
        "get_skin_temperature",
        "get_health_snapshot",
        "get_user_summary",
    ):
        method = getattr(client, method_name, None)
        if not callable(method):
            continue
        try:
            payload = _garmin_api_call(
                f"{method_name} skin temperature for {date_str}",
                method,
                date_str,
            )
        except Exception as e:
            print(f"  {method_name} skin temp unavailable for {date_str}: {e}")
            continue
        temp = _coerce_skin_temp(_find_first_skin_temp_value(payload))
        if temp is None:
            temp = _coerce_skin_temp(payload)
        if temp is not None:
            return temp
    return None


_BB_KEYS_LOGGED = False


def _extract_body_battery(stats, date_str):
    """Return (highest, lowest, current) body battery levels for the day.

    Garmin exposes the daily peak and trough under stable names, but the field
    holding the *latest* reading has varied between API versions, so try the
    known spellings in order. The first call logs which bodyBattery* keys the
    payload actually contains, so the candidate list can be trimmed to what
    this account really returns instead of guessed at.
    """
    global _BB_KEYS_LOGGED
    if not _BB_KEYS_LOGGED:
        present = {k: v for k, v in stats.items() if "bodyBattery" in k}
        print(f"  [body-battery] fields for {date_str}: {present}", file=sys.stderr)
        _BB_KEYS_LOGGED = True

    high = stats.get("bodyBatteryHighestValue")
    low = stats.get("bodyBatteryLowestValue")
    current = None
    for key in (
        "bodyBatteryMostRecentValue",
        "bodyBatteryCurrentValue",
        "currentBodyBattery",
        "bodyBatteryLatestValue",
    ):
        if stats.get(key) is not None:
            current = stats[key]
            break
    # Without a "latest" field the trough is the closest thing to a current
    # reading, since body battery only drains during waking hours.
    if current is None:
        current = low
    return high, low, current


def _extract_intraday(stress: Any, key: str) -> str | None:
    """Serialise one of the intraday arrays from the stress payload.

    ``get_stress_data()`` — already fetched for the daily stress average —
    also carries the minute-by-minute series that the energy-bank view is
    built from, so persisting them costs no extra API call. The two arrays
    do not share a shape:

        stressValuesArray:      [[epoch_millis, level], ...]
        bodyBatteryValuesArray: [[epoch_millis, status, level, version], ...]

    Both are normalised to ``[[epoch_millis, value], ...]``. Entries whose
    value is missing or negative are dropped, not interpolated: Garmin uses
    -1 and -2 in the stress series to mean "no usable reading", and the
    body-battery series carries status-only rows during gaps.
    """
    if not isinstance(stress, dict):
        return None
    raw = stress.get(key)
    if not isinstance(raw, list):
        return None

    points: list[list[float]] = []
    for entry in raw:
        if not isinstance(entry, (list, tuple)) or len(entry) < 2:
            continue
        ts = entry[0]
        if not isinstance(ts, (int, float)) or isinstance(ts, bool):
            continue
        # Body battery puts the level in the third slot, behind a status
        # string; stress puts it in the second.
        value = (
            entry[2]
            if len(entry) >= 3 and isinstance(entry[2], (int, float))
            else entry[1]
        )
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            continue
        if value < 0:
            continue
        points.append([int(ts), float(value)])

    return json.dumps(points) if points else None


def sync_daily_stats(client: Any, db: Any, date_str: str) -> bool:
    """Sync daily health stats for a given date."""
    cur = db.cursor()
    try:
        stats = _garmin_api_call(
            f"get_stats for {date_str}", client.get_stats, date_str
        )
        sleep_data = _garmin_api_call(
            f"get_sleep_data for {date_str}", client.get_sleep_data, date_str
        )
        hrv = _garmin_api_call(
            f"get_hrv_data for {date_str}", client.get_hrv_data, date_str
        )
        stress = _garmin_api_call(
            f"get_stress_data for {date_str}", client.get_stress_data, date_str
        )

        # Fetch SpO2, respiration, and body composition (gracefully handle API errors)
        spo2_data = None
        respiration_data = None
        body_comp_data = None
        try:
            spo2_data = _garmin_api_call(
                f"get_spo2_data for {date_str}", client.get_spo2_data, date_str
            )
        except Exception as e:
            print(f"  SpO2 data unavailable for {date_str}: {e}")
            logging.getLogger(__name__).debug("spo2 fetch failed: %s", e)
        try:
            respiration_data = _garmin_api_call(
                f"get_respiration_data for {date_str}",
                client.get_respiration_data,
                date_str,
            )
        except Exception as e:
            print(f"  Respiration data unavailable for {date_str}: {e}")
            logging.getLogger(__name__).debug("respiration fetch failed: %s", e)
        try:
            body_comp_data = _garmin_api_call(
                f"get_body_composition for {date_str}",
                client.get_body_composition,
                date_str,
            )
        except Exception as e:
            print(f"  Body composition data unavailable for {date_str}: {e}")
            logging.getLogger(__name__).debug("body composition fetch failed: %s", e)

        # Debug: log stress field names so we can verify data extraction
        stress_val = None
        if stress:
            stress_val = stress.get("avgStressLevel") or stress.get(
                "averageStressLevel"
            )
        if not stress_val and stats:
            stress_val = stats.get("averageStressLevel")
        if stress_val:
            print(f"  Stress score for {date_str}: {stress_val}")

        sleep_dto = sleep_data.get("dailySleepDTO", {}) if sleep_data else {}

        # Extract SpO2: prefer dedicated API, fall back to stats/sleep
        spo2_val = None
        if spo2_data:
            spo2_val = spo2_data.get("averageSpO2") or spo2_data.get("averageSpo2")
        if spo2_val is None and stats:
            spo2_val = stats.get("avgSpo2") or stats.get("averageSpo2")
        if spo2_val is None:
            spo2_val = sleep_dto.get("averageSpO2Value") if sleep_data else None

        # Extract respiration rate
        respiration_val = None
        if respiration_data:
            respiration_val = respiration_data.get(
                "avgWakingRespirationValue"
            ) or respiration_data.get("avgSleepRespirationValue")
        if respiration_val is None and stats:
            respiration_val = stats.get("respirationAvg")

        # Extract Garmin overnight skin/body temperature. Prefer sleep DTO
        # fields because they represent the overnight average.
        skin_temp_val = None
        for skin_temp_key in SKIN_TEMP_KEYS:
            skin_temp_val = _coerce_skin_temp(sleep_dto.get(skin_temp_key))
            if skin_temp_val is not None:
                break
        if skin_temp_val is None and stats:
            for skin_temp_key in SKIN_TEMP_KEYS:
                skin_temp_val = _coerce_skin_temp(stats.get(skin_temp_key))
                if skin_temp_val is not None:
                    break
        if skin_temp_val is None:
            skin_temp_val = _fetch_dedicated_skin_temp(client, date_str)
        if skin_temp_val is not None:
            print(f"  Skin temp for {date_str}: {skin_temp_val} °C")

        # Extract weight (kg) from body composition data
        weight_kg = None
        body_fat_pct = None
        if body_comp_data:
            # Garmin returns weight in grams; convert to kg
            weight_g = body_comp_data.get("weight")
            if weight_g and weight_g > 0:
                weight_kg = round(weight_g / 1000.0, 1)
            body_fat_pct = body_comp_data.get("bodyFat")
            if weight_kg:
                print(f"  Weight for {date_str}: {weight_kg} kg")

        # Compute data quality flag (percentage of key fields present)
        quality_fields = [
            stats.get("totalSteps"),
            stats.get("restingHeartRate"),
            _safe_sleep_minutes(sleep_dto, "sleepTimeSeconds"),
            sleep_dto.get("sleepScores", {}).get("overall", {}).get("value"),
            hrv.get("hrvSummary", {}).get("weeklyAvg") if hrv else None,
            stress_val,
            spo2_val,
            skin_temp_val,
            weight_kg,
        ]
        present = sum(1 for f in quality_fields if f is not None)
        data_quality = round(present / len(quality_fields) * 100)

        # Ensure unique constraint exists for upsert
        cur.execute("""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'daily_metric_user_date_uq'
                ) THEN
                    ALTER TABLE daily_metric
                        ADD CONSTRAINT daily_metric_user_date_uq
                        UNIQUE (user_id, date);
                END IF;
            END $$;
        """)

        bb_high, bb_low, bb_current = _extract_body_battery(stats, date_str)

        cur.execute(
            """
            INSERT INTO daily_metric (
                user_id, date, steps, calories, resting_hr, max_hr,
                total_sleep_minutes, deep_sleep_minutes, rem_sleep_minutes,
                light_sleep_minutes, awake_minutes, sleep_score,
                hrv, stress_score, body_battery_start, body_battery_end,
                body_battery_high, body_battery_low,
                floors_climbed, intensity_minutes,
                sleep_start_time, sleep_end_time, sleep_need_minutes, sleep_debt_minutes,
                spo2, respiration_rate, skin_temp,
                weight_kg, body_fat_pct,
                body_battery_intraday, stress_intraday,
                synced_at, data_quality
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, date) DO UPDATE SET
                steps = EXCLUDED.steps,
                calories = EXCLUDED.calories,
                resting_hr = EXCLUDED.resting_hr,
                max_hr = EXCLUDED.max_hr,
                total_sleep_minutes = EXCLUDED.total_sleep_minutes,
                deep_sleep_minutes = EXCLUDED.deep_sleep_minutes,
                rem_sleep_minutes = EXCLUDED.rem_sleep_minutes,
                light_sleep_minutes = EXCLUDED.light_sleep_minutes,
                awake_minutes = EXCLUDED.awake_minutes,
                sleep_score = EXCLUDED.sleep_score,
                hrv = EXCLUDED.hrv,
                stress_score = EXCLUDED.stress_score,
                body_battery_start = EXCLUDED.body_battery_start,
                body_battery_end = EXCLUDED.body_battery_end,
                body_battery_high = EXCLUDED.body_battery_high,
                body_battery_low = EXCLUDED.body_battery_low,
                floors_climbed = EXCLUDED.floors_climbed,
                intensity_minutes = EXCLUDED.intensity_minutes,
                sleep_start_time = COALESCE(EXCLUDED.sleep_start_time, daily_metric.sleep_start_time),
                sleep_end_time = COALESCE(EXCLUDED.sleep_end_time, daily_metric.sleep_end_time),
                sleep_need_minutes = COALESCE(EXCLUDED.sleep_need_minutes, daily_metric.sleep_need_minutes),
                sleep_debt_minutes = COALESCE(EXCLUDED.sleep_debt_minutes, daily_metric.sleep_debt_minutes),
                spo2 = COALESCE(EXCLUDED.spo2, daily_metric.spo2),
                respiration_rate = COALESCE(EXCLUDED.respiration_rate, daily_metric.respiration_rate),
                skin_temp = COALESCE(EXCLUDED.skin_temp, daily_metric.skin_temp),
                weight_kg = COALESCE(EXCLUDED.weight_kg, daily_metric.weight_kg),
                body_fat_pct = COALESCE(EXCLUDED.body_fat_pct, daily_metric.body_fat_pct),
                body_battery_intraday = COALESCE(EXCLUDED.body_battery_intraday, daily_metric.body_battery_intraday),
                stress_intraday = COALESCE(EXCLUDED.stress_intraday, daily_metric.stress_intraday),
                synced_at = EXCLUDED.synced_at,
                data_quality = EXCLUDED.data_quality
        """,
            (
                USER_ID,
                date_str,
                stats.get("totalSteps"),
                stats.get("totalKilocalories"),
                stats.get("restingHeartRate"),
                stats.get("maxHeartRate"),
                _safe_sleep_minutes(sleep_dto, "sleepTimeSeconds"),
                _safe_sleep_minutes(sleep_dto, "deepSleepSeconds"),
                _safe_sleep_minutes(sleep_dto, "remSleepSeconds"),
                _safe_sleep_minutes(sleep_dto, "lightSleepSeconds"),
                _safe_sleep_minutes(sleep_dto, "awakeSleepSeconds"),
                sleep_dto.get("sleepScores", {}).get("overall", {}).get("value"),
                hrv.get("hrvSummary", {}).get("weeklyAvg") if hrv else None,
                (
                    stress.get("avgStressLevel")
                    or stress.get("averageStressLevel")
                    or stats.get("averageStressLevel")
                )
                if stress
                else stats.get("averageStressLevel"),
                # bodyBatteryCharged/DrainedValue are the amounts gained and
                # lost over the day, not levels. Storing them as start/end made
                # a well-rested day (charged 80, drained 5) look like it ended
                # at 5, which drove the recovery and rest-day recommendations
                # the wrong way. Highest/Lowest are the actual levels.
                bb_high,
                bb_current,
                bb_high,
                bb_low,
                stats.get("floorsAscended"),
                stats.get("intensityMinutesGoal"),
                _extract_sleep_time(sleep_dto, "sleepStartTimestampLocal"),
                _extract_sleep_time(sleep_dto, "sleepEndTimestampLocal"),
                sleep_dto.get("sleepNeedInMinutes"),
                _compute_sleep_debt(sleep_dto),
                spo2_val,
                respiration_val,
                skin_temp_val,
                weight_kg,
                body_fat_pct,
                _extract_intraday(stress, "bodyBatteryValuesArray"),
                _extract_intraday(stress, "stressValuesArray"),
                datetime.now(timezone.utc).isoformat(),
                data_quality,
            ),
        )
        db.commit()
        print(f"  Synced daily stats for {date_str}")
        return True
    except Exception as e:
        db.rollback()
        print(f"  Failed to sync {date_str}: {e}", file=sys.stderr)
        return False
    finally:
        cur.close()


def backfill_skin_temp(client: Any, db: Any) -> None:
    """One-shot v0.17.1 re-sync for recent sleep days missing skin temperature."""
    marker = Path(SKIN_TEMP_BACKFILL_MARKER)
    if marker.exists():
        return

    cur = db.cursor()
    try:
        cur.execute(
            """
            SELECT date FROM daily_metric
            WHERE user_id = %s
              AND skin_temp IS NULL
              AND total_sleep_minutes IS NOT NULL
              AND date >= CURRENT_DATE - INTERVAL '90 days'
            ORDER BY date DESC
        """,
            (USER_ID,),
        )
        backfill_dates = [row[0] for row in cur.fetchall()]
    except Exception as e:
        db.rollback()
        print(f"  Skin temp backfill query failed: {e}", file=sys.stderr)
        return
    finally:
        cur.close()

    if backfill_dates:
        print(
            f"[skin-temp-backfill] Re-syncing {len(backfill_dates)} days "
            "for skin temperature"
        )
        all_synced = True
        for backfill_date in backfill_dates:
            date_str = (
                backfill_date.isoformat()
                if hasattr(backfill_date, "isoformat")
                else str(backfill_date)
            )
            all_synced = sync_daily_stats(client, db, date_str) and all_synced
        if not all_synced:
            print(
                "  Skin temp backfill incomplete; marker not written", file=sys.stderr
            )
            return

    try:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(datetime.now(timezone.utc).isoformat())
    except Exception as e:
        print(f"  Skin temp backfill marker write failed: {e}", file=sys.stderr)
        logging.getLogger(__name__).debug("skin temp marker write failed: %s", e)


def _normalize_started_at(act: dict) -> str | None:
    """Resolve an Activity's start time as an unambiguous UTC instant.

    Garmin's activity payload contains two start-time fields:

    * ``startTimeGMT`` — the real UTC instant of the activity, formatted
      as a TZ-naive string (e.g. ``"2026-05-17 09:00:00"``).
    * ``startTimeLocal`` — the same moment expressed in the watch's local
      time, also TZ-naive.

    Previously we stored ``startTimeLocal`` directly into a ``timestamptz``
    column. Postgres applies the session's ``TimeZone`` setting to a
    TZ-naive literal, so on a UTC-default Postgres the local string was
    *re-interpreted* as UTC. For any user east of UTC this shifted
    morning activities into the future and they were then filtered out
    by ``lte(Activity.startedAt, new Date())`` in the app layer — the
    "missing recent workouts" bug. See
    https://github.com/askb/ha-garmin-fitness-coach-addon/issues
    for context.

    Stamp ``startTimeGMT`` with an explicit ``+00:00`` so Postgres always
    treats it as UTC regardless of session TZ. Fall back to
    ``startTimeLocal`` only if ``startTimeGMT`` is missing (older Garmin
    activities occasionally lack it); the legacy behaviour is preserved
    as a last resort.
    """
    gmt = act.get("startTimeGMT")
    if isinstance(gmt, str) and gmt.strip():
        # Garmin currently returns "YYYY-MM-DD HH:MM:SS" with no offset.
        # Defensively detect a trailing offset / 'Z' so we never
        # double-stamp if a future Garmin build adds one. Match both
        # positive and negative offsets in the trailing tz-suffix
        # position (can't just look for '-' because the date contains
        # '-' separators).
        s = gmt.rstrip()
        if s.endswith("Z") or re.search(r"[+-]\d{2}:?\d{2}$", s):
            return s
        return f"{s}+00:00"
    local = act.get("startTimeLocal")
    return local if isinstance(local, str) else None


def _stride_length_metres(act: dict) -> float | None:
    """Garmin's ``avgStrideLength`` in metres.

    Garmin reports centimetres while the engine reads the column as metres,
    so every stride used to rate as "overstriding" at ~120 m. The magnitude
    guard keeps this correct if Garmin ever switches units: no human strides
    5 m, and no human strides 5 cm.
    """
    stride = act.get("avgStrideLength")
    if stride is None:
        return None
    return stride / 100 if stride > 5 else stride


def _upsert_activity(cur, act: dict, act_id: str) -> None:
    """Insert/update one Garmin activity row.

    Extracted from the inline loop in :func:`sync_activities` so a failure on a
    single row can be caught without aborting the entire batch.
    """
    hr_zones = None
    if act.get("hrTimeInZone_1") is not None:
        hr_zones = json.dumps(
            {
                "zone1": round((act.get("hrTimeInZone_1", 0) or 0) / 60, 1),
                "zone2": round((act.get("hrTimeInZone_2", 0) or 0) / 60, 1),
                "zone3": round((act.get("hrTimeInZone_3", 0) or 0) / 60, 1),
                "zone4": round((act.get("hrTimeInZone_4", 0) or 0) / 60, 1),
                "zone5": round((act.get("hrTimeInZone_5", 0) or 0) / 60, 1),
            }
        )

    avg_hr = act.get("averageHR")
    duration_min = (act.get("duration", 0) or 0) / 60
    trimp = None
    if avg_hr and duration_min > 0:
        hr_ratio = avg_hr / 200.0
        trimp = round(duration_min * hr_ratio * 0.64 * (1.92**hr_ratio), 1)

    avg_cadence = act.get("averageRunningCadenceInStepsPerMinute") or act.get(
        "averageBikingCadenceInRevPerMinute"
    )
    max_cadence = act.get("maxRunningCadenceInStepsPerMinute") or act.get(
        "maxBikingCadenceInRevPerMinute"
    )

    activity_type = act.get("activityType") or {}
    if not isinstance(activity_type, dict):
        activity_type = {}

    # Garmin reports averageSpeed in m/s; the column stores seconds per km as an
    # integer. Writing the raw speed made every pace read 2-5 instead of ~360,
    # which also fed the pace-derived zone model two orders of magnitude wrong.
    avg_speed_ms = act.get("averageSpeed")
    try:
        avg_pace_sec_per_km = (
            round(1000 / avg_speed_ms) if avg_speed_ms and avg_speed_ms > 0 else None
        )
    except (TypeError, ZeroDivisionError):
        avg_pace_sec_per_km = None

    # Running dynamics (present on running activity summaries; None otherwise).
    # Columns already exist in the Drizzle schema but were never populated.
    running_dynamics = (
        act.get("avgGroundContactTime"),  # ms
        act.get("avgGroundContactBalance"),  # % (L/R)
        act.get("avgVerticalOscillation"),  # cm
        act.get("avgVerticalRatio"),  # %
        _stride_length_metres(act),  # m
        act.get("avgRespirationRate"),  # brpm
        act.get("elevationGain"),  # m
        act.get("elevationLoss"),  # m
    )

    cur.execute(
        """
        INSERT INTO activity (
            user_id, garmin_activity_id, sport_type, sub_type,
            started_at, duration_minutes, distance_meters,
            avg_hr, max_hr, calories, avg_pace_sec_per_km,
            aerobic_te, anaerobic_te, hr_zone_minutes,
            trimp_score, strain_score,
            avg_power, normalized_power, max_power,
            avg_cadence, max_cadence,
            avg_ground_contact_time, gct_balance,
            vertical_oscillation, vertical_ratio, stride_length,
            avg_respiration_rate, elevation_gain, elevation_loss,
            synced_at, raw_garmin_data
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (garmin_activity_id) DO UPDATE SET
            hr_zone_minutes = COALESCE(EXCLUDED.hr_zone_minutes, activity.hr_zone_minutes),
            trimp_score = COALESCE(EXCLUDED.trimp_score, activity.trimp_score),
            strain_score = COALESCE(EXCLUDED.strain_score, activity.strain_score),
            avg_power = COALESCE(EXCLUDED.avg_power, activity.avg_power),
            normalized_power = COALESCE(EXCLUDED.normalized_power, activity.normalized_power),
            max_power = COALESCE(EXCLUDED.max_power, activity.max_power),
            avg_cadence = COALESCE(EXCLUDED.avg_cadence, activity.avg_cadence),
            max_cadence = COALESCE(EXCLUDED.max_cadence, activity.max_cadence),
            avg_ground_contact_time = COALESCE(EXCLUDED.avg_ground_contact_time, activity.avg_ground_contact_time),
            gct_balance = COALESCE(EXCLUDED.gct_balance, activity.gct_balance),
            vertical_oscillation = COALESCE(EXCLUDED.vertical_oscillation, activity.vertical_oscillation),
            vertical_ratio = COALESCE(EXCLUDED.vertical_ratio, activity.vertical_ratio),
            stride_length = COALESCE(EXCLUDED.stride_length, activity.stride_length),
            avg_respiration_rate = COALESCE(EXCLUDED.avg_respiration_rate, activity.avg_respiration_rate),
            elevation_gain = COALESCE(EXCLUDED.elevation_gain, activity.elevation_gain),
            elevation_loss = COALESCE(EXCLUDED.elevation_loss, activity.elevation_loss),
            synced_at = EXCLUDED.synced_at,
            raw_garmin_data = EXCLUDED.raw_garmin_data
    """,
        (
            USER_ID,
            act_id,
            activity_type.get("typeKey", "other"),
            activity_type.get("typeId", ""),
            _normalize_started_at(act),
            duration_min,
            act.get("distance"),
            avg_hr,
            act.get("maxHR"),
            act.get("calories"),
            avg_pace_sec_per_km,
            act.get("aerobicTrainingEffect"),
            act.get("anaerobicTrainingEffect"),
            hr_zones,
            trimp,
            act.get("activityTrainingLoad"),
            act.get("averagePower"),
            act.get("normPower"),
            act.get("maxPower"),
            avg_cadence,
            max_cadence,
            *running_dynamics,
            datetime.now(timezone.utc).isoformat(),
            json.dumps(act),
        ),
    )


def sync_activities(client, db, days=7):
    """Sync activities, fetching in batches of 100."""
    cur = db.cursor()
    try:
        # Ensure unique constraint exists for upsert
        cur.execute("""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'activity_garmin_id_uq'
                ) THEN
                    ALTER TABLE activity
                        ADD CONSTRAINT activity_garmin_id_uq
                        UNIQUE (garmin_activity_id);
                END IF;
            END $$;
        """)

        total = 0
        skipped = 0
        batch_size = 100
        start = 0
        while True:
            try:
                activities = _garmin_api_call(
                    f"get_activities start={start} limit={batch_size}",
                    client.get_activities,
                    start,
                    batch_size,
                )
            except Exception as fetch_exc:
                print(
                    f"  get_activities(start={start}, "
                    f"limit={batch_size}) failed: "
                    f"{type(fetch_exc).__name__}: {fetch_exc}",
                    file=sys.stderr,
                )
                raise

            # Defensive: garminconnect occasionally wraps responses as
            # [[{...}, {...}]] (single-element list of a list). Unwrap so the
            # iteration below doesn't blow up silently on AttributeError.
            if (
                isinstance(activities, list)
                and len(activities) == 1
                and isinstance(activities[0], list)
            ):
                activities = activities[0]
            if not isinstance(activities, list):
                print(
                    f"  Unexpected activities shape from Garmin API: "
                    f"{type(activities).__name__} — skipping batch",
                    file=sys.stderr,
                )
                break
            if not activities:
                break

            batch_skipped = 0
            for act in activities:
                if not isinstance(act, dict):
                    batch_skipped += 1
                    skipped += 1
                    print(
                        f"  Skipping non-dict activity entry: {type(act).__name__}",
                        file=sys.stderr,
                    )
                    continue
                act_id_raw = act.get("activityId")
                act_id = str(act_id_raw) if act_id_raw not in (None, "") else ""
                if not act_id:
                    batch_skipped += 1
                    skipped += 1
                    print(
                        "  Skipping activity with no activityId",
                        file=sys.stderr,
                    )
                    continue
                try:
                    cur.execute("SAVEPOINT activity_upsert")
                    _upsert_activity(cur, act, act_id)
                    cur.execute("RELEASE SAVEPOINT activity_upsert")
                except Exception as row_exc:
                    batch_skipped += 1
                    skipped += 1
                    print(
                        f"  Failed to upsert activity {act_id}: "
                        f"{type(row_exc).__name__}: {row_exc}",
                        file=sys.stderr,
                    )
                    # Roll back to the per-row savepoint so successful upserts
                    # earlier in this batch are preserved.
                    try:
                        cur.execute("ROLLBACK TO SAVEPOINT activity_upsert")
                    except Exception:
                        # If the savepoint is gone (e.g., connection-level
                        # error), fall back to a full rollback for safety.
                        db.rollback()
                    continue
            db.commit()
            inserted_this_batch = len(activities) - batch_skipped
            total += inserted_this_batch
            print(
                f"  Synced batch: {len(activities)} activities "
                f"(total: {total}, skipped: {skipped})"
            )

            if len(activities) < batch_size:
                break
            start += batch_size

            # Incremental syncs: stop after enough recent activities
            if days <= 30 and total >= 50:
                break

        # Repair rows written before stride length was normalised to metres.
        # Idempotent: a metre value is never above 5.
        cur.execute(
            "UPDATE activity SET stride_length = stride_length / 100 "
            "WHERE user_id = %s AND stride_length > 5",
            (USER_ID,),
        )
        if cur.rowcount:
            print(f"  Converted {cur.rowcount} stride_length values cm → m")
        db.commit()

        print(f"  Synced {total} activities total")
    except Exception as e:
        db.rollback()
        print(f"  Failed to sync activities: {e}", file=sys.stderr)
    finally:
        cur.close()


def backfill_activity_started_at_utc(db):
    """One-time migration: re-stamp Activity.started_at using startTimeGMT.

    Earlier sync code stored ``startTimeLocal`` (TZ-naive) into a
    ``timestamptz`` column. Postgres interpreted the literal in the
    session's TimeZone (UTC by default for the HA Postgres base
    image), so morning activities for users east of UTC ended up
    timestamped in the *future* and were filtered out of the home
    page by ``lte(Activity.startedAt, new Date())``.

    Re-derive every row's start instant from ``raw_garmin_data->>
    'startTimeGMT'`` (always the true UTC moment) and stamp it
    explicitly with ``+00:00``. Idempotent: rows that already match
    the GMT field are left untouched.

    Guarded by a marker file in ``TOKEN_DIR`` so the migration only
    runs once per install. Set ``PACER_REBACKFILL_STARTED_AT=1``
    to force a re-run (useful for support / testing).
    """
    marker = os.path.join(TOKEN_DIR, ".activity_started_at_utc_backfill_done")
    if os.path.exists(marker) and not os.environ.get(
        "PACER_REBACKFILL_STARTED_AT"
    ):
        return

    cur = db.cursor()
    try:
        cur.execute(
            """
            UPDATE activity SET
                started_at = ((raw_garmin_data->>'startTimeGMT') || '+00:00')::timestamptz
            WHERE user_id = %s
              AND raw_garmin_data IS NOT NULL
              AND raw_garmin_data ? 'startTimeGMT'
              AND (raw_garmin_data->>'startTimeGMT') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'
              AND started_at <> ((raw_garmin_data->>'startTimeGMT') || '+00:00')::timestamptz
            """,
            (USER_ID,),
        )
        updated = cur.rowcount
        db.commit()
        if updated:
            print(
                f"  Re-stamped {updated} activities to UTC from "
                f"raw_garmin_data.startTimeGMT (TZ-correctness backfill)"
            )
        try:
            with open(marker, "w") as f:
                f.write(datetime.now(timezone.utc).isoformat())
        except OSError as e:
            print(
                f"  Warning: could not write backfill marker {marker}: {e}",
                file=sys.stderr,
            )
            logging.getLogger(__name__).debug("activity backfill marker failed: %s", e)
    except Exception as e:
        db.rollback()
        print(
            f"  Activity started_at UTC backfill failed: {e}",
            file=sys.stderr,
        )
    finally:
        cur.close()


def backfill_from_raw_json(db):
    """Extract hr_zone_minutes, strain_score, trimp_score from stored raw_garmin_data."""
    cur = db.cursor()
    try:
        cur.execute(
            """
            SELECT id, raw_garmin_data, avg_hr, duration_minutes
            FROM activity
            WHERE user_id = %s
              AND raw_garmin_data IS NOT NULL
              AND (hr_zone_minutes IS NULL OR strain_score IS NULL)
        """,
            (USER_ID,),
        )
        rows = cur.fetchall()
        if not rows:
            return

        updated = 0
        # Pre-fetch latest resting HR to avoid N+1 query in activity loop
        cached_resting_hr = 60  # fallback
        try:
            cur.execute(
                """
                SELECT resting_hr FROM daily_metric
                WHERE user_id = %s AND resting_hr IS NOT NULL
                ORDER BY date DESC LIMIT 1
            """,
                (USER_ID,),
            )
            rhr_row = cur.fetchone()
            if rhr_row:
                cached_resting_hr = (
                    rhr_row[0]
                    if isinstance(rhr_row, tuple)
                    else rhr_row.get("resting_hr")
                )
        except Exception as exc:
            logging.getLogger(__name__).debug("resting HR lookup failed: %s", exc)

        for row_id, raw_json, avg_hr, duration_min in rows:
            act = json.loads(raw_json) if isinstance(raw_json, str) else raw_json

            # Extract HR zones (seconds → minutes)
            hr_zones = None
            z1 = act.get("hrTimeInZone_1")
            if z1 is not None:
                hr_zones = json.dumps(
                    {
                        "zone1": round((act.get("hrTimeInZone_1", 0) or 0) / 60, 1),
                        "zone2": round((act.get("hrTimeInZone_2", 0) or 0) / 60, 1),
                        "zone3": round((act.get("hrTimeInZone_3", 0) or 0) / 60, 1),
                        "zone4": round((act.get("hrTimeInZone_4", 0) or 0) / 60, 1),
                        "zone5": round((act.get("hrTimeInZone_5", 0) or 0) / 60, 1),
                    }
                )

            # Garmin training load
            strain = act.get("activityTrainingLoad")

            # Compute TRIMP using Banister (1991) formula with resting HR
            trimp = None
            if avg_hr and duration_min and duration_min > 0:
                resting_hr = cached_resting_hr
                max_hr = 220 - 30  # conservative estimate; user profile ideal
                delta_ratio = (avg_hr - resting_hr) / max(1, max_hr - resting_hr)
                delta_ratio = max(0, min(1, delta_ratio))
                k = 1.92  # male constant (Banister)
                trimp = round(duration_min * delta_ratio * math.exp(k * delta_ratio), 1)

            if hr_zones or strain or trimp:
                cur.execute(
                    """
                    UPDATE activity SET
                        hr_zone_minutes = COALESCE(%s, hr_zone_minutes),
                        strain_score = COALESCE(%s, strain_score),
                        trimp_score = COALESCE(%s, trimp_score)
                    WHERE id = %s
                """,
                    (hr_zones, strain, trimp, row_id),
                )
                updated += 1

        db.commit()
        if updated:
            print(f"  Backfilled {updated} activities with zones/strain/TRIMP")
    except Exception as e:
        db.rollback()
        print(f"  Backfill failed: {e}", file=sys.stderr)
    finally:
        cur.close()


def backfill_stress_and_sleep(client, db):
    """One-time backfill: re-fetch stress and sleep timing for dates with NULL values."""
    MARKER = os.path.join(TOKEN_DIR, ".stress_sleep_backfill_done")
    if os.path.exists(MARKER):
        return

    cur = db.cursor()
    try:
        cur.execute(
            """
            SELECT date FROM daily_metric
            WHERE user_id = %s
              AND (stress_score IS NULL OR sleep_start_time IS NULL)
            ORDER BY date DESC
            LIMIT 365
        """,
            (USER_ID,),
        )
        dates = [row[0] for row in cur.fetchall()]
        if not dates:
            Path(MARKER).touch()
            return

        print(f"  Backfilling stress/sleep for {len(dates)} dates...")
        filled = 0
        for date_str in dates:
            try:
                stress = _garmin_api_call(
                    f"get_stress_data for {date_str}",
                    client.get_stress_data,
                    date_str,
                )
                sleep_data = _garmin_api_call(
                    f"get_sleep_data for {date_str}",
                    client.get_sleep_data,
                    date_str,
                )
                stats = _garmin_api_call(
                    f"get_stats for {date_str}", client.get_stats, date_str
                )
                sleep_dto = sleep_data.get("dailySleepDTO", {}) if sleep_data else {}

                stress_val = None
                if stress:
                    stress_val = stress.get("avgStressLevel") or stress.get(
                        "averageStressLevel"
                    )
                if not stress_val and stats:
                    stress_val = stats.get("averageStressLevel")

                sleep_start = _extract_sleep_time(sleep_dto, "sleepStartTimestampLocal")
                sleep_end = _extract_sleep_time(sleep_dto, "sleepEndTimestampLocal")
                sleep_need = sleep_dto.get("sleepNeedInMinutes")
                sleep_debt = _compute_sleep_debt(sleep_dto)

                cur.execute(
                    """
                    UPDATE daily_metric SET
                        stress_score = COALESCE(%s, stress_score),
                        sleep_start_time = COALESCE(%s, sleep_start_time),
                        sleep_end_time = COALESCE(%s, sleep_end_time),
                        sleep_need_minutes = COALESCE(%s, sleep_need_minutes),
                        sleep_debt_minutes = COALESCE(%s, sleep_debt_minutes)
                    WHERE user_id = %s AND date = %s
                """,
                    (
                        stress_val,
                        sleep_start,
                        sleep_end,
                        sleep_need,
                        sleep_debt,
                        USER_ID,
                        date_str,
                    ),
                )
                if stress_val or sleep_start:
                    filled += 1
            except Exception as exc:
                logging.getLogger(__name__).debug("raw backfill date failed: %s", exc)

        db.commit()
        Path(MARKER).touch()
        print(f"  Backfilled stress/sleep for {filled}/{len(dates)} dates")
    except Exception as e:
        db.rollback()
        print(f"  Stress/sleep backfill failed: {e}", file=sys.stderr)
    finally:
        cur.close()


def sync_vo2max(client, db, days=7):
    """Sync VO2max from Garmin's official max-metrics API, with computed fallback."""
    cur = db.cursor()
    try:
        # Ensure unique constraint exists for upsert
        cur.execute("""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'vo2max_estimate_user_date_sport_uq'
                ) THEN
                    ALTER TABLE vo2max_estimate
                        ADD CONSTRAINT vo2max_estimate_user_date_sport_uq
                        UNIQUE (user_id, date, sport);
                END IF;
            END $$;
        """)

        # Note: we no longer bulk-delete computed records. The per-date
        # fallback logic below uses ON CONFLICT to update only dates that
        # lack official Garmin data, preserving existing Uth estimates for
        # historical dates outside the current sync window.
        db.commit()

        cutoff = _user_today() - timedelta(days=days)
        today = _user_today()

        # --- Primary: Garmin's official VO2max from max-metrics API ---
        garmin_count = 0
        api_failures: dict[str, int] = {}  # error class name -> count
        api_failure_examples: dict[str, str] = {}  # error class name -> first message
        dates_with_data = 0
        dates_queried = 0
        try:
            d = cutoff
            while d <= today:
                date_str = d.isoformat()
                dates_queried += 1
                try:
                    metrics = _garmin_api_call(
                        f"get_max_metrics for {date_str}",
                        client.get_max_metrics,
                        date_str,
                    )
                except Exception as exc:
                    # Used to silently swallow ALL per-date failures, which
                    # made it impossible to tell from logs whether sparse
                    # VO2max data was 'no qualifying run' (Garmin returned
                    # []) vs an API outage / rate-limit / token issue.
                    # Track per-class counts so the summary line below
                    # surfaces it (#163 follow-up).
                    cls = type(exc).__name__
                    api_failures[cls] = api_failures.get(cls, 0) + 1
                    if cls not in api_failure_examples:
                        api_failure_examples[cls] = str(exc)[:200]
                    d += timedelta(days=1)
                    continue

                if not metrics:
                    d += timedelta(days=1)
                    continue

                # get_max_metrics returns a list of metric entries
                entries = metrics if isinstance(metrics, list) else [metrics]
                inserted_for_date = 0
                for entry in entries:
                    vo2 = entry.get("generic", {}).get(
                        "vo2MaxPreciseValue"
                    ) or entry.get("generic", {}).get("vo2MaxValue")
                    sport = "general"

                    if not vo2:
                        # Try cycling-specific
                        vo2 = entry.get("cycling", {}).get(
                            "vo2MaxPreciseValue"
                        ) or entry.get("cycling", {}).get("vo2MaxValue")
                        if vo2:
                            sport = "cycling"

                    if not vo2:
                        continue

                    vo2 = float(vo2)
                    if vo2 < 10 or vo2 > 90:
                        continue

                    metric_date = entry.get("calendarDate", date_str)
                    cur.execute(
                        """
                        INSERT INTO vo2max_estimate (
                            user_id, date, sport, value, source
                        ) VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (user_id, date, sport) DO UPDATE SET
                            value = EXCLUDED.value,
                            source = EXCLUDED.source
                    """,
                        (USER_ID, metric_date, sport, round(vo2, 1), "garmin_official"),
                    )
                    garmin_count += 1
                    inserted_for_date += 1

                if inserted_for_date > 0:
                    dates_with_data += 1
                if garmin_count % 50 == 0 and garmin_count > 0:
                    db.commit()
                d += timedelta(days=1)

            db.commit()

            # Surface API-call statistics. Even if `garmin_count` is
            # high this still tells us 'X of N dates threw' which is
            # the signal we were missing when a user reported sparse
            # data on 2026-05-22.
            if api_failures:
                total_fail = sum(api_failures.values())
                breakdown = ", ".join(
                    f"{cls}: {n} (e.g. {api_failure_examples[cls]!r})"
                    for cls, n in sorted(api_failures.items())
                )
                print(
                    f"  Garmin max-metrics: {dates_queried} dates queried, "
                    f"{dates_with_data} returned data, "
                    f"{total_fail} threw — {breakdown}",
                    file=sys.stderr,
                )
            else:
                print(
                    f"  Garmin max-metrics: {dates_queried} dates queried, "
                    f"{dates_with_data} returned VO2max readings"
                )
        except Exception as e:
            print(f"  Garmin max-metrics API failed: {e} — falling back to computed")
            db.rollback()

        # --- Fallback: computed VO2max only for dates missing official data ---
        # Only compute Uth estimates for specific dates where the Garmin API
        # returned no data, rather than the previous all-or-nothing approach.
        # This prevents overwriting good official data when the API partially fails.
        cur2 = db.cursor()
        try:
            # Find dates in the sync window that have no garmin_official record
            cur2.execute(
                """
                SELECT dm.date, dm.resting_hr
                FROM daily_metric dm
                WHERE dm.user_id = %s AND dm.date >= %s
                  AND dm.resting_hr IS NOT NULL AND dm.resting_hr > 30
                  AND dm.resting_hr <= 100
                  AND NOT EXISTS (
                      SELECT 1 FROM vo2max_estimate ve
                      WHERE ve.user_id = dm.user_id
                        AND ve.date = dm.date
                        AND ve.source = 'garmin_official'
                  )
                ORDER BY dm.date DESC
            """,
                (USER_ID, cutoff.isoformat()),
            )

            # Use fetchmany() batching to handle large sync windows gracefully
            missing_dates: list[tuple] = []
            while True:
                rows = cur2.fetchmany(500)
                if not rows:
                    break
                missing_dates.extend(rows)

            uth_count = 0

            if missing_dates:
                # Fetch user age for age-predicted max HR
                cur2.execute("SELECT age FROM profile WHERE user_id = %s", (USER_ID,))
                age_row = cur2.fetchone()
                user_age = age_row[0] if age_row and age_row[0] else 35
                if not (age_row and age_row[0]):
                    print("  No age in profile — using default age=35")

                # Tanaka formula (2001) for HRmax: more accurate than 220-age
                # Ref: Tanaka H et al. Age-predicted maximal heart rate revisited.
                #      J Am Coll Cardiol. 2001;37(1):153-156.
                # 220-age has SD ±10-12 bpm; Tanaka reduces error significantly.
                age_predicted_max_hr = 208 - (0.7 * user_age)

                # Age-corrected Uth proportionality factor.
                # Original Uth et al. (2004) used 15.3 but this was validated ONLY
                # on well-trained men aged 21-51 (N=46).
                # Ref: PMC8443998 (2021) — factor decreases inversely with age:
                #   Age 20-35: ~15.3 (original)
                #   Age 35-45: ~13.5
                #   Age 45-55: ~12.5
                #   Age 55+:   ~11.5
                # Using 15.3 for a 45-year-old overestimates VO2max by ~18%.
                if user_age <= 35:
                    uth_factor = 15.3
                elif user_age <= 45:
                    uth_factor = 13.5
                elif user_age <= 55:
                    uth_factor = 12.5
                else:
                    uth_factor = 11.5

                print(
                    f"  Uth fallback: age={user_age}, HRmax={age_predicted_max_hr:.0f}, factor={uth_factor}"
                )

                for d_date, resting_hr in missing_dates:
                    vo2 = uth_factor * (age_predicted_max_hr / resting_hr)
                    if vo2 < 20 or vo2 > 90:
                        continue
                    cur2.execute(
                        """
                        INSERT INTO vo2max_estimate (
                            user_id, date, sport, value, source
                        ) VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (user_id, date, sport) DO UPDATE SET
                            value = EXCLUDED.value, source = EXCLUDED.source
                    """,
                        (USER_ID, d_date, "general", round(vo2, 1), "uth_method"),
                    )
                    uth_count += 1
                db.commit()

            print(
                f"  VO2max: {garmin_count} official Garmin records, "
                f"{uth_count} Uth fallback estimates "
                f"(for dates without official data)"
            )
        finally:
            cur2.close()
    except Exception as e:
        db.rollback()
        print(f"  Failed to sync VO2max: {e}", file=sys.stderr)
    finally:
        cur.close()


def _first_dict(data):
    """Coerce a Garmin Connect response into a single dict or None.

    Some `garminconnect` endpoints (notably `get_training_readiness` and
    `get_training_status` since the library bumped past 0.2.x) now return
    a `list[dict]` of one element instead of a plain `dict`. Calling
    `.get(...)` directly on a list raises `AttributeError: 'list' object
    has no attribute 'get'`, which the wider try/except in the sync
    helpers swallowed silently — leaving the affected columns NULL for
    every synced day. Normalise here so each caller can treat the result
    as a dict (or `None` when the day genuinely has no data).
    """
    if data is None:
        return None
    if isinstance(data, dict):
        return data
    if isinstance(data, list):
        for entry in data:
            if isinstance(entry, dict) and entry:
                return entry
        return None
    return None


def sync_training_readiness(client, db, days=7):
    """Sync Garmin Training Readiness score and contributing factors."""
    cur = db.cursor()
    try:
        today = _user_today()
        synced = 0
        for days_ago in range(days):
            date_str = (today - timedelta(days=days_ago)).isoformat()
            try:
                data = _first_dict(
                    _garmin_api_call(
                        f"get_training_readiness for {date_str}",
                        client.get_training_readiness,
                        date_str,
                    )
                )
                if not data:
                    continue

                score = data.get("score")
                if score is None:
                    score = data.get("readinessScore")
                level = data.get("level") or data.get("readinessLevel", "")
                if score is None:
                    continue

                # Training Readiness is defined on a 0-100 scale. Garmin
                # occasionally returns malformed payloads (e.g. 130, 530)
                # that would otherwise corrupt the validation/agreement
                # metrics downstream. Reject physiologically-impossible
                # values rather than storing them (mirrors the vo2max guard).
                try:
                    score = float(score)
                except (TypeError, ValueError):
                    continue
                if not math.isfinite(score) or not 0 <= score <= 100:
                    print(
                        f"  Skipping out-of-range readiness {score} "
                        f"for {date_str} (expected 0-100)",
                        file=sys.stderr,
                    )
                    continue

                # Extract contributing factors (Garmin's 6-factor breakdown)
                factors = {}
                for key in [
                    "sleepScore",
                    "recoveryTime",
                    "hrvStatus",
                    "acuteLoad",
                    "stressHistory",
                    "bodyBattery",
                    "sleepHistory",
                ]:
                    val = data.get(key)
                    if val is not None:
                        factors[key] = val

                # Recovery time is reported in minutes inside the readiness
                # payload itself. Convert to hours so the Garmin Native
                # (Firstbeat) card and downstream consumers can render it
                # even when get_training_status() comes back empty (which is
                # the common case until Garmin has computed Firstbeat status
                # from enough recent activity).
                recovery_minutes = data.get("recoveryTime")
                recovery_hours = (
                    round(recovery_minutes / 60.0, 1)
                    if isinstance(recovery_minutes, (int, float))
                    and recovery_minutes >= 0
                    else None
                )

                cur.execute(
                    """
                    INSERT INTO daily_metric (user_id, date)
                    VALUES (%s, %s)
                    ON CONFLICT (user_id, date) DO NOTHING
                """,
                    (USER_ID, date_str),
                )

                cur.execute(
                    """
                    UPDATE daily_metric SET
                        garmin_training_readiness = %s,
                        garmin_training_readiness_level = %s,
                        garmin_readiness_factors = %s,
                        garmin_recovery_hours = COALESCE(%s, garmin_recovery_hours)
                    WHERE user_id = %s AND date = %s
                """,
                    (
                        round(score),
                        level.lower() if isinstance(level, str) else str(level),
                        json.dumps(factors) if factors else None,
                        recovery_hours,
                        USER_ID,
                        date_str,
                    ),
                )
                synced += 1
            except Exception as e:
                print(f"  Training readiness unavailable for {date_str}: {e}")
                continue

        db.commit()
        if synced:
            print(f"  Synced training readiness for {synced} days")
    except Exception as e:
        db.rollback()
        print(f"  Failed to sync training readiness: {e}", file=sys.stderr)
    finally:
        cur.close()


def sync_training_status(client, db, days=7):
    """Sync Garmin Training Status (Productive/Peaking/Overreaching etc)."""
    cur = db.cursor()
    try:
        today = _user_today()
        synced = 0
        for days_ago in range(days):
            date_str = (today - timedelta(days=days_ago)).isoformat()
            try:
                data = _first_dict(
                    _garmin_api_call(
                        f"get_training_status for {date_str}",
                        client.get_training_status,
                        date_str,
                    )
                )
                if not data:
                    continue

                # The endpoint returns a flat top-level dict whose meaningful
                # payload lives in nested DTOs:
                #   {
                #     "userId": ...,
                #     "mostRecentTrainingStatus": {...} | null,
                #     "mostRecentTrainingLoadBalance": {...} | null,
                #     "mostRecentVO2Max": {...} | null,
                #     "heatAltitudeAcclimationDTO": {...} | null,
                #   }
                # Garmin only populates these once the watch has computed
                # Firstbeat status (typically needs ~7 days of structured
                # activity). When they're null we just leave the columns
                # alone — `garmin_recovery_hours` is filled from the
                # readiness payload instead (see sync_training_readiness).
                status_dto = data.get("mostRecentTrainingStatus") or {}
                load_dto = data.get("mostRecentTrainingLoadBalance") or {}

                # mostRecentTrainingStatus is itself wrapped — the actual
                # per-device payload sits under
                # latestTrainingStatusData.<deviceId>.
                inner_status = {}
                if isinstance(status_dto, dict):
                    latest = status_dto.get("latestTrainingStatusData") or {}
                    if isinstance(latest, dict) and latest:
                        # Pick the first (and usually only) device entry.
                        for v in latest.values():
                            if isinstance(v, dict):
                                inner_status = v
                                break

                status = (
                    inner_status.get("trainingStatus")
                    or inner_status.get("trainingStatusFeedbackPhrase")
                    # Legacy/flat shapes seen on older library versions.
                    or data.get("trainingStatus")
                    or data.get("status")
                    or ""
                )
                load_focus = (
                    inner_status.get("trainingLoadFocus")
                    or (
                        load_dto.get("trainingLoadFocus")
                        if isinstance(load_dto, dict)
                        else None
                    )
                    or data.get("trainingLoadFocus")
                    or data.get("loadFocus")
                )

                # Load distribution lives on the load-balance DTO when present.
                load_dist = {}
                load_source = (
                    load_dto if isinstance(load_dto, dict) and load_dto else data
                )
                for key in [
                    "lowAerobicTrainingLoad",
                    "highAerobicTrainingLoad",
                    "anaerobicTrainingLoad",
                    "lowAerobicTrainingLoadPercentage",
                    "highAerobicTrainingLoadPercentage",
                    "anaerobicTrainingLoadPercentage",
                ]:
                    val = load_source.get(key)
                    if val is not None:
                        load_dist[key] = val

                # Use explicit None-check (not `or`) so a fully-recovered
                # user's `recoveryTime == 0` isn't discarded as "missing".
                recovery_min = inner_status.get("recoveryTime")
                if recovery_min is None:
                    recovery_min = data.get("recoveryTimeInMinutes")
                recovery_hrs = (
                    round(recovery_min / 60.0, 1)
                    if isinstance(recovery_min, (int, float)) and recovery_min >= 0
                    else None
                )

                if (
                    not status
                    and not load_focus
                    and recovery_hrs is None
                    and not load_dist
                ):
                    continue

                cur.execute(
                    """
                    INSERT INTO daily_metric (user_id, date)
                    VALUES (%s, %s)
                    ON CONFLICT (user_id, date) DO NOTHING
                """,
                    (USER_ID, date_str),
                )

                cur.execute(
                    """
                    UPDATE daily_metric SET
                        garmin_training_status = COALESCE(%s, garmin_training_status),
                        garmin_load_focus = COALESCE(%s, garmin_load_focus),
                        garmin_recovery_hours = COALESCE(%s, garmin_recovery_hours)
                    WHERE user_id = %s AND date = %s
                """,
                    (
                        str(status).upper() if status else None,
                        json.dumps(load_dist) if load_dist else None,
                        recovery_hrs,
                        USER_ID,
                        date_str,
                    ),
                )
                synced += 1
            except Exception as e:
                print(f"  Training status unavailable for {date_str}: {e}")
                continue

        db.commit()
        if synced:
            print(f"  Synced training status for {synced} days")
    except Exception as e:
        db.rollback()
        print(f"  Failed to sync training status: {e}", file=sys.stderr)
    finally:
        cur.close()


# ---------------------------------------------------------------------------
# Raw Garmin landing table
#
# Garmin exposes far more than the eleven endpoints this sync historically
# consumed, and hand-writing a column per field would mean a schema change
# every time we want to look at something new. Instead every response lands
# verbatim in ``garmin_raw`` keyed by (endpoint, scope); typed columns are
# lifted out of it only for what the engine or the UI actually reads.
#
# Adding an endpoint is one line in the tables below.
# ---------------------------------------------------------------------------

# Daily endpoints — all take a single ``cdate`` string.
DAILY_RAW_ENDPOINTS = (
    ("body_battery_events", "get_body_battery_events"),
    ("steps_intraday", "get_steps_data"),
    ("floors", "get_floors"),
    ("heart_rates", "get_heart_rates"),
    ("intensity_minutes", "get_intensity_minutes_data"),
    ("all_day_stress", "get_all_day_stress"),
    ("all_day_events", "get_all_day_events"),
    ("rhr_day", "get_rhr_day"),
    ("hydration", "get_hydration_data"),
    ("daily_weigh_ins", "get_daily_weigh_ins"),
    ("lifestyle_logging", "get_lifestyle_logging_data"),
    ("morning_readiness", "get_morning_training_readiness"),
    ("fitness_age", "get_fitnessage_data"),
)

# Per-activity endpoints — all take a single ``activity_id``. Ordered cheapest
# first so a rate-limit cut-off still leaves the useful small payloads behind.
ACTIVITY_RAW_ENDPOINTS = (
    ("activity_full", "get_activity"),
    ("activity_splits", "get_activity_splits"),
    ("activity_split_summaries", "get_activity_split_summaries"),
    ("activity_typed_splits", "get_activity_typed_splits"),
    ("activity_weather", "get_activity_weather"),
    ("activity_hr_zones", "get_activity_hr_in_timezones"),
    ("activity_exercise_sets", "get_activity_exercise_sets"),
    ("activity_gear", "get_activity_gear"),
)

# The daily raw endpoints run over their own rolling window, deliberately
# decoupled from the sync window. The first sync covers every day back to
# 2019 — around 2,400 of them — and thirteen extra requests per day would be
# some 31,000 calls in one run. Garmin rate-limits long before that, the
# backoff turns the run into a multi-day crawl, and the backfill marker is
# only written after a clean pass, so it would retry that forever.
RAW_DAILY_DAYS = int(_env_float("GARMIN_RAW_DAILY_DAYS", 30))

# Days this recent are re-fetched every run: a watch that syncs in the evening
# fills in yesterday, and Garmin revises the previous night's sleep and stress
# after the fact. Older days inside the window are fetched once and left alone,
# which is what keeps the steady state at a few dozen requests instead of
# thirteen endpoints times the whole window, every hour, forever.
RAW_DAILY_REFRESH_DAYS = int(_env_float("GARMIN_RAW_DAILY_REFRESH_DAYS", 3))

# How much per-activity time series to keep. The series is a few MB per
# activity and the database is backed up to /share/, so this is a knob rather
# than a constant.
ACTIVITY_DETAIL_DAYS = int(_env_float("GARMIN_ACTIVITY_DETAIL_DAYS", 90))
ACTIVITY_DETAIL_MAX_PER_RUN = int(_env_float("GARMIN_ACTIVITY_DETAIL_MAX_PER_RUN", 25))
ACTIVITY_RAW_MAX_PER_RUN = int(_env_float("GARMIN_ACTIVITY_RAW_MAX_PER_RUN", 50))


def _ensure_garmin_raw(cur) -> None:
    """Create the landing table if the Drizzle push has not run yet.

    Declared in ``packages/db/src/schema.ts`` as well — ``drizzle-kit push``
    runs on every boot and drops anything not in the schema.
    """
    cur.execute("""
        CREATE TABLE IF NOT EXISTS garmin_raw (
            user_id text NOT NULL,
            endpoint text NOT NULL,
            scope_key text NOT NULL,
            fetched_at timestamptz NOT NULL DEFAULT now(),
            payload jsonb NOT NULL,
            PRIMARY KEY (user_id, endpoint, scope_key)
        )
    """)


def _store_raw(cur, endpoint: str, scope_key: str, payload: Any) -> None:
    cur.execute(
        """
        INSERT INTO garmin_raw (user_id, endpoint, scope_key, fetched_at, payload)
        VALUES (%s, %s, %s, now(), %s)
        ON CONFLICT (user_id, endpoint, scope_key) DO UPDATE SET
            fetched_at = EXCLUDED.fetched_at,
            payload = EXCLUDED.payload
        """,
        (USER_ID, endpoint, str(scope_key), json.dumps(payload, default=str)),
    )


# Garmin answering 404/204 means "this never existed", not "try later".
_NO_DATA_STATUSES = (204, 404)


def _fetch_raw(
    cur,
    client,
    endpoint: str,
    scope_key: str,
    method: str,
    *args,
    mark_empty: bool = False,
) -> bool:
    """Fetch one endpoint and land it, isolated in a savepoint.

    Garmin returns 404 for endpoints a device never recorded (no hydration
    log, no exercise sets on a run). Those must not abort the surrounding
    transaction, so each call gets its own savepoint — the same pattern
    :func:`sync_activities` already uses per activity row.

    ``mark_empty`` lands a JSON ``null`` when Garmin says there is nothing.
    The per-activity backfills pick their work by "no row for this endpoint
    yet"; without the marker an activity that genuinely has no splits would
    be re-requested on every single sync, and — because those queries are
    ``LIMIT``-ed — would keep newer activities from ever being fetched.
    Only definitive answers are marked; a timeout or a 500 leaves the row
    absent so the next run retries it.
    """
    func = getattr(client, method, None)
    if func is None:
        # Endpoint absent from this garminconnect version — not an error.
        return False
    try:
        cur.execute("SAVEPOINT garmin_raw_fetch")
        payload = _garmin_api_call(f"{method}({scope_key})", func, *args)
        if payload is None:
            if mark_empty:
                _store_raw(cur, endpoint, scope_key, None)
            cur.execute("RELEASE SAVEPOINT garmin_raw_fetch")
            return False
        _store_raw(cur, endpoint, scope_key, payload)
        cur.execute("RELEASE SAVEPOINT garmin_raw_fetch")
        return True
    except Exception as exc:
        try:
            cur.execute("ROLLBACK TO SAVEPOINT garmin_raw_fetch")
        except Exception:
            pass
        status = _exception_status_code(exc)
        if status in _NO_DATA_STATUSES:
            # Not an error, and not worth logging per day per endpoint.
            if mark_empty:
                try:
                    _store_raw(cur, endpoint, scope_key, None)
                except Exception:
                    # Losing the marker only costs a retry next run; letting
                    # it escape would roll back the caller's whole batch.
                    pass
            return False
        print(
            f"  {method}({scope_key}) failed: {type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
        return False


def sync_raw_daily(client, db, days: int = RAW_DAILY_DAYS) -> None:
    """Land every per-day endpoint that the typed sync does not cover.

    Bounded by :data:`RAW_DAILY_DAYS` rather than the caller's sync window —
    see the note there. Within that window only the last
    :data:`RAW_DAILY_REFRESH_DAYS` days are re-fetched; everything already
    landed is left alone.
    """
    if days <= 0:
        return

    today = _user_today()
    cur = db.cursor()
    stored = 0
    try:
        _ensure_garmin_raw(cur)
        # scope_key also holds activity ids and "latest", so scope the lookup
        # to these endpoints rather than relying on date strings sorting apart
        # from everything else in the column.
        window_start = (today - timedelta(days=days - 1)).isoformat()
        cur.execute(
            "SELECT endpoint, scope_key FROM garmin_raw "
            "WHERE user_id = %s AND endpoint = ANY(%s) AND scope_key >= %s",
            (USER_ID, [name for name, _ in DAILY_RAW_ENDPOINTS], window_start),
        )
        already = set(cur.fetchall())

        for days_ago in range(days):
            date_str = (today - timedelta(days=days_ago)).isoformat()
            refresh = days_ago < RAW_DAILY_REFRESH_DAYS
            for endpoint, method in DAILY_RAW_ENDPOINTS:
                if not refresh and (endpoint, date_str) in already:
                    continue
                # Marked even on a 404: without it, an endpoint this watch
                # never records (hydration, lifestyle logging) would be
                # re-requested for every day in the window on every run,
                # forever. The refresh window re-fetches regardless of the
                # marker, so data arriving late still lands.
                if _fetch_raw(
                    cur, client, endpoint, date_str, method, date_str,
                    mark_empty=True,
                ):
                    stored += 1
            db.commit()
        if stored:
            print(f"  Landed {stored} daily Garmin payloads over {days} days")
    except Exception as exc:
        db.rollback()
        print(f"  Raw daily sync failed: {exc}", file=sys.stderr)
    finally:
        cur.close()


def sync_raw_singletons(client, db, days: int) -> None:
    """Land the account-level endpoints: one row each, refreshed per run.

    Signatures differ too much for a name table, so each is spelled out.
    """
    today = _user_today()
    start = (today - timedelta(days=max(days, 1))).isoformat()
    end = today.isoformat()

    cur = db.cursor()
    try:
        _ensure_garmin_raw(cur)
        _fetch_raw(cur, client, "race_predictions", "latest", "get_race_predictions")
        _fetch_raw(
            cur, client, "endurance_score", "latest", "get_endurance_score", start, end
        )
        _fetch_raw(cur, client, "hill_score", "latest", "get_hill_score", start, end)
        _fetch_raw(
            cur,
            client,
            "running_tolerance",
            "latest",
            "get_running_tolerance",
            start,
            end,
        )
        _fetch_raw(cur, client, "lactate_threshold", "latest", "get_lactate_threshold")
        _fetch_raw(cur, client, "cycling_ftp", "latest", "get_cycling_ftp")
        _fetch_raw(cur, client, "personal_records", "latest", "get_personal_record")
        _fetch_raw(cur, client, "user_profile", "latest", "get_user_profile")
        _fetch_raw(
            cur, client, "userprofile_settings", "latest", "get_userprofile_settings"
        )
        _fetch_raw(cur, client, "devices", "latest", "get_devices")
        _fetch_raw(
            cur,
            client,
            "primary_training_device",
            "latest",
            "get_primary_training_device",
        )
        _fetch_raw(cur, client, "goals", "latest", "get_goals")
        _fetch_raw(cur, client, "workouts", "latest", "get_workouts")
        _fetch_raw(cur, client, "training_plans", "latest", "get_training_plans")

        # Gear needs the numeric profile id, which only the profile response
        # carries. Skip rather than guess if it is not there.
        cur.execute(
            "SELECT payload FROM garmin_raw WHERE user_id = %s "
            "AND endpoint = 'user_profile' AND scope_key = 'latest'",
            (USER_ID,),
        )
        row = cur.fetchone()
        profile = row[0] if row else None
        profile_id = None
        if isinstance(profile, dict):
            profile_id = profile.get("userProfileId") or profile.get("profileId")
        if profile_id:
            _fetch_raw(cur, client, "gear", "latest", "get_gear", str(profile_id))

        db.commit()
        print("  Synced account-level Garmin endpoints")
    except Exception as exc:
        db.rollback()
        print(f"  Raw singleton sync failed: {exc}", file=sys.stderr)
    finally:
        cur.close()


def _laps_from_splits(payload: Any) -> list[dict] | None:
    """Reshape a ``get_activity_splits`` response into the ``laps`` column.

    The UI's LapTable derives pace from distance and duration itself, so only
    those two plus optional HR and power need to survive the reshape.
    """
    if not isinstance(payload, dict):
        return None
    dtos = payload.get("lapDTOs")
    if not isinstance(dtos, list) or not dtos:
        return None

    laps = []
    for i, lap in enumerate(dtos):
        if not isinstance(lap, dict):
            continue
        distance = lap.get("distance")
        duration = lap.get("duration") or lap.get("elapsedDuration")
        if distance is None and duration is None:
            continue
        entry = {
            "index": lap.get("lapIndex") or (i + 1),
            "distanceMeters": round(float(distance or 0), 1),
            "durationSeconds": round(float(duration or 0), 1),
        }
        hr = lap.get("averageHR")
        if hr:
            entry["avgHr"] = round(float(hr))
        power = lap.get("averagePower")
        if power:
            entry["avgPower"] = round(float(power))
        laps.append(entry)
    return laps or None


def _lift_activity_details(cur, act_id: str) -> None:
    """Promote the few raw fields the UI reads into typed columns.

    ponytail: the EPOC keys are a best-effort guess at Garmin's summary DTO.
    Both candidates are COALESCEd, so a miss leaves the column untouched
    rather than wrong, and the full payload stays in garmin_raw — the mapping
    can be corrected against a real response without re-syncing anything.
    """
    cur.execute(
        "SELECT endpoint, payload FROM garmin_raw WHERE user_id = %s "
        "AND scope_key = %s AND endpoint IN ('activity_full', 'activity_splits')",
        (USER_ID, act_id),
    )
    payloads = {endpoint: payload for endpoint, payload in cur.fetchall()}

    laps = _laps_from_splits(payloads.get("activity_splits"))
    full = payloads.get("activity_full")
    epoc = None
    if isinstance(full, dict):
        summary = full.get("summaryDTO")
        summary = summary if isinstance(summary, dict) else {}
        epoc = summary.get("epoc") or summary.get("epocMl")

    if laps is None and epoc is None:
        return

    cur.execute(
        """
        UPDATE activity SET
            laps = COALESCE(%s::jsonb, laps),
            epoc_ml = COALESCE(%s, epoc_ml)
        WHERE garmin_activity_id = %s AND user_id = %s
        """,
        (json.dumps(laps) if laps else None, epoc, act_id, USER_ID),
    )


def sync_activity_raw(client, db) -> None:
    """Fetch the per-activity endpoints for activities that lack them.

    Incremental by design: Garmin throttles hard, and the first run of a
    multi-year history would otherwise be a few thousand requests in a row.
    Newest activities first — those are the ones anyone actually opens.
    """
    if ACTIVITY_RAW_MAX_PER_RUN <= 0:
        return

    cur = db.cursor()
    try:
        _ensure_garmin_raw(cur)
        cur.execute(
            """
            SELECT a.garmin_activity_id
            FROM activity a
            WHERE a.user_id = %s
              AND a.garmin_activity_id IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM garmin_raw r
                  WHERE r.user_id = a.user_id
                    AND r.endpoint = 'activity_splits'
                    AND r.scope_key = a.garmin_activity_id
              )
            ORDER BY a.started_at DESC
            LIMIT %s
            """,
            (USER_ID, ACTIVITY_RAW_MAX_PER_RUN),
        )
        pending = [row[0] for row in cur.fetchall()]

        for act_id in pending:
            for endpoint, method in ACTIVITY_RAW_ENDPOINTS:
                _fetch_raw(
                    cur, client, endpoint, act_id, method, act_id, mark_empty=True
                )
            _lift_activity_details(cur, act_id)
            db.commit()

        if pending:
            cur.execute(
                """
                SELECT count(*)
                FROM activity a
                WHERE a.user_id = %s
                  AND a.garmin_activity_id IS NOT NULL
                  AND NOT EXISTS (
                      SELECT 1 FROM garmin_raw r
                      WHERE r.user_id = a.user_id
                        AND r.endpoint = 'activity_splits'
                        AND r.scope_key = a.garmin_activity_id
                  )
                """,
                (USER_ID,),
            )
            remaining = cur.fetchone()[0]
            print(
                f"  Fetched activity detail for {len(pending)} activities "
                f"({remaining} still pending)"
            )
    except Exception as exc:
        db.rollback()
        print(f"  Activity detail sync failed: {exc}", file=sys.stderr)
    finally:
        cur.close()


def sync_activity_timeseries(client, db) -> None:
    """Fetch the per-second sample stream for recent activities only.

    ``get_activity_details`` is the one genuinely large payload Garmin
    serves — a few MB each. The database ships inside the add-on and is
    backed up to /share/, so the window is bounded and configurable.
    """
    cur = db.cursor()
    fetched = 0
    try:
        _ensure_garmin_raw(cur)

        # Window off: drop what earlier runs stored rather than leaving a few
        # hundred MB behind in a backup the user just asked to shrink.
        if ACTIVITY_DETAIL_DAYS <= 0:
            cur.execute(
                "DELETE FROM garmin_raw WHERE user_id = %s "
                "AND endpoint = 'activity_details'",
                (USER_ID,),
            )
            if cur.rowcount:
                print(f"  Dropped {cur.rowcount} activity time series (window off)")
            db.commit()
            return

        cutoff = (_user_today() - timedelta(days=ACTIVITY_DETAIL_DAYS)).isoformat()
        cur.execute(
            """
            SELECT a.garmin_activity_id
            FROM activity a
            WHERE a.user_id = %s
              AND a.garmin_activity_id IS NOT NULL
              AND a.started_at >= %s
              AND NOT EXISTS (
                  SELECT 1 FROM garmin_raw r
                  WHERE r.user_id = a.user_id
                    AND r.endpoint = 'activity_details'
                    AND r.scope_key = a.garmin_activity_id
              )
            ORDER BY a.started_at DESC
            LIMIT %s
            """,
            (USER_ID, cutoff, max(ACTIVITY_DETAIL_MAX_PER_RUN, 0)),
        )
        for (act_id,) in cur.fetchall():
            if _fetch_raw(
                cur,
                client,
                "activity_details",
                act_id,
                "get_activity_details",
                act_id,
                mark_empty=True,
            ):
                fetched += 1
            db.commit()

        # Drop series that fell out of the window so the backup stays bounded.
        cur.execute(
            """
            DELETE FROM garmin_raw r
            USING activity a
            WHERE r.user_id = %s
              AND r.endpoint = 'activity_details'
              AND r.scope_key = a.garmin_activity_id
              AND a.started_at < %s
            """,
            (USER_ID, cutoff),
        )
        pruned = cur.rowcount
        db.commit()

        if fetched or pruned:
            print(
                f"  Activity time series: {fetched} fetched, {pruned} pruned "
                f"(window: {ACTIVITY_DETAIL_DAYS} days)"
            )
    except Exception as exc:
        db.rollback()
        print(f"  Activity time series sync failed: {exc}", file=sys.stderr)
    finally:
        cur.close()


def main():
    has_tokens = _has_saved_garmin_tokens()

    if not has_tokens and (not GARMIN_EMAIL or not GARMIN_PASSWORD):
        print("No Garmin tokens or credentials configured, skipping sync")
        _clear_sync_status()
        return

    print(
        f"Starting Garmin sync at {datetime.now(timezone.utc).isoformat()} (timezone: {USER_TZ})"
    )
    _write_sync_status("starting", "Authenticating with Garmin...")
    client = get_client()
    if client is None:
        print("Failed to authenticate with Garmin, skipping sync", file=sys.stderr)
        _clear_sync_status()
        return

    # First sync: full history from 2019. Subsequent syncs: 7 days only.
    HISTORY_MARKER = os.path.join(TOKEN_DIR, ".initial_sync_done")
    initial_backfill = not os.path.exists(HISTORY_MARKER)
    if not initial_backfill:
        sync_days = 7
    else:
        # Calculate days from 2019-01-01 to today
        epoch = datetime(2019, 1, 1, tzinfo=timezone.utc).date()
        today = _user_today()
        sync_days = (today - epoch).days
        print(f"First sync — pulling {sync_days} days of history (from 2019-01-01)...")

    db = get_db()

    today = _user_today()
    # Track whether every day of the window actually synced. The completion
    # marker below must not be written after a partial run, because nothing
    # ever retries the backfill: the next run would silently drop to 7 days
    # and the missing history would be gone for good.
    all_days_ok = True
    failed_days = 0
    for days_ago in range(sync_days):
        date_str = (today - timedelta(days=days_ago)).isoformat()
        _write_sync_status(
            "daily_stats", f"Syncing {date_str}", int((days_ago / sync_days) * 50)
        )
        if not sync_daily_stats(client, db, date_str):
            all_days_ok = False
            failed_days += 1
        if (
            initial_backfill
            and GARMIN_INITIAL_BACKFILL_DAY_DELAY_SECONDS > 0
            and days_ago < sync_days - 1
        ):
            time.sleep(GARMIN_INITIAL_BACKFILL_DAY_DELAY_SECONDS)

    _write_sync_status("backfill_skin_temp", "Backfilling skin temperature...", 50)
    backfill_skin_temp(client, db)

    # Garmin API: get_activities(start, limit) — fetch in batches of 100
    _write_sync_status("activities", "Syncing activities...", 50)
    sync_activities(client, db, days=sync_days)

    # Backfill computed fields from raw Garmin JSON
    _write_sync_status("backfill", "Computing zones & strain...", 80)
    backfill_from_raw_json(db)

    # One-time: re-stamp activity.started_at from startTimeGMT so rows
    # synced by older versions (which used startTimeLocal as a TZ-naive
    # literal) get their true UTC instant. Guarded by a marker file so
    # subsequent syncs are no-ops.
    _write_sync_status("backfill_started_at", "Fixing activity timestamps...", 82)
    backfill_activity_started_at_utc(db)

    _write_sync_status("backfill_stress", "Backfilling stress & sleep timing...", 85)
    backfill_stress_and_sleep(client, db)

    _write_sync_status("vo2max", "Computing VO2max estimates...", 90)
    sync_vo2max(client, db, days=sync_days)

    # Sync Garmin Training Readiness + Training Status (native scores)
    _write_sync_status("readiness", "Syncing training readiness...", 91)
    sync_training_readiness(client, db, days=min(sync_days, 30))
    sync_training_status(client, db, days=min(sync_days, 30))

    # Everything Garmin serves per day that the typed sync above does not
    # read — body battery events, floors, intraday steps, hydration and the
    # rest — landed raw over their own rolling window.
    _write_sync_status("garmin_raw_daily", "Syncing daily Garmin detail...", 91)
    sync_raw_daily(client, db)

    # Account-level endpoints: race predictions, endurance/hill score,
    # thresholds, devices, gear, goals, workouts.
    _write_sync_status("garmin_raw", "Syncing Garmin account data...", 92)
    sync_raw_singletons(client, db, days=min(sync_days, 365))

    # Per-activity detail: splits (fills activity.laps), weather, HR zones,
    # exercise sets, gear. Incremental — bounded per run.
    _write_sync_status("activity_detail", "Syncing activity detail...", 93)
    sync_activity_raw(client, db)

    # Per-second sample streams for the recent window only.
    _write_sync_status("activity_series", "Syncing activity time series...", 94)
    sync_activity_timeseries(client, db)

    # Refresh materialized view so all downstream queries see fresh data
    _write_sync_status("refresh", "Refreshing summary view...", 95)
    _refresh_matview(db)

    db.close()

    # Mark initial sync complete — only when the whole window succeeded, so a
    # rate-limited or interrupted first run is retried instead of being
    # recorded as done with a permanent hole in the history.
    if not os.path.exists(HISTORY_MARKER):
        if all_days_ok:
            with open(HISTORY_MARKER, "w") as f:
                f.write(datetime.now(timezone.utc).isoformat())
        else:
            print(
                f"WARNING: {failed_days}/{sync_days} days failed to sync — "
                "initial backfill stays incomplete and will be retried on the "
                "next run",
                file=sys.stderr,
            )

    _clear_sync_status()
    _write_last_sync()
    print("Garmin sync complete")

    # Chain metrics recompute so derived rows (readiness_score,
    # advanced_metric, daily_athlete_summary) pick up the freshly synced
    # daily_metric + activity rows without the user having to click
    # "Recompute metrics".
    #
    # Guards:
    #   1. Skip if .recompute_status already shows running:true — both
    #      the s6 periodic compute loop and the manual /auth/recompute
    #      endpoint set this; we don't want overlapping passes.
    #   2. Write running:true BEFORE spawning so the app's polling on
    #      /auth/recompute-status sees a true→false falling edge when
    #      metrics-compute.py finishes (it calls _clear_recompute_status
    #      which only updates the file if it already exists).
    #   3. Log to /data/metrics-compute.log so chained-run failures are
    #      diagnosable instead of silently swallowed.
    try:
        import subprocess

        status_file = os.path.join(TOKEN_DIR, ".recompute_status")
        try:
            if os.path.exists(status_file):
                with open(status_file) as f:
                    sf = json.load(f)
                if sf.get("running"):
                    print(
                        "metrics-compute already running "
                        "(s6 loop or manual recompute) — "
                        "skipping post-sync chain"
                    )
                    raise StopIteration
        except StopIteration:
            raise
        except Exception as exc:
            # Corrupt / unreadable status file — treat as not-running.
            logging.getLogger(__name__).debug("recompute status read failed: %s", exc)

        try:
            _ensure_secure_dir(TOKEN_DIR)
            with open(status_file, "w") as f:
                json.dump(
                    {
                        "running": True,
                        "started": time.time(),
                        "source": "post-sync",
                    },
                    f,
                )
        except OSError as exc:
            print(f"Warning: could not mark recompute running: {exc}")
            logging.getLogger(__name__).debug(
                "recompute status mark failed: %s", exc
            )

        # Inherit the parent environment so DATABASE_URL stays in sync
        # with whatever the sync run used (no duplicated default).
        log_path = "/data/metrics-compute.log"
        try:
            log_fh = open(log_path, "a", buffering=1)
            log_fh.write(
                f"=== chained from garmin-sync at "
                f"{datetime.now(timezone.utc).isoformat()} ===\n"
            )
            log_fh.flush()
            print("Chaining metrics-compute after sync...")
            subprocess.Popen(
                ["python3", "/app/scripts/metrics-compute.py", "--once"],
                stdout=log_fh,
                stderr=subprocess.STDOUT,
            )
            log_fh.close()
            print(f"metrics-compute started in background (log: {log_path})")
        except OSError as exc:
            # Spawn or log-open failed — clear the running marker so the
            # status file doesn't deadlock subsequent runs.
            try:
                with open(status_file, "w") as f:
                    json.dump({"running": False, "error": str(exc)}, f)
            except OSError as status_exc:
                logging.getLogger(__name__).debug(
                    "recompute status clear failed: %s", status_exc
                )
            print(f"Warning: failed to chain metrics-compute: {exc}")
            logging.getLogger(__name__).debug("metrics-compute chain failed: %s", exc)
    except StopIteration as exc:
        logging.getLogger(__name__).debug("metrics-compute chain skipped: %s", exc)
    except Exception as exc:
        print(f"Warning: chained metrics-compute setup failed: {exc}")
        logging.getLogger(__name__).debug("metrics-compute setup failed: %s", exc)


if __name__ == "__main__":
    # The sync status file is a lock with no owner and no TTL: if the process
    # dies anywhere between _write_sync_status and the normal clear, the UI
    # reports "Sync already in progress" forever and the progress bar hangs.
    # Clearing it here covers every exit path, including crashes.
    try:
        main()
    finally:
        try:
            _clear_sync_status()
        except Exception as exc:  # never mask the original failure
            print(f"WARNING: could not clear sync status: {exc}", file=sys.stderr)
