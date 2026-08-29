import {
  decodeBoolean,
  decodeContext,
  decodeEffort,
  decodeMetadataMap,
  decodeNonEmptyString,
  decodePositiveSafeInteger,
  decodeStringList,
} from './frontmatter-primitives.js';

import type {
  IAgentFrontmatter,
  IBundleSkillFrontmatter,
  IDecodeContext,
  IFrontmatterDiagnostic,
  TValueResult,
  TYamlNode,
} from './frontmatter-types.js';

type TFieldDecoder<T> = (
  context: IDecodeContext,
  node: TYamlNode,
  field: string,
) => TValueResult<T>;

export type TFieldApplier<M> = (
  context: IDecodeContext,
  node: TYamlNode,
  field: string,
  metadata: M,
) => IFrontmatterDiagnostic | undefined;

function applyDecoded<M, T>(
  decoder: TFieldDecoder<T>,
  assign: (metadata: M, value: T) => void,
): TFieldApplier<M> {
  return (context, node, field, metadata) => {
    const decoded = decoder(context, node, field);
    if (!decoded.ok) return decoded.diagnostic;
    assign(metadata, decoded.value);
    return undefined;
  };
}

export const SKILL_FIELD_APPLIERS: Readonly<
  Record<string, TFieldApplier<IBundleSkillFrontmatter>>
> = {
  name: applyDecoded(decodeNonEmptyString, (m: IBundleSkillFrontmatter, value) =>
    Object.assign(m, { name: value }),
  ),
  description: applyDecoded(decodeNonEmptyString, (m: IBundleSkillFrontmatter, value) =>
    Object.assign(m, { description: value }),
  ),
  model: applyDecoded(decodeNonEmptyString, (m: IBundleSkillFrontmatter, value) =>
    Object.assign(m, { model: value }),
  ),
  'argument-hint': applyDecoded(decodeNonEmptyString, (m: IBundleSkillFrontmatter, value) =>
    Object.assign(m, { argumentHint: value }),
  ),
  'disable-model-invocation': applyDecoded(decodeBoolean, (m: IBundleSkillFrontmatter, value) =>
    Object.assign(m, { disableModelInvocation: value }),
  ),
  'user-invocable': applyDecoded(decodeBoolean, (m: IBundleSkillFrontmatter, value) =>
    Object.assign(m, { userInvocable: value }),
  ),
  'allowed-tools': applyDecoded(decodeStringList, (m: IBundleSkillFrontmatter, value) =>
    Object.assign(m, { allowedTools: value }),
  ),
  effort: applyDecoded(decodeEffort, (m: IBundleSkillFrontmatter, value) =>
    Object.assign(m, { effort: value }),
  ),
  context: applyDecoded(decodeContext, (m: IBundleSkillFrontmatter, value) =>
    Object.assign(m, { context: value }),
  ),
  agent: applyDecoded(decodeNonEmptyString, (m: IBundleSkillFrontmatter, value) =>
    Object.assign(m, { agent: value }),
  ),
  loop: applyDecoded(decodeNonEmptyString, (m: IBundleSkillFrontmatter, value) =>
    Object.assign(m, { loop: value }),
  ),
  invocable: applyDecoded(decodeBoolean, (m: IBundleSkillFrontmatter, value) =>
    Object.assign(m, { invocable: value }),
  ),
  license: applyDecoded(decodeNonEmptyString, (m: IBundleSkillFrontmatter, value) =>
    Object.assign(m, { license: value }),
  ),
  metadata: applyDecoded(decodeMetadataMap, (m: IBundleSkillFrontmatter, value) =>
    Object.assign(m, { metadata: value }),
  ),
};

export const BUNDLE_SKILL_FIELD_APPLIERS: Readonly<
  Record<string, TFieldApplier<IBundleSkillFrontmatter>>
> = {
  ...SKILL_FIELD_APPLIERS,
  tags: applyDecoded(decodeStringList, (m: IBundleSkillFrontmatter, value) =>
    Object.assign(m, { tags: value }),
  ),
};

export const AGENT_FIELD_APPLIERS: Readonly<Record<string, TFieldApplier<IAgentFrontmatter>>> = {
  name: applyDecoded(decodeNonEmptyString, (m: IAgentFrontmatter, value) =>
    Object.assign(m, { name: value }),
  ),
  description: applyDecoded(decodeNonEmptyString, (m: IAgentFrontmatter, value) =>
    Object.assign(m, { description: value }),
  ),
  model: applyDecoded(decodeNonEmptyString, (m: IAgentFrontmatter, value) =>
    Object.assign(m, { model: value }),
  ),
  maxTurns: applyDecoded(decodePositiveSafeInteger, (m: IAgentFrontmatter, value) =>
    Object.assign(m, { maxTurns: value }),
  ),
  tools: applyDecoded(decodeStringList, (m: IAgentFrontmatter, value) =>
    Object.assign(m, { tools: value }),
  ),
  disallowedTools: applyDecoded(decodeStringList, (m: IAgentFrontmatter, value) =>
    Object.assign(m, { disallowedTools: value }),
  ),
  signal: applyDecoded(decodeNonEmptyString, (m: IAgentFrontmatter, value) =>
    Object.assign(m, { signal: value }),
  ),
};
