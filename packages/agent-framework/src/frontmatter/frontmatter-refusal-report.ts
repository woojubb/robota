import { createLogger } from '@robota-sdk/agent-core';

import { FrontmatterDecodeError } from './frontmatter-error.js';

import type { IFrontmatterDiagnostic } from './frontmatter-types.js';

const logger = createLogger('FrontmatterDiscovery');
/** Several consumers rediscover the same roots; each refused file is reported once per process. */
const reported = new Set<string>();

/** Warn once that a definition file was refused and skipped; the caller keeps loading the rest. */
export function reportRefusedDefinition(
  kind: 'skill' | 'agent',
  diagnostics: readonly [IFrontmatterDiagnostic, ...IFrontmatterDiagnostic[]],
): void {
  const error = new FrontmatterDecodeError(diagnostics).message;
  if (reported.has(error)) return;
  reported.add(error);
  logger.warn(`${kind} definition refused — skipping this ${kind}`, { error });
}
