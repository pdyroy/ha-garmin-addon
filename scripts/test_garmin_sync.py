#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Self-check for the pure reshaping logic in garmin-sync.py.

Runs without a database, a Garmin session, or a test framework:

    python3 scripts/test_garmin_sync.py
"""

import importlib.util
import os
import sys
import types
from pathlib import Path

SYNC = Path(__file__).resolve().parent.parent / "pacer/rootfs/app/scripts/garmin-sync.py"


def load_sync():
    """Import garmin-sync.py with its runtime-only dependencies stubbed out.

    The script imports garminconnect and psycopg2 at module scope; neither is
    installed outside the add-on image and neither is needed here.
    """
    os.environ.setdefault("GARMIN_USER_ID", "test-user")
    for name in ("garminconnect", "garth", "psycopg2", "psycopg2.extras"):
        sys.modules.setdefault(name, types.ModuleType(name))
    gc = sys.modules["garminconnect"]
    gc.Garmin = object
    gc.GarminConnectAuthenticationError = Exception
    gc.GarminConnectConnectionError = Exception
    gc.GarminConnectTooManyRequestsError = Exception
    sys.modules["psycopg2"].connect = lambda *a, **k: None
    sys.modules["psycopg2"].extras = sys.modules["psycopg2.extras"]

    spec = importlib.util.spec_from_file_location("gsync", SYNC)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_laps_from_splits(g):
    """get_activity_splits -> the shape activity.laps and LapTable expect."""
    laps = g._laps_from_splits(
        {
            "lapDTOs": [
                {
                    "lapIndex": 1,
                    "distance": 1000.0,
                    "duration": 300.4,
                    "averageHR": 151.6,
                    "averagePower": 240.2,
                },
                {"lapIndex": 2, "distance": 1000.0, "duration": 288.0},
                # Neither distance nor duration — nothing to render, dropped.
                {"lapIndex": 3},
            ]
        }
    )
    assert laps == [
        {
            "index": 1,
            "distanceMeters": 1000.0,
            "durationSeconds": 300.4,
            "avgHr": 152,
            "avgPower": 240,
        },
        {"index": 2, "distanceMeters": 1000.0, "durationSeconds": 288.0},
    ], laps

    # Activities without lap data must yield NULL, not an empty array — the UI
    # distinguishes "no laps recorded" from "laps not synced yet".
    assert g._laps_from_splits({}) is None
    assert g._laps_from_splits({"lapDTOs": []}) is None
    assert g._laps_from_splits(None) is None
    assert g._laps_from_splits("not a dict") is None


def test_stride_length_unit_guard(g):
    """Garmin sends centimetres; the engine reads the column as metres."""
    assert g._stride_length_metres({"avgStrideLength": 121.7}) == 1.217
    # Already metres — left alone, so a Garmin unit switch cannot halve it.
    assert g._stride_length_metres({"avgStrideLength": 1.22}) == 1.22
    assert g._stride_length_metres({"avgStrideLength": None}) is None
    assert g._stride_length_metres({}) is None
    assert g._stride_length_metres({"avgStrideLength": 0}) == 0


if __name__ == "__main__":
    sync = load_sync()
    test_laps_from_splits(sync)
    test_stride_length_unit_guard(sync)
    print("garmin-sync checks passed")
