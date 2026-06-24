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
| UI | Gradio |
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

### 4. 실행
```bash
python -m backend.app
```

FastAPI 포함 실행:
```bash
uvicorn backend.main:app
```

---

## 프로젝트 구조
```
english-learning-app/
├── .env.example
└── backend/
    ├── requirements.txt
    ├── app.py
    ├── dictionary.py   # 사전 + 번역 API
    ├── database.py     # DB 연결
    └── llm.py          # LLM 퀴즈/롤플레잉
```

---

## TODO
- [ ] 망각곡선 복습 알림
- [ ] 크롬 확장앱 버전
- [ ] 사용자 계정 기능
