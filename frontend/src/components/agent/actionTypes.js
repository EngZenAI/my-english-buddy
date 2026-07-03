export const OPEN_TAB = "open_tab";
export const START_QUIZ_WITH_GOAL = "start_quiz_with_goal";
export const START_ROLEPLAY_WITH_SITUATION = "start_roleplay_with_situation";

export const ADD_LABEL = "add_label";
export const SAVE_WORDS = "save_words";
export const SAVE_AGENT_MEMORY = "save_agent_memory";
export const PROPOSE_BULK_WORD_UPDATE = "propose_bulk_word_update";
export const PROPOSE_DELETE_WORDS = "propose_delete_words";
export const PROPOSE_RENAME_LABEL = "propose_rename_label";
export const START_AGENT_JOB = "start_agent_job";

export const AGENT_CLIENT_ACTIONS = new Set([
  OPEN_TAB,
  START_QUIZ_WITH_GOAL,
  START_ROLEPLAY_WITH_SITUATION,
]);

export const SERVER_AGENT_TOOLS = new Set([
  ADD_LABEL,
  SAVE_WORDS,
  SAVE_AGENT_MEMORY,
  PROPOSE_BULK_WORD_UPDATE,
  PROPOSE_DELETE_WORDS,
  PROPOSE_RENAME_LABEL,
  START_AGENT_JOB,
]);

export function isServerAgentTool(action) {
  return SERVER_AGENT_TOOLS.has(action?.type);
}

export function isClientAgentAction(action) {
  return AGENT_CLIENT_ACTIONS.has(action?.type);
}
