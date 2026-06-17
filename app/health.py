"""Rule-based pack health metrics, plus an optional AI narrative summary."""

import os
from datetime import datetime, timezone

SPREAD_WATCH = 0.03
SPREAD_CHECK = 0.06

STORAGE_VOLTAGE = {
    "LiPo":   3.85,
    "LiHV":   3.85,
    "Li-ion": 3.70,
}

LAST_USED_STALE_DAYS = 30
RETIREMENT_APPROACHING_PCT = 0.80

# A pack left above storage voltage is only a real hazard once it has been
# sitting that way for a while — fresh-off-a-flight readings aren't a problem.
STORAGE_HAZARD_DAYS = 3


def _latest_cell_voltages(cycles):
    for c in reversed(cycles):
        if c.get("cell_voltages"):
            return c["cell_voltages"], c
    return None, None


def _days_since(iso_ts):
    """Whole days between an ISO timestamp and now (UTC), or None if unparseable."""
    if not iso_ts:
        return None
    try:
        dt = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - dt).days
    except ValueError:
        return None


def compute_metrics(pack, cycles):
    """Compute rule-based health metrics from a pack's cycle history."""
    metrics = {
        "cycle_count":        len([c for c in cycles if c["cycle_type"] == "discharge"]),
        "charge_count":       len([c for c in cycles if c["cycle_type"] == "charge"]),
        "total_logged":       len(cycles),
        "status":             "no data",
        "latest_spread":      None,
        "spread_trend":       None,
        "storage_warning":    False,
        "storage_days":       None,
        "retirement_warning": None,
        "last_used_days":     None,
        "last_used_iso":      None,
        "pack_age_days":      None,
        "pack_age_label":     None,
    }

    # --- cell spread / status ---
    latest_cv, latest_cv_cycle = _latest_cell_voltages(cycles)
    if latest_cv and len(latest_cv) > 1:
        spread = max(latest_cv) - min(latest_cv)
        metrics["latest_spread"] = round(spread, 3)
        if spread < SPREAD_WATCH:
            metrics["status"] = "healthy"
        elif spread < SPREAD_CHECK:
            metrics["status"] = "watch"
        else:
            metrics["status"] = "check"
    elif cycles:
        metrics["status"] = "healthy"

    # --- spread trend ---
    spreads = []
    for c in cycles:
        cv = c.get("cell_voltages")
        if cv and len(cv) > 1:
            spreads.append(max(cv) - min(cv))

    if len(spreads) >= 4:
        recent = spreads[-3:]
        earlier = spreads[-6:-3] if len(spreads) >= 6 else spreads[:-3]
        if earlier:
            recent_avg = sum(recent) / len(recent)
            earlier_avg = sum(earlier) / len(earlier)
            if recent_avg > earlier_avg * 1.2:
                metrics["spread_trend"] = "worsening"
            elif recent_avg < earlier_avg * 0.8:
                metrics["spread_trend"] = "improving"
            else:
                metrics["spread_trend"] = "stable"

    # --- storage voltage warning ---
    # Use the most recent per-cell reading of ANY cycle type so that a pack
    # charged for a flight and then left sitting is caught (the classic LiPo
    # storage hazard), not just the last discharge. Only warn once that reading
    # is old enough that the pack has genuinely been sitting charged.
    chemistry = pack.get("chemistry", "LiPo")
    storage_thresh = STORAGE_VOLTAGE.get(chemistry, 3.85)
    most_recent_type = cycles[-1]["cycle_type"] if cycles else None
    # An explicit storage cycle means the pack has been brought to storage —
    # never warn in that case, even if per-cell voltages weren't recorded.
    if most_recent_type != "storage" and latest_cv:
        latest_avg = sum(latest_cv) / len(latest_cv)
        days_charged = _days_since(latest_cv_cycle.get("timestamp"))
        if (latest_avg > storage_thresh
                and days_charged is not None
                and days_charged >= STORAGE_HAZARD_DAYS):
            metrics["storage_warning"] = True
            metrics["storage_days"] = days_charged

    # --- retirement warning ---
    max_cycles = pack.get("max_cycles")
    if max_cycles and max_cycles > 0:
        ratio = metrics["cycle_count"] / max_cycles
        if ratio >= 1.0:
            metrics["retirement_warning"] = "exceeded"
        elif ratio >= RETIREMENT_APPROACHING_PCT:
            metrics["retirement_warning"] = "approaching"

    # --- last used ---
    all_timestamps = [c["timestamp"] for c in cycles if c.get("timestamp")]
    if all_timestamps:
        latest_ts = max(all_timestamps)
        days = _days_since(latest_ts)
        if days is not None:
            metrics["last_used_days"] = days
            metrics["last_used_iso"] = latest_ts

    # --- pack age ---
    date_added = pack.get("date_added")
    age_days = _days_since(date_added)
    if age_days is not None:
        metrics["pack_age_days"] = age_days
        try:
            added_dt = datetime.fromisoformat(date_added.replace("Z", "+00:00"))
            metrics["pack_age_label"] = added_dt.strftime("Added %b %Y")
        except ValueError:
            pass

    return metrics


def get_ai_summary(pack, cycles, metrics):
    """Return a short natural-language health summary, or None if unavailable."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key or not cycles:
        return None

    try:
        from anthropic import Anthropic
    except ImportError:
        return None

    cycle_lines = []
    for c in cycles[-10:]:
        line = f"{c['timestamp']} | {c['cycle_type']} | pack {c.get('pack_voltage')}V"
        if c.get("cell_voltages"):
            line += f" | cells {c['cell_voltages']}"
        cycle_lines.append(line)

    prompt = (
        f"You are reviewing the cycle history of a {pack['cell_count']}S LiPo pack "
        f"named '{pack['name']}' rated at {pack.get('capacity_mah', 'unknown')}mAh.\n\n"
        f"Recent cycle log (most recent {len(cycle_lines)} entries):\n"
        + "\n".join(cycle_lines)
        + f"\n\nComputed metrics: {metrics}\n\n"
        "In 2-3 short sentences, give a plain-language health assessment and one "
        "practical recommendation. Be specific about cell imbalance or resistance "
        "trends if relevant. If everything looks normal, say so briefly."
    )

    try:
        client = Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=300,
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text
    except Exception as exc:
        return f"AI summary unavailable: {exc}"
