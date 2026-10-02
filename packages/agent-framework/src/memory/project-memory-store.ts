import { basename, join } from 'node:path';

import { trimEdgeChars } from '../utils/trim-char.js';
import { MemoryTopicLifecycle } from './memory-topic-lifecycle.js';
import { assertWorkspaceProjectStateStorage } from '../workspace-trust/index.js';

import type { IWorkspaceProjectStateStorage } from '../workspace-trust/index.js';
// TMemoryType SSOT relocated to @robota-sdk/agent-interface-session (DATA-001).
import type { TMemoryType } from '@robota-sdk/agent-interface-session';

export type { TMemoryType };

export const MEMORY_INDEX_MAX_LINES = 200;
export const MEMORY_INDEX_MAX_BYTES = Number('25600');

export interface IStartupMemory {
  content: string;
  path: string;
  lineCount: number;
  truncated: boolean;
}

export interface IMemoryTopicSummary {
  name: string;
  path: string;
}

export interface IProjectMemorySummary {
  indexPath: string;
  topicsPath: string;
  topics: IMemoryTopicSummary[];
}

export interface IAppendMemoryInput {
  type: TMemoryType;
  topic: string;
  text: string;
}

export interface IAppendMemoryResult {
  indexPath: string;
  topicPath: string;
  topic: string;
  deduplicated: boolean;
}

const INDEX_FILENAME = 'MEMORY.md';
const TOPICS_DIRNAME = 'topics';
const DATE_LENGTH = 10;
const MAX_TOPIC_LENGTH = 80;
const DEFAULT_TOPIC = 'general';
const TOPIC_EXTENSION = '.md';

const VALID_TYPES: readonly TMemoryType[] = ['user', 'feedback', 'project', 'reference'];

export function isMemoryType(value: string): value is TMemoryType {
  return VALID_TYPES.includes(value as TMemoryType);
}

function truncateToUtf8Bytes(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.byteLength <= maxBytes) return value;
  return buffer.subarray(0, maxBytes).toString('utf8');
}

function limitLines(value: string, maxLines: number): { content: string; truncated: boolean } {
  const lines = value.split(/\r?\n/);
  const limited = lines.slice(0, maxLines);
  return {
    content: limited.join('\n').trimEnd(),
    truncated: lines.length > maxLines,
  };
}

export function sanitizeTopic(topic: string): string {
  const collapsed = topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/g, '-');
  // `trimEdgeChars` rather than `/^-+|-+$/g`: `-` survives the collapse above (it is inside the kept class), so
  // a long dash run reaches the trailing half of that alternation, which is quadratic (SEC-003).
  const normalized = trimEdgeChars(collapsed, '-').slice(0, MAX_TOPIC_LENGTH);
  return normalized || DEFAULT_TOPIC;
}

export class MemoryTopicCuratedError extends Error {
  constructor() {
    super(
      'This topic is controlled by the user. Use /memory correct <type> <topic> <text> to replace or restore it.',
    );
    this.name = 'MemoryTopicCuratedError';
  }
}

function mutationTopic(topic: string): string {
  if (!/[a-z0-9가-힣]/i.test(topic)) throw new Error('A nonempty memory topic is required.');
  return sanitizeTopic(topic);
}

function formatEntry(date: Date, input: IAppendMemoryInput, topic: string): string {
  const day = date.toISOString().slice(0, DATE_LENGTH);
  const text = input.text.trim().replace(/\s+/g, ' ');
  return `[${day}] (${input.type}/${topic}) ${text}`;
}

function normalizeMemoryText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export class ProjectMemoryStore {
  private readonly storage: IWorkspaceProjectStateStorage;
  private readonly now: () => Date;
  private readonly lifecycle: MemoryTopicLifecycle;

  constructor(storage: IWorkspaceProjectStateStorage, now: () => Date = () => new Date()) {
    this.storage = assertWorkspaceProjectStateStorage(storage);
    if (storage.namespace !== 'memory') {
      throw new Error('ProjectMemoryStore requires the memory state namespace.');
    }
    this.now = now;
    this.lifecycle = new MemoryTopicLifecycle(storage);
  }

  getIndexPath(): string {
    return this.storage.projectRelativePath(INDEX_FILENAME);
  }

  getTopicsPath(): string {
    return this.storage.projectRelativePath(TOPICS_DIRNAME);
  }

  loadStartupMemory(): IStartupMemory {
    const path = this.getIndexPath();
    const raw = this.lifecycle.applyIndex(
      this.storage.readText(INDEX_FILENAME, 'load startup memory') ?? '',
    );
    const byBytes = truncateToUtf8Bytes(raw, MEMORY_INDEX_MAX_BYTES);
    const byteTruncated = Buffer.byteLength(raw, 'utf8') > MEMORY_INDEX_MAX_BYTES;
    const byLines = limitLines(byBytes, MEMORY_INDEX_MAX_LINES);

    return {
      content: byLines.content,
      path,
      lineCount: byLines.content.length === 0 ? 0 : byLines.content.split(/\r?\n/).length,
      truncated: byteTruncated || byLines.truncated,
    };
  }

  list(): IProjectMemorySummary {
    const topicsPath = this.getTopicsPath();
    const overrides = this.lifecycle.list();
    const overridden = new Set(overrides.map((value) => value.topic));
    const topics = this.storage
      .listDirectory(TOPICS_DIRNAME, 'list memory topics')
      .filter((entry) => entry.kind === 'file' && entry.name.endsWith(TOPIC_EXTENSION))
      .map((entry) => ({
        name: basename(entry.name, TOPIC_EXTENSION),
        path: this.storage.projectRelativePath(join(TOPICS_DIRNAME, entry.name)),
      }))
      .filter((topic) => !overridden.has(topic.name));
    for (const value of overrides) {
      if (value.entry !== undefined)
        topics.push({
          name: value.topic,
          path: this.storage.projectRelativePath(
            join(TOPICS_DIRNAME, `${value.topic}${TOPIC_EXTENSION}`),
          ),
        });
    }
    topics.sort((a, b) => a.name.localeCompare(b.name));

    return {
      indexPath: this.getIndexPath(),
      topicsPath,
      topics,
    };
  }

  readTopic(topic: string): string {
    const normalized = sanitizeTopic(topic);
    const override = this.lifecycle.get(normalized);
    if (override)
      return override.entry === undefined ? '' : `# ${normalized}\n\n- ${override.entry}`;
    return (
      this.storage.readText(
        join(TOPICS_DIRNAME, `${normalized}${TOPIC_EXTENSION}`),
        'read memory topic',
      ) ?? ''
    ).trimEnd();
  }

  append(input: IAppendMemoryInput): IAppendMemoryResult {
    const topic = sanitizeTopic(input.topic);
    if (this.isTopicCurated(topic)) throw new MemoryTopicCuratedError();
    const indexPath = this.getIndexPath();
    const topicRelativePath = join(TOPICS_DIRNAME, `${topic}${TOPIC_EXTENSION}`);
    const topicPath = this.storage.projectRelativePath(topicRelativePath);
    const entry = formatEntry(this.now(), input, topic);
    const existingTopic = this.storage.readText(topicRelativePath, 'deduplicate memory topic');
    const topicHeader = existingTopic === undefined ? `# ${topic}\n\n` : '';
    const normalizedText = normalizeMemoryText(input.text);

    if (existingTopic?.includes(`) ${normalizedText}`) === true) {
      return { indexPath, topicPath, topic, deduplicated: true };
    }

    if (this.storage.readText(INDEX_FILENAME, 'inspect memory index') === undefined) {
      this.storage.writeText(INDEX_FILENAME, '# Project Memory\n\n', 'initialize memory index');
    }

    this.storage.appendText(INDEX_FILENAME, `- ${entry}\n`, 'append memory index');
    this.storage.appendText(topicRelativePath, `${topicHeader}- ${entry}\n`, 'append memory topic');

    return { indexPath, topicPath, topic, deduplicated: false };
  }

  isTopicCurated(topic: string): boolean {
    return this.lifecycle.get(sanitizeTopic(topic)) !== undefined;
  }

  replaceTopic(input: IAppendMemoryInput): { topic: string; topicPath: string; indexPath: string } {
    if (!isMemoryType(input.type) || input.text.trim().length === 0)
      throw new Error('A memory type and nonempty replacement are required.');
    const topic = mutationTopic(input.topic);
    const entry = formatEntry(this.now(), input, topic);
    this.lifecycle.set(topic, entry);
    const topicRelativePath = join(TOPICS_DIRNAME, `${topic}${TOPIC_EXTENSION}`);
    this.storage.writeText(topicRelativePath, `# ${topic}\n\n- ${entry}\n`, 'replace memory topic');
    this.persistCuratedIndex();
    return {
      topic,
      topicPath: this.storage.projectRelativePath(topicRelativePath),
      indexPath: this.getIndexPath(),
    };
  }

  forgetTopic(input: string): { topic: string; topicPath: string; indexPath: string } {
    const topic = mutationTopic(input);
    this.lifecycle.set(topic);
    const topicRelativePath = join(TOPICS_DIRNAME, `${topic}${TOPIC_EXTENSION}`);
    this.storage.deleteFile(topicRelativePath, 'forget memory topic');
    this.persistCuratedIndex();
    return {
      topic,
      topicPath: this.storage.projectRelativePath(topicRelativePath),
      indexPath: this.getIndexPath(),
    };
  }

  private persistCuratedIndex(): void {
    const raw =
      this.storage.readText(INDEX_FILENAME, 'read memory index for curation') ??
      '# Project Memory\n\n';
    this.storage.writeText(
      INDEX_FILENAME,
      `${this.lifecycle.applyIndex(raw)}\n`,
      'persist curated memory index',
    );
  }
}
