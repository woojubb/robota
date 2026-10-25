import type { TOpenAIExtraBody, TOpenAIExtraBodyValue } from './types';

// Fields either request builder writes, plus other spellings of the same concerns: overriding one
// would bypass tool projection, the parallel policy, stream assembly, or the effort-outcome and
// native-web reports. Also fields that change the response shape the parsers read (one choice, a
// completed text response) or add server-side history to the full history already sent.
const PROVIDER_MANAGED_FIELDS: ReadonlySet<string> = new Set([
  'model',
  'messages',
  'input',
  'previous_response_id',
  'conversation',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'functions',
  'function_call',
  'web_search_options',
  'stream',
  'stream_options',
  'n',
  'background',
  'modalities',
  'audio',
  'response_format',
  'text',
  'max_tokens',
  'max_completion_tokens',
  'max_output_tokens',
  'temperature',
  'reasoning',
  'reasoning_effort',
  'include',
  'store',
]);

export function parseExtraBody(value: unknown): TOpenAIExtraBody | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    throw new Error('extraBody must be a plain JSON object');
  }
  const extraBody = copyJsonObject(value, new Set());
  for (const field of Object.keys(extraBody)) {
    if (PROVIDER_MANAGED_FIELDS.has(field)) {
      throw new Error(`extraBody cannot set the provider-managed field ${field}`);
    }
  }
  return Object.keys(extraBody).length === 0 ? undefined : extraBody;
}

export function assertExtraBodyExecutor(
  extraBody: TOpenAIExtraBody | undefined,
  hasExecutor: boolean,
): void {
  if (extraBody !== undefined && hasExecutor) {
    throw new Error('extraBody cannot be used with an executor');
  }
}

/** A fresh copy per request, so a raw-payload observer cannot change later requests. */
export function extraBodyWire(
  extraBody: TOpenAIExtraBody | undefined,
): Record<string, TOpenAIExtraBodyValue> {
  return extraBody === undefined ? {} : copyJsonObject(extraBody, new Set());
}

function isPlainObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// Accepts exactly what JSON serialization keeps unchanged; anything it would drop, alter or throw
// on is rejected instead.
function copyJsonValue(value: unknown, ancestors: Set<object>): TOpenAIExtraBodyValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return copyJsonArray(value, ancestors);
  if (isPlainObject(value)) return copyJsonObject(value, ancestors);
  throw invalidJsonData();
}

function copyJsonArray(value: unknown[], ancestors: Set<object>): TOpenAIExtraBodyValue[] {
  enter(value, ancestors);
  if (Object.keys(value).length !== value.length) throw invalidJsonData();
  const copy: TOpenAIExtraBodyValue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!(index in value)) throw invalidJsonData();
    copy.push(copyJsonValue(value[index], ancestors));
  }
  ancestors.delete(value);
  return copy;
}

function copyJsonObject(
  value: object,
  ancestors: Set<object>,
): Record<string, TOpenAIExtraBodyValue> {
  enter(value, ancestors);
  const entries = Reflect.ownKeys(value).map((key): [string, TOpenAIExtraBodyValue] => {
    if (typeof key !== 'string' || !Object.prototype.propertyIsEnumerable.call(value, key)) {
      throw invalidJsonData();
    }
    return [key, copyJsonValue(Reflect.get(value, key), ancestors)];
  });
  ancestors.delete(value);
  // `Object.fromEntries` defines own data properties, so a `__proto__` key stays plain data.
  return Object.fromEntries(entries);
}

function enter(value: object, ancestors: Set<object>): void {
  if (ancestors.has(value)) throw invalidJsonData();
  ancestors.add(value);
}

function invalidJsonData(): Error {
  return new Error(
    'extraBody must contain only JSON data: null, booleans, strings, finite numbers, arrays and plain objects',
  );
}
