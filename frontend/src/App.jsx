import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "./api";
import { queryKeys } from "./queryClient";
import SearchTab from "./tabs/SearchTab";
import WordbookTab from "./tabs/WordbookTab";
import QuizTab from "./tabs/QuizTab";
import RoleplayTab from "./tabs/RoleplayTab";
import ArticleLearningTab from "./tabs/ArticleLearningTab";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import MyPage from "./pages/MyPage";
import AdminPage from "./pages/AdminPage";
import AgentPanel from "@/components/agent/AgentPanel";
import {
  OPEN_TAB,
  START_QUIZ_WITH_GOAL,
  START_ROLEPLAY_WITH_SITUATION,
} from "@/components/agent/actionTypes";
import AppShell from "@/components/layout/AppShell";
import ResponsiveNav from "@/components/layout/ResponsiveNav";
import LoadingPanel from "@/components/layout/LoadingPanel";
import { createInitialQuizState } from "@/components/quiz/quizState";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const TABS = [
  { id: "search", label: "단어 검색", Comp: SearchTab },
  { id: "wordbook", label: "단어장", Comp: WordbookTab },
  { id: "articles", label: "뉴스 리딩", Comp: ArticleLearningTab },
  { id: "quiz", label: "퀴즈", Comp: QuizTab },
  { id: "roleplay", label: "롤플레잉", Comp: RoleplayTab },
];

const AUTH_RETURN_KEY = "englishBuddy.authReturn";
const VIEW_PATHS = {
  home: "/",
  login: "/login",
  signup: "/signup",
  "forgot-password": "/forgot-password",
  mypage: "/mypage",
  "auth-complete": "/auth/complete",
  admin: "/admin/learners",
};

function viewFromPath(pathname) {
  if (pathname === "/") return "home";
  if (pathname === "/login") return "login";
  if (pathname === "/signup") return "signup";
  if (pathname === "/forgot-password") return "forgot-password";
  if (pathname === "/mypage") return "mypage";
  if (pathname === "/auth/complete") return "auth-complete";
  if (pathname.startsWith("/admin")) return "admin";
  return "home";
}

function saveReturnTarget(target) {
  sessionStorage.setItem(AUTH_RETURN_KEY, JSON.stringify(target));
}

function hasReturnTarget() {
  return Boolean(sessionStorage.getItem(AUTH_RETURN_KEY));
}

function popReturnTarget() {
  const raw = sessionStorage.getItem(AUTH_RETURN_KEY);
  sessionStorage.removeItem(AUTH_RETURN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pathForTarget(target) {
  if (target?.path) return target.path;
  if (target?.view === "admin") return VIEW_PATHS.admin;
  return VIEW_PATHS[target?.view] || VIEW_PATHS.home;
}

export default function App() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState("search");
  const [authCompleteFailed, setAuthCompleteFailed] = useState(false);
  const [authCompleteChecked, setAuthCompleteChecked] = useState(false);
  const [quizState, setQuizState] = useState(createInitialQuizState);
  const [roleplayInstanceKey, setRoleplayInstanceKey] = useState(0);
  const [roleplayLaunch, setRoleplayLaunch] = useState(null);

  const view = viewFromPath(location.pathname);
  const isAdminRoute = view === "admin";
  const isAuthCompleteRoute = view === "auth-complete";
  const isAuthRoute = ["login", "signup", "forgot-password", "auth-complete"].includes(view);
  const showMainNav = !isAdminRoute && !isAuthRoute;

  const { data: meData, isPending: authLoading } = useQuery({
    queryKey: queryKeys.me,
    queryFn: api.me,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  const user = meData?.user || null;

  const tabQueryPrefetch = useMemo(
    () => ({
      wordbook: () => {
        if (!user) return;
        queryClient.prefetchQuery({
          queryKey: queryKeys.labels,
          queryFn: api.listLabels,
          staleTime: 5 * 60_000,
        });
        queryClient.prefetchQuery({
          queryKey: queryKeys.words(""),
          queryFn: () => api.listWords(""),
          staleTime: 30_000,
        });
      },
    }),
    [queryClient, user]
  );

  const currentReturnTarget = () => {
    if (view === "home") return { path: VIEW_PATHS.home, tab };
    if (view === "admin") return { path: location.pathname };
    if (view === "mypage") return { path: VIEW_PATHS.mypage };
    return { path: VIEW_PATHS.home, tab: "search" };
  };

  const goToView = (nextView) => {
    navigate(VIEW_PATHS[nextView] || VIEW_PATHS.home);
  };

  const goToReturnTarget = () => {
    const target = popReturnTarget() || { path: VIEW_PATHS.home, tab: "search" };
    if (target.tab) setTab(target.tab);
    navigate(pathForTarget(target), { replace: true });
  };

  const startLogin = (target = currentReturnTarget()) => {
    saveReturnTarget(target);
    navigate(VIEW_PATHS.login);
  };

  const startOAuth = () => {
    if (!hasReturnTarget()) saveReturnTarget(currentReturnTarget());
  };

  const goToHomeTab = (nextTab) => {
    setTab(nextTab);
    navigate(VIEW_PATHS.home);
  };

  const completeLogin = async () => {
    try {
      const { user: nextUser } = await queryClient.fetchQuery({
        queryKey: queryKeys.me,
        queryFn: api.me,
        staleTime: 0,
      });
      if (!nextUser) {
        return {
          ok: false,
          message: "로그인은 완료됐지만 사용자 정보를 확인하지 못했습니다. 다시 시도해주세요.",
        };
      }
      goToReturnTarget();
      return { ok: true };
    } catch {
      queryClient.setQueryData(queryKeys.me, { user: null });
      return {
        ok: false,
        message: "로그인 상태 확인에 실패했습니다. 잠시 후 다시 시도해주세요.",
      };
    }
  };

  const logout = async () => {
    await api.logout();
    sessionStorage.removeItem(AUTH_RETURN_KEY);
    queryClient.setQueryData(queryKeys.me, { user: null });
    queryClient.removeQueries({ queryKey: queryKeys.labels });
    queryClient.removeQueries({ queryKey: ["mypage"] });
    queryClient.removeQueries({ queryKey: ["account"] });
    queryClient.removeQueries({ queryKey: ["words"] });
    queryClient.removeQueries({ queryKey: ["word-saved"] });
    queryClient.removeQueries({ queryKey: ["label-word-count"] });
    queryClient.removeQueries({ queryKey: ["articles"] });
    queryClient.removeQueries({ queryKey: ["admin"] });
    setQuizState(createInitialQuizState());
    setRoleplayInstanceKey((key) => key + 1);
    navigate(VIEW_PATHS.home);
  };

  useEffect(() => {
    if (isAuthCompleteRoute) return;
    setAuthCompleteChecked(false);
    setAuthCompleteFailed(false);
  }, [isAuthCompleteRoute]);

  useEffect(() => {
    if (!isAuthCompleteRoute || authCompleteChecked) return undefined;

    let cancelled = false;
    const verifyOAuthLogin = async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await queryClient.fetchQuery({
            queryKey: queryKeys.me,
            queryFn: api.me,
            staleTime: 0,
          });
          if (cancelled) return;
          if (result?.user) {
            goToReturnTarget();
            return;
          }
        } catch {
          // Retry below. The failure state is shown only after all attempts fail.
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      if (!cancelled) {
        setAuthCompleteChecked(true);
        setAuthCompleteFailed(true);
      }
    };

    verifyOAuthLogin();

    return () => {
      cancelled = true;
    };
  }, [authCompleteChecked, isAuthCompleteRoute, queryClient]);

  const ActiveTab = TABS.find((t) => t.id === tab)?.Comp || SearchTab;

  const changeTab = (nextTab) => {
    tabQueryPrefetch[nextTab]?.();
    setTab(nextTab);
    if (location.pathname !== VIEW_PATHS.home) navigate(VIEW_PATHS.home);
  };

  const handleAgentAction = (action) => {
    const payload = action?.payload || {};
    if (action?.type === OPEN_TAB) {
      changeTab(payload.tab || "search");
      return;
    }
    if (action?.type === START_QUIZ_WITH_GOAL) {
      const initial = createInitialQuizState();
      const goalPatch = { ...payload };
      if (goalPatch.scope_due || goalPatch.tag || goalPatch.scope_tags?.length) {
        goalPatch.scope_all = false;
      }
      setQuizState({
        ...initial,
        goal: {
          ...initial.goal,
          ...goalPatch,
          question_type_counts: {
            ...initial.goal.question_type_counts,
            ...(goalPatch.question_type_counts || {}),
          },
        },
      });
      changeTab("quiz");
      return;
    }
    if (action?.type === START_ROLEPLAY_WITH_SITUATION) {
      setRoleplayLaunch({
        id: Date.now(),
        level: payload.level || "intermediate",
        scenario: payload.scenario || "general",
        tag: payload.tag || null,
        situation: payload.situation || "",
        title: payload.title || payload.tag || payload.situation || "Buddy 추천",
      });
      changeTab("roleplay");
    }
  };

  const homeElement = authLoading ? (
    <LoadingPanel message="인증 상태를 확인하고 있습니다." />
  ) : (
    <div className="h-full">
      {tab !== "roleplay" && (
        <ActiveTab
          user={user}
          onRequireLogin={() => startLogin({ path: VIEW_PATHS.home, tab })}
          quizState={quizState}
          setQuizState={setQuizState}
        />
      )}

      <div className={tab === "roleplay" ? "h-full" : "hidden"}>
        <RoleplayTab
          key={roleplayInstanceKey}
          user={user}
          onRequireLogin={() => startLogin({ path: VIEW_PATHS.home, tab: "roleplay" })}
          agentLaunch={roleplayLaunch}
        />
      </div>
    </div>
  );

  const authCompleteElement = authLoading ? (
    <LoadingPanel message="로그인 완료 후 이동하고 있습니다." />
  ) : authCompleteFailed ? (
    <div className="py-10">
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>로그인 확인 실패</CardTitle>
          <CardDescription>
            Google 로그인 완료 상태를 확인하지 못했습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2">
            <Button
              type="button"
              className="w-full"
              onClick={() => startLogin({ path: VIEW_PATHS.home, tab })}
            >
              다시 로그인
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  ) : (
    <LoadingPanel message="로그인 완료 후 이동하고 있습니다." />
  );
  return (
    <AppShell>
      {showMainNav && (
        <ResponsiveNav
          tabs={TABS}
          value={tab}
          onChange={changeTab}
          user={user}
          view={view}
          setView={goToView}
          onLogin={() => startLogin({ path: VIEW_PATHS.home, tab })}
          onLogout={logout}
        />
      )}

      <main
        className={
          isAdminRoute
            ? "min-h-0 min-w-0 flex-1 overflow-hidden"
            : isAuthRoute
              ? "min-h-0 min-w-0 flex-1 overflow-y-auto"
              : tab === "roleplay"
                ? "min-h-0 min-w-0 flex-1 overflow-hidden"
                : "min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-6 pb-24 md:px-8 md:pb-6"
        }
      >
        <Routes>
          <Route path="/" element={homeElement} />
          <Route
            path="/login"
            element={
              <LoginPage
                onNavigate={goToView}
                onAuthenticated={completeLogin}
                onOAuthStart={startOAuth}
                onHome={() => goToView("home")}
              />
            }
          />
          <Route
            path="/signup"
            element={
              <SignupPage
                onNavigate={goToView}
                onOAuthStart={startOAuth}
                onHome={() => goToView("home")}
              />
            }
          />
          <Route path="/find-id" element={<Navigate to="/login" replace />} />
          <Route
            path="/forgot-password"
            element={<ForgotPasswordPage onNavigate={goToView} onHome={() => goToView("home")} />}
          />
          <Route path="/auth/complete" element={authCompleteElement} />
          <Route
            path="/mypage"
            element={
              authLoading ? (
                <LoadingPanel message="인증 상태를 확인하고 있습니다." />
              ) : (
                <MyPage
                  user={user}
                  onRequireLogin={() => startLogin({ path: VIEW_PATHS.mypage })}
                  onOAuthStart={() => saveReturnTarget({ path: VIEW_PATHS.mypage })}
                  onOpenTab={goToHomeTab}
                />
              )
            }
          />
          <Route
            path="/admin/*"
            element={
              authLoading ? (
                <LoadingPanel message="인증 상태를 확인하고 있습니다." />
              ) : (
                <AdminPage
                  user={user}
                  onRequireLogin={() => startLogin({ path: location.pathname })}
                  onExit={() => goToView("home")}
                />
              )
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <AgentPanel
        user={user}
        currentTab={tab}
        hidden={!showMainNav || authLoading}
        onRequireLogin={() => startLogin({ path: VIEW_PATHS.home, tab })}
        onAction={handleAgentAction}
      />
    </AppShell>
  );
}
