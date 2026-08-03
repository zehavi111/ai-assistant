"""Pure recurrence + streak logic. No DB access here."""
from datetime import date, timedelta


def parse_weekdays(csv: str | None) -> list[int]:
    if not csv:
        return []
    return sorted(int(x) for x in csv.split(",") if x.strip() != "")


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
    return from_date + timedelta(days=interval)


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
