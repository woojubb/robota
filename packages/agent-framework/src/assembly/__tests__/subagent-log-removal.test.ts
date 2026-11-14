import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SubagentLogRemovalRefusedError, removeSubagentLogs } from '../subagent-log-removal.js';

let scratch: string;
let logRoot: string;
let outside: string;

beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'subagent-log-removal-')));
  logRoot = join(scratch, 'logs');
  outside = join(scratch, 'outside');
  mkdirSync(logRoot);
  mkdirSync(outside);
  writeFileSync(join(outside, 'keep.txt'), 'keep');
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function seed(parent: string): void {
  const subagents = join(logRoot, parent, 'subagents');
  mkdirSync(join(subagents, 'task_1.payloads', 'nested'), { recursive: true });
  writeFileSync(join(subagents, 'task_1.jsonl'), '{}\n');
  writeFileSync(join(subagents, 'task_1.payloads', 'a.json'), '{}');
  writeFileSync(join(subagents, 'task_1.payloads', 'nested', 'b.json'), '{}');
}

/** Directory links need elevation on Windows; a junction does not. */
function linkDirectory(target: string, path: string): void {
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir');
}

describe('removeSubagentLogs', () => {
  it('removes a nested tree and the emptied parent directory, and nothing else', () => {
    seed('session_a');
    seed('session_b');
    writeFileSync(join(logRoot, 'session_a.jsonl'), 'parent log');

    expect(removeSubagentLogs(logRoot, 'session_a')).toBe('removed');

    expect(existsSync(join(logRoot, 'session_a'))).toBe(false);
    expect(existsSync(logRoot)).toBe(true);
    expect(readFileSync(join(logRoot, 'session_a.jsonl'), 'utf8')).toBe('parent log');
    expect(existsSync(join(logRoot, 'session_b', 'subagents', 'task_1.jsonl'))).toBe(true);
    expect(removeSubagentLogs(logRoot, 'session_a')).toBe('absent');
  });

  it('keeps a parent directory that holds something else', () => {
    seed('session_a');
    writeFileSync(join(logRoot, 'session_a', 'other.txt'), 'other');
    expect(removeSubagentLogs(logRoot, 'session_a')).toBe('removed');
    expect(existsSync(join(logRoot, 'session_a', 'subagents'))).toBe(false);
    expect(readFileSync(join(logRoot, 'session_a', 'other.txt'), 'utf8')).toBe('other');
  });

  it('answers absent for a missing root, parent or subagents directory', () => {
    expect(removeSubagentLogs(join(scratch, 'missing'), 'session_a')).toBe('absent');
    expect(removeSubagentLogs(logRoot, 'session_a')).toBe('absent');
    mkdirSync(join(logRoot, 'session_a'));
    expect(removeSubagentLogs(logRoot, 'session_a')).toBe('absent');
  });

  it.each(['..', '../outside', 'a/b', '.hidden', ''])('refuses the parent id %j', (id) => {
    expect(() => removeSubagentLogs(logRoot, id)).toThrow(SubagentLogRemovalRefusedError);
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('refuses a parent directory that is a link, following nothing', () => {
    mkdirSync(join(outside, 'subagents'));
    writeFileSync(join(outside, 'subagents', 'victim.jsonl'), 'victim');
    linkDirectory(outside, join(logRoot, 'session_a'));
    expect(() => removeSubagentLogs(logRoot, 'session_a')).toThrow(SubagentLogRemovalRefusedError);
    expect(readFileSync(join(outside, 'subagents', 'victim.jsonl'), 'utf8')).toBe('victim');
  });

  it('refuses a subagents directory that is a link, following nothing', () => {
    mkdirSync(join(logRoot, 'session_a'));
    linkDirectory(outside, join(logRoot, 'session_a', 'subagents'));
    expect(() => removeSubagentLogs(logRoot, 'session_a')).toThrow(SubagentLogRemovalRefusedError);
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('refuses a parent or subagents entry that is not a directory', () => {
    writeFileSync(join(logRoot, 'session_a'), 'a file');
    expect(() => removeSubagentLogs(logRoot, 'session_a')).toThrow(SubagentLogRemovalRefusedError);
    mkdirSync(join(logRoot, 'session_b'));
    writeFileSync(join(logRoot, 'session_b', 'subagents'), 'a file');
    expect(() => removeSubagentLogs(logRoot, 'session_b')).toThrow(SubagentLogRemovalRefusedError);
    expect(readFileSync(join(logRoot, 'session_b', 'subagents'), 'utf8')).toBe('a file');
  });

  it('unlinks a link inside the tree by name, leaving what it points at', () => {
    seed('session_a');
    linkDirectory(outside, join(logRoot, 'session_a', 'subagents', 'task_1.payloads', 'escape'));
    expect(removeSubagentLogs(logRoot, 'session_a')).toBe('removed');
    expect(existsSync(join(logRoot, 'session_a'))).toBe(false);
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('works under a log root reached through a link', () => {
    seed('session_a');
    const alias = join(scratch, 'alias');
    linkDirectory(logRoot, alias);
    expect(removeSubagentLogs(alias, 'session_a')).toBe('removed');
    expect(existsSync(join(logRoot, 'session_a'))).toBe(false);
  });
});
