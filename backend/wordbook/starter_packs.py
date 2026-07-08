"""기본 제공(예시) 단어장 = "스타터 팩".

사용자가 처음부터 단어를 넣지 않아도 바로 학습할 수 있도록,
잘 정리된 단어장을 asset(JSON)으로 번들해서 제공한다.
사용자는 가져온 뒤 자유롭게 삭제할 수 있고, 삭제 후 다시 가져올 수도 있다.

- asset 위치: backend/assets/starter_packs/*.json
- 각 JSON 구조: {id, title, tag, description, words: [{word, korean}, ...]}
- 파일을 추가하면 자동으로 목록에 노출된다(코드 수정 불필요).
"""

import json
from functools import lru_cache
from pathlib import Path

from backend.exceptions import FILE_IMPORT_ERRORS

_PACKS_DIR = Path(__file__).resolve().parents[1] / "assets" / "starter_packs"


@lru_cache(maxsize=1)
def _load_all() -> dict[str, dict]:
    """asset 디렉터리의 모든 스타터 팩을 로드한다(프로세스 1회 캐시)."""
    packs: dict[str, dict] = {}
    if not _PACKS_DIR.is_dir():
        return packs
    for path in sorted(_PACKS_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FILE_IMPORT_ERRORS:
            continue
        pack_id = str(data.get("id") or path.stem).strip()
        if not pack_id:
            continue
        words = [
            {"word": (w.get("word") or "").strip(), "korean": (w.get("korean") or "").strip()}
            for w in data.get("words", [])
            if (w.get("word") or "").strip()
        ]
        packs[pack_id] = {
            "id": pack_id,
            "title": (data.get("title") or pack_id).strip(),
            "tag": (data.get("tag") or pack_id).strip(),
            "description": (data.get("description") or "").strip(),
            "words": words,
        }
    return packs


def list_starter_packs() -> list[dict]:
    """제공 순서대로 스타터 팩 목록을 돌려준다."""
    return list(_load_all().values())


def get_starter_pack(pack_id: str) -> dict | None:
    """id로 스타터 팩 하나를 찾는다. 없으면 None."""
    return _load_all().get((pack_id or "").strip())
