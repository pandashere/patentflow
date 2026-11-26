from __future__ import annotations

STAGES: list[tuple[str, str]] = [
    ("draft", "草案"),
    ("patentability", "可专利性审查"),
    ("implementation", "专利实施"),
    ("search", "专利检索"),
    ("doi", "DOI 撰写"),
]
STAGE_KEYS = [k for k, _ in STAGES]
ROLES = ("user", "pl", "gl")
VISIBILITIES = ("private", "team", "public")
NOTIFY_EVENTS = ("review", "due", "transition")
VIS_LABEL = {"private": "私有", "team": "团队可见", "public": "公开"}


def stage_index(k: str) -> int:
    return STAGE_KEYS.index(k)


def stage_label(k: str) -> str:
    return dict(STAGES)[k]


EMPTY_SCORE = {"difficulty": 0, "nonObviousness": 0, "novelty": 0, "comment": "", "verdict": "pending"}

EMPTY_STAGE_DATA: dict[str, dict] = {
    "draft": {"background": "", "classification": "", "idea": ""},
    "patentability": {"summary": "", "selfAssessment": EMPTY_SCORE},
    "implementation": {"markdown": ""},
    "search": {"markdown": ""},
    "doi": {"title": "", "authors": "", "venue": "", "abstractDraft": ""},
}

# 各阶段允许写入的字段(其余字段忽略),值类型均为字符串,patentability.selfAssessment 例外
STAGE_FIELDS: dict[str, set[str]] = {k: set(v) for k, v in EMPTY_STAGE_DATA.items()}
