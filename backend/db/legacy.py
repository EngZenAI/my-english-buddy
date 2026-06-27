import json
from datetime import datetime, timedelta

import psycopg2
import psycopg2.errors
import psycopg2.extras

from backend.db.legacy_pool import get_conn

# 기본 제공 라벨 (OPIc·실생활 테마). 사용자가 추가/삭제 가능.
DEFAULT_LABELS = ["미지정", "여행", "비즈니스", "일상", "IT·코딩", "학업"]
MAX_LABELS = 20  # 라벨 최대 개수 (기본 라벨 포함)


def init_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            # 기존 DB에 context 컬럼이 있으면 tag 로 이름 변경 (데이터 보존)
            cur.execute("""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'words' AND column_name = 'context'
                    ) AND NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'words' AND column_name = 'tag'
                    ) THEN
                        EXECUTE 'ALTER TABLE words RENAME COLUMN context TO tag';
                    END IF;
                END $$;
            """)

            cur.execute("""
                CREATE TABLE IF NOT EXISTS words (
                    id            SERIAL PRIMARY KEY,
                    user_id       UUID NOT NULL,
                    word          TEXT NOT NULL,
                    korean        TEXT,
                    korean_detail TEXT,
                    english_def   TEXT,
                    example       TEXT,
                    tag           TEXT,
                    created_at    TIMESTAMP DEFAULT NOW(),
                    next_review   TIMESTAMP DEFAULT (NOW() + INTERVAL '7 days')
                );

                -- 기존 테이블에 korean_detail 컬럼이 없으면 추가
                ALTER TABLE words ADD COLUMN IF NOT EXISTS user_id UUID;
                ALTER TABLE words ADD COLUMN IF NOT EXISTS korean_detail TEXT;
                ALTER TABLE words ADD COLUMN IF NOT EXISTS sort_order INTEGER;
                ALTER TABLE words ALTER COLUMN next_review SET DEFAULT NOW() + INTERVAL '7 days';
                ALTER TABLE words DROP COLUMN IF EXISTS phonetic;
                ALTER TABLE words DROP CONSTRAINT IF EXISTS words_word_key;

                CREATE UNIQUE INDEX IF NOT EXISTS ux_words_user_word
                    ON words (user_id, lower(word));

                CREATE TABLE IF NOT EXISTS quiz_history (
                    id          SERIAL PRIMARY KEY,
                    user_id     UUID,
                    word_id     INTEGER,
                    result      BOOLEAN,
                    reviewed_at TIMESTAMP DEFAULT NOW()
                );
                ALTER TABLE quiz_history ADD COLUMN IF NOT EXISTS user_id UUID;
                ALTER TABLE quiz_history DROP CONSTRAINT IF EXISTS quiz_history_word_id_fkey;

                CREATE TABLE IF NOT EXISTS quiz_sessions (
                    id              SERIAL PRIMARY KEY,
                    user_id         UUID NOT NULL,
                    mode            TEXT NOT NULL,
                    tag             TEXT,
                    saved_from      DATE,
                    saved_to        DATE,
                    instruction     TEXT,
                    question_count  INTEGER DEFAULT 10,
                    total_questions INTEGER DEFAULT 0,
                    score           NUMERIC DEFAULT 0,
                    created_at      TIMESTAMP DEFAULT NOW(),
                    completed_at    TIMESTAMP,
                    review_applied_at TIMESTAMP
                );
                ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
                ALTER TABLE quiz_sessions ADD COLUMN IF NOT EXISTS review_applied_at TIMESTAMP;

                CREATE TABLE IF NOT EXISTS quiz_question_results (
                    id                    SERIAL PRIMARY KEY,
                    session_id            INTEGER NOT NULL,
                    user_id               UUID NOT NULL,
                    word_id               INTEGER,
                    source_word_id        INTEGER,
                    source_word           TEXT,
                    target_word           TEXT,
                    question_type         TEXT,
                    difficulty            TEXT,
                    prompt                TEXT,
                    user_answer           TEXT,
                    correct_answer        TEXT,
                    status                TEXT,
                    correct               BOOLEAN,
                    score                 NUMERIC DEFAULT 0,
                    confidence            NUMERIC DEFAULT 1,
                    feedback              TEXT,
                    is_derived            BOOLEAN DEFAULT FALSE,
                    derived_from_word_id  INTEGER,
                    suggested_word        TEXT,
                    suggested_korean      TEXT,
                    suggested_english_def TEXT,
                    suggested_example     TEXT,
                    suggested_tag         TEXT,
                    created_at            TIMESTAMP DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS ix_quiz_question_results_user_created
                    ON quiz_question_results (user_id, created_at DESC);
                CREATE INDEX IF NOT EXISTS ix_quiz_question_results_session
                    ON quiz_question_results (session_id);

                CREATE TABLE IF NOT EXISTS labels (
                    id          SERIAL PRIMARY KEY,
                    user_id     UUID NOT NULL,
                    name        TEXT NOT NULL,
                    created_at  TIMESTAMP DEFAULT NOW()
                );

                -- 라벨도 사용자별로 전환
                ALTER TABLE labels ADD COLUMN IF NOT EXISTS user_id UUID;
                ALTER TABLE labels DROP CONSTRAINT IF EXISTS labels_name_key;
                DELETE FROM labels WHERE user_id IS NULL;  -- 기존 전역 라벨 정리(사용자별로 재시드)
                CREATE UNIQUE INDEX IF NOT EXISTS ux_labels_user_name
                    ON labels (user_id, name);

                -- 롤플레잉 결과(학습노트): 대화 요약 + 유용 표현/어휘를 JSONB로 보관
                CREATE TABLE IF NOT EXISTS roleplay_sessions (
                    id          SERIAL PRIMARY KEY,
                    user_id     UUID NOT NULL,
                    level       TEXT,
                    scenario    TEXT,
                    tag         TEXT,
                    title       TEXT,
                    turns       INTEGER DEFAULT 0,
                    summary     TEXT,
                    expressions JSONB DEFAULT '[]'::jsonb,
                    vocab       JSONB DEFAULT '[]'::jsonb,
                    created_at  TIMESTAMP DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS ix_roleplay_sessions_user_created
                    ON roleplay_sessions (user_id, created_at DESC);
            """)
            # sort_order 백필: 기존 행은 사용자별 최근 저장순(현재 화면 순서)을 0,1,2…로 부여
            cur.execute("""
                WITH ranked AS (
                    SELECT id,
                           ROW_NUMBER() OVER (
                               PARTITION BY user_id
                               ORDER BY created_at DESC, id DESC
                           ) - 1 AS rn
                    FROM words
                    WHERE sort_order IS NULL
                )
                UPDATE words w
                SET sort_order = r.rn
                FROM ranked r
                WHERE w.id = r.id;
            """)
        # 기본 라벨은 사용자가 처음 접근할 때(get_labels) 사용자별로 시드한다.
        conn.commit()

def is_word_saved(user_id: str, word: str) -> bool:
    if not word or not word.strip():
        return False
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM words WHERE user_id = %s AND lower(word) = lower(%s)",
                (user_id, word.strip()),
            )
            return cur.fetchone() is not None

def save_word(user_id, word, korean, korean_detail, english_def, example, tag):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM words WHERE user_id = %s AND lower(word) = lower(%s)",
                (user_id, word),
            )
            row = cur.fetchone()
            if row:
                # 이미 있으면 예문/태그/한국어 상세를 최신값으로 갱신
                cur.execute(
                    """UPDATE words
                       SET korean = %s,
                           english_def = %s,
                           example = %s,
                           tag = %s,
                           korean_detail = %s
                       WHERE id = %s AND user_id = %s""",
                    (korean, english_def, example, tag, korean_detail, row[0], user_id),
                )
                conn.commit()
                return "✏️ 단어 정보를 업데이트했어요!"
            # 새 단어는 목록 맨 위에 오도록 가장 작은 sort_order 부여
            cur.execute(
                "SELECT COALESCE(MIN(sort_order), 0) - 1 FROM words WHERE user_id = %s",
                (user_id,),
            )
            next_order = cur.fetchone()[0]
            cur.execute("""
                INSERT INTO words
                    (user_id, word, korean, korean_detail, english_def, example, tag, sort_order, next_review)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW() + INTERVAL '7 days')
            """, (user_id, word, korean, korean_detail, english_def, example, tag, next_order))
        conn.commit()
    return "✅ 단어장에 저장됐어요!"

def bulk_import_words(user_id: str, items, default_tag: str = "미지정") -> dict:
    """CSV/XLSX에서 읽은 (영어, 한국어) 목록을 일괄 저장.
    영어단어·한국어만 채우고 예문/상세는 빈값, 태그는 default_tag,
    복습일은 NOW()+7일. 이미 있는 단어는 건드리지 않고 건너뛴다(사용자 편집 보호)."""
    added = skipped = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            # 새로 넣을 것만 추림 (DB 기존 단어 + 같은 파일 내 중복 모두 스킵)
            to_insert: list[tuple[str, str]] = []
            seen: set[str] = set()
            for word, korean in items:
                w = (word or "").strip()
                if not w or w.lower() in seen:
                    if w:
                        skipped += 1
                    continue
                cur.execute(
                    "SELECT id FROM words WHERE user_id = %s AND lower(word) = lower(%s)",
                    (user_id, w),
                )
                if cur.fetchone():
                    skipped += 1
                    continue
                seen.add(w.lower())
                to_insert.append((w, (korean or "").strip()))

            # 가져온 단어들은 기존 단어 위쪽에, 파일 순서를 유지하며 배치
            cur.execute(
                "SELECT COALESCE(MIN(sort_order), 0) FROM words WHERE user_id = %s",
                (user_id,),
            )
            base = cur.fetchone()[0]
            n = len(to_insert)
            for i, (w, k) in enumerate(to_insert):
                cur.execute(
                    """INSERT INTO words
                           (user_id, word, korean, korean_detail, english_def,
                            example, tag, sort_order, next_review)
                       VALUES (%s, %s, %s, '', '', '', %s, %s, NOW() + INTERVAL '7 days')""",
                    (user_id, w.lower(), k, default_tag, base - n + i),
                )
                added += 1
        conn.commit()
    return {"added": added, "skipped": skipped, "total": added + skipped}


def existing_words_lower(user_id: str) -> set:
    """사용자가 이미 가진 단어(소문자) 집합 — 가져오기 미리보기의 중복 표시용."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT lower(word) FROM words WHERE user_id = %s", (user_id,))
            return {r[0] for r in cur.fetchall()}


def insert_words(user_id: str, items, overwrite: bool = False) -> dict:
    """미리보기에서 편집된 행들을 저장. 각 item: dict
    {word, korean, korean_detail?, english_def?, example?, tag?}.
    같은 배치 내 중복은 건너뛴다. 새 단어는 목록 위쪽에 배치.

    overwrite=False(기본): 이미 있는 단어는 건너뛴다(사용자 편집 보호).
    overwrite=True: 이미 있는 단어는 '값이 있는 칸만' 갱신한다
      (한국어/한국어상세/예문/태그 중 빈칸은 기존값 보존, 영어뜻은 건드리지 않음)."""
    added = updated = skipped = 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            # 기존 단어(소문자)를 한 번에 조회해 중복은 파이썬에서 거른다 (행별 SELECT 제거)
            cur.execute("SELECT lower(word) FROM words WHERE user_id = %s", (user_id,))
            existing = {r[0] for r in cur.fetchall()}

            to_insert = []
            to_update = []
            seen: set = set()
            for it in items:
                w = (it.get("word") or "").strip()
                if not w:
                    continue
                lw = w.lower()
                if lw in seen:
                    skipped += 1  # 같은 파일 내 중복은 항상 건너뜀
                    continue
                seen.add(lw)
                if lw in existing:
                    if overwrite:
                        to_update.append({**it, "word": w})
                    else:
                        skipped += 1
                    continue
                to_insert.append({**it, "word": w})

            # ── 새 단어 삽입 (INSERT … SELECT unnest, DB 왕복 1회) ──
            if to_insert:
                cur.execute(
                    "SELECT COALESCE(MIN(sort_order), 0) FROM words WHERE user_id = %s",
                    (user_id,),
                )
                base = cur.fetchone()[0]
                n = len(to_insert)
                words_arr = [it["word"].lower() for it in to_insert]
                koreans = [(it.get("korean") or "").strip() for it in to_insert]
                kds = [it.get("korean_detail") or "" for it in to_insert]
                eds = [it.get("english_def") or "" for it in to_insert]
                exs = [it.get("example") or "" for it in to_insert]
                tags = [it.get("tag") or "미지정" for it in to_insert]
                sos = [base - n + i for i in range(n)]
                cur.execute(
                    """INSERT INTO words
                           (user_id, word, korean, korean_detail, english_def,
                            example, tag, sort_order, next_review)
                       SELECT %s, v.word, v.korean, v.kd, v.ed, v.ex, v.tag, v.so,
                              NOW() + INTERVAL '7 days'
                       FROM unnest(
                                %s::text[], %s::text[], %s::text[], %s::text[],
                                %s::text[], %s::text[], %s::int[]
                            ) AS v(word, korean, kd, ed, ex, tag, so)""",
                    (user_id, words_arr, koreans, kds, eds, exs, tags, sos),
                )
                added = cur.rowcount

            # ── 기존 단어 덮어쓰기: 값 있는 칸만 갱신 (CASE로 빈칸 보존, 왕복 1회) ──
            if to_update:
                u_words = [it["word"].lower() for it in to_update]
                u_kors = [(it.get("korean") or "").strip() for it in to_update]
                u_kds = [it.get("korean_detail") or "" for it in to_update]
                u_exs = [it.get("example") or "" for it in to_update]
                u_tags = [it.get("tag") or "" for it in to_update]
                cur.execute(
                    """UPDATE words AS w
                       SET korean        = CASE WHEN v.korean <> '' THEN v.korean ELSE w.korean END,
                           korean_detail = CASE WHEN v.kd <> ''     THEN v.kd     ELSE w.korean_detail END,
                           example       = CASE WHEN v.ex <> ''     THEN v.ex     ELSE w.example END,
                           tag           = CASE WHEN v.tag <> ''    THEN v.tag    ELSE w.tag END
                       FROM unnest(
                                %s::text[], %s::text[], %s::text[], %s::text[], %s::text[]
                            ) AS v(word, korean, kd, ex, tag)
                       WHERE w.user_id = %s AND lower(w.word) = v.word""",
                    (u_words, u_kors, u_kds, u_exs, u_tags, user_id),
                )
                updated = cur.rowcount
        conn.commit()
    return {"added": added, "updated": updated, "skipped": skipped,
            "total": added + updated + skipped}
def get_all_words(user_id: str, tag: str | None = None):
    cols = """id, word, korean, korean_detail, english_def, example,
              tag, created_at, next_review, sort_order"""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            if tag:
                cur.execute(
                    f"""SELECT {cols}
                        FROM words
                        WHERE user_id = %s AND tag = %s
                        ORDER BY sort_order ASC NULLS LAST, created_at DESC""",
                    (user_id, tag),
                )
            else:
                cur.execute(
                    f"""SELECT {cols}
                        FROM words
                        WHERE user_id = %s
                        ORDER BY sort_order ASC NULLS LAST, created_at DESC""",
                    (user_id,),
                )
            return [dict(row) for row in cur.fetchall()]


def get_words_for_quiz(
    user_id: str,
    mode: str = "random",
    tag: str = "",
    saved_from: str = "",
    saved_to: str = "",
    limit: int = 50,
):
    """퀴즈 목표 설정에 맞는 후보 단어를 가져온다.

    TODO: 복습 스케줄 기반 출제로 되돌릴 때 next_review 조건을 옵션으로 추가한다.
    """
    mode = (mode or "random").strip()
    limit = max(1, min(int(limit or 50), 100))
    clauses = ["user_id = %s"]
    params: list = [user_id]
    if mode == "tag" and tag:
        clauses.append("tag = %s")
        params.append(tag)
    if mode == "saved_date":
        if saved_from:
            clauses.append("created_at::date >= %s")
            params.append(saved_from)
        if saved_to:
            clauses.append("created_at::date <= %s")
            params.append(saved_to)

    order_by = "RANDOM()" if mode == "random" else "sort_order ASC NULLS LAST, created_at DESC"
    params.append(limit)
    cols = """id, word, korean, korean_detail, english_def, example,
              tag, created_at, next_review, sort_order"""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(
                f"""SELECT {cols}
                    FROM words
                    WHERE {' AND '.join(clauses)}
                    ORDER BY {order_by}
                    LIMIT %s""",
                params,
            )
            return [dict(row) for row in cur.fetchall()]


def create_quiz_session(user_id: str, goal: dict, question_count: int) -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO quiz_sessions
                       (user_id, mode, tag, saved_from, saved_to, instruction, question_count)
                   VALUES (%s, %s, %s, NULLIF(%s, '')::date, NULLIF(%s, '')::date, %s, %s)
                   RETURNING id""",
                (
                    user_id,
                    goal.get("mode") or "random",
                    goal.get("tag") or "",
                    goal.get("saved_from") or "",
                    goal.get("saved_to") or "",
                    goal.get("instruction") or "",
                    question_count,
                ),
            )
            session_id = cur.fetchone()[0]
        conn.commit()
    return session_id


def complete_quiz_session(user_id: str, session_id: int, score: float, total: int) -> None:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE quiz_sessions
                   SET score = %s, total_questions = %s, completed_at = NOW()
                   WHERE id = %s AND user_id = %s""",
                (score, total, session_id, user_id),
            )
        conn.commit()


def save_quiz_question_results(user_id: str, session_id: int, results: list[dict]) -> None:
    if not results:
        return
    with get_conn() as conn:
        with conn.cursor() as cur:
            for result in results:
                cur.execute(
                    """INSERT INTO quiz_question_results
                           (session_id, user_id, word_id, source_word_id, source_word,
                            target_word, question_type, difficulty, prompt, user_answer,
                            correct_answer, status, correct, score, confidence, feedback,
                            is_derived, derived_from_word_id, suggested_word,
                            suggested_korean, suggested_english_def, suggested_example,
                            suggested_tag)
                       VALUES
                           (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                            %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        session_id,
                        user_id,
                        result.get("word_id"),
                        result.get("source_word_id"),
                        result.get("source_word") or "",
                        result.get("target_word") or "",
                        result.get("question_type") or "",
                        result.get("difficulty") or "",
                        result.get("prompt") or "",
                        result.get("user_answer") or "",
                        result.get("correct_answer") or "",
                        result.get("status") or "",
                        result.get("correct"),
                        result.get("score", 0),
                        result.get("confidence", 1),
                        result.get("feedback") or "",
                        result.get("is_derived", False),
                        result.get("derived_from_word_id"),
                        result.get("suggested_word") or "",
                        result.get("suggested_korean") or "",
                        result.get("suggested_english_def") or "",
                        result.get("suggested_example") or "",
                        result.get("suggested_tag") or "미지정",
                    ),
                )
        conn.commit()


def get_quiz_stats(user_id: str) -> dict:
    """Quiz 탭 전용 학습 통계.

    단어장 도메인을 건드리지 않고 저장된 quiz_question_results에서 직접 집계한다.
    """
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(
                """SELECT
                       COUNT(*)::int AS attempt_count,
                       COALESCE(SUM(score), 0)::float AS total_score,
                       COUNT(*) FILTER (WHERE status = 'correct')::int AS correct_count,
                       COUNT(*) FILTER (WHERE status = 'partial')::int AS partial_count,
                       COUNT(*) FILTER (WHERE status = 'incorrect')::int AS incorrect_count,
                       COUNT(DISTINCT COALESCE(source_word_id, word_id)) FILTER (
                           WHERE status = 'incorrect'
                       )::int AS incorrect_word_count,
                       MAX(created_at) AS last_quiz_at
                   FROM quiz_question_results
                   WHERE user_id = %s""",
                (user_id,),
            )
            summary = dict(cur.fetchone() or {})

            cur.execute(
                """SELECT
                       COALESCE(source_word_id, word_id)::int AS word_id,
                       COALESCE(NULLIF(source_word, ''), NULLIF(target_word, ''), '') AS word,
                       COUNT(*)::int AS attempt_count,
                       COALESCE(SUM(score), 0)::float AS total_score,
                       COUNT(*) FILTER (WHERE status = 'correct')::int AS correct_count,
                       COUNT(*) FILTER (WHERE status = 'partial')::int AS partial_count,
                       COUNT(*) FILTER (WHERE status = 'incorrect')::int AS incorrect_count,
                       MAX(created_at) AS last_quiz_at
                   FROM quiz_question_results
                   WHERE user_id = %s AND COALESCE(source_word_id, word_id) IS NOT NULL
                   GROUP BY COALESCE(source_word_id, word_id),
                            COALESCE(NULLIF(source_word, ''), NULLIF(target_word, ''), '')
                   ORDER BY incorrect_count DESC, attempt_count DESC, last_quiz_at DESC
                   LIMIT 50""",
                (user_id,),
            )
            word_stats = [dict(row) for row in cur.fetchall()]

            cur.execute(
                """SELECT
                       question_type,
                       COUNT(*)::int AS attempt_count,
                       COALESCE(SUM(score), 0)::float AS total_score,
                       COUNT(*) FILTER (WHERE status = 'incorrect')::int AS incorrect_count
                   FROM quiz_question_results
                   WHERE user_id = %s
                   GROUP BY question_type
                   ORDER BY attempt_count DESC""",
                (user_id,),
            )
            type_stats = [dict(row) for row in cur.fetchall()]

            cur.execute(
                """SELECT
                       COALESCE(source_word_id, word_id)::int AS word_id,
                       COALESCE(NULLIF(source_word, ''), NULLIF(target_word, ''), '') AS word,
                       target_word,
                       question_type,
                       prompt,
                       user_answer,
                       correct_answer,
                       feedback,
                       created_at
                   FROM quiz_question_results
                   WHERE user_id = %s AND status = 'incorrect'
                   ORDER BY created_at DESC
                   LIMIT 10""",
                (user_id,),
            )
            recent_incorrect = [dict(row) for row in cur.fetchall()]

    attempt_count = int(summary.get("attempt_count") or 0)
    total_score = float(summary.get("total_score") or 0)
    incorrect_count = int(summary.get("incorrect_count") or 0)
    summary["accuracy"] = round(total_score / attempt_count, 3) if attempt_count else 0
    summary["incorrect_rate"] = round(incorrect_count / attempt_count, 3) if attempt_count else 0

    for item in word_stats:
        attempts = int(item.get("attempt_count") or 0)
        item["accuracy"] = round(float(item.get("total_score") or 0) / attempts, 3) if attempts else 0
        item["incorrect_rate"] = round(int(item.get("incorrect_count") or 0) / attempts, 3) if attempts else 0

    for item in type_stats:
        attempts = int(item.get("attempt_count") or 0)
        item["accuracy"] = round(float(item.get("total_score") or 0) / attempts, 3) if attempts else 0
        item["incorrect_rate"] = round(int(item.get("incorrect_count") or 0) / attempts, 3) if attempts else 0

    return {
        "summary": summary,
        "word_stats": word_stats,
        "type_stats": type_stats,
        "recent_incorrect": recent_incorrect,
    }


def _review_schedule_preview_from_rows(rows) -> list[dict]:
    buckets: dict[int, dict] = {}
    for row in rows:
        try:
            word_id = int(row["word_id"])
        except (TypeError, ValueError):
            continue
        bucket = buckets.setdefault(
            word_id,
            {"word_id": word_id, "word": "", "score": 0.0, "total": 0},
        )
        if not bucket["word"]:
            bucket["word"] = row.get("source_word") or row.get("target_word") or ""
        bucket["score"] += float(row.get("score") or 0)
        bucket["total"] += 1

    now = datetime.now()
    preview = []
    for bucket in buckets.values():
        average = bucket["score"] / bucket["total"] if bucket["total"] else 0
        if average >= 0.8:
            continue
        days = 1
        preview.append(
            {
                "word_id": bucket["word_id"],
                "word": bucket["word"],
                "result": "incorrect",
                "proposed_next_review": (now + timedelta(days=days)).date().isoformat(),
                "interval_days": days,
            }
        )
    return preview


def get_quiz_review_schedule_preview(user_id: str, session_id: int) -> list[dict]:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(
                """SELECT COALESCE(source_word_id, word_id) AS word_id,
                          source_word, target_word, score
                   FROM quiz_question_results
                   WHERE user_id = %s AND session_id = %s
                         AND COALESCE(source_word_id, word_id) IS NOT NULL""",
                (user_id, session_id),
            )
            return _review_schedule_preview_from_rows([dict(row) for row in cur.fetchall()])


def _interval_days(interval_code: str) -> int:
    return {
        "1d": 1,
        "1w": 7,
        "1m": 30,
        "3m": 90,
    }.get((interval_code or "").strip(), 1)


def apply_quiz_review_schedule(user_id: str, session_id: int, incorrect_interval: str = "1d") -> dict:
    """저장된 채점 결과를 기준으로 복습일 조정을 사용자가 확인한 뒤 적용한다."""
    interval_days = _interval_days(incorrect_interval)
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(
                """SELECT id, review_applied_at
                   FROM quiz_sessions
                   WHERE id = %s AND user_id = %s
                   FOR UPDATE""",
                (session_id, user_id),
            )
            session = cur.fetchone()
            if not session:
                conn.commit()
                return {
                    "ok": False,
                    "session_id": session_id,
                    "updated": 0,
                    "already_applied": False,
                    "message": "퀴즈 세션을 찾을 수 없습니다.",
                    "review_schedule_preview": [],
                }

            cur.execute(
                """SELECT COALESCE(source_word_id, word_id) AS word_id,
                          source_word, target_word, score
                   FROM quiz_question_results
                   WHERE user_id = %s AND session_id = %s
                         AND COALESCE(source_word_id, word_id) IS NOT NULL""",
                (user_id, session_id),
            )
            rows = [dict(row) for row in cur.fetchall()]
            preview = _review_schedule_preview_from_rows(rows)
            for item in preview:
                item["interval_days"] = interval_days
                item["proposed_next_review"] = (
                    datetime.now() + timedelta(days=interval_days)
                ).date().isoformat()

            if session["review_applied_at"]:
                conn.commit()
                return {
                    "ok": True,
                    "session_id": session_id,
                    "updated": 0,
                    "already_applied": True,
                    "message": "이미 복습일 조정이 적용된 퀴즈입니다.",
                    "review_schedule_preview": preview,
                }

            updated = 0
            for item in preview:
                cur.execute(
                    """UPDATE words
                       SET next_review = NOW() + (%s::text || ' days')::interval
                       WHERE id = %s AND user_id = %s""",
                    (item["interval_days"], item["word_id"], user_id),
                )
                if cur.rowcount:
                    updated += cur.rowcount
                    cur.execute(
                        "INSERT INTO quiz_history (user_id, word_id, result) VALUES (%s, %s, %s)",
                        (user_id, item["word_id"], item["result"] == "correct"),
                    )

            cur.execute(
                "UPDATE quiz_sessions SET review_applied_at = NOW() WHERE id = %s AND user_id = %s",
                (session_id, user_id),
            )
        conn.commit()

    return {
        "ok": True,
        "session_id": session_id,
        "updated": updated,
        "already_applied": False,
        "message": f"{updated}개 단어의 다음 복습일을 조정했습니다.",
        "review_schedule_preview": preview,
    }

def update_word(user_id: str, word_id: int, korean_detail, english_def,
                example, tag, next_review) -> bool:
    """단어 행 개별 편집. 영어단어(word)·한국어(korean)는 변경하지 않는다.
    편집 가능: 한국어 상세 / 영어뜻 / 예문 / 태그 / 다음 복습일.
    next_review 는 'YYYY-MM-DD' 문자열(또는 빈값=변경 안 함)."""
    sets = [
        "korean_detail = %s",
        "english_def = %s",
        "example = %s",
        "tag = %s",
    ]
    params = [korean_detail, english_def, example, (tag or "미지정")]
    if next_review:
        sets.append("next_review = %s")
        params.append(next_review)
    params.extend([word_id, user_id])
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE words SET {', '.join(sets)} "
                "WHERE id = %s AND user_id = %s",
                params,
            )
            changed = cur.rowcount
        conn.commit()
    return changed > 0


def delete_word(user_id: str, word_id: int) -> bool:
    """단어 행 개별 삭제 (본인 소유만)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM words WHERE id = %s AND user_id = %s",
                (word_id, user_id),
            )
            changed = cur.rowcount
        conn.commit()
    return changed > 0


# 복습일 상대기간 코드 → Postgres INTERVAL (월말·윤년은 INTERVAL이 자동 처리)
REVIEW_INTERVALS = {
    "1d": "1 day",
    "1w": "7 days",
    "1m": "1 month",
    "3m": "3 months",
}


def bulk_update_words(user_id: str, items) -> dict:
    """여러 단어를 한 번에 편집. 각 item: {id, word?, korean?, korean_detail,
    english_def, example, tag, next_review}.
    영어단어(word)·한국어(korean)도 편집 가능. word는 소문자로 저장.
    next_review 는 상대기간 코드('1d'/'1w'/'1m'/'3m') → NOW()+INTERVAL,
    빈값이면 복습일 변경 안 함. (예전 'YYYY-MM-DD' 문자열도 그대로 허용)

    words 유니크 인덱스 (user_id, lower(word)) 충돌 처리:
      - 단어를 바꾸다 기존(다른) 단어와 겹치는 행은 통째로 건너뛰고(skip),
        충돌 단어명을 conflicts 로 돌려준다.
      - 두 단어 값을 서로 맞바꾸는(swap) 등 단일 UPDATE 중 위반이 나면
        전체를 롤백하고 ok=False 로 알린다(데이터 보존).
    반환: {ok, updated, skipped, conflicts:[...]}"""
    # 1) 입력 파싱 (id 기준 dict)
    parsed = {}
    order = []
    for it in items:
        try:
            wid = int(it["id"])
        except (KeyError, TypeError, ValueError):
            continue
        parsed[wid] = it
        order.append(wid)
    if not parsed:
        return {"ok": True, "updated": 0, "skipped": 0, "conflicts": []}

    with get_conn() as conn:
        with conn.cursor() as cur:
            # 2) 사용자의 모든 단어 id→lower(word) 조회 (충돌 판정용)
            cur.execute(
                "SELECT id, lower(word) FROM words WHERE user_id = %s", (user_id,)
            )
            cur_words = {row[0]: row[1] for row in cur.fetchall()}

            # 3) 편집 후 각 행의 최종 lower(word) 계산 (빈 단어는 기존값 유지)
            target = dict(cur_words)  # 미편집 행은 현재값 그대로
            new_word = {}  # id -> 입력된 새 단어(소문자) (편집된 경우만)
            for wid in order:
                if wid not in cur_words:
                    continue  # 내 소유 아님
                raw = (parsed[wid].get("word") or "").strip()
                lw = raw.lower() if raw else cur_words[wid]
                new_word[wid] = lw
                target[wid] = lw

            # 4) 최종 단어 다중 집합에서 중복 탐지 → 단어를 '바꾼' 충돌 행만 skip
            counts = {}
            for lw in target.values():
                counts[lw] = counts.get(lw, 0) + 1
            conflict_ids = set()
            conflicts = []
            for wid in order:
                if wid not in cur_words:
                    continue
                changed = new_word[wid] != cur_words[wid]
                if changed and counts.get(new_word[wid], 0) > 1:
                    conflict_ids.add(wid)
                    conflicts.append(parsed[wid].get("word") or new_word[wid])

            # 5) 충돌 아닌 행만 UPDATE 대상으로 구성
            ids, words_, kors, kds, eds, exs, tags, nrs = [], [], [], [], [], [], [], []
            for wid in order:
                if wid not in cur_words or wid in conflict_ids:
                    continue
                it = parsed[wid]
                ids.append(wid)
                words_.append(new_word[wid])  # 소문자 저장
                kors.append(it.get("korean", "") or "")
                kds.append(it.get("korean_detail", "") or "")
                eds.append(it.get("english_def", "") or "")
                exs.append(it.get("example", "") or "")
                tags.append(it.get("tag") or "미지정")
                nrs.append((it.get("next_review") or "").strip())

            if not ids:
                conn.commit()
                return {"ok": True, "updated": 0, "skipped": len(conflict_ids),
                        "conflicts": conflicts}

            # 행마다 다른 값 + 복습일 코드를 한 번의 UPDATE(unnest)로 처리 → DB 왕복 1회.
            # 복습일: 코드는 NOW()+INTERVAL(월말·윤년 자동), ''는 변경 안 함, 그 외는 날짜로 해석.
            try:
                cur.execute(
                    """UPDATE words AS w
                       SET word = v.word,
                           korean = v.kor,
                           korean_detail = v.kd,
                           english_def = v.ed,
                           example = v.ex,
                           tag = v.tag,
                           next_review = CASE v.nr
                               WHEN '1d' THEN NOW() + INTERVAL '1 day'
                               WHEN '1w' THEN NOW() + INTERVAL '7 days'
                               WHEN '1m' THEN NOW() + INTERVAL '1 month'
                               WHEN '3m' THEN NOW() + INTERVAL '3 months'
                               WHEN '' THEN w.next_review
                               ELSE v.nr::timestamp
                           END
                       FROM unnest(
                                %s::int[], %s::text[], %s::text[], %s::text[],
                                %s::text[], %s::text[], %s::text[], %s::text[]
                            ) AS v(id, word, kor, kd, ed, ex, tag, nr)
                       WHERE w.id = v.id AND w.user_id = %s""",
                    (ids, words_, kors, kds, eds, exs, tags, nrs, user_id),
                )
                updated = cur.rowcount
            except psycopg2.errors.UniqueViolation:
                conn.rollback()
                return {
                    "ok": False,
                    "updated": 0,
                    "skipped": len(conflict_ids),
                    "conflicts": conflicts,
                    "message": "단어를 서로 맞바꾸는 등 중복이 생겨 저장하지 못했어요. 겹치는 단어를 확인해주세요.",
                }
        conn.commit()
    return {"ok": True, "updated": updated, "skipped": len(conflict_ids),
            "conflicts": conflicts}
def bulk_delete_words(user_id: str, ids) -> int:
    """체크된 여러 단어를 한 번에 삭제 (본인 소유만)."""
    clean = []
    for i in ids or []:
        try:
            clean.append(int(i))
        except (TypeError, ValueError):
            continue
    if not clean:
        return 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM words WHERE user_id = %s AND id = ANY(%s)",
                (user_id, clean),
            )
            deleted = cur.rowcount
        conn.commit()
    return deleted


def reorder_words(user_id: str, ordered_ids) -> int:
    """드래그로 바뀐 순서를 저장. ordered_ids는 위→아래 단어 id 목록.
    각 단어의 sort_order를 목록 인덱스(0,1,2…)로 갱신한다.
    단어 수만큼 UPDATE를 보내면 원격 DB 왕복이 그만큼 늘어 느리므로,
    unnest로 한 번의 UPDATE에 모아 1회 왕복으로 처리한다."""
    ids, orders = [], []
    for idx, wid in enumerate(ordered_ids or []):
        try:
            ids.append(int(wid))
            orders.append(idx)
        except (TypeError, ValueError):
            continue
    if not ids:
        return 0
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE words AS w
                   SET sort_order = v.ord
                   FROM unnest(%s::int[], %s::int[]) AS v(id, ord)
                   WHERE w.id = v.id AND w.user_id = %s""",
                (ids, orders, user_id),
            )
            updated = cur.rowcount
        conn.commit()
    return updated


def get_words_to_review(user_id: str):
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute("""
                SELECT * FROM words
                WHERE user_id = %s AND next_review <= NOW()
                ORDER BY next_review ASC
            """, (user_id,))
            return [dict(row) for row in cur.fetchall()]

def update_review(user_id: str, word_id: int, correct: bool):
    """퀴즈 결과에 따라 다음 복습일을 조정한다.

    정답은 기본 한 달 뒤, 오답은 가까운 복습을 위해 하루 뒤로 보낸다.
    """
    days = 30 if correct else 1
    next_review = datetime.now() + timedelta(days=days)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE words SET next_review = %s WHERE id = %s AND user_id = %s",
                (next_review, word_id, user_id)
            )
            if cur.rowcount == 0:
                conn.commit()
                return
            cur.execute(
                "INSERT INTO quiz_history (user_id, word_id, result) VALUES (%s, %s, %s)",
                (user_id, word_id, correct)
            )
        conn.commit()


# ── 라벨(카테고리) — 사용자별 ──────────────────────────────
def _seed_default_labels(user_id: str) -> None:
    """해당 사용자에게 기본 태그를 1회 시드 (이미 있으면 무시)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            for name in DEFAULT_LABELS:
                cur.execute(
                    "INSERT INTO labels (user_id, name) VALUES (%s, %s) "
                    "ON CONFLICT (user_id, name) DO NOTHING",
                    (user_id, name),
                )
        conn.commit()


def get_labels(user_id: str) -> list[str]:
    def _fetch():
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT name FROM labels WHERE user_id = %s "
                    "ORDER BY (name = '미지정') DESC, id ASC",
                    (user_id,),
                )
                return [r[0] for r in cur.fetchall()]

    rows = _fetch()
    if not rows:
        _seed_default_labels(user_id)  # 첫 사용 → 기본 태그 시드
        rows = _fetch()
    return rows


def add_label(user_id: str, name: str) -> tuple[list[str], bool]:
    """라벨 추가. (전체 라벨 목록, 성공여부). 이미 있으면 성공, MAX_LABELS 초과 시 거부."""
    name = (name or "").strip()
    existing = get_labels(user_id)
    if not name:
        return existing, False
    if name in existing:
        return existing, True
    if len(existing) >= MAX_LABELS:
        return existing, False
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO labels (user_id, name) VALUES (%s, %s) "
                "ON CONFLICT (user_id, name) DO NOTHING",
                (user_id, name),
            )
        conn.commit()
    return get_labels(user_id), True


def count_words_by_tag(user_id: str, tag: str) -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM words WHERE user_id = %s AND tag = %s",
                (user_id, tag),
            )
            return cur.fetchone()[0]


def rename_label(user_id: str, old: str, new: str) -> tuple[list[str], bool, str]:
    """태그 이름 변경 + 해당 사용자의 그 태그 단어들의 tag 값도 일괄 변경."""
    old = (old or "").strip()
    new = (new or "").strip()
    if not old or not new:
        return get_labels(user_id), False, "태그 이름이 비어 있습니다."
    if old == "미지정":
        return get_labels(user_id), False, "'미지정' 태그는 변경할 수 없습니다."
    existing = get_labels(user_id)
    if old not in existing:
        return existing, False, "존재하지 않는 태그입니다."
    if new == old:
        return existing, True, "변경 사항이 없습니다."
    if new in existing:
        return existing, False, "이미 있는 태그 이름입니다."
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE labels SET name = %s WHERE user_id = %s AND name = %s",
                (new, user_id, old),
            )
            cur.execute(
                "UPDATE words SET tag = %s WHERE user_id = %s AND tag = %s",
                (new, user_id, old),
            )
        conn.commit()
    return get_labels(user_id), True, "변경되었습니다."


def delete_label(user_id: str, name: str) -> tuple[list[str], bool, str, int]:
    """태그 삭제 + 해당 사용자의 그 태그 단어들도 함께 삭제.
    '미지정'은 삭제 불가, 최소 1개의 태그는 남겨야 함."""
    name = (name or "").strip()
    if name == "미지정":
        return get_labels(user_id), False, "'미지정' 태그는 삭제할 수 없습니다.", 0
    existing = get_labels(user_id)
    if name not in existing:
        return existing, False, "존재하지 않는 태그입니다.", 0
    if len(existing) <= 1:
        return existing, False, "최소 1개의 태그는 있어야 합니다.", 0
    deleted = count_words_by_tag(user_id, name)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM words WHERE user_id = %s AND tag = %s", (user_id, name))
            cur.execute("DELETE FROM labels WHERE user_id = %s AND name = %s", (user_id, name))
        conn.commit()
    return get_labels(user_id), True, "삭제되었습니다.", deleted


# ── 롤플레잉 결과(학습노트) ────────────────────────────────
def save_roleplay_session(user_id, level, scenario, tag, title, turns,
                          summary, expressions, vocab) -> int:
    """대화 종료 후 정리 결과를 저장하고 새 세션 id를 반환한다."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO roleplay_sessions
                       (user_id, level, scenario, tag, title, turns,
                        summary, expressions, vocab)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb)
                   RETURNING id""",
                (user_id, level, scenario, tag, title, turns, summary,
                 json.dumps(expressions or [], ensure_ascii=False),
                 json.dumps(vocab or [], ensure_ascii=False)),
            )
            session_id = cur.fetchone()[0]
        conn.commit()
    return session_id


def get_roleplay_sessions(user_id):
    """사용자의 롤플레잉 결과를 최신순으로 반환한다."""
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.DictCursor) as cur:
            cur.execute(
                """SELECT id, level, scenario, tag, title, turns, summary,
                          expressions, vocab, created_at
                   FROM roleplay_sessions
                   WHERE user_id = %s
                   ORDER BY created_at DESC, id DESC""",
                (user_id,),
            )
            return [dict(row) for row in cur.fetchall()]


def delete_roleplay_session(user_id, session_id) -> bool:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM roleplay_sessions WHERE user_id = %s AND id = %s",
                (user_id, session_id),
            )
            ok = cur.rowcount > 0
        conn.commit()
    return ok
