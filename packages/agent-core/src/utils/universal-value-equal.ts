/** Compare cloned, JSON-like tool values, including nested dates and reference cycles. */
export function isUniversalValueEqual(left: unknown, right: unknown): boolean {
  const forward = new WeakMap<object, object>();
  const reverse = new WeakMap<object, object>();
  const equal = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (a instanceof Date || b instanceof Date)
      return a instanceof Date && b instanceof Date && Object.is(a.getTime(), b.getTime());
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    if (!(Array.isArray(a) || Object.getPrototypeOf(a) === Object.prototype)) return false;
    if (Array.isArray(a) && (!Array.isArray(b) || a.length !== b.length)) return false;
    if (forward.has(a) || reverse.has(b)) return forward.get(a) === b && reverse.get(b) === a;
    forward.set(a, b);
    reverse.set(b, a);
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    return keys.every(
      (key) =>
        Object.hasOwn(b, key) &&
        equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  };
  return equal(left, right);
}
