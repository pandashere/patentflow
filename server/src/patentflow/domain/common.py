"""专利写操作的公共工具:加载+鉴权、乐观锁、流转记录、周期归属等。"""
from __future__ import annotations

from typing import Any

import aiosqlite

from ..db import dumps
from ..security import new_id
from ..timeutil import add_days, days_between, now, today
from . import access
from .constants import stage_label
from .ctx import Ctx
from .errors import conflict, forbidden, not_found
from .repo import load_patent


async def get_visible(ctx: Ctx, pid: str) -> dict[str, Any]:
    p = await load_patent(ctx.conn, pid)
    if not p or not access.can_see(ctx.me, p):
        raise not_found("专利")
    return p


async def get_operable(ctx: Ctx, pid: str, *, allow_archived: bool = False) -> dict[str, Any]:
    p = await get_visible(ctx, pid)
    if not access.can_operate(ctx.me, p):
        raise forbidden("只有负责人、本组 PL 或 GL 可以执行该操作")
    if p["archived"] and not allow_archived:
        raise conflict("专利已归档,内容只读;如需操作请先恢复归档")
    return p


async def bump(ctx: Ctx, pid: str, expected_rev: int | None = None, **cols: Any) -> None:
    """更新专利字段并 rev+1;传入 expected_rev 时做乐观锁校验。"""
    sets = ", ".join(f"{k} = ?" for k in cols)
    vals = [dumps(v) if isinstance(v, (dict, list)) else v for v in cols.values()]
    sql = f"UPDATE patents SET {sets + ', ' if sets else ''}rev = rev + 1 WHERE id = ?"
    params: list[Any] = [*vals, pid]
    if expected_rev is not None:
        sql += " AND rev = ?"
        params.append(expected_rev)
    cur = await ctx.conn.execute(sql, params)
    if cur.rowcount == 0:
        raise conflict("该专利刚被他人修改(例如已推进或回退),页面已刷新,请确认当前状态后再操作", reason="stale_rev")


async def add_transition(ctx: Ctx, pid: str, frm: str | None, to: str, kind: str, reason: str) -> None:
    await ctx.conn.execute(
        "INSERT INTO transitions(id, patent_id, from_stage, to_stage, kind, operator_id, at, reason) VALUES(?,?,?,?,?,?,?,?)",
        (new_id("tr"), pid, frm, to, kind, ctx.me["id"], now(), reason),
    )


async def has_left_draft(conn: aiosqlite.Connection, p: dict[str, Any]) -> bool:
    if p["stage"] != "draft":
        return True
    async with conn.execute(
        "SELECT 1 FROM transitions WHERE patent_id = ? AND from_stage = 'draft' AND to_stage != 'draft' LIMIT 1",
        (p["id"],),
    ) as cur:
        return await cur.fetchone() is not None


async def cycle_of(conn: aiosqlite.Connection, created_at: str) -> dict[str, Any] | None:
    """专利按创建日归入周期;多个重叠时优先进行中的周期,再取最早开始者
    (避免提前收口的旧周期继续吸收新专利)。"""
    async with conn.execute(
        """SELECT * FROM cycles WHERE start <= ? AND end >= ?
           ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, start LIMIT 1""",
        (created_at[:10], created_at[:10])
    ) as cur:
        r = await cur.fetchone()
    return dict(r) if r else None


async def default_due(ctx: Ctx, stage: str, created_at: str, cross_cycle: bool) -> str:
    """阶段默认截止日:今天 + 默认周期;非跨周期项目按所属周期结束日截断。"""
    due = add_days(today(), int(ctx.cfg["stageDefaults"][stage]))
    c = await cycle_of(ctx.conn, created_at)
    if c and not cross_cycle and due > c["end"]:
        due = c["end"]
    return due


async def void_pending_extensions(ctx: Ctx, pid: str) -> None:
    await ctx.conn.execute("UPDATE extensions SET status = 'void' WHERE patent_id = ? AND status = 'pending'", (pid,))


def overdue_days(p: dict[str, Any]) -> int:
    if p["archived"]:
        return 0
    due = p["dueDates"].get(p["stage"])
    return max(0, days_between(due, today())) if due else 0


def label(stage: str) -> str:
    return stage_label(stage)
