# Refactoring Plan

이 문서는 현재 코드베이스에서 가장 급한 리팩토링 대상인
`backend/db/repositories.py`와 `backend/routers/api.py`를 안전하게 분리하기 위한 실행 계획이다.

목표는 기능 변경이 아니라 구조 개선이다. 기존 API 경로, 요청/응답 형식, 프론트엔드 호출 방식은 유지한다.

## 현재 문제 요약

- `backend/db/repositories.py`가 DB 초기화, 마이그레이션성 DDL, 단어장, 태그, 퀴즈, 관리자 통계, 마이페이지, 롤플레잉, 기사 학습, 에이전트 저장소를 모두 담당한다.
- `init_db()`가 수백 줄의 수동 DDL과 백필 로직을 포함하고 있어 ORM 모델과 수동 SQL이 이중 진실원이 되어 있다.
- `backend/routers/api.py`가 대부분의 REST API를 단일 라우터에 담고 있어, 기능 하나를 수정해도 인증, 사용량 기록, 파일 가져오기, LLM 호출, 관리자 기능까지 함께 읽어야 한다.
- 테스트 파일과 자동 검증 스크립트가 부족해, 큰 이동 작업 전에 최소 smoke 검증 기준을 먼저 고정해야 한다.

## 1단계: DB Repository 분리

### 목표

`backend/db/repositories.py`의 기존 public 함수명과 import 호환을 유지하면서, 실제 구현을 도메인별 모듈로 이동한다.

### 분리 방향

- `backend/db/repositories.py`
  - 기존 import 경로 호환용 facade로 유지한다.
  - 도메인별 모듈에서 필요한 함수를 re-export한다.
- `backend/db/repositories/words.py`
  - 단어 저장, 조회, 수정, 삭제, 일괄 편집, 일괄 삭제, 정렬, 가져오기 저장.
- `backend/db/repositories/labels.py`
  - 기본 태그 시드, 태그 조회, 추가, 이름 변경, 삭제, 태그별 단어 수.
- `backend/db/repositories/quiz.py`
  - 퀴즈 대상 단어 조회, 퀴즈 세션, 문항 결과, 복습일 적용, 퀴즈 통계.
- `backend/db/repositories/roleplay.py`
  - 롤플레잉 세션 저장, 조회, 삭제.
- `backend/db/repositories/articles.py`
  - 기사 소스, 기사 목록, 기사 상세, 학습 세션, RSS refresh job.
- `backend/db/repositories/admin.py`
  - API 사용량 집계, 학습자 목록, 학습자 상세.
- `backend/db/repositories/account.py`
  - 마이페이지, 계정 상태, 비밀번호 해시, OAuth 연결 해제.
- `backend/db/repositories/agent.py`
  - 에이전트 메모리와 job 저장소.
- `backend/db/schema_migrations.py`
  - 현재 `init_db()`의 수동 DDL, 백필, 시드 로직 이동.

### 진행 순서

1. `init_db()`를 먼저 `schema_migrations.py`로 이동하고, 기존 `repositories.init_db`는 새 함수 호출 wrapper로 유지한다.
2. 단어장/태그 함수부터 분리한다. 이 영역은 사용자 데이터 핵심이고 프론트 의존도가 높아 먼저 경계를 확정한다.
3. 퀴즈와 롤플레잉 저장소를 분리한다. LLM 로직은 건드리지 않는다.
4. 기사/관리자/계정/에이전트 저장소를 순차 분리한다.
5. 모든 이동 후 `backend/db/repositories.py`에는 re-export와 호환 wrapper만 남긴다.

### 유지해야 할 계약

- 기존 import 문은 깨지면 안 된다.
  - 예: `from backend.db.repositories import get_all_words`
- DB 함수 시그니처는 우선 변경하지 않는다.
- `AsyncSession`을 첫 인자로 받는 기존 패턴을 유지한다.
- `user_id` 스코프 조건은 모든 사용자 데이터 쿼리에서 유지한다.
- 수동 DDL은 내용 변경 없이 이동을 우선한다. 동작 변경은 별도 작업으로 분리한다.

## 2단계: API Router 분리

### 목표

`backend/routers/api.py`의 URL과 응답 형식을 유지하면서 FastAPI 라우터를 도메인별 파일로 나눈다.

### 분리 방향

- `backend/routers/api.py`
  - 호환용 aggregate router로 유지한다.
  - 하위 라우터들을 include한다.
- `backend/routers/common.py`
  - `require_user`, `CurrentUserDep`, 관리자 권한 확인, 사용량 기록 helper.
- `backend/routers/search.py`
  - `/api/me`, `/api/search/*`, `/api/tts`.
- `backend/routers/wordbook.py`
  - `/api/words/*`, `/api/labels/*`, 가져오기 preview/commit.
- `backend/routers/quiz.py`
  - `/api/quiz/*`.
- `backend/routers/roleplay.py`
  - `/api/roleplay/*`.
- `backend/routers/articles.py`
  - `/api/articles/*`, `/api/article-sessions/*`, `/api/article-sources`.
- `backend/routers/admin.py`
  - `/api/admin/*`, `/api/article-admin/*`, `/api/admin/articles/*`.
- `backend/routers/agent.py`
  - `/api/agent/*`.
- `backend/routers/account.py`
  - `/api/mypage/*`, `/api/account/*`.
- `backend/routers/slang.py`
  - `/api/slang`.

### 진행 순서

1. 공통 의존성과 helper를 `common.py`로 먼저 이동한다.
2. 단어장 라우터를 분리한다. 프론트 단어장 기능과 직접 연결되어 있어 가장 먼저 검증한다.
3. 퀴즈와 롤플레잉 라우터를 분리한다. 스트리밍 응답과 LLM 사용량 기록이 유지되는지 확인한다.
4. 기사, 관리자, 에이전트, 계정 라우터를 분리한다.
5. `api.py`는 `APIRouter(prefix="/api", tags=["api"])`를 유지하고 하위 라우터 include만 담당하게 만든다.

### 유지해야 할 계약

- 모든 URL path는 기존과 동일해야 한다.
- 요청 body와 응답 JSON shape는 변경하지 않는다.
- 프론트엔드 `frontend/src/api.js`는 원칙적으로 수정하지 않는다.
- 인증 실패 status code와 메시지는 유지한다.
- 사용량 기록이 있던 엔드포인트는 라우터 분리 후에도 기록을 유지한다.

## 리스크와 안전장치

- 대규모 이동 중 import 순환이 생길 수 있다.
  - 공통 helper는 `routers/common.py`와 작은 DB utility 모듈로 분리해 순환을 줄인다.
- `init_db()` 이동은 서버 시작에 직접 영향을 준다.
  - 이동 직후 서버 import와 startup을 별도로 확인한다.
- 라우터 분리는 URL 누락 위험이 크다.
  - 분리 전후 `@router` 경로 목록을 비교한다.
- 테스트가 부족하다.
  - 리팩토링 전에 최소 smoke 검증 명령과 수동 API 확인 목록을 먼저 고정한다.
- 한번에 모든 파일을 이동하면 원인 추적이 어렵다.
  - 도메인 단위로 이동하고, 각 단계마다 문법 검증과 서버 import 검증을 수행한다.

## 검증 체크리스트

### 정적 검증

```powershell
uv run python -m py_compile backend/main.py backend/routers/api.py backend/db/repositories.py
```

분리 후에는 새 모듈도 포함해 검증한다.

```powershell
uv run python -m compileall backend
```

### 서버 시작 검증

```powershell
uvicorn backend.main:app --reload
```

확인할 것:

- startup 중 `create_db_schema()`와 `init_db()`가 실패하지 않는다.
- `init_db()`를 반복 실행해도 DDL과 백필이 idempotent하게 동작한다.
- SQL 로그가 기존처럼 출력된다.

### API Smoke Test

기존 URL 유지 여부를 확인한다.

- `GET /api/me`
- `GET /api/labels`
- `GET /api/words`
- `POST /api/words`
- `POST /api/words/bulk-update`
- `POST /api/words/import/preview`
- `POST /api/quiz/generate`
- `POST /api/roleplay/start`
- `POST /api/roleplay/continue/stream`
- `GET /api/articles`
- `GET /api/admin/api-usage`

### 프론트엔드 영향 확인

라우터 분리만으로는 프론트 코드를 바꾸지 않는다. 최종 확인만 수행한다.

```powershell
cd frontend
npm run build
```

## 후속 후보

백엔드 1, 2단계가 안정화된 뒤 프론트 리팩토링을 진행한다.

- `frontend/src/tabs/RoleplayTab.jsx`
  - 세션 상태, 스트리밍, 음성 인식, TTS, 요약 저장을 hook과 하위 컴포넌트로 분리한다.
- `frontend/src/tabs/WordbookTab.jsx`
  - 태그 편집, 가져오기 미리보기, 일괄 편집, 선택 삭제, 카드 렌더링을 분리한다.

## 기본 원칙

- 이번 리팩토링은 동작 변경이 아니다.
- public API와 DB 스키마의 의미는 유지한다.
- 먼저 이동하고, 그다음 개선한다.
- 하나의 커밋에는 하나의 도메인 이동만 담는 것을 기본으로 한다.
- 큰 파일을 쓴 뒤에는 파일 끝과 빌드/컴파일 결과를 반드시 확인한다.
