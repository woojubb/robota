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
import type { ParsedNode } from 'yaml';

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
    const apply = Object.hasOwn(appliers, field) ? appliers[field] : undefined;
    // Fields this profile does not own grant nothing, so they are ignored rather than refused:
    // `.claude` skills and agents are shared with other hosts that define their own fields.
    if (apply === undefined) continue;
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

function decodeSkillWithModelScope<M extends ISkillFrontmatter>(
  context: IDecodeContext,
  contents: ParsedNode,
  appliers: Readonly<Record<string, TFieldApplier<M>>>,
  empty: () => M,
): TMetadataDecodeResult<M> {
  const decoded = decodeProfileMap(context, contents, appliers, empty);
  if (!decoded.ok || decoded.value.model === undefined || decoded.value.context === 'fork') {
    return decoded;
  }
  const modelPair = isMap(contents)
    ? contents.items.find((pair) => scalarString(pair.key) === 'model')
    : undefined;
  return failure([
    diagnosticAtNode(context, modelPair?.value ?? contents, {
      code: 'invalid-value',
      field: 'model',
      expected: 'context: fork when model is set',
    }),
  ]);
}

function decodeSkillProfile(
  context: IDecodeContext,
  contents: ParsedNode,
): TMetadataDecodeResult<ISkillFrontmatter> {
  return decodeSkillWithModelScope(context, contents, SKILL_FIELD_APPLIERS, () => ({}));
}

function decodeBundleSkillProfile(
  context: IDecodeContext,
  contents: ParsedNode,
): TMetadataDecodeResult<IBundleSkillFrontmatter> {
  return decodeSkillWithModelScope(context, contents, BUNDLE_SKILL_FIELD_APPLIERS, () => ({}));
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
