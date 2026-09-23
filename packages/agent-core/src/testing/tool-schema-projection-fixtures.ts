/**
 * Shared tool-schema-projection fixtures (MCP-005) — one schema shape per named case, so agent-core's
 * own projector tests and every provider's conformance test (S2) exercise IDENTICAL inputs.
 *
 * Exported from the `./testing` subpath (TEST-003 precedent: `createScriptedProvider` lives the same
 * way) rather than from a `__tests__` directory: `scan-package-boundary-ownership` refuses a
 * cross-package import that reaches another package's private tree, and `__tests__` is exactly that.
 * A provider package's conformance test imports `loadToolSchemaProjectionFixtures` from
 * `@robota-sdk/agent-core/testing`.
 *
 * Most shapes are authored as JSON fixtures under
 * `../schema/__tests__/fixtures/tool-schema-projection/` and imported statically here — a bundler's
 * JSON loader inlines the parsed value into this module at build time, so the compiled `./testing`
 * entry carries the data with no external asset to copy. `prototypeKey` and `oversized` are the two
 * exceptions, built programmatically below (see each function's comment for why).
 */
import arrayItemsObjectFixture from '../schema/__tests__/fixtures/tool-schema-projection/array-items-object.json';
import deepNestingFixture from '../schema/__tests__/fixtures/tool-schema-projection/deep-nesting.json';
import nestedAnyOfOptionalFixture from '../schema/__tests__/fixtures/tool-schema-projection/nested-anyof-optional.json';
import oneInvalidAmongManyFixture from '../schema/__tests__/fixtures/tool-schema-projection/one-invalid-among-many.json';
import rootAnyOfFixture from '../schema/__tests__/fixtures/tool-schema-projection/root-anyof.json';
import subsetOnlyFixture from '../schema/__tests__/fixtures/tool-schema-projection/subset-only.json';
import unknownKeywordsFixture from '../schema/__tests__/fixtures/tool-schema-projection/unknown-keywords.json';
import { TOOL_SCHEMA_PROJECTION_MAX_NODES } from '../schema/project-tool-schema';

import type { IToolSchema } from '../interfaces/tool-schema';

/**
 * A property literally named `__proto__`, exactly as a parsed third-party schema could carry it.
 *
 * NOT loaded via a static JSON import: a bundler's JSON loader inlines the parsed value as an object
 * LITERAL, and a literal property written `"__proto__": value` (quoted or not) triggers the
 * ECMAScript `[[SetPrototypeOf]]` special case (Annex B.3.1) instead of creating an own property —
 * the opposite of what `JSON.parse` does for the same text over the wire (verified empirically: a
 * fixture authored as `prototype-key.json` and statically imported lost the property entirely). A
 * COMPUTED key (`['__proto__']`) is the one object-literal spelling that is not special-cased, so
 * this one fixture is authored directly in TypeScript instead of as JSON.
 */
function buildPrototypeKeyFixture(): IToolSchema {
  return {
    name: 'malicious_property_name',
    description:
      'A property named as a prototype key — reachable from a parsed third-party schema.',
    parameters: {
      type: 'object',
      properties: {
        safe: { type: 'string' },
        ['__proto__']: { type: 'string' },
      },
      required: ['safe'],
    },
  };
}

/**
 * More leaf properties than any shipped profile's `maxNodes` ceiling — generated here rather than
 * stored as a multi-thousand-line JSON file nobody would review line by line.
 */
function buildOversizedFixture(): IToolSchema {
  const properties: Record<string, { type: 'string' }> = {};
  const propertyCount = TOOL_SCHEMA_PROJECTION_MAX_NODES + 500;
  for (let index = 0; index < propertyCount; index += 1) {
    properties[`field_${index}`] = { type: 'string' };
  }
  return {
    name: 'oversized_tool',
    description: "A schema with more nodes than any shipped profile's maxNodes ceiling.",
    parameters: { type: 'object', properties, required: [] },
  };
}

/** The named tool-schema-projection fixture set (MCP-005). Treat every value as read-only. */
export interface IToolSchemaProjectionFixtures {
  /** Only members of the `IParameterSchema` subset — projects `adopted` under every profile. */
  readonly subsetOnly: IToolSchema;
  /** `parameters` is a root union, not `type: 'object'` — universal rejection. */
  readonly rootAnyOf: IToolSchema;
  /** A nested (non-root) optional `anyOf` that already admits `null` — legitimate union usage. */
  readonly nestedAnyOfOptional: IToolSchema;
  /** `$ref`/`oneOf`/`allOf`-only nodes, annotations, `patternProperties`, `$defs`, `minLength`. */
  readonly unknownKeywords: IToolSchema;
  /** A property named `__proto__` — refused before any spread. */
  readonly prototypeKey: IToolSchema;
  /** Nested 40 levels deep — over every shipped profile's `maxDepth` (32). */
  readonly deepNesting: IToolSchema;
  /** Over every shipped profile's `maxNodes` (2000). */
  readonly oversized: IToolSchema;
  /** An array property whose `items` is an object schema. */
  readonly arrayItemsObject: IToolSchema;
  /** Three tools; the middle one is a root-union rejection — per-tool quarantine, not a whole-request failure. */
  readonly oneInvalidAmongMany: readonly IToolSchema[];
}

/** The shared MCP-005 fixture set. Returns the same underlying values on every call — do not mutate them. */
export function loadToolSchemaProjectionFixtures(): IToolSchemaProjectionFixtures {
  return {
    subsetOnly: subsetOnlyFixture as unknown as IToolSchema,
    rootAnyOf: rootAnyOfFixture as unknown as IToolSchema,
    nestedAnyOfOptional: nestedAnyOfOptionalFixture as unknown as IToolSchema,
    unknownKeywords: unknownKeywordsFixture as unknown as IToolSchema,
    prototypeKey: buildPrototypeKeyFixture(),
    deepNesting: deepNestingFixture as unknown as IToolSchema,
    oversized: buildOversizedFixture(),
    arrayItemsObject: arrayItemsObjectFixture as unknown as IToolSchema,
    oneInvalidAmongMany: oneInvalidAmongManyFixture as unknown as IToolSchema[],
  };
}
