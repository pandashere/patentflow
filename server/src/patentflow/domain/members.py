"""成员管理:添加 / 修改角色团队 / 停用(离职交接)/ 恢复。"""
from __future__ import annotations

from typing import Any

from ..security import hash_password, new_id
from ..timeutil import now
from .accounts import ACTIVATION_TTL_MINUTES, issue_password_link
from .patents import publish_code
from .common import bump
from .constants import ROLES
from .ctx import Ctx
from .errors import bad_request, conflict, forbidden, not_found
from .notifications import notify
from .repo import load_patents


async def clear_stale_leadership(conn: Any, uid: str, new_role: str | None, new_team: str | None) -> None:
    """角色降为普通用户或调离团队后,撤销其失效的团队负责人指派(业务后台与系统管理员后台共用)。"""
    if new_role == "user":
        await conn.execute("UPDATE teams SET pl_id = NULL WHERE pl_id = ?", (uid,))
    elif new_team:
        await conn.execute("UPDATE teams SET pl_id = NULL WHERE pl_id = ? AND id != ?", (uid, new_team))


def _require_gl(ctx: Ctx) -> None:
    if ctx.me["role"] != "gl":
        raise forbidden("仅 GL 可管理成员")


def can_manage_team(ctx: Ctx, team_id: str) -> bool:
    """添加成员 / 审批注册:GL 任意团队;本组 PL(GL 可在配置中关闭)。系统管理员走独立后台。"""
    if ctx.me["role"] == "gl":
        return True
    return (ctx.me["role"] == "pl" and ctx.me["teamId"] == team_id
            and bool(ctx.cfg.get("members", {}).get("plCanManage", True)))


async def _team(ctx: Ctx, tid: str) -> dict[str, Any]:
    async with ctx.conn.execute("SELECT * FROM teams WHERE id = ? AND archived_at IS NULL", (tid,)) as cur:
        t = await cur.fetchone()
    if not t:
        raise bad_request("请选择有效的团队")
    return dict(t)


async def _check_email_free(ctx: Ctx, email: str) -> None:
    async with ctx.conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)) as cur:
        if await cur.fetchone():
            raise conflict("该邮箱已注册;如忘记密码,请在登录页使用「忘记密码」")


async def add_member(ctx: Ctx, m: dict[str, Any], base_url: str) -> tuple[str, str]:
    """添加成员:必须指定团队。PL 只能向本组添加普通用户。
    新账号没有密码 —— 生成 7 天有效的激活链接,经通知接口发给本人,并返回给添加人(只显示一次)。"""
    name, email = str(m.get("name", "")).strip(), str(m.get("email", "")).strip().lower()
    if not name or "@" not in email:
        raise bad_request("请填写姓名与有效邮箱")
    role = m.get("role", "user")
    if role not in ROLES:
        raise bad_request("角色非法")
    team = await _team(ctx, str(m.get("teamId", "")))
    if not can_manage_team(ctx, team["id"]):
        raise forbidden("你只能向自己负责的团队添加成员")
    if ctx.me["role"] != "gl" and role != "user":
        raise forbidden("PL 只能添加普通用户;PL / GL 角色请由 GL 设置")
    await _check_email_free(ctx, email)
    uid = new_id("u-")
    await ctx.conn.execute(
        "INSERT INTO users(id, name, email, title, role, team_id, created_at) VALUES(?,?,?,?,?,?,?)",
        (uid, name, email, str(m.get("title", "")).strip(), role, team["id"], now()),
    )
    link = await issue_password_link(ctx.conn, uid, base_url, ACTIVATION_TTL_MINUTES)
    await notify(ctx, "transition", f"{ctx.me['name']} 为你开通了 PATENTFLOW 账号({team['name']})",
                 only=[uid], security=True,
                 external_text=f"{ctx.me['name']} 为你开通了 PATENTFLOW 账号({team['name']}),请在 7 天内设置密码:{link}")
    return uid, link


# —— 自助注册与审批 ——
async def approvers_of(ctx: Ctx, team_id: str) -> list[str]:
    ids = []
    async with ctx.conn.execute(
        "SELECT id, role, team_id FROM users WHERE role IN ('gl','pl') AND deactivated_at IS NULL AND pending_at IS NULL"
    ) as cur:
        for r in await cur.fetchall():
            if r["role"] == "gl" or (r["team_id"] == team_id and ctx.cfg["members"].get("plCanManage", True)):
                ids.append(r["id"])
    return ids


async def register(ctx: Ctx, m: dict[str, Any]) -> str:
    if not ctx.cfg["members"].get("selfRegistration", True):
        raise forbidden("自助注册已关闭,请联系本组 PL 或 GL 为你开通账号")
    name, email = str(m.get("name", "")).strip(), str(m.get("email", "")).strip().lower()
    if not name or "@" not in email:
        raise bad_request("请填写姓名与有效邮箱")
    if len(str(m.get("password", ""))) < 8:
        raise bad_request("密码至少 8 位")
    team = await _team(ctx, str(m.get("teamId", "")))
    await _check_email_free(ctx, email)
    uid = new_id("u-")
    await ctx.conn.execute(
        """INSERT INTO users(id, name, email, title, role, team_id, password_hash, pending_at, created_at)
           VALUES(?,?,?,?, 'user', ?,?,?,?)""",
        (uid, name, email, str(m.get("title", "")).strip(), team["id"], hash_password(str(m["password"])), now(), now()),
    )
    await notify(ctx, "transition", f"新注册待审批:{name}({email})申请加入「{team['name']}」",
                 only=await approvers_of(ctx, team["id"]))
    return uid


async def _pending(ctx: Ctx, uid: str) -> dict[str, Any]:
    async with ctx.conn.execute("SELECT * FROM users WHERE id = ? AND pending_at IS NOT NULL", (uid,)) as cur:
        u = await cur.fetchone()
    if not u:
        raise not_found("待审批的注册")
    return dict(u)


async def approve(ctx: Ctx, uid: str, team_id: str | None = None, role: str | None = None) -> None:
    """审批通过:GL 可调整团队与角色;PL 只能按原团队、普通用户通过。"""
    u = await _pending(ctx, uid)
    if not can_manage_team(ctx, u["team_id"]):
        raise forbidden("只有 GL 或该团队的 PL 可以审批")
    team_id = team_id or u["team_id"]
    role = role or "user"
    if ctx.me["role"] != "gl" and (team_id != u["team_id"] or role != "user"):
        raise forbidden("PL 只能按申请的团队、以普通用户身份通过;如需调整请由 GL 审批")
    if role not in ROLES:
        raise bad_request("角色非法")
    await _team(ctx, team_id)
    await ctx.conn.execute("UPDATE users SET pending_at = NULL, team_id = ?, role = ? WHERE id = ?", (team_id, role, uid))
    await notify(ctx, "transition", f"你的 PATENTFLOW 注册已通过审批({ctx.me['name']}),现在可以登录了",
                 only=[uid], security=True)


async def reject(ctx: Ctx, uid: str, reason: str) -> None:
    if not reason.strip():
        raise bad_request("请填写拒绝原因(会告知申请人)")
    u = await _pending(ctx, uid)
    if not can_manage_team(ctx, u["team_id"]):
        raise forbidden("只有 GL 或该团队的 PL 可以审批")
    # 通知需在删除前发出(收件人须存在)
    await notify(ctx, "transition", f"你的 PATENTFLOW 注册未通过:{reason.strip()}",
                 only=[uid], security=True)
    for t in ("notifications", "password_resets", "user_prefs", "sessions", "api_tokens"):
        await ctx.conn.execute(f"DELETE FROM {t} WHERE user_id = ?", (uid,))
    await ctx.conn.execute("DELETE FROM users WHERE id = ?", (uid,))


# —— 团队(GL)——
async def create_team(ctx: Ctx, name: str, pl_id: str | None, demote_old: bool = True) -> str:
    _require_gl(ctx)
    name = name.strip()
    if not name:
        raise bad_request("请填写团队名称")
    async with ctx.conn.execute("SELECT 1 FROM teams WHERE name = ? AND archived_at IS NULL", (name,)) as cur:
        if await cur.fetchone():
            raise conflict("已有同名团队")
    tid = new_id("t-")
    await ctx.conn.execute("INSERT INTO teams(id, name, pl_id) VALUES(?,?,NULL)", (tid, name))
    if pl_id:
        await set_team_pl(ctx, tid, pl_id, demote_old)
    return tid


async def rename_team(ctx: Ctx, tid: str, name: str) -> None:
    _require_gl(ctx)
    await _team(ctx, tid)
    if not name.strip():
        raise bad_request("请填写团队名称")
    await ctx.conn.execute("UPDATE teams SET name = ? WHERE id = ?", (name.strip(), tid))


async def delete_team(ctx: Ctx, tid: str) -> None:
    _require_gl(ctx)
    await _team(ctx, tid)
    async with ctx.conn.execute(
        "SELECT COUNT(*) n FROM users WHERE team_id = ? AND deactivated_at IS NULL AND pending_at IS NULL", (tid,)
    ) as c:
        if (await c.fetchone())["n"]:
            raise conflict("团队仍有在职成员,请先把成员调到其他团队")
    # 可见专利的检查以 GL 能看到的为准;私有草案、停用 / 待审批账号的引用不暴露给 GL(决策 9):
    async with ctx.conn.execute(
        "SELECT COUNT(*) n FROM patents WHERE team_id = ? AND visibility != 'private'", (tid,)
    ) as c:
        if (await c.fetchone())["n"]:
            raise conflict("团队仍有专利(含归档),请先迁移到其他团队")
    # 一律停用(软删除):无论是否仍被私有草案 / 停用账号引用,GL 观察到的结果都相同(决策 9)
    await ctx.conn.execute("UPDATE teams SET archived_at = ?, pl_id = NULL WHERE id = ?", (now(), tid))


async def _leads_other(ctx: Ctx, uid: str, except_tid: str) -> bool:
    async with ctx.conn.execute("SELECT 1 FROM teams WHERE pl_id = ? AND id != ?", (uid, except_tid)) as cur:
        return await cur.fetchone() is not None


async def set_team_pl(ctx: Ctx, tid: str, uid: str | None, demote_old: bool = True) -> dict[str, Any]:
    """指定 / 更换 / 撤销团队 PL。
    - 新 PL 若在其他团队,随之调入本组(其名下专利按决策 30 留在原组);角色升为 PL(GL 保持 GL)
    - 原 PL 默认降为普通用户(仍负责其他团队时保留 PL),可选择保留
    - 角色变化的账号会话失效,需重新登录以刷新权限"""
    _require_gl(ctx)
    team = await _team(ctx, tid)
    old = team["pl_id"]
    if uid == old:
        return {"changed": False}
    moved = False
    if uid:
        async with ctx.conn.execute(
            "SELECT * FROM users WHERE id = ? AND deactivated_at IS NULL AND pending_at IS NULL", (uid,)
        ) as cur:
            u = await cur.fetchone()
        if not u:
            raise bad_request("该成员不存在或已停用")
        if await _leads_other(ctx, uid, tid) and u["team_id"] != tid:
            raise conflict(f"{u['name']} 目前是其他团队的 PL,请先为原团队指定新 PL")
        moved = u["team_id"] != tid
        new_role = "gl" if u["role"] == "gl" else "pl"
        epoch = ", session_epoch = session_epoch + 1" if new_role != u["role"] else ""
        await ctx.conn.execute(f"UPDATE users SET role = ?, team_id = ?{epoch} WHERE id = ?", (new_role, tid, uid))
    await ctx.conn.execute("UPDATE teams SET pl_id = ? WHERE id = ?", (uid, tid))
    demoted = False
    if old and demote_old and not await _leads_other(ctx, old, tid):
        cur = await ctx.conn.execute(
            "UPDATE users SET role = 'user', session_epoch = session_epoch + 1 WHERE id = ? AND role = 'pl'", (old,))
        demoted = cur.rowcount == 1
    if uid:
        await notify(ctx, "transition", f"你已被指定为「{team['name']}」的 PL", only=[uid])
    if old:
        await notify(ctx, "transition", f"「{team['name']}」的 PL 已变更" + ("" if uid else "为空缺")
                     + (",你的角色已调整为普通用户" if demoted else ""), only=[old])
    return {"changed": True, "moved": moved, "demoted": demoted}


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
        if uid == ctx.me["id"] and patch["role"] != "gl":
            raise bad_request("不能降级自己;如需调整请由其他 GL 或系统管理员操作")
        sets["role"] = patch["role"]
    if "teamId" in patch and patch["teamId"] != u["team_id"]:
        await _team(ctx, patch["teamId"])
        sets["team_id"] = patch["teamId"]  # 决策 30:专利留在原组,不随人迁移
    for k in ("name", "title"):
        if k in patch and str(patch[k]).strip():
            sets[k] = str(patch[k]).strip()
    # 邮箱是登录名与安全通知地址:GL 不能改(否则可借「忘记密码」接管账号,读到对方私有草案);
    # 由本人在个人中心修改,或由系统管理员处理
    if not sets:
        return
    cols = ", ".join(f"{k} = ?" for k in sets)
    epoch = ", session_epoch = session_epoch + 1" if "role" in sets else ""  # 角色变更后旧会话失效
    await ctx.conn.execute(f"UPDATE users SET {cols}{epoch} WHERE id = ?", (*sets.values(), uid))
    await clear_stale_leadership(ctx.conn, uid, sets.get("role"), sets.get("team_id"))


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
    all_p = await load_patents(ctx.conn)
    owned = [p for p in all_p if p["ownerId"] == uid]
    missing = [p["id"] for p in owned if p["visibility"] != "private" and p["id"] not in assignments]
    if missing:
        raise bad_request(f"还有 {len(missing)} 件非私有专利未指定接收人", code="unassigned", patentIds=missing)
    # 私有草案未由本人转交的,交给「该专利所属团队」的现任 PL(teams.pl_id);
    # PL 空缺或就是本人时,交给执行停用的 GL
    async def fallback_for(team_id: str) -> str:
        async with ctx.conn.execute(
            """SELECT u.id FROM teams t JOIN users u ON u.id = t.pl_id
               WHERE t.id = ? AND u.id != ? AND u.deactivated_at IS NULL AND u.pending_at IS NULL""",
            (team_id, uid),
        ) as cur:
            pl = await cur.fetchone()
        return pl["id"] if pl else ctx.me["id"]

    async def check_recipient(rid: str) -> None:
        async with ctx.conn.execute(
            "SELECT 1 FROM users WHERE id = ? AND deactivated_at IS NULL AND pending_at IS NULL", (rid,)
        ) as cur:
            if rid == uid or not await cur.fetchone():
                raise bad_request("接收人不存在或已停用")

    moved = 0
    for p in owned:
        to = assignments.get(p["id"]) if p["visibility"] != "private" else None  # 私有草案 GL 不可指定
        if to:
            await check_recipient(to)
        target = to or await fallback_for(p["teamId"])
        collab = [c for c in p["collaborators"] if c != target]
        cols: dict[str, Any] = {"owner_id": target, "collaborators": collab}
        if p["visibility"] == "private":
            cols["visibility"] = "team"
            await publish_code(ctx, p["id"], p["code"])
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
    await ctx.conn.execute("UPDATE teams SET pl_id = NULL WHERE pl_id = ?", (uid,))
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
