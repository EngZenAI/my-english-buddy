import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Clock3,
  CircleAlert,
  ExternalLink,
  FileText,
  GalleryHorizontalEnd,
  Languages,
  Loader2,
  Play,
  Save,
  Search,
  Subtitles,
  Video,
} from "lucide-react";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import AudioButton from "../components/AudioButton";
import { LoadingSpinner } from "../components/AsyncState";
import SystemNotice from "../components/common/SystemNotice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "ko", label: "Korean" }
];

const DEFAULT_TAG = "미지정";
const TRANSCRIPT_CACHE_PREFIX = "englishBuddy.mediaTranscript.";
const TRANSCRIPT_CACHE_TTL_MS = 30 * 60_000;
const TRANSCRIPT_CACHE_MAX_BYTES = 1_000_000;
const MEDIA_PROVIDER_NAME = ["You", "Tube"].join("");
const MEDIA_PROVIDER_HOST = `${MEDIA_PROVIDER_NAME.toLowerCase()}.com`;
const MEDIA_PLAYER_READY_CALLBACK = `on${MEDIA_PROVIDER_NAME}IframeAPIReady`;
const VIEW_MODES = {
  BALANCED: "balanced",
  THEATER: "theater",
  VIDEO: "video",
  SCRIPT: "script",
};
const TRANSLATION_UNSUPPORTED_MESSAGE = "번역 기능은 현재 Chrome 브라우저만 제공합니다.";
const TRANSLATION_SOURCE_LANGUAGE = "en";
const TRANSLATION_TARGET_LANGUAGE = "ko";

function isSupportedChromeBrowser() {
  if (typeof navigator === "undefined") return false;
  const userAgent = navigator.userAgent || "";
  const vendor = navigator.vendor || "";
  return (
    vendor === "Google Inc." &&
    /Chrome\//.test(userAgent) &&
    !/Edg\//.test(userAgent) &&
    !/OPR\//.test(userAgent) &&
    !/SamsungBrowser\//.test(userAgent)
  );
}

function parseVideoId(value) {
  const raw = (value || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
    }
    if (host.endsWith(MEDIA_PROVIDER_HOST)) {
      if (url.pathname === "/watch") {
        const id = url.searchParams.get("v") || "";
        return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
      }
      const parts = url.pathname.split("/").filter(Boolean);
      if (["embed", "shorts", "live"].includes(parts[0])) {
        return /^[A-Za-z0-9_-]{11}$/.test(parts[1] || "") ? parts[1] : "";
      }
    }
  } catch {
    return "";
  }
  return "";
}

function formatTime(totalSeconds) {
  const safe = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function cleanWord(value) {
  return (value || "")
    .replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "")
    .replace(/[’]/g, "'")
    .trim()
    .toLowerCase();
}

function segmentTranslationKey(segment) {
  if (!segment) return "";
  return `${segment.start}:${segment.end}:${segment.text}`;
}

function transcriptCacheKey(videoId, language) {
  if (!videoId) return "";
  return `${TRANSCRIPT_CACHE_PREFIX}${videoId}.${language || "en"}`;
}

function readTranscriptCache(videoId, language) {
  const key = transcriptCacheKey(videoId, language);
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key) || "";
    if (!raw) return null;
    if (new TextEncoder().encode(raw).length > TRANSCRIPT_CACHE_MAX_BYTES) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    const cached = JSON.parse(raw);
    if (!cached?.data || Date.now() - Number(cached.cachedAt || 0) > TRANSCRIPT_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return { ...cached.data, from_cache: true };
  } catch {
    return null;
  }
}

function writeTranscriptCache(videoId, language, data) {
  const key = transcriptCacheKey(videoId || data?.video_id, language || data?.language || "en");
  if (!key || typeof window === "undefined") return;
  try {
    const payload = JSON.stringify({
      cachedAt: Date.now(),
      data: { ...data, from_cache: false },
    });
    if (new TextEncoder().encode(payload).length > TRANSCRIPT_CACHE_MAX_BYTES) {
      window.sessionStorage.removeItem(key);
      return;
    }
    window.sessionStorage.setItem(key, payload);
  } catch {
    // Browser storage can be full or blocked. The feature still works without cache.
  }
}

function friendlyErrorMessage(error, fallback = "처리하지 못했습니다. 입력값을 확인해주세요.") {
  const raw = String(error?.message || error || "").trim();
  if (!raw) return fallback;
  const jsonStart = raw.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(jsonStart));
      if (typeof parsed.detail === "string") return parsed.detail;
      if (Array.isArray(parsed.detail) && parsed.detail[0]?.msg) return parsed.detail[0].msg;
    } catch {
      // Fall through to plain text cleanup.
    }
  }
  return raw.replace(/^\d{3}\s*/, "").trim() || fallback;
}

function EmbeddedMediaPlayer({ videoId, onPlayer }) {
  const rawId = useId();
  const elementId = `media-player-${rawId.replace(/[^A-Za-z0-9_-]/g, "")}`;

  useEffect(() => {
    if (!videoId) return undefined;
    let cancelled = false;
    let player = null;

    const loadApi = () => {
      if (window.YT?.Player) return Promise.resolve(window.YT);
      if (window.__englishBuddyMediaPlayerApiPromise) return window.__englishBuddyMediaPlayerApiPromise;
      window.__englishBuddyMediaPlayerApiPromise = new Promise((resolve) => {
        const previous = window[MEDIA_PLAYER_READY_CALLBACK];
        window[MEDIA_PLAYER_READY_CALLBACK] = () => {
          previous?.();
          resolve(window.YT);
        };
        const script = document.createElement("script");
        script.src = `https://www.${MEDIA_PROVIDER_HOST}/iframe_api`;
        script.async = true;
        document.head.appendChild(script);
      });
      return window.__englishBuddyMediaPlayerApiPromise;
    };

    loadApi().then((YT) => {
      if (cancelled) return;
      player = new YT.Player(elementId, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: {
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: (event) => onPlayer?.(event.target),
        },
      });
    });

    return () => {
      cancelled = true;
      onPlayer?.(null);
      if (player?.destroy) player.destroy();
    };
  }, [elementId, onPlayer, videoId]);

  return (
    <div className="aspect-video overflow-hidden rounded-md bg-slate-950">
      <div id={elementId} className="h-full w-full" />
    </div>
  );
}

function ClickableTranscriptText({ text, onWordClick }) {
  const parts = String(text || "").split(/([A-Za-z][A-Za-z'’-]{1,})/g);
  return parts.map((part, index) => {
    const word = cleanWord(part);
    if (!word || word.length < 2) {
      return <span key={`${part}-${index}`}>{part}</span>;
    }
    return (
      <button
        key={`${part}-${index}`}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onWordClick(word);
        }}
        className="rounded px-0.5 text-left transition hover:bg-amber-100 hover:text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-300"
        title={`${word} 저장`}
      >
        {part}
      </button>
    );
  });
}

function TranscriptList({
  segments,
  activeIndex,
  autoFollow,
  layoutKey,
  onSeek,
  onWordClick,
  translationEnabled,
  translationCache,
  translationPendingKeys,
  onVisibleSegmentsChange,
}) {
  const parentRef = useRef(null);
  const rowVirtualizer = useVirtualizer({
    count: segments.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 136,
    overscan: 8,
    getItemKey: (index) => `${segments[index]?.start ?? index}-${index}`,
  });

  useEffect(() => {
    if (!autoFollow) return;
    if (activeIndex < 0 || activeIndex >= segments.length) return;
    rowVirtualizer.scrollToIndex(activeIndex, { align: "center" });
  }, [activeIndex, autoFollow, rowVirtualizer, segments.length]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      rowVirtualizer.measure();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [layoutKey, rowVirtualizer]);

  const virtualItems = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    if (!onVisibleSegmentsChange) return;
    const visibleSegments = virtualItems
      .map((virtualItem) => segments[virtualItem.index])
      .filter(Boolean)
      .map((segment) => ({
        key: segmentTranslationKey(segment),
        text: segment.text || "",
      }));
    onVisibleSegmentsChange(visibleSegments);
  }, [onVisibleSegmentsChange, segments, virtualItems]);

  if (!segments.length) {
    return (
      <div className="flex h-full min-h-56 items-center justify-center text-center">
        <div className="max-w-md px-4">
          <Subtitles className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-bold text-slate-900">스크립트가 없습니다</p>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            미디어 링크로 자막 가져오기를 시도하거나 SRT/VTT 스크립트를 붙여넣어 주세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="scrollbar-soft max-h-[52vh] min-h-0 flex-1 overflow-y-auto px-1 xl:h-full xl:max-h-none">
      <div
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualItem) => {
          const index = virtualItem.index;
          const segment = segments[index];
          const active = index === activeIndex;
          const translationKey = segmentTranslationKey(segment);
          const translatedText = translationEnabled ? translationCache.get(translationKey) : "";
          const isTranslating = translationEnabled && translationPendingKeys.has(translationKey);
          return (
          <div
            key={virtualItem.key}
            ref={rowVirtualizer.measureElement}
            data-index={index}
            className="absolute left-1 right-1 top-0 pb-2"
            style={{ transform: `translateY(${virtualItem.start}px)` }}
          >
            <article
              role="button"
              tabIndex={0}
              onClick={() => onSeek(segment.start)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSeek(segment.start);
                }}
              }
              className={cn(
                "grid cursor-pointer grid-cols-[5.25rem_minmax(0,1fr)] gap-3 rounded-md border p-3 transition focus:outline-none focus:ring-2 focus:ring-brand-200",
                active ? "border-brand-200 bg-brand-50 ring-1 ring-brand-100" : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50"
              )}
            >
              <div className="flex min-w-0 flex-col items-start gap-2">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSeek(segment.start);
                  }}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600 transition hover:bg-brand-100 hover:text-brand-800"
                >
                  <Clock3 className="h-3.5 w-3.5" />
                  {formatTime(segment.start)}
                </button>
              </div>
              <div className="min-w-0">
                <p className="text-[15px] leading-7 text-slate-900 md:text-base">
                  <ClickableTranscriptText text={segment.text} onWordClick={(word) => onWordClick(word, segment)} />
                </p>
                {translationEnabled && (translatedText || isTranslating) && (
                  <p className="mt-2 border-t border-slate-100 pt-2 text-sm leading-6 text-slate-600">
                    {translatedText || "번역 중"}
                  </p>
                )}
              </div>
            </article>
          </div>
          );
        })}
      </div>
    </div>
  );
}

function PasteTranscriptDialog({
  open,
  onOpenChange,
  value,
  onChange,
  onApply,
  pending,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>자막 붙여넣기</DialogTitle>
          <DialogDescription>
            자동 자막을 가져오지 못한 영상은 SRT, VTT, 또는 타임스탬프가 있는 텍스트를 붙여넣어 리딩할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="00:00:01.000 --> 00:00:04.000&#10;Hello everyone, welcome to this video."
          className="min-h-72"
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          <Button type="button" onClick={onApply} disabled={!value.trim() || pending} className="bg-brand-700 hover:bg-brand-800">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Subtitles className="h-4 w-4" />}
            스크립트 적용
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WordSaveDialog({
  open,
  onOpenChange,
  draft,
  setDraft,
  labels,
  user,
  onRequireLogin,
  onSave,
  pending,
  message,
  meaningStatus,
}) {
  const tagOptions = Array.from(new Set([DEFAULT_TAG, ...labels.filter(Boolean), draft.tag].filter(Boolean)));
  const meaningLoading = meaningStatus === "loading";
  const meaningUnsupported = meaningStatus === "unsupported";
  const meaningFailed = meaningStatus === "error";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>단어장에 저장</DialogTitle>
          <DialogDescription>영상 문장을 예문으로 함께 저장합니다.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            영어 단어
            <div className="flex items-center gap-2">
              <Input
                value={draft.word}
                onChange={(event) => setDraft((prev) => ({ ...prev, word: event.target.value }))}
              />
              <AudioButton word={draft.word} lang="en" />
            </div>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            한국어 뜻
            <Input
              value={draft.korean}
              onChange={(event) => setDraft((prev) => ({ ...prev, korean: event.target.value }))}
              placeholder={meaningLoading ? "뜻 불러오는 중" : "뜻을 직접 입력"}
            />
            {meaningLoading && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                브라우저 번역으로 뜻을 불러오는 중입니다.
              </span>
            )}
            {meaningUnsupported && (
              <span className="text-xs font-medium text-slate-500">
                이 브라우저에서는 자동 뜻 채우기를 지원하지 않아 직접 입력할 수 있습니다.
              </span>
            )}
            {meaningFailed && (
              <span className="text-xs font-medium text-slate-500">
                뜻을 자동으로 불러오지 못했습니다. 직접 입력해 저장할 수 있습니다.
              </span>
            )}
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            예문
            <Textarea
              value={draft.example}
              onChange={(event) => setDraft((prev) => ({ ...prev, example: event.target.value }))}
              className="min-h-24"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            메모 / 영어 설명
            <Textarea
              value={draft.english_def}
              onChange={(event) => setDraft((prev) => ({ ...prev, english_def: event.target.value }))}
              placeholder="영상에서 쓰인 뉘앙스나 기억할 포인트"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
            태그
            <select
              value={draft.tag}
              onChange={(event) => setDraft((prev) => ({ ...prev, tag: event.target.value }))}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-400"
            >
              {tagOptions.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </label>
          {message && <p className="text-sm font-medium text-emerald-700">{message}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          <Button
            type="button"
            onClick={() => (user ? onSave() : onRequireLogin?.())}
            disabled={pending || !draft.word.trim()}
            className="bg-brand-700 hover:bg-brand-800"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {user ? "저장" : "로그인하고 저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PlayerPanel({ videoId, player, currentTime, onPlayer }) {
  return (
    <section className="min-h-0">
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        {videoId ? (
          <EmbeddedMediaPlayer videoId={videoId} onPlayer={onPlayer} />
        ) : (
          <div className="flex aspect-video items-center justify-center bg-white p-5">
            <div className="w-full max-w-md px-5 py-8 text-center">
              <Video className="mx-auto h-9 w-9 text-slate-400" />
              <p className="mt-3 text-sm font-bold text-slate-900">영상을 불러오세요</p>
              <p className="mt-1 text-sm leading-6 text-slate-500">미디어 링크를 입력하면 플레이어와 스크립트가 함께 표시됩니다.</p>
            </div>
          </div>
        )}
        {videoId && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-3">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Play className="h-4 w-4" />
              <span>{formatTime(currentTime)}</span>
            </div>
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={`https://www.${MEDIA_PROVIDER_HOST}/watch?v=${videoId}`} target="_blank" rel="noreferrer">
                원본 열기 <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function ScriptPanel({
  transcript,
  pending,
  error,
  translationNotice,
  translationEnabled,
  translatorStatus,
  translationCache,
  translationPendingKeys,
  segments,
  activeIndex,
  autoFollow,
  layoutKey,
  onSeek,
  onWordClick,
  onToggleTranslation,
  onVisibleSegmentsChange,
  compact = false,
}) {
  const translationChecking = translatorStatus === "checking";

  return (
    <section className="flex min-h-[22rem] min-w-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-white xl:h-full xl:min-h-0">
      <div
        className={cn(
          "flex shrink-0 flex-col border-b border-slate-100",
          compact
            ? "relative gap-2 px-3 py-3"
            : "gap-3 px-4 py-4 lg:flex-row lg:items-start lg:justify-between"
        )}
      >
        <div className={cn("min-w-0", compact && "pr-20")}>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className={cn("min-w-0 truncate font-extrabold text-slate-950", compact ? "text-base" : "text-lg")}>
              {transcript?.title || "스크립트 리딩"}
            </h3>
          </div>
          {!compact && (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-slate-500">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span className="min-w-0">실제 영상 싱크와 맞지 않을 수 있습니다.</span>
            </p>
          )}
        </div>
        <div className={cn("flex shrink-0 flex-wrap items-center gap-2", compact && "absolute right-3 top-3")}>
          {pending && <LoadingSpinner label="스크립트 준비 중" />}
          <Button
            type="button"
            variant={translationEnabled ? "secondary" : "outline"}
            size="sm"
            aria-pressed={translationEnabled}
            onClick={onToggleTranslation}
            disabled={translationChecking}
            className={cn("h-8 px-3", compact && "h-7 px-2.5 text-xs")}
          >
            {translationChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
            번역
          </Button>
        </div>
      </div>

      {translationNotice && (
        <div className="px-4 pt-4">
          <SystemNotice>{translationNotice}</SystemNotice>
        </div>
      )}

      {error && (
        <div className="px-4 pt-4">
          <SystemNotice>{error}</SystemNotice>
        </div>
      )}

      <div className={cn("flex min-h-40 flex-1 flex-col overflow-hidden xl:min-h-0", compact ? "px-3 py-3" : "px-4 py-4")}>
        <TranscriptList
          segments={segments}
          activeIndex={activeIndex}
          autoFollow={autoFollow}
          layoutKey={layoutKey}
          onSeek={onSeek}
          onWordClick={onWordClick}
          translationEnabled={translationEnabled}
          translationCache={translationCache}
          translationPendingKeys={translationPendingKeys}
          onVisibleSegmentsChange={onVisibleSegmentsChange}
        />
      </div>
    </section>
  );
}

export default function MediaLearningTab({ user, onRequireLogin }) {
  const queryClient = useQueryClient();
  const contentScrollRef = useRef(null);
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState("en");
  const [manualText, setManualText] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [videoId, setVideoId] = useState("");
  const [transcript, setTranscript] = useState(null);
  const [error, setError] = useState("");
  const [player, setPlayer] = useState(null);
  const [currentTime, setCurrentTime] = useState(0);
  const autoFollow = true;
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [viewMode, setViewMode] = useState(VIEW_MODES.BALANCED);
  const [translationEnabled, setTranslationEnabled] = useState(false);
  const [translationNotice, setTranslationNotice] = useState("");
  const [translatorStatus, setTranslatorStatus] = useState("idle");
  const [, setTranslationVersion] = useState(0);
  const translatorRef = useRef(null);
  const translationCacheRef = useRef(new Map());
  const translationPendingSetRef = useRef(new Set());
  const visibleTranslationSegmentsRef = useRef([]);
  const translationProcessingRef = useRef(false);
  const translationRunRef = useRef(0);
  const translationEnabledRef = useRef(false);
  const translatorStatusRef = useRef("idle");
  const [meaningStatus, setMeaningStatus] = useState("idle");
  const wordTranslatorRef = useRef(null);
  const wordTranslationCacheRef = useRef(new Map());
  const wordTranslationRunRef = useRef(0);
  const [draft, setDraft] = useState({
    word: "",
    korean: "",
    korean_detail: "",
    english_def: "",
    example: "",
    tag: DEFAULT_TAG,
  });

  const labelsQuery = useQuery({
    queryKey: queryKeys.labels,
    queryFn: api.listLabels,
    enabled: !!user,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    contentScrollRef.current?.scrollTo({ top: 0 });
  }, []);

  const bumpTranslationVersion = useCallback(() => {
    setTranslationVersion((version) => version + 1);
  }, []);

  const stopTranslation = useCallback(({ clearNotice = true } = {}) => {
    translationRunRef.current += 1;
    translationEnabledRef.current = false;
    translatorStatusRef.current = "idle";
    translationProcessingRef.current = false;
    translationPendingSetRef.current.clear();
    translatorRef.current?.destroy?.();
    translatorRef.current = null;
    setTranslationEnabled(false);
    setTranslatorStatus("idle");
    if (clearNotice) setTranslationNotice("");
    bumpTranslationVersion();
  }, [bumpTranslationVersion]);

  const showTranslationUnsupported = useCallback(() => {
    stopTranslation({ clearNotice: false });
    translatorStatusRef.current = "unsupported";
    setTranslatorStatus("unsupported");
    setTranslationNotice(TRANSLATION_UNSUPPORTED_MESSAGE);
  }, [stopTranslation]);

  const processVisibleTranslations = useCallback(() => {
    if (!translationEnabledRef.current || translatorStatusRef.current !== "ready") return;
    if (translationProcessingRef.current) return;
    const translator = translatorRef.current;
    if (!translator?.translate) return;

    const runId = translationRunRef.current;
    translationProcessingRef.current = true;

    const translateNext = async () => {
      if (
        runId !== translationRunRef.current ||
        !translationEnabledRef.current ||
        translatorStatusRef.current !== "ready"
      ) {
        translationProcessingRef.current = false;
        return;
      }

      const nextSegment = visibleTranslationSegmentsRef.current.find(
        (segment) =>
          segment.key &&
          segment.text &&
          !translationCacheRef.current.has(segment.key) &&
          !translationPendingSetRef.current.has(segment.key)
      );

      if (!nextSegment) {
        translationProcessingRef.current = false;
        return;
      }

      translationPendingSetRef.current.add(nextSegment.key);
      bumpTranslationVersion();

      try {
        const translated = await translator.translate(nextSegment.text);
        if (runId === translationRunRef.current && translationEnabledRef.current) {
          translationCacheRef.current.set(nextSegment.key, translated || "");
        }
      } catch {
        if (runId === translationRunRef.current && translationEnabledRef.current) {
          translationCacheRef.current.set(nextSegment.key, "");
        }
      } finally {
        translationPendingSetRef.current.delete(nextSegment.key);
        bumpTranslationVersion();
        window.setTimeout(translateNext, 0);
      }
    };

    translateNext();
  }, [bumpTranslationVersion]);

  const enableBrowserTranslation = useCallback(async () => {
    const requestId = translationRunRef.current + 1;
    translationRunRef.current = requestId;
    translationEnabledRef.current = false;
    translatorStatusRef.current = "checking";
    setTranslationEnabled(false);
    setTranslatorStatus("checking");
    setTranslationNotice("");

    if (!isSupportedChromeBrowser() || typeof globalThis === "undefined") {
      showTranslationUnsupported();
      return;
    }

    const TranslatorApi = globalThis.Translator;
    if (!TranslatorApi?.availability || !TranslatorApi?.create) {
      showTranslationUnsupported();
      return;
    }

    try {
      const options = {
        sourceLanguage: TRANSLATION_SOURCE_LANGUAGE,
        targetLanguage: TRANSLATION_TARGET_LANGUAGE,
      };
      const availability = await TranslatorApi.availability(options);
      if (requestId !== translationRunRef.current) return;
      if (availability === "unavailable") {
        showTranslationUnsupported();
        return;
      }

      const translator = await TranslatorApi.create(options);
      if (requestId !== translationRunRef.current) {
        translator?.destroy?.();
        return;
      }

      translatorRef.current?.destroy?.();
      translatorRef.current = translator;
      translationEnabledRef.current = true;
      translatorStatusRef.current = "ready";
      setTranslationEnabled(true);
      setTranslatorStatus("ready");
      setTranslationNotice("");
      window.setTimeout(processVisibleTranslations, 0);
    } catch {
      if (requestId === translationRunRef.current) showTranslationUnsupported();
    }
  }, [processVisibleTranslations, showTranslationUnsupported]);

  const toggleTranslation = useCallback(() => {
    if (translationEnabledRef.current || translatorStatusRef.current === "checking") {
      stopTranslation();
      return;
    }
    enableBrowserTranslation();
  }, [enableBrowserTranslation, stopTranslation]);

  const handleVisibleSegmentsChange = useCallback((visibleSegments) => {
    visibleTranslationSegmentsRef.current = visibleSegments;
    processVisibleTranslations();
  }, [processVisibleTranslations]);

  useEffect(() => () => {
    translationRunRef.current += 1;
    translatorRef.current?.destroy?.();
    wordTranslationRunRef.current += 1;
    wordTranslatorRef.current?.destroy?.();
  }, []);

  useEffect(() => {
    translationCacheRef.current.clear();
    translationPendingSetRef.current.clear();
    visibleTranslationSegmentsRef.current = [];
    bumpTranslationVersion();
    processVisibleTranslations();
  }, [bumpTranslationVersion, processVisibleTranslations, transcript]);

  const fetchMutation = useMutation({
    mutationFn: () => api.mediaTranscript({ url, language }),
    onMutate: () => {
      setError("");
      const parsed = parseVideoId(url);
      if (parsed) setVideoId(parsed);
    },
    onSuccess: (data) => {
      writeTranscriptCache(data.video_id || parseVideoId(url), language, data);
      setTranscript(data);
      setVideoId(data.video_id || parseVideoId(url));
    },
    onError: (err) => {
      setTranscript(null);
      setError(friendlyErrorMessage(err, "자막을 가져오지 못했습니다."));
    },
  });

  const parseMutation = useMutation({
    mutationFn: () => api.mediaParseTranscript({ text: manualText, title: url }),
    onMutate: () => setError(""),
    onSuccess: (data) => {
      const parsed = parseVideoId(url);
      const nextData = { ...data, video_id: parsed };
      if (parsed) writeTranscriptCache(parsed, language, nextData);
      setTranscript(nextData);
      if (parsed) setVideoId(parsed);
      setPasteOpen(false);
    },
    onError: (err) => setError(friendlyErrorMessage(err, "스크립트를 읽지 못했습니다.")),
  });

  const saveMutation = useMutation({
    mutationFn: () => api.saveWord(draft),
    onSuccess: (data) => {
      setSaveMessage(data?.message || "저장했습니다.");
      queryClient.invalidateQueries({ queryKey: queryKeys.words("") });
      queryClient.invalidateQueries({ queryKey: queryKeys.labels });
    },
    onError: () => setSaveMessage("저장하지 못했습니다. 로그인 상태와 입력값을 확인해주세요."),
  });

  useEffect(() => {
    if (!player?.getCurrentTime) return undefined;
    const timer = window.setInterval(() => {
      try {
        setCurrentTime(player.getCurrentTime() || 0);
      } catch {
        // The iframe can be temporarily unavailable while it reloads.
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [player]);

  const segments = transcript?.segments || [];
  const activeIndex = useMemo(() => {
    if (!segments.length) return -1;
    const index = segments.findIndex((segment) => currentTime >= segment.start && currentTime < segment.end);
    if (index >= 0) return index;
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      if (currentTime >= segments[i].start) return i;
    }
    return 0;
  }, [currentTime, segments]);

  const translateWordMeaning = useCallback(async (word) => {
    const normalized = cleanWord(word);
    if (!normalized) {
      setMeaningStatus("idle");
      return;
    }

    const cached = wordTranslationCacheRef.current.get(normalized);
    const requestId = wordTranslationRunRef.current + 1;
    wordTranslationRunRef.current = requestId;

    if (cached) {
      setDraft((prev) =>
        cleanWord(prev.word) === normalized && !prev.korean.trim()
          ? { ...prev, korean: cached }
          : prev
      );
      setMeaningStatus("ready");
      return;
    }

    setMeaningStatus("loading");
    if (!isSupportedChromeBrowser() || typeof globalThis === "undefined") {
      setMeaningStatus("unsupported");
      return;
    }

    const TranslatorApi = globalThis.Translator;
    if (!TranslatorApi?.availability || !TranslatorApi?.create) {
      setMeaningStatus("unsupported");
      return;
    }

    try {
      const options = {
        sourceLanguage: TRANSLATION_SOURCE_LANGUAGE,
        targetLanguage: TRANSLATION_TARGET_LANGUAGE,
      };
      const availability = await TranslatorApi.availability(options);
      if (requestId !== wordTranslationRunRef.current) return;
      if (availability === "unavailable") {
        setMeaningStatus("unsupported");
        return;
      }

      if (!wordTranslatorRef.current?.translate) {
        wordTranslatorRef.current = await TranslatorApi.create(options);
      }
      if (requestId !== wordTranslationRunRef.current) return;

      const translated = (await wordTranslatorRef.current.translate(normalized))?.trim() || "";
      if (translated) {
        wordTranslationCacheRef.current.set(normalized, translated);
      }
      if (requestId !== wordTranslationRunRef.current) return;

      setDraft((prev) =>
        cleanWord(prev.word) === normalized && !prev.korean.trim()
          ? { ...prev, korean: translated }
          : prev
      );
      setMeaningStatus(translated ? "ready" : "error");
    } catch {
      if (requestId === wordTranslationRunRef.current) setMeaningStatus("error");
    }
  }, []);

  const openSave = (word, segment) => {
    const normalized = cleanWord(word);
    setSaveMessage("");
    setMeaningStatus("idle");
    setDraft({
      word: normalized || word,
      korean: "",
      korean_detail: "",
      english_def: transcript?.title ? `From media: ${transcript.title}` : "From media transcript",
      example: segment?.text || "",
      tag: DEFAULT_TAG,
    });
    setSaveOpen(true);
    translateWordMeaning(normalized || word);
  };

  const handleSaveOpenChange = (open) => {
    setSaveOpen(open);
    if (!open) {
      wordTranslationRunRef.current += 1;
      setMeaningStatus("idle");
    }
  };

  const seekTo = (seconds) => {
    if (!player?.seekTo) return;
    player.seekTo(seconds, true);
    setCurrentTime(seconds);
  };

  const loadTranscript = (event) => {
    event.preventDefault();
    if (!url.trim() || fetchMutation.isPending) return;
    const parsed = parseVideoId(url);
    if (parsed) {
      setVideoId(parsed);
      const cached = readTranscriptCache(parsed, language);
      if (cached) {
        setError("");
        setTranscript(cached);
        return;
      }
    }
    fetchMutation.mutate();
  };

  const parseManual = () => {
    if (!manualText.trim() || parseMutation.isPending) return;
    parseMutation.mutate();
  };

  const labels = labelsQuery.data?.labels || [];
  const isTheaterMode = viewMode === VIEW_MODES.THEATER;
  const isScriptMode = viewMode === VIEW_MODES.SCRIPT;
  const isVideoMode = viewMode === VIEW_MODES.VIDEO;
  const playerPanel = (
    <PlayerPanel
      videoId={videoId}
      player={player}
      currentTime={currentTime}
      onPlayer={setPlayer}
    />
  );
  const scriptPanel = (
    <ScriptPanel
      transcript={transcript}
      pending={fetchMutation.isPending || parseMutation.isPending}
      error={error}
      translationNotice={translationNotice}
      translationEnabled={translationEnabled}
      translatorStatus={translatorStatus}
      translationCache={translationCacheRef.current}
      translationPendingKeys={translationPendingSetRef.current}
      segments={segments}
      activeIndex={activeIndex}
      autoFollow={autoFollow}
      layoutKey={viewMode}
      onSeek={seekTo}
      onWordClick={openSave}
      onToggleTranslation={toggleTranslation}
      onVisibleSegmentsChange={handleVisibleSegmentsChange}
      compact={isTheaterMode}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">
      <div className="sticky top-0 z-30 shrink-0 border-b border-slate-800/60 bg-[#10171b] px-3 py-2 text-white shadow-[0_10px_26px_rgba(15,23,42,0.18)] md:px-5">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <form onSubmit={loadTranscript} className="grid min-w-0 flex-1 gap-2 md:grid-cols-[minmax(16rem,1fr)_8rem_auto_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="미디어 링크 또는 영상 ID"
                className="h-9 border-white/10 bg-white/10 pl-9 text-sm font-semibold text-white placeholder:text-slate-400 focus-visible:ring-brand-400"
              />
            </div>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              className="h-9 rounded-md border border-white/10 bg-white/10 px-3 text-sm font-semibold text-white outline-none ring-offset-[#10171b] transition hover:bg-white/20 focus:ring-2 focus:ring-brand-400"
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} className="text-slate-900">
                  {option.label}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={!url.trim() || fetchMutation.isPending} size="sm" className="h-9 border border-brand-500 bg-brand-600 px-3 text-white hover:bg-brand-500">
              {fetchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Subtitles className="h-4 w-4" />}
              영상 가져오기
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setPasteOpen(true)} className="h-9 border-white/20 bg-white/10 px-3 text-white hover:bg-white/20 hover:text-white">
              <FileText className="h-4 w-4" />
              직접 자막 붙여넣기
            </Button>
          </form>
          <div className="flex shrink-0 overflow-x-auto rounded-md border border-white/10 bg-white/10 p-1">
            {[
              { value: VIEW_MODES.BALANCED, label: "기본 보기" },
              { value: VIEW_MODES.THEATER, label: "영상 크게" },
              { value: VIEW_MODES.VIDEO, label: "영상만" },
              { value: VIEW_MODES.SCRIPT, label: "스크립트만" },
            ].map((item) => (
              <Button
                key={item.value}
                type="button"
                variant={viewMode === item.value ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode(item.value)}
                className={cn(
                  "h-7 whitespace-nowrap px-3 text-xs font-bold text-white hover:bg-white/20 hover:text-white",
                  viewMode === item.value && "bg-white text-slate-950 hover:bg-white hover:text-slate-950"
                )}
              >
                {item.value === VIEW_MODES.THEATER && <GalleryHorizontalEnd className="h-4 w-4" />}
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div
        ref={contentScrollRef}
        className="mx-auto grid min-h-0 w-full max-w-[1500px] flex-1 gap-4 overflow-y-auto bg-slate-50 p-4 pb-24 md:p-6 xl:grid-cols-[minmax(420px,0.9fr)_minmax(520px,1.1fr)] xl:overflow-hidden xl:pb-6 2xl:grid-cols-[minmax(520px,0.92fr)_minmax(640px,1.08fr)]"
      >
        <div
          className={cn(
            "contents xl:hidden",
            isScriptMode && "[&_[data-media-player-panel]]:sr-only [&_[data-media-player-panel]]:pointer-events-none",
            (isTheaterMode || isVideoMode) && "[&_[data-media-script-panel]]:hidden"
          )}
        >
          <div data-media-player-panel>{playerPanel}</div>
          <div data-media-script-panel>{scriptPanel}</div>
        </div>

        <div className="hidden min-h-0 xl:col-span-2 xl:block xl:h-full">
          {isVideoMode ? (
            <div className="mx-auto h-full w-full max-w-5xl">{playerPanel}</div>
          ) : isTheaterMode ? (
            <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(720px,1.4fr)_minmax(360px,0.6fr)]">
              {playerPanel}
              {scriptPanel}
            </div>
          ) : isScriptMode ? (
            <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden">
              <div className="pointer-events-none sr-only">{playerPanel}</div>
              <div className="mx-auto h-full min-h-0 w-full max-w-4xl overflow-hidden">{scriptPanel}</div>
            </div>
          ) : (
            <ResizablePanelGroup direction="horizontal" className="min-h-0 gap-0">
              <ResizablePanel defaultSize="46%" minSize="34%" maxSize="64%">
                <div className="h-full pr-3">{playerPanel}</div>
              </ResizablePanel>
              <ResizableHandle withHandle className="mx-1 bg-transparent after:bg-slate-200" />
              <ResizablePanel defaultSize="54%" minSize="36%">
                <div className="h-full pl-3">{scriptPanel}</div>
              </ResizablePanel>
            </ResizablePanelGroup>
          )}
        </div>
      </div>

      <PasteTranscriptDialog
        open={pasteOpen}
        onOpenChange={setPasteOpen}
        value={manualText}
        onChange={setManualText}
        onApply={parseManual}
        pending={parseMutation.isPending}
      />

      <WordSaveDialog
        open={saveOpen}
        onOpenChange={handleSaveOpenChange}
        draft={draft}
        setDraft={setDraft}
        labels={labels}
        user={user}
        onRequireLogin={onRequireLogin}
        onSave={() => saveMutation.mutate()}
        pending={saveMutation.isPending}
        message={saveMessage}
        meaningStatus={meaningStatus}
      />
    </div>
  );
}
