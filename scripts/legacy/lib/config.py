import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass
class Config:
    zoho_email: str
    zoho_app_password: str
    zoho_imap_host: str
    zoho_imap_port: int
    zoho_caldav_url: str
    zoho_caldav_user: str
    zoho_caldav_password: str
    pm_db_host: str
    pm_db_port: int
    pm_db_user: str
    pm_db_password: str
    pm_db_name: str
    anthropic_api_key: str
    tz: str
    user_name: str
    user_role: str


def load_config() -> Config:
    load_dotenv(REPO_ROOT / ".env")
    return Config(
        zoho_email=os.getenv("ZOHO_EMAIL", ""),
        zoho_app_password=os.getenv("ZOHO_APP_PASSWORD", ""),
        zoho_imap_host=os.getenv("ZOHO_IMAP_HOST", "imap.zoho.com"),
        zoho_imap_port=int(os.getenv("ZOHO_IMAP_PORT", "993")),
        zoho_caldav_url=os.getenv("ZOHO_CALDAV_URL", "https://calendar.zoho.com/caldav"),
        zoho_caldav_user=os.getenv("ZOHO_CALDAV_USER", ""),
        zoho_caldav_password=os.getenv("ZOHO_CALDAV_PASSWORD", ""),
        pm_db_host=os.getenv("PM_DB_HOST", "localhost"),
        pm_db_port=int(os.getenv("PM_DB_PORT", "3306")),
        pm_db_user=os.getenv("PM_DB_USER", ""),
        pm_db_password=os.getenv("PM_DB_PASSWORD", ""),
        pm_db_name=os.getenv("PM_DB_NAME", ""),
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""),
        tz=os.getenv("TZ", "America/New_York"),
        user_name=os.getenv("USER_NAME", "there"),
        user_role=os.getenv("USER_ROLE", ""),
    )
