import { parseFrontmatterDocument, splitFrontmatter } from './frontmatter-document.js';
import { PROFILE_DEFINITIONS } from './frontmatter-profiles.js';

import type {
  IFrontmatterDecodeInput,
  TFrontmatterDecodeResult,
  TFrontmatterProfile,
} from './frontmatter-types.js';

export type {
  IAgentFrontmatter,
  IBundleSkillFrontmatter,
  IFrontmatterDecodeInput,
  IFrontmatterDiagnostic,
  ISkillFrontmatter,
  TFrontmatterDecodeResult,
  TFrontmatterDiagnosticCode,
  TFrontmatterProfile,
  TFrontmatterScalar,
} from './frontmatter-types.js';

export function decodeFrontmatter<P extends TFrontmatterProfile>(
  input: IFrontmatterDecodeInput<P>,
): TFrontmatterDecodeResult<P> {
  const definition = PROFILE_DEFINITIONS[input.profile];
  const sliced = splitFrontmatter(input.source, input.content);
  if (sliced === undefined) {
    return { ok: true, metadata: definition.empty(), body: input.content };
  }
  if ('ok' in sliced) return sliced;
  if (sliced.header.trim().length === 0) {
    return { ok: true, metadata: definition.empty(), body: sliced.body };
  }

  const parsed = parseFrontmatterDocument(input.source, sliced.header);
  if ('ok' in parsed) return parsed;
  if (parsed.contents === null) {
    return { ok: true, metadata: definition.empty(), body: sliced.body };
  }

  const decoded = definition.decode(parsed.context, parsed.contents);
  return decoded.ok ? { ok: true, metadata: decoded.value, body: sliced.body } : decoded;
}
