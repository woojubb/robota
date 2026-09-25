import type { IRegexReplaceRequest } from '@robota-sdk/dag-core';

type TRegexReplaceResult =
  | { type: 'result'; value: string }
  | { type: 'oversized' }
  | { type: 'invalid-regex' };

/**
 * Self-contained so its fixed source can run in both the Node thread and Bun process. Matches are
 * visited one at a time and output code units are written into a bounded buffer. Native global
 * replacement can retain a match list much larger than an admitted input or final output.
 */
export function boundedRegexReplace(
  request: IRegexReplaceRequest,
  maxBytes: number,
): TRegexReplaceResult {
  const { text, search, replacement, flags } = request;
  let regex: RegExp;
  try {
    regex = new RegExp(search, flags);
  } catch {
    return { type: 'invalid-regex' };
  }

  const OVER_LIMIT = Symbol('regex output exceeds byte limit');
  const output = new Uint16Array(maxBytes);
  let units = 0;
  let bytes = 0;
  let previousHigh = false;
  let nextSourcePosition = 0;
  // Count code units in final concatenation order. A high/low surrogate pair may cross two spans.
  const visit = (value: string, start: number, end: number): void => {
    for (let index = start; index < end; index++) {
      const code = value.charCodeAt(index);
      const low = code >= 0xdc00 && code <= 0xdfff;
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : low && previousHigh ? 1 : 3;
      previousHigh = code >= 0xd800 && code <= 0xdbff;
      if (bytes > maxBytes) throw OVER_LIMIT;
      output[units++] = code;
    }
  };

  // ECMAScript GetSubstitution for a string replacement template. Emit spans instead of building
  // each substitution, including the potentially repeated whole-input $` and $' expansions.
  const visitSubstitution = (
    matched: string,
    captures: readonly (string | undefined)[],
    position: number,
    namedCaptures: Record<string, string | undefined> | undefined,
  ): void => {
    for (let index = 0; index < replacement.length;) {
      const dollar = replacement.indexOf('$', index);
      if (dollar < 0) {
        visit(replacement, index, replacement.length);
        return;
      }
      visit(replacement, index, dollar);
      const next = replacement[dollar + 1];
      if (next === '$') {
        visit(replacement, dollar, dollar + 1);
        index = dollar + 2;
      } else if (next === '&') {
        visit(matched, 0, matched.length);
        index = dollar + 2;
      } else if (next === '`') {
        visit(text, 0, position);
        index = dollar + 2;
      } else if (next === "'") {
        visit(text, position + matched.length, text.length);
        index = dollar + 2;
      } else if (next !== undefined && next >= '0' && next <= '9') {
        const second = replacement[dollar + 2];
        const twoDigits = second !== undefined && second >= '0' && second <= '9';
        let digitCount = twoDigits ? 2 : 1;
        let captureIndex = Number(replacement.slice(dollar + 1, dollar + 1 + digitCount));
        if (digitCount === 2 && captureIndex > captures.length) {
          digitCount = 1;
          captureIndex = Number(next);
        }
        if (captureIndex >= 1 && captureIndex <= captures.length) {
          const capture = captures[captureIndex - 1];
          if (capture !== undefined) visit(capture, 0, capture.length);
        } else {
          visit(replacement, dollar, dollar + 1 + digitCount);
        }
        index = dollar + 1 + digitCount;
      } else if (next === '<') {
        const end = replacement.indexOf('>', dollar + 2);
        if (end >= 0 && namedCaptures !== undefined) {
          const capture = namedCaptures[replacement.slice(dollar + 2, end)];
          if (capture !== undefined) visit(capture, 0, capture.length);
          index = end + 1;
        } else {
          visit(replacement, dollar, dollar + 2);
          index = dollar + 2;
        }
      } else {
        visit(replacement, dollar, dollar + 1);
        index = dollar + 1;
      }
    }
  };

  try {
    const unicode = flags.includes('u') || flags.includes('v');
    for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
      const matched = match[0];
      const position = match.index;
      visit(text, nextSourcePosition, position);
      visitSubstitution(matched, match.slice(1), position, match.groups);
      nextSourcePosition = position + matched.length;
      if (!regex.global) break;
      if (matched.length === 0) {
        const index = regex.lastIndex;
        const high = text.charCodeAt(index);
        const low = text.charCodeAt(index + 1);
        regex.lastIndex += unicode && high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff
          ? 2 : 1;
      }
    }
    visit(text, nextSourcePosition, text.length);
  } catch (error) {
    if (error === OVER_LIMIT) return { type: 'oversized' };
    return { type: 'invalid-regex' };
  }

  const chunks: string[] = [];
  for (let index = 0; index < units; index += 8192) {
    chunks.push(String.fromCharCode(...output.subarray(index, Math.min(index + 8192, units))));
  }
  return { type: 'result', value: chunks.join('') };
}
