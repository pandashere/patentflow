"""业务配置(GL 在 UI 修改,存 settings 表,即时生效)。结构与前端 SystemConfig 一致。"""
from __future__ import annotations

import copy
from typing import Any

import aiosqlite

from ..db import dumps, loads

DEFAULT_SYSTEM: dict[str, Any] = {
    "reviewPassCount": 2,
    "reviewMinWeighted": 3.0,
    "reviewerDueDays": 7,
    "reviewDims": [
        {"key": "difficulty", "label": "技术难度", "weight": 1},
        {"key": "nonObviousness", "label": "非显而易见性", "weight": 1},
        {"key": "novelty", "label": "创新性", "weight": 1},
    ],
    "stageDefaults": {"draft": 14, "patentability": 7, "implementation": 30, "search": 21, "doi": 30},
    "classSuggestions": [],
    "numberPrefix": "PF",
    "webhookUrl": "",
    "ssoProviders": [],
    "notifyDefaults": {
        "review": {"owner": True, "pl": True, "gl": False},
        "due": {"owner": True, "pl": True, "gl": False},
        "transition": {"owner": True, "pl": True, "gl": True},
    },
    "overdue": {
        "extensionApprovalThreshold": 14,
        "freezeAdvanceOnOverdue": False,
        "autoNudge": "off",
        "includeCrossCycleInKpi": True,
        "abandonExcludeDays": 30,
    },
}

# GL 可修改的键(ssoProviders 由部署配置决定,只读回显)
EDITABLE_KEYS = set(DEFAULT_SYSTEM) - {"ssoProviders"}


def merged_defaults(initial: dict[str, Any]) -> dict[str, Any]:
    cfg = copy.deepcopy(DEFAULT_SYSTEM)
    ov = initial.get("overdue") or {}
    if "extension_approval_threshold" in ov:
        cfg["overdue"]["extensionApprovalThreshold"] = int(ov["extension_approval_threshold"])
    if "freeze_advance_on_overdue" in ov:
        cfg["overdue"]["freezeAdvanceOnOverdue"] = bool(ov["freeze_advance_on_overdue"])
    kpi = initial.get("kpi") or {}
    if "include_cross_cycle" in kpi:
        cfg["overdue"]["includeCrossCycleInKpi"] = bool(kpi["include_cross_cycle"])
    notify = initial.get("notify") or {}
    if notify.get("auto_nudge") in ("off", "3d", "7d"):
        cfg["overdue"]["autoNudge"] = notify["auto_nudge"]
    if notify.get("webhook_url"):
        cfg["webhookUrl"] = notify["webhook_url"]
    return cfg


async def get_system(conn: aiosqlite.Connection) -> dict[str, Any]:
    async with conn.execute("SELECT value FROM settings WHERE key='system'") as cur:
        row = await cur.fetchone()
    cfg = copy.deepcopy(DEFAULT_SYSTEM)
    if row:
        stored = loads(row["value"], {})
        for k, v in stored.items():
            if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                cfg[k] = {**cfg[k], **v}
            else:
                cfg[k] = v
    return cfg


async def save_system(conn: aiosqlite.Connection, cfg: dict[str, Any]) -> None:
    await conn.execute(
        "INSERT INTO settings(key, value) VALUES('system', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (dumps(cfg),),
    )


def validate_system(cfg: dict[str, Any]) -> dict[str, Any]:
    """校验 GL 提交的配置,返回清洗后的值;非法值抛 ValueError。"""
    out = copy.deepcopy(DEFAULT_SYSTEM)
    for k in EDITABLE_KEYS:
        if k in cfg:
            out[k] = cfg[k]
    if not 1 <= int(out["reviewPassCount"]) <= 10:
        raise ValueError("通过人数 n 需在 1–10 之间")
    if not 1 <= float(out["reviewMinWeighted"]) <= 5:
        raise ValueError("加权均分下限需在 1–5 之间")
    if int(out["reviewerDueDays"]) < 1:
        raise ValueError("reviewer 审查期限至少 1 天")
    keys = [d.get("key") for d in out["reviewDims"]]
    if sorted(keys) != sorted(["difficulty", "nonObviousness", "novelty"]):
        raise ValueError("审查维度必须是 difficulty / nonObviousness / novelty 三项")
    if any(float(d.get("weight", 0)) < 0 for d in out["reviewDims"]):
        raise ValueError("维度权重不能为负")
    for s, n in out["stageDefaults"].items():
        if int(n) < 1:
            raise ValueError(f"阶段 {s} 默认周期至少 1 天")
    if int(out["overdue"]["extensionApprovalThreshold"]) < 0:
        raise ValueError("延期审批阈值不能为负")
    if int(out["overdue"]["abandonExcludeDays"]) < 0:
        raise ValueError("放弃归档提前量不能为负")
    return out
