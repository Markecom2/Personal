"""Read recent unread/important messages from Zoho Mail via IMAP."""
from __future__ import annotations

import email
import imaplib
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.header import decode_header
from email.utils import parseaddr, parsedate_to_datetime
from typing import Iterable


@dataclass
class MailMessage:
    uid: str
    subject: str
    sender_name: str
    sender_email: str
    received_at: datetime
    snippet: str
    flagged: bool = False
    folder: str = "INBOX"
    labels: list[str] = field(default_factory=list)


def _decode(raw: str | None) -> str:
    if not raw:
        return ""
    parts = decode_header(raw)
    out: list[str] = []
    for text, enc in parts:
        if isinstance(text, bytes):
            try:
                out.append(text.decode(enc or "utf-8", errors="replace"))
            except LookupError:
                out.append(text.decode("utf-8", errors="replace"))
        else:
            out.append(text)
    return "".join(out).strip()


def _plain_body(msg: email.message.Message, limit: int = 500) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and "attachment" not in str(part.get("Content-Disposition", "")):
                try:
                    payload = part.get_payload(decode=True) or b""
                    text = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
                    return " ".join(text.split())[:limit]
                except Exception:
                    continue
        return ""
    try:
        payload = msg.get_payload(decode=True) or b""
        text = payload.decode(msg.get_content_charset() or "utf-8", errors="replace")
        return " ".join(text.split())[:limit]
    except Exception:
        return ""


def fetch_recent(
    host: str,
    port: int,
    user: str,
    password: str,
    folders: Iterable[str] = ("INBOX",),
    since_hours: int = 36,
    max_per_folder: int = 40,
) -> list[MailMessage]:
    """Pull unread + flagged messages from the given folders in the last N hours."""
    since = (datetime.utcnow() - timedelta(hours=since_hours)).strftime("%d-%b-%Y")
    imap = imaplib.IMAP4_SSL(host, port)
    try:
        imap.login(user, password)
        messages: list[MailMessage] = []
        for folder in folders:
            typ, _ = imap.select(f'"{folder}"', readonly=True)
            if typ != "OK":
                continue
            # Grab unread AND flagged (starred), then dedupe by UID
            uids: set[bytes] = set()
            for criterion in (f'(UNSEEN SINCE {since})', f'(FLAGGED SINCE {since})'):
                typ, data = imap.uid("search", None, criterion)
                if typ == "OK" and data and data[0]:
                    uids.update(data[0].split())
            if not uids:
                continue
            sorted_uids = sorted(uids, key=lambda x: int(x), reverse=True)[:max_per_folder]
            for uid in sorted_uids:
                typ, msg_data = imap.uid("fetch", uid, "(FLAGS RFC822)")
                if typ != "OK" or not msg_data:
                    continue
                flags_raw = b""
                raw_email = b""
                for chunk in msg_data:
                    if isinstance(chunk, tuple) and len(chunk) >= 2:
                        flags_raw = chunk[0] or b""
                        raw_email = chunk[1] or b""
                        break
                if not raw_email:
                    continue
                flagged = b"\\Flagged" in flags_raw
                msg = email.message_from_bytes(raw_email)
                subject = _decode(msg.get("Subject"))
                sender_name, sender_email = parseaddr(msg.get("From", ""))
                sender_name = _decode(sender_name) or sender_email
                try:
                    received_at = parsedate_to_datetime(msg.get("Date")) if msg.get("Date") else datetime.now(timezone.utc)
                except Exception:
                    received_at = datetime.now(timezone.utc)
                if received_at.tzinfo is None:
                    received_at = received_at.replace(tzinfo=timezone.utc)
                messages.append(
                    MailMessage(
                        uid=uid.decode(),
                        subject=subject or "(no subject)",
                        sender_name=sender_name,
                        sender_email=sender_email,
                        received_at=received_at,
                        snippet=_plain_body(msg),
                        flagged=flagged,
                        folder=folder,
                    )
                )
        messages.sort(key=lambda m: m.received_at, reverse=True)
        return messages
    finally:
        try:
            imap.logout()
        except Exception:
            pass
