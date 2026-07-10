"""Ask Claude to prioritize the inbox + task list and produce a day summary.

Uses Claude Haiku 4.5 for cost — the reasoning is straightforward ranking.
Falls back to a rules-based summary if the API key is missing or the call fails.
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict
from datetime import datetime
from typing import Any, Literal

import anthropic

from .pm_db import PMTask
from .zoho_calendar import CalEvent
from .zoho_mail import MailMessage

Mode = Literal["morning", "evening"]

MODEL = "claude-haiku-4-5"

SYSTEM_PROMPT = """You are an executive assistant preparing a briefing.
You are terse, decisive, and specific. Never invent facts — only use what you are given.
Your job:
  1. Rank emails by how much they need attention today (respond_now / respond_today / fyi / skip).
     Prioritize: unread from real humans, replies to threads the user started, revenue/customer signals,
     time-sensitive deadlines. Deprioritize: newsletters, marketing, automated notifications.
  2. Rank tasks (top_focus / important / later). At most 3 top_focus.
  3. Write ONE headline sentence describing the day's shape.
  4. Write 3-5 bullet "focus points" — what actually matters. Concrete, not generic.
Output JSON only, matching the schema exactly."""

SCHEMA = {
    "type": "object",
    "properties": {
        "headline": {"type": "string"},
        "focus_points": {
            "type": "array",
            "items": {"type": "string"},
        },
        "email_priorities": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "uid": {"type": "string"},
                    "bucket": {
                        "type": "string",
                        "enum": ["respond_now", "respond_today", "fyi", "skip"],
                    },
                    "why": {"type": "string"},
                },
                "required": ["uid", "bucket", "why"],
                "additionalProperties": False,
            },
        },
        "task_priorities": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "bucket": {
                        "type": "string",
                        "enum": ["top_focus", "important", "later"],
                    },
                    "why": {"type": "string"},
                },
                "required": ["id", "bucket", "why"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["headline", "focus_points", "email_priorities", "task_priorities"],
    "additionalProperties": False,
}


def _serialize_events(events: list[CalEvent]) -> list[dict[str, Any]]:
    out = []
    for e in events:
        out.append(
            {
                "summary": e.summary,
                "start": e.start.isoformat(),
                "end": e.end.isoformat(),
                "location": e.location,
                "all_day": e.all_day,
            }
        )
    return out


def _serialize_emails(emails: list[MailMessage]) -> list[dict[str, Any]]:
    out = []
    for m in emails:
        out.append(
            {
                "uid": m.uid,
                "subject": m.subject,
                "from_name": m.sender_name,
                "from_email": m.sender_email,
                "received_at": m.received_at.isoformat(),
                "snippet": m.snippet[:280],
                "flagged": m.flagged,
                "folder": m.folder,
            }
        )
    return out


def _serialize_tasks(tasks: list[PMTask]) -> list[dict[str, Any]]:
    out = []
    for t in tasks:
        d = asdict(t)
        for key in ("due_date", "updated_at"):
            if d.get(key) is not None and hasattr(d[key], "isoformat"):
                d[key] = d[key].isoformat()
        out.append(d)
    return out


def summarize(
    *,
    mode: Mode,
    user_name: str,
    user_role: str,
    now: datetime,
    events: list[CalEvent],
    emails: list[MailMessage],
    tasks: list[PMTask],
    api_key: str | None = None,
) -> dict[str, Any]:
    """Return a dict with headline, focus_points, email_priorities, task_priorities."""
    api_key = api_key or os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return _fallback(mode, events, emails, tasks)

    user_payload = {
        "mode": mode,
        "user_name": user_name,
        "user_role": user_role,
        "now": now.isoformat(),
        "day_shape": "prep_for_today" if mode == "morning" else "wind_down_and_prep_tomorrow",
        "calendar": _serialize_events(events),
        "emails": _serialize_emails(emails),
        "tasks": _serialize_tasks(tasks),
    }

    client = anthropic.Anthropic(api_key=api_key)
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=4000,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Here is the input for the briefing. Return JSON only.\n\n"
                        + json.dumps(user_payload, indent=2)
                    ),
                }
            ],
            output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
        )
        text = next((b.text for b in response.content if b.type == "text"), "")
        data = json.loads(text)
        return data
    except Exception as exc:  # noqa: BLE001
        print(f"[summarizer] LLM call failed ({exc!r}); using rules fallback.")
        return _fallback(mode, events, emails, tasks)


def _fallback(
    mode: Mode,
    events: list[CalEvent],
    emails: list[MailMessage],
    tasks: list[PMTask],
) -> dict[str, Any]:
    """Deterministic ranking when no LLM is available."""
    email_priorities = []
    for m in emails:
        addr = m.sender_email.lower()
        is_bot = any(
            token in addr
            for token in ("noreply", "no-reply", "notifications@", "newsletter", "marketing")
        )
        if m.flagged:
            bucket = "respond_now"
            why = "You starred this."
        elif is_bot:
            bucket = "skip"
            why = "Automated / newsletter."
        else:
            bucket = "respond_today"
            why = "Unread from a human."
        email_priorities.append({"uid": m.uid, "bucket": bucket, "why": why})

    task_priorities = []
    top_count = 0
    for t in tasks:
        pr = (t.priority or "").lower()
        if pr in ("urgent", "high") and top_count < 3:
            bucket = "top_focus"
            top_count += 1
            why = f"Priority: {t.priority}."
        elif pr == "medium":
            bucket = "important"
            why = "Medium priority."
        else:
            bucket = "later"
            why = "Lower priority."
        task_priorities.append({"id": t.id, "bucket": bucket, "why": why})

    headline = (
        f"{len(events)} events, {len(emails)} unread emails, {len(tasks)} open tasks."
        if mode == "morning"
        else f"Wind-down: {len(tasks)} still open, {len(emails)} emails to triage."
    )
    focus_points: list[str] = []
    if events:
        focus_points.append(f"First calendar item: {events[0].summary} at {events[0].start.strftime('%H:%M')}.")
    if top_count:
        focus_points.append(f"{top_count} high-priority task(s) queued.")
    focus_points.append(f"{len([e for e in email_priorities if e['bucket'] == 'respond_today'])} email(s) need a reply.")
    return {
        "headline": headline,
        "focus_points": focus_points or ["No pressing items detected."],
        "email_priorities": email_priorities,
        "task_priorities": task_priorities,
    }
