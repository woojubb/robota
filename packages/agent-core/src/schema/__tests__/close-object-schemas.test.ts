import { describe, expect, it } from 'vitest';

import { closeObjectSchemas } from '../../index.js';

/**
 * PROV-007 — one closure recursion for every provider that rejects open-world objects.
 *
 * Anthropic requires closure. OpenAI strict mode requires closure AND that every object list all of
 * its properties in `required`. They differ in policy, not in how a schema is walked — and a walk
 * that misses a route leaves exactly the nodes it was written to fix untouched, which is the defect
 * CORE-039 was filed for after `anyOf` went unrecursed in the one private copy that existed.
 */

const NESTED = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id: { type: 'string' },
    profile: {
      type: 'object',
      additionalProperties: true,
      properties: {
        nickname: { type: 'string' },
        address: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      },
      required: ['nickname'],
    },
    tags: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' } } } },
    either: {
      anyOf: [
        { type: 'object', properties: { a: { type: 'string' } } },
        { type: 'object', properties: { b: { type: 'string' } } },
      ],
    },
  },
  required: ['id'],
};

/** Every `type: 'object'` node reachable in a schema, so a missed route cannot hide. */
function objectNodes(
  node: unknown,
  found: Array<Record<string, unknown>> = [],
): Array<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const entry of node) objectNodes(entry, found);
    return found;
  }
  if (typeof node !== 'object' || node === null) return found;
  const record = node as Record<string, unknown>;
  if (record.type === 'object') found.push(record);
  for (const key of ['properties', 'items', 'anyOf', 'additionalProperties']) {
    const child = record[key];
    if (key === 'properties' && child && typeof child === 'object') {
      for (const value of Object.values(child as Record<string, unknown>))
        objectNodes(value, found);
    } else if (child && typeof child === 'object') {
      objectNodes(child, found);
    }
  }
  return found;
}

describe('PROV-007 — closure', () => {
  it('closes EVERY object node, at every depth and down every route', () => {
    // Root, a nested property, an array item, and both branches of a union. The union is the route a
    // private copy of this walk once missed entirely.
    const closed = closeObjectSchemas(NESTED);
    const nodes = objectNodes(closed);

    expect(nodes.length).toBeGreaterThanOrEqual(6);
    for (const node of nodes) {
      expect(node.additionalProperties, JSON.stringify(node)).toBe(false);
    }
  });

  it('overwrites an explicit `true`, which is what the subset emits by default', () => {
    // Zod's default `strip` means "accept then drop", so the converter emits `true` routinely. The
    // consumer's original schema still governs core-side validation, where the `true` is honoured.
    const closed = closeObjectSchemas({
      type: 'object',
      additionalProperties: true,
      properties: {},
    });
    expect((closed as Record<string, unknown>).additionalProperties).toBe(false);
  });

  it('recurses a schema-valued additionalProperties rather than replacing it', () => {
    // A record type. Replacing it with `false` would silently forbid the values it describes.
    const closed = closeObjectSchemas({
      type: 'object',
      properties: {},
      additionalProperties: { type: 'object', properties: { v: { type: 'string' } } },
    }) as Record<string, unknown>;

    expect(typeof closed.additionalProperties).toBe('object');
    expect((closed.additionalProperties as Record<string, unknown>).additionalProperties).toBe(
      false,
    );
  });

  it('leaves `required` alone unless asked — Anthropic needs closure, not forced requirement', () => {
    const closed = closeObjectSchemas(NESTED) as Record<string, unknown>;
    expect(closed.required).toEqual(['id']);
  });
});

describe('PROV-007 — OpenAI strict mode', () => {
  const strict = { requireAllProperties: true, optionalAsNullable: true } as const;

  it('lists every property in `required`, at every depth', () => {
    const closed = closeObjectSchemas(NESTED, strict) as Record<string, unknown>;
    expect(closed.required).toEqual(['id', 'profile', 'tags', 'either']);

    // `profile` was optional, so it is now required-but-nullable and its own schema sits in the
    // first branch. Navigating through the wrapper is the assertion: the compensation must not stop
    // the closure from reaching what it wraps.
    const profileWrapper = (closed.properties as Record<string, Record<string, unknown>>).profile;
    const profile = (profileWrapper.anyOf as Array<Record<string, unknown>>)[0];
    expect(profile.required).toEqual(['nickname', 'address']);
    expect(profile.additionalProperties).toBe(false);

    // And one level deeper again, inside a property that was itself optional.
    const addressWrapper = (profile.properties as Record<string, Record<string, unknown>>).address;
    const address = (addressWrapper.anyOf as Array<Record<string, unknown>>)[0];
    expect(address.required).toEqual(['city']);
    expect(address.additionalProperties).toBe(false);
  });

  it('compensates a forced-optional field with a null branch', () => {
    // The part of strict mode with no faithful mapping: a field the caller marked optional becomes
    // required-but-nullable. `anyOf: [T, {type:'null'}]` is chosen because that is already how this
    // subset spells a nullable value, so a forced-optional field and a genuinely nullable one are
    // indistinguishable on the wire — rather than inventing a second spelling for one vendor.
    const closed = closeObjectSchemas(NESTED, strict) as Record<string, unknown>;
    const properties = closed.properties as Record<string, Record<string, unknown>>;

    expect(properties.profile.anyOf).toBeDefined();
    expect((properties.profile.anyOf as unknown[]).at(-1)).toEqual({ type: 'null' });
  });

  it('does NOT add a null branch to a field that was already required', () => {
    // Widening a genuinely required field would change the contract rather than preserve it.
    const closed = closeObjectSchemas(NESTED, strict) as Record<string, unknown>;
    const properties = closed.properties as Record<string, Record<string, unknown>>;

    expect(properties.id).toEqual({ type: 'string' });
  });

  it('does not add a second null branch to a value that already admits null', () => {
    const closed = closeObjectSchemas(
      {
        type: 'object',
        properties: { maybe: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
        required: [],
      },
      strict,
    ) as Record<string, unknown>;
    const maybe = (closed.properties as Record<string, Record<string, unknown>>).maybe;

    expect(maybe.anyOf).toEqual([{ type: 'string' }, { type: 'null' }]);
  });

  it('still closes every object, because strict needs both', () => {
    for (const node of objectNodes(closeObjectSchemas(NESTED, strict))) {
      expect(node.additionalProperties, JSON.stringify(node)).toBe(false);
    }
  });
});
