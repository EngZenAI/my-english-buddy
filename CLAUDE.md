# 영어 학습 애플리케이션 (English Buddy)

LLM을 활용한 "나만의 영어 학습" 앱. 단어 검색 → 단어장 저장 → 퀴즈/롤플레잉으로
복습하는 흐름을 통해, 비싼 학원/어학연수 없이도 "강제적 영어 환경 + 개인 튜터"를
제공하는 것이 목표.

## 제품 비전 (요약)
- 문제의식: 12년+ 영어교육에도 실전 회화가 안 되고, 토익/오픽 점수는 2년마다 갱신 필요.
  학원/어학연수가 효과적인 이유는 "강제성"과 "영어로 둘러싸인 환경" 때문.
- 핵심 아이디어: AI가 사용자를 영어 환경에 넣어주고, 개인 튜터처럼 계속 관리.
- 단어장 학습 흐름: 모르는 단어를 "그 단어를 본 맥락(예문)"과 함께 저장 →
  AI가 예문/퀴즈/롤플레잉으로 실전 기반 복습 → 망각곡선(복습일)에 맞춰 다시 출제.

---

## 아키텍처 (현재 상태)

```
english-app/
├── backend/                 # FastAPI REST API + 정적 서빙
│   ├── main.py              # 엔트리. /api·/auth 라우터 + frontend/dist 정적 서빙(SPA)
│   ├── routers/
│   │   ├── api.py           # 앱 기능 REST 엔드포인트 (검색/단어장/태그/퀴즈/롤플/슬랭/TTS)
│   │   └── auth.py          # 인증 (FastAPI-Users: 이메일+구글 OAuth, 비번재설정 등)
│   ├── services.py          # UI 비의존 순수 로직 (검색 조합, 포맷, gTTS) — 병렬 호출
│   ├── dictionary.py        # 외부 API: 사전(dictionaryapi.dev) + 번역(Google) + LRU 캐시
│   ├── database.py          # Postgres 접근 (psycopg2 풀) + 스키마/마이그레이션 + 단어/태그 CRUD
│   ├── llm.py               # LangChain/LangGraph: 퀴즈 생성·채점, 롤플레잉, 슬랭 설명
│   └── auth/                # FastAPI-Users 모델/매니저/의존성 (User, AccessToken, OAuthAccount)
└── frontend/                # React + Vite + Tailwind (구버전 Gradio는 제거됨)
    ├── src/
    │   ├── api.js           # REST 클라이언트 (모든 fetch는 여기 모음)
    │   ├── App.jsx          # 네비/탭 셸 + 로그인 상태(user) 관리, 각 탭에 user/onRequireLogin 전달
    │   ├── components/      # AudioButton(gTTS 재생), GoogleButton, MemberNotice(회원전용 배너)
    │   ├── tabs/            # SearchTab / WordbookTab / QuizTab / RoleplayTab
    │   └── pages/           # LoginPage / SignupPage (+ 아이디찾기·비번찾기 등은 사용자가 확장)
    └── dist/                # 빌드 산출물 — 백엔드가 이걸 서빙 (gitignore 됨)
```

기술 스택: React+Vite+Tailwind / FastAPI / Postgres(Railway) / FastAPI-Users(쿠키+구글 OAuth)
/ WatsonX 또는 Ollama(qwen2.5) / Google Translate / dictionaryapi.dev / LangChain+LangGraph / gTTS.

---

## 실행 방법

DB·LLM·OAuth 키는 `.env`에 있음(`.env.example` 참고). 백엔드는 Postgres가 필요.

**방식 A — 한 서버 (평소):**
```
cd frontend && npm install && npm run build   # frontend/dist 생성
cd .. && uvicorn backend.main:app --reload     # http://localhost:8000
```
- `/` → React 앱, `/api/*` → REST, `/auth/*` → 인증.
- `frontend/dist`가 없으면 `/`는 503 "빌드하세요" 안내.

**방식 B — 프론트 개발(핫리로드):** 터미널 2개
```
uvicorn backend.main:app --reload      # 8000 (반드시 함께 켜야 데이터 동작)
cd frontend && npm run dev              # 5173 (여기로 접속; /api·/auth는 8000으로 프록시)
```

---

## 핵심 설계 결정 (꼭 기억)

- **사용자별 데이터 분리**: `words`, `labels` 모두 `user_id`(UUID) 스코프.
  - 단어 함수 시그니처: `save_word(user_id, ...)`, `get_all_words(user_id, tag=None)`,
    `get_words_to_review(user_id)`, `is_word_saved(user_id, word)`, `update_review(user_id, ...)`.
  - 태그 함수: `get_labels(user_id)`, `add_label(user_id, name)`, `rename_label(user_id, old, new)`,
    `delete_label(user_id, name)`, `count_words_by_tag(user_id, tag)`.
  - `words` 유니크: `(user_id, lower(word))`. `labels` 유니크: `(user_id, name)`.
  - api.py에서 `_user = Depends(require_user)` → `_user["id"]`로 user_id를 넘김.
- **태그(=카테고리, UI 명칭 "태그")**:
  - 기본 6개를 사용자가 처음 접근할 때(get_labels) 시드: `미지정, 여행, 비즈니스, 일상, IT·코딩, 학업`.
  - `미지정`은 기본/폴백 태그 → 항상 맨 앞 정렬, **변경·삭제 불가**. 태그 미선택 저장 시 `미지정`.
  - 사용자당 최대 20개. 태그 삭제 시 그 태그의 (본인) 단어도 함께 삭제(확인창에 개수 표시).
  - 이름 변경 시 그 사용자의 해당 단어 tag 값도 일괄 변경.
- **회원/비회원 게이팅**:
  - 비회원 허용: 단어 검색(영↔한 사전·번역), 발음(TTS). 구글 번역처럼 진입장벽 없음.
  - 회원 전용(서버 `require_user`로 401 보호 + 프론트 `MemberNotice` 안내): 단어장 저장/조회,
    태그 전체, 퀴즈, 롤플레잉, **AI 슬랭 설명("AI에게 물어보기")**.
  - 비회원에겐 검색화면의 태그 영역 자체를 숨김(저장과 연결된 기능이라).
- **복습일**: 신규 저장 단어 `next_review = NOW() + INTERVAL '7 days'`. 퀴즈 정답=+7일, 오답=+1일.
  (Postgres INTERVAL / Python timedelta라 월말·연말·윤년 자동 처리.)
- **단어 필드**: `korean`(단순 번역, 암기용)과 `korean_detail`(품사별 상세, 확인용) 둘 다 저장.
  예문은 사전 예문을 기본값으로 채우되 사용자가 편집한 값(`customExample`)을 저장.
  `phonetic` 컬럼은 DB에서 제거됨(검색 화면 발음 버튼은 검색 응답값으로 동작, DB와 무관).
- **성능**: 검색은 사전 조회+번역을 병렬 실행, dictionary.py에 LRU 캐시. 디바운스 150ms +
  프론트 클라이언트 캐시 + 요청 시퀀스(reqSeq)로 stale 응답 무시. 단어 저장여부 확인은 검색
  결과 표시를 막지 않도록 별도(`/api/words/saved`)로 뒤따라 갱신.
- **DB 연결 풀**: psycopg2 `ThreadedConnectionPool` 사용. (매 요청 새 원격 연결 = TLS 핸드셰이크
  수백 ms 지연이라 풀로 재사용.)

---

## 주의할 점 (개발 시 자주 걸림)

- **백엔드 코드 바꾸면 uvicorn 재시작 필요.** 특히 `init_db()`(스키마/마이그레이션)는 시작 시 1회 실행.
- **프론트 코드 바꾸면 `npm run build` 다시 해야** 8000에서 반영(또는 dev 서버는 자동).
- **api.py ↔ database.py 시그니처 동기화 주의.** database.py 함수가 user_id를 받는데 api.py가
  안 넘기면 런타임 에러. (이번에 한 번 어긋났다 고친 이력 있음.)
- **DB 마이그레이션은 init_db 안에서 `ALTER TABLE ... IF EXISTS / 가드 DO 블록`으로 처리.**
  과거 변경 이력: context→tag 컬럼명 변경, phonetic 제거, korean_detail 추가, words/labels에
  user_id 추가 및 유니크 인덱스 전환, next_review 기본값 7일. 새 컬럼은 같은 패턴으로 추가.
- **Railway DB 초기화**: 단어/태그만 비우려면 `TRUNCATE words, quiz_history, labels RESTART IDENTITY;`.
  `user`/`accesstoken`/`oauth_account`(계정)는 건드리지 말 것.
- **에디터 저장이 가끔 파일 끝을 잘라먹는 환경 이슈가 있었음** → 큰 파일을 쓴 뒤에는 끝부분(닫는 `}`)이
  온전한지 한 번 확인하고 빌드. (없으면 빌드가 "Unexpected end of file"로 실패.)
- **`npm run build`에서 `@rollup/rollup-win32-x64-msvc` 에러 나면** node_modules와 package-lock.json을
  둘 다 지우고 `npm install` 재실행(npm optional deps 버그).
- `npm audit`의 esbuild/vite 경고는 dev 서버 전용이라 빌드 결과물엔 영향 없음. `audit fix --force` 금지.

---

## REST API 요약 (backend/routers/api.py)

- 공개: `GET /api/me`, `GET /api/search/english|korean?word=`, `GET /api/tts?word=&lang=`.
- 회원 전용(require_user): `GET/POST /api/words`, `GET /api/words/saved`,
  `GET/POST /api/labels`, `POST /api/labels/rename`, `DELETE /api/labels?name=`,
  `GET /api/labels/word-count?tag=`, `POST /api/slang`,
  `POST /api/quiz/generate|grade`, `POST /api/roleplay/start|continue`.
- 인증(backend/routers/auth.py): 이메일 로그인/회원가입, 구글 OAuth, 로그아웃, 비번 재설정 등.

---

## 다음에 할 만한 일 (TODO)
- 망각곡선 복습 알림(푸시/스케줄).
- 단어장에서 단어 개별 삭제/수정 UI(현재는 태그 단위 관리 위주).
- 퀴즈/롤플레잉 결과 기록·통계.
- 모바일/반응형 다듬기.
- 크롬 확장앱 버전.

> 새 세션에서 이어서 개발할 때: 이 문서로 큰 그림을 잡고, 구체적 구현은
> `backend/database.py`(스키마·user_id 스코프), `backend/routers/api.py`(엔드포인트),
> `frontend/src/api.js`(클라이언트), `frontend/src/tabs/*`(화면)를 먼저 읽으면 빠르게 파악됨.
