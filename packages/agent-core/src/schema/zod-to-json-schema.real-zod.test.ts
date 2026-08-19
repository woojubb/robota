import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { validateAgainstJsonSchema } from './structured-output';
import { zodToJsonSchema } from './zod-to-json-schema';

import type { IZodSchema } from './zod-schema-types';

/**
 * CORE-039 — converter tests against REAL Zod.
 *
 * The sibling suite (`zod-to-json-schema.test.ts`) builds `_def` objects by hand. That is why a
 * defect this severe passed twenty green tests: a mock can only reproduce the shape its author
 * already had in mind, and nobody had a nested object in mind. These cases go through Zod itself,
 * so the converter is measured against what consumers actually pass it.
 *
 * `IZodSchema` is the structural stand-in the converter accepts; real Zod schemas satisfy it
 * structurally but TypeScript does not know that, hence the boundary cast.
 */
const asZod = (schema: unknown): IZodSchema => schema as IZodSchema;

describe('zodToJsonSchema with real Zod — nested objects', () => {
  it("keeps a nested object's properties and required list", () => {
    const result = zodToJsonSchema(
      asZod(
        z.object({
          report: z.object({ score: z.number(), notes: z.array(z.string()) }),
        }),
      ),
    );

    const report = result.properties['report'];
    expect(report?.type).toBe('object');
    expect(Object.keys(report?.properties ?? {})).toEqual(['score', 'notes']);
    expect(report?.properties?.['score']?.type).toBe('number');
    expect(report?.properties?.['notes']?.items?.type).toBe('string');
    expect(report?.required).toEqual(['score', 'notes']);
  });

  it('keeps the shape two levels down', () => {
    const result = zodToJsonSchema(
      asZod(z.object({ a: z.object({ b: z.object({ c: z.string() }) }) })),
    );

    expect(result.properties['a']?.properties?.['b']?.properties?.['c']?.type).toBe('string');
    expect(result.properties['a']?.properties?.['b']?.required).toEqual(['c']);
  });

  it("omits an optional nested field from that object's own required list", () => {
    const result = zodToJsonSchema(
      asZod(z.object({ outer: z.object({ kept: z.string(), maybe: z.string().optional() }) })),
    );

    const outer = result.properties['outer'];
    expect(Object.keys(outer?.properties ?? {})).toEqual(['kept', 'maybe']);
    expect(outer?.required).toEqual(['kept']);
    expect(outer?.properties?.['maybe']?.type).toBe('string');
  });

  it('keeps the item shape of an array of objects', () => {
    const result = zodToJsonSchema(
      asZod(z.object({ points: z.array(z.object({ x: z.number(), y: z.number() })) })),
    );

    const items = result.properties['points']?.items;
    expect(items?.type).toBe('object');
    expect(Object.keys(items?.properties ?? {})).toEqual(['x', 'y']);
    expect(items?.required).toEqual(['x', 'y']);
  });

  it("carries a nested object's description", () => {
    const result = zodToJsonSchema(
      asZod(z.object({ inner: z.object({ v: z.string() }).describe('the inner block') })),
    );

    expect(result.properties['inner']?.description).toBe('the inner block');
    expect(result.properties['inner']?.properties?.['v']?.type).toBe('string');
  });
});

describe('zodToJsonSchema with real Zod — unknown-key modes', () => {
  it('emits additionalProperties true for the default strip mode', () => {
    // Zod's default is `strip`: extra keys are ACCEPTED at the boundary and then dropped. Emitting
    // nothing here would read as "closed" to every consumer of the subset.
    const result = zodToJsonSchema(asZod(z.object({ a: z.string() })));
    expect(result.additionalProperties).toBe(true);
  });

  it('emits additionalProperties false for strict', () => {
    const result = zodToJsonSchema(asZod(z.object({ a: z.string() }).strict()));
    expect(result.additionalProperties).toBe(false);
  });

  it('emits additionalProperties true for passthrough', () => {
    const result = zodToJsonSchema(asZod(z.object({ a: z.string() }).passthrough()));
    expect(result.additionalProperties).toBe(true);
  });

  it('applies the same three modes to a NESTED object', () => {
    const result = zodToJsonSchema(
      asZod(
        z.object({
          strip: z.object({ a: z.string() }),
          strict: z.object({ a: z.string() }).strict(),
          open: z.object({ a: z.string() }).passthrough(),
        }),
      ),
    );

    expect(result.properties['strip']?.additionalProperties).toBe(true);
    expect(result.properties['strict']?.additionalProperties).toBe(false);
    expect(result.properties['open']?.additionalProperties).toBe(true);
  });
});

describe('zodToJsonSchema with real Zod — unions and literals', () => {
  it('emits anyOf for a union, and no type beside it', () => {
    const result = zodToJsonSchema(
      asZod(z.object({ choice: z.union([z.string(), z.object({ label: z.string() })]) })),
    );

    const choice = result.properties['choice'];
    expect(choice?.anyOf).toHaveLength(2);
    // A node carrying both `anyOf` and `type` is invalid JSON Schema: the provider applies the two
    // together and rejects whichever branch does not match the type.
    expect(choice?.type).toBeUndefined();
    expect(choice?.anyOf?.[0]?.type).toBe('string');
    expect(choice?.anyOf?.[1]?.properties?.['label']?.type).toBe('string');
  });

  it('emits anyOf for a discriminated union with literal discriminators', () => {
    const result = zodToJsonSchema(
      asZod(
        z.object({
          mode: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('fast'), ms: z.number() }),
            z.object({ kind: z.literal('safe'), retries: z.number() }),
          ]),
        }),
      ),
    );

    const branches = result.properties['mode']?.anyOf;
    expect(branches).toHaveLength(2);
    expect(branches?.[0]?.properties?.['kind']?.enum).toEqual(['fast']);
    expect(branches?.[1]?.properties?.['kind']?.enum).toEqual(['safe']);
    expect(branches?.[0]?.properties?.['ms']?.type).toBe('number');
  });

  it('emits a literal as a single-value enum of its own primitive type', () => {
    const result = zodToJsonSchema(
      asZod(z.object({ s: z.literal('x'), n: z.literal(3), b: z.literal(true) })),
    );

    expect(result.properties['s']).toMatchObject({ type: 'string', enum: ['x'] });
    expect(result.properties['n']).toMatchObject({ type: 'number', enum: [3] });
    expect(result.properties['b']).toMatchObject({ type: 'boolean', enum: [true] });
  });

  it('reaches a union nested inside an array inside an object', () => {
    // The exact shape shipped by the AskUserQuestion built-in, which is why the naive fix crashed
    // the tools package at import time.
    const result = zodToJsonSchema(
      asZod(
        z.object({
          questions: z.array(
            z.object({
              question: z.string(),
              options: z.array(z.union([z.string(), z.object({ label: z.string() })])).optional(),
            }),
          ),
        }),
      ),
    );

    const item = result.properties['questions']?.items;
    expect(item?.required).toEqual(['question']);
    expect(item?.properties?.['options']?.items?.anyOf).toHaveLength(2);
  });
});

describe('zodToJsonSchema with real Zod — effects and rejected roots', () => {
  it('converts a refined root instead of silently emitting an empty schema', () => {
    const result = zodToJsonSchema(
      asZod(z.object({ a: z.string(), b: z.string() }).refine((v) => v.a !== v.b)),
    );

    expect(Object.keys(result.properties)).toEqual(['a', 'b']);
    expect(result.required).toEqual(['a', 'b']);
  });

  it('converts a refined NESTED object the same way the root is converted', () => {
    const result = zodToJsonSchema(
      asZod(z.object({ inner: z.object({ a: z.number() }).refine((v) => v.a > 0) })),
    );

    expect(result.properties['inner']?.properties?.['a']?.type).toBe('number');
  });

  it('throws for a root that is not an object rather than returning an empty schema', () => {
    expect(() => zodToJsonSchema(asZod(z.array(z.string())))).toThrow(/root must be an object/);
  });

  it('still throws for an unsupported type nested one level down', () => {
    // CORE-041: `ZodDate` used to be the example here and is now SUPPORTED — JSON has no date type,
    // so `{type:'string', format:'date-time'}` is the faithful description of the payload rather
    // than a lossy stand-in. `ZodTuple` takes its place: a tuple needs positional `items`, which the
    // universal subset models as one schema, so it genuinely has no representation.
    expect(() =>
      zodToJsonSchema(asZod(z.object({ outer: z.object({ pair: z.tuple([z.string()]) }) }))),
    ).toThrow(/ZodTuple cannot be carried by the universal JSON-schema subset/);
  });
});

describe('zodToJsonSchema with real Zod — nullable, literal null, and wrapper depth', () => {
  it('keeps the null branch of a nested nullable field', () => {
    const result = zodToJsonSchema(
      asZod(z.object({ n: z.object({ s: z.string().nullable(), t: z.string() }) })),
    );

    const s = result.properties['n']?.properties?.['s'];
    expect(s?.anyOf).toEqual([{ type: 'string' }, { type: 'null' }]);
    expect(s?.type).toBeUndefined();
  });

  it('accepts a null payload for a nested nullable field, as Zod itself does', () => {
    const schema = zodToJsonSchema(
      asZod(z.object({ n: z.object({ s: z.string().nullable(), t: z.string() }) })),
    );
    expect(validateAgainstJsonSchema(schema, { n: { s: null, t: 'x' } }, '$')).toEqual([]);
    expect(validateAgainstJsonSchema(schema, { n: { s: 'y', t: 'x' } }, '$')).toEqual([]);
    expect(validateAgainstJsonSchema(schema, { n: { s: 1, t: 'x' } }, '$').join(' ')).toContain(
      'matches none',
    );
  });

  it('reports an optional field as optional through several refine wrappers', () => {
    const twice = z.object({ a: z.string().optional().refine(Boolean).refine(Boolean) });
    // A single unwrap reported this as required, so the model was told an optional field was
    // mandatory and the input validator demanded it.
    expect(zodToJsonSchema(asZod(twice)).required).toEqual([]);
  });

  it('emits a null literal as the null type rather than throwing', () => {
    const result = zodToJsonSchema(asZod(z.object({ nothing: z.literal(null) })));
    expect(result.properties['nothing']).toEqual({ type: 'null' });
  });

  it('refuses a cyclic wrapper chain instead of hanging', () => {
    // `IZodSchema` is a structural stand-in at a public boundary, so a hand-built cycle is
    // reachable even though real Zod never produces one.
    const cyclic: {
      parse: (v: unknown) => unknown;
      safeParse: (v: unknown) => never;
      _def: unknown;
    } = {
      parse: (v) => v,
      safeParse: (() => ({ success: true })) as never,
      _def: { typeName: 'ZodOptional' },
    };
    (cyclic._def as { innerType?: unknown }).innerType = cyclic;

    expect(() => zodToJsonSchema(asZod(cyclic))).toThrow(/exceeds 64 levels/);
  });
});
