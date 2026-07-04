export const AGENT_QUICK_PROMPTS = [
  "오늘 뭐 공부할까?",
  "내 약점 분석해줘",
  "단어장 점검해줘",
  "롤플레잉 상황 추천해줘",
];

export function isAgentJobActive(job) {
  return job?.status === "queued" || job?.status === "running";
}

export function agentJobProgressPercent(job) {
  const total = Number(job?.progress_total || 0);
  if (!total) return 0;
  return Math.min(100, Math.round((Number(job?.progress_current || 0) / total) * 100));
}

