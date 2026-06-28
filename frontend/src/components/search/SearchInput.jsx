import { Search } from "lucide-react";
import AudioButton from "@/components/AudioButton";
import { LoadingSpinner } from "@/components/AsyncState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SearchInput({
  eng,
  setEng,
  kor,
  setKor,
  onSearchEng,
  onSearchKor,
  phonetic,
  searchQuery,
  slangVisible,
  slangPending,
  onSlang,
  sourceRef,
}) {
  return (
    <Card className="shadow-[0_4px_20px_rgba(0,0,0,0.04)] border-slate-100 rounded-2xl overflow-hidden">
      <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-3.5">
        <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
          <Search className="h-4.5 w-4.5 text-brand-500" />
          단어 검색
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 space-y-4">
        {/* 영어 입력 섹션 */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-xs font-bold text-slate-500 flex items-center gap-1">
              <span className="text-base">🇺🇸</span> 영어 단어
            </label>
          </div>
          <div className="flex gap-2">
            <Input
              value={eng}
              onChange={(e) => {
                sourceRef.current = "en";
                setEng(e.target.value);
              }}
              onKeyDown={(e) => e.key === "Enter" && onSearchEng(eng)}
              placeholder="cardiovascular, dynamic 등..."
              className="rounded-xl border-slate-200 focus-visible:ring-brand-500 h-10.5 text-sm"
            />
            <Button
              onClick={() => onSearchEng(eng)}
              className="bg-brand-600 hover:bg-brand-700 text-white rounded-xl h-10.5 px-4"
            >
              검색
            </Button>
          </div>
          <div className="h-7 flex items-center pl-1">
            <AudioButton word={eng} lang="en" phonetic={phonetic} />
          </div>
        </div>

        {/* 구분선 */}
        <div className="relative py-2">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-slate-100" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-slate-300 font-bold">또는</span>
          </div>
        </div>

        {/* 한국어 입력 섹션 */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-xs font-bold text-slate-500 flex items-center gap-1">
              <span className="text-base">🇰🇷</span> 한국어 뜻
            </label>
          </div>
          <div className="flex gap-2">
            <Input
              value={kor}
              onChange={(e) => {
                sourceRef.current = "ko";
                setKor(e.target.value);
              }}
              onKeyDown={(e) => e.key === "Enter" && onSearchKor(kor)}
              placeholder="심혈관, 역동적인 등..."
              className="rounded-xl border-slate-200 focus-visible:ring-brand-500 h-10.5 text-sm"
            />
            <Button
              onClick={() => onSearchKor(kor)}
              className="bg-brand-600 hover:bg-brand-700 text-white rounded-xl h-10.5 px-4"
            >
              검색
            </Button>
          </div>
          <div className="h-7 flex items-center pl-1">
            {searchQuery.isFetching ? (
              <LoadingSpinner label="검색 결과를 가져오는 중" />
            ) : searchQuery.isError ? (
              <span className="text-xs text-rose-500">검색 결과를 불러오지 못했습니다.</span>
            ) : (
              <AudioButton word={kor} lang="ko" />
            )}
          </div>
        </div>

        {/* AI 설명 피드백 유도 */}
        {slangVisible && (
          <div className="pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={slangPending}
              onClick={onSlang}
              className="w-full rounded-xl text-xs text-slate-600 border-slate-200 hover:bg-slate-50 gap-1.5 py-1.5 h-9"
            >
              {slangPending
                ? "AI가 원어민 뉘앙스 분석 중..."
                : "💡 원어민들은 실제로 어떻게 쓰나요? (AI 질문)"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
