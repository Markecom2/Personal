"""Turn the fetched + summarized data into an HTML page."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from jinja2 import Environment, FileSystemLoader, select_autoescape

from .pm_db import PMTask
from .zoho_calendar import CalEvent
from .zoho_mail import MailMessage

Mode = Literal["morning", "evening"]

TEMPLATE_DIR = Path(__file__).resolve().parents[1] / "templates"


def _fmt_time(dt: datetime) -> str:
    return dt.strftime("%-I:%M %p") if hasattr(dt, "strftime") else str(dt)


def _fmt_received(dt: datetime, now: datetime) -> str:
    delta = now - dt if dt.tzinfo == now.tzinfo else now - dt.replace(tzinfo=now.tzinfo)
    minutes = int(delta.total_seconds() // 60)
    if minutes < 60:
        return f"{minutes} min ago" if minutes >= 1 else "just now"
    hours = minutes // 60
    if hours < 24:
        return f"{hours}h ago"
    days = hours // 24
    return f"{days}d ago"


def render_html(
    *,
    mode: Mode,
    now: datetime,
    user_name: str,
    events: list[CalEvent],
    emails: list[MailMessage],
    tasks: list[PMTask],
    summary: dict[str, Any],
    source_label: str,
) -> str:
    env = Environment(
        loader=FileSystemLoader(TEMPLATE_DIR),
        autoescape=select_autoescape(["html", "j2"]),
    )
    tmpl = env.get_template("eod.html.j2")

    # Index the LLM's rankings so we can join by uid/id.
    email_bucket: dict[str, tuple[str, str]] = {
        p["uid"]: (p["bucket"], p.get("why", "")) for p in summary.get("email_priorities", [])
    }
    task_bucket: dict[str, tuple[str, str]] = {
        p["id"]: (p["bucket"], p.get("why", "")) for p in summary.get("task_priorities", [])
    }

    emails_now, emails_today, emails_fyi = [], [], []
    for m in emails:
        bucket, why = email_bucket.get(m.uid, ("respond_today", ""))
        item = {
            "subject": m.subject,
            "sender_name": m.sender_name or m.sender_email,
            "received_str": _fmt_received(m.received_at, now),
            "snippet": m.snippet[:220] if m.snippet else "",
            "why": why,
        }
        if bucket == "respond_now":
            emails_now.append(item)
        elif bucket == "respond_today":
            emails_today.append(item)
        elif bucket == "fyi":
            emails_fyi.append(item)
        # skip → dropped entirely

    tasks_top, tasks_important, tasks_later = [], [], []
    for t in tasks:
        bucket, why = task_bucket.get(t.id, ("later", ""))
        item = {
            "title": t.title,
            "project": t.project,
            "due_date": t.due_date.isoformat() if t.due_date else "",
            "why": why,
        }
        if bucket == "top_focus":
            tasks_top.append(item)
        elif bucket == "important":
            tasks_important.append(item)
        else:
            tasks_later.append(item)

    event_items = []
    for ev in events:
        is_now = ev.start <= now <= ev.end and not ev.all_day
        event_items.append(
            {
                "summary": ev.summary,
                "location": ev.location,
                "start_str": "all day" if ev.all_day else _fmt_time(ev.start),
                "end_str": "" if ev.all_day else _fmt_time(ev.end),
                "all_day": ev.all_day,
                "is_now": is_now,
            }
        )

    hour = now.hour
    greeting = "morning" if 5 <= hour < 12 else ("afternoon" if 12 <= hour < 17 else "evening")

    return tmpl.render(
        mode_label=mode.capitalize(),
        date_str=now.strftime("%A, %B %-d"),
        user_name=user_name,
        greeting=greeting,
        headline=summary.get("headline", ""),
        focus_points=summary.get("focus_points", []),
        calendar_label="Today" if mode == "morning" else "Tomorrow",
        events=event_items,
        tasks_top=tasks_top,
        tasks_important=tasks_important,
        tasks_later=tasks_later,
        emails_now=emails_now,
        emails_today=emails_today,
        emails_fyi=emails_fyi,
        generated_at=now.strftime("%Y-%m-%d %H:%M %Z").strip(),
        source_label=source_label,
    )
