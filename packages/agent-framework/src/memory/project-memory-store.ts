import { basename, join } from 'node:path';

import { trimEdgeChars } from '../utils/trim-char.js';
import { assertWorkspaceProjectStateStorage } from '../workspace-trust/index.js';

import type { IWorkspaceProjectStateStorage } from '../workspace-trust/index.js';
// TMemoryType SSOT relocated to @robota-sdk/agent-interface-transport (DATA-001).
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

function sanitizeTopic(topic: string): string {
  const collapsed = topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/g, '-');
  // `trimEdgeChars` rather than `/^-+|-+$/g`: `-` survives the collapse above (it is inside the kept class), so
  // a long dash run reaches the trailing half of that alternation, which is quadratic (SEC-003).
  const normalized = trimEdgeChars(collapsed, '-').slice(0, MAX_TOPIC_LENGTH);
  return normalized || DEFAULT_TOPIC;
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

  constructor(storage: IWorkspaceProjectStateStorage, now: () => Date = () => new Date()) {
    this.storage = assertWorkspaceProjectStateStorage(storage);
    if (storage.namespace !== 'memory') {
      throw new Error('ProjectMemoryStore requires the memory state namespace.');
    }
    this.now = now;
  }

  getIndexPath(): string {
    return this.storage.projectRelativePath(INDEX_FILENAME);
  }

  getTopicsPath(): string {
    return this.storage.projectRelativePath(TOPICS_DIRNAME);
  }

  loadStartupMemory(): IStartupMemory {
    const path = this.getIndexPath();
    const raw = this.storage.readText(INDEX_FILENAME, 'load startup memory');
    if (raw === undefined) return { content: '', path, lineCount: 0, truncated: false };
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
    const topics = this.storage
      .listDirectory(TOPICS_DIRNAME, 'list memory topics')
      .filter((entry) => entry.kind === 'file' && entry.name.endsWith(TOPIC_EXTENSION))
      .map((entry) => ({
        name: basename(entry.name, TOPIC_EXTENSION),
        path: this.storage.projectRelativePath(join(TOPICS_DIRNAME, entry.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      indexPath: this.getIndexPath(),
      topicsPath,
      topics,
    };
  }

  readTopic(topic: string): string {
    const normalized = sanitizeTopic(topic);
    return (
      this.storage.readText(
        join(TOPICS_DIRNAME, `${normalized}${TOPIC_EXTENSION}`),
        'read memory topic',
      ) ?? ''
    ).trimEnd();
  }

  append(input: IAppendMemoryInput): IAppendMemoryResult {
    const topic = sanitizeTopic(input.topic);
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
}
