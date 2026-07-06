import { BookOpen, MessageCircle, MessageCircleQuestionMark, Newspaper, Search } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ICONS = {
  search: Search,
  wordbook: BookOpen,
  articles: Newspaper,
  quiz: MessageCircleQuestionMark,
  roleplay: MessageCircle,
};

export default function HomeTabs({ tabs, value, onChange, onPrefetch }) {
  return (
    <Tabs value={value} onValueChange={onChange} className="mb-4">
      <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-lg bg-muted p-1">
        {tabs.map((tab) => {
          const Icon = ICONS[tab.id] || Search;
          return (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              onMouseEnter={() => onPrefetch?.(tab.id)}
              onFocus={() => onPrefetch?.(tab.id)}
              className="gap-2 px-3"
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
