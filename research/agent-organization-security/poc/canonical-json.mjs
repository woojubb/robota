/** Research signing domain: ASCII schema keys, scalar Unicode strings, safe integers, no floats. */
export function canonical(value) {
  const encode = (item) => {
    if (item === null || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number' && Number.isSafeInteger(item) && !Object.is(item, -0))
      return String(item);
    if (
      typeof item === 'string' &&
      ![...item].some((char) => {
        const point = char.codePointAt(0);
        return point >= 0xd800 && point <= 0xdfff;
      })
    )
      return JSON.stringify(item);
    if (Array.isArray(item)) return '[' + item.map(encode).join(',') + ']';
    if (
      item &&
      typeof item === 'object' &&
      Object.keys(item).every((key) => [...key].every((char) => char.codePointAt(0) <= 127))
    ) {
      return (
        '{' +
        Object.keys(item)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + encode(item[key]))
          .join(',') +
        '}'
      );
    }
    throw new Error('Outside canonical JSON accepted domain');
  };
  return encode(value);
}
