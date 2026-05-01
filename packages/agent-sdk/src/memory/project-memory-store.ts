import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from 'fs';
import { basename, join } from 'path';

export const MEMORY_INDEX_MAX_LINES = 200;
export const MEMORY_INDEX_MAX_BYTES = Number('25600');

export type TMemoryType = 'user' | 'feedback' | 'project' | 'reference';

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

function memoryRoot(cwd: string): string {
  return join(cwd, '.robota', 'memory');
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
  const normalized = topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TOPIC_LENGTH);
  return normalized || DEFAULT_TOPIC;
}

function formatEntry(date: Date, input: IAppendMemoryInput, topic: string): string {
  const day = date.toISOString().slice(0, DATE_LENGTH);
  const text = input.text.trim().replace(/\s+/g, ' ');
  return `[${day}] (${input.type}/${topic}) ${text}`;
}

export class ProjectMemoryStore {
  private readonly cwd: string;
  private readonly now: () => Date;

  constructor(cwd: string, now: () => Date = () => new Date()) {
    this.cwd = cwd;
    this.now = now;
  }

  getIndexPath(): string {
    return join(memoryRoot(this.cwd), INDEX_FILENAME);
  }

  getTopicsPath(): string {
    return join(memoryRoot(this.cwd), TOPICS_DIRNAME);
  }

  loadStartupMemory(): IStartupMemory {
    const path = this.getIndexPath();
    if (!existsSync(path)) {
      return { content: '', path, lineCount: 0, truncated: false };
    }

    const raw = readFileSync(path, 'utf8');
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
    const topics = existsSync(topicsPath)
      ? readdirSync(topicsPath, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(TOPIC_EXTENSION))
          .map((entry) => ({
            name: basename(entry.name, TOPIC_EXTENSION),
            path: join(topicsPath, entry.name),
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

    return {
      indexPath: this.getIndexPath(),
      topicsPath,
      topics,
    };
  }

  readTopic(topic: string): string {
    const normalized = sanitizeTopic(topic);
    const path = join(this.getTopicsPath(), `${normalized}${TOPIC_EXTENSION}`);
    if (!existsSync(path)) return '';
    return readFileSync(path, 'utf8').trimEnd();
  }

  append(input: IAppendMemoryInput): IAppendMemoryResult {
    const topic = sanitizeTopic(input.topic);
    const root = memoryRoot(this.cwd);
    const topicsPath = this.getTopicsPath();
    mkdirSync(topicsPath, { recursive: true });

    const indexPath = this.getIndexPath();
    const topicPath = join(topicsPath, `${topic}${TOPIC_EXTENSION}`);
    const entry = formatEntry(this.now(), input, topic);
    const topicHeader = existsSync(topicPath) ? '' : `# ${topic}\n\n`;

    if (!existsSync(indexPath)) {
      mkdirSync(root, { recursive: true });
      writeFileSync(indexPath, '# Project Memory\n\n', 'utf8');
    }

    appendFileSync(indexPath, `- ${entry}\n`, 'utf8');
    appendFileSync(topicPath, `${topicHeader}- ${entry}\n`, 'utf8');

    return { indexPath, topicPath, topic };
  }
}
