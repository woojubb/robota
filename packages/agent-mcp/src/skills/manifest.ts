import { createHash } from 'node:crypto';
import type { IMCPServerIdentity } from '../catalog/types.js';
import type { IMCPSkillEntry, IMCPSkillResource } from './types.js';

export class MCPSkillError extends Error {
  constructor(
    readonly reason:
      | 'invalid-manifest'
      | 'unsupported-dynamic'
      | 'changed-manifest'
      | 'missing-resource'
      | 'size-mismatch'
      | 'digest-mismatch'
      | 'invalid-resource'
      | 'page-bound',
  ) {
    super(`MCP skill refused: ${reason}`);
    this.name = 'MCPSkillError';
  }
}

function invalid(): never {
  throw new MCPSkillError('invalid-manifest');
}

function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

/** Deterministic JSON without mutating peer objects or assigning attacker-chosen object keys. */
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return invalid();
}

function resourceWithin(skillUri: string, fileUri: string): boolean {
  try {
    const root = new URL(skillUri);
    const file = new URL(fileUri);
    const directory = root.pathname.slice(0, root.pathname.lastIndexOf('/') + 1);
    return (
      root.protocol === file.protocol &&
      root.host === file.host &&
      root.username === file.username &&
      root.password === file.password &&
      file.pathname.startsWith(directory) &&
      !file.pathname.endsWith('/')
    );
  } catch {
    return false;
  }
}

export function parseSkillEntry(raw: unknown, identity: IMCPServerIdentity): IMCPSkillEntry {
  if (!record(raw) || typeof raw.uri !== 'string' || !record(raw.frontmatter)) return invalid();
  const { name, description } = raw.frontmatter;
  if (
    typeof name !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) ||
    name.length > 64 ||
    typeof description !== 'string' ||
    description.length === 0 ||
    description.length > 1024
  )
    return invalid();
  try {
    const uri = new URL(raw.uri);
    const path = `${uri.host}${uri.pathname}`.split('/');
    if (path.at(-1) !== 'SKILL.md' || decodeURIComponent(path.at(-2) ?? '') !== name)
      return invalid();
  } catch {
    return invalid();
  }
  const frontmatter = JSON.parse(canonical(raw.frontmatter)) as IMCPSkillEntry['frontmatter'];
  let resources: IMCPSkillResource[] | 'dynamic';
  if (raw.resources === 'dynamic') resources = 'dynamic';
  else {
    if (!Array.isArray(raw.resources) || raw.resources.length < 1 || raw.resources.length > 512)
      return invalid();
    const seen = new Set<string>();
    let total = 0;
    resources = raw.resources.map((value) => {
      if (
        !record(value) ||
        typeof value.uri !== 'string' ||
        typeof value.digest !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(value.digest) ||
        typeof value.size !== 'number' ||
        !Number.isSafeInteger(value.size) ||
        value.size < 0 ||
        seen.has(value.uri) ||
        !resourceWithin(raw.uri as string, value.uri)
      )
        return invalid();
      seen.add(value.uri);
      total += value.size;
      if (total > 16 * 1024 * 1024) return invalid();
      return { uri: value.uri, digest: value.digest, size: value.size };
    });
    if (!seen.has(raw.uri)) return invalid();
  }
  const manifestFingerprint = createHash('sha256')
    .update(
      canonical({
        uri: raw.uri,
        frontmatter,
        resources:
          resources === 'dynamic'
            ? resources
            : [...resources].sort((a, b) => (a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0)),
      }),
    )
    .digest('hex');
  return { identity: { ...identity }, uri: raw.uri, frontmatter, resources, manifestFingerprint };
}

export function verifySkillResource(
  entry: IMCPSkillEntry,
  uri: string,
  raw: unknown,
): { uri: string; text?: string; blob?: string; mimeType?: string; digest: string; size: number } {
  if (entry.resources === 'dynamic') throw new MCPSkillError('unsupported-dynamic');
  const manifest = entry.resources.find((resource) => resource.uri === uri);
  if (!manifest) throw new MCPSkillError('missing-resource');
  if (
    !record(raw) ||
    raw.uri !== uri ||
    (raw.mimeType !== undefined && typeof raw.mimeType !== 'string') ||
    !(
      (typeof raw.text === 'string' && !('blob' in raw)) ||
      (typeof raw.blob === 'string' && !('text' in raw))
    )
  )
    throw new MCPSkillError('invalid-resource');
  let bytes: Buffer;
  if (typeof raw.text === 'string') bytes = Buffer.from(raw.text, 'utf8');
  else {
    if (typeof raw.blob !== 'string') throw new MCPSkillError('invalid-resource');
    try {
      // Match standard resource decoding, including omitted padding and ASCII whitespace,
      // without a repeating regexp that can overflow on a supported 16 MiB binary file.
      bytes = Buffer.from(atob(raw.blob), 'latin1');
    } catch {
      throw new MCPSkillError('invalid-resource');
    }
  }
  if (bytes.byteLength !== manifest.size) throw new MCPSkillError('size-mismatch');
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (digest !== manifest.digest) throw new MCPSkillError('digest-mismatch');
  return {
    uri,
    digest,
    size: bytes.byteLength,
    ...(typeof raw.text === 'string' ? { text: raw.text } : { blob: raw.blob as string }),
    ...(raw.mimeType === undefined ? {} : { mimeType: raw.mimeType }),
  };
}
