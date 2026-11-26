/**
 * What a launch request and a kept launch intent may hold. A request arrives from the page, so its
 * key and values are bounded and of a fixed shape before anything else looks at them; a kept intent is
 * checked field by field when it is read back, so a file edited by hand or damaged cannot hand the
 * coordinator anything this module did not accept.
 */
import {
  TaskCatalogRefusedError,
  asRecord,
  isoTime,
  listOf,
  oneOf,
  positiveInteger,
  rejectUnknownKeys,
  shaped,
  singleLine,
} from '../fields.js';
import { checkBindingSpec } from '../bindings.js';
import { DEFINITION_LIMITS, INPUT_NAME, SLUG } from '../validate-definition.js';
import { parseOutcome } from './outcome.js';
import { isPageRefusal, parseRunReceipt } from './receipts.js';
import { LAUNCH_STATUSES, LaunchRefusedError } from './types.js';

import type { ICapabilityBinding } from '../bindings.js';
import type {
  ILaunchBinding,
  ILaunchFailure,
  ILaunchIntent,
  TKeptReceipt,
  TLaunchInputs,
  TLaunchOrigin,
  TLaunchStatus,
} from './types.js';

export const LAUNCH_LIMITS = {
  /** The longest a text value may be: a question or a page address, not a document. */
  value: 2048,
  bindings: 16,
  failure: 300,
  /** The page reads one launch keeps while it waits for its outcome. */
  receipts: 50,
  /** The refusals it keeps beside them, in a room of their own so that reads cannot crowd them out. */
  refusals: 10,
  /** The whole request body, as JSON. */
  body: 8192,
} as const;

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const LAUNCH_ID = /^launch-[0-9a-f-]{36}$/u;
const OFFER_ID = /^offer-[a-z0-9]{1,40}$/u;
const GOAL_ID = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const HEX_DIGEST = /^[0-9a-f]{64}$/u;
const MAX_NUMBER = 1e9;

/** The client's idempotency key: short, and made of characters that are safe wherever it is kept or shown. */
export function launchKey(value: unknown): string {
  if (typeof value !== 'string' || !KEY.test(value))
    throw new LaunchRefusedError(
      'invalid',
      'idempotencyKey must be 8 to 128 letters, digits or . _ : -',
    );
  return value;
}

/**
 * The values a request carries, checked for shape only: at most as many as a task may ask for, each
 * under a safe name, and each a bounded piece of text or a number. Which values a task wants, and what
 * they may be, is judged against the task afterwards.
 */
export function rawInputs(value: unknown): Record<string, string | number> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new LaunchRefusedError('invalid', 'inputs must be an object');
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > DEFINITION_LIMITS.inputs)
    throw new LaunchRefusedError('invalid', 'inputs has more values than any task asks for');
  const inputs: Record<string, string | number> = {};
  for (const [name, entry] of entries) {
    if (!INPUT_NAME.test(name))
      throw new LaunchRefusedError('invalid', `inputs has a name that is not an input name`);
    if (typeof entry === 'string' && entry.length <= LAUNCH_LIMITS.value) inputs[name] = entry;
    else if (typeof entry === 'number' && Number.isFinite(entry) && Math.abs(entry) <= MAX_NUMBER)
      inputs[name] = entry;
    else throw new LaunchRefusedError('invalid', `inputs.${name} is not a short text or a number`);
  }
  return inputs;
}

/** Run a field check that refuses with the catalog's error, and refuse with the launch's own instead. */
export function asInvalid<T>(check: () => T): T {
  try {
    return check();
  } catch (error) {
    if (error instanceof TaskCatalogRefusedError)
      throw new LaunchRefusedError('invalid', error.message);
    throw error;
  }
}

function parseInputs(raw: unknown): TLaunchInputs {
  const record = asRecord(raw, 'inputs');
  const entries = Object.entries(record);
  if (entries.length > DEFINITION_LIMITS.inputs)
    throw new TaskCatalogRefusedError('inputs has more values than any task asks for');
  const inputs: Record<string, string | number> = {};
  for (const [name, entry] of entries) {
    shaped(name, 'inputs name', INPUT_NAME, 40);
    if (typeof entry === 'string')
      inputs[name] = singleLine(entry, `inputs.${name}`, LAUNCH_LIMITS.value);
    else if (typeof entry === 'number' && Number.isFinite(entry)) inputs[name] = entry;
    else throw new TaskCatalogRefusedError(`inputs.${name} must be text or a number`);
  }
  return inputs;
}

const BINDING_KEYS = ['capability', 'adapter', 'account', 'tool', 'effect', 'argumentBoundary'];

/** A kept binding is read back as data that passes the host's own check; it is never issued again. */
function parseBinding(raw: unknown, index: number): ILaunchBinding {
  const where = `bindings[${index}]`;
  const binding = asRecord(raw, where);
  rejectUnknownKeys(binding, BINDING_KEYS, where);
  return checkBindingSpec(binding as unknown as ICapabilityBinding);
}

function parseFailure(raw: unknown): ILaunchFailure {
  const failure = asRecord(raw, 'failure');
  rejectUnknownKeys(failure, ['kind', 'message'], 'failure');
  return {
    kind: oneOf(failure['kind'], 'failure.kind', ['stale', 'goal'] as const),
    message: singleLine(failure['message'], 'failure.message', LAUNCH_LIMITS.failure),
  };
}

function parseOrigin(raw: unknown): TLaunchOrigin {
  const origin = asRecord(raw, 'origin');
  const kind = oneOf(origin['kind'], 'origin.kind', ['manual', 'offer'] as const);
  if (kind === 'manual') {
    rejectUnknownKeys(origin, ['kind'], 'origin');
    return { kind };
  }
  rejectUnknownKeys(origin, ['kind', 'offerId'], 'origin');
  return { kind, offerId: shaped(origin['offerId'], 'origin.offerId', OFFER_ID, 46) };
}

/** An offer id as the page sends it for a start: refused as a bad request instead of looked up. */
export function launchOfferId(value: unknown): string {
  if (typeof value !== 'string' || !OFFER_ID.test(value) || value.length > 46)
    throw new LaunchRefusedError('invalid', 'offerId is not the id of an offer');
  return value;
}

/** The receipts kept for a launch: no more reads than a launch keeps, and no more refusals, each in its own room. */
function parseReceipts(raw: unknown): TKeptReceipt[] {
  const receipts = listOf(raw, 'receipts', 0, LAUNCH_LIMITS.receipts + LAUNCH_LIMITS.refusals).map(
    (entry, index) => parseRunReceipt(entry, `receipts[${index}]`),
  );
  const refusals = receipts.filter(isPageRefusal).length;
  if (refusals > LAUNCH_LIMITS.refusals || receipts.length - refusals > LAUNCH_LIMITS.receipts)
    throw new TaskCatalogRefusedError('receipts has more entries than a launch keeps');
  return receipts;
}

const INTENT_KEYS = [
  'id',
  'idempotencyKey',
  'requestDigest',
  'definitionId',
  'definitionRevision',
  'definitionDigest',
  'inputs',
  'bindings',
  'origin',
  'status',
  'goalId',
  'failure',
  'receipts',
  'outcome',
  'createdAt',
  'updatedAt',
];

/** The intent as a fresh value, or the refusal that says which field is wrong. */
export function parseIntent(raw: unknown): ILaunchIntent {
  const intent = asRecord(raw, 'A launch');
  rejectUnknownKeys(intent, INTENT_KEYS, 'A launch');
  const origin = parseOrigin(intent['origin']);
  const status: TLaunchStatus = oneOf(intent['status'], 'status', LAUNCH_STATUSES);
  const launched = status === 'launched';
  if ((intent['goalId'] !== undefined) !== launched)
    throw new TaskCatalogRefusedError('goalId belongs to a launched launch, and only to one');
  if ((intent['failure'] !== undefined) !== (status === 'failed'))
    throw new TaskCatalogRefusedError('failure belongs to a failed launch, and only to one');
  if (intent['outcome'] !== undefined && !launched)
    throw new TaskCatalogRefusedError('outcome belongs to a launched launch, and only to one');
  if (intent['receipts'] !== undefined && (!launched || intent['outcome'] !== undefined))
    throw new TaskCatalogRefusedError(
      'receipts are kept only while a launched launch waits for its outcome',
    );
  const createdAt = isoTime(intent['createdAt'], 'createdAt');
  const updatedAt = isoTime(intent['updatedAt'], 'updatedAt');
  if (Date.parse(updatedAt) < Date.parse(createdAt))
    throw new TaskCatalogRefusedError('updatedAt must not be before createdAt');
  return {
    id: shaped(intent['id'], 'id', LAUNCH_ID, 50),
    idempotencyKey: shaped(intent['idempotencyKey'], 'idempotencyKey', KEY, 128),
    requestDigest: shaped(intent['requestDigest'], 'requestDigest', HEX_DIGEST, 64),
    definitionId: shaped(intent['definitionId'], 'definitionId', SLUG, 60),
    definitionRevision: positiveInteger(intent['definitionRevision'], 'definitionRevision'),
    definitionDigest: shaped(intent['definitionDigest'], 'definitionDigest', HEX_DIGEST, 64),
    inputs: parseInputs(intent['inputs']),
    bindings: listOf(intent['bindings'], 'bindings', 1, LAUNCH_LIMITS.bindings).map(parseBinding),
    origin,
    status,
    ...(launched && { goalId: shaped(intent['goalId'], 'goalId', GOAL_ID, 80) }),
    ...(status === 'failed' && { failure: parseFailure(intent['failure']) }),
    ...(intent['receipts'] !== undefined && { receipts: parseReceipts(intent['receipts']) }),
    ...(intent['outcome'] !== undefined && { outcome: parseOutcome(intent['outcome']) }),
    createdAt,
    updatedAt,
  };
}
