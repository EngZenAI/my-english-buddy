# 📚 AI English Tutor (v0)

LLM 기반 나만의 영어 학습 앱

---

## 주요 기능
- 🔍 단어 검색 (영어 뜻 + 한국어 번역 + 발음)
- 💾 단어장 저장 (PostgreSQL)
- ✏️ 자동 퀴즈 생성 + 채점
- 💬 AI 롤플레잉 회화 연습
- 🔁 망각곡선 기반 복습 알림

---

## 기술 스택
| 역할 | 기술 |
|---|---|
| UI | React + Vite + Tailwind |
| API | FastAPI REST (`/api/*`) |
| DB | PostgreSQL (Supabase) |
| LLM | WatsonX / Ollama(qwen2.5) |
| 번역 | Google Cloud Translation API |
| 사전 | Free Dictionary API |
| 워크플로우 | LangChain + LangGraph |

---

## 시작하기

### 1. 환경 세팅
```bash
conda create -n english-app python=3.11
conda activate english-app
pip install -r backend/requirements.txt
# pip install --upgrade -r backend/requirements.txt
```

### 2. 환경변수 설정
```bash
cp .env.example .env
# .env 파일에 아래 값 입력
```

```
DATABASE_URL=postgresql://...
GOOGLE_TRANSLATE_API_KEY=...
WATSONX_API_KEY=...         # 각자 발급
WATSONX_PROJECT_ID=...     # 각자 발급
WATSONX_URL=...            # 각자 발급
AUTH_SECRET=...            #  없으면 openssl rand -hex 32로 생성
AUTH_COOKIE_SECURE=false   # 로컬 HTTP 환경에서=false, HTTPS 배포 환경에서는=true
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
```

> WatsonX 키 없으면 자동으로 Ollama(qwen2.5:7b)로 전환됩니다.

Google OAuth를 사용하려면 Google Cloud Console의 OAuth 클라이언트에 아래 리디렉션 URI를 등록합니다.


```
# 로컬 환경 예시이며, 프로덕션 환경에서는 실제 주로를 입력해야합니다.
http://localhost:8000/auth/google/callback
http://127.0.0.1:8000/auth/google/callback
```

브라우저에서 `localhost`로 접속하면 `localhost` URI가, `127.0.0.1`로 접속하면 `127.0.0.1` URI가 필요합니다.

### 3. Ollama 모델 다운로드 (WatsonX 없을 때)
```bash
ollama pull qwen2.5:7b
```

### 4. 프론트엔드 설치 (최초 1회)
```bash
cd frontend
npm install
```

---

## 실행 방법 (중요)

> **핵심: 백엔드(uvicorn, 8000)는 항상 켜져 있어야 합니다.**
> 로그인·단어검색·단어장·퀴즈 등 모든 데이터와 기능이 백엔드에 있습니다.
> 화면(React)만 떠 있고 백엔드가 꺼져 있으면 `/api ... ECONNREFUSED` 에러가 나고 아무 기능도 동작하지 않습니다.
>
> 구성은 두 조각입니다 — **백엔드(8000) = 데이터/두뇌**, **프론트(화면) = 껍데기**.
> 화면을 띄우는 방법에 따라 아래 두 가지 실행 방식이 있습니다.

### 방식 A — 8000 한 곳만 (평소 추천, 가장 단순)

화면을 미리 빌드해서 백엔드에 넣고, 백엔드만 켭니다. 터미널 1개면 됩니다.

```bash
# 1) 화면 빌드 (프론트 코드를 바꿀 때마다 다시 실행)
cd frontend
npm run build          # frontend/dist 생성

# 2) 백엔드 실행
cd ..
uvicorn backend.main:app --reload
```

→ 브라우저에서 **http://localhost:8000** 접속. (5173·`npm run dev` 불필요)
→ 화면 코드를 수정하면 `npm run build`를 **다시** 해야 반영됩니다.

### 방식 B — 5173 + 8000 둘 다 (프론트를 자주 고칠 때만)

화면을 핫리로드로 개발할 때 사용. **터미널 2개**가 필요합니다.

```bash
# 터미널 1 — 백엔드 (반드시 같이 켜야 함!)
uvicorn backend.main:app --reload          # localhost:8000

# 터미널 2 — 프론트 dev 서버
cd frontend && npm run dev                 # localhost:5173
```

→ 브라우저에서 **http://localhost:5173** 접속. 코드 저장 시 즉시 반영.
→ `/api`와 백엔드 인증 요청은 Vite가 8000번 백엔드로 자동 전달(프록시)합니다.
→ **5173만 켜면 화면은 떠도 기능은 안 됩니다.** 백엔드(8000)를 같이 켜세요.

### 접속 경로 (방식 공통)

| 경로 | 내용 |
|---|---|
| `/`        | React 앱 (방식 A는 8000, 방식 B는 5173) |
| `/api/*`   | REST API (검색·단어장·퀴즈·롤플레잉·슬랭·TTS) |

> 방식 A에서 `frontend/dist`가 없으면(=빌드 안 함) `/` 접속 시 "빌드하세요" 안내(503)가 반환됩니다.
> 이 경우 `frontend` 폴더에서 `npm run build`를 먼저 실행하세요.

---

## 자주 겪는 문제 (Troubleshooting)

**1) `npm run dev` 중 `http proxy error: /api/me ECONNREFUSED`**
백엔드(8000)가 안 켜져 있어서 그렇습니다. 다른 터미널에서 `uvicorn backend.main:app --reload`를 함께 실행하세요. (방식 B 참고)

**2) `npm run build` 시 `Cannot find module @rollup/rollup-win32-x64-msvc`**
npm의 알려진 optional 의존성 버그입니다. `frontend` 폴더에서 `node_modules`와 `package-lock.json`을 **둘 다 지우고** 다시 설치하세요.
```bash
# Windows (cmd)
cd frontend
rmdir /s /q node_modules
del package-lock.json
npm install
npm run build
```
```powershell
# Windows (PowerShell)
cd frontend
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json
npm install
npm run build
```

**3) 8000 접속했더니 "프론트엔드가 아직 빌드되지 않았습니다" 메시지(503)가 뜸**
`npm run build`를 아직 안 한 것입니다. `frontend`에서 `npm run build` 후 다시 접속하세요.

**4) `npm audit`에 esbuild/vite 취약점 경고**
개발 서버(`npm run dev`) 전용 이슈로 빌드 결과물에는 영향이 없습니다. `npm audit fix --force`는 Vite 메이저 버전을 강제로 올려 빌드를 깨뜨릴 수 있으니 사용하지 마세요.

---

## 프로젝트 구조
```
english-learning-app/
├── .env.example
├── backend/
│   ├── requirements.txt
│   ├── main.py        # FastAPI 엔트리 (REST API + React 정적 서빙)
│   ├── app.py         # (구) Gradio UI — 미사용, 참고용
│   ├── services.py    # 검색/포맷/TTS 순수 로직 (UI 비의존)
│   ├── routers/
│   │   ├── api.py     # React용 REST 엔드포인트
│   │   └── auth.py    # 인증 (FastAPI-Users)
│   ├── dictionary.py  # 사전 + 번역 API
│   ├── database.py    # DB 연결
│   └── llm.py         # LLM 퀴즈/롤플레잉
└── frontend/          # React + Vite + Tailwind
    ├── src/
    │   ├── api.js         # REST 클라이언트
    │   ├── App.jsx        # 네비/탭 셸 + 인증 상태
    │   ├── components/    # AudioButton, GoogleButton
    │   ├── tabs/          # Search / Wordbook / Quiz / Roleplay
    │   └── pages/         # Login / Signup
    └── dist/          # 빌드 산출물 (백엔드가 서빙)
```

---

## TODO
- [ ] 망각곡선 복습 알림
- [ ] 크롬 확장앱 버전
- [ ] 사용자 계정 기능
