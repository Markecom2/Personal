"""Read tasks from the custom PM tool (MySQL).

The concrete SQL is intentionally isolated to `fetch_tasks()` — swap the query to
match your schema. The rest of the pipeline consumes only PMTask objects.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Optional

import pymysql


@dataclass
class PMTask:
    id: str
    title: str
    project: str = ""
    status: str = ""
    priority: str = ""
    assignee: str = ""
    due_date: Optional[date] = None
    updated_at: Optional[datetime] = None
    url: str = ""
    notes: str = ""


# ---------------------------------------------------------------------------
# EDIT THIS QUERY to match your PM schema.
# Expected result columns match PMTask fields (by position or by alias).
# Ships as a placeholder that will fail loudly until you wire real tables.
# ---------------------------------------------------------------------------
DEFAULT_QUERY = """
SELECT
    t.id             AS id,
    t.title          AS title,
    p.name           AS project,
    t.status         AS status,
    t.priority       AS priority,
    u.name           AS assignee,
    t.due_date       AS due_date,
    t.updated_at     AS updated_at,
    t.url            AS url,
    t.notes          AS notes
FROM tasks t
LEFT JOIN projects p ON p.id = t.project_id
LEFT JOIN users u    ON u.id = t.assignee_id
WHERE t.status NOT IN ('done', 'archived', 'cancelled')
  AND (t.assignee_id = %(user_id)s OR t.watcher_id = %(user_id)s)
ORDER BY
    CASE t.priority
        WHEN 'urgent' THEN 0
        WHEN 'high'   THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low'    THEN 3
        ELSE 4
    END,
    (t.due_date IS NULL),
    t.due_date ASC,
    t.updated_at DESC
LIMIT 50
"""


def fetch_tasks(
    host: str,
    port: int,
    user: str,
    password: str,
    database: str,
    user_id: int | str | None = None,
    query: str = DEFAULT_QUERY,
) -> list[PMTask]:
    conn = pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10,
        read_timeout=15,
    )
    try:
        with conn.cursor() as cur:
            cur.execute(query, {"user_id": user_id})
            rows = cur.fetchall()
    finally:
        conn.close()

    tasks: list[PMTask] = []
    for row in rows:
        tasks.append(
            PMTask(
                id=str(row.get("id", "")),
                title=str(row.get("title", "") or ""),
                project=str(row.get("project", "") or ""),
                status=str(row.get("status", "") or ""),
                priority=str(row.get("priority", "") or ""),
                assignee=str(row.get("assignee", "") or ""),
                due_date=row.get("due_date"),
                updated_at=row.get("updated_at"),
                url=str(row.get("url", "") or ""),
                notes=str(row.get("notes", "") or ""),
            )
        )
    return tasks
