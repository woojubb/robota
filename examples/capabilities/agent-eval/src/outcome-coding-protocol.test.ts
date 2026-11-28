import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  encodeHostLine,
  encodeWorkerLine,
  parseHostLine,
  parseWorkerLine,
  type IWorkerInit,
  type IWorkerResult,
} from './outcome-coding-protocol.js';

const init: IWorkerInit = {
  kind: 'init',
  prompt: 'p',
  model: 'm',
  endpoint: 'https://relay.invalid/v1/chat/completions',
  projectDir: '/work/project',
  gitRoot: '/work',
  homeDir: '/tmp/home',
  stateDir: '/tmp/state',
  systemPrompt: 's',
  allowedTools: ['Read'],
  deniedTools: ['Bash'],
  maxTurns: 8,
  maxTokens: 8192,
  temperature: 0.2,
  abortAfterMs: 1000,
};

const result: IWorkerResult = {
  kind: 'result',
  completed: true,
  interrupted: false,
  response: 'Done',
  toolCalls: 2,
  toolNames: ['Read', 'Write'],
  usage: null,
  elapsedMs: 5,
};

test('host messages survive a round trip and are one line each', () => {
  const line = encodeHostLine(init);
  assert.equal(line.endsWith('\n'), true);
  assert.equal(line.trimEnd().includes('\n'), false);
  assert.deepEqual(parseHostLine(line.trimEnd()), init);
  const reply = { kind: 'reply', id: 3, status: 200, body: { ok: true } } as const;
  assert.deepEqual(parseHostLine(encodeHostLine(reply).trimEnd()), reply);
});

test('worker messages are prefixed so that other output stays a diagnostic', () => {
  const request = { kind: 'request', id: 1, url: 'u', body: { a: 1 } } as const;
  assert.deepEqual(parseWorkerLine(encodeWorkerLine(request).trimEnd()), request);
  assert.deepEqual(parseWorkerLine(encodeWorkerLine(result).trimEnd()), result);
  assert.equal(parseWorkerLine('warning: something'), undefined);
  assert.equal(parseWorkerLine(JSON.stringify(request)), undefined);
});

test('malformed lines are not messages', () => {
  assert.equal(parseWorkerLine('BENCH:not json'), undefined);
  assert.equal(parseWorkerLine('BENCH:{"kind":"request","id":"1","url":"u"}'), undefined);
  assert.equal(parseWorkerLine('BENCH:{"kind":"result"}'), undefined);
  assert.equal(parseHostLine('not json'), undefined);
  assert.equal(parseHostLine('{"kind":"init"}'), undefined);
  assert.equal(parseHostLine(JSON.stringify({ ...init, allowedTools: 'Read' })), undefined);
  assert.equal(parseHostLine('{"kind":"reply","id":1.5,"status":200}'), undefined);
});
