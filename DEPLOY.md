# 배포 가이드 (Railway + 가비아 도메인 engzenai.co.kr)

처음 배포하는 사람을 위한 단계별 가이드. 스택은 **FastAPI(백엔드) + React 빌드(프론트, 백엔드가 같이 서빙) + Postgres(Railway) + WatsonX** 이고,
백엔드 하나만 배포하면 프론트까지 같이 나갑니다. DB는 이미 Railway에 있습니다.

배포에 필요한 `Dockerfile`, `.dockerignore` 는 이미 저장소 루트에 추가돼 있습니다.
Railway 가 이 Dockerfile 로 (1) 프론트 빌드 → (2) 파이썬 설치 → (3) DB 마이그레이션 후 서버 기동 을 자동으로 합니다.

---

## 0. 큰 그림 (5단계)

1. 코드를 GitHub 에 push
2. Railway 에서 이 저장소로 백엔드 서비스 생성 (Dockerfile 자동 인식)
3. Railway 에 환경변수 입력 (배포용 3개만 바꾸면 됨)
4. 배포되면 임시 도메인으로 동작 확인 → 커스텀 도메인(engzenai.co.kr) 연결
5. Google OAuth 콜백 주소 등록

---

## 1. 코드 push

`Dockerfile`, `.dockerignore`, `DEPLOY.md` 가 새로 생겼으니 커밋해서 올립니다.
(`.env` 는 `.gitignore` 로 제외되어 올라가지 않습니다 — 비밀키는 Railway 에 따로 넣습니다.)

```
git add Dockerfile .dockerignore DEPLOY.md
git commit -m "chore: add Railway deployment (Dockerfile)"
git push origin develop
```

> 실제 서비스는 보통 `main`(또는 배포 브랜치)에서 냅니다. 지금 develop 로 먼저 테스트하고,
> 나중에 main 에 머지해 Railway 가 main 을 바라보게 바꿔도 됩니다.

---

## 2. Railway 에 백엔드 서비스 만들기

1. https://railway.app 로그인 → **기존에 Postgres 가 있는 프로젝트**를 엽니다.
2. 프로젝트 안에서 **New → GitHub Repo** → `EngZenAI/my-english-buddy` 선택.
   (Railway 에 GitHub 연동이 안 돼 있으면 먼저 GitHub 앱 설치/권한 허용)
3. 서비스가 생기면 **Settings → Source** 에서 배포할 브랜치를 지정(예: `develop` 또는 `main`).
4. Railway 는 루트의 `Dockerfile` 을 자동으로 감지합니다. 별도 빌드 명령/스타트 명령을 넣을 필요 없음.
   - (혹시 Nixpacks 로 잡히면 Settings → Build 에서 **Dockerfile** 로 지정)

> 같은 프로젝트에 두는 이유: DB(Postgres)와 백엔드가 한 프로젝트에 있으면 내부 네트워크로
> 연결돼 빠르고, DB 주소를 변수 참조로 깔끔하게 넣을 수 있습니다.

---

## 3. 환경변수 입력 (가장 중요)

백엔드 서비스 → **Variables** 탭에서 아래 값을 넣습니다.
현재 로컬 `.env` 값 대부분을 그대로 복사하고, **배포용으로 3개만 바꿉니다.**

### (A) 배포용으로 새로/다르게 넣는 값

| 변수 | 값 | 이유 |
|------|-----|------|
| `APP_PUBLIC_URL` | `https://engzenai.co.kr` | OAuth 리다이렉트 등 절대주소 기준 |
| `AUTH_COOKIE_SECURE` | `true` | HTTPS 에서 로그인 쿠키가 동작하려면 필수 |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | 같은 프로젝트 Postgres 참조(변수 참조로 입력). 서비스 이름이 Postgres 가 아니면 그 이름으로. |

> `DATABASE_URL` 을 변수 참조 대신, 로컬 `.env` 에 있는 그 값을 그대로 붙여넣어도 동작합니다.
> (이미 그 Railway DB 를 로컬에서 쓰고 있었으므로 데이터가 그대로 이어집니다.)

### (B) 로컬 `.env` 에서 그대로 복사해 넣는 값

```
AUTH_SECRET=...                 (로컬과 동일 값 사용 — 바꾸면 기존 로그인/토큰 무효화됨)
WATSONX_API_KEY=...
WATSONX_PROJECT_ID=...
WATSONX_URL=...
GOOGLE_TRANSLATE_API_KEY=...
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GEMINI_API_KEY=...
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
GEMINI_TTS_VOICE=Kore
SMTP_USERNAME=...
SMTP_PASSWORD=...
```

`OAUTH_SUCCESS_REDIRECT_URL` 은 기본값 `/auth/complete` 라 안 넣어도 됩니다.

> 팁: Railway Variables 는 `KEY=VALUE` 여러 줄을 한 번에 붙여넣는 **Raw Editor** 가 있습니다.

---

## 4. 첫 배포 & 임시 도메인으로 확인

1. 변수 저장하면 Railway 가 자동으로 빌드/배포를 시작합니다. (Deploy 로그에서 진행 확인)
   - 빌드 단계에서 `npm ci → npm run build`, 그다음 파이썬 설치, 마지막에 `alembic upgrade head` 가 보이면 정상.
2. 배포 성공 후 **Settings → Networking → Public Networking** 에서 **Generate Domain** 을 누르면
   `xxxx.up.railway.app` 임시 주소가 생깁니다.
3. 그 주소로 접속해서 검색/로그인 등이 되는지 먼저 확인합니다.
   - (이 단계에선 Google 로그인은 아직 리다이렉트 주소 미등록이라 실패할 수 있음 → 5번에서 처리)

**배포가 실패하면** 아래 "문제 해결" 참고.

---

## 5. 커스텀 도메인(engzenai.co.kr) 연결

가비아는 apex(루트, `engzenai.co.kr`)에 CNAME 을 잘 못 붙입니다. 그래서 **www 를 실제 주소로 쓰고, 루트는 www 로 넘기는** 방식이 가장 안전합니다.

### 5-1. Railway 에 도메인 추가
- 서비스 → **Settings → Networking → Custom Domain** → `www.engzenai.co.kr` 입력.
- Railway 가 **CNAME 대상 주소**(예: `xxxx.up.railway.app` 형태)를 보여줍니다. 이걸 복사.

### 5-2. 가비아 DNS 설정
- 가비아 **My가비아 → 도메인 → DNS 관리툴 → 레코드 수정**.
- CNAME 레코드 추가:
  - 호스트/이름: `www`
  - 값/타깃: Railway 가 준 `xxxx.up.railway.app` (끝에 `.` 포함 형태로 요구하면 그대로)
  - TTL: 기본값(600 등)
- 루트(`engzenai.co.kr`) → www 로 넘기기: 가비아 **웹 포워딩(도메인 포워딩)** 에서
  `engzenai.co.kr` → `https://www.engzenai.co.kr` 로 301 포워딩 설정.

### 5-3. 반영 대기 & SSL
- DNS 전파에 몇 분~수십 분 걸립니다. 전파되면 Railway 가 자동으로 HTTPS 인증서(Let's Encrypt)를 발급합니다.
- Railway Custom Domain 옆에 초록색 체크가 뜨면 완료. `https://www.engzenai.co.kr` 접속 확인.

> 루트 주소를 실제 사이트로 쓰고 싶다면(www 없이), 가비아가 apex CNAME/ALIAS 를 지원하는지 확인이 필요합니다.
> 지원이 애매하면 위처럼 www 를 메인으로 쓰는 게 초보에게 가장 확실합니다.
> 이 경우 `APP_PUBLIC_URL` 을 `https://www.engzenai.co.kr` 로 맞추세요.

---

## 6. Google OAuth 콜백 등록

Google 로그인이 되려면 구글 쪽에 우리 도메인을 등록해야 합니다.

1. https://console.cloud.google.com → 해당 프로젝트 → **API 및 서비스 → 사용자 인증 정보**.
2. 우리 OAuth 클라이언트(웹 애플리케이션) 편집.
3. **승인된 리디렉션 URI** 에 아래를 추가(쓰는 도메인 기준으로):
   - `https://www.engzenai.co.kr/auth/google/callback`
   - (루트도 쓸 거면) `https://engzenai.co.kr/auth/google/callback`
   - 테스트용 임시주소도 추가 가능: `https://xxxx.up.railway.app/auth/google/callback`
4. **승인된 자바스크립트 원본** 에 `https://www.engzenai.co.kr` 추가.
5. 저장 후 몇 분 뒤 로그인 재시도.

> `APP_PUBLIC_URL` 과 실제 접속 도메인, 구글에 등록한 URI 의 도메인이 **셋 다 일치**해야 로그인이 됩니다.

---

## 7. 배포 후 체크리스트
- [ ] 임시/커스텀 도메인에서 단어 검색이 됨 (비회원 기능)
- [ ] 회원가입/이메일 로그인 됨
- [ ] Google 로그인 됨 (6번 완료 후)
- [ ] 단어장 저장/조회 됨 (DB 연결 OK)
- [ ] 퀴즈/롤플레잉/슬랭 동작 (WatsonX 키 유효)
- [ ] 발음(TTS) 동작

---

## 문제 해결

- **빌드 실패 `@rollup/rollup-...` 에러**: 드물게 npm optional deps 버그. `frontend/package-lock.json`
  을 커밋한 상태로 두면 `npm ci` 가 안정적입니다.
- **배포는 됐는데 `/` 가 503 "빌드하세요"**: Dockerfile 의 프론트 빌드 단계가 실패한 것.
  Deploy 로그에서 `npm run build` 부분 확인.
- **로그인해도 바로 풀림 / 쿠키 안 붙음**: `AUTH_COOKIE_SECURE=true` 인지, HTTPS 로 접속 중인지 확인.
- **Google 로그인 `redirect_uri_mismatch`**: 6번의 콜백 URI 가 실제 접속 도메인과 정확히 같아야 함(www 유무, http/https 포함).
- **DB 마이그레이션 오류로 컨테이너가 안 뜸**: Deploy 로그의 `alembic upgrade head` 메시지 확인.
  `DATABASE_URL` 이 올바른지, 이미 로컬에서 `alembic upgrade head` 를 돌려 최신인지 점검.
- **WatsonX 인증 경고**: 키 만료 시 LLM 기능만 영향(검색/단어장은 정상). 새 키로 교체.

---

## 참고: 앞으로의 배포
- 코드 수정 → 지정 브랜치에 `git push` 하면 Railway 가 자동 재배포합니다.
- DB 스키마를 바꿨다면 `backend/alembic/versions` 에 revision 을 추가해서 push 하면,
  컨테이너 시작 시 `alembic upgrade head` 가 자동 적용합니다.
