"""Read events from Zoho Calendar via CalDAV."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Iterable
from zoneinfo import ZoneInfo

import caldav
from icalendar import Calendar


@dataclass
class CalEvent:
    summary: str
    start: datetime
    end: datetime
    location: str = ""
    description: str = ""
    all_day: bool = False


def _to_dt(value, tz: ZoneInfo) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.replace(tzinfo=tz)
        return value.astimezone(tz)
    if isinstance(value, date):
        return datetime.combine(value, time.min, tzinfo=tz)
    raise TypeError(f"Unhandled datetime type: {type(value)}")


def fetch_events(
    caldav_url: str,
    user: str,
    password: str,
    tz_name: str,
    start: datetime,
    end: datetime,
) -> list[CalEvent]:
    tz = ZoneInfo(tz_name)
    client = caldav.DAVClient(url=caldav_url, username=user, password=password)
    principal = client.principal()
    events: list[CalEvent] = []
    for calendar in principal.calendars():
        try:
            results = calendar.search(start=start, end=end, event=True, expand=True)
        except Exception:
            continue
        for r in results:
            try:
                ical = Calendar.from_ical(r.data)
            except Exception:
                continue
            for component in ical.walk():
                if component.name != "VEVENT":
                    continue
                dtstart = component.get("DTSTART")
                dtend = component.get("DTEND")
                if not dtstart:
                    continue
                start_val = dtstart.dt
                end_val = dtend.dt if dtend else start_val
                all_day = not isinstance(start_val, datetime)
                s = _to_dt(start_val, tz)
                e = _to_dt(end_val, tz)
                # Guard against events returned outside the window
                if e < start or s > end:
                    continue
                events.append(
                    CalEvent(
                        summary=str(component.get("SUMMARY") or "(no title)"),
                        start=s,
                        end=e,
                        location=str(component.get("LOCATION") or ""),
                        description=str(component.get("DESCRIPTION") or ""),
                        all_day=all_day,
                    )
                )
    events.sort(key=lambda ev: ev.start)
    return events
