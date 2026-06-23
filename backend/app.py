import gradio as gr
import io
import base64
import time
import re
from gtts import gTTS
from backend.dictionary import search_word, translate_korean, translate_english
from backend.database   import (init_db, save_word, get_all_words,
                                 get_words_to_review, update_review,
                                 is_word_saved)
from backend.llm        import (generate_quiz, grade_quiz,
                                 start_roleplay, continue_roleplay,
                                 explain_slang)


# ── 전역 변수 ──────────────────────────────────────────────
quiz_state = {"words": [], "quiz_text": ""}

# ── 언어 감지 ──────────────────────────────────────────────
def is_korean(text: str) -> bool:
    return bool(re.search(r'[가-힣ㄱ-ㅎㅏ-ㅣ]', text))


PLACEHOLDER_AUDIO = '<div style="display:inline-flex; align-items:center; height:28px; padding: 2px 0 4px 2px;"><span style="color:#ddd; font-size:16px; user-select:none;">🔊</span></div>'


# ── 오디오 HTML 생성 ────────────────────────────────────────
def build_audio_html(word, lang='en'):
    if not word or not word.strip():
        return PLACEHOLDER_AUDIO

    uid      = "eng" if lang == "en" else "kor"
    audio_id = f"audio-{uid}"
    btn_id   = f"btn-{uid}"
    phonetic = search_word(word.strip().lower()).get("phonetic", "") if lang == "en" else ""

    onclick  = f"var a=document.getElementById('{audio_id}');if(a.paused){{a.play();this.innerText=this.innerText.replace('🔊','⏹');}}else{{a.pause();a.currentTime=0;this.innerText=this.innerText.replace('⏹','🔊');}}"
    onended  = f"document.getElementById('{btn_id}').innerText=document.getElementById('{btn_id}').innerText.replace('⏹','🔊');"
    onmover  = "this.style.background='#e8f0fe';"
    onmout   = "this.style.background='none';"
    btn_style = ("font-size:16px; cursor:pointer; color:#777; user-select:none;"
                 " width:28px; height:28px; border-radius:50%; transition:background 0.15s;"
                 " display:inline-flex; align-items:center; justify-content:center;")
    phonetic_html = (f'<span style="font-family:serif; color:#888; font-size:11px;'
                     f' vertical-align:middle; margin-left:4px;">{phonetic}</span>') if phonetic else ""

    try:
        tts = gTTS(text=word.strip(), lang=lang, tld='com')
        buf = io.BytesIO()
        tts.write_to_fp(buf)
        buf.seek(0)
        audio_b64 = base64.b64encode(buf.read()).decode()
        return (
            f'<div style="display:inline-flex; align-items:center; gap:4px; padding: 2px 0 4px 2px;">'
            f'<audio id="{audio_id}" src="data:audio/mp3;base64,{audio_b64}" onended="{onended}"></audio>'
            f'<span id="{btn_id}" onclick="{onclick}" onmouseover="{onmover}" onmouseout="{onmout}"'
            f'      style="{btn_style}" title="클릭하여 발음 듣기">🔊</span>'
            f'{phonetic_html}'
            f'</div>'
        )
    except Exception:
        return PLACEHOLDER_AUDIO


# ── 여러 뜻 포맷 ───────────────────────────────────────────
def format_meanings(meanings_list):
    parts = []
    seen_pos = {}
    for m in meanings_list:
        pos  = m["partOfSpeech"]
        defn = m["definition"]
        if pos not in seen_pos:
            seen_pos[pos] = []
        seen_pos[pos].append(defn)
    for pos, defs in seen_pos.items():
        parts.append(f"[{pos}]\n" + "\n".join(f"• {d}" for d in defs))
    return "\n\n".join(parts)


def korean_per_pos(word, meanings_list):
    seen_pos = list(dict.fromkeys(m["partOfSpeech"] for m in meanings_list))
    if len(seen_pos) <= 1:
        return translate_korean(word)
    lines = []
    for pos in seen_pos:
        defs = [m["definition"] for m in meanings_list if m["partOfSpeech"] == pos]
        kor  = translate_korean(defs[0])
        lines.append(f"[{pos}] {kor}")
    return "\n".join(lines)


# ── 영어 검색 ──────────────────────────────────────────────
def search_from_english(word, kor_st):
    if not word.strip():
        return "", "", "", "", PLACEHOLDER_AUDIO, PLACEHOLDER_AUDIO, kor_st
    data       = search_word(word.strip().lower())
    simple_kor = translate_korean(word.strip())
    detail_kor = korean_per_pos(word.strip(), data["meanings"])
    eng_def    = format_meanings(data["meanings"])
    example    = data["meanings"][0]["example"] if data["meanings"] else ""
    new_kor_st = {**kor_st, "word": simple_kor, "last_searched": simple_kor}
    return simple_kor, eng_def, detail_kor, example, word.strip(), simple_kor, new_kor_st


# ── 한국어 검색 ─────────────────────────────────────────────
def search_from_korean(word, eng_st):
    if not word.strip():
        return "", "", "", "", PLACEHOLDER_AUDIO, PLACEHOLDER_AUDIO, eng_st
    english    = translate_english(word.strip())
    data       = search_word(english.lower())
    detail_kor = korean_per_pos(english, data["meanings"])
    eng_def    = format_meanings(data["meanings"])
    example    = data["meanings"][0]["example"] if data["meanings"] else ""
    new_eng_st = {**eng_st, "word": english, "last_searched": english}
    return english, eng_def, detail_kor, example, english, word.strip(), new_eng_st


# ── 라벨 ────────────────────────────────────────────────────
_LABEL_STYLE = (
    "display:inline-flex; align-items:center; justify-content:center;"
    " background:#eef2ff; color:#4f46e5;"
    " font-size:13px; font-weight:600; padding:5px 12px; border-radius:20px;"
    " white-space:nowrap; letter-spacing:0.2px;"
)
ENG_LABEL_HTML = f'<span style="{_LABEL_STYLE}">🇺🇸 영어</span>'
KOR_LABEL_HTML = f'<span style="{_LABEL_STYLE}">🇰🇷 한국어</span>'

# ── 북마크 버튼 상태 헬퍼 ──────────────────────────────────
def _bookmark_saved():
    return gr.update(value="✅ 저장됨", variant="secondary")

def _bookmark_unsaved():
    return gr.update(value="📥 단어장에 저장", variant="secondary")

def _bookmark_state(eng_word: str):
    if eng_word and eng_word.strip() and is_word_saved(eng_word.strip()):
        return _bookmark_saved(), _bookmark_saved()
    return _bookmark_unsaved(), _bookmark_unsaved()


# ── 단어 저장 ──────────────────────────────────────────────
def do_save(eng_word, kor_word, eng_def, example, context, slang_def):
    if not eng_word or not eng_word.strip():
        return gr.update(), gr.update()
    # 슬랭 설명이 있으면 우선 사용, 없으면 사전 뜻 사용
    final_def = slang_def.strip() if slang_def and slang_def.strip() else eng_def
    save_word(eng_word.strip().lower(), kor_word, final_def, example, "", context)
    return _bookmark_saved(), _bookmark_saved()

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


# ── CSS ───────────────────────────────────────────────────
custom_css = """
/* ── 검색 섹션 카드 ── */
#search-section {
    background: white !important;
    border: 1px solid #e2e8f0 !important;
    border-radius: 8px !important;
    padding: 12px 16px !important;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06) !important;
    gap: 0 !important;
}

/* ── 헤더 행: 레이블 + 북마크 저장 버튼 ── */
#eng-header-row, #kor-header-row {
    display: flex !important;
    align-items: center !important;
    justify-content: space-between !important;
    flex-wrap: nowrap !important;
    min-height: 40px !important;
    padding: 4px 0 2px 0 !important;
    margin: 0 !important;
    gap: 0 !important;
    background: transparent !important;
}
#eng-header-row > *,
#kor-header-row > * {
    flex: 0 0 auto !important;
    width: auto !important;
    min-width: 0 !important;
    padding: 0 !important;
    margin: 0 !important;
    border: none !important;
    box-shadow: none !important;
    background: transparent !important;
}
/* 저장 버튼은 min-width 복원 */
#eng-header-row > #eng-save-btn,
#kor-header-row > #kor-save-btn {
    min-width: fit-content !important;
}
#eng-header-row > * > *,
#kor-header-row > * > * {
    padding: 0 !important;
    margin: 0 !important;
}
#eng-header-row .prose p,
#kor-header-row .prose p {
    margin: 0 !important;
    padding: 0 !important;
}

/* ── 북마크 저장 버튼 스타일 ── */
#eng-save-btn button, #kor-save-btn button {
    border-radius: 20px !important;
    font-size: 13px !important;
    font-weight: 500 !important;
    padding: 4px 14px !important;
    min-height: 32px !important;
    height: 32px !important;
    line-height: 1 !important;
    transition: all 0.15s !important;
    color: #4f46e5 !important;
    background: white !important;
    border: 1.5px solid #c7d2fe !important;
    box-shadow: none !important;
}
#eng-save-btn button:hover, #kor-save-btn button:hover {
    background: #eef2ff !important;
}
#eng-save-btn, #kor-save-btn {
    border: none !important;
    box-shadow: none !important;
    background: transparent !important;
}

/* ── 입력 행 ── */
#eng-input-row, #kor-input-row {
    align-items: center !important;
    padding: 0 !important;
    margin: 0 !important;
    background: transparent !important;
}

/* ── 오디오 행 (텍스트박스 바로 아래, 고정 높이) ── */
#eng-audio-row, #kor-audio-row {
    padding: 0 !important;
    margin: -4px 0 0 0 !important;
    height: 30px !important;
    min-height: 30px !important;
    max-height: 30px !important;
    overflow: hidden !important;
    background: transparent !important;
}
#eng-audio-row > *, #kor-audio-row > * {
    padding: 0 !important;
    margin: 0 !important;
    border: none !important;
    box-shadow: none !important;
    background: transparent !important;
    min-width: 0 !important;
}

/* 영어↔한국어 구분선 */
#kor-header-row {
    margin-top: 8px !important;
    border-top: 1px solid #f0f4f8 !important;
    padding-top: 8px !important;
}

/* ── 슬랭 힌트 버튼 ── */
#slang-hint-btn {
    position: relative !important;
    z-index: 10 !important;
    background: none !important;
    border: none !important;
    box-shadow: none !important;
    color: #aaa !important;
    font-size: 11px !important;
    font-weight: 400 !important;
    padding: 2px 0 0 2px !important;
    margin: 0 !important;
    text-decoration: underline !important;
    cursor: pointer !important;
    text-align: left !important;
    min-height: unset !important;
    height: auto !important;
    width: fit-content !important;
}
#slang-hint-btn:hover {
    color: #888 !important;
    background: none !important;
}
"""

# ── JS ────────────────────────────────────────────────────
_JS = """<script>
(function() {
    // ── 스크롤 점프 방지 ──
    var origSIV = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function() {
        if (window._blockScroll) return;
        origSIV.apply(this, arguments);
    };
    document.addEventListener('click', function(e) {
        if (e.target.closest('button')) {
            window._blockScroll = true;
            setTimeout(function(){ window._blockScroll = false; }, 2000);
        }
    }, true);
})();
</script>"""


# ── Gradio UI ─────────────────────────────────────────────
with gr.Blocks(title="나만의 영어 학습 앱", theme=gr.themes.Soft(), css=custom_css) as app:
    gr.Markdown("# 📚 나만의 영어 학습 앱")
    gr.HTML(_JS)

    # ── 탭 1: 단어 검색 ────────────────────────────────────
    with gr.Tab("🔍 단어 검색"):
        gr.Markdown("### 모르는 단어를 검색하고 단어장에 저장하세요!")

        with gr.Column(elem_id="search-section"):
            # ── 영어 섹션 ──────────────────────────────────
            with gr.Row(elem_id="eng-header-row"):
                gr.HTML(ENG_LABEL_HTML)
                eng_save_btn = gr.Button("📥 단어장에 저장", variant="secondary",
                                          elem_id="eng-save-btn", scale=0, min_width=148)
            with gr.Row(elem_id="eng-input-row"):
                eng_in  = gr.Textbox(placeholder="예: cardiovascular",
                                     show_label=False, scale=1, lines=1,
                                     elem_id="eng-textbox")
                eng_btn = gr.Button("🔍", scale=0, min_width=48,
                                    variant="secondary", elem_id="eng-search-btn")
            with gr.Row(elem_id="eng-audio-row"):
                eng_audio = gr.HTML(PLACEHOLDER_AUDIO)

            # ── 한국어 섹션 ─────────────────────────────────
            with gr.Row(elem_id="kor-header-row"):
                gr.HTML(KOR_LABEL_HTML)
                kor_save_btn = gr.Button("📥 단어장에 저장", variant="secondary",
                                          elem_id="kor-save-btn", scale=0, min_width=148)
            with gr.Row(elem_id="kor-input-row"):
                kor_in  = gr.Textbox(placeholder="예: 심혈관",
                                     show_label=False, scale=1, lines=1,
                                     elem_id="kor-textbox")
                kor_btn = gr.Button("🔍", scale=0, min_width=48,
                                    variant="secondary", elem_id="kor-search-btn")
            with gr.Row(elem_id="kor-audio-row"):
                kor_audio = gr.HTML(PLACEHOLDER_AUDIO)

            slang_btn = gr.Button(
                "원하는 뜻이 아닌가요? AI에게 물어보기",
                variant="secondary",
                elem_id="slang-hint-btn",
                visible=False
            )
            slang_out = gr.Textbox(
                label="💬 슬랭 / 구어체 설명",
                lines=12,
                interactive=False,
                visible=False
            )

        gr.Markdown("---")
        eng_out     = gr.Textbox(label="📖 영어 뜻",    interactive=False, lines=4)
        kor_out     = gr.Textbox(label="🇰🇷 한국어 뜻", interactive=False, lines=3)
        example_out = gr.Textbox(label="✏️ 예문",       interactive=False, lines=3)
        context_in  = gr.Textbox(
            label="📍 어디서 봤어요? (선택사항)",
            placeholder="예: 넷플릭스 보다가 / 영어 뉴스에서 / 친구 문자에서..."
        )

        # ── 상태 ───────────────────────────────────────────
        eng_st = gr.State({"word": "", "changed_at": 0.0, "last_searched": ""})
        kor_st = gr.State({"word": "", "changed_at": 0.0, "last_searched": ""})
        eng_audio_trig = gr.Textbox(visible=False, value="")
        kor_audio_trig = gr.Textbox(visible=False, value="")

        # 출력 목록 (북마크 별도 체인)
        ENG_OUTS = [kor_in, eng_out, kor_out, example_out, eng_audio_trig, kor_audio_trig, kor_st,
                    slang_btn, slang_out]
        KOR_OUTS = [eng_in, eng_out, kor_out, example_out, eng_audio_trig, kor_audio_trig, eng_st,
                    slang_btn, slang_out]
        BK_OUTS  = [eng_save_btn, kor_save_btn]

        # ── 영어 검색 이벤트 ───────────────────────────────
        def do_eng(word, ks):
            results = search_from_english(word, ks)
            show = gr.update(visible=bool(word.strip()))
            hide = gr.update(value="", visible=False)
            return (*results, show, hide)

        def bk_from_eng(word):
            return _bookmark_state(word.strip() if word else "")

        eng_btn.click(do_eng, inputs=[eng_in, kor_st], outputs=ENG_OUTS, show_progress="hidden").then(
            bk_from_eng, inputs=[eng_in], outputs=BK_OUTS, show_progress="hidden")
        eng_in.submit(do_eng, inputs=[eng_in, kor_st], outputs=ENG_OUTS, show_progress="hidden").then(
            bk_from_eng, inputs=[eng_in], outputs=BK_OUTS, show_progress="hidden")

        # ── 한국어 검색 이벤트 ─────────────────────────────
        def do_kor(word, es):
            results = search_from_korean(word, es)
            show = gr.update(visible=bool(word.strip()))
            hide = gr.update(value="", visible=False)
            return (*results, show, hide)

        def bk_from_kor(eng_word):
            return _bookmark_state(eng_word.strip() if eng_word else "")

        kor_btn.click(do_kor, inputs=[kor_in, eng_st], outputs=KOR_OUTS, show_progress="hidden").then(
            bk_from_kor, inputs=[eng_in], outputs=BK_OUTS, show_progress="hidden")
        kor_in.submit(do_kor, inputs=[kor_in, eng_st], outputs=KOR_OUTS, show_progress="hidden").then(
            bk_from_kor, inputs=[eng_in], outputs=BK_OUTS, show_progress="hidden")

        # ── 디바운스: 영어 타이핑 ──────────────────────────
        eng_in.change(lambda w, s: {**s, "word": w, "changed_at": time.time()},
                      inputs=[eng_in, eng_st], outputs=eng_st, show_progress="hidden")

        def eng_timer(es, ks):
            if (es["word"].strip() and es["word"] != es["last_searched"]
                    and time.time() - es["changed_at"] >= 0.3):
                _, eng_def, detail_kor, ex, e_trig, k_trig, new_ks = search_from_english(es["word"], ks)
                new_es = {**es, "last_searched": es["word"]}
                return (gr.skip(), eng_def, detail_kor, ex, e_trig, k_trig, new_es, new_ks,
                        gr.update(visible=True), gr.update(value="", visible=False))
            return (gr.skip(), gr.skip(), gr.skip(), gr.skip(), gr.skip(), gr.skip(), es, ks,
                    gr.skip(), gr.skip())

        gr.Timer(0.3).tick(eng_timer, inputs=[eng_st, kor_st],
                           outputs=[kor_in, eng_out, kor_out, example_out,
                                    eng_audio_trig, kor_audio_trig, eng_st, kor_st,
                                    slang_btn, slang_out],
                           show_progress="hidden")

        # ── 디바운스: 한국어 타이핑 ────────────────────────
        kor_in.change(lambda w, s: {**s, "word": w, "changed_at": time.time()},
                      inputs=[kor_in, kor_st], outputs=kor_st, show_progress="hidden")

        def kor_timer(ks, es):
            if (ks["word"].strip() and ks["word"] != ks["last_searched"]
                    and time.time() - ks["changed_at"] >= 0.3):
                eng_word, eng_def, detail_kor, ex, e_trig, k_trig, new_es = search_from_korean(ks["word"], es)
                new_ks = {**ks, "last_searched": ks["word"]}
                return (gr.skip(), eng_def, detail_kor, ex, e_trig, k_trig, new_es, new_ks,
                        gr.update(visible=True), gr.update(value="", visible=False))
            return (gr.skip(), gr.skip(), gr.skip(), gr.skip(), gr.skip(), gr.skip(), es, ks,
                    gr.skip(), gr.skip())

        gr.Timer(0.3).tick(kor_timer, inputs=[kor_st, eng_st],
                           outputs=[eng_in, eng_out, kor_out, example_out,
                                    eng_audio_trig, kor_audio_trig, eng_st, kor_st,
                                    slang_btn, slang_out],
                           show_progress="hidden")

        # ── 오디오 트리거 ──────────────────────────────────
        eng_audio_trig.change(lambda w: build_audio_html(w, 'en'),
                              inputs=eng_audio_trig, outputs=eng_audio,
                              show_progress="hidden")
        kor_audio_trig.change(lambda w: build_audio_html(w, 'ko'),
                              inputs=kor_audio_trig, outputs=kor_audio,
                              show_progress="hidden")

        # ── 저장 (양방향 모두 같은 함수 호출) ─────────────
        _save_inputs = [eng_in, kor_in, eng_out, example_out, context_in, slang_out]
        _save_outputs = [eng_save_btn, kor_save_btn]
        eng_save_btn.click(do_save, inputs=_save_inputs, outputs=_save_outputs)
        kor_save_btn.click(do_save, inputs=_save_inputs, outputs=_save_outputs)

        # ── 슬랭 설명 (2단계: 로딩 → 결과) ────────────────────
        def slang_loading(eng_word):
            if not eng_word.strip():
                return gr.update(value="단어를 먼저 검색해주세요.", visible=True)
            return gr.update(value="AI가 의미를 분석 중입니다...", visible=True)

        def slang_result(eng_word, kor_word):
            if not eng_word.strip():
                return gr.update()
            return gr.update(value=explain_slang(eng_word.strip(), kor_word.strip()))

        slang_btn.click(slang_loading, inputs=[eng_in], outputs=[slang_out]).then(
            slang_result, inputs=[eng_in, kor_in], outputs=[slang_out]
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
        quiz_out     = gr.Textbox(label="퀴즈", lines=15, interactive=False)
        answer_in    = gr.Textbox(
            label="📝 답변 입력",
            lines=6,
            placeholder="1번: \n2번: \n3번: \n4번: \n5번: "
        )
        submit_btn   = gr.Button("✅ 채점하기", variant="secondary")
        feedback_out = gr.Textbox(label="📊 채점 결과", lines=10, interactive=False)

        quiz_btn.click(make_quiz, outputs=[quiz_out, feedback_out])
        submit_btn.click(submit_answer, inputs=answer_in, outputs=feedback_out)

    # ── 탭 4: 롤플레잉 ─────────────────────────────────────
    with gr.Tab("💬 롤플레잉"):
        gr.Markdown("### AI 튜터와 영어로 대화해보세요!")
        gr.Markdown("복습할 단어들이 대화 속에 자연스럽게 등장해요 🎭")

        start_btn = gr.Button("🎭 롤플레잉 시작", variant="primary")
        chatbot   = gr.Chatbot(label="AI 튜터와 대화", height=400)

        with gr.Row():
            msg_in   = gr.Textbox(
                label="",
                placeholder="영어로 대답해봐요! (엔터로 전송)",
                scale=4
            )
            send_btn = gr.Button("전송 ➤", scale=0)

        def do_start_roleplay():
            words = get_words_to_review()
            return start_roleplay(words)

        start_btn.click(do_start_roleplay, outputs=chatbot)
        send_btn.click(chat, inputs=[chatbot, msg_in], outputs=[chatbot, msg_in])
        msg_in.submit(chat,  inputs=[chatbot, msg_in], outputs=[chatbot, msg_in])

if __name__ == "__main__":
    app.launch()
