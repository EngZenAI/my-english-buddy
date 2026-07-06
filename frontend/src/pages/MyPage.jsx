import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  LockKeyhole,
  Mail,
  UserMinus,
} from "lucide-react";
import { api, GOOGLE_LOGIN_URL } from "../api";
import { queryKeys } from "../queryClient";
import { EmptyState, SkeletonBlock } from "../components/AsyncState";
import MemberNotice from "../components/MemberNotice";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  { id: "account", label: "계정 관리" },
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

function StatCard({ label, value, helper }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
        {helper && <p className="mt-1 text-xs text-muted-foreground">{helper}</p>}
      </CardContent>
    </Card>
  );
}

function GoogleMark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-lg font-bold shadow-sm ring-1 ring-slate-200">
      <span className="text-[#4285f4]">G</span>
    </span>
  );
}

function RowIcon({ children, tone = "default" }) {
  const toneClass =
    tone === "danger"
      ? "bg-rose-50 text-rose-600 ring-rose-100"
      : tone === "muted"
        ? "bg-slate-50 text-slate-500 ring-slate-200"
        : "bg-emerald-50 text-emerald-700 ring-emerald-100";

  return (
    <span className={`flex h-9 w-9 items-center justify-center rounded-full ring-1 ${toneClass}`}>
      {children}
    </span>
  );
}

function StatusText({ children, tone = "default" }) {
  const toneClass =
    tone === "success"
      ? "text-emerald-700"
      : tone === "warning"
        ? "text-amber-700"
        : "text-slate-500";

  return (
    <span className={`whitespace-nowrap text-xs font-medium ${toneClass}`}>
      {children}
    </span>
  );
}

function AccountRow({
  icon,
  title,
  description,
  meta,
  metaTone = "muted",
  action,
  onClick,
  expanded = false,
  disabled = false,
  danger = false,
}) {
  const clickable = Boolean(onClick) && !disabled;
  const Comp = clickable ? "button" : "div";

  return (
    <Comp
      type={clickable ? "button" : undefined}
      onClick={clickable ? onClick : undefined}
      className={`flex w-full items-center gap-3 px-5 py-4 text-left transition-colors ${
        clickable ? "hover:bg-slate-50" : ""
      } ${disabled ? "opacity-70" : ""}`}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-semibold ${danger ? "text-rose-700" : "text-slate-900"}`}>
          {title}
        </span>
        {description && (
          <span className="mt-0.5 block truncate text-xs text-slate-500">
            {description}
          </span>
        )}
      </span>
      {meta && <StatusText tone={metaTone}>{meta}</StatusText>}
      {action || (
        clickable ? (
          expanded ? (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400" />
          )
        ) : null
      )}
    </Comp>
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
  const [passwordOpen, setPasswordOpen] = useState(false);
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
  const googleAccount = (account.oauth_accounts || []).find(
    (item) => item.provider === "google"
  );
  const accountEmail = account.email || user.email;

  const resetPasswordFields = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const closePasswordPanel = () => {
    resetPasswordFields();
    setPasswordOpen(false);
  };

  const passwordMutation = useMutation({
    mutationFn: () =>
      api.updateAccountPassword(hasPassword ? currentPassword : "", newPassword),
    onSuccess: async () => {
      resetPasswordFields();
      setStatus(hasPassword ? "비밀번호가 변경되었습니다." : "비밀번호가 설정되었습니다.");
      setPasswordOpen(false);
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
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-100/60">
        <div className="border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">계정 관리</h2>
            <p className="mt-1 text-sm text-slate-500">
              로그인 방식과 보안 설정을 관리합니다.
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          <AccountRow
            icon={<GoogleMark />}
            title="Google 로그인"
            description={
              googleConnected
                ? googleAccount?.email || "Google 계정이 연결되어 있습니다."
                : "Google 계정으로 로그인할 수 있게 연결합니다."
            }
            meta={googleConnected ? "연결됨" : "미연결"}
            metaTone={googleConnected ? "success" : "muted"}
            action={
              googleConnected ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={!canDisconnectGoogle || disconnectMutation.isPending}
                  className="text-slate-600 hover:text-slate-900"
                >
                  {disconnectMutation.isPending ? "해제 중" : "해제"}
                </Button>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <a href={GOOGLE_LOGIN_URL} onClick={onOAuthStart}>
                    연결
                  </a>
                </Button>
              )
            }
          />
          {googleConnected && !canDisconnectGoogle && (
            <div className="bg-slate-50 px-5 py-2 text-xs text-slate-500">
              Google 연결을 해제하려면 먼저 비밀번호를 설정해야 합니다.
            </div>
          )}

          <AccountRow
            icon={
              <RowIcon>
                <Mail className="h-4 w-4" />
              </RowIcon>
            }
            title="이메일"
            description={accountEmail}
            meta="로그인 ID"
          />

          <AccountRow
            icon={
              <RowIcon>
                <LockKeyhole className="h-4 w-4" />
              </RowIcon>
            }
            title={hasPassword ? "비밀번호 변경" : "비밀번호 설정"}
            description={
              hasPassword
                ? "현재 비밀번호 확인 후 새 비밀번호로 변경합니다."
                : "이메일 로그인용 비밀번호를 추가합니다."
            }
            meta={hasPassword ? "설정됨" : "필요"}
            metaTone={hasPassword ? "success" : "warning"}
            onClick={() => {
              setPasswordOpen((open) => {
                if (open) resetPasswordFields();
                return !open;
              });
            }}
            expanded={passwordOpen}
          />

          {passwordOpen && (
            <div className="bg-slate-50 px-5 py-4">
              <form onSubmit={submitPassword} className="grid gap-3 md:max-w-md">
                {hasPassword && (
                  <div className="space-y-1.5">
                    <Label htmlFor="current-password">현재 비밀번호</Label>
                    <Input
                      id="current-password"
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                      disabled={passwordMutation.isPending}
                      autoComplete="current-password"
                    />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">새 비밀번호</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    disabled={passwordMutation.isPending}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">새 비밀번호 확인</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    disabled={passwordMutation.isPending}
                    autoComplete="new-password"
                  />
                </div>
                <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                  <Button type="submit" disabled={passwordMutation.isPending}>
                    {passwordMutation.isPending
                      ? "저장 중"
                      : hasPassword
                        ? "비밀번호 변경"
                        : "비밀번호 설정"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={closePasswordPanel}
                    disabled={passwordMutation.isPending}
                  >
                    취소
                  </Button>
                </div>
              </form>
            </div>
          )}

          <AccountRow
            icon={
              <RowIcon tone="muted">
                <Bell className="h-4 w-4" />
              </RowIcon>
            }
            title="알림 설정"
            description="복습 알림과 서비스 안내 수신 설정"
            meta="준비 중"
            disabled
          />

          <AccountRow
            icon={
              <RowIcon tone="danger">
                <UserMinus className="h-4 w-4" />
              </RowIcon>
            }
            title="회원 탈퇴"
            description="계정과 학습 데이터를 삭제하는 기능"
            meta="준비 중"
            disabled
            danger
          />
        </div>
      </section>

      {status && (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm shadow-slate-100/60">
          {status}
        </p>
      )}
    </div>
  );
}

export default function MyPage({ user, onRequireLogin, onOAuthStart }) {
  const [activeTab, setActiveTab] = useState("account");
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

  if (!user) {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold">마이페이지</h1>
        <MemberNotice
          message="로그인하면 마이페이지를 사용할 수 있어요."
          onRequireLogin={onRequireLogin}
        />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-bold">마이페이지</h1>
        <p className="mt-1 text-sm text-slate-500">{user.email}</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-4">
        <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-lg bg-muted p-1">
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {activeTab === "learning" && <LearningPanel query={learningQuery} />}
      {activeTab === "activity" && <ActivityPanel query={activityQuery} />}
      {activeTab === "account" && (
        <AccountPanel user={user} onOAuthStart={onOAuthStart} />
      )}
    </div>
  );
}
