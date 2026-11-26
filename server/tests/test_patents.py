from __future__ import annotations

from tests.helpers import H, world


def mk(client, uid="u1", vis="team", title="测试专利"):  # type: ignore[no-untyped-def]
    r = client.post("/api/patents", json={"title": title, "visibility": vis}, headers=H(uid))
    assert r.status_code == 201, r.text
    return r.json()


def adv(client, pid, uid="u1", **kw):  # type: ignore[no-untyped-def]
    return client.post(f"/api/patents/{pid}/advance", json={"reason": "go", **kw}, headers=H(uid))


def score(v="pass", n=4, comment="ok"):  # type: ignore[no-untyped-def]
    return {"difficulty": n, "nonObviousness": n, "novelty": n, "comment": comment, "verdict": v}


def test_create_code_and_default_due(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    p = mk(client)
    assert p["code"] == "PF-2026-001" and p["stage"] == "draft"
    assert p["dueDates"]["draft"] == "2026-12-10"  # 今天 + 14
    assert mk(client)["code"] == "PF-2026-002"


def test_private_is_invisible_to_managers(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    p = mk(client, vis="private")
    for uid in ("pl1", "gl", "u2"):
        assert client.get(f"/api/patents/{p['id']}", headers=H(uid)).status_code == 404
        assert all(x["id"] != p["id"] for x in client.get("/api/patents", headers=H(uid)).json())
    assert client.get(f"/api/patents/{p['id']}", headers=H("u1")).status_code == 200
    # 私有不能推进
    assert adv(client, p["id"]).status_code == 409


def test_team_visibility(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    p = mk(client)
    assert client.get(f"/api/patents/{p['id']}", headers=H("u2")).status_code == 200
    assert client.get(f"/api/patents/{p['id']}", headers=H("gl")).status_code == 200
    assert client.get(f"/api/patents/{p['id']}", headers=H("u3")).status_code == 404
    # 同组成员能看不能操作
    assert adv(client, p["id"], "u2").status_code == 403
    assert adv(client, p["id"], "pl1").status_code == 200


def test_stage_versions_and_optimistic_lock(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    url = f"/api/patents/{pid}/stages/draft"
    r = client.patch(url, json={"data": {"idea": "A"}, "note": "v1", "baseVersion": 0}, headers=H("u1"))
    assert r.json()["version"] == 1
    # 两人基于同一版本编辑:后保存者 409,并拿到当前内容
    client.patch(url, json={"data": {"idea": "B"}, "baseVersion": 1}, headers=H("pl1"))
    r = client.patch(url, json={"data": {"idea": "C"}, "baseVersion": 1}, headers=H("u1"))
    assert r.status_code == 409 and r.json()["current"]["idea"] == "B" and r.json()["currentVersion"] == 2
    # 未到达的阶段不能编辑
    assert client.patch(f"/api/patents/{pid}/stages/doi", json={"data": {}}, headers=H("u1")).status_code == 409
    # 恢复旧版本 = 生成新版本
    r = client.post(f"{url}/restore", json={"version": 1}, headers=H("u1"))
    assert r.json()["version"] == 3 and r.json()["patent"]["stageData"]["draft"]["idea"] == "A"


def test_review_rounds_gate_and_reject(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    assert adv(client, pid).status_code == 200
    rv = lambda uid, body: client.post(f"/api/patents/{pid}/reviews", json=body, headers=H(uid))  # noqa: E731
    # 不能邀请负责人本人
    assert client.post(f"/api/patents/{pid}/reviewers", json={"userId": "u1"}, headers=H("u1")).status_code == 400
    for r in ("r1", "r2"):
        assert client.post(f"/api/patents/{pid}/reviewers", json={"userId": r}, headers=H("u1")).status_code == 200
    # reviewer 例外通道:外组 reviewer 可见
    assert client.get(f"/api/patents/{pid}", headers=H("r1")).status_code == 200
    # 加权低于下限不能判通过
    assert rv("r1", score("pass", 2)).json()["code"] == "below_min"
    assert rv("r1", score("pass")).status_code == 200
    # 打回需意见;打回不自动回退,门禁关闭
    assert rv("r2", score("reject", 2, "")).status_code == 400
    p = rv("r2", score("reject", 2, "不够新颖")).json()
    assert p["stage"] == "patentability"
    assert adv(client, pid).json()["reason"] == "review_gate"
    # 发起新一轮:名单继承、分数清零,旧轮进入历史
    p = client.post(f"/api/patents/{pid}/reviews/rounds", headers=H("u1")).json()
    pa = p["stageData"]["patentability"]
    assert pa["round"] == 2 and [r["score"] for r in pa["reviewers"]] == [None, None]
    assert pa["pastRounds"][0]["outcome"] == "rejected"
    # 提交后本轮内可修改意见
    rv("r1", score("reject", 3, "再想想"))
    assert rv("r1", score("pass")).status_code == 200
    rv("r2", score("pass"))
    assert adv(client, pid).json()["stage"] == "implementation"


def test_decline_and_withdraw(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    adv(client, pid)
    for r in ("r1", "r2", "r3"):
        client.post(f"/api/patents/{pid}/reviewers", json={"userId": r}, headers=H("u1"))
    assert client.post(f"/api/patents/{pid}/reviewers/me/decline", json={"reason": "领域不符"}, headers=H("r3")).status_code == 200
    p = client.delete(f"/api/patents/{pid}/reviewers/r2", headers=H("u1")).json()
    revs = {r["userId"]: r for r in p["stageData"]["patentability"]["reviewers"]}
    assert set(revs) == {"r1", "r3"} and revs["r3"]["declined"]["reason"] == "领域不符"
    # 拒绝者不能再打分
    assert client.post(f"/api/patents/{pid}/reviews", json=score(), headers=H("r3")).status_code == 403


def test_multi_rollback_recheck_and_private_lock(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    adv(client, pid)
    from tests.helpers import db_exec

    db_exec(client, "UPDATE patents SET stage='search' WHERE id=?", (pid,))
    db_exec(client, "UPDATE patents SET due_dates='{\"implementation\":\"2026-01-01\"}' WHERE id=?", (pid,))
    r = client.post(f"/api/patents/{pid}/rollback", json={"to": "patentability", "reason": "补充"}, headers=H("u1"))
    assert r.json()["needsRecheck"] == ["implementation", "search"]
    # 回退回草案后不能再设私有
    client.post(f"/api/patents/{pid}/rollback", json={"to": "draft", "reason": "重写"}, headers=H("u1"))
    r = client.patch(f"/api/patents/{pid}/visibility", json={"visibility": "private"}, headers=H("u1"))
    assert r.status_code == 409
    # 只能回退到更早阶段
    assert client.post(f"/api/patents/{pid}/rollback", json={"to": "draft", "reason": "x"}, headers=H("u1")).status_code == 400


def test_archive_and_unarchive(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    client.post(f"/api/patents/{pid}/archive", json={"kind": "abandoned", "reason": "新颖性不足"}, headers=H("u1"))
    assert client.patch(f"/api/patents/{pid}/stages/draft", json={"data": {"idea": "x"}}, headers=H("u1")).status_code == 409
    assert adv(client, pid).status_code == 409
    p = client.post(f"/api/patents/{pid}/unarchive", json={"reason": "重启"}, headers=H("u1")).json()
    assert p["archived"] is None
    kinds = [t["kind"] for t in client.get(f"/api/patents/{pid}", headers=H("u1")).json()["transitions"]]
    assert kinds == ["advance", "archive", "unarchive"]


def test_transfer_private_and_batch(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    p = mk(client, vis="private")
    r = client.post(f"/api/patents/{p['id']}/transfer", json={"to": "u3"}, headers=H("u1")).json()
    assert r["ownerId"] == "u3" and r["collaborators"] == ["u1"] and r["visibility"] == "private"
    assert client.get(f"/api/patents/{p['id']}", headers=H("u3")).status_code == 200
    # 团队归属不变
    assert r["teamId"] == "t1"
    q1, q2 = mk(client)["id"], mk(client)["id"]
    r = client.post("/api/patents-transfer-batch", json={"items": [{"patentId": q1, "toUserId": "u2"},
                    {"patentId": q2, "toUserId": "u2"}], "keepAsCollaborator": False}, headers=H("u1"))
    assert r.json()["transferred"] == 2
    assert client.get(f"/api/patents/{q1}", headers=H("u2")).json()["collaborators"] == []


def test_delete_rules(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    a = mk(client)["id"]
    assert client.delete(f"/api/patents/{a}", headers=H("pl1")).status_code == 403  # 非负责人
    assert client.delete(f"/api/patents/{a}", headers=H("u1")).status_code == 200
    b = mk(client)["id"]
    adv(client, b)
    client.post(f"/api/patents/{b}/rollback", json={"to": "draft", "reason": "x"}, headers=H("u1"))
    assert client.delete(f"/api/patents/{b}", headers=H("u1")).status_code == 403  # 离开过草案


def test_migrate_team(client) -> None:  # type: ignore[no-untyped-def]
    world(client)
    pid = mk(client)["id"]
    assert client.post(f"/api/patents/{pid}/team", json={"teamId": "t2"}, headers=H("u1")).status_code == 403
    assert client.post(f"/api/patents/{pid}/team", json={"teamId": "t2"}, headers=H("pl1")).json()["teamId"] == "t2"
    # 迁移后原组 PL 看不到、新组成员可见
    assert client.get(f"/api/patents/{pid}", headers=H("pl1")).status_code == 404
    assert client.get(f"/api/patents/{pid}", headers=H("u3")).status_code == 200
