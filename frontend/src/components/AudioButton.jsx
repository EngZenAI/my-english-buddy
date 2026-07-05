import { useRef, useState } from "react";
import { Loader2, Square, Volume2 } from "lucide-react";
import { api } from "../api";

// 단어 발음을 서버 gTTS로 받아 재생하는 버튼 (기존 Gradio 🔊 버튼 대체)
// 빈 상태와 활성 상태가 동일한 컨테이너/버튼 박스를 써서 아이콘 위치가 흔들리지 않게 한다.
export default function AudioButton({ word, lang = "en", phonetic = "" }) {
  const audioRef = useRef(null);
  const cacheRef = useRef({}); // word → base64
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);

  const hasWord = !!(word && word.trim());

  const play = async () => {
    if (!hasWord) return;
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
      {hasWord && phonetic && (
        <span className="text-[11px] text-gray-400 font-serif align-middle">
          {phonetic}
        </span>
      )}
      <button
        type="button"
        onClick={play}
        disabled={!hasWord}
        title={hasWord ? "클릭하여 발음 듣기" : ""}
        className={`w-7 h-7 rounded-full inline-flex items-center justify-center
                    transition-colors ${
                      hasWord
                        ? "text-slate-500 hover:bg-brand-50 hover:text-brand-600 cursor-pointer"
                        : "text-slate-300 cursor-default select-none"
                    }`}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : playing ? (
          <Square className="h-4 w-4 fill-current" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
      </button>
    </span>
  );
}
