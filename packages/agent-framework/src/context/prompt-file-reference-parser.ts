import type { IPromptFileReferenceToken } from './prompt-file-reference-types.js';

const REFERENCE_PATTERN = /(^|[\s([{])@([^\s)\]}>,;"'`]+)/g;

export function parsePromptFileReferences(input: string): IPromptFileReferenceToken[] {
  const references: IPromptFileReferenceToken[] = [];
  for (const match of input.matchAll(REFERENCE_PATTERN)) {
    const token = stripTrailingPunctuation(match[2] ?? '');
    if (!isPathLikeReference(token)) continue;
    references.push({
      original: `@${token}`,
      path: token,
      index: match.index ?? 0,
    });
  }
  return references;
}

function stripTrailingPunctuation(token: string): string {
  let end = token.length;
  while (end > 0 && /[.,:;!?]/.test(token[end - 1] ?? '')) {
    end -= 1;
  }
  return token.slice(0, end);
}

function isPathLikeReference(referencePath: string): boolean {
  if (referencePath.length === 0) return false;
  if (referencePath.includes('://')) return false;
  return (
    referencePath.startsWith('./') ||
    referencePath.startsWith('../') ||
    referencePath.startsWith('/') ||
    referencePath.startsWith('~/') ||
    referencePath.startsWith('.') ||
    referencePath.includes('.')
  );
}
