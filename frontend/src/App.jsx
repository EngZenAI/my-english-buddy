import { useEffect, useState } from "react";
import { api, LOGOUT_URL } from "./api";
import SearchTab from "./tabs/SearchTab";
import WordbookTab from "./tabs/WordbookTab";
import QuizTab from "./tabs/QuizTab";
import RoleplayTab from "./tabs/RoleplayTab";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";

const TABS = [
  { id: "search", label: "🔍 단어 검색", Comp: SearchTab },
  { id: "wordbook", label: "📖 단어장", Comp: WordbookTab },
  { id: "quiz", label: "✏️ 퀴즈", Comp: QuizTab },
  { id: "roleplay", label: "💬 롤플레잉", Comp: RoleplayTab },
];

export default function App() {
  const [view, setView] = useState("home"); // home | login | signup
  const [tab, setTab] = useState("search");
  const [user, setUser] = useState(null);

  const refreshUser = async () => {
    try {
      const { user } = await api.me();
      setUser(user);
    } catch {
      setUser(null);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const ActiveTab = TABS.find((t) => t.id === tab)?.Comp || SearchTab;

  return (
    <div className="max-w-3xl mx-auto px-4 py-5">
      {/* Navbar */}
      <div className="flex items-center justify-end gap-2 pb-3 flex-wrap">
        <button
          onClick={() => setView("home")}
          className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                     text-sm font-semibold"
        >
          홈
        </button>
        {user ? (
          <>
            <span className="text-sm text-slate-500 max-w-[240px] truncate">
              로그인됨: {user.email}
            </span>
            <a
              href={LOGOUT_URL}
              className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                         text-sm font-semibold inline-flex items-center no-underline text-slate-900"
            >
              로그아웃
            </a>
          </>
        ) : (
          <>
            <button
              onClick={() => setView("login")}
              className="h-9 px-3 rounded-lg border border-slate-300 bg-white hover:bg-slate-50
                         text-sm font-semibold"
            >
              로그인
            </button>
            <button
              onClick={() => setView("signup")}
              className="h-9 px-3 rounded-lg bg-brand-600 text-white hover:bg-brand-700
                         text-sm font-semibold"
            >
              회원가입
            </button>
          </>
        )}
      </div>

      {view === "login" && (
        <LoginPage onNavigate={setView} onLoggedIn={refreshUser} />
      )}
      {view === "signup" && <SignupPage onNavigate={setView} />}

      {view === "home" && (
        <>
          <h1 className="text-2xl font-bold mb-4">📚 나만의 영어 학습 앱</h1>

          {/* 탭 헤더 */}
          <div className="flex gap-1 border-b border-slate-200 mb-4">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors
                  ${tab === t.id
                    ? "border-brand-600 text-brand-600"
                    : "border-transparent text-slate-500 hover:text-slate-700"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <ActiveTab />
        </>
      )}
    </div>
  );
}
