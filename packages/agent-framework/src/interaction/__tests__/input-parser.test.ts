import { describe, it, expect } from 'vitest';
import { parseInput, isSlashCommand, tokeniseSlashCommand } from '../input-parser.js';

describe('isSlashCommand', () => {
  it('returns true for /name', () => {
    expect(isSlashCommand('/mode')).toBe(true);
  });

  it('returns true for /name args', () => {
    expect(isSlashCommand('/mode plan')).toBe(true);
  });

  it('returns false for bare slash', () => {
    expect(isSlashCommand('/')).toBe(false);
  });

  it('returns false for slash-space', () => {
    expect(isSlashCommand('/ ')).toBe(false);
  });

  it('returns false for plain text', () => {
    expect(isSlashCommand('hello world')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSlashCommand('')).toBe(false);
  });
});

describe('tokeniseSlashCommand', () => {
  it('parses /name into name with empty args', () => {
    expect(tokeniseSlashCommand('/mode')).toEqual({ name: 'mode', args: [] });
  });

  it('parses /name arg into name with one arg', () => {
    expect(tokeniseSlashCommand('/mode plan')).toEqual({ name: 'mode', args: ['plan'] });
  });

  it('splits multiple args correctly', () => {
    expect(tokeniseSlashCommand('/cmd arg1 arg2 arg3')).toEqual({
      name: 'cmd',
      args: ['arg1', 'arg2', 'arg3'],
    });
  });

  it('handles extra whitespace between args', () => {
    expect(tokeniseSlashCommand('/cmd  arg1  arg2')).toEqual({
      name: 'cmd',
      args: ['arg1', 'arg2'],
    });
  });
});

describe('parseInput', () => {
  it('parses slash command with args', () => {
    expect(parseInput('/mode plan')).toEqual({
      type: 'slash-command',
      name: 'mode',
      args: ['plan'],
    });
  });

  it('parses slash command without args', () => {
    expect(parseInput('/mode')).toEqual({
      type: 'slash-command',
      name: 'mode',
      args: [],
    });
  });

  it('parses plain text as user message', () => {
    expect(parseInput('hello world')).toEqual({
      type: 'user-message',
      text: 'hello world',
    });
  });

  it('parses bare slash as user message', () => {
    expect(parseInput('/')).toEqual({
      type: 'user-message',
      text: '/',
    });
  });

  it('splits args with spaces correctly', () => {
    expect(parseInput('/cmd arg with spaces')).toEqual({
      type: 'slash-command',
      name: 'cmd',
      args: ['arg', 'with', 'spaces'],
    });
  });
});
