import type { IToolResult } from '../interfaces/tool.js';

export const DEFAULT_TOOL_RESULT_WARNING_CHARS = 10_000;
export const DEFAULT_TOOL_RESULT_HARD_CHARS = 25_000;
export const MAX_TOOL_RESULT_CHARS = 500_000;
const OPAQUE_REFERENCE = /^tool-result:[A-Za-z0-9_-]{22,64}$/u;
const ADMITTED_RESULT = Symbol.for('@robota-sdk/tool-result-admitted');

export type TToolResultAdmissionErrorCode =
  | 'invalid-policy'
  | 'invalid-override'
  | 'spill-unavailable'
  | 'spill-write-failed'
  | 'invalid-reference';

export class ToolResultAdmissionError extends Error {
  constructor(readonly code: TToolResultAdmissionErrorCode) {
    super(`Tool result admission failed (${code})`);
    this.name = 'ToolResultAdmissionError';
  }
}

/** The host owns secure persistence; core only admits its opaque reference. */
export interface IToolResultSpillStore {
  write(content: string): Promise<{ readonly reference: string }>;
}

export interface IToolResultAdmissionOptions {
  readonly warningChars?: number;
  readonly hardChars?: number;
  readonly repositoryMaxChars?: number;
  readonly spillStore?: IToolResultSpillStore;
  readonly onWarning?: (event: {
    readonly toolName: string;
    readonly resultChars: number;
    readonly warningChars: number;
  }) => void;
}

/** True only for an envelope the generic admission owner returned in this process. */
export function wasToolResultAdmitted(result: IToolResult): boolean {
  return Object.getOwnPropertyDescriptor(result, ADMITTED_RESULT)?.value === true;
}

function markAdmitted(result: IToolResult): IToolResult {
  return Object.defineProperty({ ...result }, ADMITTED_RESULT, { value: true });
}

function modelFacingText(result: IToolResult): string {
  if (result.success) {
    if (typeof result.data === 'string') return result.data;
    return JSON.stringify(result.data) ?? '';
  }
  const data =
    result.data === undefined
      ? ''
      : typeof result.data === 'string'
        ? result.data
        : (JSON.stringify(result.data) ?? '');
  return `${result.error ?? ''}${data}`;
}

function positiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function resolveLimits(
  options: IToolResultAdmissionOptions,
  requestedMaxChars?: number,
): {
  warningChars: number;
  hardChars: number;
} {
  const warningChars = options.warningChars ?? DEFAULT_TOOL_RESULT_WARNING_CHARS;
  const hardChars = options.hardChars ?? DEFAULT_TOOL_RESULT_HARD_CHARS;
  const repositoryMaxChars = options.repositoryMaxChars ?? MAX_TOOL_RESULT_CHARS;
  if (
    !positiveSafeInteger(warningChars) ||
    !positiveSafeInteger(hardChars) ||
    !positiveSafeInteger(repositoryMaxChars) ||
    warningChars >= hardChars ||
    hardChars > repositoryMaxChars ||
    repositoryMaxChars > MAX_TOOL_RESULT_CHARS
  ) {
    throw new ToolResultAdmissionError('invalid-policy');
  }
  if (requestedMaxChars === undefined) return { warningChars, hardChars };
  if (!positiveSafeInteger(requestedMaxChars)) {
    throw new ToolResultAdmissionError('invalid-override');
  }
  return {
    warningChars,
    hardChars: Math.max(hardChars, Math.min(requestedMaxChars, repositoryMaxChars)),
  };
}

/** Core's one admission step for a tool envelope before any observer sees its body. */
export async function admitToolResult(
  toolName: string,
  result: IToolResult,
  options: IToolResultAdmissionOptions = {},
  requestedMaxChars?: number,
): Promise<IToolResult> {
  const { warningChars, hardChars } = resolveLimits(options, requestedMaxChars);
  const content = modelFacingText(result);
  const resultChars = content.length;
  if (resultChars > warningChars) {
    options.onWarning?.({ toolName, resultChars, warningChars });
  }
  if (resultChars > hardChars) {
    if (!options.spillStore) throw new ToolResultAdmissionError('spill-unavailable');
    let reference: string;
    try {
      reference = (await options.spillStore.write(content)).reference;
    } catch {
      throw new ToolResultAdmissionError('spill-write-failed');
    }
    if (!OPAQUE_REFERENCE.test(reference) || reference.length > hardChars) {
      throw new ToolResultAdmissionError('invalid-reference');
    }
    return markAdmitted(
      result.success
        ? { success: true, data: reference }
        : { success: false, error: `Tool failure details: ${reference}` },
    );
  }
  return markAdmitted(result);
}
