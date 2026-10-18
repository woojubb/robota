/**
 * How a session prompt becomes an MCP form-mode elicitation, and how the client's answer becomes the
 * prompt's resolution. A permission offers allow-once and deny only: a caller never widens a
 * standing permission through MCP. An ask becomes a form when it can be expressed without a secret;
 * a masked ask, or one with neither options nor free text, is not sent and keeps today's outcome.
 * An answer counts only where it names what was offered; anything else is a denial or a cancel.
 */
import type { IMcpTransportSession } from './mcp-session.js';
import type { ElicitRequestFormParams, ElicitResult } from '@modelcontextprotocol/server';
import type {
  IAskRequestEvent,
  IPermissionRequestEvent,
} from '@robota-sdk/agent-interface-session';

type TActionRequest = IAskRequestEvent['request'];
type TActionResponse = Parameters<IMcpTransportSession['resolveAsk']>[1];
type TRequestedSchema = ElicitRequestFormParams['requestedSchema'];
type TFormField = TRequestedSchema['properties'][string];

const CANCELLED: TActionResponse = { type: 'cancelled' };

/** The one field of a permission form and its two answers. */
export const PERMISSION_FIELD = 'decision';
const ALLOW_ONCE = 'allow_once';
const DENY = 'deny';

/** The fields of an ask form: the chosen option(s), and typed text where the ask allows it. */
export const ASK_ANSWER_FIELD = 'answer';
export const ASK_TEXT_FIELD = 'text';

/** The arguments a person recognises a call by, in the order the tools put them first. */
const SUMMARY_ARGS = ['command', 'file_path', 'path', 'url', 'pattern', 'query'] as const;
/** Arguments longer than this are cut in the message; the client shows a form, not a viewer. */
const MAX_ARGUMENT_CHARS = 2000;

function summaryArg(args: IPermissionRequestEvent['toolArgs']): string | undefined {
  for (const key of SUMMARY_ARGS) {
    const value = args[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

function bounded(text: string): string {
  return text.length > MAX_ARGUMENT_CHARS ? `${text.slice(0, MAX_ARGUMENT_CHARS)}…` : text;
}

/** What the person is asked to allow: the tool, who asks, what it was called with. */
export function permissionMessage(event: IPermissionRequestEvent): string {
  const summary = summaryArg(event.toolArgs);
  const title = `Allow ${event.toolName}${summary === undefined ? '' : `: ${bounded(summary)}`}?`;
  const lines = [event.requester ? `${event.requester.label} asks: ${title}` : title];
  lines.push(`Arguments: ${bounded(JSON.stringify(event.toolArgs))}`);
  if (event.cwd !== undefined) lines.push(`Working directory: ${event.cwd}`);
  return lines.join('\n');
}

export function permissionElicitation(event: IPermissionRequestEvent): ElicitRequestFormParams {
  return {
    message: permissionMessage(event),
    requestedSchema: {
      type: 'object',
      properties: {
        [PERMISSION_FIELD]: {
          type: 'string',
          title: 'Decision',
          description: 'Allow this one call, or deny it. Nothing is remembered.',
          enum: [ALLOW_ONCE, DENY],
          enumNames: ['Allow once', 'Deny'],
        },
      },
      required: [PERMISSION_FIELD],
    },
  };
}

/** Allowed only by an accepted form that chose allow-once; every other answer denies. */
export function permissionDecision(result: ElicitResult): boolean {
  return result.action === 'accept' && result.content?.[PERMISSION_FIELD] === ALLOW_ONCE;
}

function selectionBounds(request: TActionRequest): { min: number; max: number } {
  const max = Math.max(1, Math.floor(request.maxSelect ?? 1));
  const min = Math.min(max, Math.max(0, Math.floor(request.minSelect ?? 1)));
  return { min, max };
}

function optionField(request: TActionRequest, options: readonly { value: string; label: string; description?: string }[]): TFormField {
  const { min, max } = selectionBounds(request);
  const values = options.map((option) => option.value);
  const notes = options
    .filter((option) => option.description !== undefined || option.label !== option.value)
    .map((option) =>
      option.description === undefined
        ? `${option.value}: ${option.label}`
        : `${option.value}: ${option.label} — ${option.description}`,
    );
  const description = notes.length > 0 ? notes.join('\n') : undefined;
  const defaults = request.default?.values?.filter((value) => values.includes(value));
  if (max > 1) {
    return {
      type: 'array',
      title: 'Answer',
      ...(description !== undefined ? { description } : {}),
      minItems: min,
      maxItems: max,
      items: { type: 'string', enum: values },
      ...(defaults !== undefined && defaults.length > 0 ? { default: defaults } : {}),
    };
  }
  return {
    type: 'string',
    title: 'Answer',
    ...(description !== undefined ? { description } : {}),
    enum: values,
    enumNames: options.map((option) => option.label),
    ...(defaults?.[0] !== undefined ? { default: defaults[0] } : {}),
  };
}

/**
 * The form for an ask, or `undefined` when the ask cannot be put to an MCP client: a masked ask
 * (a form-mode elicitation may not carry a secret) or one that offers nothing to answer with.
 */
export function askElicitation(request: TActionRequest): ElicitRequestFormParams | undefined {
  if (request.masked === true) return undefined;
  const options = request.options ?? [];
  const freeText = request.allowFreeText === true;
  if (options.length === 0 && !freeText) return undefined;
  const properties: TRequestedSchema['properties'] = {};
  const required: string[] = [];
  if (options.length > 0) {
    properties[ASK_ANSWER_FIELD] = optionField(request, options);
    if (!freeText && selectionBounds(request).min > 0) required.push(ASK_ANSWER_FIELD);
  }
  if (freeText) {
    const text = request.default?.text;
    properties[ASK_TEXT_FIELD] = {
      type: 'string',
      title: options.length > 0 ? 'Other answer' : 'Answer',
      ...(request.placeholder !== undefined ? { description: request.placeholder } : {}),
      ...(request.allowEmpty === true ? {} : { minLength: 1 }),
      ...(text !== undefined ? { default: text } : {}),
    };
    if (options.length === 0 && request.allowEmpty !== true) required.push(ASK_TEXT_FIELD);
  }
  return {
    message: [request.title, request.description].filter((line) => line).join('\n'),
    requestedSchema: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
  };
}

/**
 * The ask's answer from the client's form. Only offered option values count, within the ask's
 * selection bounds, and text only where the ask allows typing; a form that answers with anything
 * else, or that was declined or cancelled, cancels the ask.
 */
export function askAnswer(request: TActionRequest, result: ElicitResult): TActionResponse {
  if (result.action !== 'accept') return CANCELLED;
  const content = result.content ?? {};
  const offered = new Set((request.options ?? []).map((option) => option.value));
  const { min, max } = selectionBounds(request);
  const chosen = content[ASK_ANSWER_FIELD];
  const values: string[] = [];
  if (chosen !== undefined) {
    const list = Array.isArray(chosen) ? chosen : [chosen];
    for (const value of list) {
      if (typeof value !== 'string' || !offered.has(value) || values.includes(value)) {
        return CANCELLED;
      }
      values.push(value);
    }
  }
  if (values.length > max) return CANCELLED;
  const text = content[ASK_TEXT_FIELD];
  if (text !== undefined && (typeof text !== 'string' || request.allowFreeText !== true)) {
    return CANCELLED;
  }
  const typed = text !== undefined && text !== '';
  if (values.length < min && !typed) return CANCELLED;
  if (values.length === 0 && !typed && request.allowEmpty !== true) return CANCELLED;
  return { type: 'answer', values, ...(text !== undefined ? { text } : {}) };
}
