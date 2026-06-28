import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, GOOGLE_LOGIN_URL } from "../api";
import { queryKeys } from "../queryClient";
import { EmptyState, LoadingSpinner, SkeletonBlock } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";

const TABS = [
  { id: "account", label: "계정 관리" },
  { id: "overview", label: "개요" },
  { id: "learning", label: "학습 현황" },
  { id: "activity", label: "이용 기록" },
];
const LEVEL_LABELS = { beginner: "입문", intermediate: "중급", advanced: "고급" };
const MODE_LABELS = { opic: "OPIc", tag: "단어장 태그", general: "자유 주제" };

function compactNumber(value) {
  return Number(value || 0).toLocaleString("ko-KR");
}

function percent(value) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return date.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getErrorDetail(error, fallback) {
  const message = String(error?.message || "");
  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const data = JSON.parse(message.slice(jsonStart));
      if (data.detail) return data.detail;
    } catch {
      // fall through
    }
  }
  return fallback;
}

function MethodChip({ children }) {
  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
      {children}
    </span>
  );
}

function StatCard({ label, value, helper }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100/60">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {helper && <p className="mt-1 text-xs text-slate-400">{helper}</p>}
    </div>
  );
}

function QuickAction({ label, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-slate-200 bg-white p-4 text-left shadow-sm shadow-slate-100/60
                 transition hover:border-brand-200 hover:bg-brand-50/50"
    >
      <span className="text-sm font-semibold text-slate-900">{label}</span>
      <span className="mt-1 block text-xs text-slate-500">{description}</span>
    </button>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-3">
      <SkeletonBlock className="h-24 w-full rounded-lg" />
      <SkeletonBlock className="h-36 w-full rounded-lg" />
    </div>
  );
}

function OverviewPanel({ data, loading, onOpenTab }) {
  if (loading) return <PanelSkeleton />;

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="복습 예정"
          value={`${compactNumber(data.due_review_count)}개`}
          helper="오늘까지 복습할 단어"
        />
        <StatCard
          label="저장 단어"
          value={`${compactNumber(data.word_count)}개`}
          helper="내 단어장"
        />
        <StatCard
          label="이번 달 이용"
          value={`${compactNumber(data.month_activity_count)}회`}
          helper="AI·번역·발음 기능"
        />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100/60">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">바로 시작</h2>
            <p className="mt-1 text-sm text-slate-500">자주 쓰는 학습 기능으로 이동합니다.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <QuickAction
            label="단어장"
            description={`${compactNumber(data.word_count)}개 저장됨`}
            onClick={() => onOpenTab("wordbook")}
          />
          <QuickAction
            label="퀴즈"
            description="저장 단어로 연습"
            onClick={() => onOpenTab("quiz")}
          />
          <QuickAction
            label="롤플레잉"
            description={`${compactNumber(data.roleplay_session_count)}개 노트`}
            onClick={() => onOpenTab("roleplay")}
          />
        </div>
      </section>
    </div>
  );
}

function LearningPanel({ query }) {
  const data = query.data || {};
  const weakWords = data.weak_words || [];
  const notes = data.recent_roleplay_sessions || [];

  if (query.isPending) return <PanelSkeleton />;
  if (query.error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        학습 현황을 불러오지 못했습니다.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard label="저장 단어" value={`${compactNumber(data.word_count)}개`} helper={`태그 ${data.label_count || 0}개`} />
        <StatCard label="복습 예정" value={`${compactNumber(data.due_review_count)}개`} helper="오늘까지 복습할 단어" />
        <StatCard label="퀴즈 정답률" value={percent(data.quiz_accuracy)} helper={`${compactNumber(data.quiz_attempt_count)}회 풀이`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100/60">
          <h2 className="text-base font-semibold text-slate-900">취약 단어</h2>
          <div className="mt-3">
            {weakWords.length === 0 ? (
              <EmptyState title="아직 취약 단어가 없습니다" description="퀴즈를 채점하면 오답 단어가 여기에 표시됩니다." />
            ) : (
              <div className="divide-y divide-slate-100">
                {weakWords.map((item, index) => (
                  <div key={`${item.word_id || index}-${item.word}`} className="grid gap-3 py-3 sm:grid-cols-[1fr_6rem]">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{item.word || "-"}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {compactNumber(item.attempt_count)}회 풀이 · 오답 {compactNumber(item.incorrect_count)}회
                      </p>
                    </div>
                    <div className="sm:text-right">
                      <p className="text-sm font-semibold text-rose-600">{percent(item.incorrect_rate)}</p>
                      <p className="text-xs text-slate-400">오답률</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100/60">
          <h2 className="text-base font-semibold text-slate-900">롤플레잉 노트</h2>
          <p className="mt-1 text-sm text-slate-500">총 {compactNumber(data.roleplay_session_count)}개 저장됨</p>
          <div className="mt-3">
            {notes.length === 0 ? (
              <EmptyState title="아직 저장된 노트가 없습니다" description="롤플레잉을 마무리하면 요약이 여기에 표시됩니다." />
            ) : (
              <div className="space-y-3">
                {notes.map((item) => (
                  <div key={item.id} className="border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                        {LEVEL_LABELS[item.level] || item.level}
                      </span>
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">
                        {MODE_LABELS[item.scenario] || item.scenario}
                      </span>
                      <span className="text-slate-400">{formatDate(item.created_at)}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-slate-700">
                      {item.summary || item.title || "저장된 요약이 없습니다."}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function ActivityPanel({ query }) {
  const data = query.data || {};
  const summary = data.summary || {};
  const byFeature = data.by_feature || [];
  const recent = data.recent || [];

  if (query.isPending) return <PanelSkeleton />;
  if (query.error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        이용 기록을 불러오지 못했습니다.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-3">
        <StatCard label="오늘" value={`${compactNumber(summary.today_count)}회`} helper="오늘 사용한 학습 도구" />
        <StatCard label="최근 7일" value={`${compactNumber(summary.week_count)}회`} helper="이번 주 이용" />
        <StatCard label="최근 30일" value={`${compactNumber(summary.month_count)}회`} helper="이번 달 이용" />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100/60">
          <h2 className="text-base font-semibold text-slate-900">기능별 이용</h2>
          <div className="mt-3">
            {byFeature.length === 0 ? (
              <EmptyState title="아직 이용 기록이 없습니다" description="학습 도구를 사용하면 여기에 기록됩니다." />
            ) : (
              <div className="divide-y divide-slate-100">
                {byFeature.map((item) => (
                  <div key={item.feature} className="grid gap-3 py-3 sm:grid-cols-[1fr_7rem]">
                    <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                    <p className="text-sm font-semibold text-slate-900 sm:text-right">
                      {compactNumber(item.total_count)}회
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100/60">
          <h2 className="text-base font-semibold text-slate-900">최근 이용</h2>
          <div className="mt-3">
            {recent.length === 0 ? (
              <EmptyState title="최근 이용 기록이 없습니다" />
            ) : (
              <div className="divide-y divide-slate-100">
                {recent.map((item, index) => (
                  <div key={`${item.created_at}-${index}`} className="grid gap-3 py-3 sm:grid-cols-[1fr_5rem]">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{formatDate(item.created_at)}</p>
                    </div>
                    <p className="text-sm font-semibold text-slate-900 sm:text-right">
                      {compactNumber(item.count)}회
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function AccountPanel({ user, onOAuthStart }) {
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("");
  const accountQuery = useQuery({
    queryKey: queryKeys.accountStatus,
    queryFn: api.accountStatus,
    enabled: Boolean(user),
    staleTime: 30_000,
  });
  const account = accountQuery.data || {};
  const hasPassword = Boolean(account.has_password);
  const googleConnected = Boolean(account.google_connected);
  const canDisconnectGoogle = Boolean(account.can_disconnect_google);

  const passwordMutation = useMutation({
    mutationFn: () =>
      api.updateAccountPassword(hasPassword ? currentPassword : "", newPassword),
    onSuccess: async () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setStatus(hasPassword ? "비밀번호가 변경되었습니다." : "비밀번호가 설정되었습니다.");
      await queryClient.invalidateQueries({ queryKey: queryKeys.accountStatus });
    },
    onError: (error) => {
      setStatus(getErrorDetail(error, "비밀번호를 저장하지 못했습니다."));
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => api.disconnectOAuth("google"),
    onSuccess: async () => {
      setStatus("Google 연결을 해제했습니다.");
      await queryClient.invalidateQueries({ queryKey: queryKeys.accountStatus });
    },
    onError: (error) => {
      setStatus(getErrorDetail(error, "Google 연결을 해제하지 못했습니다."));
    },
  });

  const submitPassword = (event) => {
    event.preventDefault();
    setStatus("");
    if (hasPassword && !currentPassword.trim()) {
      setStatus("현재 비밀번호를 입력해주세요.");
      return;
    }
    if (newPassword.length < 8) {
      setStatus("새 비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    passwordMutation.mutate();
  };

  if (accountQuery.isPending) return <PanelSkeleton />;
  if (accountQuery.error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        계정 정보를 불러오지 못했습니다.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">계정 정보</h2>
            <p className="mt-1 text-sm text-slate-500">로그인에 사용하는 기본 정보를 관리합니다.</p>
          </div>
          <span className="w-fit rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            사용 중
          </span>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium text-slate-500">이메일</p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-900">
              {account.email || user.email}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500">로그인 방식</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {hasPassword && <MethodChip>이메일</MethodChip>}
              {googleConnected && <MethodChip>Google</MethodChip>}
              {!hasPassword && !googleConnected && <MethodChip>확인 필요</MethodChip>}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100/60">
        <h2 className="text-base font-semibold text-slate-900">
          {hasPassword ? "비밀번호 변경" : "비밀번호 설정"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {hasPassword
            ? "주기적으로 비밀번호를 바꾸면 계정을 더 안전하게 유지할 수 있습니다."
            : "비밀번호를 설정하면 Google 연결 없이도 이메일로 로그인할 수 있습니다."}
        </p>

        <form onSubmit={submitPassword} className="mt-4 grid gap-3 md:max-w-md">
          {hasPassword && (
            <div>
              <label className="mb-1 block text-sm text-slate-600">현재 비밀번호</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                disabled={passwordMutation.isPending}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm
                           focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm text-slate-600">새 비밀번호</label>
            <input
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              disabled={passwordMutation.isPending}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">새 비밀번호 확인</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={passwordMutation.isPending}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm
                         focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
          </div>
          <button
            type="submit"
            disabled={passwordMutation.isPending}
            className="mt-1 h-10 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white
                       hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {passwordMutation.isPending
              ? "저장 중"
              : hasPassword
                ? "비밀번호 변경"
                : "비밀번호 설정"}
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm shadow-slate-100/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Google 연결</h2>
            <p className="mt-1 text-sm text-slate-500">
              Google 계정으로 로그인할 수 있는 연결 상태입니다.
            </p>
          </div>
          {googleConnected ? (
            <button
              type="button"
              onClick={() => disconnectMutation.mutate()}
              disabled={!canDisconnectGoogle || disconnectMutation.isPending}
              className="h-10 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700
                         hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {disconnectMutation.isPending ? "해제 중" : "연결 해제"}
            </button>
          ) : (
            <a
              href={GOOGLE_LOGIN_URL}
              onClick={onOAuthStart}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 px-4
                         text-sm font-semibold text-slate-700 no-underline hover:bg-slate-50"
            >
              Google 연결
            </a>
          )}
        </div>
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {googleConnected
            ? canDisconnectGoogle
              ? "Google 계정이 연결되어 있습니다."
              : "비밀번호를 먼저 설정한 뒤 Google 연결을 해제할 수 있습니다."
            : "아직 Google 계정이 연결되어 있지 않습니다."}
        </div>
      </section>

      {status && (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          {status}
        </p>
      )}
    </div>
  );
}

export default function MyPage({ user, onRequireLogin, onOpenTab, onOAuthStart }) {
  const [activeTab, setActiveTab] = useState("account");
  const overviewQuery = useQuery({
    queryKey: queryKeys.myPageOverview,
    queryFn: api.myPageOverview,
    enabled: Boolean(user) && activeTab === "overview",
    staleTime: 30_000,
  });
  const learningQuery = useQuery({
    queryKey: queryKeys.myPageLearning,
    queryFn: api.myPageLearning,
    enabled: Boolean(user) && activeTab === "learning",
    staleTime: 30_000,
  });
  const activityQuery = useQuery({
    queryKey: queryKeys.myPageActivity,
    queryFn: api.myPageActivity,
    enabled: Boolean(user) && activeTab === "activity",
    staleTime: 30_000,
  });
  const overview = overviewQuery.data || {};

  if (!user) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold">마이페이지</h1>
        <MemberNotice feature="마이페이지" onRequireLogin={onRequireLogin} />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">마이페이지</h1>
        <p className="mt-1 text-sm text-slate-500">{user.email}</p>
      </div>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              activeTab === tab.id
                ? "border-brand-600 text-brand-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {overviewQuery.error && activeTab === "overview" && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          마이페이지 정보를 불러오지 못했습니다.
        </div>
      )}

      {activeTab === "overview" && (
        <OverviewPanel
          data={overview}
          loading={overviewQuery.isPending}
          onOpenTab={onOpenTab}
        />
      )}
      {activeTab === "learning" && <LearningPanel query={learningQuery} />}
      {activeTab === "activity" && <ActivityPanel query={activityQuery} />}
      {activeTab === "account" && (
        <AccountPanel user={user} onOAuthStart={onOAuthStart} />
      )}

      {overviewQuery.isFetching && !overviewQuery.isPending && activeTab === "overview" && (
        <div className="mt-3">
          <LoadingSpinner label="갱신 중" />
        </div>
      )}
    </div>
  );
}
