import type { ILivePromptContentPolicy } from '@robota-sdk/agent-interface-analytics';

export const LOG_USER_PROMPTS_SETTING = 'ROBOTA_TELEMETRY_LOG_USER_PROMPTS';
export const LOG_ASSISTANT_RESPONSES_SETTING = 'ROBOTA_TELEMETRY_LOG_ASSISTANT_RESPONSES';
export const LOG_TOOL_ARGUMENTS_SETTING = 'ROBOTA_TELEMETRY_LOG_TOOL_ARGUMENTS';
export const LOG_TOOL_OUTPUT_SETTING = 'ROBOTA_TELEMETRY_LOG_TOOL_OUTPUT';
export const LOG_CONTENT_MAX_BYTES_SETTING = 'ROBOTA_TELEMETRY_LOG_CONTENT_MAX_BYTES';
export const LIVE_CONTENT_SETTINGS = [
  LOG_USER_PROMPTS_SETTING, LOG_ASSISTANT_RESPONSES_SETTING, LOG_TOOL_ARGUMENTS_SETTING,
  LOG_TOOL_OUTPUT_SETTING, LOG_CONTENT_MAX_BYTES_SETTING,
] as const;

const DEFAULT_MAX_BYTES = 2048;
const MIN_MAX_BYTES = 256;
const MAX_MAX_BYTES = 16384;

function gate(env: Readonly<Record<string, string | undefined>>, name: string): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '0') return false;
  if (raw === '1') return true;
  throw new Error(`${name} must be exactly 0 or 1.`);
}

/**
 * Content capture is opt-in per kind and only ever travels as OTLP log records: console output
 * never carries content, so a gate that would need it is refused rather than silently unused.
 * Errors name the setting, never its value.
 */
export function resolveLiveContentPolicy(
  env: Readonly<Record<string, string | undefined>>,
): ILivePromptContentPolicy | undefined {
  if (env['ROBOTA_TELEMETRY_ENABLED'] !== '1') return undefined;
  const userPrompts = gate(env, LOG_USER_PROMPTS_SETTING);
  const assistantResponses = gate(env, LOG_ASSISTANT_RESPONSES_SETTING);
  const toolArguments = gate(env, LOG_TOOL_ARGUMENTS_SETTING);
  const toolOutput = gate(env, LOG_TOOL_OUTPUT_SETTING);
  const rawMax = env[LOG_CONTENT_MAX_BYTES_SETTING];
  if (!userPrompts && !assistantResponses && !toolArguments && !toolOutput) {
    if (rawMax !== undefined) {
      throw new Error(`${LOG_CONTENT_MAX_BYTES_SETTING} is set but no content capture setting is 1.`);
    }
    return undefined;
  }
  const logs = env['ROBOTA_TELEMETRY_LOGS'];
  if (logs === 'console') {
    throw new Error('Robota telemetry content capture cannot use console logs; console output never carries content.');
  }
  if (logs !== 'otlp') throw new Error('Robota telemetry content capture requires ROBOTA_TELEMETRY_LOGS=otlp.');
  let maxBytes = DEFAULT_MAX_BYTES;
  if (rawMax !== undefined) {
    maxBytes = /^[0-9]{1,6}$/u.test(rawMax) ? Number(rawMax) : Number.NaN;
    if (!Number.isSafeInteger(maxBytes) || maxBytes < MIN_MAX_BYTES || maxBytes > MAX_MAX_BYTES) {
      throw new Error(`${LOG_CONTENT_MAX_BYTES_SETTING} must be an integer from ${MIN_MAX_BYTES} to ${MAX_MAX_BYTES}.`);
    }
  }
  return Object.freeze({ userPrompts, assistantResponses, toolArguments, toolOutput, maxBytes });
}
