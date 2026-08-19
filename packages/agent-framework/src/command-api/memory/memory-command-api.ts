import { containsSensitiveMemoryContent } from '../../memory/memory-policy-evaluator.js';
import {
  isMemoryType,
  type IAppendMemoryInput,
  type IAppendMemoryResult,
  type IProjectMemorySummary,
  type IStartupMemory,
  type TMemoryType,
} from '../../memory/project-memory-store.js';

import type {
  IMemoryCandidate,
  IMemoryEvent,
  IMemoryPendingRecord,
  IMemoryReference,
  TMemoryCandidateStatus,
} from '../../memory/automatic-memory-types.js';
import type {
  IDurableMemoryReader,
  IMemoryCurationQueue,
  IMemoryStore,
  IMemoryWriter,
} from '../../memory/types.js';
import type { ICommandHostMemory } from '../host-context.js';
import type { ICommand } from '../types.js';

export const MEMORY_COMMAND_DESCRIPTION =
  'Project memory command. Use it to inspect project memory when stored context may help, save durable preferences, project conventions, feedback, or references worth reusing across sessions, review pending candidates, and report memory provenance. Do not store secrets, credentials, or transient facts.';
export const MEMORY_COMMAND_ARGUMENT_HINT =
  'list | show [topic] | add <user|feedback|project|reference> <topic> <text> | pending | approve <id> | reject <id> | used';
export const MEMORY_COMMAND_USAGE =
  'Usage: memory list | memory show [topic] | memory add <user|feedback|project|reference> <topic> <text> | memory pending | memory approve <id> | memory reject <id> | memory used';

// SELFHOST-008 P1R: the `/memory` command consumes the segregated durable-memory port role interfaces
// (`IDurableMemoryReader` + `IMemoryWriter` + `IMemoryCurationQueue`) directly — the prior
// `ICommandProjectMemoryStore`/`ICommandPendingMemoryStore` were a duplicate decomposition of the same
// stores and are removed. `createCommandMemoryStores` returns the INJECTED `IMemoryStore` so a swapped
// backend is authoritative for command operations too (no split-brain), defaulting to the fs store.
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
  IDurableMemoryReader,
  IMemoryWriter,
  IMemoryCurationQueue,
  IMemoryStore,
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

/**
 * The durable-memory port the `/memory` command reads/writes through — the SAME `IMemoryStore`
 * instance the session uses for startup injection and capture.
 *
 * ARCH-029 TC-09: this used to fall back to `createFileSystemMemoryStore(context.getCwd(), now)`
 * when the host injected none. That default was redundant, not load-bearing —
 * `InteractiveSession.getMemoryStore()` already did `??= createFileSystemMemoryStore(this.getCwd())`
 * itself, so the framework was re-deriving what the one production host already owned. With the
 * member required there is one owner. `now` went with the fallback: no caller ever passed it, and
 * `ICommandHostWorkspace` went with `getCwd()` — a role the body no longer reads.
 */
export function createCommandMemoryStores(context: ICommandHostMemory): IMemoryStore {
  return context.getMemoryStore();
}

export function isCommandMemoryType(value: string): value is TMemoryType {
  return isMemoryType(value);
}

export function hasSensitiveCommandMemoryContent(text: string): boolean {
  return containsSensitiveMemoryContent(text);
}

export function listCommandUsedMemoryReferences(
  context: ICommandHostMemory,
): readonly IMemoryReference[] {
  return context.getUsedMemoryReferences();
}

export function recordCommandMemoryEvent(
  context: ICommandHostMemory,
  event: Omit<IMemoryEvent, 'at'>,
  now: () => Date = () => new Date(),
): void {
  context.recordMemoryEvent({
    ...event,
    at: now().toISOString(),
  });
}
