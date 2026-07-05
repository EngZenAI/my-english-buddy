from fastapi import APIRouter

from backend.db.dependencies import SessionDep
from backend.db.repositories import (
    add_label,
    count_words_by_tag,
    delete_label,
    get_labels,
    rename_label,
)
from backend.routers.common import CurrentUserDep
from backend.schemas.wordbook import LabelIn, RenameLabelIn

router = APIRouter(tags=["labels"])


@router.get(
    "/labels",
    summary="태그 목록 조회",
    description=(
        "현재 로그인한 사용자의 단어장 태그 목록을 반환합니다. "
        "처음 조회하는 사용자라면 기본 태그를 함께 생성합니다."
    ),
)
async def list_labels(session: SessionDep, _user: CurrentUserDep):
    return {"labels": await get_labels(session, _user["id"])}


@router.post(
    "/labels",
    summary="태그 추가",
    description=(
        "새 단어장 태그를 추가합니다. 사용자별 최대 태그 개수와 중복 여부는 "
        "repository 계층에서 검사합니다."
    ),
)
async def create_label(payload: LabelIn, session: SessionDep, _user: CurrentUserDep):
    labels, ok = await add_label(session, _user["id"], payload.name)
    return {"labels": labels, "ok": ok, "max": 20}


@router.post(
    "/labels/rename",
    summary="태그 이름 변경",
    description=(
        "기존 태그 이름을 새 이름으로 바꿉니다. 같은 사용자의 해당 태그 단어들도 "
        "새 태그 이름으로 함께 이동합니다."
    ),
)
async def rename_label_ep(payload: RenameLabelIn, session: SessionDep, _user: CurrentUserDep):
    labels, ok, message = await rename_label(
        session,
        _user["id"],
        payload.old_name,
        payload.new_name,
    )
    return {"labels": labels, "ok": ok, "message": message}


@router.get(
    "/labels/word-count",
    summary="태그별 단어 개수 조회",
    description="삭제 확인창 등에 표시할 특정 태그의 단어 개수를 반환합니다.",
)
async def label_word_count(tag: str = "", *, session: SessionDep, _user: CurrentUserDep):
    return {"count": await count_words_by_tag(session, _user["id"], tag) if tag else 0}


@router.delete(
    "/labels",
    summary="태그 삭제",
    description=(
        "태그를 삭제하고, 같은 사용자의 해당 태그 단어도 함께 삭제합니다. "
        "기본 태그인 '미지정'은 삭제할 수 없습니다."
    ),
)
async def delete_label_ep(name: str = "", *, session: SessionDep, _user: CurrentUserDep):
    labels, ok, message, deleted = await delete_label(session, _user["id"], name)
    return {"labels": labels, "ok": ok, "message": message, "deleted": deleted}
