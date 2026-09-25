import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearRegisteredToolProfiles,
  evaluatePermission,
  registerToolPermissionProfile,
} from '../permission-gate.js';
import { isReadOnlyCommandLine } from '../read-only-commands.js';

/** Issue #3082 — built-in read-only shell commands run without a prompt. */
describe('isReadOnlyCommandLine', () => {
  it.each([
    'ls -la',
    'cat package.json',
    'grep -rn "TODO" src',
    'find . -name "*.ts" -type f',
    'git status',
    'git log --oneline -5',
    'git diff HEAD~1 -- src',
    'git --no-pager show HEAD',
    'git branch',
    'git branch -a -v',
    'git branch --list "feat/*"',
    'git remote -v',
    'cd packages/api && ls',
    'ls | wc -l',
    'cat a.txt | grep x | head -3',
    'ls 2>/dev/null',
    'ls > /dev/null 2>&1',
    'cat < input.txt',
    'echo "a > b; c"',
    'head -n 5 "$HOME/notes.txt"',
  ])('%s qualifies', (line) => {
    expect(isReadOnlyCommandLine(line)).toBe(true);
  });

  it.each([
    ['rm -rf build', 'not in the set'],
    ['ls && rm x', 'one segment is not read-only'],
    ['echo hi > out.txt', 'writes a file'],
    ['cat a >> b', 'appends to a file'],
    ['ls &> log', 'writes a file'],
    ['cat <<EOF\nx\nEOF', 'here-doc'],
    ['echo $(rm -rf ~)', 'command substitution'],
    ['echo `whoami`', 'backtick substitution'],
    ['diff <(ls a) <(ls b)', 'process substitution'],
    ['find . -delete', 'find deletes'],
    ['find . -name x -exec rm {} ;', 'find runs a command'],
    ['find . -name *.ts', 'unquoted glob reaches find'],
    ['find . $ARGS', 'expansion reaches find'],
    ['git push', 'git writes'],
    ['git -c core.pager=sh log', 'git global option'],
    ['git -C ../other status', 'git in another repository'],
    ['git diff --output=patch.txt', 'git writes a file'],
    ['git diff --ext-diff', 'git runs a program'],
    ['git branch new-feature', 'creates a branch'],
    ['git branch -D old', 'deletes a branch'],
    ['git remote add x url', 'changes remotes'],
    ['cd ../other && git status', 'git after cd'],
    ['PAGER=sh git log', 'leading assignment'],
    ['./ls', 'a path, not the built-in'],
    ['$CMD', 'expanded command name'],
    ['echo "unterminated', 'unbalanced quote'],
    ['', 'nothing to run'],
  ])('%s does not qualify (%s)', (line) => {
    expect(isReadOnlyCommandLine(line)).toBe(false);
  });

  it('refuses git when the call names another directory', () => {
    expect(isReadOnlyCommandLine('git status', { otherDirectory: true })).toBe(false);
    expect(isReadOnlyCommandLine('ls', { otherDirectory: true })).toBe(true);
  });

  it('does not inspect an oversized line', () => {
    expect(isReadOnlyCommandLine(`echo ${'a'.repeat(10_001)}`)).toBe(false);
  });
});

describe('the gate decides a read-only command like a read', () => {
  beforeEach(() => {
    clearRegisteredToolProfiles();
    registerToolPermissionProfile('Bash', {
      argument: { key: 'command', kind: 'command' },
      riskClass: 'execute',
    });
  });
  afterEach(() => clearRegisteredToolProfiles());

  it('runs without a prompt in default and plan mode', () => {
    expect(evaluatePermission('Bash', { command: 'git status' }, 'default')).toBe('auto');
    expect(evaluatePermission('Bash', { command: 'ls -la' }, 'plan')).toBe('auto');
    expect(evaluatePermission('Bash', { command: 'npm test' }, 'default')).toBe('approve');
    expect(evaluatePermission('Bash', { command: 'npm test' }, 'plan')).toBe('deny');
  });

  it('still yields to deny and ask rules', () => {
    expect(
      evaluatePermission('Bash', { command: 'cat .env' }, 'default', { deny: ['Bash(cat .env)'] }),
    ).toBe('deny');
    expect(
      evaluatePermission('Bash', { command: 'git log' }, 'default', { ask: ['Bash(git log*)'] }),
    ).toBe('approve');
  });

  it('asks for git run in another directory', () => {
    expect(
      evaluatePermission(
        'Bash',
        { command: 'git status', workingDirectory: '../other' },
        'default',
      ),
    ).toBe('approve');
  });
});
