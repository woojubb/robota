/**
 * MCP-005 — the shared tool-schema projector. TC-01, TC-02, TC-03, TC-04, TC-12.
 */

import { describe, expect, it } from 'vitest';

import { loadToolSchemaProjectionFixtures } from '../../testing/tool-schema-projection-fixtures';
import { closeObjectSchemas } from '../close-object-schemas';
import {
  PERMISSIVE_TOOL_SCHEMA_PROFILE,
  STRICT_TOOL_SCHEMA_PROFILE,
  TOOL_SCHEMA_PROJECTION_MAX_DEPTH,
  TOOL_SCHEMA_PROJECTION_MAX_NODES,
  projectToolSchema,
} from '../project-tool-schema';
import { validateAgainstJsonSchema } from '../structured-output';

import type {
  IToolSchemaProjectionProfile,
  TToolSchemaProjectionProfileBase,
} from '../project-tool-schema';
import type {
  IObjectParameterSchema,
  IParameterSchema,
  IToolSchema,
} from '../../interfaces/tool-schema';

const fixtures = loadToolSchemaProjectionFixtures();

function profile(
  base: TToolSchemaProjectionProfileBase,
  providerName: string,
  overrides: Partial<IToolSchemaProjectionProfile> = {},
): IToolSchemaProjectionProfile {
  return { ...base, providerName, ...overrides };
}

const PERMISSIVE = profile(PERMISSIVE_TOOL_SCHEMA_PROFILE, 'permissive-test');
const STRICT = profile(STRICT_TOOL_SCHEMA_PROFILE, 'strict-test');
const GEMINI_SHAPED = profile(PERMISSIVE_TOOL_SCHEMA_PROFILE, 'gemini-test', {
  unknownKeywords: 'strip',
  unsupportedMembers: ['additionalProperties'],
});
// `unknownKeywords: 'strip'` WITHOUT the closure family — isolates the keyword matrix from
// `closeObjectSchemas`'s own `required`/`nullable` wrapping (TC-04's territory), which would
// otherwise wrap every optional property in `anyOf: [T, null]` and hide the assertions below.
const STRIP_ONLY = profile(PERMISSIVE_TOOL_SCHEMA_PROFILE, 'strip-only-test', {
  unknownKeywords: 'strip',
});

/** Sort a `changes` array for order-INSENSITIVE comparison (traversal order follows key order). */
function sortedChanges(
  changes: readonly { path: string; kind: string; keyword?: string }[],
): { path: string; kind: string; keyword?: string }[] {
  return [...changes].sort((a, b) =>
    `${a.path}|${a.kind}|${a.keyword ?? ''}`.localeCompare(
      `${b.path}|${b.kind}|${b.keyword ?? ''}`,
    ),
  );
}

/**
 * Sort object keys and every `required` array (a SET per JSON Schema — its own order carries no
 * meaning) so a value built from permuted input keys compares equal to one built from the original
 * order. `closeObjectSchemas` derives `required` from `Object.keys(properties)`, so its element
 * order legitimately follows input key order; that is not a determinism defect.
 */
function canonicalizeForComparison(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeForComparison);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const child = canonicalizeForComparison(record[key]);
      sorted[key] = key === 'required' && Array.isArray(child) ? [...child].sort() : child;
    }
    return sorted;
  }
  return value;
}

describe('MCP-005 TC-01 — determinism, immutability, adopted', () => {
  it('a subset-only schema projects adopted with changes: [] and tool deep-equal to the input', () => {
    const projection = projectToolSchema(fixtures.subsetOnly, PERMISSIVE);
    expect(projection.outcome).toBe('adopted');
    expect(projection.changes).toEqual([]);
    expect(projection.tool).toBe(fixtures.subsetOnly);
    expect(projection.tool).toEqual(fixtures.subsetOnly);
  });

  it('two calls on structurally equal inputs (including key order permuted) return deep-equal outputs', () => {
    // Same content, keys reinserted in reverse order at every level — a real permutation, not a copy
    // that happens to preserve insertion order.
    const reversedProperties = Object.fromEntries(
      Object.entries(fixtures.subsetOnly.parameters.properties).reverse(),
    );
    const permuted: IToolSchema = {
      description: fixtures.subsetOnly.description,
      name: fixtures.subsetOnly.name,
      parameters: {
        required: [...fixtures.subsetOnly.parameters.required!],
        type: 'object',
        properties: reversedProperties,
      },
    };

    const a = projectToolSchema(fixtures.subsetOnly, STRICT);
    const b = projectToolSchema(permuted, STRICT);
    expect(a.outcome).toBe(b.outcome);
    expect(sortedChanges(a.changes)).toEqual(sortedChanges(b.changes));
    expect(canonicalizeForComparison(a.tool)).toEqual(canonicalizeForComparison(b.tool));

    // Determinism within a single input too: repeated calls agree.
    const c = projectToolSchema(fixtures.subsetOnly, STRICT);
    expect(a).toEqual(c);
  });

  it('never mutates the input object', () => {
    const before = JSON.parse(JSON.stringify(fixtures.subsetOnly));
    projectToolSchema(fixtures.subsetOnly, STRICT);
    expect(fixtures.subsetOnly).toEqual(before);
  });
});

describe('MCP-005 TC-02 — refusals', () => {
  it('a non-object root is rejected', () => {
    const projection = projectToolSchema(fixtures.rootAnyOf, PERMISSIVE);
    expect(projection.outcome).toBe('rejected');
    expect(projection.rejection?.path).toBe('');
    expect(projection.rejection?.reason).toMatch(/object/i);
  });

  it("a node declaring both 'type' and 'anyOf' is rejected", () => {
    const tool: IToolSchema = {
      name: 'both',
      description: 'd',
      parameters: {
        type: 'object',
        properties: {
          bad: { type: 'string', anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        required: [],
      },
    };
    const projection = projectToolSchema(tool, PERMISSIVE);
    expect(projection.outcome).toBe('rejected');
    expect(projection.rejection?.path).toBe('/properties/bad');
  });

  it("a node declaring neither 'type' nor 'anyOf' (and no foreign keyword to strip) is rejected", () => {
    const tool: IToolSchema = {
      name: 'neither',
      description: 'd',
      parameters: {
        type: 'object',
        properties: { bad: {} as IParameterSchema },
        required: [],
      },
    };
    const projection = projectToolSchema(tool, PERMISSIVE);
    expect(projection.outcome).toBe('rejected');
    expect(projection.rejection?.path).toBe('/properties/bad');
  });

  it('a property named as a prototype key is rejected', () => {
    const projection = projectToolSchema(fixtures.prototypeKey, PERMISSIVE);
    expect(projection.outcome).toBe('rejected');
    expect(projection.rejection?.path).toBe('/properties/__proto__');
    expect(projection.rejection?.keyword).toBe('__proto__');
  });

  it('an object graph with a cycle is rejected', () => {
    const cyclic: Record<string, unknown> = { type: 'object', properties: {}, required: [] };
    (cyclic.properties as Record<string, unknown>).self = cyclic;
    const tool: IToolSchema = {
      name: 'cyclic',
      description: 'd',
      parameters: cyclic as unknown as IObjectParameterSchema,
    };
    const projection = projectToolSchema(tool, PERMISSIVE);
    expect(projection.outcome).toBe('rejected');
    expect(projection.rejection?.keyword).toBe('cycle');
  });

  it('a DAG — the same sub-schema object reused by two sibling properties — is NOT a cycle (Round A MUST-1)', () => {
    const emailSchema = { type: 'string', format: 'email' };
    const tool: IToolSchema = {
      name: 'dag',
      description: 'd',
      parameters: {
        type: 'object',
        properties: { primaryEmail: emailSchema, secondaryEmail: emailSchema },
        required: [],
      } as unknown as IObjectParameterSchema,
    };
    const projection = projectToolSchema(tool, PERMISSIVE);
    expect(projection.outcome).toBe('adopted');
    expect(projection.rejection).toBeUndefined();
  });

  it('nesting deeper than maxDepth is rejected', () => {
    const projection = projectToolSchema(fixtures.deepNesting, PERMISSIVE);
    expect(projection.outcome).toBe('rejected');
    expect(projection.rejection?.reason).toMatch(/maxDepth/i);
  });

  it('a schema with more than maxNodes nodes is rejected', () => {
    const projection = projectToolSchema(fixtures.oversized, PERMISSIVE);
    expect(projection.outcome).toBe('rejected');
    expect(projection.rejection?.reason).toMatch(/maxNodes/i);
  });

  it('never throws across the fixture set', () => {
    const allFixtures = [
      fixtures.subsetOnly,
      fixtures.rootAnyOf,
      fixtures.nestedAnyOfOptional,
      fixtures.unknownKeywords,
      fixtures.prototypeKey,
      fixtures.deepNesting,
      fixtures.oversized,
      fixtures.arrayItemsObject,
      ...fixtures.oneInvalidAmongMany,
    ];
    for (const tool of allFixtures) {
      for (const candidate of [PERMISSIVE, STRICT, GEMINI_SHAPED]) {
        expect(() => projectToolSchema(tool, candidate)).not.toThrow();
      }
    }
  });
});

describe('MCP-005 TC-03 — unknownKeywords matrix', () => {
  it("'adopt' passes annotation and structural-validation keys through unchanged", () => {
    const projection = projectToolSchema(fixtures.unknownKeywords, PERMISSIVE);
    expect(projection.outcome).toBe('adopted');
    expect(projection.tool).toBe(fixtures.unknownKeywords);
  });

  it("'strip' removes an annotation key with one keyword-stripped change per path", () => {
    const projection = projectToolSchema(fixtures.unknownKeywords, STRIP_ONLY);
    expect(projection.outcome).toBe('adapted');
    const titleChange = projection.changes.find(
      (change) => change.path === '/properties/annotated' && change.keyword === 'title',
    );
    expect(titleChange).toEqual({
      path: '/properties/annotated',
      kind: 'keyword-stripped',
      keyword: 'title',
    });
    const parameters = projection.tool.parameters as IObjectParameterSchema;
    const annotated = parameters.properties.annotated as Record<string, unknown>;
    expect(annotated.title).toBeUndefined();
    expect(annotated.$schema).toBeUndefined();
    expect(annotated.$comment).toBeUndefined();
    expect(annotated.examples).toBeUndefined();
    expect(annotated.type).toBe('string');
  });

  it("'strip' replaces a node that was only $ref/oneOf/allOf with the accept-anything anyOf node", () => {
    const projection = projectToolSchema(fixtures.unknownKeywords, STRIP_ONLY);
    const parameters = projection.tool.parameters as IObjectParameterSchema;

    for (const key of ['refOnly', 'oneOfOnly', 'allOfOnly']) {
      const change = projection.changes.find(
        (candidate) =>
          candidate.path === `/properties/${key}` && candidate.kind === 'keyword-replaced',
      );
      expect(change, `expected a keyword-replaced change for ${key}`).toBeDefined();
      const node = parameters.properties[key] as IParameterSchema;
      expect(node.type).toBeUndefined();
      expect(Array.isArray(node.anyOf)).toBe(true);
    }
  });

  it("'strip' strips $defs/patternProperties on a typed node and keeps its type and properties", () => {
    const projection = projectToolSchema(fixtures.unknownKeywords, STRIP_ONLY);
    const parameters = projection.tool.parameters as IObjectParameterSchema;

    const patternMapChange = projection.changes.find(
      (change) =>
        change.path === '/properties/patternMap' && change.keyword === 'patternProperties',
    );
    expect(patternMapChange?.kind).toBe('keyword-stripped');
    const patternMap = parameters.properties.patternMap as IParameterSchema;
    expect(patternMap.type).toBe('object');
    expect(patternMap.properties).toBeDefined();

    const withDefsChange = projection.changes.find(
      (change) => change.path === '/properties/withDefs' && change.keyword === '$defs',
    );
    expect(withDefsChange?.kind).toBe('keyword-stripped');
    const withDefs = parameters.properties.withDefs as IParameterSchema;
    expect(withDefs.type).toBe('object');
    expect(withDefs.properties).toBeDefined();
  });

  it("'reject' names the first offending path", () => {
    const rejectProfile = profile(PERMISSIVE_TOOL_SCHEMA_PROFILE, 'reject-test', {
      unknownKeywords: 'reject',
    });
    const projection = projectToolSchema(fixtures.unknownKeywords, rejectProfile);
    expect(projection.outcome).toBe('rejected');
    // `refOnly` (the `$ref`-only property) is the first property in document order.
    expect(projection.rejection?.path).toBe('/properties/refOnly');
    expect(projection.rejection?.keyword).toBe('$ref');
    expect(projection.rejection?.reason).toMatch(/unknown keyword/);
  });

  it('unsupportedMembers strips every occurrence with one member-stripped change each', () => {
    const tool: IToolSchema = {
      name: 'members',
      description: 'd',
      parameters: {
        type: 'object',
        properties: {
          nested: {
            type: 'object',
            properties: { x: { type: 'string' } },
            required: [],
            additionalProperties: true,
          },
        },
        required: [],
        additionalProperties: false,
      },
    };
    const projection = projectToolSchema(tool, GEMINI_SHAPED);
    expect(projection.outcome).toBe('adapted');
    const memberChanges = projection.changes.filter((change) => change.kind === 'member-stripped');
    expect(memberChanges).toEqual(
      expect.arrayContaining([
        { path: '', kind: 'member-stripped', keyword: 'additionalProperties' },
        { path: '/properties/nested', kind: 'member-stripped', keyword: 'additionalProperties' },
      ]),
    );
    const parameters = projection.tool.parameters as unknown as Record<string, unknown>;
    expect(parameters.additionalProperties).toBeUndefined();
  });
});

describe('MCP-005 — strip never loses co-located members silently (Round A MUST-2)', () => {
  it('a $ref node with a local description is replaced, keeps the description, and records every other survivor', () => {
    const tool: IToolSchema = {
      name: 'ref-with-description',
      description: 'd',
      parameters: {
        type: 'object',
        properties: {
          account: { $ref: '#/$defs/Account', description: 'The account to use', enum: ['a', 'b'] },
        },
        required: [],
      } as unknown as IObjectParameterSchema,
    };
    const projection = projectToolSchema(tool, { ...STRICT, providerName: 'test' });
    expect(projection.outcome).toBe('adapted');
    const account = (
      projection.tool.parameters.properties as Record<string, Record<string, unknown>>
    ).account;
    expect(Array.isArray(account.anyOf)).toBe(true);
    expect(account.description).toBe('The account to use');
    expect(account.$ref).toBeUndefined();
    const atPath = projection.changes.filter((c) => c.path === '/properties/account');
    expect(atPath).toEqual(
      expect.arrayContaining([
        { path: '/properties/account', kind: 'keyword-replaced', keyword: '$ref' },
        { path: '/properties/account', kind: 'member-stripped', keyword: 'enum' },
      ]),
    );
    expect(atPath.some((c) => c.keyword === 'description')).toBe(false);
    expect(projection.tool.description).toContain('Schema note:');
  });
});

describe('MCP-005 TC-04 — closure family and the Schema note', () => {
  it('the projected parameters deep-equal closeObjectSchemas with the same options', () => {
    const projection = projectToolSchema(fixtures.subsetOnly, STRICT);
    const expected = closeObjectSchemas(fixtures.subsetOnly.parameters, {
      requireAllProperties: true,
      optionalAsNullable: true,
    });
    expect(projection.tool.parameters).toEqual(expected);
  });

  it('changes lists one entry per closed object / added required / nullable property', () => {
    const projection = projectToolSchema(fixtures.subsetOnly, STRICT);
    expect(projection.changes.some((change) => change.kind === 'closed-object')).toBe(true);
    expect(projection.changes.some((change) => change.kind === 'required-added')).toBe(true);
  });

  it('closure never produces a Schema note — description is byte-identical to the input', () => {
    const projection = projectToolSchema(fixtures.subsetOnly, STRICT);
    expect(projection.tool.description).toBe(fixtures.subsetOnly.description);
  });

  it('a lossy strip/replace ends the description with exactly one Schema note paragraph', () => {
    const projection = projectToolSchema(fixtures.unknownKeywords, STRICT);
    expect(projection.outcome).toBe('adapted');
    expect(projection.tool.description.startsWith(fixtures.unknownKeywords.description)).toBe(true);
    const noteOccurrences = projection.tool.description.split('Schema note:').length - 1;
    expect(noteOccurrences).toBe(1);
    expect(projection.tool.description).toContain(`not shown to ${STRICT.providerName}`);
    // minLength is a validation keyword, so it is named in the note.
    expect(projection.tool.description).toMatch(/keyword-stripped@\/properties\/shortText/);
  });

  it('a projection that stripped only annotations has a description byte-identical to the input', () => {
    const tool: IToolSchema = {
      name: 'annotations_only',
      description: 'Only annotations here.',
      parameters: {
        type: 'object',
        properties: {
          field: {
            type: 'string',
            title: 'Field',
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            examples: ['abc'],
          } as IParameterSchema,
        },
        required: ['field'],
      },
    };
    const stripAnnotationsOnly = profile(PERMISSIVE_TOOL_SCHEMA_PROFILE, 'annotations-test', {
      unknownKeywords: 'strip',
    });
    const projection = projectToolSchema(tool, stripAnnotationsOnly);
    expect(projection.outcome).toBe('adapted');
    expect(projection.changes.length).toBeGreaterThan(0);
    expect(projection.tool.description).toBe(tool.description);
  });
});

describe('MCP-005 TC-12 — seeded fuzz generator', () => {
  function createLcg(seed: number): () => number {
    let state = seed >>> 0;
    return (): number => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0xffffffff;
    };
  }

  function pick<T>(rng: () => number, items: readonly T[]): T {
    const index = Math.min(items.length - 1, Math.floor(rng() * items.length));
    return items[index] as T;
  }

  interface IGeneratedNode {
    schema: Record<string, unknown>;
    example: unknown;
    /** Whether this subtree contains a `$ref`/`oneOf`/`allOf`-only node. */
    hasStructuralOnlyNode: boolean;
  }

  function generateLeaf(rng: () => number): IGeneratedNode {
    const kind = pick(rng, ['string', 'number', 'integer', 'boolean'] as const);
    const schema: Record<string, unknown> = { type: kind };
    if (rng() < 0.3) schema.title = 'generated title';
    if (rng() < 0.2) schema.minLength = 1;
    const example = kind === 'string' ? 'x' : kind === 'boolean' ? true : 1;
    return { schema, example, hasStructuralOnlyNode: false };
  }

  function generateNode(rng: () => number, depth: number, maxDepth: number): IGeneratedNode {
    if (depth < maxDepth && rng() < 0.1) {
      const kind = pick(rng, ['$ref', 'oneOf', 'allOf'] as const);
      const schema: Record<string, unknown> =
        kind === '$ref' ? { $ref: '#/$defs/x' } : { [kind]: [{ type: 'string' }] };
      return { schema, example: 'structural-placeholder', hasStructuralOnlyNode: true };
    }
    if (depth < maxDepth && rng() < 0.3) {
      return generateObject(rng, depth, maxDepth);
    }
    if (depth < maxDepth && rng() < 0.15) {
      const item = generateNode(rng, depth + 1, maxDepth);
      return {
        schema: { type: 'array', items: item.schema },
        example: [item.example],
        hasStructuralOnlyNode: item.hasStructuralOnlyNode,
      };
    }
    if (rng() < 0.15) {
      const branches = [generateLeaf(rng), generateLeaf(rng)];
      return {
        schema: { anyOf: branches.map((branch) => branch.schema) },
        example: branches[0].example,
        hasStructuralOnlyNode: false,
      };
    }
    return generateLeaf(rng);
  }

  function generateObject(rng: () => number, depth: number, maxDepth: number): IGeneratedNode {
    const propertyCount = 1 + Math.floor(rng() * 3);
    const properties: Record<string, unknown> = {};
    const example: Record<string, unknown> = {};
    const required: string[] = [];
    let hasStructuralOnlyNode = false;
    for (let index = 0; index < propertyCount; index += 1) {
      const key = `p${depth}_${index}`;
      const child = generateNode(rng, depth + 1, maxDepth);
      properties[key] = child.schema;
      example[key] = child.example;
      hasStructuralOnlyNode = hasStructuralOnlyNode || child.hasStructuralOnlyNode;
      if (rng() < 0.6) required.push(key);
    }
    const schema: Record<string, unknown> = { type: 'object', properties, required };
    if (rng() < 0.2) schema.additionalProperties = true;
    if (rng() < 0.1) schema.patternProperties = { '^x-': { type: 'string' } };
    return { schema, example, hasStructuralOnlyNode };
  }

  function generateCase(rng: () => number): {
    tool: IToolSchema;
    example: unknown;
    hasStructuralOnlyNode: boolean;
  } {
    const maxDepth = 3 + Math.floor(rng() * 40);
    const generated = generateObject(rng, 0, maxDepth);
    const schema = generated.schema;
    const properties = schema.properties as Record<string, unknown>;

    const mutationRoll = rng();
    let parameters: unknown = schema;
    if (mutationRoll < 0.06) {
      // Non-object root — universal rejection.
      parameters = { anyOf: [schema, { type: 'string' }] };
    } else if (mutationRoll < 0.12) {
      // A prototype-key property name. Assigning `properties['__proto__'] = …` on an already-built
      // object would invoke `Object.prototype`'s inherited `__proto__` ACCESSOR and silently change
      // the object's prototype instead of creating an own property (verified empirically) —
      // `defineProperty` is the one way to get the same own-property shape `JSON.parse` produces.
      Object.defineProperty(properties, '__proto__', {
        value: { type: 'string' },
        enumerable: true,
        writable: true,
        configurable: true,
      });
    } else if (mutationRoll < 0.16) {
      // Over every shipped profile's maxNodes.
      for (let index = 0; index < TOOL_SCHEMA_PROJECTION_MAX_NODES + 50; index += 1) {
        properties[`pad_${index}`] = { type: 'string' };
      }
    }

    return {
      tool: {
        name: 'fuzz_tool',
        description: 'generated',
        parameters: parameters as IObjectParameterSchema,
      },
      example: generated.example,
      hasStructuralOnlyNode: generated.hasStructuralOnlyNode,
    };
  }

  it('500 seeded cases × PERMISSIVE/STRICT/Gemini-shaped: closed outcome set, no throw, subset-valid output', () => {
    const rng = createLcg(0x5eed_1234);
    const profiles = [PERMISSIVE, STRICT, GEMINI_SHAPED];
    let sawAdopted = false;
    let sawAdapted = false;
    let sawRejected = false;

    for (let caseIndex = 0; caseIndex < 500; caseIndex += 1) {
      const { tool, example, hasStructuralOnlyNode } = generateCase(rng);
      for (const candidate of profiles) {
        let projection;
        expect(() => {
          projection = projectToolSchema(tool, candidate);
        }).not.toThrow();
        expect(['adopted', 'adapted', 'rejected']).toContain(projection!.outcome);

        if (projection!.outcome === 'adopted') sawAdopted = true;
        if (projection!.outcome === 'adapted') sawAdapted = true;
        if (projection!.outcome === 'rejected') {
          sawRejected = true;
          expect(projection!.rejection?.path).toBeDefined();
          expect(projection!.rejection?.keyword).toBeDefined();
          expect(projection!.rejection?.reason).toBeDefined();
          continue;
        }

        // `'adopt'` passes a `$ref`/`oneOf`/`allOf`-only node through UNCHANGED (§ Decision) — such a
        // node has neither `type` nor `anyOf`, which `validateAgainstJsonSchema` itself refuses to
        // validate against by construction, independent of projection. `'strip'` REPLACES that same
        // node with the accept-anything `anyOf` node, which IS subset-valid, so the assertion still
        // applies (and is exercised) for STRICT and Gemini-shaped.
        if (candidate.unknownKeywords === 'adopt' && hasStructuralOnlyNode) {
          continue;
        }

        const issues = validateAgainstJsonSchema(
          projection!.tool.parameters as IObjectParameterSchema,
          example,
          '$',
        );
        expect(issues, JSON.stringify({ tool: projection!.tool, example })).toEqual([]);
      }
    }

    expect(sawAdopted || sawAdapted).toBe(true);
    expect(sawRejected).toBe(true);
  });
});

// Depth ceiling sanity: the shared constant must match what every shipped profile declares.
describe('MCP-005 — shared ceilings', () => {
  it('PERMISSIVE and STRICT share the same depth/node ceilings', () => {
    expect(PERMISSIVE_TOOL_SCHEMA_PROFILE.maxDepth).toBe(TOOL_SCHEMA_PROJECTION_MAX_DEPTH);
    expect(STRICT_TOOL_SCHEMA_PROFILE.maxDepth).toBe(TOOL_SCHEMA_PROJECTION_MAX_DEPTH);
    expect(PERMISSIVE_TOOL_SCHEMA_PROFILE.maxNodes).toBe(TOOL_SCHEMA_PROJECTION_MAX_NODES);
    expect(STRICT_TOOL_SCHEMA_PROFILE.maxNodes).toBe(TOOL_SCHEMA_PROJECTION_MAX_NODES);
  });
});
