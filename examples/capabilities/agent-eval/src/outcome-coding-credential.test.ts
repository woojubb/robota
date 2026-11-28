import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { test } from 'node:test';

import {
  countLeaksInPath,
  countLeaksInTexts,
  holdCredential,
  readCredentialLine,
  redactSecret,
} from './outcome-coding-credential.js';

const SECRET = 'fake-key-0123456789abcdef';

function withFile(content: string, run: (path: string, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'credential-test-'));
  try {
    const path = join(dir, 'credentials.txt');
    writeFileSync(path, content, { mode: 0o600 });
    run(path, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('the credential is read from the one named line and nothing else is kept', () => {
  withFile(
    ['# comment', 'OTHER_LINE=do-not-keep-this', `export GATEWAY_LINE="${SECRET}"`, ''].join('\n'),
    (path) => {
      const credential = readCredentialLine(path, 'GATEWAY_LINE');
      assert.equal(credential.reveal(), SECRET);
    },
  );
  withFile(`GATEWAY_LINE=${SECRET}\r\n`, (path) => {
    assert.equal(readCredentialLine(path, 'GATEWAY_LINE').reveal(), SECRET);
  });
});

test('a held credential prints as redacted however it is formatted', () => {
  const credential = holdCredential(SECRET);
  const shown = [
    String(credential),
    `${credential}`,
    JSON.stringify({ credential }),
    inspect(credential),
    inspect({ nested: { credential } }, { depth: 5 }),
    JSON.stringify(Object.entries(credential)),
  ].join(' ');
  assert.ok(!shown.includes(SECRET));
  assert.ok(shown.includes('redacted'));
});

test('a missing, repeated or empty line fails without naming a value', () => {
  withFile('OTHER=1\n', (path) => {
    assert.throws(() => readCredentialLine(path, 'GATEWAY_LINE'), /no GATEWAY_LINE line/);
  });
  withFile(`GATEWAY_LINE=${SECRET}\nGATEWAY_LINE=${SECRET}2\n`, (path) => {
    assert.throws(
      () => readCredentialLine(path, 'GATEWAY_LINE'),
      (error: Error) => /more than one/.test(error.message) && !error.message.includes(SECRET),
    );
  });
  withFile('GATEWAY_LINE=\n', (path) => {
    assert.throws(() => readCredentialLine(path, 'GATEWAY_LINE'), /empty/);
  });
  withFile('GATEWAY_LINE_EXTRA=x\n', (path) => {
    assert.throws(() => readCredentialLine(path, 'GATEWAY_LINE'), /no GATEWAY_LINE line/);
  });
  withFile('X=1\n', (path) => {
    assert.throws(() => readCredentialLine(path, 'bad name'), /invalid/);
  });
});

test('the leak scan counts a secret in every common form and never returns it', () => {
  const buffer = Buffer.from(SECRET);
  const texts = [
    `plain ${SECRET} and again ${SECRET}`,
    `encoded ${buffer.toString('base64')}`,
    `url ${encodeURIComponent(SECRET)}`,
    `hex ${buffer.toString('hex')}`,
    Buffer.from(`binary \u0000 ${SECRET} \u0000`),
    'nothing here',
  ];
  const count = countLeaksInTexts(SECRET, texts);
  assert.ok(count >= 6, String(count));
  assert.equal(countLeaksInTexts(SECRET, ['clean', Buffer.from('clean')]), 0);
});

test('the path scan walks a tree, skips links, and reports counts only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'credential-scan-'));
  try {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'clean.txt'), 'nothing');
    writeFileSync(join(dir, 'sub', 'leaky.log'), `line ${SECRET}\n`);
    symlinkSync(join(dir, 'sub', 'leaky.log'), join(dir, 'link.log'));
    const report = countLeaksInPath(SECRET, dir);
    assert.equal(report.leaks, 1);
    assert.equal(report.filesScanned, 2);
    assert.equal(report.unreadable, 0);
    assert.ok(!JSON.stringify(report).includes(SECRET));
    assert.equal(countLeaksInPath(SECRET, join(dir, 'clean.txt')).leaks, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('redaction removes a secret from a message in any scanned form', () => {
  const buffer = Buffer.from(SECRET);
  const message = `failed with ${SECRET} and ${buffer.toString('base64')}`;
  const redacted = redactSecret(SECRET, message);
  assert.equal(countLeaksInTexts(SECRET, [redacted]), 0);
});
