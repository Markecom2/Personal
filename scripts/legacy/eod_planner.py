#!/usr/bin/env python3
"""Generate the daily EOD (or morning) briefing as an HTML file.

Usage:
    python scripts/eod_planner.py --mode morning
    python scripts/eod_planner.py --mode evening
    python scripts/eod_planner.py --mock            # use mocks/, no external calls
    python scripts/eod_planner.py --skip-llm        # rules-only ranking
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.lib.config import REPO_ROOT, load_config  # noqa: E402
from scripts.lib.pm_db import PMTask, fetch_tasks  # noqa: E402
from scripts.lib.render import render_html  # noqa: E402
from scripts.lib.summarizer import summarize  # noqa: E402
from scripts.lib.zoho_calendar import CalEvent, fetch_events  # noqa: E402
from scripts.lib.zoho_mail import MailMessage, fetch_recent  # noqa: E402

MOCK_DIR = REPO_ROOT / "mocks"
OUT_DIR = REPO_ROOT / "daily"


def _window(mode: str, now: datetime) -> tuple[datetime, datetime]:
    """Morning => today's events; evening => tomorrow's events."""
    if mode == "morning":
        start = datetime.combine(now.date(), time.min, tzinfo=now.tzinfo)
        end = start + timedelta(days=1)
    else:
        tomorrow = now.date() + timedelta(days=1)
        start = datetime.combine(tomorrow, time.min, tzinfo=now.tzinfo)
        end = start + timedelta(days=1)
    return start, end


def _load_mocks(tz: ZoneInfo) -> tuple[list[CalEvent], list[MailMessage], list[PMTask]]:
    events_raw = json.loads((MOCK_DIR / "calendar.json").read_text())
    emails_raw = json.loads((MOCK_DIR / "emails.json").read_text())
    tasks_raw = json.loads((MOCK_DIR / "tasks.json").read_text())

    events = [
        CalEvent(
            summary=e["summary"],
            start=datetime.fromisoformat(e["start"]).replace(tzinfo=tz),
            end=datetime.fromisoformat(e["end"]).replace(tzinfo=tz),
            location=e.get("location", ""),
            description=e.get("description", ""),
            all_day=e.get("all_day", False),
        )
        for e in events_raw
    ]
    emails = [
        MailMessage(
            uid=e["uid"],
            subject=e["subject"],
            sender_name=e["sender_name"],
            sender_email=e["sender_email"],
            received_at=datetime.fromisoformat(e["received_at"]).replace(tzinfo=tz),
            snippet=e.get("snippet", ""),
            flagged=e.get("flagged", False),
        )
        for e in emails_raw
    ]
    tasks = [
        PMTask(
            id=t["id"],
            title=t["title"],
            project=t.get("project", ""),
            status=t.get("status", ""),
            priority=t.get("priority", ""),
            assignee=t.get("assignee", ""),
            due_date=date.fromisoformat(t["due_date"]) if t.get("due_date") else None,
            url=t.get("url", ""),
            notes=t.get("notes", ""),
        )
        for t in tasks_raw
    ]
    return events, emails, tasks


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=["morning", "evening"], required=True)
    p.add_argument("--mock", action="store_true", help="Read from mocks/ instead of live sources.")
    p.add_argument("--skip-llm", action="store_true", help="Skip Claude API, use rules-based ranking.")
    p.add_argument("--out", type=Path, default=None, help="Output HTML path.")
    args = p.parse_args()

    cfg = load_config()
    tz = ZoneInfo(cfg.tz)
    now = datetime.now(tz)

    if args.mock:
        events, emails, tasks = _load_mocks(tz)
        source_label = "mock data"
    else:
        window_start, window_end = _window(args.mode, now)

        print(f"[fetch] calendar {window_start.date()} → {window_end.date()}")
        try:
            events = fetch_events(
                cfg.zoho_caldav_url,
                cfg.zoho_caldav_user,
                cfg.zoho_caldav_password,
                cfg.tz,
                window_start,
                window_end,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[fetch] calendar failed: {exc!r}")
            events = []

        print("[fetch] mail (unread + flagged, last 36h)")
        try:
            emails = fetch_recent(
                cfg.zoho_imap_host,
                cfg.zoho_imap_port,
                cfg.zoho_email,
                cfg.zoho_app_password,
                folders=("INBOX",),
                since_hours=36,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[fetch] mail failed: {exc!r}")
            emails = []

        print("[fetch] PM tasks")
        try:
            tasks = fetch_tasks(
                cfg.pm_db_host,
                cfg.pm_db_port,
                cfg.pm_db_user,
                cfg.pm_db_password,
                cfg.pm_db_name,
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[fetch] tasks failed: {exc!r}")
            tasks = []

        source_label = "live: Zoho Mail + Zoho Calendar + PM DB"

    print(f"[summarize] {len(events)} events, {len(emails)} emails, {len(tasks)} tasks")
    summary = summarize(
        mode=args.mode,
        user_name=cfg.user_name,
        user_role=cfg.user_role,
        now=now,
        events=events,
        emails=emails,
        tasks=tasks,
        api_key=None if args.skip_llm else cfg.anthropic_api_key,
    )

    html = render_html(
        mode=args.mode,
        now=now,
        user_name=cfg.user_name,
        events=events,
        emails=emails,
        tasks=tasks,
        summary=summary,
        source_label=source_label,
    )

    OUT_DIR.mkdir(exist_ok=True)
    stamp = now.strftime("%Y-%m-%d")
    out_path = args.out or (OUT_DIR / f"{stamp}-{args.mode}.html")
    out_path.write_text(html)
    print(f"[write] {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
