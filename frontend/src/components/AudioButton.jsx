import { useRef, useState } from "react";
import { api } from "../api";

// 단어 발음을 서버 gTTS로 받아 재생하는 버튼 (기존 Gradio 🔊 버튼 대체)
export default function AudioButton({ word, lang = "en", phonetic = "" }) {
  const audioRef = useRef(null);
  const cacheRef = useRef({}); // word → base64
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);

  if (!word || !word.trim()) {
    return <span className="text-gray-300 text-base select-none">🔊</span>;
  }

  const play = async () => {
    // 재생 중이면 정지
    if (playing && audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(false);
      return;
    }
    try {
      let b64 = cacheRef.current[word];
      if (!b64) {
        setLoading(true);
        const { audio } = await api.tts(word, lang);
        setLoading(false);
        if (!audio) return;
        cacheRef.current[word] = audio;
        b64 = audio;
      }
      const el = audioRef.current;
      el.src = `data:audio/mp3;base64,${b64}`;
      el.onended = () => setPlaying(false);
      await el.play();
      setPlaying(true);
    } catch {
      setLoading(false);
      setPlaying(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-1 py-0.5">
      <audio ref={audioRef} />
      <button
        type="button"
        onClick={play}
        title="클릭하여 발음 듣기"
        className="w-7 h-7 rounded-full inline-flex items-center justify-center text-gray-500
                   hover:bg-brand-50 transition-colors text-base"
      >
        {loading ? "…" : playing ? "⏹" : "🔊"}
      </button>
      {phonetic && (
        <span className="text-[11px] text-gray-400 font-serif align-middle">
          {phonetic}
        </span>
      )}
    </span>
  );
}
