import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { queryKeys } from "./queryClient";
import SearchTab from "./tabs/SearchTab";
import WordbookTab from "./tabs/WordbookTab";
import QuizTab from "./tabs/QuizTab";
import RoleplayTab from "./tabs/RoleplayTab";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import FindIdPage from "./pages/FindIdPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import MyPage from "./pages/MyPage";
import AppShell from "@/components/layout/AppShell";
import HomeTabs from "@/components/layout/HomeTabs";
import LoadingPanel from "@/components/layout/LoadingPanel";
import MainNav from "@/components/layout/MainNav";
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
  { id: "quiz", label: "퀴즈", Comp: QuizTab },
  { id: "roleplay", label: "롤플레잉", Comp: RoleplayTab },
];

const AUTH_RETURN_KEY = "englishBuddy.authReturn";

function todayMinus(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function createInitialQuizState() {
  return {
    goal: {
      mode: "random",
      tag: "",
      saved_from: todayMinus(30),
      saved_to: new Date().toISOString().slice(0, 10),
      instruction: "",
      question_count: 10,
    },
    questions: [],
    answerToken: "",
    answers: {},
    gradeResult: null,
    message: "",
    savedSuggestions: {},
    reviewInterval: "1d",
  };
}

function getInitialView() {
  if (window.location.pathname === "/auth/complete") return "auth-complete";
  return "home";
}

function replaceUrl(path = "/") {
  if (window.location.pathname !== path || window.location.search) {
    window.history.replaceState(null, "", path);
  }
}

function saveReturnTarget(target) {
  sessionStorage.setItem(AUTH_RETURN_KEY, JSON.stringify(target));
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

export default function App() {
  const queryClient = useQueryClient();
  const [view, setView] = useState(getInitialView);
  const [tab, setTab] = useState("search");
  const [authCompleteFailed, setAuthCompleteFailed] = useState(false);
  const [authCompleteChecked, setAuthCompleteChecked] = useState(false);
  const [quizState, setQuizState] = useState(createInitialQuizState);
  const [roleplayInstanceKey, setRoleplayInstanceKey] = useState(0);

  const { data: meData, isPending: authLoading } = useQuery({
    queryKey: queryKeys.me,
    queryFn: api.me,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  const user = meData?.user || null;

  const goToView = (nextView) => {
    setView(nextView);
    replaceUrl("/");
  };

  const goToReturnTarget = () => {
    const target = popReturnTarget() || { view: "home", tab: "search" };
    if (target.tab) setTab(target.tab);
    setView(target.view || "home");
    replaceUrl("/");
  };

  const startLogin = (target = { view: "home", tab }) => {
    saveReturnTarget(target);
    goToView("login");
  };

  const startOAuth = () => {
    saveReturnTarget({ view: "home", tab });
  };

  const goToHomeTab = (nextTab) => {
    setTab(nextTab);
    goToView("home");
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
    setQuizState(createInitialQuizState());
    setRoleplayInstanceKey((key) => key + 1);
    goToView("home");
  };

  useEffect(() => {
    if (getInitialView() !== "auth-complete" || authCompleteChecked) return undefined;

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
  }, [authCompleteChecked, queryClient]);

  const ActiveTab = TABS.find((t) => t.id === tab)?.Comp || SearchTab;

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
      }
    }),
    [queryClient, user]
  );

  const prefetchTab = (tabId) => tabQueryPrefetch[tabId]?.();

  const changeTab = (nextTab) => {
    tabQueryPrefetch[nextTab]?.();
    setTab(nextTab);
  };

  return (
    <AppShell>
      <MainNav
        user={user}
        onHome={() => goToView("home")}
        onMyPage={() => goToView("mypage")}
        onLogin={() => startLogin({ view: "home", tab })}
        onSignup={() => goToView("signup")}
        onLogout={logout}
      />

      {authLoading && (
        <LoadingPanel message="인증 상태를 확인하고 있습니다." />
      )}

      {!authLoading && view === "auth-complete" && (
        authCompleteFailed ? (
          <div className="py-10">
            <Card className="mx-auto max-w-md">
              <CardHeader>
                <CardTitle>로그인 확인 실패</CardTitle>
                <CardDescription>
                  Google 로그인 완료 상태를 확인하지 못했습니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => startLogin({ view: "home", tab })}
                >
                  다시 로그인
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <LoadingPanel message="로그인 완료 후 이동하고 있습니다." />
        )
      )}

      {view === "login" && (
        <LoginPage
          onNavigate={goToView}
          onAuthenticated={completeLogin}
          onOAuthStart={startOAuth}
        />
      )}
      {view === "signup" && (
        <SignupPage onNavigate={goToView} onOAuthStart={startOAuth} />
      )}
      {view === "find-id" && <FindIdPage onNavigate={goToView} />}
      {view === "forgot-password" && <ForgotPasswordPage onNavigate={goToView} />}

      {!authLoading && view === "mypage" && (
        <MyPage
          user={user}
          onRequireLogin={() => startLogin({ view: "mypage" })}
          onOAuthStart={() => saveReturnTarget({ view: "mypage" })}
          onOpenTab={goToHomeTab}
        />
      )}

      {!authLoading && view === "home" && (
        <>
          <h1 className="mb-4 text-2xl font-bold">나만의 영어 학습 앱</h1>

          <HomeTabs
            tabs={TABS}
            value={tab}
            onChange={changeTab}
            onPrefetch={prefetchTab}
          />

          {tab !== "roleplay" && (
            <ActiveTab
              user={user}
              onRequireLogin={() => startLogin({ view: "home", tab })}
              quizState={quizState}
              setQuizState={setQuizState}
            />
          )}

          <div className={tab === "roleplay" ? "" : "hidden"}>
            <RoleplayTab
              key={roleplayInstanceKey}
              user={user}
              onRequireLogin={() => startLogin({ view: "home", tab: "roleplay" })}
            />
          </div>
        </>
      )}
    </AppShell>
  );
}
