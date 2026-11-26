from __future__ import annotations

import copy
from typing import Any

import aiosqlite

from ..db import dumps, loads

DEFAULT_PREFS: dict[str, Any] = {
    "notifyEvents": {"review": True, "due": True, "transition": True},
    "dueReminderDays": [3, 1, 0],
    "quietHours": "22:00-08:00",
    "defaultVisibility": "team",
    "homePage": "dashboard",
}


async def get_prefs(conn: aiosqlite.Connection, uid: str) -> dict[str, Any]:
    async with conn.execute("SELECT prefs FROM user_prefs WHERE user_id=?", (uid,)) as cur:
        r = await cur.fetchone()
    p = copy.deepcopy(DEFAULT_PREFS)
    if r:
        p.update(loads(r["prefs"], {}))
    return p


async def save_prefs(conn: aiosqlite.Connection, uid: str, patch: dict[str, Any]) -> dict[str, Any]:
    p = await get_prefs(conn, uid)
    for k in DEFAULT_PREFS:
        if k in patch:
            p[k] = patch[k]
    if p["defaultVisibility"] not in ("private", "team", "public"):
        raise ValueError("defaultVisibility 非法")
    if p["homePage"] not in ("dashboard", "patents"):
        raise ValueError("homePage 非法")
    p["dueReminderDays"] = sorted({int(d) for d in p["dueReminderDays"] if 0 <= int(d) <= 30}, reverse=True)
    await conn.execute(
        "INSERT INTO user_prefs(user_id, prefs) VALUES(?, ?) ON CONFLICT(user_id) DO UPDATE SET prefs=excluded.prefs",
        (uid, dumps(p)),
    )
    return p


def in_quiet_hours(quiet: str, hhmm: str) -> bool:
    try:
        a, b = quiet.split("-")
    except ValueError:
        return False
    if a == b:
        return False
    return (a <= hhmm < b) if a < b else (hhmm >= a or hhmm < b)
