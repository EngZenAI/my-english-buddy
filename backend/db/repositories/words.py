import json
from datetime import datetime, timedelta

from sqlalchemy import Integer, bindparam, delete, func, insert, select, text, update
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.models import QuizHistory, Word
from backend.db.repositories.common import _rows, _uuid
from backend.exceptions import DATA_COERCION_ERRORS, RECORD_MAPPING_ERRORS


async def is_word_saved(session: AsyncSession, user_id: str, word: str) -> bool:
    if not word or not word.strip():
        return False
    result = await session.execute(
        select(Word.id).where(
            Word.user_id == _uuid(user_id),
            func.lower(Word.word) == word.strip().lower(),
        )
    )
    return result.scalar_one_or_none() is not None


async def save_word(
    session: AsyncSession,
    user_id,
    word,
    korean,
    korean_detail,
    english_def,
    example,
    tag,
):
    user_uuid = _uuid(user_id)
    result = await session.execute(
        select(Word.id).where(
            Word.user_id == user_uuid,
            func.lower(Word.word) == word.lower(),
        )
    )
    word_id = result.scalar_one_or_none()
    if word_id:
        await session.execute(
            update(Word)
            .where(Word.id == word_id, Word.user_id == user_uuid)
            .values(
                korean=korean,
                english_def=english_def,
                example=example,
                tag=tag,
                korean_detail=korean_detail,
            )
        )
        await session.commit()
        return "✏️ 단어 정보를 업데이트했어요!"
    result = await session.execute(
        select(func.coalesce(func.min(Word.sort_order), 0) - 1).where(
            Word.user_id == user_uuid
        )
    )
    next_order = result.scalar_one()
    await session.execute(
        insert(Word).values(
            user_id=user_uuid,
            word=word,
            korean=korean,
            korean_detail=korean_detail,
            english_def=english_def,
            example=example,
            tag=tag,
            sort_order=next_order,
            next_review=datetime.now() + timedelta(days=7),
        )
    )
    await session.commit()
    return "✅ 단어장에 저장됐어요!"


async def existing_words_lower(session: AsyncSession, user_id: str) -> set:
    result = await session.execute(
        select(func.lower(Word.word)).where(Word.user_id == _uuid(user_id))
    )
    return set(result.scalars().all())


async def bulk_import_words(
    session: AsyncSession,
    user_id: str,
    items,
    default_tag: str = "미지정",
) -> dict:
    rows = [{"word": word, "korean": korean, "tag": default_tag} for word, korean in items]
    return await insert_words(session, user_id, rows, overwrite=False)


async def insert_words(
    session: AsyncSession,
    user_id: str,
    items,
    overwrite: bool = False,
) -> dict:
    added = updated = skipped = 0
    user_uuid = _uuid(user_id)
    result = await session.execute(
        select(func.lower(Word.word)).where(Word.user_id == user_uuid)
    )
    existing = set(result.scalars().all())

    to_insert = []
    to_update = []
    seen: set[str] = set()
    for it in items:
        word = (it.get("word") or "").strip()
        if not word:
            continue
        lower_word = word.lower()
        if lower_word in seen:
            skipped += 1
            continue
        seen.add(lower_word)
        payload = {**it, "word": word}
        if lower_word in existing:
            if overwrite:
                to_update.append(payload)
            else:
                skipped += 1
            continue
        to_insert.append(payload)

    if to_insert:
        result = await session.execute(
            select(func.coalesce(func.min(Word.sort_order), 0)).where(
                Word.user_id == user_uuid
            )
        )
        base = result.scalar_one()
        params = []
        for index, item in enumerate(to_insert):
            params.append(
                {
                    "user_id": user_uuid,
                    "word": item["word"].lower(),
                    "korean": (item.get("korean") or "").strip(),
                    "korean_detail": item.get("korean_detail") or "",
                    "english_def": item.get("english_def") or "",
                    "example": item.get("example") or "",
                    "tag": item.get("tag") or "미지정",
                    "sort_order": base - len(to_insert) + index,
                    "next_review": datetime.now() + timedelta(days=7),
                }
            )
        await session.execute(
            insert(Word),
            params,
        )
        added = len(params)

    for item in to_update:
        result = await session.execute(
            select(Word).where(
                Word.user_id == user_uuid,
                func.lower(Word.word) == item["word"].lower(),
            ),
        )
        word_row = result.scalar_one_or_none()
        if not word_row:
            continue
        if korean := (item.get("korean") or "").strip():
            word_row.korean = korean
        if korean_detail := (item.get("korean_detail") or ""):
            word_row.korean_detail = korean_detail
        if example := (item.get("example") or ""):
            word_row.example = example
        if tag := (item.get("tag") or ""):
            word_row.tag = tag
        updated += 1
    await session.commit()
    return {"added": added, "updated": updated, "skipped": skipped, "total": added + updated + skipped}


async def get_all_words(
    session: AsyncSession,
    user_id: str,
    tag: str | None = None,
):
    stmt = select(
        Word.id,
        Word.word,
        Word.korean,
        Word.korean_detail,
        Word.english_def,
        Word.example,
        Word.tag,
        Word.created_at,
        Word.next_review,
        Word.sort_order,
    ).where(Word.user_id == _uuid(user_id))
    if tag:
        stmt = stmt.where(Word.tag == tag)
    stmt = stmt.order_by(Word.sort_order.asc().nulls_last(), Word.created_at.desc())
    result = await session.execute(stmt)
    return _rows(result)


async def update_word(
    session: AsyncSession,
    user_id: str,
    word_id: int,
    korean_detail,
    english_def,
    example,
    tag,
    next_review,
) -> bool:
    query = """UPDATE words
               SET korean_detail = :korean_detail,
                   english_def = :english_def,
                   example = :example,
                   tag = :tag"""
    params = {
        "korean_detail": korean_detail,
        "english_def": english_def,
        "example": example,
        "tag": tag or "미지정",
        "word_id": word_id,
        "user_id": user_id,
    }
    if next_review:
        query += ", next_review = :next_review"
        params["next_review"] = next_review
    query += " WHERE id = :word_id AND user_id = :user_id"
    result = await session.execute(text(query), params)
    await session.commit()
    return bool(result.rowcount)


async def delete_word(session: AsyncSession, user_id: str, word_id: int) -> bool:
    result = await session.execute(
        delete(Word).where(Word.id == word_id, Word.user_id == _uuid(user_id))
    )
    await session.commit()
    return bool(result.rowcount)


async def bulk_update_words(session: AsyncSession, user_id: str, items) -> dict:
    parsed = {}
    order = []
    for item in items:
        try:
            word_id = int(item["id"])
        except RECORD_MAPPING_ERRORS:
            continue
        parsed[word_id] = item
        order.append(word_id)
    if not parsed:
        return {"ok": True, "updated": 0, "skipped": 0, "conflicts": []}

    user_uuid = _uuid(user_id)
    result = await session.execute(
        text("SELECT id, word, lower(word) AS lower_word FROM words WHERE user_id = :user_id"),
        {"user_id": user_uuid},
    )
    current_rows = {row["id"]: row for row in result.mappings().all()}
    current_words = {word_id: row["lower_word"] for word_id, row in current_rows.items()}

    target = dict(current_words)
    new_word = {}
    for word_id in order:
        if word_id not in current_words:
            continue
        raw = (parsed[word_id].get("word") or "").strip()
        lower_word = raw.lower() if raw else current_words[word_id]
        new_word[word_id] = lower_word
        target[word_id] = lower_word

    counts = {}
    for lower_word in target.values():
        counts[lower_word] = counts.get(lower_word, 0) + 1
    conflict_ids = set()
    conflicts = []
    for word_id in order:
        if word_id not in current_words:
            continue
        changed = new_word[word_id] != current_words[word_id]
        if changed and counts.get(new_word[word_id], 0) > 1:
            conflict_ids.add(word_id)
            conflicts.append(parsed[word_id].get("word") or new_word[word_id])

    params = []
    for word_id in order:
        if word_id not in current_words or word_id in conflict_ids:
            continue
        item = parsed[word_id]
        raw_word = (item.get("word") or "").strip()
        params.append(
            {
                "id": word_id,
                "word": raw_word or current_rows[word_id]["word"],
                "korean": item.get("korean", "") or "",
                "korean_detail": item.get("korean_detail", "") or "",
                "english_def": item.get("english_def", "") or "",
                "example": item.get("example", "") or "",
                "tag": item.get("tag") or "미지정",
                "next_review": (item.get("next_review") or "").strip(),
            }
        )
    if not params:
        return {"ok": True, "updated": 0, "skipped": len(conflict_ids), "conflicts": conflicts}

    try:
        result = await session.execute(
            text(
                """WITH payload AS (
                       SELECT *
                       FROM jsonb_to_recordset(CAST(:items AS jsonb)) AS item(
                           id int,
                           word text,
                           korean text,
                           korean_detail text,
                           english_def text,
                           example text,
                           tag text,
                           next_review text
                       )
                   )
                   UPDATE words AS w
                   SET word = NULLIF(BTRIM(payload.word), ''),
                       korean = COALESCE(payload.korean, ''),
                       korean_detail = COALESCE(payload.korean_detail, ''),
                       english_def = COALESCE(payload.english_def, ''),
                       example = COALESCE(payload.example, ''),
                       tag = COALESCE(NULLIF(payload.tag, ''), '미지정'),
                       next_review = CASE COALESCE(payload.next_review, '')
                           WHEN '1d' THEN NOW() + INTERVAL '1 day'
                           WHEN '1w' THEN NOW() + INTERVAL '7 days'
                           WHEN '1m' THEN NOW() + INTERVAL '1 month'
                           WHEN '3m' THEN NOW() + INTERVAL '3 months'
                           WHEN '' THEN w.next_review
                           ELSE CAST(payload.next_review AS timestamp)
                       END
                   FROM payload
                   WHERE w.id = payload.id AND w.user_id = :user_id
                   RETURNING w.id"""
            ),
            {
                "items": json.dumps(params, ensure_ascii=False),
                "user_id": user_uuid,
            },
        )
        updated = len(result.scalars().all())
        await session.commit()
    except IntegrityError:
        await session.rollback()
        return {
            "ok": False,
            "updated": 0,
            "skipped": len(conflict_ids),
            "conflicts": conflicts,
            "message": "단어를 서로 맞바꾸는 등 중복이 생겨 저장하지 못했어요. 겹치는 단어를 확인해주세요.",
        }
    return {"ok": True, "updated": updated, "skipped": len(conflict_ids), "conflicts": conflicts}


async def bulk_delete_words(session: AsyncSession, user_id: str, ids) -> int:
    clean = []
    for item in ids or []:
        try:
            clean.append(int(item))
        except DATA_COERCION_ERRORS:
            continue
    if not clean:
        return 0
    result = await session.execute(
        delete(Word).where(Word.user_id == _uuid(user_id), Word.id.in_(clean))
    )
    await session.commit()
    return result.rowcount or 0


async def reorder_words(session: AsyncSession, user_id: str, ordered_ids) -> int:
    clean_ids: list[int] = []
    seen: set[int] = set()
    for raw_id in ordered_ids or []:
        try:
            word_id = int(raw_id)
        except DATA_COERCION_ERRORS:
            continue
        if word_id in seen:
            continue
        seen.add(word_id)
        clean_ids.append(word_id)
    if not clean_ids:
        return 0

    result = await session.execute(
        text(
            """WITH ordered AS (
                   SELECT item.id, item.ordinality - 1 AS sort_order
                   FROM unnest(:ordered_ids) WITH ORDINALITY AS item(id, ordinality)
               )
               UPDATE words AS w
               SET sort_order = ordered.sort_order
               FROM ordered
               WHERE w.id = ordered.id AND w.user_id = :user_id"""
        ).bindparams(bindparam("ordered_ids", type_=ARRAY(Integer))),
        {"ordered_ids": clean_ids, "user_id": _uuid(user_id)},
    )
    await session.commit()
    return result.rowcount or 0


async def get_words_to_review(session: AsyncSession, user_id: str):
    result = await session.execute(
        select(Word).where(
            Word.user_id == _uuid(user_id),
            Word.next_review <= datetime.now(),
        ).order_by(Word.next_review.asc())
    )
    return [
        {
            "id": word.id,
            "user_id": word.user_id,
            "word": word.word,
            "korean": word.korean,
            "korean_detail": word.korean_detail,
            "english_def": word.english_def,
            "example": word.example,
            "tag": word.tag,
            "created_at": word.created_at,
            "next_review": word.next_review,
            "sort_order": word.sort_order,
        }
        for word in result.scalars().all()
    ]


async def update_review(session: AsyncSession, user_id: str, word_id: int, correct: bool):
    days = 30 if correct else 1
    next_review = datetime.now() + timedelta(days=days)
    result = await session.execute(
        update(Word)
        .where(Word.id == word_id, Word.user_id == _uuid(user_id))
        .values(next_review=next_review)
    )
    if not result.rowcount:
        return
    session.add(
        QuizHistory(user_id=_uuid(user_id), word_id=word_id, result=correct)
    )
    await session.commit()
