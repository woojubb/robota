import type { IWorkspaceProjectStateStorage } from '../workspace-trust/index.js';

interface ITopicOverride {
  topic: string;
  /** Absent for a forgotten topic. No superseded memory text is retained. */
  entry?: string;
}
const FILENAME = 'lifecycle.json';

/** User-owned overrides remain authoritative even if a source-file cleanup is interrupted. */
export class MemoryTopicLifecycle {
  constructor(private readonly storage: IWorkspaceProjectStateStorage) {}

  list(): ITopicOverride[] {
    const raw = this.storage.readText(FILENAME, 'read memory lifecycle');
    if (raw === undefined) return [];
    const doc: unknown = JSON.parse(raw);
    if (
      !doc ||
      typeof doc !== 'object' ||
      !('version' in doc) ||
      doc.version !== 1 ||
      !('topics' in doc) ||
      !Array.isArray(doc.topics)
    ) {
      throw new Error('Invalid memory lifecycle; refusing to restore superseded memory.');
    }
    const topics: ITopicOverride[] = [];
    const seen = new Set<string>();
    for (const value of doc.topics) {
      if (
        !value ||
        typeof value !== 'object' ||
        typeof value.topic !== 'string' ||
        !/^[a-z0-9가-힣_-]{1,80}$/.test(value.topic) ||
        seen.has(value.topic) ||
        (value.entry !== undefined && typeof value.entry !== 'string')
      ) {
        throw new Error('Invalid memory lifecycle; refusing to restore superseded memory.');
      }
      seen.add(value.topic);
      topics.push({
        topic: value.topic,
        ...(value.entry !== undefined ? { entry: value.entry } : {}),
      });
    }
    return topics;
  }

  get(topic: string): ITopicOverride | undefined {
    return this.list().find((value) => value.topic === topic);
  }

  set(topic: string, entry?: string): void {
    const topics = this.list().filter((value) => value.topic !== topic);
    topics.push({ topic, ...(entry !== undefined ? { entry } : {}) });
    this.storage.writeText(
      FILENAME,
      JSON.stringify({ version: 1, topics }, null, 2),
      'persist user memory lifecycle',
    );
  }

  applyIndex(raw: string): string {
    const topics = this.list();
    const overridden = new Set(topics.map((value) => value.topic));
    const lines = raw.split(/\r?\n/).filter((line) => {
      const match = /^- \[[^\]]+\] \((?:user|feedback|project|reference)\/([^)]*)\) /.exec(line);
      return !match || !overridden.has(match[1]!);
    });
    const entries = topics.flatMap((value) =>
      value.entry === undefined ? [] : [`- ${value.entry}`],
    );
    return [...lines, ...entries].join('\n').trimEnd();
  }
}
