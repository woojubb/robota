import type { IRegexReplaceRequest } from '@robota-sdk/dag-core';

type TRegexReplaceResult =
  | { type: 'result'; value: string }
  | { type: 'oversized' }
  | { type: 'invalid-regex' };

/**
 * Self-contained so its fixed source can run in both the Node thread and Bun process. The first
 * native replace enumerates matches but returns empty replacements, so its result is no larger than
 * the admitted input. Only after exact counting do we ask native replace to build the real result.
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
    text.replace(regex, (...args: unknown[]) => {
      const hasNamedCaptures = typeof args[args.length - 1] === 'object';
      const positionIndex = args.length - (hasNamedCaptures ? 3 : 2);
      const matched = args[0] as string;
      const position = args[positionIndex] as number;
      const captures = args.slice(1, positionIndex) as (string | undefined)[];
      const namedCaptures = hasNamedCaptures
        ? args[args.length - 1] as Record<string, string | undefined>
        : undefined;
      visit(text, nextSourcePosition, position);
      visitSubstitution(matched, captures, position, namedCaptures);
      nextSourcePosition = position + matched.length;
      return '';
    });
    visit(text, nextSourcePosition, text.length);
  } catch (error) {
    if (error === OVER_LIMIT) return { type: 'oversized' };
    return { type: 'invalid-regex' };
  }

  // Fresh regex preserves g/y/zero-length behavior; preflight has already proven this fits.
  return { type: 'result', value: text.replace(new RegExp(search, flags), replacement) };
}
