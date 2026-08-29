import { isMap } from 'yaml';

import { diagnosticAtNode, failure, scalarString } from './frontmatter-document.js';
import {
  AGENT_FIELD_APPLIERS,
  BUNDLE_SKILL_FIELD_APPLIERS,
  SKILL_FIELD_APPLIERS,
} from './frontmatter-profile-fields.js';

import type { TFieldApplier } from './frontmatter-profile-fields.js';
import type {
  IAgentFrontmatter,
  IBundleSkillFrontmatter,
  IDecodeContext,
  IFrontmatterDiagnostic,
  IFrontmatterMetadataByProfile,
  ISkillFrontmatter,
  TFrontmatterProfile,
  TMetadataDecodeResult,
} from './frontmatter-types.js';
import type { Pair, ParsedNode } from 'yaml';

function unknownFieldDiagnostic(
  context: IDecodeContext,
  pair: Pair<ParsedNode, ParsedNode | null>,
  field: string,
  allowedFields: readonly string[],
): IFrontmatterDiagnostic {
  return diagnosticAtNode(context, pair.key, {
    code: 'unknown-field',
    field,
    expected: `one of ${allowedFields.join(', ')}`,
  });
}

function decodeProfileMap<M>(
  context: IDecodeContext,
  contents: ParsedNode,
  appliers: Readonly<Record<string, TFieldApplier<M>>>,
  empty: () => M,
): TMetadataDecodeResult<M> {
  if (!isMap(contents)) {
    return failure([
      diagnosticAtNode(context, contents, { code: 'root-type', expected: 'a frontmatter mapping' }),
    ]);
  }

  const metadata = empty();
  const diagnostics: IFrontmatterDiagnostic[] = [];
  const allowedFields = Object.keys(appliers);
  for (const pair of contents.items) {
    const field = scalarString(pair.key);
    if (field === undefined) {
      diagnostics.push(
        diagnosticAtNode(context, pair.key, {
          code: 'invalid-type',
          expected: 'a string field name',
        }),
      );
      continue;
    }
    const apply = appliers[field];
    if (apply === undefined) {
      diagnostics.push(unknownFieldDiagnostic(context, pair, field, allowedFields));
      continue;
    }
    const diagnostic = apply(context, pair.value, field, metadata);
    if (diagnostic !== undefined) diagnostics.push(diagnostic);
  }
  return diagnostics.length > 0 ? failure(diagnostics) : { ok: true, value: metadata };
}

interface IProfileDefinition<P extends TFrontmatterProfile> {
  empty: () => IFrontmatterMetadataByProfile[P];
  decode: (
    context: IDecodeContext,
    contents: ParsedNode,
  ) => TMetadataDecodeResult<IFrontmatterMetadataByProfile[P]>;
}

function decodeSkillProfile(
  context: IDecodeContext,
  contents: ParsedNode,
): TMetadataDecodeResult<ISkillFrontmatter> {
  return decodeProfileMap(context, contents, SKILL_FIELD_APPLIERS, () => ({}));
}

function decodeBundleSkillProfile(
  context: IDecodeContext,
  contents: ParsedNode,
): TMetadataDecodeResult<IBundleSkillFrontmatter> {
  return decodeProfileMap(context, contents, BUNDLE_SKILL_FIELD_APPLIERS, () => ({}));
}

function decodeAgentProfile(
  context: IDecodeContext,
  contents: ParsedNode,
): TMetadataDecodeResult<IAgentFrontmatter> {
  return decodeProfileMap(context, contents, AGENT_FIELD_APPLIERS, () => ({}));
}

export const PROFILE_DEFINITIONS: {
  [P in TFrontmatterProfile]: IProfileDefinition<P>;
} = {
  skill: { empty: () => ({}), decode: decodeSkillProfile },
  'bundle-skill': { empty: () => ({}), decode: decodeBundleSkillProfile },
  agent: { empty: () => ({}), decode: decodeAgentProfile },
};
