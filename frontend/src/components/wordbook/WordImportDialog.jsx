import { X, AlertCircle, Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

export default function WordImportDialog({
  guideOpen,
  onCloseGuide,
  onImportClick,
  importing,
  previewOpen,
  onClosePreview,
  previewRows,
  dupCount,
  newCount,
  overwriteDup,
  setOverwriteDup,
  onSetPreviewField,
  onRemovePreviewRow,
  onApplyAllTag,
  onRemoveDupRows,
  onCommitPreview,
  committing,
  labels,
}) {
  if (!guideOpen && !previewOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      {/* 1. 가져오기 안내 모달 */}
      {guideOpen && (
        <Card className="w-full max-w-md shadow-2xl border-none rounded-2xl overflow-hidden animate-fadeIn">
          <CardHeader className="bg-slate-50 dark:bg-slate-900 border-b pb-4">
            <div className="flex justify-between items-center">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                <Info className="h-4.5 w-4.5 text-brand-600" />
                단어 일괄 가져오기 안내
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={onCloseGuide}
                className="h-8 w-8 rounded-full"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <CardDescription className="text-xs pt-1.5">
              CSV 또는 Excel(.xlsx) 파일을 사용하여 단어들을 대량으로 등록할 수 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="text-xs text-slate-500 space-y-2 leading-relaxed">
              <p className="font-semibold text-slate-800">📌 필수 포맷 열 (첫 행 기준 헤더):</p>
              <ul className="list-disc pl-4.5 space-y-1">
                <li><code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700 font-bold">word</code>: 영단어 (필수)</li>
                <li><code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700 font-bold">korean</code>: 뜻/해석 (필수)</li>
                <li><code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700 font-bold">tag</code>: 태그 (선택)</li>
                <li><code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700 font-bold">example</code>: 예문 (선택)</li>
              </ul>
              <p className="text-[11px] text-brand-600 bg-brand-50/50 p-2.5 rounded-lg border border-brand-100/50">
                💡 엑셀로 작성 시 첫 행에 위 항목명을 적어주시면 됩니다. 콤마(,) 구분의 CSV 역시 동일하게 지원합니다.
              </p>
            </div>
            
            <div className="flex gap-2 pt-2">
              <Button
                onClick={onImportClick}
                disabled={importing}
                className="flex-1 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs py-2.5 h-10 font-bold"
              >
                {importing ? "준비 중..." : "📁 파일 선택 및 가져오기"}
              </Button>
              <Button
                variant="outline"
                onClick={onCloseGuide}
                className="border-slate-200 text-slate-600 rounded-xl text-xs py-2.5 h-10 px-4"
              >
                닫기
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 2. 가져오기 미리보기 모달 */}
      {previewOpen && (
        <Card className="w-full max-w-4xl max-h-[85vh] shadow-2xl border-none rounded-2xl overflow-hidden flex flex-col animate-fadeIn">
          <CardHeader className="bg-slate-50 dark:bg-slate-900 border-b py-4.5 px-6">
            <div className="flex justify-between items-center">
              <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                📁 가져올 단어 미리보기
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClosePreview}
                className="h-8 w-8 rounded-full"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-slate-500 pt-2 items-center">
              <span>신규 등록 대상: <b className="text-brand-600">{newCount}개</b></span>
              <span>중복 단어: <b className="text-amber-600">{dupCount}개</b></span>
              
              <div className="flex items-center gap-1.5 ml-auto border-l pl-4 border-slate-200">
                <input
                  type="checkbox"
                  id="overwriteDup"
                  checked={overwriteDup}
                  onChange={(e) => setOverwriteDup(e.target.checked)}
                  className="rounded border-slate-300 text-brand-600 h-3.5 w-3.5"
                />
                <label htmlFor="overwriteDup" className="cursor-pointer text-[11px] font-medium text-slate-600">
                  중복 단어 기존 정보 덮어쓰기
                </label>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0 flex-1 overflow-hidden flex flex-col">
            {/* 상단 일괄 수정 도구바 */}
            <div className="bg-slate-50/50 border-b p-3 flex flex-wrap gap-2 items-center text-xs">
              <span className="font-bold text-slate-500">일괄 제어:</span>
              <select
                onChange={(e) => onApplyAllTag(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 outline-none text-xs h-7.5"
              >
                <option value="">🏷️ 전체 태그 일괄 변경</option>
                {labels.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>

              {dupCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onRemoveDupRows}
                  className="h-7.5 text-xs border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 hover:text-amber-800 rounded-lg px-3"
                >
                  ⚠️ 중복 단어 모두 제외
                </Button>
              )}
            </div>

            {/* 단어 테이블 영역 */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b text-slate-400 font-semibold">
                    <th className="pb-2 w-28">영어 단어</th>
                    <th className="pb-2 w-32">한국어 기본</th>
                    <th className="pb-2 w-36">한국어 상세</th>
                    <th className="pb-2">예문</th>
                    <th className="pb-2 w-24">태그</th>
                    <th className="pb-2 w-10 text-center">제외</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {previewRows.map((r) => (
                    <tr key={r.key} className={`group ${r.dup ? "bg-amber-50/20" : ""}`}>
                      <td className="py-2.5 pr-2">
                        <Input
                          value={r.word}
                          onChange={(e) => onSetPreviewField(r.key, "word", e.target.value)}
                          className={`h-8 text-xs px-2 ${r.dup ? "border-amber-300 bg-amber-50/30" : ""}`}
                        />
                        {r.dup && (
                          <span className="text-[10px] text-amber-600 block mt-0.5 pl-1 font-medium">
                            ⚠️ 중복 단어
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-2">
                        <Input
                          value={r.korean}
                          onChange={(e) => onSetPreviewField(r.key, "korean", e.target.value)}
                          className="h-8 text-xs px-2"
                        />
                      </td>
                      <td className="py-2.5 pr-2">
                        <Input
                          value={r.korean_detail}
                          onChange={(e) => onSetPreviewField(r.key, "korean_detail", e.target.value)}
                          className="h-8 text-xs px-2"
                        />
                      </td>
                      <td className="py-2.5 pr-2">
                        <Input
                          value={r.example}
                          onChange={(e) => onSetPreviewField(r.key, "example", e.target.value)}
                          className="h-8 text-xs px-2"
                        />
                      </td>
                      <td className="py-2.5 pr-2">
                        <select
                          value={r.tag}
                          onChange={(e) => onSetPreviewField(r.key, "tag", e.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-background px-2 py-1.5 text-xs outline-none h-8"
                        >
                          {labels.map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 text-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => onRemovePreviewRow(r.key)}
                          className="h-7 w-7 text-slate-400 hover:text-rose-600 rounded-full"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 하단 확인 버튼 영역 */}
            <div className="bg-slate-50 dark:bg-slate-900 border-t p-4 flex justify-end gap-2">
              <Button
                onClick={onCommitPreview}
                disabled={committing}
                className="bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs py-2.5 h-10 font-bold px-6"
              >
                {committing ? "가져오기 적용 중..." : "🚀 가져오기 적용"}
              </Button>
              <Button
                variant="outline"
                onClick={onClosePreview}
                className="border-slate-200 text-slate-600 rounded-xl text-xs py-2.5 h-10 px-5"
              >
                취소
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
