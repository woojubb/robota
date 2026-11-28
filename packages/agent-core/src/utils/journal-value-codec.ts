/**
 * A lossless text form for the values a journal record holds.
 *
 * Recovery compares saved records with the live ones by value, and the distinctions it relies on are
 * exactly the ones plain JSON drops: a `Date` is not its ISO string, `undefined` is not an absent key,
 * `-0` is not `0`, a shared object is not two equal copies, and a cycle is not an error. Each is
 * written as a tagged node, so a stored record decodes to a value `isUniversalValueEqual` accepts as
 * the original. Anything the journal contract does not carry (functions, symbols, big integers, class
 * instances, accessors, sparse arrays) is refused when it is appended (the clone or the encoding throws), so a record is never stored as
 * something other than what was appended.
 */

type TNode =
  | string
  | boolean
  | null
  | number
  | { $u: 1 }
  | { $n: 'NaN' | 'Infinity' | '-Infinity' | '-0' }
  | { $r: number }
  | { $d: number | null; $i?: number }
  | { $a: TNode[]; $i?: number }
  | { $o: Array<[string, TNode]>; $i?: number };

function unsupported(what: string): never {
  throw new TypeError(`A journal record cannot hold ${what}`);
}

function dataEntries(value: object, array: boolean): Array<[string, unknown]> {
  const entries: Array<[string, unknown]> = [];
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue;
    if (typeof key !== 'string') return unsupported('a symbol key');
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !('value' in property) || !property.enumerable)
      return unsupported('an accessor or a hidden property');
    entries.push([key, property.value]);
  }
  return entries;
}

function countReferences(root: unknown): Map<object, number> {
  const counts = new Map<object, number>();
  const visit = (value: unknown): void => {
    if (value === null || value === undefined) return;
    const type = typeof value;
    if (type === 'string' || type === 'boolean' || type === 'number') return;
    if (type !== 'object') unsupported(`a ${type}`);
    const object = value as object;
    const seen = (counts.get(object) ?? 0) + 1;
    counts.set(object, seen);
    if (seen > 1 || object instanceof Date) return;
    if (Array.isArray(object)) {
      for (let index = 0; index < object.length; index += 1)
        if (!(index in object)) unsupported('a sparse array');
      for (const [, item] of dataEntries(object, true)) visit(item);
      return;
    }
    if (Object.getPrototypeOf(object) !== Object.prototype) unsupported('a class instance');
    for (const [, item] of dataEntries(object, false)) visit(item);
  };
  visit(root);
  return counts;
}

/** The JSON-safe tagged form of `value`; throws a `TypeError` for anything the journal cannot carry. */
export function encodeJournalValue(value: unknown): unknown {
  const counts = countReferences(value);
  const ids = new Map<object, number>();
  const shared = (object: object): { id?: number; ref?: number } => {
    if ((counts.get(object) ?? 0) < 2) return {};
    const known = ids.get(object);
    if (known !== undefined) return { ref: known };
    const id = ids.size;
    ids.set(object, id);
    return { id };
  };
  const encode = (item: unknown): TNode => {
    if (item === undefined) return { $u: 1 };
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (Object.is(item, -0)) return { $n: '-0' };
      if (Number.isNaN(item)) return { $n: 'NaN' };
      if (item === Infinity) return { $n: 'Infinity' };
      if (item === -Infinity) return { $n: '-Infinity' };
      return item;
    }
    const object = item as object;
    const mark = shared(object);
    if (mark.ref !== undefined) return { $r: mark.ref };
    const tag = mark.id === undefined ? {} : { $i: mark.id };
    if (object instanceof Date) {
      if (Object.getPrototypeOf(object) !== Date.prototype || Reflect.ownKeys(object).length !== 0)
        return unsupported('a Date with extra state');
      const time = object.getTime();
      return { $d: Number.isNaN(time) ? null : time, ...tag };
    }
    if (Array.isArray(object))
      return { $a: dataEntries(object, true).map(([, entry]) => encode(entry)), ...tag };
    return { $o: dataEntries(object, false).map(([key, entry]) => [key, encode(entry)]), ...tag };
  };
  return encode(value);
}

function malformed(): never {
  throw new TypeError('The stored journal value is malformed');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Inverse of {@link encodeJournalValue}; throws a `TypeError` for anything not produced by it. */
export function decodeJournalValue(stored: unknown): unknown {
  const table = new Map<number, object>();
  const register = (node: Record<string, unknown>, object: object): void => {
    const id = node['$i'];
    if (id === undefined) return;
    if (typeof id !== 'number' || !Number.isInteger(id) || table.has(id)) malformed();
    table.set(id, object);
  };
  const decode = (node: unknown): unknown => {
    if (node === null || typeof node === 'string' || typeof node === 'boolean') return node;
    if (typeof node === 'number') return Number.isFinite(node) ? node : malformed();
    if (!isRecord(node)) return malformed();
    if ('$u' in node) return node['$u'] === 1 ? undefined : malformed();
    if ('$n' in node) {
      const text = node['$n'];
      if (text === '-0') return -0;
      if (text === 'NaN') return NaN;
      if (text === 'Infinity') return Infinity;
      if (text === '-Infinity') return -Infinity;
      return malformed();
    }
    if ('$r' in node) {
      const target = table.get(node['$r'] as number);
      return target ?? malformed();
    }
    if ('$d' in node) {
      const time = node['$d'];
      if (time !== null && typeof time !== 'number') return malformed();
      const date = new Date(time === null ? NaN : time);
      register(node, date);
      return date;
    }
    if ('$a' in node) {
      const items = node['$a'];
      if (!Array.isArray(items)) return malformed();
      const array: unknown[] = [];
      register(node, array);
      for (const item of items) array.push(decode(item));
      return array;
    }
    if ('$o' in node) {
      const entries = node['$o'];
      if (!Array.isArray(entries)) return malformed();
      const object: Record<string, unknown> = {};
      register(node, object);
      for (const entry of entries) {
        if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string')
          return malformed();
        Object.defineProperty(object, entry[0], {
          value: decode(entry[1]),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return object;
    }
    return malformed();
  };
  return decode(stored);
}
