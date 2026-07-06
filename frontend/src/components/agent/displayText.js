const INTERNAL_ID_PATTERN = /\s*\(?\bID\s*#?\s*:?\s*\d+\s*\)?/gi;

export function cleanAgentDisplayText(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(INTERNAL_ID_PATTERN, "")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
