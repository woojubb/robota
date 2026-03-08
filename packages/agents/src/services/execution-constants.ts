/**
 * ExecutionService owned events.
 * Local event names only (no dots). Full names are composed at emit time.
 */
export const EXECUTION_EVENTS = {
    START: 'start',
    COMPLETE: 'complete',
    ERROR: 'error',
    ASSISTANT_MESSAGE_START: 'assistant_message_start',
    ASSISTANT_MESSAGE_COMPLETE: 'assistant_message_complete',
    USER_MESSAGE: 'user_message',
    TOOL_RESULTS_TO_LLM: 'tool_results_to_llm',
    TOOL_RESULTS_READY: 'tool_results_ready'
} as const;

export const EXECUTION_EVENT_PREFIX = 'execution' as const;
