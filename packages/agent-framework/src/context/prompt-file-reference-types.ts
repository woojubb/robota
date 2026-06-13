import type { IFileSystemAsync } from '@robota-sdk/agent-core';
// IPromptFileReferenceRecord / TPromptFileReferenceReason SSOT relocated to
// @robota-sdk/agent-interface-transport (DATA-001).
import type {
  IPromptFileReferenceRecord,
  TPromptFileReferenceReason,
} from '@robota-sdk/agent-interface-transport';

export type { IPromptFileReferenceRecord, TPromptFileReferenceReason };

export type TPromptFileReferenceDiagnosticCode =
  | 'not-found'
  | 'outside-root'
  | 'directory-not-supported'
  | 'file-too-large'
  | 'total-too-large'
  | 'too-many-references'
  | 'max-depth'
  | 'circular-reference'
  | 'unreadable';

export interface IPromptFileReferenceToken {
  original: string;
  path: string;
  index: number;
}

export interface IResolvedPromptFileReference extends IPromptFileReferenceRecord {
  content: string;
}

export interface IPromptFileReferenceDiagnostic {
  code: TPromptFileReferenceDiagnosticCode;
  severity: 'error';
  reference: string;
  message: string;
  path?: string;
}

export interface IPromptFileReferenceLimits {
  maxDepth?: number;
  maxReferences?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export interface IPromptFileReferenceResolveOptions {
  cwd: string;
  limits?: IPromptFileReferenceLimits;
  reason?: TPromptFileReferenceReason;
  fsAsync?: IFileSystemAsync;
}

export interface IResolvedPromptFileReferences {
  references: IResolvedPromptFileReference[];
  diagnostics: IPromptFileReferenceDiagnostic[];
}

export interface IPromptFileReferenceHistoryData {
  message: string;
  references: IPromptFileReferenceRecord[];
}
