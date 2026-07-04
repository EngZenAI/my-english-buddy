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
│   ├── db/                  # SQLAlchemy 2 async 세션/도메인별 모델/Repository
│   ├── llm.py               # LangChain/LangGraph: 퀴즈 생성·채점, 롤플레잉, 슬랭 설명
│   └── auth/                # FastAPI-Users 모델/매니저/의존성 (User, AccessToken, OAuthAccount)
└── frontend/                # React + Vite + Tailwind (구버전 Gradio는 제거됨)
    ├── src/
    │   ├── main.jsx         # 엔트리. QueryClientProvider로 앱 감쌈 (react-query 표준)
    │   ├── queryClient.js   # react-query 클라이언트 + queryKeys (words(filter)/labels/labelWordCount)
    │   ├── api.js           # REST 클라이언트 (모든 fetch는 여기 모음)
    │   ├── App.jsx          # 네비/탭 셸 + 로그인 상태(user) 관리, 각 탭에 user/onRequireLogin 전달
    │   ├── components/      # AudioButton, GoogleButton, MemberNotice, AsyncState(Loading/Skeleton/Empty)
    │   ├── tabs/            # SearchTab / WordbookTab / QuizTab / RoleplayTab
    │   └── pages/           # LoginPage / SignupPage (+ 아이디찾기·비번찾기 등은 사용자가 확장)
    └── dist/                # 빌드 산출물 — 백엔드가 이걸 서빙 (gitignore 됨)
```

기술 스택: React+Vite+Tailwind + **@tanstack/react-query**(데이터 캐싱 표준) / FastAPI / Postgres(Railway)
/ FastAPI-Users(쿠키+구글 OAuth) / WatsonX 또는 Ollama(qwen2.5) / Google Translate / dictionaryapi.dev
/ LangChain+LangGraph / gTTS / openpyxl·python-multipart(CSV/XLSX 가져오기).

> **데이터 패칭 표준 = react-query.** 새 탭/화면도 `useQuery`/`useMutation` + `queryKeys`를 쓸 것.
> 로딩 UX는 `components/AsyncState.jsx`(LoadingSpinner/SkeletonBlock/EmptyState) 재사용.

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

**방식 B — 프론트 개발(핫리로드, 권장):** 터미널 2개
```
uvicorn backend.main:app --reload      # 8000 (반드시 함께 켜야 데이터 동작)
cd frontend && npm run dev              # 5173 (여기로 접속; /api·/auth는 8000으로 프록시)
```
- **5173은 `npm run dev`가 떠 있을 때만 열림.** `npm run build`는 파일만 만들고 끝나서 5173엔 아무것도 안 뜸("연결 거부"). 5173 쓰려면 dev를 켤 것.
- 방식 B에선 `npm run build` 불필요(dev가 실시간 컴파일). 단 8000 uvicorn은 API용으로 같이 켜둬야 함.

**방식 A 주의 — 빌드를 먼저, 그다음 서버:** `main.py`는 **시작 시점에 `frontend/dist` 존재 여부를 한 번 검사**해서 있을 때만 SPA 정적 라우트를 등록한다. 그래서 서버를 먼저 켜고 나중에 빌드하면 8000이 503/빈 화면이 됨. 반드시 `npm run build` → 그다음 uvicorn (이미 떠 있으면 재시작).

**구글 OAuth(.env):** `OAUTH_SUCCESS_REDIRECT_URL=/auth/complete` (프론트가 이 경로에서만 로그인 완료 처리). `APP_PUBLIC_URL`은 접속 origin에 맞출 것 — dev(5173)는 기본값, build로 8000 접속 시 `http://localhost:8000`. (한 값으로 두 모드 동시 만족 불가.)

---

## 핵심 설계 결정 (꼭 기억)

- **사용자별 데이터 분리**: `words`, `labels` 모두 `user_id`(UUID) 스코프.
  - repository 함수는 첫 인자로 `AsyncSession`을 받는다.
  - 단어 함수 시그니처: `save_word(session, user_id, ...)`, `get_all_words(session, user_id, tag=None)`,
    `get_words_to_review(session, user_id)`, `is_word_saved(session, user_id, word)`,
    `update_review(session, user_id, ...)`.
  - 태그 함수: `get_labels(session, user_id)`, `add_label(session, user_id, name)`,
    `rename_label(session, user_id, old, new)`, `delete_label(session, user_id, name)`,
    `count_words_by_tag(session, user_id, tag)`.
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
  단어장 일괄 편집의 복습일은 **상대기간 드롭다운**(하루/일주일/한달/3개월 뒤, '변경 안 함')으로 고름 →
  프론트는 코드(`1d/1w/1m/3m`/`""`)를 보내고, `bulk_update_words`가 SQL `CASE`로 `NOW()+INTERVAL` 계산.
  (Postgres INTERVAL / Python timedelta라 월말·연말·윤년 자동 처리.)
- **단어장 편집·삭제·정렬·가져오기 (WordbookTab, 모두 회원전용)**:
  - **단일 쿼리 + 클라이언트 필터**: 단어는 `listWords("")`로 **전체를 1회만** 불러와 react-query 캐시.
    태그 필터는 클라이언트에서 `allWords.filter(tag)`. → 태그 전환 즉시, '갱신 중'은 최초/변경 시에만.
  - **일괄 편집**: '편집' 누르면 전 행이 input/textarea/select로. 영어단어·`korean`은 고정,
    `korean_detail`/`english_def`/`example`/`tag`(기존 태그 select)/`next_review`만 수정. '저장' 한 번에 커밋.
  - **다중 삭제**: 맨 앞 체크박스(헤더=현재 페이지 전체선택, **Shift+클릭 범위선택**) → '삭제'.
    낙관적 업데이트(캐시 즉시 제거, 실패 시 롤백)로 체감 즉각.
  - **드래그 정렬**: `words.sort_order`(INTEGER) 컬럼 순. '전체' 보기에서만 가능(태그 보기는 손잡이 흐림).
    낙관적 반영 + 성공 시 재조회 안 함(되돌림 방지). **'새로고침' 버튼은 단어 목록을 재조회하지 않음**
    (쓰기 직후 Railway 풀/프록시의 read-after-write 지연으로 옛 순서가 잠깐 보이는 문제 회피; 강제 재조회는 F5).
  - **페이지네이션**: 클라이언트, 40개씩(`PAGE_SIZE`). 드래그는 전역 인덱스(`start+idx`)로 매핑.
  - **CSV/XLSX 가져오기 = 미리보기 모달 2단계**: `import/preview`(파싱만, 저장X, 중복표시) →
    모달에서 행 편집/삭제·일괄태그 → `import/commit`(편집된 행 저장). 구글 번역 내보내기는
    **4열**(소스언어/타깃언어/소스/타깃)이라 언어 라벨 보고 영어쪽을 단어로 잡음. 인코딩 utf-8-sig→cp949 순 시도.
  - **성능(원격 DB 왕복 최소화)**: `insert_words`는 기존 단어를 1회 조회한 뒤 SQLAlchemy executemany
    insert로 묶어 저장한다. `bulk_update_words`/`reorder_words`는 현재 행 단위 업데이트라 대량 데이터에서
    병목이 생기면 별도 최적화 대상.
- **단어 필드**: `korean`(단순 번역, 암기용)과 `korean_detail`(품사별 상세, 확인용) 둘 다 저장.
  예문은 사전 예문을 기본값으로 채우되 사용자가 편집한 값(`customExample`)을 저장.
  `phonetic` 컬럼은 DB에서 제거됨(검색 화면 발음 버튼은 검색 응답값으로 동작, DB와 무관).
- **성능**: 검색은 사전 조회+번역을 병렬 실행, dictionary.py에 LRU 캐시. 디바운스 150ms +
  프론트 클라이언트 캐시 + 요청 시퀀스(reqSeq)로 stale 응답 무시. 단어 저장여부 확인은 검색
  결과 표시를 막지 않도록 별도(`/api/words/saved`)로 뒤따라 갱신.
- **DB 접근**: SQLAlchemy 2 async 엔진/세션 사용. FastAPI 라우터는 `SessionDep`
  (`Annotated[AsyncSession, Depends(...)]`)로 요청 단위 세션을 주입받고 repository에 전달한다.
- **SQL 로그**: `backend.main`에서 `enable_sql_logging()`을 호출해 compact SQL 로그를 출력한다.
  기본은 파라미터 미출력. 별도 env는 추가하지 않는다.

---

## 주의할 점 (개발 시 자주 걸림)

- **백엔드 코드 바꾸면 uvicorn 재시작 필요.** DB 스키마 변경은 서버 시작 전에 `alembic upgrade head`로 적용한다.
- **프론트 코드 바꾸면 `npm run build` 다시 해야** 8000에서 반영(또는 dev 서버는 자동).
- **api.py ↔ db/repositories.py 시그니처 동기화 주의.** repository 함수는 `AsyncSession`과
  `user_id`를 받는다. 라우터는 `SessionDep`로 세션을 받고 `_user["id"]`와 함께 넘긴다.
- **DB 마이그레이션은 Alembic으로 처리.** 서버 시작 시 `create_all()`이나 수동 DDL을 실행하지 않는다.
  새 스키마 변경은 `backend/alembic/versions`에 revision을 추가하고 `alembic upgrade head`로 적용한다.
  기존 DB에 Alembic을 처음 연결할 때만 `alembic stamp head`로 baseline을 기록한다.
  raw SQL repository 테이블도 있으므로 `alembic revision --autogenerate` 결과는 그대로 믿지 말고 반드시 검토한다.
- **`uvicorn --reload`는 코드 변경 시 자동 재시작**되므로 백엔드 수정은 보통 자동 반영(안 되면 수동 재시작).
- **WatsonX 키 만료 가능**: 만료 시 시작 로그에 인증 경고가 뜨지만 치명적 아님 → `llm.py`가 로컬
  **Ollama(qwen2.5)** 로 자동 대체. 단 퀴즈/롤플레잉/슬랭 등 LLM 기능을 쓰려면 `ollama serve` + 모델
  (`qwen2.5:7b`) 준비 필요. 검색·단어장·가져오기는 LLM 없이 동작.
- **read-after-write 지연(Railway 풀/프록시)**: DB에 쓴 직후 즉시 다시 읽으면 잠깐 옛 값이 올 수 있음
  (시간 지나면 정상). 그래서 쓰기 직후 불필요한 강제 재조회를 피하고 낙관적 캐시를 신뢰하는 패턴 사용.
- **Railway DB 초기화**: 단어/태그만 비우려면 `TRUNCATE words, quiz_history, labels RESTART IDENTITY;`.
  `users`/`access_tokens`/`oauth_accounts`(계정)는 건드리지 말 것.
- **에디터 저장이 가끔 파일 끝을 잘라먹는 환경 이슈가 있었음** → 큰 파일을 쓴 뒤에는 끝부분(닫는 `}`)이
  온전한지 한 번 확인하고 빌드. (없으면 빌드가 "Unexpected end of file"로 실패.)
- **`npm run build`에서 `@rollup/rollup-win32-x64-msvc` 에러 나면** node_modules와 package-lock.json을
  둘 다 지우고 `npm install` 재실행(npm optional deps 버그).
- `npm audit`의 esbuild/vite 경고는 dev 서버 전용이라 빌드 결과물엔 영향 없음. `audit fix --force` 금지.

---

## REST API 요약 (backend/routers/api.py)

- 공개: `GET /api/me`, `GET /api/search/english|korean?word=`, `GET /api/tts?word=&lang=`.
- 회원 전용(require_user):
  - 단어장: `GET/POST /api/words`, `GET /api/words/saved`,
    `PATCH/DELETE /api/words/{id}`(단건; 현재 UI는 일괄 사용),
    `POST /api/words/bulk-update`(일괄편집), `POST /api/words/bulk-delete`(다중삭제),
    `POST /api/words/reorder`(순서저장), `POST /api/words/import/preview`·`/import/commit`(가져오기 2단계).
  - 태그: `GET/POST /api/labels`, `POST /api/labels/rename`, `DELETE /api/labels?name=`, `GET /api/labels/word-count?tag=`.
  - LLM/롤플레잉: `POST /api/slang`, `POST /api/quiz/generate|grade`,
    `POST /api/roleplay/start|continue|summary|save-words`,
    `GET /api/roleplay/sessions`, `DELETE /api/roleplay/sessions/{id}`.
- 인증(backend/routers/auth.py): 이메일 로그인/회원가입, 구글 OAuth, 로그아웃, 비번 재설정 등.

---

## 브랜치/협업 상태
- 단어장(WordbookTab) 작업은 `feature/wordbook-ux` 브랜치에서 진행됨 → develop에 머지 예정.
- **퀴즈탭(QuizTab)은 팀원이 다른 브랜치에서 개발 중** → 충돌 방지 위해 건드리지 말 것.
- **롤플레잉탭(RoleplayTab)은 `feature/roleplay`에서 1차 완성 상태.**
  모드·레벨·예시카드 UX, 대화 중 코칭, 대화 마무리/정리, 학습노트 저장·조회·삭제,
  토큰 보호용 마무리 안내, 탭 이동 시 대화 유지까지 구현됨. 상세는 아래 "롤플레잉탭" 섹션.
- 단어장 버그 수정 스펙(아래)은 별도 작업 — 새 브랜치(예: `feature/wordbook-fixes`).

---

## 단어장 버그 수정 — 별도 작업 스펙

실제 사용 중 발견된 버그/개선. 관련 파일: `frontend/src/tabs/SearchTab.jsx`,
`frontend/src/tabs/WordbookTab.jsx`, `backend/routers/api.py`, `backend/db/repositories.py`.

1. **태그 편집에 '태그 추가' 추가** (현재는 SearchTab에서만 추가 가능 → 불편).
   - WordbookTab의 태그 편집 모드(`editMode`)에 입력칸+‘추가’ 버튼 → `api.addLabel(name)` 호출.
   - 백엔드는 이미 있음: `add_label(user_id, name)` / `POST /api/labels` (MAX_LABELS=20, 중복 무시).
2. **검색 결과가 안 나와도 저장 가능하게** (현재는 단어만 저장되고 예문/문장이 저장 안 됨).
   - SearchTab 저장 로직이 사전 결과가 없을 때도 사용자가 가진 값(단어+예문/맥락)을 저장하도록 수정.
   - 백엔드 `save_word`는 빈 필드 허용하므로 주로 프론트 게이팅 문제.
3. **검색 중 ‘저장중..’ 표기 제거 → ‘단어장에 저장’ 버튼만 비활성화** (라벨은 그대로, disabled만).
4. **AI 슬랭 결과 저장 시 편집 가능하게**: 현재 AI 답변이 그대로 `english_def`로 저장됨 →
   답변을 **편집 가능한 textarea**로 보여주고, 사용자가 고친 값을 저장. (어느 칼럼에 넣을지도 검토)
5. **버그: 가져오기 미리보기에서 수정 중 모달이 갑자기 닫혀 작업이 사라짐.**
   - 원인 후보: 모달 배경(overlay) `onClick={closePreview}` 때문에 input 텍스트 드래그 선택이
     배경에서 끝나면 닫힘. (또는 react-query `refetchOnWindowFocus`로 인한 재렌더.)
   - 권장 수정: **배경 클릭으로 닫기 제거**(X/취소/적용 버튼으로만 닫기), 필요시 모달 열려있는 동안
     포커스 재조회 비활성화. previewRows 편집 중 절대 초기화되지 않도록 보장.
6. **단어장 일괄 편집에서 영어단어·한국어(`word`/`korean`)도 편집 가능하게** (현재는 고정).
   - 프론트: 해당 칼럼을 input으로. 백엔드 `bulk_update_words`에 `word`,`korean` 갱신 추가.
   - **주의**: `words` 유니크 인덱스 `(user_id, lower(word))` — 단어를 고치다 기존 단어와 충돌하면
     UNIQUE 위반. 충돌 행은 건너뛰고(또는 명확히 에러 반환) 결과를 사용자에게 알릴 것.
7. **(보기 시각화) 단어장 카드형 리스트** — **DB/API/쿼리 변경 없이 렌더링(JSX/Tailwind)만**.
   네이버 영어단어장/구글 번역 단어장 느낌. 카드(단어)당: 영어단어(굵게)+발음 스피커(`AudioButton`,
   lang="en"), 한국어, 예문 한 줄(truncate→hover/확장으로 전체), 태그 칩·등록일·복습일.
   **영어뜻/한국어상세는 평소 숨기고 hover 팝오버**(데스크톱 group-hover, 모바일은 클릭 토글).
   기존 일괄편집·체크박스+Shift 삭제·드래그정렬·페이지네이션40·가져오기 모달·react-query는 그대로 유지.
   `phonetic`(발음기호)은 단어장 데이터엔 없음(DB 제거됨) → 카드엔 생략. (먼저 적용 후 피드백 받아 조정)

---

## 롤플레잉탭(RoleplayTab) — 1차 완성 상태

> 브랜치 `feature/roleplay`. 롤플레잉 1·2·3단계와 학습노트까지 구현 완료.
> 이제 큰 기능 추가보다 **직접 사용하면서 버그 수정·UX 다듬기·결과 품질 개선**을 하는 단계.

**목적(중요)**: 단어 *복습*이 아니라 **실전 원어민 회화 연습**이다. "원어민 친구/애인과
카톡·WhatsApp으로 채팅하는 느낌"으로, AI가 상황 속 상대역을 맡아 사용자가 영어로 말하게
만들고 배운 표현을 실제로 써보게 한다. (※ 과거 "복습단어를 대화에 끼워넣어 복습" 컨셉은 폐기됨.)

**세 가지 모드(scenario)** — 사용자가 상단에서 모드를 고르고, 예시 카드를 클릭하면 즉시 시작:
- `opic`: OPIc 설문형 상황극. 고정 예시 카드(예: "환자가 되어 병원에 전화해 예약 미루기")의
  `situation`이 시스템 프롬프트로 주입되고 AI가 상대역(접수원 등)을 맡는다.
- `tag`: 사용자 단어장 태그(예: `car_konglish`, `여행`, `뉴스기사`)를 주제로 한 대화. **단어가 있는
  태그만** 칩으로 노출(`미지정` 제외). 그 태그의 단어를 "써볼 기회를 만들어주는" 용도로 전달(암기
  점검 아님). 쓸 만한 태그가 없으면(미정리 사용자) 안내 + `general`/`opic` 전환 버튼 노출.
- `general`: 자유 주제 상황극. 고정 예시 카드(카페 바리스타·경기장 매점 알바·면접 등) + **직접 입력칸**.
  입력값/카드의 `situation`을 프롬프트에 주입.

**1단계 구현 완료 — 대화 시작 UX**
- **레벨 적응**: beginner/intermediate/advanced → 어휘·속도·질문 난이도 조절(`ROLEPLAY_LEVEL_GUIDES`).
- **단일 화면 UX**: 상단 레벨·모드 칩 선택 → 바로 아래 예시 카드 → 그 아래 채팅창(항상 표시).
  세부 설정 강요 없이 **카드/태그/자유주제 클릭 즉시 대화 시작**. 레벨·모드 변경 시 대화 초기화,
  진행 중엔 상황 칩 + "다른 상황 고르기".
- **독립 LLM 프로필**: `FEATURE_MODEL_PROFILES["roleplay"]` = `meta-llama/llama-3-3-70b-instruct`
  (`temperature 0.7`, `max_tokens 512`, `top_p 0.9`). 슬랭(`default`)·퀴즈(`quiz`)와 완전 분리.
  `get_llm("roleplay")`로 받아 씀. WatsonX 미프로비저닝 시 Ollama(qwen) 자동 폴백.
- 예시 카드는 **프론트 코드 상수**(`OPIC_CARDS`/`GENERAL_CARDS`)로 고정 — 즉시 시작·빠름·편집 쉬움.

**데이터/엔드포인트 계약**
- `POST /api/roleplay/start` body: `{level, scenario, tag, situation}` → `{history: [[user,bot],...]}`.
- `POST /api/roleplay/continue` body: 위 + `{history, message}`. 엔드포인트는 **stateless** —
  프론트가 세션 설정(level/scenario/tag/situation)을 **매 턴 함께 전달**해 일관성 유지.
- 단어 선택: `tag` 모드만 `get_all_words(user_id, tag)`로 단어를 싣고, OPIc/일반은 단어장 비의존.
- 프론트 `history`는 **객체 메시지 `{role, text}` 리스트**로 관리하고, 백엔드 튜플과는 경계에서 변환
  (`pairsToMessages`/`messagesToPairs`). 코칭/표현추출까지 포함하기 위해 객체 구조 채택.
- 관련 파일: `backend/llm.py`(§5 롤플레잉), `backend/routers/api.py`, `frontend/src/api.js`,
  `frontend/src/tabs/RoleplayTab.jsx`. 데이터 패칭은 react-query 표준.

**2단계 구현 완료 — 대화 중 실시간 코칭**
- `continue_roleplay`가 `{reply, coaching}`(JSON) 반환. 코칭 모드 시스템 프롬프트로 LLM이
  학습자 최근 발화에 대한 한국어 팁(더 자연스러운 표현/문법 교정)을 내고, 깨진 JSON·코드펜스까지
  방어하는 `_parse_coached` 파서로 파싱. 교정은 답변 본문이 아닌 coaching 필드로 분리(몰입 유지).
- history 항목이 `[user, bot, coaching]` 3-튜플로 확장. 프론트는 봇 버블 아래 💡 코칭 블록(앰버)으로 렌더.

**3단계 구현 완료 — 대화 마무리 + 정리 + 학습노트(DB)**
- **대화 길이 제어/토큰 보호**: 사용자 발화 5턴부터 "대화가 충분히 진행됐어요. 마무리할까요?"
  안내 표시, 6턴부터 `continue`에 `wrap_up=true` 전달 → 시스템 프롬프트가 새 주제 없이 자연스럽게
  마무리하도록 유도. 8턴부터는 추가 입력을 막고 정리 버튼만 남김. 진행 중엔 언제든 수동 종료 가능.
- **정리 페이지**: `summarize_roleplay`(LLM 1회)가 `{summary, expressions[], vocab[]}` 추출
  (`_parse_summary` 견고 파서). 요약 + 유용 표현(목록) + 유용 어휘(체크박스+태그 선택 → `insert_words` 재사용 저장).
  정리 프롬프트는 "다음 유사 상황에서 바로 재사용할 수 있는 표현/어휘" 위주로 고르고,
  `so on`, `good luck` 같은 약한 filler는 그대로 뽑지 않도록 제한.
- **결과 저장(학습노트)**: `/api/roleplay/summary` 호출 시 `roleplay_sessions` 테이블에 자동 저장
  (level/scenario/tag/title/turns/summary/expressions(JSONB)/vocab(JSONB)/created_at).
  **학습노트 탭(`LearningNotesTab`)** 에서 세션 카드(요약·표현·어휘·메타)로 조회·삭제.
  삭제 시 항목별 `삭제 중` 스피너와 카드 비활성화 표시.
- **단어장 저장 보강**: 롤플레잉 어휘를 단어장에 저장할 때 `korean`이 비어 있거나 실패값이면
  `translate_korean()`으로 Google Translation API 번역을 채워 저장.
- **상태 유지**: `App.jsx`에서 롤플레잉 탭은 메인 탭 전환 시 언마운트하지 않고 숨김 처리.
  대화 중 검색/단어장/퀴즈/학습노트로 이동해도 채팅·정리 상태가 유지됨. 로그아웃 시에는 새 인스턴스로 초기화.
- **신규 엔드포인트**: `POST /api/roleplay/summary`·`/save-words`, `GET /api/roleplay/sessions`,
  `DELETE /api/roleplay/sessions/{id}`. DB 함수: `save/get/delete_roleplay_session`.

**이제 할 일 — 실사용 기반 QA/개선**
- 직접 여러 시나리오(OPIc/tag/general)를 사용하면서 대화 흐름이 어색한 카드/프롬프트를 조정.
- 정리 결과의 "유용한 표현/어휘" 품질을 실제 출력 기준으로 계속 개선(너무 쉬운 표현, 상황과 무관한 단어 제거).
- 코칭이 너무 잦거나 길어 몰입을 깨는지 확인하고 문구/빈도 조정.
- 토큰 보호 안내(5턴/6턴/8턴)가 너무 이르거나 늦은지 실제 사용감으로 조정.
- 모바일 화면에서 채팅창, 마무리 안내, 학습노트 카드가 겹치거나 답답하지 않은지 점검.
- 저장/삭제/탭 전환/로그아웃 같은 상태 전환 버그를 사용하면서 발견 즉시 수정.

> 환경 이슈 주의: 큰 프론트/백 파일 저장 시 끝부분 잘림(또는 멀티바이트 절단)이 자주 발생함.
> 저장 후 파일 끝(닫는 `}`/`);`)과 빌드(`npm run build`/`py_compile`)를 꼭 확인할 것.

## 다음에 할 만한 일 (TODO)
- 망각곡선 복습 알림(푸시/스케줄).
- 퀴즈/롤플레잉 결과 기록·통계.
- 모바일/반응형 다듬기.
- 크롬 확장앱 버전.
- (완료) 단어장 단어 개별/일괄 편집·삭제·정렬·CSV/XLSX 가져오기.

> 새 세션에서 이어서 개발할 때: 이 문서로 큰 그림을 잡고, 구체적 구현은
> `backend/db/repositories.py`(DB 접근·user_id 스코프), `backend/routers/api.py`(엔드포인트),
> `frontend/src/api.js`(클라이언트), `frontend/src/tabs/*`(화면)를 먼저 읽으면 빠르게 파악됨.
