import type { ICommandResult } from './system-command.js';
import type { InteractiveSession } from '../interactive/interactive-session.js';
import type { IMemoryEvent } from '../memory/automatic-memory-types.js';
import { PendingMemoryStore } from '../memory/pending-memory-store.js';
import {
  ProjectMemoryStore,
  isMemoryType,
  type TMemoryType,
} from '../memory/project-memory-store.js';

const SUBCOMMAND_INDEX = 0;
const TYPE_INDEX = 1;
const TOPIC_INDEX = 2;
const TEXT_START_INDEX = 3;

function usage(): ICommandResult {
  return {
    message:
      'Usage: memory list | memory show [topic] | memory add <user|feedback|project|reference> <topic> <text> | memory pending | memory approve <id> | memory reject <id> | memory used',
    success: false,
  };
}

function formatList(store: ProjectMemoryStore): ICommandResult {
  const summary = store.list();
  const topics =
    summary.topics.length > 0
      ? summary.topics.map((topic) => `- ${topic.name}: ${topic.path}`).join('\n')
      : '(none)';

  return {
    message: [
      `Memory index: ${summary.indexPath}`,
      `Topics directory: ${summary.topicsPath}`,
      'Topics:',
      topics,
    ].join('\n'),
    success: true,
    data: {
      indexPath: summary.indexPath,
      topicsPath: summary.topicsPath,
      topicCount: summary.topics.length,
    },
  };
}

function formatShow(store: ProjectMemoryStore, topic?: string): ICommandResult {
  if (!topic || topic === 'index') {
    const memory = store.loadStartupMemory();
    return {
      message: memory.content || '(empty memory index)',
      success: true,
      data: {
        path: memory.path,
        lineCount: memory.lineCount,
        truncated: memory.truncated,
      },
    };
  }

  const content = store.readTopic(topic);
  return {
    message: content || `(empty memory topic: ${topic})`,
    success: true,
    data: { topic },
  };
}

function parseAdd(args: string[]): { type: TMemoryType; topic: string; text: string } | undefined {
  const type = args[TYPE_INDEX];
  const topic = args[TOPIC_INDEX];
  const text = args.slice(TEXT_START_INDEX).join(' ').trim();

  if (!type || !isMemoryType(type) || !topic || text.length === 0) return undefined;
  return { type, topic, text };
}

function formatPending(store: PendingMemoryStore): ICommandResult {
  const records = store.list('pending');
  const lines =
    records.length > 0
      ? records.map(
          (record) =>
            `- ${record.id} ${record.type}/${record.topic} confidence=${record.confidence}: ${record.text}`,
        )
      : ['(no pending memory candidates)'];

  return {
    message: ['Pending memory candidates:', ...lines].join('\n'),
    success: true,
    data: { count: records.length },
  };
}

function recordEvent(session: InteractiveSession, event: Omit<IMemoryEvent, 'at'>): void {
  session.recordMemoryEvent({
    ...event,
    at: new Date().toISOString(),
  });
}

function approvePending(
  session: InteractiveSession,
  pendingStore: PendingMemoryStore,
  memoryStore: ProjectMemoryStore,
  id: string | undefined,
): ICommandResult {
  if (!id) return usage();
  try {
    const approved = pendingStore.mark(id, 'approved', 'approved-by-user');
    const saved = memoryStore.append(approved);
    const record = pendingStore.mark(id, 'saved', 'approved-and-saved');
    recordEvent(session, {
      type: 'memory_candidate_approved',
      candidateId: record.id,
      topic: record.topic,
      reason: 'approved-by-user',
    });
    recordEvent(session, {
      type: 'memory_candidate_saved',
      candidateId: record.id,
      topic: record.topic,
      reason: saved.deduplicated ? 'deduplicated' : 'approved-and-saved',
    });
    return {
      message: saved.deduplicated
        ? `Saved memory candidate ${id} was already present in ${saved.topicPath}`
        : `Saved memory candidate ${id} to ${saved.topicPath}`,
      success: true,
      data: {
        id,
        status: record.status,
        topic: saved.topic,
        topicPath: saved.topicPath,
        deduplicated: saved.deduplicated,
      },
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      success: false,
    };
  }
}

function rejectPending(
  session: InteractiveSession,
  pendingStore: PendingMemoryStore,
  id: string | undefined,
): ICommandResult {
  if (!id) return usage();
  try {
    const record = pendingStore.mark(id, 'rejected', 'rejected-by-user');
    recordEvent(session, {
      type: 'memory_candidate_rejected',
      candidateId: record.id,
      topic: record.topic,
      reason: 'rejected-by-user',
    });
    return {
      message: `Rejected memory candidate ${id}`,
      success: true,
      data: { id, status: record.status },
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      success: false,
    };
  }
}

function formatUsed(session: InteractiveSession): ICommandResult {
  const references = session.getUsedMemoryReferences();
  const lines =
    references.length > 0
      ? references.map((reference) => {
          const suffix = reference.truncated ? ' truncated=true' : '';
          return `- ${reference.topic} score=${reference.score}${suffix}: ${reference.path}`;
        })
      : ['(no memory used in current turn)'];

  return {
    message: ['Used memory references:', ...lines].join('\n'),
    success: true,
    data: { count: references.length, references },
  };
}

export function executeMemoryCommand(session: InteractiveSession, rawArgs: string): ICommandResult {
  const args = rawArgs.trim().split(/\s+/).filter(Boolean);
  const subcommand = args[SUBCOMMAND_INDEX] ?? 'list';
  const store = new ProjectMemoryStore(session.getCwd());
  const pendingStore = new PendingMemoryStore(session.getCwd());

  if (subcommand === 'list') return formatList(store);
  if (subcommand === 'show') return formatShow(store, args[TYPE_INDEX]);
  if (subcommand === 'pending') return formatPending(pendingStore);
  if (subcommand === 'approve')
    return approvePending(session, pendingStore, store, args[TYPE_INDEX]);
  if (subcommand === 'reject') return rejectPending(session, pendingStore, args[TYPE_INDEX]);
  if (subcommand === 'used') return formatUsed(session);
  if (subcommand === 'add') {
    const input = parseAdd(args);
    if (!input) return usage();
    const result = store.append(input);
    return {
      message: result.deduplicated
        ? `${input.type} memory already exists in ${result.topicPath}`
        : `Saved ${input.type} memory to ${result.topicPath}`,
      success: true,
      data: {
        indexPath: result.indexPath,
        topicPath: result.topicPath,
        topic: result.topic,
        deduplicated: result.deduplicated,
      },
    };
  }

  return usage();
}
