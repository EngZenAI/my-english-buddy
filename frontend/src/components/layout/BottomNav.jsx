import { Search, BookOpen, PenLine, MessageCircle } from "lucide-react";

export default function BottomNav({ tabs, value, onChange }) {
  const icons = {
    search: Search,
    wordbook: BookOpen,
    quiz: PenLine,
    roleplay: MessageCircle,
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 h-16 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 flex items-center justify-around z-50 shadow-[0_-2px_10px_rgba(0,0,0,0.03)]">
      {tabs.map((tab) => {
        const Icon = icons[tab.id] || Search;
        const isActive = value === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`flex items-center gap-2 py-2 px-4 rounded-full transition-all duration-300 ${
              isActive
                ? "bg-brand-100 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300 font-medium scale-105"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Icon className={`h-5 w-5 ${isActive ? "stroke-[2.5]" : "stroke-[1.8]"}`} />
            {isActive && <span className="text-xs font-semibold">{tab.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
