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
  - **성능(원격 DB 왕복 최소화)**: `reorder_words`·`bulk_update_words`는 `unnest`로 **1회 UPDATE**,
    `insert_words`는 기존단어 1회 조회 후 **`INSERT…SELECT unnest` 1회**. (단어당 1쿼리 금지 — 느림.)
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
  user_id 추가 및 유니크 인덱스 전환, next_review 기본값 7일, **`sort_order` INTEGER 추가 + 기존행
  created_at 기준 백필**(드래그 정렬용). 새 컬럼은 같은 패턴으로 추가.
- **`uvicorn --reload`는 코드 변경 시 자동 재시작**되므로 백엔드 수정은 보통 자동 반영(안 되면 수동 재시작).
- **WatsonX 키 만료 가능**: 만료 시 시작 로그에 인증 경고가 뜨지만 치명적 아님 → `llm.py`가 로컬
  **Ollama(qwen2.5)** 로 자동 대체. 단 퀴즈/롤플레잉/슬랭 등 LLM 기능을 쓰려면 `ollama serve` + 모델
  (`qwen2.5:7b`) 준비 필요. 검색·단어장·가져오기는 LLM 없이 동작.
- **read-after-write 지연(Railway 풀/프록시)**: DB에 쓴 직후 즉시 다시 읽으면 잠깐 옛 값이 올 수 있음
  (시간 지나면 정상). 그래서 쓰기 직후 불필요한 강제 재조회를 피하고 낙관적 캐시를 신뢰하는 패턴 사용.
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
- 회원 전용(require_user):
  - 단어장: `GET/POST /api/words`, `GET /api/words/saved`,
    `PATCH/DELETE /api/words/{id}`(단건; 현재 UI는 일괄 사용),
    `POST /api/words/bulk-update`(일괄편집), `POST /api/words/bulk-delete`(다중삭제),
    `POST /api/words/reorder`(순서저장), `POST /api/words/import/preview`·`/import/commit`(가져오기 2단계).
  - 태그: `GET/POST /api/labels`, `POST /api/labels/rename`, `DELETE /api/labels?name=`, `GET /api/labels/word-count?tag=`.
  - LLM: `POST /api/slang`, `POST /api/quiz/generate|grade`, `POST /api/roleplay/start|continue`.
- 인증(backend/routers/auth.py): 이메일 로그인/회원가입, 구글 OAuth, 로그아웃, 비번 재설정 등.

---

## 브랜치/협업 상태
- 단어장(WordbookTab) 작업은 `feature/wordbook-ux` 브랜치에서 진행됨 → develop에 머지 예정.
- **퀴즈탭(QuizTab)은 팀원이 다른 브랜치에서 개발 중** → 충돌 방지 위해 건드리지 말 것.
- **다음 작업 = 롤플레잉탭(RoleplayTab)** (아래 스펙). 새 브랜치(예: `feature/roleplay`)에서 진행.

---

## 다음 세션: 롤플레잉탭(RoleplayTab) 재설계 — 스펙

**목표/컨셉**: 사용자의 영어 *회화* 능력 강화. "원어민 친구/애인과 WhatsApp·카톡으로 채팅하는 느낌"
— 실시간 말하기가 어려운 상황(카페·가족과 함께 등)에서도 텍스트로 몰입 학습. AI는 단순 핑퐁이
아니라 **대화 스킬을 갖춘 원어민 + 스피킹테스트 면접관**처럼, 채점항목을 의식하며 사용자의
아이디어·의견·호응을 끌어내고 다음 질문으로 이어감.

**핵심 요구사항**
- **레벨 적응**: beginner / intermediate / advanced 선택 → 그 수준에 맞춰 AI 어휘·속도·질문 난이도 조절.
- **상황극 시나리오**:
  - OPIc 시험 상황극(자기소개, 롤플레이 등 OPIc 포맷).
  - **단어장 태그 기반 상황극**(여행/비즈니스/일상 등 사용자가 고른 태그 → 그 맥락의 역할극).
- **실시간 피드백(대화 중)**: AI는 답만 하지 말고, 사용자 답변에 코칭을 곁들일 것 —
  너무 쉬운 어휘 → 고급 어휘 제안 / 단조로운 표현 → 원어민다운 표현 제안 / 매끄러운 답변 구조 제안.
  (피드백이 대화 몰입을 깨지 않게 톤·분량 조절 — 예: 답변 뒤 작은 코칭 블록.)
- **대화 종료 후 정리**:
  - 이번 대화에서 쓸 만한 표현/어휘·예문을 정리해 제안.
  - **단어장 DB에 추가 제안** → 태그는 `어휘`/`예문` 또는 해당 상황 태그(여행·비즈니스 등) 중 선택.
    수락 시 DB에 추가(기존 `insert_words`/`save_word` 재사용; 새 기본 태그 `어휘`/`예문` 필요 여부 검토).

**구현 메모(시작점)**
- 기존: `llm.py`의 `start_roleplay`/`continue_roleplay`(LangChain, 카페 직원 역할 고정) + api `roleplay/start|continue`
  + `frontend/src/tabs/RoleplayTab.jsx`. 이걸 위 스펙으로 확장.
- 레벨·시나리오·태그를 프롬프트에 주입. 피드백/채점 관점을 시스템 프롬프트에 명시(면접관 루브릭).
- 종료 후 "표현 추출 → 단어장 추가 제안" 흐름은 단어장 쪽 함수(`get_labels`, `insert_words`) 연동.
- LLM은 WatsonX(만료 가능) 또는 Ollama. 비용/지연 고려해 호출 최소화(턴마다 1회).
- 데이터 패칭은 react-query 표준 사용.

## 다음에 할 만한 일 (TODO)
- 망각곡선 복습 알림(푸시/스케줄).
- 퀴즈/롤플레잉 결과 기록·통계.
- 모바일/반응형 다듬기.
- 크롬 확장앱 버전.
- (완료) 단어장 단어 개별/일괄 편집·삭제·정렬·CSV/XLSX 가져오기.

> 새 세션에서 이어서 개발할 때: 이 문서로 큰 그림을 잡고, 구체적 구현은
> `backend/database.py`(스키마·user_id 스코프), `backend/routers/api.py`(엔드포인트),
> `frontend/src/api.js`(클라이언트), `frontend/src/tabs/*`(화면)를 먼저 읽으면 빠르게 파악됨.
