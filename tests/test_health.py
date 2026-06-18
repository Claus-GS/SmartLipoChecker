"""Unit tests for the rule-based health metrics (no DB needed)."""

from datetime import datetime, timedelta, timezone

from app import health


def _ago(days):
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _cycle(cycle_type, cell_voltages=None, days_ago=0, pack_voltage=None):
    return {
        "cycle_type": cycle_type,
        "cell_voltages": cell_voltages,
        "pack_voltage": pack_voltage,
        "timestamp": _ago(days_ago),
        "source": "manual",
        "notes": None,
    }


def _pack(**over):
    base = {
        "chemistry": "LiPo",
        "capacity_mah": 1300,
        "max_cycles": None,
        "date_added": _ago(100),
    }
    base.update(over)
    return base


def test_no_cycles_is_no_data():
    m = health.compute_metrics(_pack(), [])
    assert m["status"] == "no data"
    assert m["cycle_count"] == 0
    assert m["total_logged"] == 0


def test_counts_discharges_and_charges():
    cycles = [_cycle("charge", days_ago=2), _cycle("discharge", days_ago=1),
              _cycle("discharge", days_ago=0)]
    m = health.compute_metrics(_pack(), cycles)
    assert m["cycle_count"] == 2      # discharges
    assert m["charge_count"] == 1
    assert m["total_logged"] == 3


def test_spread_status_healthy_watch_check():
    healthy = health.compute_metrics(_pack(), [_cycle("discharge", [3.80, 3.81, 3.80, 3.82])])
    assert healthy["status"] == "healthy"
    assert healthy["latest_spread"] == 0.02

    watch = health.compute_metrics(_pack(), [_cycle("discharge", [3.80, 3.84, 3.80, 3.80])])
    assert watch["status"] == "watch"   # 0.04 spread

    check = health.compute_metrics(_pack(), [_cycle("discharge", [3.70, 3.80, 3.70, 3.70])])
    assert check["status"] == "check"   # 0.10 spread


def test_storage_warning_when_left_charged():
    # High per-cell voltage, recorded several days ago, last cycle not a storage cycle.
    cycles = [_cycle("charge", [4.18, 4.18, 4.18, 4.18], days_ago=5)]
    m = health.compute_metrics(_pack(), cycles)
    assert m["storage_warning"] is True
    assert m["storage_days"] >= 3


def test_no_storage_warning_right_after_charge():
    cycles = [_cycle("charge", [4.18, 4.18, 4.18, 4.18], days_ago=0)]
    m = health.compute_metrics(_pack(), cycles)
    assert m["storage_warning"] is False


def test_no_storage_warning_after_storage_cycle():
    cycles = [
        _cycle("charge", [4.18, 4.18, 4.18, 4.18], days_ago=5),
        _cycle("storage", [3.85, 3.85, 3.85, 3.85], days_ago=4),
    ]
    m = health.compute_metrics(_pack(), cycles)
    assert m["storage_warning"] is False


def test_charge_state_from_last_cycle():
    assert health.compute_metrics(_pack(), [])["charge_state"] == "unknown"

    charged = health.compute_metrics(_pack(), [
        _cycle("storage", days_ago=5), _cycle("charge", days_ago=0)])
    assert charged["charge_state"] == "charged"

    storage = health.compute_metrics(_pack(), [
        _cycle("charge", days_ago=5), _cycle("storage", days_ago=0)])
    assert storage["charge_state"] == "storage"

    spent = health.compute_metrics(_pack(), [
        _cycle("charge", days_ago=2), _cycle("discharge", days_ago=0)])
    assert spent["charge_state"] == "spent"


def test_retirement_warnings():
    cycles = [_cycle("discharge", [3.80, 3.81, 3.80, 3.81], days_ago=i) for i in range(10)]
    exceeded = health.compute_metrics(_pack(max_cycles=5), cycles)
    assert exceeded["retirement_warning"] == "exceeded"

    approaching = health.compute_metrics(_pack(max_cycles=11), cycles)  # 10/11 ~ 0.91
    assert approaching["retirement_warning"] == "approaching"

    fine = health.compute_metrics(_pack(max_cycles=100), cycles)
    assert fine["retirement_warning"] is None
