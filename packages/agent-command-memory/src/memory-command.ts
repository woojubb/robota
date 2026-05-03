import type {
  IAppendMemoryInput,
  ICommandHostContext,
  ICommandPendingMemoryStore,
  ICommandProjectMemoryStore,
  ICommandResult,
  IMemoryEvent,
} from '@robota-sdk/agent-sdk';
import {
  MEMORY_COMMAND_USAGE,
  createCommandMemoryStores,
  hasSensitiveCommandMemoryContent,
  isCommandMemoryType,
  listCommandUsedMemoryReferences,
  recordCommandMemoryEvent,
} from '@robota-sdk/agent-sdk';

const SUBCOMMAND_INDEX = 0;
const TYPE_INDEX = 1;
const TOPIC_INDEX = 2;
const TEXT_START_INDEX = 3;

function usage(): ICommandResult {
  return {
    message: MEMORY_COMMAND_USAGE,
    success: false,
  };
}

function formatError(error: Error | string): ICommandResult {
  return {
    message: error instanceof Error ? error.message : String(error),
    success: false,
  };
}

function formatList(store: ICommandProjectMemoryStore): ICommandResult {
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

function formatShow(store: ICommandProjectMemoryStore, topic?: string): ICommandResult {
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

function parseAdd(args: readonly string[]): IAppendMemoryInput | undefined {
  const type = args[TYPE_INDEX];
  const topic = args[TOPIC_INDEX];
  const text = args.slice(TEXT_START_INDEX).join(' ').trim();

  if (!type || !isCommandMemoryType(type) || !topic || text.length === 0) return undefined;
  return { type, topic, text };
}

function formatPending(store: ICommandPendingMemoryStore): ICommandResult {
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

function recordEvent(context: ICommandHostContext, event: Omit<IMemoryEvent, 'at'>): void {
  recordCommandMemoryEvent(context, event);
}

function approvePending(
  context: ICommandHostContext,
  pendingStore: ICommandPendingMemoryStore,
  memoryStore: ICommandProjectMemoryStore,
  id: string | undefined,
): ICommandResult {
  if (!id) return usage();
  try {
    const approved = pendingStore.mark(id, 'approved', 'approved-by-user');
    const saved = memoryStore.append(approved);
    const record = pendingStore.mark(id, 'saved', 'approved-and-saved');
    recordEvent(context, {
      type: 'memory_candidate_approved',
      candidateId: record.id,
      topic: record.topic,
      reason: 'approved-by-user',
    });
    recordEvent(context, {
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
    return formatError(error instanceof Error ? error : String(error));
  }
}

function rejectPending(
  context: ICommandHostContext,
  pendingStore: ICommandPendingMemoryStore,
  id: string | undefined,
): ICommandResult {
  if (!id) return usage();
  try {
    const record = pendingStore.mark(id, 'rejected', 'rejected-by-user');
    recordEvent(context, {
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
    return formatError(error instanceof Error ? error : String(error));
  }
}

function formatUsed(context: ICommandHostContext): ICommandResult {
  const references = listCommandUsedMemoryReferences(context);
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
    data: { count: references.length, references: [...references] },
  };
}

export function executeMemoryCommand(
  context: ICommandHostContext,
  rawArgs: string,
): ICommandResult {
  const args = rawArgs.trim().split(/\s+/).filter(Boolean);
  const subcommand = args[SUBCOMMAND_INDEX] ?? 'list';
  const stores = createCommandMemoryStores(context);

  if (subcommand === 'list') return formatList(stores.project);
  if (subcommand === 'show') return formatShow(stores.project, args[TYPE_INDEX]);
  if (subcommand === 'pending') return formatPending(stores.pending);
  if (subcommand === 'approve')
    return approvePending(context, stores.pending, stores.project, args[TYPE_INDEX]);
  if (subcommand === 'reject') return rejectPending(context, stores.pending, args[TYPE_INDEX]);
  if (subcommand === 'used') return formatUsed(context);
  if (subcommand === 'add') {
    const input = parseAdd(args);
    if (!input) return usage();
    if (hasSensitiveCommandMemoryContent(input.text)) {
      return {
        message: 'Refusing to save sensitive memory content.',
        success: false,
      };
    }
    const result = stores.project.append(input);
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
