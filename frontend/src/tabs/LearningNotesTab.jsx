import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { queryKeys } from "../queryClient";
import { EmptyState, LoadingSpinner, SkeletonBlock } from "../components/AsyncState";

// 롤플레잉 결과 모음. 대화 종료(정리) 시 백엔드가 저장한 세션을 최신순으로 보여준다.
const LEVEL_LABELS = { beginner: "입문", intermediate: "중급", advanced: "고급" };
const MODE_LABELS = { opic: "OPIc", tag: "단어장 태그", general: "자유 주제" };

function formatDate(s) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s).slice(0, 16).replace("T", " ");
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

export default function LearningNotesTab({ user }) {
  const queryClient = useQueryClient();

  const sessionsQuery = useQuery({
    queryKey: queryKeys.roleplaySessions,
    queryFn: api.roleplaySessions,
    enabled: !!user,
  });
  const sessions = sessionsQuery.data?.sessions || [];

  const deleteMutation = useMutation({
    mutationFn: (id) => api.roleplayDeleteSession(id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.roleplaySessions }),
  });
  const deletingId = deleteMutation.isPending ? deleteMutation.variables : null;

  return (
    <div>
      <p className="text-sm text-slate-500 mb-3">
        롤플레잉을 마무리하면 대화 요약과 유용한 표현·어휘가 여기에 쌓여요.
      </p>

      {!user && (
        <div className="mt-10">
          <EmptyState
            title="로그인이 필요합니다"
            description="로그인하면 롤플레잉 학습노트를 확인할 수 있어요."
          />
        </div>
      )}

      {user && sessionsQuery.isLoading && (
        <div className="space-y-3">
          <SkeletonBlock className="h-28 w-full rounded-lg" />
          <SkeletonBlock className="h-28 w-full rounded-lg" />
        </div>
      )}

      {user && !sessionsQuery.isLoading && sessions.length === 0 && (
        <div className="mt-10">
          <EmptyState
            title="아직 저장된 학습노트가 없어요"
            description="롤플레잉 탭에서 대화를 나눈 뒤 '대화 마무리 & 정리'를 누르면 결과가 저장됩니다."
          />
        </div>
      )}

      <div className="space-y-4">
        {sessions.map((s) => {
          const isDeleting = deletingId === s.id;
          return (
          <div
            key={s.id}
            className={`rounded-lg border border-slate-200 bg-white p-4 transition ${
              isDeleting ? "pointer-events-none opacity-60" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                  {LEVEL_LABELS[s.level] || s.level}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                  {MODE_LABELS[s.scenario] || s.scenario}
                </span>
                {s.title && (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700 max-w-[200px] truncate">
                    {s.title}
                  </span>
                )}
                <span className="text-slate-400">
                  · {s.turns}턴 · {formatDate(s.created_at)}
                </span>
              </div>
              <button
                onClick={() => deleteMutation.mutate(s.id)}
                disabled={deleteMutation.isPending}
                className="min-w-16 text-right text-xs text-slate-400 hover:text-rose-500 disabled:opacity-80"
              >
                {isDeleting ? (
                  <LoadingSpinner
                    label="삭제 중"
                    className="justify-end text-xs text-rose-500"
                    spinnerClassName="h-3 w-3 border-rose-200 border-t-rose-500"
                  />
                ) : (
                  "삭제"
                )}
              </button>
            </div>

            {s.summary && (
              <p className="text-sm text-slate-700 whitespace-pre-wrap mb-3">
                {s.summary}
              </p>
            )}

            {Array.isArray(s.expressions) && s.expressions.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-semibold text-slate-500 mb-1">💬 유용한 표현</p>
                <ul className="space-y-1">
                  {s.expressions.map((e, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium text-slate-800">{e.en}</span>
                      {e.ko && <span className="text-slate-500"> — {e.ko}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {Array.isArray(s.vocab) && s.vocab.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-1">📒 유용한 어휘</p>
                <ul className="flex flex-wrap gap-1.5">
                  {s.vocab.map((v, i) => (
                    <li
                      key={i}
                      title={v.example || ""}
                      className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                    >
                      {v.word}
                      {v.korean && <span className="text-slate-400"> {v.korean}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
        })}
      </div>
    </div>
  );
}
