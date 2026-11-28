import type { TJsonObject } from './outcome-coding-protocol.js';

/**
 * The single-agent baseline's run settings, carried over unchanged: the same tool tier, turn and
 * output limits, sampling and reasoning effort. The model and the endpoint are never here; they
 * arrive as runtime flags. Provider routing options, which name a vendor, arrive the same way.
 */
export const BASELINE_SETTINGS = Object.freeze({
  maxTurns: 8,
  maxTokens: 8192,
  temperature: 0.2,
  reasoningEffort: 'high',
  allowedTools: Object.freeze(['Read', 'Write', 'Edit', 'Glob', 'Grep']),
  deniedTools: Object.freeze([
    'Bash',
    'Shell',
    'WebFetch',
    'WebSearch',
    'BackgroundProcess',
    'Task',
    'Agent',
    'AgentJob',
    'AskUserQuestion',
  ]),
  /** The agent stops itself after this long. */
  abortAfterMs: 360_000,
});

/** The baseline's system prompt, with the directory the agent works in. */
export function codingSystemPrompt(projectDir: string): string {
  return (
    `You are a coding agent working in ${projectDir}. Use only Read, Write, Edit, Glob and Grep on this project. ` +
    'Inspect relevant files, complete the requested change, and briefly state what changed. ' +
    'Do not edit tests or unrelated files. Do not run shell commands or access network services. ' +
    'Test execution is performed independently after your answer.'
  );
}

/**
 * Request fields the relay forces onto every forwarded request, and refuses a request that
 * carries a different value for. Route options are merged in from the runtime flags.
 */
export function forcedRequestFields(routeOptions: TJsonObject = {}): TJsonObject {
  return {
    max_tokens: BASELINE_SETTINGS.maxTokens,
    temperature: BASELINE_SETTINGS.temperature,
    stream: false,
    reasoning: { effort: BASELINE_SETTINGS.reasoningEffort },
    ...routeOptions,
  };
}
