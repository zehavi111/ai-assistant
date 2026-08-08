"""Pure recurrence + streak logic. No DB access here."""
import calendar
from datetime import date, timedelta


def parse_weekdays(csv: str | None) -> list[int]:
    if not csv:
        return []
    return sorted(int(x) for x in csv.split(",") if x.strip() != "")


def _add_months_clamped(d: date, months: int) -> date:
    """Same day-of-month `months` ahead, clamped to month end (Jan 31 -> Feb 28)."""
    year, month0 = divmod(d.month - 1 + months, 12)
    year, month = d.year + year, month0 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def advance_due_date(
    recur_unit: str | None,
    recur_interval: int | None,
    recur_weekdays: str | None,
    from_date: date,
) -> date:
    """Next occurrence strictly after from_date."""
    interval = recur_interval or 1
    if recur_unit in ("day", "interval") or recur_unit is None:
        return from_date + timedelta(days=interval)
    if recur_unit == "week":
        weekdays = parse_weekdays(recur_weekdays)
        if not weekdays:
            return from_date + timedelta(days=7 * interval)
        d = from_date + timedelta(days=1)
        for _ in range(8):
            if d.weekday() in weekdays:
                return d
            d += timedelta(days=1)
        return d  # unreachable, defensive
    if recur_unit == "month":
        return _add_months_clamped(from_date, interval)
    return from_date + timedelta(days=interval)


def next_unresolved(
    recur_unit: str | None,
    recur_interval: int | None,
    recur_weekdays: str | None,
    start: date,
    resolved: set[date],
) -> date:
    """First occurrence >= start that is neither completed nor skipped."""
    d = start
    while d in resolved:
        d = advance_due_date(recur_unit, recur_interval, recur_weekdays, d)
    return d


def pending_occurrences(
    recur_unit: str | None,
    recur_interval: int | None,
    recur_weekdays: str | None,
    next_due: date | None,
    upto: date,
    resolved: frozenset[date] | set[date] = frozenset(),
    cap: int = 7,
) -> list[date]:
    """Unresolved occurrence dates in [next_due, upto], oldest first, at most cap.

    next_due itself always counts as an occurrence (even if a later rule edit
    means it no longer matches the pattern); resolved dates are stepped over
    without counting toward cap.
    """
    if next_due is None or next_due > upto:
        return []
    out: list[date] = []
    d = next_due
    for _ in range(1000):  # hard guard; cap governs in practice
        if d > upto or len(out) >= cap:
            break
        if d not in resolved:
            out.append(d)
        d = advance_due_date(recur_unit, recur_interval, recur_weekdays, d)
    return out


def compute_streak(completion_dates: set[date], today: date) -> tuple[int, int]:
    """(current, best). Current tolerates an unfinished today."""
    if not completion_dates:
        return 0, 0

    # Current: start at today, or yesterday if today not done yet.
    start = today if today in completion_dates else today - timedelta(days=1)
    current = 0
    d = start
    while d in completion_dates:
        current += 1
        d -= timedelta(days=1)

    # Best: longest consecutive run.
    best = 0
    run = 0
    prev = None
    for d in sorted(completion_dates):
        run = run + 1 if prev is not None and d - prev == timedelta(days=1) else 1
        best = max(best, run)
        prev = d
    return current, best
