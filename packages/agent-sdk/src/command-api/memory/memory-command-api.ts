import type {
  IMemoryCandidate,
  IMemoryEvent,
  IMemoryPendingRecord,
  IMemoryReference,
  TMemoryCandidateStatus,
} from '../../memory/automatic-memory-types.js';
import { containsSensitiveMemoryContent } from '../../memory/memory-policy-evaluator.js';
import { PendingMemoryStore } from '../../memory/pending-memory-store.js';
import {
  ProjectMemoryStore,
  isMemoryType,
  type IAppendMemoryInput,
  type IAppendMemoryResult,
  type IProjectMemorySummary,
  type IStartupMemory,
  type TMemoryType,
} from '../../memory/project-memory-store.js';
import type { ICommandHostContext } from '../host-context.js';
import type { ICommand } from '../types.js';

export const MEMORY_COMMAND_DESCRIPTION =
  'Project memory command. Use it to inspect project memory when stored context may help, save durable preferences, project conventions, feedback, or references worth reusing across sessions, review pending candidates, and report memory provenance. Do not store secrets, credentials, or transient facts.';
export const MEMORY_COMMAND_ARGUMENT_HINT =
  'list | show [topic] | add <user|feedback|project|reference> <topic> <text> | pending | approve <id> | reject <id> | used';
export const MEMORY_COMMAND_USAGE =
  'Usage: memory list | memory show [topic] | memory add <user|feedback|project|reference> <topic> <text> | memory pending | memory approve <id> | memory reject <id> | memory used';

export interface ICommandProjectMemoryStore {
  list(): IProjectMemorySummary;
  loadStartupMemory(): IStartupMemory;
  readTopic(topic: string): string;
  append(input: IAppendMemoryInput): IAppendMemoryResult;
}

export interface ICommandPendingMemoryStore {
  get(id: string): IMemoryPendingRecord | undefined;
  list(status?: TMemoryCandidateStatus): IMemoryPendingRecord[];
  mark(id: string, status: TMemoryCandidateStatus, reason: string): IMemoryPendingRecord;
  upsert(candidate: IMemoryCandidate, status: TMemoryCandidateStatus, reason: string): void;
}

export interface ICommandMemoryStores {
  project: ICommandProjectMemoryStore;
  pending: ICommandPendingMemoryStore;
}

export type {
  IAppendMemoryInput,
  IAppendMemoryResult,
  IMemoryCandidate,
  IMemoryEvent,
  IMemoryPendingRecord,
  IMemoryReference,
  IProjectMemorySummary,
  IStartupMemory,
  TMemoryCandidateStatus,
  TMemoryType,
};

export function buildMemoryCommandSubcommands(source = 'memory'): ICommand[] {
  return [
    { name: 'list', description: 'List project memory topics', source },
    { name: 'show', description: 'Show project memory index or a topic', source },
    { name: 'add', description: 'Save durable project memory', source },
    { name: 'pending', description: 'List pending memory candidates', source },
    { name: 'approve', description: 'Approve a pending memory candidate', source },
    { name: 'reject', description: 'Reject a pending memory candidate', source },
    {
      name: 'used',
      description: 'Show memory references used in the current turn',
      source,
    },
  ];
}

export function createCommandProjectMemoryStore(
  cwd: string,
  now?: () => Date,
): ICommandProjectMemoryStore {
  return new ProjectMemoryStore(cwd, now);
}

export function createCommandPendingMemoryStore(
  cwd: string,
  now?: () => Date,
): ICommandPendingMemoryStore {
  return new PendingMemoryStore(cwd, now);
}

export function createCommandMemoryStores(
  context: ICommandHostContext,
  now?: () => Date,
): ICommandMemoryStores {
  const cwd = context.getCwd();
  return {
    project: createCommandProjectMemoryStore(cwd, now),
    pending: createCommandPendingMemoryStore(cwd, now),
  };
}

export function isCommandMemoryType(value: string): value is TMemoryType {
  return isMemoryType(value);
}

export function hasSensitiveCommandMemoryContent(text: string): boolean {
  return containsSensitiveMemoryContent(text);
}

export function listCommandUsedMemoryReferences(
  context: ICommandHostContext,
): readonly IMemoryReference[] {
  return context.getUsedMemoryReferences();
}

export function recordCommandMemoryEvent(
  context: ICommandHostContext,
  event: Omit<IMemoryEvent, 'at'>,
  now: () => Date = () => new Date(),
): void {
  context.recordMemoryEvent({
    ...event,
    at: now().toISOString(),
  });
}
