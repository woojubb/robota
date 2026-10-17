/**
 * The inbound adapter from an MCP server's form-mode elicitation to the host's ask port.
 *
 * Both protocol eras deliver an elicitation through the one SDK handler (`elicitation/create` as
 * a server→client request on the legacy era, as an embedded `input_required` request on
 * 2026-07-28), so the mapping lives once, here, and speaks only `IActionRequest`: there is no second
 * prompt type, registry or renderer. Every prompt is titled with the server's identity and carries
 * the server's own text as its description, never as the question; nothing is ever masked, because
 * a form-mode elicitation may not ask for a secret and a masked field would hide what is being sent.
 */
import { randomUUID } from 'node:crypto';

import { isCredentialShapedName } from '../definition/secrecy.js';

import type {
  ElicitRequestFormParams,
  ElicitRequestParams,
  ElicitResult,
  PrimitiveSchemaDefinition,
} from '@modelcontextprotocol/client';
import type {
  IActionOption,
  IActionRequest,
  IUserInteraction,
  TActionResponse,
} from '@robota-sdk/agent-core';

export type TMCPAskPort = IUserInteraction['ask'];

/** What the bridge knows about one tool call while it is in flight. */
export interface IMCPElicitationCall {
  readonly ask?: TMCPAskPort;
  readonly signal?: AbortSignal;
}

/**
 * The tool calls of one session that are in flight. Neither era tells the handler which call an
 * elicitation belongs to, and every in-flight call of a session speaks to the same server through
 * the same session-wide port, so the oldest call that can answer does; with none, the server is
 * told so at once rather than left waiting.
 */
export class MCPElicitationCalls {
  private readonly calls = new Set<IMCPElicitationCall>();

  /** Registers a call for as long as it runs; the returned function withdraws it. */
  enter(call: IMCPElicitationCall): () => void {
    const entry: IMCPElicitationCall = { ...call };
    this.calls.add(entry);
    return () => {
      this.calls.delete(entry);
    };
  }

  /** The oldest in-flight call that has an ask port, if any. */
  answerable(): IMCPElicitationCall | undefined {
    for (const call of this.calls) if (call.ask !== undefined) return call;
    return undefined;
  }
}

export type TMCPElicitationHandler = (
  params: ElicitRequestParams,
  signal: AbortSignal | undefined,
) => Promise<ElicitResult>;

/** The handler one client registers: routes a request to the in-flight call that can answer it. */
export function createElicitationHandler(input: {
  readonly serverName: () => string;
  readonly calls: MCPElicitationCalls;
}): TMCPElicitationHandler {
  return async (params, signal) => {
    // URL mode is never declared, so the SDK refuses it before this point; stated here regardless.
    if (params.mode === 'url') return { action: 'decline' };
    const call = input.calls.answerable();
    if (call?.ask === undefined) return { action: 'decline' };
    const signals = [signal, call.signal].filter(
      (candidate): candidate is AbortSignal => candidate !== undefined,
    );
    return bridgeElicitation({
      serverName: input.serverName(),
      params,
      ask: call.ask,
      ...(signals.length === 0
        ? {}
        : { signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) }),
    });
  };
}

export interface IBridgeElicitationInput {
  readonly serverName: string;
  readonly params: ElicitRequestFormParams;
  readonly ask: TMCPAskPort;
  readonly signal?: AbortSignal;
}

type TFieldValue = string | number | boolean | string[];
type TElicitationContent = Record<string, TFieldValue>;

type TParsedAnswer =
  | { readonly kind: 'value'; readonly value: TFieldValue }
  | { readonly kind: 'skip' }
  | { readonly kind: 'invalid'; readonly reason: string };

interface IFieldQuestion {
  readonly request: Omit<IActionRequest, 'id'>;
  readonly parse: (response: Extract<TActionResponse, { type: 'answer' }>) => TParsedAnswer;
}

const RESPOND = 'respond';
const DECLINE = 'decline';
const YES = 'yes';
const NO = 'no';
const CANCEL: ElicitResult = { action: 'cancel' };
const DECLINED: ElicitResult = { action: 'decline' };
const CREDENTIAL_WARNING =
  'Caution: this field is named like a credential; what you enter is shown as typed and sent to the server.';

/**
 * Puts one elicitation to a person as asks and returns the server's answer: `accept` with the typed
 * content, `decline` from the first question, or `cancel` from any dismissal, a second invalid
 * answer, or a failing port. A failing port cancels rather than throws so the server is answered.
 */
export async function bridgeElicitation(input: IBridgeElicitationInput): Promise<ElicitResult> {
  try {
    return await runBridge(input);
  } catch {
    return CANCEL;
  }
}

async function runBridge(input: IBridgeElicitationInput): Promise<ElicitResult> {
  const { serverName, params, ask, signal } = input;
  const askOptions = signal === undefined ? undefined : { signal };
  const prefix = `mcp-elicitation-${randomUUID()}`;
  const first = await ask(
    {
      id: `${prefix}-0`,
      title: `MCP server ${JSON.stringify(serverName)} asks for input`,
      description: params.message,
      options: [
        { value: RESPOND, label: 'Respond' },
        { value: DECLINE, label: 'Decline', description: 'Tell the server you will not answer' },
      ],
      maxSelect: 1,
    },
    askOptions,
  );
  if (first.type !== 'answer') return CANCEL;
  if (first.values[0] !== RESPOND) return DECLINED;

  const required = new Set(params.requestedSchema.required ?? []);
  const content: TElicitationContent = {};
  let index = 0;
  for (const [key, field] of Object.entries(params.requestedSchema.properties)) {
    index += 1;
    const question = fieldQuestion(serverName, key, field, required.has(key));
    const outcome = await askField(`${prefix}-${index}`, question, ask, askOptions);
    if (outcome.kind === 'cancel') return CANCEL;
    if (outcome.kind === 'value') content[key] = outcome.value;
  }
  return { action: 'accept', content };
}

/** Asks one field, once more after an invalid answer, and cancels rather than send a bad value. */
async function askField(
  id: string,
  question: IFieldQuestion,
  ask: TMCPAskPort,
  askOptions: { signal: AbortSignal } | undefined,
): Promise<TParsedAnswer | { readonly kind: 'cancel' }> {
  let problem: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const description =
      problem === undefined
        ? question.request.description
        : [problem, question.request.description].filter(Boolean).join(' ');
    const response = await ask(
      {
        ...question.request,
        id: attempt === 0 ? id : `${id}-again`,
        ...(description === undefined ? {} : { description }),
      },
      askOptions,
    );
    if (response.type !== 'answer') return { kind: 'cancel' };
    const parsed = question.parse(response);
    if (parsed.kind !== 'invalid') return parsed;
    problem = `Invalid answer: ${parsed.reason}.`;
  }
  return { kind: 'cancel' };
}

function fieldQuestion(
  serverName: string,
  key: string,
  field: PrimitiveSchemaDefinition,
  required: boolean,
): IFieldQuestion {
  const title = `MCP server ${JSON.stringify(serverName)} asks: ${field.title ?? key}`;
  const warning =
    isCredentialShapedName(key) || (field.title !== undefined && isCredentialShapedName(field.title))
      ? CREDENTIAL_WARNING
      : undefined;
  const describe = (hint: string | undefined): string | undefined => {
    const text = [field.description, hint, warning].filter(Boolean).join(' ');
    return text.length === 0 ? undefined : text;
  };

  if (field.type === 'boolean') {
    const options: IActionOption[] = [
      { value: YES, label: 'Yes' },
      { value: NO, label: 'No' },
    ];
    const skip = required ? undefined : addSkipOption(options);
    return {
      request: {
        title,
        description: describe(undefined),
        options,
        maxSelect: 1,
        ...(field.default === undefined ? {} : { default: { values: [field.default ? YES : NO] } }),
      },
      parse: (response) => {
        const value = response.values[0];
        if (value === YES) return { kind: 'value', value: true };
        if (value === NO) return { kind: 'value', value: false };
        if (skip !== undefined && value === skip) return { kind: 'skip' };
        return { kind: 'invalid', reason: 'not one of the offered choices' };
      },
    };
  }

  if (field.type === 'array') {
    const options = arrayOptions(field);
    const allowed = new Set(options.map((option) => option.value));
    const maxSelect = Math.max(1, Math.min(field.maxItems ?? options.length, options.length));
    const minSelect = Math.max(0, Math.min(field.minItems ?? (required ? 1 : 0), maxSelect));
    const defaults = (field.default ?? []).filter((value) => allowed.has(value));
    return {
      request: {
        title,
        description: describe(undefined),
        options,
        minSelect,
        maxSelect,
        ...(defaults.length === 0 ? {} : { default: { values: defaults } }),
      },
      parse: (response) => {
        const values = response.values.filter((value) => allowed.has(value));
        if (values.length !== response.values.length)
          return { kind: 'invalid', reason: 'not one of the offered choices' };
        if (values.length === 0 && !required && minSelect === 0) return { kind: 'skip' };
        if (values.length < minSelect)
          return { kind: 'invalid', reason: `choose at least ${minSelect}` };
        if (values.length > maxSelect)
          return { kind: 'invalid', reason: `choose at most ${maxSelect}` };
        return { kind: 'value', value: values };
      },
    };
  }

  if (field.type === 'string') {
    if ('enum' in field || 'oneOf' in field) {
      const options = enumOptions(field);
      const allowed = new Set(options.map((option) => option.value));
      const skip = required ? undefined : addSkipOption(options);
      return {
        request: {
          title,
          description: describe(undefined),
          options,
          maxSelect: 1,
          ...(field.default !== undefined && allowed.has(field.default)
            ? { default: { values: [field.default] } }
            : {}),
        },
        parse: (response) => {
          const value = response.values[0];
          if (value !== undefined && allowed.has(value)) return { kind: 'value', value };
          if (skip !== undefined && value === skip) return { kind: 'skip' };
          return { kind: 'invalid', reason: 'not one of the offered choices' };
        },
      };
    }
    const hints = [
      lengthHint(field.minLength, field.maxLength),
      formatHint(field.format),
      required ? undefined : 'Leave empty to skip.',
    ].filter(Boolean);
    return {
      request: {
        title,
        description: describe(hints.length === 0 ? undefined : hints.join(' ')),
        allowFreeText: true,
        allowEmpty: !required,
        ...(field.default === undefined ? {} : { default: { text: field.default } }),
      },
      parse: (response) => {
        const text = response.text ?? '';
        if (text.length === 0)
          return required ? { kind: 'invalid', reason: 'an answer is required' } : { kind: 'skip' };
        if (field.minLength !== undefined && text.length < field.minLength)
          return { kind: 'invalid', reason: `at least ${field.minLength} characters` };
        if (field.maxLength !== undefined && text.length > field.maxLength)
          return { kind: 'invalid', reason: `at most ${field.maxLength} characters` };
        const format = formatProblem(field.format, text);
        return format === undefined
          ? { kind: 'value', value: text }
          : { kind: 'invalid', reason: format };
      },
    };
  }

  const integer = field.type === 'integer';
  const range = rangeHint(field.minimum, field.maximum);
  return {
    request: {
      title,
      description: describe(
        `${integer ? 'A whole number' : 'A number'}${range}.${required ? '' : ' Leave empty to skip.'}`,
      ),
      allowFreeText: true,
      allowEmpty: !required,
      ...(field.default === undefined ? {} : { default: { text: String(field.default) } }),
    },
    parse: (response) => {
      const text = (response.text ?? '').trim();
      if (text.length === 0)
        return required ? { kind: 'invalid', reason: 'an answer is required' } : { kind: 'skip' };
      const value = Number(text);
      if (!Number.isFinite(value)) return { kind: 'invalid', reason: 'not a number' };
      if (integer && !Number.isInteger(value))
        return { kind: 'invalid', reason: 'not a whole number' };
      if (field.minimum !== undefined && value < field.minimum)
        return { kind: 'invalid', reason: `at least ${field.minimum}` };
      if (field.maximum !== undefined && value > field.maximum)
        return { kind: 'invalid', reason: `at most ${field.maximum}` };
      return { kind: 'value', value };
    },
  };
}

function enumOptions(
  field: Extract<PrimitiveSchemaDefinition, { readonly type: 'string' }>,
): IActionOption[] {
  if ('oneOf' in field) return field.oneOf.map((entry) => ({ value: entry.const, label: entry.title }));
  if ('enum' in field) {
    const names = 'enumNames' in field ? field.enumNames : undefined;
    return field.enum.map((value, index) => ({ value, label: names?.[index] ?? value }));
  }
  return [];
}

function arrayOptions(
  field: Extract<PrimitiveSchemaDefinition, { readonly type: 'array' }>,
): IActionOption[] {
  const items = field.items;
  if ('anyOf' in items) return items.anyOf.map((entry) => ({ value: entry.const, label: entry.title }));
  return items.enum.map((value) => ({ value, label: value }));
}

/** Appends a "leave unanswered" choice whose value collides with no real option's. */
function addSkipOption(options: IActionOption[]): string {
  let value = '';
  while (options.some((option) => option.value === value)) value += '\u0000';
  options.push({ value, label: 'Leave unanswered' });
  return value;
}

function rangeHint(minimum: number | undefined, maximum: number | undefined): string {
  if (minimum !== undefined && maximum !== undefined) return ` from ${minimum} to ${maximum}`;
  if (minimum !== undefined) return ` of at least ${minimum}`;
  if (maximum !== undefined) return ` of at most ${maximum}`;
  return '';
}

function lengthHint(minLength: number | undefined, maxLength: number | undefined): string | undefined {
  if (minLength !== undefined && maxLength !== undefined)
    return `Between ${minLength} and ${maxLength} characters.`;
  if (minLength !== undefined) return `At least ${minLength} characters.`;
  if (maxLength !== undefined) return `At most ${maxLength} characters.`;
  return undefined;
}

function formatHint(format: 'email' | 'uri' | 'date' | 'date-time' | undefined): string | undefined {
  switch (format) {
    case 'email':
      return 'An email address.';
    case 'uri':
      return 'A URI.';
    case 'date':
      return 'A date (YYYY-MM-DD).';
    case 'date-time':
      return 'A date and time (ISO 8601).';
    default:
      return undefined;
  }
}

function formatProblem(
  format: 'email' | 'uri' | 'date' | 'date-time' | undefined,
  text: string,
): string | undefined {
  switch (format) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(text) ? undefined : 'not an email address';
    case 'uri':
      return URL.canParse(text) ? undefined : 'not a URI';
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/u.test(text) && !Number.isNaN(Date.parse(text))
        ? undefined
        : 'not a date (YYYY-MM-DD)';
    case 'date-time':
      return /^\d{4}-\d{2}-\d{2}T/u.test(text) && !Number.isNaN(Date.parse(text))
        ? undefined
        : 'not a date and time (ISO 8601)';
    default:
      return undefined;
  }
}
