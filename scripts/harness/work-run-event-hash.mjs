import { createHash } from 'node:crypto';

export function canonicalWorkRunValue(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalWorkRunValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalWorkRunValue(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function workRunEventHash(event) {
  const { hash: _hash, ...unsigned } = event;
  return createHash('sha256').update(canonicalWorkRunValue(unsigned)).digest('hex');
}
