"""Codex review 第 5 轮修复的回归测试。"""
from __future__ import annotations

from tests.helpers import H, db_exec, world
from tests.test_patents import mk


def test_stale_collaborator_list_rejected(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    p = mk(client)
    url = f"/api/patents/{p['id']}/collaborators"
    rev0 = client.put(url, json={"userIds": ["u3"]}, headers=H("u1")).json()["rev"]
    client.put(url, json={"userIds": [], "rev": rev0}, headers=H("pl1"))  # PL 移除外组 u3
    r = client.put(url, json={"userIds": ["u3", "u2"], "rev": rev0}, headers=H("u1"))  # 旧页面
    assert r.status_code == 409
    assert client.get(f"/api/patents/{p['id']}", headers=H("u3")).status_code == 404


def test_deactivated_collaborator_does_not_block_edits(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    url = f"/api/patents/{pid}/collaborators"
    client.put(url, json={"userIds": ["u2"]}, headers=H("u1"))
    client.post("/api/users/u2/deactivate", json={}, headers=H("gl"))
    assert client.put(url, json={"userIds": ["u2", "r1"]}, headers=H("u1")).status_code == 200  # 保留已停用者
    assert client.put(url, json={"userIds": ["r1"]}, headers=H("u1")).json()["collaborators"] == ["r1"]  # 移除


def test_config_partial_update_does_not_clobber(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    client.put("/api/config", json={"overdue": {"freezeAdvanceOnOverdue": True}}, headers=H("gl"))
    client.put("/api/config", json={"reviewerDueDays": 10}, headers=H("gl"))
    cfg = client.get("/api/config", headers=H("gl")).json()
    assert cfg["overdue"]["freezeAdvanceOnOverdue"] is True and cfg["reviewerDueDays"] == 10
    assert cfg["overdue"]["extensionApprovalThreshold"] == 14  # 同级其他字段未被清空


def test_closing_cycle_keeps_patent_attribution(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    assert client.get(f"/api/patents/{pid}", headers=H("u1")).json()["cycleId"] == "c26"
    client.post("/api/cycles", json={"name": "新", "start": "2026-11-01", "end": "2027-12-31"}, headers=H("gl"))
    client.post("/api/cycles/c26/close", headers=H("gl"))
    assert client.get(f"/api/patents/{pid}", headers=H("u1")).json()["cycleId"] == "c26"
    # 归属仍是已收口的 c26:不能延期到其结束日之后
    r = client.post(f"/api/patents/{pid}/extensions", json={"newDue": "2027-01-10", "reason": "x"}, headers=H("u1"))
    assert r.json()["code"] == "beyond_cycle"


def test_extension_form_bound_to_stage(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    client.post(f"/api/patents/{pid}/advance", json={"reason": "go"}, headers=H("u1"))
    r = client.post(f"/api/patents/{pid}/extensions", json={"newDue": "2026-12-20", "reason": "x", "stage": "draft"},
                    headers=H("pl1"))
    assert r.status_code == 409


def test_new_cycle_adopts_and_clamps_unattributed_patents(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    db_exec(client, "DELETE FROM cycles")
    pid = mk(client)["id"]  # 无覆盖周期,截止 2026-12-10
    assert client.get(f"/api/patents/{pid}", headers=H("u1")).json()["cycleId"] is None
    c = client.post("/api/cycles", json={"name": "短周期", "start": "2026-11-01", "end": "2026-12-01"}, headers=H("gl")).json()
    p = client.get(f"/api/patents/{pid}", headers=H("u1")).json()
    assert p["cycleId"] == c["id"] and p["dueDates"]["draft"] == "2026-12-01"
