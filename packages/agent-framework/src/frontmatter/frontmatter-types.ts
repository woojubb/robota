import type { TModelEffort } from '@robota-sdk/agent-core';
import type { LineCounter, ParsedNode } from 'yaml';

export type TFrontmatterProfile = 'skill' | 'bundle-skill' | 'agent';

export type TFrontmatterDiagnosticCode =
  | 'unterminated'
  | 'yaml-syntax'
  | 'duplicate-key'
  | 'alias-or-merge-forbidden'
  | 'root-type'
  | 'unknown-field'
  | 'invalid-type'
  | 'invalid-value';

export interface IFrontmatterDiagnostic {
  code: TFrontmatterDiagnosticCode;
  source: string;
  line?: number;
  column?: number;
  field?: string;
  expected: string;
  received: string;
}

export type TFrontmatterScalar = string | number | boolean;

export interface ISkillFrontmatter {
  name?: string;
  description?: string;
  model?: string;
  argumentHint?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[];
  effort?: TModelEffort;
  context?: 'fork';
  agent?: string;
  loop?: string;
  invocable?: boolean;
  license?: string;
  metadata?: Record<string, TFrontmatterScalar>;
}

export interface IBundleSkillFrontmatter extends ISkillFrontmatter {
  tags?: string[];
}

export interface IAgentFrontmatter {
  name?: string;
  description?: string;
  model?: string;
  maxTurns?: number;
  tools?: string[];
  disallowedTools?: string[];
  signal?: string;
}

export interface IFrontmatterMetadataByProfile {
  skill: ISkillFrontmatter;
  'bundle-skill': IBundleSkillFrontmatter;
  agent: IAgentFrontmatter;
}

export interface IFrontmatterDecodeInput<P extends TFrontmatterProfile = TFrontmatterProfile> {
  source: string;
  content: string;
  profile: P;
}

interface IFrontmatterDecodeSuccess<P extends TFrontmatterProfile> {
  ok: true;
  metadata: IFrontmatterMetadataByProfile[P];
  body: string;
}

export interface IFrontmatterDecodeFailure {
  ok: false;
  diagnostics: readonly [IFrontmatterDiagnostic, ...IFrontmatterDiagnostic[]];
}

export type TFrontmatterDecodeResult<P extends TFrontmatterProfile = TFrontmatterProfile> =
  IFrontmatterDecodeSuccess<P> | IFrontmatterDecodeFailure;

export interface IFrontmatterSlice {
  header: string;
  body: string;
}

export interface IDecodeContext {
  source: string;
  lineCounter: LineCounter;
  header: string;
}

interface IValueSuccess<T> {
  ok: true;
  value: T;
}

interface IValueFailure {
  ok: false;
  diagnostic: IFrontmatterDiagnostic;
}

export type TValueResult<T> = IValueSuccess<T> | IValueFailure;
export type TYamlNode = ParsedNode | null;

interface IMetadataDecodeSuccess<M> {
  ok: true;
  value: M;
}

export type TMetadataDecodeResult<M> = IMetadataDecodeSuccess<M> | IFrontmatterDecodeFailure;
