import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { TMemoryType } from './project-memory-store.js';

export type TMemoryPolicyMode = 'disabled' | 'approval_required' | 'auto_save';

export type TMemoryCandidateStatus = 'pending' | 'approved' | 'rejected' | 'saved' | 'skipped';

export type TMemoryDecisionAction = 'skip' | 'queue' | 'save';

export interface IAutomaticMemoryConfig {
  policy: TMemoryPolicyMode;
  retrieval: {
    maxTopics: number;
    maxTopicChars: number;
  };
}

export interface IMemoryCandidate {
  id: string;
  type: TMemoryType;
  topic: string;
  text: string;
  sourceMessageIds: string[];
  confidence: number;
  createdAt: string;
  reason: string;
}

export interface IMemoryExtractionInput {
  sessionId: string;
  turnId: string;
  userMessage: string;
  assistantMessage: string;
  now: Date;
}

export interface IMemoryDecision {
  action: TMemoryDecisionAction;
  reason: string;
}

export interface IMemoryPendingRecord extends IMemoryCandidate {
  status: TMemoryCandidateStatus;
  updatedAt: string;
  decisionReason?: string;
}

export interface IMemoryReference {
  topic: string;
  path: string;
  score: number;
  truncated: boolean;
}

export interface IMemoryRetrievalResult {
  content: string;
  references: IMemoryReference[];
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
