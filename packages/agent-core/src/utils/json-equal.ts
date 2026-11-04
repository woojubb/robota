const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const tagOf = (value: object): string => Object.prototype.toString.call(value);

function isStructural(value: object): boolean {
  const tag = tagOf(value);
  return tag === '[object Object]' || tag === '[object Array]';
}

function equalStructures(left: object, right: object): boolean {
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
  if (Array.isArray(left) && (left as unknown[]).length !== (right as unknown[]).length)
    return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(
    (key) =>
      hasOwn(right, key) &&
      isJsonEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  );
}

/**
 * Whether two JSON-shaped values are the same, answering as `isDeepStrictEqual` from `node:util`
 * does for the values a session compares (parsed tool arguments, persisted loop state), so no Node
 * built-in is needed (ARCHITECTURE.md "Runtime platforms"): primitives are compared by `Object.is`
 * (so `-0` differs from `0` and `NaN` equals itself), objects by prototype and own enumerable keys
 * regardless of key order, arrays by length and index. A property holding `undefined` is a key like
 * any other, so `{ a: undefined }` is not `{}`.
 *
 * Only plain objects and arrays are compared structurally. Any other object (a `Date`, `Map`, class
 * instance, typed array) equals only itself.
 */
export function isJsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }
  if (!isStructural(left) || !isStructural(right)) return false;
  return equalStructures(left, right);
}
