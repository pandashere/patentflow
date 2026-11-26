"""Codex review 第 6 轮修复的回归测试。"""
from __future__ import annotations

from tests.helpers import H, db_exec, world
from tests.test_patents import adv, mk, score


def test_archived_through_cycle_excluded_after_late_unarchive(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    a = mk(client, title="甲")["id"]
    b = mk(client, title="乙")["id"]
    db_exec(client, "UPDATE patents SET created_at='2025-11-01' WHERE id IN (?,?)", (a, b))
    db_exec(client, "INSERT INTO transitions VALUES('x1',?,'draft','draft','archive','u1','2025-12-15 10:00','完成归档:x')", (a,))
    db_exec(client, "INSERT INTO transitions VALUES('x2',?,'draft','draft','unarchive','u1','2027-01-02 10:00','恢复归档:x')", (a,))
    db_exec(client, "INSERT INTO transitions VALUES('x3',?,'draft','patentability','advance','u1','2026-03-01 10:00','')", (b,))
    rid = client.post("/api/kpi/rules", json={"name": "R", "scope": {"type": "global"}, "cycleId": "c26",
                      "targets": [{"stage": "patentability", "deadline": "2026-12-31"}]}, headers=H("gl")).json()["id"]
    rep = client.get(f"/api/kpi/rules/{rid}/report", headers=H("gl")).json()
    assert [i["title"] for i in rep["items"]] == ["乙"] and rep["overall"] == 1.0


def test_team_delete_does_not_reveal_private_drafts(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    t = client.post("/api/teams", json={"name": "临时组"}, headers=H("gl")).json()
    client.patch("/api/users/u3", json={"teamId": t["id"]}, headers=H("gl"))
    mk(client, "u3", vis="private")
    client.patch("/api/users/u3", json={"teamId": "t2"}, headers=H("gl"))
    # 只剩私有草案引用:GL 看到的结果与真正的空团队一致(删除成功、从列表中消失)
    assert client.delete(f"/api/teams/{t['id']}", headers=H("gl")).status_code == 200
    active = [x for x in client.get("/api/teams", headers=H("gl")).json() if not x["archived"]]
    assert all(x["id"] != t["id"] for x in active)
    assert all(x["id"] != t["id"] for x in client.get("/api/auth/teams").json())


def test_team_with_only_deactivated_member_can_be_removed(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    t = client.post("/api/teams", json={"name": "小组"}, headers=H("gl")).json()
    client.patch("/api/users/u3", json={"teamId": t["id"]}, headers=H("gl"))
    client.post("/api/users/u3/deactivate", json={}, headers=H("gl"))
    assert client.delete(f"/api/teams/{t['id']}", headers=H("gl")).status_code == 200


def test_config_deep_merge(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    client.put("/api/config", json={"notifyDefaults": {"transition": {"gl": False}}}, headers=H("gl"))
    client.put("/api/config", json={"notifyDefaults": {"transition": {"pl": False}}}, headers=H("gl"))
    t = client.get("/api/config", headers=H("gl")).json()["notifyDefaults"]["transition"]
    assert t == {"owner": True, "pl": False, "gl": False}


def test_rollback_into_review_notifies_inherited_reviewers(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    adv(client, pid)
    for r in ("r1", "r2"):
        client.post(f"/api/patents/{pid}/reviewers", json={"userId": r}, headers=H("u1"))
        client.post(f"/api/patents/{pid}/reviews", json=score(), headers=H(r))
    adv(client, pid)
    client.post(f"/api/patents/{pid}/rollback", json={"to": "patentability", "reason": "重审"}, headers=H("u1"))
    assert any("第 2 轮审查" in n["text"] for n in client.get("/api/notifications", headers=H("r1")).json())
