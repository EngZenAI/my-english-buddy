from __future__ import annotations

OPEN_TAB = "open_tab"
START_QUIZ_WITH_GOAL = "start_quiz_with_goal"
START_ROLEPLAY_WITH_SITUATION = "start_roleplay_with_situation"

ADD_LABEL = "add_label"
SAVE_WORDS = "save_words"
SAVE_AGENT_MEMORY = "save_agent_memory"
PROPOSE_BULK_WORD_UPDATE = "propose_bulk_word_update"
PROPOSE_DELETE_WORDS = "propose_delete_words"
PROPOSE_RENAME_LABEL = "propose_rename_label"
START_AGENT_JOB = "start_agent_job"

CLIENT_ACTION_TYPES = {
    OPEN_TAB,
    START_QUIZ_WITH_GOAL,
    START_ROLEPLAY_WITH_SITUATION,
}

SERVER_TOOL_TYPES = {
    ADD_LABEL,
    SAVE_WORDS,
    SAVE_AGENT_MEMORY,
    PROPOSE_BULK_WORD_UPDATE,
    PROPOSE_DELETE_WORDS,
    PROPOSE_RENAME_LABEL,
    START_AGENT_JOB,
}

AUTO_SAFE_TOOL_TYPES = {
    ADD_LABEL,
    SAVE_WORDS,
    SAVE_AGENT_MEMORY,
}

DESTRUCTIVE_TOOL_TYPES = {
    PROPOSE_DELETE_WORDS,
}

ALL_AGENT_ACTION_TYPES = CLIENT_ACTION_TYPES | SERVER_TOOL_TYPES

ALLOWED_ACTION_PROMPT_LINES = "\n".join([
    f'- {OPEN_TAB} payload: {{"tab": "search|wordbook|articles"}}',
    f"- {START_QUIZ_WITH_GOAL} payload: quiz goal fields such as scope_due, tag, scope_tags, question_count, instruction",
    f'- {START_ROLEPLAY_WITH_SITUATION} payload: {{"level": "...", "scenario": "general|opic|tag", "tag": null|string, "situation": "..."}}',
    f'- {ADD_LABEL} payload: {{"name": "..."}}',
    f'- {SAVE_WORDS} payload: {{"items": [{{"word": "...", "korean": "...", "english_def": "...", "example": "...", "tag": "..."}}]}}',
    f'- {SAVE_AGENT_MEMORY} payload: {{"key": "...", "value": object}}',
    f'- {PROPOSE_BULK_WORD_UPDATE} payload: {{"items": [{{"id": 1, "word": "...", "korean": "...", "english_def": "...", "example": "...", "tag": "..."}}]}}',
    f'- {PROPOSE_DELETE_WORDS} payload: {{"ids": [1, 2]}}',
    f'- {PROPOSE_RENAME_LABEL} payload: {{"old_name": "...", "new_name": "..."}}',
    f'- {START_AGENT_JOB} payload: {{"job_type": "wordbook_audit"}}',
])
