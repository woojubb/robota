/** Compare cloned, JSON-like tool values, including nested dates and reference cycles. */
export function isUniversalValueEqual(left: unknown, right: unknown): boolean {
  const forward = new WeakMap<object, object>();
  const reverse = new WeakMap<object, object>();
  const equal = (a: unknown, b: unknown): boolean => {
    if (Object.is(a, b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (forward.has(a) || reverse.has(b)) return forward.get(a) === b && reverse.get(b) === a;
    forward.set(a, b);
    reverse.set(b, a);
    if (Object.isExtensible(a) !== Object.isExtensible(b)) return false;
    if (a instanceof Date || b instanceof Date)
      return (
        a instanceof Date &&
        b instanceof Date &&
        Object.getPrototypeOf(a) === Object.getPrototypeOf(b) &&
        Reflect.ownKeys(a).length === 0 &&
        Reflect.ownKeys(b).length === 0 &&
        Object.is(a.getTime(), b.getTime())
      );
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    if (!(Array.isArray(a) || Object.getPrototypeOf(a) === Object.prototype)) return false;
    if (Array.isArray(a) && (!Array.isArray(b) || a.length !== b.length)) return false;
    const ownDataKeys = (value: object): string[] | undefined => {
      const keys: string[] = [];
      for (const key of Reflect.ownKeys(value)) {
        if (Array.isArray(value) && key === 'length') {
          const length = Object.getOwnPropertyDescriptor(value, key);
          if (!length || !length.writable || length.enumerable || length.configurable)
            return undefined;
          continue;
        }
        if (typeof key !== 'string') return undefined;
        const property = Object.getOwnPropertyDescriptor(value, key);
        if (
          !property ||
          !('value' in property) ||
          !property.enumerable ||
          !property.configurable ||
          !property.writable
        )
          return undefined;
        keys.push(key);
      }
      return keys;
    };
    const keys = ownDataKeys(a);
    const otherKeys = ownDataKeys(b);
    if (!keys || !otherKeys || keys.length !== otherKeys.length) return false;
    return keys.every(
      (key) =>
        Object.hasOwn(b, key) &&
        equal((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  };
  return equal(left, right);
}
