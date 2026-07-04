from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import Label, Word
from backend.db.repositories.common import DEFAULT_LABELS, MAX_LABELS, _uuid


async def _seed_default_labels(session: AsyncSession, user_id: str) -> None:
    user_uuid = _uuid(user_id)
    for name in DEFAULT_LABELS:
        await session.execute(
            pg_insert(Label)
            .values(user_id=user_uuid, name=name)
            .on_conflict_do_nothing(index_elements=[Label.user_id, Label.name])
        )
    await session.commit()


async def get_labels(session: AsyncSession, user_id: str) -> list[str]:
    async def _fetch() -> list[str]:
        result = await session.execute(
            select(Label.name)
            .where(Label.user_id == _uuid(user_id))
            .order_by(
                (Label.name == "미지정").desc(),
                Label.id.asc(),
            ),
        )
        return list(result.scalars().all())

    labels = await _fetch()
    if not labels:
        await _seed_default_labels(session, user_id)
        labels = await _fetch()
    return labels


async def add_label(session: AsyncSession, user_id: str, name: str) -> tuple[list[str], bool]:
    name = (name or "").strip()
    existing = await get_labels(session, user_id)
    if not name:
        return existing, False
    if name in existing:
        return existing, True
    if len(existing) >= MAX_LABELS:
        return existing, False
    await session.execute(
        pg_insert(Label)
        .values(user_id=_uuid(user_id), name=name)
        .on_conflict_do_nothing(index_elements=[Label.user_id, Label.name])
    )
    await session.commit()
    return await get_labels(session, user_id), True


async def count_words_by_tag(session: AsyncSession, user_id: str, tag: str) -> int:
    result = await session.execute(
        select(func.count()).select_from(Word).where(
            Word.user_id == _uuid(user_id),
            Word.tag == tag,
        )
    )
    return int(result.scalar_one())


async def rename_label(
    session: AsyncSession,
    user_id: str,
    old: str,
    new: str,
) -> tuple[list[str], bool, str]:
    old = (old or "").strip()
    new = (new or "").strip()
    if not old or not new:
        return await get_labels(session, user_id), False, "태그 이름이 비어 있습니다."
    if old == "미지정":
        return await get_labels(session, user_id), False, "'미지정' 태그는 변경할 수 없습니다."
    existing = await get_labels(session, user_id)
    if old not in existing:
        return existing, False, "존재하지 않는 태그입니다."
    if new == old:
        return existing, True, "변경 사항이 없습니다."
    if new in existing:
        return existing, False, "이미 있는 태그 이름입니다."
    await session.execute(
        update(Label)
        .where(Label.user_id == _uuid(user_id), Label.name == old)
        .values(name=new)
    )
    await session.execute(
        update(Word)
        .where(Word.user_id == _uuid(user_id), Word.tag == old)
        .values(tag=new)
    )
    await session.commit()
    return await get_labels(session, user_id), True, "변경되었습니다."


async def delete_label(
    session: AsyncSession,
    user_id: str,
    name: str,
) -> tuple[list[str], bool, str, int]:
    name = (name or "").strip()
    if name == "미지정":
        return await get_labels(session, user_id), False, "'미지정' 태그는 삭제할 수 없습니다.", 0
    existing = await get_labels(session, user_id)
    if name not in existing:
        return existing, False, "존재하지 않는 태그입니다.", 0
    if len(existing) <= 1:
        return existing, False, "최소 1개의 태그는 있어야 합니다.", 0
    deleted = await count_words_by_tag(session, user_id, name)
    await session.execute(
        delete(Word).where(Word.user_id == _uuid(user_id), Word.tag == name)
    )
    await session.execute(
        delete(Label).where(Label.user_id == _uuid(user_id), Label.name == name)
    )
    await session.commit()
    return await get_labels(session, user_id), True, "삭제되었습니다.", deleted
