import type { TModelEffort } from '@robota-sdk/agent-core';

export type TFrontmatterKind = 'skill' | 'agent';
export type TFrontmatterContext = 'inject' | 'fork';

export interface IFrontmatterDecodeOptions {
  readonly kind: TFrontmatterKind;
  readonly source: string;
}

export type TFrontmatterDiagnosticCode =
  | 'missing-opening-marker'
  | 'missing-closing-marker'
  | 'empty-block'
  | 'malformed-line'
  | 'unknown-key'
  | 'duplicate-key'
  | 'missing-required-field'
  | 'empty-value'
  | 'wrong-value-shape'
  | 'invalid-boolean'
  | 'invalid-list'
  | 'invalid-positive-integer'
  | 'invalid-context'
  | 'invalid-model'
  | 'invalid-effort';

export interface IFrontmatterDiagnostic {
  readonly code: TFrontmatterDiagnosticCode;
  readonly source: string;
  readonly line?: number;
  readonly field?: string;
  readonly message: string;
}

export interface IDecodedSkillFrontmatter {
  readonly kind: 'skill';
  readonly name: string;
  readonly description: string;
  readonly argumentHint?: string;
  readonly disableModelInvocation?: boolean;
  readonly userInvocable?: boolean;
  readonly allowedTools?: readonly string[];
  readonly model?: string;
  readonly effort?: TModelEffort;
  readonly context?: TFrontmatterContext;
  readonly agent?: string;
}

export interface IDecodedAgentFrontmatter {
  readonly kind: 'agent';
  readonly name: string;
  readonly description: string;
  readonly model?: string;
  readonly maxTurns?: number;
  readonly tools?: readonly string[];
  readonly disallowedTools?: readonly string[];
}

export type TDecodedFrontmatter = IDecodedSkillFrontmatter | IDecodedAgentFrontmatter;

export type TFrontmatterDecodeResult =
  | { readonly status: 'valid'; readonly value: TDecodedFrontmatter }
  | {
      readonly status: 'invalid';
      readonly diagnostics: readonly IFrontmatterDiagnostic[];
      readonly value?: undefined;
    };
