import type { TMemoryType } from './project-memory-store.js';
// IMemoryReference / IMemoryEvent SSOT relocated to @robota-sdk/agent-interface-transport (DATA-001).
import type { IMemoryEvent, IMemoryReference } from '@robota-sdk/agent-interface-transport';

export type { IMemoryEvent, IMemoryReference };

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

export interface IMemoryRetrievalResult {
  content: string;
  references: IMemoryReference[];
  truncated: boolean;
}
