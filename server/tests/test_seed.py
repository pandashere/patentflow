from __future__ import annotations

from patentflow.seed import DEMO_PASSWORD


def test_seed_matches_demo(client) -> None:  # type: ignore[no-untyped-def]
    import asyncio

    from patentflow.db import Database
    from patentflow.seed import seed

    async def go():  # type: ignore[no-untyped-def]
        db = Database(client.app.state.settings.db_path)
        await db.connect()
        try:
            return await seed(db)
        finally:
            await db.close()

    assert asyncio.run(go()) == {"users": 10, "patents": 9}
    assert client.post("/api/auth/login", json={"email": "chenxi@corp.local", "password": DEMO_PASSWORD}).status_code == 200
    b = client.get("/api/bootstrap").json()
    titles = {p["code"]: p for p in b["patents"]}
    assert "PF-2026-014" in titles  # 陈曦自己的私有草案
    p1 = next(p for p in b["patents"] if p["id"] == "p1")
    assert p1["stageData"]["draft"]["idea"].startswith("在客户端本地引入")
    assert [v["version"] for v in b["versions"] if v["patentId"] == "p1" and v["stage"] == "draft"] == [1, 2, 3]
    p6 = client.get("/api/patents/p6").json()
    assert p6["stageData"]["patentability"]["round"] == 2 and p6["stageData"]["patentability"]["pastRounds"][0]["outcome"] == "rejected"
    # GL 看不到陈曦的私有草案
    client.post("/api/auth/login", json={"email": "guyq@corp.local", "password": DEMO_PASSWORD})
    assert all(p["code"] != "PF-2026-014" for p in client.get("/api/bootstrap").json()["patents"])
