/**
 * CORE-041 — the converter's unsupported-construct tail, split by whether the TARGET can express it.
 *
 * The item's instruction was to re-run CORE-039's library-vs-hand-map decision rather than
 * mechanically add cases. Re-run, the answer is that the two groups below are different problems and
 * no library changes either of them:
 *
 * - `ZodNativeEnum` and `ZodDate` are EXACTLY expressible in the universal subset (`enum`, and
 *   `{type:'string', format:'date-time'}` — JSON has no date type, so a string is what the provider
 *   receives either way). They were missing for no reason. Added.
 * - `ZodTuple`, `ZodIntersection` and `ZodLazy` are not expressible. A tuple needs positional
 *   `items`, which the subset models as ONE schema; an intersection needs `allOf`; recursion needs
 *   `$ref`. Adopting `zod-to-json-schema` would emit exactly those constructs — the ones CORE-039
 *   rejected the library for, because the field-enumerated provider mappers silently drop them. The
 *   difficulty was never parsing Zod; it is that the target language cannot say these things, and a
 *   library that emits a richer document makes the gap wider rather than dissolving it.
 *
 * So they still throw, which the item called the correct posture. What changes is that the boundary
 * is PUBLISHED rather than discovered: the message names the construct, says why the subset cannot
 * carry it, and names what to write instead.
 *
 * Mapping them lossily was considered and rejected. A tuple flattened to
 * `array of anyOf[string, number]` would advertise a contract the author did not write — the model
 * would be told any order and any length are acceptable. Silently weakening a declared schema is the
 * same defect class as CORE-040, arrived at from the other side.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { validateAgainstJsonSchema } from '../structured-output';
import { zodToJsonSchema } from '../zod-to-json-schema';

import type { IZodSchema } from '../zod-schema-types';

const asZod = (schema: unknown): IZodSchema => schema as IZodSchema;

describe('CORE-041 — constructs the universal subset CAN express', () => {
  it('converts a native enum to an enum node, and the values validate', () => {
    enum Direction {
      Up = 'up',
      Down = 'down',
    }
    const schema = zodToJsonSchema(asZod(z.object({ dir: z.nativeEnum(Direction) })));
    const dir = schema.properties?.['dir'];

    expect(dir?.type).toBe('string');
    expect(dir?.enum).toEqual(['up', 'down']);
    expect(validateAgainstJsonSchema(schema, { dir: 'up' }, '')).toEqual([]);
    expect(validateAgainstJsonSchema(schema, { dir: 'sideways' }, '').join(' ')).toMatch(/enum/);
  });

  it('converts a numeric native enum to its value set', () => {
    // A numeric TS enum has a reverse mapping, so `Object.values` carries the NAMES too. Emitting
    // those would advertise "Up" as an acceptable value for a field that accepts 0.
    enum Level {
      Low,
      High,
    }
    const schema = zodToJsonSchema(asZod(z.object({ level: z.nativeEnum(Level) })));
    const level = schema.properties?.['level'];

    expect(level?.enum).toEqual([0, 1]);
    expect(level?.type).toBe('number');
    expect(validateAgainstJsonSchema(schema, { level: 1 }, '')).toEqual([]);
  });

  it('converts a date to the string a provider actually receives', () => {
    // JSON has no date type. Every provider sends a string on the wire, so `{type:'string'}` is not
    // a lossy stand-in — it is the faithful description of the payload. `format` carries the intent.
    const schema = zodToJsonSchema(asZod(z.object({ when: z.date() })));
    const when = schema.properties?.['when'];

    expect(when?.type).toBe('string');
    expect(when?.format).toBe('date-time');
    expect(validateAgainstJsonSchema(schema, { when: '2026-08-17T00:00:00Z' }, '')).toEqual([]);
  });

  it('carries them through nesting, like every other construct', () => {
    enum Kind {
      A = 'a',
    }
    const schema = zodToJsonSchema(
      asZod(z.object({ outer: z.object({ kind: z.nativeEnum(Kind), at: z.date() }) })),
    );
    const outer = schema.properties?.['outer'];

    expect(outer?.properties?.['kind']?.enum).toEqual(['a']);
    expect(outer?.properties?.['at']?.format).toBe('date-time');
  });
});

describe('CORE-041 — constructs it cannot, and the published boundary', () => {
  const cases: Array<[string, () => unknown, RegExp]> = [
    ['ZodTuple', () => z.object({ pair: z.tuple([z.string(), z.number()]) }), /tuple/i],
    [
      'ZodIntersection',
      () =>
        z.object({
          both: z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })),
        }),
      /intersection/i,
    ],
    ['ZodLazy', () => z.object({ node: z.lazy(() => z.string()) }), /lazy/i],
  ];

  for (const [label, build, mentions] of cases) {
    it(`${label}: throws, and the message says WHY rather than only WHAT`, () => {
      let caught: unknown;
      try {
        zodToJsonSchema(asZod(build()));
      } catch (error) {
        caught = error;
      }

      const message = (caught as Error | undefined)?.message ?? '';
      expect(caught).toBeInstanceOf(Error);
      // Against the old `Unsupported Zod type: ZodTuple`, everything below this line fails: a
      // consumer was told the name of their own construct and nothing they could act on.
      expect(message).toMatch(mentions);
      expect(message).toMatch(/universal (JSON-)?schema subset/i);
      // Names something the consumer can WRITE instead — a Zod API, not a restatement of the
      // problem. Checked structurally rather than by looking for the word "instead", which would
      // pass on prose that merely contains it.
      expect(message).toMatch(/z\.[a-z]+\(|\.merge\(/);
    });
  }

  it('a construct nobody has named yet still throws, and still explains the boundary', () => {
    // The tail is open-ended — "whatever Zod adds next". The default branch must stay useful for a
    // construct this file has never heard of, or the boundary is published only for today's list.
    // Nested inside a real object, so it reaches the converter's default branch rather than the
    // root-must-be-an-object guard that sits in front of it.
    let caught: unknown;
    try {
      zodToJsonSchema(
        asZod({
          _def: {
            typeName: 'ZodObject',
            shape: () => ({ future: { _def: { typeName: 'ZodSomethingFromTheFuture' } } }),
          },
        }),
      );
    } catch (error) {
      caught = error;
    }

    const message = (caught as Error | undefined)?.message ?? '';
    expect(message).toMatch(/ZodSomethingFromTheFuture/);
    expect(message).toMatch(/universal (JSON-)?schema subset/i);
  });
});
