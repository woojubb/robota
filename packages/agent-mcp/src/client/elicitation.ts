/**
 * The inbound adapter from an MCP server's form-mode elicitation to the host's ask port.
 *
 * Both protocol eras deliver an elicitation through the one SDK handler (`elicitation/create` as
 * a server→client request on the legacy era, as an embedded `input_required` request on
 * 2026-07-28), so the mapping lives once, here, and speaks only `IActionRequest`: there is no second
 * prompt type, registry or renderer. Every prompt is titled with the identity the operator
 * configured for the server, carries the server's own text only as a single bounded line below it,
 * and is never masked: a form-mode elicitation may not ask for a secret, and a masked field would
 * hide what is being sent.
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

/** An in-flight call the handler may answer through, and the signal that withdraws its prompts. */
export interface IMCPAnswerableCall {
  readonly ask: TMCPAskPort;
  /**
   * Aborted once no in-flight call with a port remains, so no prompt outlives the calls it could
   * belong to. A sibling ending earlier proves nothing about whose prompt it is, so it never
   * withdraws one.
   */
  readonly withdrawn: AbortSignal;
}

/**
 * The tool calls of one session that are in flight. Neither era tells the handler which call an
 * elicitation belongs to, and every in-flight call of a session speaks to the same server through
 * the same session-wide port, so the oldest call that can answer does; with none, the server is
 * told so at once rather than left waiting.
 */
export class MCPElicitationCalls {
  private readonly calls = new Set<IMCPElicitationCall>();
  /** Alive while at least one in-flight call has a port; aborted when the last of them leaves. */
  private open: AbortController | undefined;

  /** Registers a call for as long as it runs; the returned function withdraws it. */
  enter(call: IMCPElicitationCall): () => void {
    const entry: IMCPElicitationCall = { ...call };
    this.calls.add(entry);
    return () => {
      this.calls.delete(entry);
      if (this.firstWithPort() === undefined) {
        this.open?.abort();
        this.open = undefined;
      }
    };
  }

  /** The oldest in-flight call that has an ask port, if any. */
  answerable(): IMCPAnswerableCall | undefined {
    const ask = this.firstWithPort();
    if (ask === undefined) return undefined;
    this.open ??= new AbortController();
    return { ask, withdrawn: this.open.signal };
  }

  private firstWithPort(): TMCPAskPort | undefined {
    for (const call of this.calls) if (call.ask !== undefined) return call.ask;
    return undefined;
  }
}

export type TMCPElicitationHandler = (
  params: ElicitRequestParams,
  signal: AbortSignal | undefined,
) => Promise<ElicitResult>;

/** The handler one client registers: routes a request to the in-flight call that can answer it. */
export function createElicitationHandler(input: {
  readonly serverId: () => string;
  readonly calls: MCPElicitationCalls;
}): TMCPElicitationHandler {
  return async (params, signal) => {
    // URL mode is never declared, so the SDK refuses it before this point; stated here regardless.
    if (params.mode === 'url') return { action: 'decline' };
    const call = input.calls.answerable();
    if (call === undefined) return { action: 'decline' };
    // The SDK's own signal already follows the originating call's abort on the pinned era and the
    // server's cancellation on the legacy era; `withdrawn` covers the calls ending any other way.
    const signals = [signal, call.withdrawn].filter(
      (candidate): candidate is AbortSignal => candidate !== undefined,
    );
    return bridgeElicitation({
      serverId: input.serverId(),
      params,
      ask: call.ask,
      signal: AbortSignal.any(signals),
    });
  };
}

export interface IBridgeElicitationInput {
  /** The identity the operator configured for the server, never the name it declares for itself. */
  readonly serverId: string;
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
/** Every choice list is shown with the same window the host's own asks use. */
const VISIBLE_OPTIONS = 8;
/** Bounds on server-authored text: a question line, a message or description, an option label. */
const TITLE_CHARS = 80;
const TEXT_CHARS = 400;
const LABEL_CHARS = 60;
const CREDENTIAL_WARNING =
  'Caution: this field is named like a credential; what you enter is shown as typed and sent to the server.';
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/u;

/** A C0 or C1 control, a Unicode line or paragraph separator, or whitespace: never shown as is. */
function isBlankOrControl(character: string): boolean {
  const point = character.codePointAt(0) ?? 0;
  return (
    point < 0x20 ||
    (point >= 0x7f && point <= 0x9f) ||
    point === 0x2028 ||
    point === 0x2029 ||
    /\s/u.test(character)
  );
}

/**
 * Server text as one bounded line: control characters and line breaks collapse to a space, so a
 * server cannot print a second line that reads as the host's, and a long text ends visibly.
 */
function line(text: string, max: number): string {
  const points: string[] = [];
  let blank = false;
  for (const character of text) {
    if (isBlankOrControl(character)) {
      blank = true;
      continue;
    }
    if (blank && points.length > 0) points.push(' ');
    blank = false;
    points.push(character);
  }
  return points.length <= max ? points.join('') : `${points.slice(0, max).join('')}…`;
}

/**
 * Puts one elicitation to a person as asks and returns the server's answer: `accept` with the typed
 * content, `decline` from the first question, or `cancel` from any dismissal, a second invalid
 * answer, or a failing port. Only the port is guarded — a port that throws is answered `cancel` so
 * the server is not left waiting — while a fault in this mapping propagates and fails the call.
 */
export async function bridgeElicitation(input: IBridgeElicitationInput): Promise<ElicitResult> {
  const { serverId, params, signal } = input;
  const askOptions = signal === undefined ? undefined : { signal };
  const ask = async (request: IActionRequest): Promise<TActionResponse | undefined> => {
    try {
      return await input.ask(request, askOptions);
    } catch {
      return undefined;
    }
  };
  const prefix = `mcp-elicitation-${randomUUID()}`;
  const first = await ask({
    id: `${prefix}-0`,
    title: `MCP server ${JSON.stringify(serverId)} asks for input`,
    description: line(params.message, TEXT_CHARS),
    options: [
      { value: RESPOND, label: 'Respond' },
      { value: DECLINE, label: 'Decline', description: 'Tell the server you will not answer' },
    ],
    maxSelect: 1,
    maxVisible: VISIBLE_OPTIONS,
  });
  if (first === undefined || first.type !== 'answer') return CANCEL;
  if (first.values[0] !== RESPOND) return DECLINED;

  const required = new Set(params.requestedSchema.required ?? []);
  const content: TElicitationContent = {};
  let index = 0;
  for (const [key, field] of Object.entries(params.requestedSchema.properties)) {
    index += 1;
    const question = fieldQuestion(serverId, key, field, required.has(key));
    const outcome = await askField(`${prefix}-${index}`, question, ask);
    if (outcome.kind === 'cancel') return CANCEL;
    if (outcome.kind === 'value') content[key] = outcome.value;
  }
  return { action: 'accept', content };
}

/** Asks one field, once more after an invalid answer, and cancels rather than send a bad value. */
async function askField(
  id: string,
  question: IFieldQuestion,
  ask: (request: IActionRequest) => Promise<TActionResponse | undefined>,
): Promise<TParsedAnswer | { readonly kind: 'cancel' }> {
  let problem: string | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const description =
      problem === undefined
        ? question.request.description
        : [problem, question.request.description].filter(Boolean).join(' ');
    const response = await ask({
      ...question.request,
      id: attempt === 0 ? id : `${id}-again`,
      ...(description === undefined ? {} : { description }),
    });
    if (response === undefined || response.type !== 'answer') return { kind: 'cancel' };
    const parsed = question.parse(response);
    if (parsed.kind !== 'invalid') return parsed;
    problem = `Invalid answer: ${parsed.reason}.`;
  }
  return { kind: 'cancel' };
}

function fieldQuestion(
  serverId: string,
  key: string,
  field: PrimitiveSchemaDefinition,
  required: boolean,
): IFieldQuestion {
  const title = `MCP server ${JSON.stringify(serverId)} asks: ${line(field.title ?? key, TITLE_CHARS)}`;
  const warning =
    isCredentialShapedName(key) || (field.title !== undefined && isCredentialShapedName(field.title))
      ? CREDENTIAL_WARNING
      : undefined;
  const describe = (hint: string | undefined): string | undefined => {
    const text = [
      field.description === undefined ? undefined : line(field.description, TEXT_CHARS),
      hint,
      warning,
    ]
      .filter(Boolean)
      .join(' ');
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
        maxVisible: VISIBLE_OPTIONS,
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

  if (field.type === 'array') return arrayQuestion(title, describe(undefined), field, required);

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
          maxVisible: VISIBLE_OPTIONS,
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
      field.default === undefined ? undefined : `Default: ${line(field.default, LABEL_CHARS)}.`,
      required ? undefined : 'Leave empty to skip.',
    ].filter(Boolean);
    return {
      request: {
        title,
        description: describe(hints.length === 0 ? undefined : hints.join(' ')),
        allowFreeText: true,
        allowEmpty: !required,
        ...(field.default === undefined
          ? {}
          : { placeholder: line(field.default, LABEL_CHARS), default: { text: field.default } }),
      },
      parse: (response) => {
        const text = response.text ?? '';
        if (text.length === 0)
          return required ? { kind: 'invalid', reason: 'an answer is required' } : { kind: 'skip' };
        const length = [...text].length;
        if (field.minLength !== undefined && length < field.minLength)
          return { kind: 'invalid', reason: `at least ${field.minLength} characters` };
        if (field.maxLength !== undefined && length > field.maxLength)
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
  const hints = [
    `${integer ? 'A whole number' : 'A number'}${range}.`,
    field.default === undefined ? undefined : `Default: ${field.default}.`,
    required ? undefined : 'Leave empty to skip.',
  ].filter(Boolean);
  return {
    request: {
      title,
      description: describe(hints.join(' ')),
      allowFreeText: true,
      allowEmpty: !required,
      ...(field.default === undefined
        ? {}
        : { placeholder: String(field.default), default: { text: String(field.default) } }),
    },
    parse: (response) => {
      const text = (response.text ?? '').trim();
      if (text.length === 0)
        return required ? { kind: 'invalid', reason: 'an answer is required' } : { kind: 'skip' };
      if (!DECIMAL.test(text)) return { kind: 'invalid', reason: 'not a number' };
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

/**
 * An array of choices: a multi-select bounded by the field, or one choice when at most one item is
 * allowed. An optional field is always skippable — an empty selection, or the skip choice — and a
 * selection below `minItems` is refused rather than sent short.
 */
function arrayQuestion(
  title: string,
  description: string | undefined,
  field: Extract<PrimitiveSchemaDefinition, { readonly type: 'array' }>,
  required: boolean,
): IFieldQuestion {
  const options = arrayOptions(field);
  const order = new Map(options.map((option, index) => [option.value, index]));
  const maxSelect = Math.max(1, Math.min(field.maxItems ?? options.length, options.length));
  // A required field the server lets be empty (`minItems: 0`) accepts an empty list.
  const minItems = Math.min(field.minItems ?? (required ? 1 : 0), maxSelect);
  const defaults = (field.default ?? [])
    .filter((value) => order.has(value))
    .slice(0, maxSelect);
  const inOrder = (values: readonly string[]): string[] =>
    [...values].sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
  if (maxSelect === 1) {
    // "None" is offered when the field is optional, or required but allowed to be empty.
    const none = !required || minItems === 0 ? addSkipOption(options) : undefined;
    return {
      request: {
        title,
        description,
        options,
        maxSelect: 1,
        maxVisible: VISIBLE_OPTIONS,
        ...(defaults.length === 0 ? {} : { default: { values: defaults } }),
      },
      parse: (response) => {
        const value = response.values[0];
        if (value !== undefined && order.has(value)) return { kind: 'value', value: [value] };
        if (none !== undefined && value === none)
          return required ? { kind: 'value', value: [] } : { kind: 'skip' };
        return { kind: 'invalid', reason: 'not one of the offered choices' };
      },
    };
  }
  return {
    request: {
      title,
      description,
      options,
      minSelect: required ? minItems : 0,
      maxSelect,
      ...(defaults.length === 0 ? {} : { default: { values: defaults } }),
    },
    parse: (response) => {
      const values = response.values.filter((value) => order.has(value));
      if (values.length !== response.values.length)
        return { kind: 'invalid', reason: 'not one of the offered choices' };
      if (values.length === 0 && !required) return { kind: 'skip' };
      if (values.length === 0 && minItems === 0) return { kind: 'value', value: [] };
      if (values.length < minItems)
        return {
          kind: 'invalid',
          reason: required ? `choose at least ${minItems}` : `choose none or at least ${minItems}`,
        };
      if (values.length > maxSelect)
        return { kind: 'invalid', reason: `choose at most ${maxSelect}` };
      return { kind: 'value', value: inOrder(values) };
    },
  };
}

function enumOptions(
  field: Extract<PrimitiveSchemaDefinition, { readonly type: 'string' }>,
): IActionOption[] {
  if ('oneOf' in field)
    return field.oneOf.map((entry) => ({
      value: entry.const,
      label: line(entry.title, LABEL_CHARS),
    }));
  if ('enum' in field) {
    const names = 'enumNames' in field ? field.enumNames : undefined;
    return field.enum.map((value, index) => ({
      value,
      label: line(names?.[index] ?? value, LABEL_CHARS),
    }));
  }
  return [];
}

function arrayOptions(
  field: Extract<PrimitiveSchemaDefinition, { readonly type: 'array' }>,
): IActionOption[] {
  const items = field.items;
  if ('anyOf' in items)
    return items.anyOf.map((entry) => ({
      value: entry.const,
      label: line(entry.title, LABEL_CHARS),
    }));
  return items.enum.map((value) => ({ value, label: line(value, LABEL_CHARS) }));
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
      return 'A date and time (RFC 3339, such as 2026-01-31T09:00:00Z).';
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
    case 'date': {
      if (!DATE.test(text)) return 'not a date (YYYY-MM-DD)';
      const parsed = new Date(`${text}T00:00:00Z`);
      // A day the calendar lacks rolls over when parsed; the round trip catches it.
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(text)
        ? undefined
        : 'not a calendar date';
    }
    case 'date-time':
      return DATE_TIME.test(text) && !Number.isNaN(Date.parse(text))
        ? undefined
        : 'not a date and time (RFC 3339)';
    default:
      return undefined;
  }
}
