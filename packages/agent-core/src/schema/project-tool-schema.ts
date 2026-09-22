/**
 * Project an MCP tool's schema into what one provider's wire format can actually carry — MCP-005.
 *
 * Four converters used to reshape `IToolSchema.parameters` independently and disagreed with each
 * other and with the provider APIs (Anthropic cast it straight through, the openai-compatible family
 * shallow-spread it, OpenAI closed objects only when `strictTools` was on, Gemini rebuilt it field by
 * field and silently dropped anything it did not copy). A schema a provider rejects failed the WHOLE
 * request, or was silently narrowed. `projectToolSchema` is the one shared, tested projector every
 * provider calls instead: pure, deterministic, never throws, never mutates its input. A tool that
 * cannot be projected is REJECTED with a structured diagnostic — never dropped silently, never sent
 * in another shape (No Fallback Policy).
 *
 * This is NOT a second validator. CORE-040 (`agent-mcp/src/third-party-schema.ts`) stays the one
 * narrowing step for untrusted third-party schemas down to `IParameterSchema`; this module only
 * projects an already-`IParameterSchema`-shaped tool down to what one provider's profile accepts.
 * The universal subset (CORE-039, `../interfaces/tool-schema.ts`) is the SSOT this module walks —
 * `PARAMETER_SCHEMA_KEYWORDS` is derived from it once, at the type level, so the two cannot drift.
 *
 * See `docs/SPEC.md` § "Tool Schema Projection (MCP-005)" for the full contract.
 */

import { createHash } from 'node:crypto';

import { closeObjectSchemas } from './close-object-schemas';

import type {
  IObjectParameterSchema,
  IParameterSchema,
  IToolSchema,
} from '../interfaces/tool-schema';

/**
 * Depth and node ceilings shared by every profile — a schema is unbounded complexity otherwise, and
 * MCP itself sets no ceiling (the incompatibility lives entirely at the provider boundary).
 */
export const TOOL_SCHEMA_PROJECTION_MAX_DEPTH = 32;
export const TOOL_SCHEMA_PROJECTION_MAX_NODES = 2000;

/**
 * Every member `IParameterSchema` declares (CORE-039, `../interfaces/tool-schema.ts:48-63`), derived
 * ONCE at the type level rather than hand-typed a second time. `Required<IParameterSchema>` forces
 * this record literal to gain or lose a property whenever the interface does — a missing or
 * extraneous key here is a compile error, not a silent drift.
 */
type TParameterSchemaKeywordRecord = { [K in keyof Required<IParameterSchema>]: true };
const PARAMETER_SCHEMA_KEYWORD_RECORD: TParameterSchemaKeywordRecord = {
  type: true,
  description: true,
  enum: true,
  items: true,
  properties: true,
  required: true,
  anyOf: true,
  additionalProperties: true,
  minimum: true,
  maximum: true,
  pattern: true,
  format: true,
  default: true,
};
/** The `IParameterSchema` member set, as a lookup — the SSOT `unknownKeywords` judges every key against. */
export const PARAMETER_SCHEMA_KEYWORDS: readonly (keyof IParameterSchema)[] = Object.keys(
  PARAMETER_SCHEMA_KEYWORD_RECORD,
) as (keyof IParameterSchema)[];
const PARAMETER_SCHEMA_KEYWORD_SET = new Set<string>(PARAMETER_SCHEMA_KEYWORDS);

/** Property names that risk prototype pollution if ever assigned as an object key. Refused outright. */
const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Stripped/replaced keywords that constrain nothing (pure metadata) — removing one produces no
 * `Schema note`, unlike a validation keyword (`minLength`, `pattern`, `additionalProperties`, a
 * replaced `$ref`/`oneOf`/`allOf` node, …) whose removal actually narrows what the schema states.
 */
const ANNOTATION_ONLY_KEYWORDS = new Set(['title', '$schema', '$comment', 'examples', 'default']);

/**
 * A node that accepts any JSON value, expressed IN the universal subset — the same shape CORE-040
 * substitutes for an inexpressible node (`agent-mcp/src/third-party-schema.ts`, `anyValueNode`).
 * Replacing (not deleting) a structurally-empty node keeps a declared property declared: an object
 * node with `properties` is CLOSED relative to that set, so deleting the key would turn it into an
 * "unexpected additional property" instead of a value whose shape merely could not be projected.
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
  };
}

/** How one provider's wire format constrains the universal subset it is handed. */
export interface IToolSchemaProjectionProfile {
  /** Named in the `Schema note` and the quarantine line. */
  readonly providerName: string;
  /** `additionalProperties: false` on every object node. */
  readonly closedObjects: boolean;
  /** Every property listed in `required` (lossy — pairs with `optionalAsNullable`). */
  readonly requireAllProperties: boolean;
  /** An optional property becomes `anyOf: [T, { type: 'null' }]` once forced into `required`. */
  readonly optionalAsNullable: boolean;
  /** Keywords outside the `IParameterSchema` member set: pass through, remove/replace, or refuse. */
  readonly unknownKeywords: 'adopt' | 'strip' | 'reject';
  /** Subset members this provider's wire type cannot carry — stripped AND recorded (Gemini: `additionalProperties`). */
  readonly unsupportedMembers: readonly (keyof IParameterSchema)[];
  /** Nesting depth over which a schema is rejected (unbounded complexity). */
  readonly maxDepth: number;
  /** Node count over which a schema is rejected. */
  readonly maxNodes: number;
}

/**
 * `PERMISSIVE`/`STRICT` without a `providerName` — the two profile SHAPES named providers spread
 * their own name onto (`{ ...PERMISSIVE_TOOL_SCHEMA_PROFILE, providerName: 'anthropic' }`).
 */
export type TToolSchemaProjectionProfileBase = Omit<IToolSchemaProjectionProfile, 'providerName'>;

/**
 * Anthropic; OpenAI Chat Completions and Responses without `strictTools`; the openai-compatible
 * family (gemma, qwen incl. its Responses surface, deepseek). Standard JSON Schema passes through —
 * stripping it would be lossy for nothing.
 */
export const PERMISSIVE_TOOL_SCHEMA_PROFILE: TToolSchemaProjectionProfileBase = {
  closedObjects: false,
  requireAllProperties: false,
  optionalAsNullable: false,
  unknownKeywords: 'adopt',
  unsupportedMembers: [],
  maxDepth: TOOL_SCHEMA_PROJECTION_MAX_DEPTH,
  maxNodes: TOOL_SCHEMA_PROJECTION_MAX_NODES,
};

/**
 * OpenAI Responses and Chat Completions with `strictTools: true`. Replaces the converter's own
 * `closeObjectSchemas` call — one closure, in one place.
 */
export const STRICT_TOOL_SCHEMA_PROFILE: TToolSchemaProjectionProfileBase = {
  closedObjects: true,
  requireAllProperties: true,
  optionalAsNullable: true,
  unknownKeywords: 'strip',
  unsupportedMembers: [],
  maxDepth: TOOL_SCHEMA_PROJECTION_MAX_DEPTH,
  maxNodes: TOOL_SCHEMA_PROJECTION_MAX_NODES,
};

export type TToolSchemaProjectionOutcome = 'adopted' | 'adapted' | 'rejected';

export interface IToolSchemaProjectionChange {
  readonly path: string;
  readonly kind:
    | 'closed-object'
    | 'required-added'
    | 'nullable-added'
    | 'keyword-stripped'
    | 'keyword-replaced'
    | 'member-stripped';
  readonly keyword?: string;
}

export interface IToolSchemaProjection {
  readonly outcome: TToolSchemaProjectionOutcome;
  /** adopted: the input (same reference); adapted: the projected copy; rejected: the input. */
  readonly tool: IToolSchema;
  readonly changes: readonly IToolSchemaProjectionChange[];
  readonly rejection?: { readonly path: string; readonly keyword: string; readonly reason: string };
}

interface IRejection {
  readonly path: string;
  readonly keyword: string;
  readonly reason: string;
}

/** JSON-pointer-like path join — `''` at the root, `/properties/foo/items` below it. */
function childPath(path: string, segment: string): string {
  return `${path}/${segment}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The refusal walk (§ Decision, "Refusals"). Depth and node count are counted over the WHOLE graph,
 * not just the branch that eventually fails, so two calls on the same schema agree regardless of
 * which branch a caller happens to look at (determinism).
 */
function findRejection(
  node: unknown,
  path: string,
  depth: number,
  visited: Set<object>,
  counter: { count: number },
  profile: IToolSchemaProjectionProfile,
): IRejection | undefined {
  if (!isPlainRecord(node)) {
    return undefined;
  }
  // `visited` is the ANCESTOR chain, not a whole-graph set: a node is added on entry and removed on
  // exit below, so only a node that appears inside its own subtree (a true cycle) is refused. A DAG —
  // the same sub-schema object reused by two sibling properties or branches, common in hand-built
  // in-process tools — is walked twice and accepted (pr-review-reviewer, MCP-005 Round A).
  if (visited.has(node)) {
    return {
      path,
      keyword: 'cycle',
      reason: 'object graph revisits a node on its own ancestor chain (cycle)',
    };
  }
  visited.add(node);

  if (depth > profile.maxDepth) {
    return {
      path,
      keyword: 'maxDepth',
      reason: `nesting depth exceeds maxDepth (${profile.maxDepth})`,
    };
  }
  counter.count += 1;
  if (counter.count > profile.maxNodes) {
    return {
      path,
      keyword: 'maxNodes',
      reason: `node count exceeds maxNodes (${profile.maxNodes})`,
    };
  }

  // `'reject'` treats ANY foreign keyword as fatal by itself, named ahead of the structural check
  // below so the reported reason names the actual offending keyword rather than the generic
  // type/anyOf shape it happens to also violate.
  if (profile.unknownKeywords === 'reject') {
    for (const key of Object.keys(node)) {
      if (!PARAMETER_SCHEMA_KEYWORD_SET.has(key)) {
        return {
          path,
          keyword: key,
          reason: `unknown keyword '${key}' is outside the IParameterSchema member set`,
        };
      }
    }
  }

  const hasType = typeof node.type === 'string';
  const hasAnyOf = Array.isArray(node.anyOf);
  if (hasType && hasAnyOf) {
    return {
      path,
      keyword: 'anyOf',
      reason: "a node must declare exactly one of 'type' or 'anyOf', not both",
    };
  }
  if (!hasType && !hasAnyOf) {
    // A node whose ONLY structural indicator is a foreign keyword ($ref/oneOf/allOf — ordinary JSON
    // Schema this repo does not model) is not universally refused when the profile has a way to carry
    // it: `'adopt'` passes it through untouched (Anthropic and OpenAI non-strict accept standard JSON
    // Schema), and `'strip'` deletes the keyword and, finding the node then empty, REPLACES it with
    // the accept-anything node rather than losing the declared property. `'reject'` never reaches
    // here for such a node — the scan above already refused it by keyword. A node with NO foreign
    // keyword at all — genuinely empty, or carrying only other subset members — has nothing to defer
    // to and stays universally refused under every policy.
    const hasForeignKey = Object.keys(node).some((key) => !PARAMETER_SCHEMA_KEYWORD_SET.has(key));
    if (!hasForeignKey) {
      return {
        path,
        keyword: 'type',
        reason: "a node must declare exactly one of 'type' or 'anyOf'",
      };
    }
  }

  const properties = node.properties;
  if (isPlainRecord(properties)) {
    for (const key of Object.keys(properties)) {
      if (PROTOTYPE_KEYS.has(key)) {
        return {
          path: childPath(childPath(path, 'properties'), key),
          keyword: key,
          reason: `property name '${key}' is a prototype key`,
        };
      }
    }
    for (const key of Object.keys(properties)) {
      const rejection = findRejection(
        properties[key],
        childPath(childPath(path, 'properties'), key),
        depth + 1,
        visited,
        counter,
        profile,
      );
      if (rejection) return rejection;
    }
  }

  if (isPlainRecord(node.items)) {
    const rejection = findRejection(
      node.items,
      childPath(path, 'items'),
      depth + 1,
      visited,
      counter,
      profile,
    );
    if (rejection) return rejection;
  }

  if (Array.isArray(node.anyOf)) {
    for (let index = 0; index < node.anyOf.length; index += 1) {
      const rejection = findRejection(
        node.anyOf[index],
        childPath(childPath(path, 'anyOf'), String(index)),
        depth + 1,
        visited,
        counter,
        profile,
      );
      if (rejection) return rejection;
    }
  }

  visited.delete(node);
  return undefined;
}

/**
 * The adaptation walk: `unsupportedMembers`, then `unknownKeywords`, at every node; recurses into
 * every route a nested node can arrive by (`properties`, `items`, `anyOf`) so a missed route cannot
 * leave the exact thing this walk exists to fix untouched (the CORE-039 lesson). Closure is NOT done
 * here — it delegates to `closeObjectSchemas` once, afterwards, over the whole result.
 */
function adaptNode(
  node: Record<string, unknown>,
  path: string,
  profile: IToolSchemaProjectionProfile,
  changes: IToolSchemaProjectionChange[],
): Record<string, unknown> {
  const current: Record<string, unknown> = { ...node };

  for (const member of profile.unsupportedMembers) {
    const key = member as string;
    if (key in current) {
      delete current[key];
      changes.push({ path, kind: 'member-stripped', keyword: key });
    }
  }

  if (profile.unknownKeywords === 'strip') {
    const foreign = Object.keys(current).filter((key) => !PARAMETER_SCHEMA_KEYWORD_SET.has(key));
    for (const key of foreign) delete current[key];
    const hasType = typeof current.type === 'string';
    const hasAnyOf = Array.isArray(current.anyOf);
    if (foreign.length > 0 && !hasType && !hasAnyOf) {
      // The node's structural indicator was a foreign keyword ($ref/oneOf/allOf): the node is REPLACED
      // by the accept-anything node, one `keyword-replaced` per foreign keyword. Legitimate members that
      // sat beside it are not lost silently: `description` travels onto the replacement (it constrains
      // nothing); every other survivor is recorded as `member-stripped` so the loss reaches the Schema
      // note (pr-review-reviewer, MCP-005 Round A — the `$ref` + local `description` idiom).
      for (const key of foreign) changes.push({ path, kind: 'keyword-replaced', keyword: key });
      const replacement = anyValueNode() as unknown as Record<string, unknown>;
      for (const key of Object.keys(current)) {
        if (key === 'description') {
          replacement.description = current.description;
        } else {
          changes.push({ path, kind: 'member-stripped', keyword: key });
        }
      }
      return replacement;
    }
    for (const key of foreign) changes.push({ path, kind: 'keyword-stripped', keyword: key });
  }

  const properties = current.properties;
  if (isPlainRecord(properties)) {
    // `Object.fromEntries` — not a manual `record[key] = value` loop — because `key` is an untrusted
    // property NAME. A prototype-key node is refused before this walk ever runs, but `fromEntries`
    // defines every entry as an own property regardless, so this route stays safe even if that
    // ordering ever changes.
    current.properties = Object.fromEntries(
      Object.keys(properties).map((key) => {
        const child = properties[key];
        return [
          key,
          isPlainRecord(child)
            ? adaptNode(child, childPath(childPath(path, 'properties'), key), profile, changes)
            : child,
        ];
      }),
    );
  }

  if (isPlainRecord(current.items)) {
    current.items = adaptNode(current.items, childPath(path, 'items'), profile, changes);
  }

  if (Array.isArray(current.anyOf)) {
    current.anyOf = current.anyOf.map((branch: unknown, index: number) =>
      isPlainRecord(branch)
        ? adaptNode(branch, childPath(childPath(path, 'anyOf'), String(index)), profile, changes)
        : branch,
    );
  }

  return current;
}

/** Canonical, key-sorted JSON — the same schema hashes the same regardless of authored key order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (isPlainRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * A stable hash of a tool's `parameters`, over canonical key-sorted JSON. Part of the `projectTools`
 * per-tool cache identity (`provider.name` + `model` + `tool.name` + this hash) — a re-registered
 * tool whose schema changed is judged and reported again, one whose schema did not is not re-reported
 * on every turn. `node:crypto` only: agent-core stays zero-deps.
 */
export function hashToolSchema(parameters: IParameterSchema): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(parameters)))
    .digest('hex');
}

/**
 * Project one tool's schema into what `profile` can carry. Pure, deterministic (same input → deep-
 * equal output), never throws, never mutates `tool` or `tool.parameters`.
 */
export function projectToolSchema(
  tool: IToolSchema,
  profile: IToolSchemaProjectionProfile,
): IToolSchemaProjection {
  const root: unknown = tool.parameters;
  if (!isPlainRecord(root) || root.type !== 'object') {
    return {
      outcome: 'rejected',
      tool,
      changes: [],
      rejection: {
        path: '',
        keyword: 'type',
        reason:
          "the parameters root must declare type: 'object' — no documented provider accepts another root",
      },
    };
  }

  const rejection = findRejection(root, '', 0, new Set<object>(), { count: 0 }, profile);
  if (rejection) {
    return { outcome: 'rejected', tool, changes: [], rejection };
  }

  const changes: IToolSchemaProjectionChange[] = [];
  const keywordAdapted = adaptNode(root, '', profile, changes);

  const finalParameters = profile.closedObjects
    ? (closeObjectSchemas(keywordAdapted, {
        requireAllProperties: profile.requireAllProperties,
        optionalAsNullable: profile.optionalAsNullable,
        onChange: (change) => changes.push(change),
      }) as IObjectParameterSchema)
    : (keywordAdapted as unknown as IObjectParameterSchema);

  if (changes.length === 0) {
    return { outcome: 'adopted', tool, changes: [] };
  }

  const noteworthy = changes.filter(
    (change) =>
      (change.kind === 'keyword-stripped' ||
        change.kind === 'keyword-replaced' ||
        change.kind === 'member-stripped') &&
      !ANNOTATION_ONLY_KEYWORDS.has(change.keyword ?? ''),
  );

  const description =
    noteworthy.length === 0
      ? tool.description
      : `${tool.description}\n\nSchema note: ${noteworthy.length} constraint(s) not shown to ${profile.providerName}: ${noteworthy
          .map((change) => `${change.kind}@${change.path}`)
          .join(', ')}`;

  return {
    outcome: 'adapted',
    tool: { ...tool, parameters: finalParameters, description },
    changes,
  };
}
