"""权限判定 —— 后端唯一权威(前端隐藏按钮只是体验层)。

- private:仅负责人与共同发明人(以及被邀请的 reviewer,但私有只能停留在草案,实际不会有 reviewer)
- team:同组成员 + 本组 PL + GL
- public:全员只读
- reviewer 例外通道:被邀请审查的专利可见(不受 visibility 限制)
"""
from __future__ import annotations

from typing import Any

User = dict[str, Any]
Patent = dict[str, Any]


def is_reviewer(me: User, p: Patent) -> bool:
    return me["id"] in p.get("_reviewerIds", set())


def can_see(me: User, p: Patent) -> bool:
    if p["ownerId"] == me["id"] or me["id"] in p["collaborators"]:
        return True
    if is_reviewer(me, p):
        return True
    if p["visibility"] == "public":
        return True
    if p["visibility"] == "team":
        return me["role"] == "gl" or me["teamId"] == p["teamId"]
    return False


def is_team_manager(me: User, p: Patent) -> bool:
    return me["role"] == "gl" or (me["role"] == "pl" and me["teamId"] == p["teamId"])


def can_edit(me: User, p: Patent) -> bool:
    """编辑阶段内容:负责人 / 共同发明人 / 本组 PL / GL(且必须可见)。"""
    if not can_see(me, p):
        return False
    return p["ownerId"] == me["id"] or me["id"] in p["collaborators"] or (
        p["visibility"] != "private" and is_team_manager(me, p)
    )


def can_operate(me: User, p: Patent) -> bool:
    """推进 / 回退 / 归档 / 转交 / 延期 / 可见性:负责人 / 本组 PL / GL。"""
    if not can_see(me, p):
        return False
    return p["ownerId"] == me["id"] or (p["visibility"] != "private" and is_team_manager(me, p))
