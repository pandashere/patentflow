"""Codex review 第 7 轮修复的回归测试。"""
from __future__ import annotations

from tests.helpers import H, db_exec, world
from tests.test_patents import adv, mk, score


def test_abandon_in_cycle_then_late_unarchive_still_excluded(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    a = mk(client, title="甲")["id"]
    b = mk(client, title="乙")["id"]
    db_exec(client, "INSERT INTO transitions VALUES('y1',?,'draft','patentability','advance','u1','2026-03-01 10:00','')", (a,))
    db_exec(client, "INSERT INTO transitions VALUES('y2',?,'draft','draft','archive','u1','2026-04-15 10:00','放弃归档:x')", (b,))
    db_exec(client, "INSERT INTO transitions VALUES('y3',?,'draft','draft','unarchive','u1','2027-01-02 10:00','恢复归档:y')", (b,))
    rid = client.post("/api/kpi/rules", json={"name": "R", "scope": {"type": "global"}, "cycleId": "c26",
                      "targets": [{"stage": "patentability", "deadline": "2026-12-31"}]}, headers=H("gl")).json()["id"]
    rep = client.get(f"/api/kpi/rules/{rid}/report", headers=H("gl")).json()
    assert [i["title"] for i in rep["items"]] == ["甲"] and rep["overall"] == 1.0


def test_new_round_notification_hidden_after_withdraw(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    adv(client, pid)
    for r in ("r1", "r2"):
        client.post(f"/api/patents/{pid}/reviewers", json={"userId": r}, headers=H("u1"))
    client.post(f"/api/patents/{pid}/reviews", json=score("reject", 2, "不行"), headers=H("r2"))
    client.post(f"/api/patents/{pid}/reviews/rounds", headers=H("u1"))
    assert any("第 2 轮" in n["text"] for n in client.get("/api/notifications", headers=H("r1")).json())
    client.delete(f"/api/patents/{pid}/reviewers/r1", headers=H("u1"))
    assert not any("第 2 轮" in n["text"] for n in client.get("/api/notifications", headers=H("r1")).json())


def test_review_dims_merge_by_key(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    client.put("/api/config", json={"reviewDims": [{"key": "difficulty", "weight": 3}]}, headers=H("gl"))
    client.put("/api/config", json={"reviewDims": [{"key": "novelty", "label": "新颖性"}]}, headers=H("gl"))
    dims = {d["key"]: d for d in client.get("/api/config", headers=H("gl")).json()["reviewDims"]}
    assert dims["difficulty"]["weight"] == 3 and dims["novelty"]["label"] == "新颖性" and len(dims) == 3


def test_deleted_teams_look_identical(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    empty = client.post("/api/teams", json={"name": "空组"}, headers=H("gl")).json()["id"]
    client.delete(f"/api/teams/{empty}", headers=H("gl"))
    t = next(x for x in client.get("/api/export.json", headers=H("gl")).json()["teams"] if x["id"] == empty)
    assert t["archived"] is True
