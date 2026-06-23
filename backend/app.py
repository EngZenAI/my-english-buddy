import gradio as gr
from backend.dictionary import search_word, translate_korean
from backend.database   import (init_db, save_word, get_all_words,
                                 get_words_to_review, update_review)
from backend.llm        import (generate_quiz, grade_quiz,
                                 start_roleplay, continue_roleplay)

# 앱 시작시 DB 테이블 자동 생성
init_db()

# ── 전역 변수 ──────────────────────────────────────────────
quiz_state = {"words": [], "quiz_text": ""}

# ── 단어 검색 ──────────────────────────────────────────────
def lookup(word):
    if not word.strip():
        return "", "", "", "", ""
    data   = search_word(word.strip().lower())
    korean = translate_korean(word.strip())

    # 오디오 URL 있으면 스피커 버튼 HTML 생성
    audio_url = data.get("audio_url", "")
    if audio_url:
        html = f"""
        <audio id="word-audio" src="{audio_url}"></audio>
        <button onclick="document.getElementById('word-audio').play()"
                style="font-size:24px; background:none; border:none; 
                       cursor:pointer; padding:4px;">
            🔊
        </button>
        """
    else:
        html = "<span style='color:gray'>🔇 발음 없음</span>"

    return korean, data["english_def"], data["example"], data["phonetic"], html

# ── 단어 저장 ──────────────────────────────────────────────
def save(word, korean, eng, example, phonetic, context):
    if not word.strip():
        return "❌ 단어를 먼저 검색해주세요!"
    return save_word(
        word.strip().lower(), korean, eng, example, phonetic, context
    )

# ── 단어장 불러오기 ────────────────────────────────────────
def load_wordbook():
    words = get_all_words()
    return [
        [w["word"], w["korean"], w["english_def"],
         w["example"], str(w["next_review"])[:10]]
        for w in words
    ]

# ── 퀴즈 ──────────────────────────────────────────────────
def make_quiz():
    words = get_words_to_review()
    quiz_state["words"]     = words
    quiz_state["quiz_text"] = generate_quiz(words)
    return quiz_state["quiz_text"], ""

def submit_answer(user_answer):
    return grade_quiz(
        quiz_state["words"],
        quiz_state["quiz_text"],
        user_answer
    )

# ── 롤플레잉 ──────────────────────────────────────────────
def chat(history, msg):
    return continue_roleplay(history, msg), ""

# ── Gradio UI ──────────────────────────────────────────────
with gr.Blocks(title="나만의 영어 학습 앱", theme=gr.themes.Soft()) as app:
    gr.Markdown("# 📚 나만의 영어 학습 앱")

    # ── 탭 1: 단어 검색 ────────────────────────────────────
    with gr.Tab("🔍 단어 검색"):
        gr.Markdown("### 모르는 단어를 검색하고 단어장에 저장하세요!")

        with gr.Row():
            word_in    = gr.Textbox(
                label="영어 단어 입력",
                placeholder="예: serendipity",
                scale=4
            )
            search_btn = gr.Button("검색 🔍", variant="primary", scale=0)

        with gr.Row():
            korean_out   = gr.Textbox(label="🇰🇷 한국어 뜻", interactive=False)
            phonetic_out = gr.Textbox(label="발음기호",       interactive=False)

        # 스피커 버튼 (HTML)
        audio_html = gr.HTML(value="")

        eng_out     = gr.Textbox(label="📖 영어 뜻", interactive=False)
        example_out = gr.Textbox(label="✏️ 예문",    interactive=False)
        context_in  = gr.Textbox(
            label="📍 어디서 봤어요? (선택사항)",
            placeholder="예: 넷플릭스 보다가 / 영어 뉴스에서 / 친구 문자에서..."
        )

        with gr.Row():
            save_btn = gr.Button("단어장에 저장 💾", variant="secondary")
            save_msg = gr.Textbox(label="", interactive=False, scale=2)
 

        # 이벤트 연결
        search_btn.click(
            lookup,
            inputs=word_in,
            outputs=[korean_out, eng_out, example_out, phonetic_out, audio_html]
        )
        word_in.submit(
            lookup,
            inputs=word_in,
            outputs=[korean_out, eng_out, example_out, phonetic_out, audio_html]
        )
        save_btn.click(
            save,
            inputs=[word_in, korean_out, eng_out,
                    example_out, phonetic_out, context_in],
            outputs=save_msg
        )

    # ── 탭 2: 단어장 ───────────────────────────────────────
    with gr.Tab("📖 단어장"):
        gr.Markdown("### 저장된 단어 목록")
        refresh_btn = gr.Button("🔄 새로고침", variant="secondary")
        wordbook    = gr.Dataframe(
            headers=["단어", "한국어", "영어뜻", "예문", "다음복습일"],
            interactive=False,
            wrap=True
        )
        refresh_btn.click(load_wordbook, outputs=wordbook)

    # ── 탭 3: 퀴즈 ─────────────────────────────────────────
    with gr.Tab("✏️ 퀴즈"):
        gr.Markdown("### 복습할 단어로 퀴즈를 풀어보세요!")
        quiz_btn     = gr.Button("🎯 퀴즈 생성", variant="primary")
        quiz_out     = gr.Textbox(
            label="퀴즈",
            lines=15,
            interactive=False
        )
        answer_in    = gr.Textbox(
            label="📝 답변 입력",
            lines=6,
            placeholder="1번: \n2번: \n3번: \n4번: \n5번: "
        )
        submit_btn   = gr.Button("✅ 채점하기", variant="secondary")
        feedback_out = gr.Textbox(
            label="📊 채점 결과",
            lines=10,
            interactive=False
        )

        quiz_btn.click(make_quiz, outputs=[quiz_out, feedback_out])
        submit_btn.click(submit_answer, inputs=answer_in, outputs=feedback_out)

    # ── 탭 4: 롤플레잉 ─────────────────────────────────────
    with gr.Tab("💬 롤플레잉"):
        gr.Markdown("### AI 튜터와 영어로 대화해보세요!")
        gr.Markdown("복습할 단어들이 대화 속에 자연스럽게 등장해요 🎭")

        start_btn = gr.Button("🎭 롤플레잉 시작", variant="primary")
        chatbot   = gr.Chatbot(
            label="AI 튜터와 대화",
            height=400
        )

        with gr.Row():
            msg_in   = gr.Textbox(
                label="",
                placeholder="영어로 대답해봐요! (엔터로 전송)",
                scale=4
            )
            send_btn = gr.Button("전송 ➤", scale=0)

        start_btn.click(start_roleplay, outputs=chatbot)
        send_btn.click(chat, inputs=[chatbot, msg_in], outputs=[chatbot, msg_in])
        msg_in.submit(chat,  inputs=[chatbot, msg_in], outputs=[chatbot, msg_in])

app.launch()