/**
 * Narrow a third-party JSON schema to the part agent-core's universal subset can enforce — CORE-040.
 *
 * An MCP tool's `inputSchema` is authored by a THIRD-PARTY server. `validateAgainstJsonSchema` is the
 * single complete walk over the universal subset (CORE-039), and it REJECTS a node outside that
 * subset: `{ path }: unsupported schema type …`, or `… declares neither a type nor anyOf` for a node
 * carrying `oneOf` / `allOf` / `$ref`. Handing a third-party schema to it unchanged would therefore
 * refuse EVERY payload for any tool whose server used ordinary JSON Schema this repo happens not to
 * model — breaking a working tool over a limitation that is ours, not the server's.
 *
 * Refusing is wrong and so is ignoring. This narrows: the inexpressible SUBTREES are dropped from a
 * copy of the schema, everything remaining is enforced completely, and the dropped paths are
 * returned so a caller can say what it cannot check. Presence is unaffected — a dropped property
 * stays in its parent's `required`, so an omitted key is still an error; only the constraint on its
 * VALUE is gone, which is exactly the part that could not be checked either way.
 *
 * Reporting the paths is the half that keeps this from being a silent downgrade
 * (`enforcement-architecture.md`, "Silence is not success").
 */

import {
  PARAMETER_SCHEMA_KEYWORDS,
  TOOL_SCHEMA_PROJECTION_MAX_DEPTH,
  createLogger,
  validateAgainstJsonSchema,
} from '@robota-sdk/agent-core';

import type {
  IParameterSchema,
  IParameterValidationResult,
  TToolParameters,
} from '@robota-sdk/agent-core';

const logger = createLogger('ThirdPartySchema');

/** The types the universal subset models. Anything else is a node this repo cannot check. */
const SUBSET_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

/** The published JSON Schema meta-schemas, draft-04 through 2020-12. */
const STANDARD_DIALECT =
  /^https?:\/\/json-schema\.org\/(?:draft-0[4-7]\/schema|draft\/(?:2019-09|2020-12)\/schema)#?$/u;

/** The keywords `IParameterSchema` declares. A narrowed node carries no other. */
const SUBSET_KEYWORDS = new Set<string>(PARAMETER_SCHEMA_KEYWORDS);

/**
 * The deepest node narrowing keeps. A server can nest a schema until the walk overflows the stack, and
 * nothing above this call can catch that without losing the server. Past this depth a subtree is
 * treated as inexpressible, and the any-value node standing in for it still fits inside the ceiling
 * projection refuses a whole tool for.
 */
const NARROW_MAX_DEPTH = TOOL_SCHEMA_PROJECTION_MAX_DEPTH - 2;

const isText = (value: unknown): boolean => typeof value === 'string';
const isNonEmptyArray = (value: unknown): boolean => Array.isArray(value) && value.length > 0;
const isFiniteNumber = (value: unknown): boolean => Number.isFinite(value);
const isSizeBound = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 0;
const isRecord = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** A member `TJSONSchemaEnum` admits. */
const isEnumScalar = (value: unknown): boolean =>
  typeof value === 'string' || typeof value === 'boolean' || isFiniteNumber(value);

function isCompilablePattern(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    new RegExp(value);
    return true;
  } catch {
    // A pattern from another regex dialect, such as Python's `(?i)`. Validation compiles it per call.
    return false;
  }
}

/**
 * What `IParameterSchema` admits under each keyword. A narrowed node carries nothing else: the type
 * claims it, the session record's strict decoder refuses anything outside it, and a walk trusts it.
 * Keyed over the whole member set, so a keyword cannot join the subset without saying what it admits.
 * `items` passes here because its walk below decides, and reports a tuple or boolean as its own path.
 */
const KEYWORD_ADMITS: Readonly<Record<keyof IParameterSchema, (value: unknown) => boolean>> = {
  type: (value) => SUBSET_TYPES.has(value as string),
  description: isText,
  enum: isNonEmptyArray,
  items: () => true,
  properties: isRecord,
  required: (value) => Array.isArray(value) && value.every(isText),
  anyOf: isNonEmptyArray,
  additionalProperties: (value) =>
    typeof value === 'boolean' || (typeof value === 'object' && value !== null),
  minimum: isFiniteNumber,
  maximum: isFiniteNumber,
  minLength: isSizeBound,
  maxLength: isSizeBound,
  minItems: isSizeBound,
  maxItems: isSizeBound,
  minProperties: isSizeBound,
  maxProperties: isSizeBound,
  pattern: isCompilablePattern,
  format: isText,
  default: (value) => value === null || isEnumScalar(value),
};

/**
 * Keywords that constrain no value, so dropping them leaves nothing unchecked. `description` and
 * `default` are carried while their value is one the subset admits, and only ever dropped quietly.
 */
const ANNOTATION_KEYWORDS = new Set([
  'description',
  'default',
  'title',
  'examples',
  '$comment',
  '$id',
  '$anchor',
  '$defs',
  'definitions',
  'deprecated',
  'readOnly',
  'writeOnly',
  'contentMediaType',
  'contentEncoding',
]);

export interface INarrowedSchema {
  /** A copy carrying only what the subset can enforce. */
  schema: IParameterSchema;
  /** Dotted paths of the subtrees dropped, in document order. Empty when nothing was dropped. */
  unenforceable: string[];
}

/**
 * A node that accepts any JSON value, expressed IN the subset.
 *
 * An inexpressible property is replaced with this rather than deleted. `additionalProperties`
 * semantics make an object node that declares `properties` CLOSED, so deleting a key would turn the
 * server's own declared parameter into an "unexpected additional property" — refusing the payload
 * for the opposite reason. Replacing keeps the key declared and drops only the constraint on its
 * value, which is the part that could not be checked either way.
 */
function anyValueNode(): IParameterSchema {
  return {
    anyOf: [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'object' },
      { type: 'array' },
      { type: 'null' },
    ],
  } as IParameterSchema;
}

/**
 * A node the subset models: it declares a known `type`, or it is an `anyOf` union. Its value comes
 * from a third party, so it may not be an object at all.
 */
function isExpressible(node: unknown): node is IParameterSchema {
  if (!isRecord(node)) return false;
  const { anyOf, type } = node as IParameterSchema;
  if (isNonEmptyArray(anyOf)) return true;
  return typeof type === 'string' && SUBSET_TYPES.has(type);
}

function isCarried(key: string, value: unknown): boolean {
  return SUBSET_KEYWORDS.has(key) && KEYWORD_ADMITS[key as keyof IParameterSchema](value);
}

/**
 * Keep the members `TJSONSchemaEnum` admits. Under a scalar `type` the others can never match, so
 * filtering them changes nothing. Anywhere else one of them may be a value the server accepts, and
 * filtering would refuse it; so would an empty list, which no value matches. There the keyword goes,
 * and the constraint with it.
 */
function narrowEnum(node: IParameterSchema, path: string, dropped: string[]): IParameterSchema {
  const members: readonly unknown[] = node.enum ?? [];
  if (members.every(isEnumScalar)) return node;
  const scalars = members.filter(isEnumScalar);
  const othersCannotMatch =
    node.type === 'string' ||
    node.type === 'number' ||
    node.type === 'integer' ||
    node.type === 'boolean';
  if (othersCannotMatch && scalars.length > 0) {
    return { ...node, enum: scalars as IParameterSchema['enum'] };
  }
  dropped.push(`${path}.enum`);
  const { enum: _enum, ...withoutEnum } = node;
  return withoutEnum;
}

function narrowNode(
  input: IParameterSchema,
  path: string,
  depth: number,
  dropped: string[],
): IParameterSchema {
  const childDepth = depth + 1;
  const isFollowable = (child: unknown): child is IParameterSchema =>
    childDepth <= NARROW_MAX_DEPTH && isExpressible(child);
  let node = input;
  // A dialect declaration is not part of the portable schema contract, so it never persists. A
  // standard JSON Schema dialect gives the subset's keywords the meaning they have here, so dropping
  // it leaves nothing unchecked; any other dialect is reported.
  if (Object.prototype.hasOwnProperty.call(node, '$schema')) {
    const { $schema: dialect, ...portable } = node as IParameterSchema & { $schema?: unknown };
    if (typeof dialect !== 'string' || !STANDARD_DIALECT.test(dialect)) {
      dropped.push(`${path}.$schema`);
    }
    node = portable as IParameterSchema;
  }
  // The copy holds only subset keywords: anything else is a constraint nothing here checks (reported)
  // or an annotation (dropped quietly). Carrying it would hand on a schema outside the contract its
  // type claims, which a strict reader of that contract — the session record — then refuses.
  const record = node as Record<string, unknown>;
  const keywords = Object.keys(record);
  if (keywords.some((key) => !isCarried(key, record[key]))) {
    const subset: Record<string, unknown> = {};
    for (const key of keywords) {
      if (isCarried(key, record[key])) {
        subset[key] = record[key];
      } else if (!ANNOTATION_KEYWORDS.has(key)) {
        dropped.push(`${path}.${key}`);
      }
    }
    node = subset as IParameterSchema;
  }
  node = narrowEnum(node, path, dropped);
  // The contract carries `anyOf` INSTEAD of a type, and projection quarantines a tool holding both.
  // JSON Schema applies the two together, so keeping `type` drops only the further constraint.
  if (node.type !== undefined && node.anyOf !== undefined) {
    dropped.push(`${path}.anyOf`);
    const { anyOf: _anyOf, ...typed } = node;
    node = typed;
  }
  if (Array.isArray(node.anyOf)) {
    node = {
      ...node,
      anyOf: node.anyOf.map((child: unknown, index) => {
        const childPath = `${path}.anyOf[${index}]`;
        if (isFollowable(child)) return narrowNode(child, childPath, childDepth, dropped);
        // Narrowing a `$ref` branch in place would leave `{}`, which registration refuses and no
        // value matches. The accepts-anything branch makes the union admit what the server admits.
        dropped.push(childPath);
        return anyValueNode();
      }),
    };
  }
  if (typeof node.additionalProperties === 'object' && node.additionalProperties !== null) {
    const childPath = `${path}.additionalProperties`;
    if (isFollowable(node.additionalProperties)) {
      node = {
        ...node,
        additionalProperties: narrowNode(node.additionalProperties, childPath, childDepth, dropped),
      };
    } else {
      dropped.push(childPath);
      node = { ...node, additionalProperties: anyValueNode() };
    }
  }
  // Both walks run whatever the node's `type` says: a subtree the keyword does not apply to is still
  // a subtree the copy carries.
  if (node.properties !== undefined) {
    // `Object.fromEntries` keeps every name an own property. Assigning `__proto__` would set the
    // copy's prototype instead, losing the property before projection could refuse the name.
    const kept = Object.entries(node.properties).map(([key, child]) => {
      const childPath = `${path}.${key}`;
      if (isFollowable(child)) return [key, narrowNode(child, childPath, childDepth, dropped)];
      dropped.push(childPath);
      return [key, anyValueNode()];
    });
    // `required` is deliberately carried through untouched: a narrowed property is one whose VALUE
    // cannot be checked, not one that stopped being required.
    node = { ...node, properties: Object.fromEntries(kept) };
  }

  if (node.items !== undefined) {
    const itemsPath = `${path}[]`;
    if (!isFollowable(node.items)) {
      // An array node declares no closure, so dropping `items` is enough — there is no key here to
      // turn unexpected.
      dropped.push(itemsPath);
      const { items: _items, ...withoutItems } = node;
      return withoutItems as IParameterSchema;
    }
    return { ...node, items: narrowNode(node.items, itemsPath, childDepth, dropped) };
  }

  return node;
}

/**
 * @param schema - the third-party parameter schema, as the server declared it
 * @returns the enforceable copy, and the paths that were dropped from it
 */
export function narrowToUniversalSubset(schema: IParameterSchema): INarrowedSchema {
  const unenforceable: string[] = [];
  // A root the subset cannot express leaves nothing to enforce; an empty object node accepts any
  // payload, which is the honest outcome — and the root is reported, so it is not a quiet one.
  if (!isExpressible(schema)) {
    return { schema: { type: 'object' } as IParameterSchema, unenforceable: [''] };
  }
  return { schema: narrowNode(schema, '', 0, unenforceable), unenforceable };
}

/** Told once per tool when part of its schema cannot be enforced: `(toolName, paths)`. */
export type TUnenforceableSchemaReporter = (toolName: string, paths: string[]) => void;

/**
 * The parameter validator both MCP tool classes use — CORE-040.
 *
 * They previously carried the same hand-rolled top-level presence check, character for character.
 * Two copies of a validation decision is how PROV-004's drift starts, so there is one, and it is
 * held by the module that owns the third-party trust boundary.
 *
 * Narrowing runs ONCE per tool and is cached: it is a pure function of a schema that does not change
 * for the life of the tool, and the report is a property of the tool rather than of a call.
 */
export class ThirdPartySchemaValidator {
  private narrowed?: INarrowedSchema;
  private reported = false;

  constructor(
    private readonly toolName: string,
    private readonly parameters: IParameterSchema,
    private readonly report?: TUnenforceableSchemaReporter,
  ) {}

  validate(parameters: TToolParameters): IParameterValidationResult {
    this.narrowed ??= narrowToUniversalSubset(this.parameters);
    if (!this.reported && this.narrowed.unenforceable.length > 0) {
      this.reported = true;
      // Reported even with no injected reporter — an unenforceable schema that nobody is told about
      // is the silent downgrade this design exists to avoid.
      const report =
        this.report ??
        ((tool: string, paths: string[]): void => {
          logger.warn('MCP tool schema is only partly enforceable', { tool, paths });
        });
      report(this.toolName, this.narrowed.unenforceable);
    }
    const errors = validateAgainstJsonSchema(this.narrowed.schema, parameters, '');
    return { isValid: errors.length === 0, errors };
  }
}
