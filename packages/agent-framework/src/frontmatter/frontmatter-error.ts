import type { IFrontmatterDiagnostic } from './frontmatter-types.js';

function formatDiagnostic(diagnostic: IFrontmatterDiagnostic): string {
  const position =
    diagnostic.line === undefined
      ? diagnostic.source
      : `${diagnostic.source}:${diagnostic.line}${diagnostic.column === undefined ? '' : `:${diagnostic.column}`}`;
  const field = diagnostic.field === undefined ? '' : ` ${diagnostic.field}:`;
  return `${position} [${diagnostic.code}]${field} expected ${diagnostic.expected}`;
}

/** A private loader error that preserves the decoder's complete, nonempty diagnostic set. */
export class FrontmatterDecodeError extends Error {
  readonly diagnostics: readonly [IFrontmatterDiagnostic, ...IFrontmatterDiagnostic[]];

  constructor(diagnostics: readonly [IFrontmatterDiagnostic, ...IFrontmatterDiagnostic[]]) {
    super(diagnostics.map(formatDiagnostic).join('\n'));
    this.name = 'FrontmatterDecodeError';
    this.diagnostics = diagnostics;
  }
}
