import { OrganizationSchemaError } from './error.js';

function validString(value: string): void {
  for (const character of value) {
    const point = character.codePointAt(0)!;
    if (point >= 0xd800 && point <= 0xdfff) throw new OrganizationSchemaError();
  }
}

/** Canonical JSON for a bounded, safe-integer subset; no float coercion. */
export function organizationCanonical(value: unknown): string {
  const visiting = new Set<object>();
  let nodes = 0;
  function encode(item: unknown, depth: number): string {
    if (++nodes > 4096 || depth > 32) throw new OrganizationSchemaError();
    if (item === null || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'string') {
      validString(item);
      return JSON.stringify(item);
    }
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item) || Object.is(item, -0))
        throw new OrganizationSchemaError();
      return JSON.stringify(item);
    }
    if (typeof item !== 'object' || visiting.has(item))
      throw new OrganizationSchemaError();
    visiting.add(item);
    try {
      if (Array.isArray(item)) {
        if (Reflect.ownKeys(item).length !== item.length + 1)
          throw new OrganizationSchemaError();
        return `[${Array.from({ length: item.length }, (_, index) => {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (descriptor === undefined || !('value' in descriptor))
            throw new OrganizationSchemaError();
          return encode(descriptor.value, depth + 1);
        }).join(',')}]`;
      }
      if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        throw new OrganizationSchemaError();
      const keys = Reflect.ownKeys(item);
      if (keys.some((key) => typeof key !== 'string'))
        throw new OrganizationSchemaError();
      return `{${(keys as string[])
        .sort()
        .map((key) => {
          validString(key);
          const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
          if (!descriptor.enumerable || !('value' in descriptor))
            throw new OrganizationSchemaError();
          return `${JSON.stringify(key)}:${encode(descriptor.value, depth + 1)}`;
        })
        .join(',')}}`;
    } finally {
      visiting.delete(item);
    }
  }
  const encoded = encode(value, 0);
  if (new TextEncoder().encode(encoded).byteLength > 64 * 1024)
    throw new OrganizationSchemaError();
  return encoded;
}
