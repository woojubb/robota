/**
 * Session-event payload contracts referenced by the interactive session surface.
 *
 * SSOT for the event/record payload shapes (skill activation, automatic memory,
 * prompt file references, context references) consumed by transports through
 * IInteractiveSessionEvents and IInteractiveSessionRecord. The runtime that emits
 * these events lives in agent-framework and imports these declarations.
 */

import type { TUniversalValue } from '@robota-sdk/agent-core';

export type TSkillActivationSource = 'skill' | 'plugin';
export type TSkillActivationInvocation = 'user-slash' | 'model-tool';
export type TSkillActivationMode = 'inject' | 'fork';
export type TSkillActivationStatus = 'started' | 'completed' | 'failed';

export interface ISkillActivationEvent {
  readonly type: 'skill-activation';
  readonly skillName: string;
  readonly source: TSkillActivationSource;
  readonly invocation: TSkillActivationInvocation;
  readonly mode: TSkillActivationMode;
  readonly status: TSkillActivationStatus;
  readonly timestamp: string;
  readonly qualifiedName?: string;
  readonly error?: string;
}

export type TMemoryType = 'user' | 'feedback' | 'project' | 'reference';

export interface IMemoryReference {
  topic: string;
  path: string;
  score: number;
  truncated: boolean;
}

export interface IMemoryEvent {
  type:
    | 'memory_candidate_extracted'
    | 'memory_candidate_queued'
    | 'memory_candidate_saved'
    | 'memory_candidate_skipped'
    | 'memory_candidate_approved'
    | 'memory_candidate_rejected'
    | 'memory_retrieved';
  at: string;
  candidateId?: string;
  topic?: string;
  reason?: string;
  data?: Record<string, TUniversalValue>;
}

export type TPromptFileReferenceReason = 'manual' | 'prompt-reference';

export interface IPromptFileReferenceRecord {
  originalReference: string;
  sourcePath: string;
  relativePath: string;
  reason: TPromptFileReferenceReason;
  depth: number;
  byteLength: number;
}

export type TContextReferenceLoadType = 'manual' | 'prompt-reference' | 'system';
export type TContextReferenceStatus = 'active' | 'observed';

export interface IContextReferenceItem {
  id: string;
  sourcePath: string;
  relativePath: string;
  originalReference: string;
  loadType: TContextReferenceLoadType;
  status: TContextReferenceStatus;
  byteLength: number;
  loadedAt: string;
  lastUsedAt?: string;
}
