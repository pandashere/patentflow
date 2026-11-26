"""成员管理:添加 / 修改角色团队 / 停用(离职交接)/ 恢复。"""
from __future__ import annotations

from typing import Any

from ..security import new_id
from ..timeutil import now
from .common import bump
from .constants import ROLES
from .ctx import Ctx
from .errors import bad_request, conflict, forbidden, not_found
from .notifications import notify
from .repo import load_patents


def _require_gl(ctx: Ctx) -> None:
    if ctx.me["role"] != "gl":
        raise forbidden("仅 GL 可管理成员")


async def _team(ctx: Ctx, tid: str) -> dict[str, Any]:
    async with ctx.conn.execute("SELECT * FROM teams WHERE id = ?", (tid,)) as cur:
        t = await cur.fetchone()
    if not t:
        raise bad_request("团队不存在")
    return dict(t)


async def add_member(ctx: Ctx, m: dict[str, Any]) -> str:
    _require_gl(ctx)
    name, email = str(m.get("name", "")).strip(), str(m.get("email", "")).strip().lower()
    if not name or "@" not in email:
        raise bad_request("请填写姓名与有效邮箱")
    role = m.get("role", "user")
    if role not in ROLES:
        raise bad_request("角色非法")
    await _team(ctx, m.get("teamId", ""))
    async with ctx.conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)) as cur:
        if await cur.fetchone():
            raise conflict("该邮箱已存在")
    uid = new_id("u-")
    await ctx.conn.execute(
        "INSERT INTO users(id, name, email, title, role, team_id, created_at) VALUES(?,?,?,?,?,?,?)",
        (uid, name, email, str(m.get("title", "")), role, m["teamId"], now()),
    )
    return uid


async def update_member(ctx: Ctx, uid: str, patch: dict[str, Any]) -> None:
    _require_gl(ctx)
    async with ctx.conn.execute("SELECT * FROM users WHERE id = ?", (uid,)) as cur:
        u = await cur.fetchone()
    if not u:
        raise not_found("成员")
    sets: dict[str, Any] = {}
    if "role" in patch and patch["role"] != u["role"]:
        if patch["role"] not in ROLES:
            raise bad_request("角色非法")
        if u["email"].lower() in ctx.settings.admins and patch["role"] != "gl":
            raise forbidden("配置文件管理员不可在 UI/API 中降级,请修改 patentflow.config.yaml 并重启")
        sets["role"] = patch["role"]
    if "teamId" in patch and patch["teamId"] != u["team_id"]:
        await _team(ctx, patch["teamId"])
        sets["team_id"] = patch["teamId"]  # 决策 30:专利留在原组,不随人迁移
    for k in ("name", "title"):
        if k in patch and str(patch[k]).strip():
            sets[k] = str(patch[k]).strip()
    if "email" in patch and str(patch["email"]).strip().lower() != u["email"].lower():
        if u["email"].lower() in ctx.settings.admins:
            raise forbidden("配置文件管理员的邮箱只能在配置文件中修改")
        sets["email"] = str(patch["email"]).strip().lower()
    if not sets:
        return
    cols = ", ".join(f"{k} = ?" for k in sets)
    epoch = ", session_epoch = session_epoch + 1" if "role" in sets else ""  # 角色变更后旧会话失效
    await ctx.conn.execute(f"UPDATE users SET {cols}{epoch} WHERE id = ?", (*sets.values(), uid))


async def deactivate(ctx: Ctx, uid: str, assignments: dict[str, str]) -> dict[str, int]:
    """离职交接:非私有专利必须逐件指定接收人;私有草案未由本人转交的,转团队可见并交给本组 PL。"""
    _require_gl(ctx)
    if uid == ctx.me["id"]:
        raise bad_request("不能停用自己")
    async with ctx.conn.execute("SELECT * FROM users WHERE id = ?", (uid,)) as cur:
        u = await cur.fetchone()
    if not u:
        raise not_found("成员")
    if u["deactivated_at"]:
        raise conflict("该成员已停用")
    if u["email"].lower() in ctx.settings.admins:
        raise forbidden("配置文件管理员不可停用")
    all_p = await load_patents(ctx.conn)
    owned = [p for p in all_p if p["ownerId"] == uid]
    missing = [p["id"] for p in owned if p["visibility"] != "private" and p["id"] not in assignments]
    if missing:
        raise bad_request(f"还有 {len(missing)} 件非私有专利未指定接收人", code="unassigned", patentIds=missing)
    async with ctx.conn.execute(
        "SELECT id FROM users WHERE role='pl' AND team_id=? AND id != ? AND deactivated_at IS NULL ORDER BY id LIMIT 1",
        (u["team_id"], uid),
    ) as cur:
        pl = await cur.fetchone()
    fallback = pl["id"] if pl else ctx.me["id"]

    async def check_recipient(rid: str) -> None:
        async with ctx.conn.execute("SELECT 1 FROM users WHERE id = ? AND deactivated_at IS NULL", (rid,)) as cur:
            if rid == uid or not await cur.fetchone():
                raise bad_request("接收人不存在或已停用")

    moved = 0
    for p in owned:
        to = assignments.get(p["id"]) if p["visibility"] != "private" else None  # 私有草案 GL 不可指定
        if to:
            await check_recipient(to)
        target = to or fallback
        collab = [c for c in p["collaborators"] if c != target]
        cols: dict[str, Any] = {"owner_id": target, "collaborators": collab}
        if p["visibility"] == "private":
            cols["visibility"] = "team"
        await bump(ctx, p["id"], **cols)
        p.update(ownerId=target, collaborators=collab, visibility=cols.get("visibility", p["visibility"]))
        await notify(ctx, "transition", f"《{p['title']}》因 {u['name']} 停用已交接给你", p, only=[target])
        moved += 1

    # 撤销其未提交的审查邀请,通知相关发明人
    async with ctx.conn.execute(
        """SELECT a.patent_id FROM review_assignments a JOIN patents p ON p.id = a.patent_id
           WHERE a.user_id = ? AND a.round = p.review_round AND a.score IS NULL AND a.declined_at IS NULL""",
        (uid,),
    ) as cur:
        pending = [r["patent_id"] for r in await cur.fetchall()]
    for pid in pending:
        await ctx.conn.execute(
            "DELETE FROM review_assignments WHERE patent_id = ? AND user_id = ? AND score IS NULL "
            "AND round = (SELECT review_round FROM patents WHERE id = ?)", (pid, uid, pid))
        p = next(x for x in all_p if x["id"] == pid)
        await bump(ctx, pid)
        await notify(ctx, "review", f"{u['name']} 已停用,其对《{p['title']}》的审查邀请已撤销,请补邀 reviewer", p,
                     only=[p["ownerId"]])

    await ctx.conn.execute("UPDATE api_tokens SET revoked = 1 WHERE user_id = ?", (uid,))
    await ctx.conn.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
    await ctx.conn.execute(
        "UPDATE users SET deactivated_at = ?, deactivated_by = ?, session_epoch = session_epoch + 1 WHERE id = ?",
        (now(), ctx.me["id"], uid),
    )
    return {"transferred": moved, "reviewsWithdrawn": len(pending)}


async def reactivate(ctx: Ctx, uid: str) -> None:
    _require_gl(ctx)
    cur = await ctx.conn.execute(
        "UPDATE users SET deactivated_at = NULL, deactivated_by = NULL WHERE id = ? AND deactivated_at IS NOT NULL", (uid,))
    if cur.rowcount == 0:
        raise conflict("该成员未停用")
