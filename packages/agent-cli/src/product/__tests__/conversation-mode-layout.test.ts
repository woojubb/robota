import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { productSecureMode } from '../session-sealing.js';
import { createProductUserSessionStore } from '../session-stores.js';
import { createProductCapabilityPacks } from '../product-profile.js';
import { resolveCliRuntimeContext } from '../../startup/product-bootstrap.js';
import {
  readProductConversationMode,
  writeProductConversationMode,
} from '../../secure/conversation-mode-state.js';

const homes: string[] = [];
function home(): string {
  const path = mkdtempSync(join(tmpdir(), 'conversation-mode-layout-'));
  homes.push(path);
  return path;
}

afterEach(() => {
  for (const path of homes.splice(0)) rmSync(path, { recursive: true, force: true });
});

function modeFile(root: string, mode: 'on' | 'off' | 'preparing'): void {
  const directory = join(root, 'secure');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(join(directory, 'mode.json'), JSON.stringify({ schemaVersion: 1, mode }), {
    mode: 0o600,
  });
}

describe('conversation mode storage layout', () => {
  it('refuses the plaintext external editor command only in secure mode', async () => {
    const userHome = home();
    const plain = createTestProductRuntime('test-product', { HOME: userHome });
    const editor = (runtime: typeof plain) =>
      createProductCapabilityPacks({ cwd: userHome }, runtime)
        .flatMap((pack) => pack.commandModules ?? [])
        .find((command) => command.name === 'agent-command-editor')!.systemCommands![0]!;
    expect(
      (await editor(plain).execute({ canHandoffTerminal: () => false } as never, 'draft')).message,
    ).toContain('no interactive terminal');
    modeFile(plain.layout.userRoot, 'on');
    const secure = resolveCliRuntimeContext({
      productConfig: plain.config,
      environment: plain.environment,
    });
    expect(
      (await editor(secure).execute({ canHandoffTerminal: () => true } as never, 'draft')).message,
    ).toContain('unavailable in secure conversations');
  });

  it('keeps the ordinary paths and plaintext mode when no choice has been made', () => {
    const userHome = home();
    const runtime = createTestProductRuntime('test-product', { HOME: userHome });
    expect(runtime.layout.userPaths.sessions).toBe(join(userHome, '.test-product', 'sessions'));
    expect(productSecureMode(runtime)).toBe(false);
  });

  it('selects versioned conversation artifacts while retaining base configuration and owner paths', () => {
    const userHome = home();
    const plain = createTestProductRuntime('test-product', { HOME: userHome });
    modeFile(plain.layout.userRoot, 'on');
    const secure = resolveCliRuntimeContext({
      productConfig: plain.config,
      environment: plain.environment,
    });
    expect(productSecureMode(secure)).toBe(true);
    expect(secure.config.storage.userRoot).toBe(plain.config.storage.userRoot);
    expect(secure.environment.PRODUCT_USER_STATE_DIR).toBe(
      plain.environment.PRODUCT_USER_STATE_DIR,
    );
    expect(secure.layout.userPaths.keyring).toBe(plain.layout.userPaths.keyring);
    expect(secure.layout.userPaths.settings).toBe(plain.layout.userPaths.settings);
    expect(secure.layout.userPaths.presence).toBe(plain.layout.userPaths.presence);
    expect(secure.layout.userPaths.sessions).toBe(
      join(plain.layout.userRoot, 'secure-v1', 'sessions'),
    );
    expect(secure.layout.userPaths.history).toBe(
      join(plain.layout.userRoot, 'secure-v1', 'history.jsonl'),
    );
    expect(secure.layout.userPaths.spill).toBe(join(plain.layout.userRoot, 'secure-v1', 'spill'));
    expect(secure.layout.userPaths.ephemeralCheckpoints).toBe(
      join(plain.layout.userRoot, 'secure-v1', 'ephemeral-checkpoints'),
    );
    expect(secure.layout.projectStateDirectories.sessions).toBe(
      join(plain.layout.projectDirectory, 'secure-v1', 'sessions'),
    );
    expect(secure.layout.projectStateDirectories['session-logs']).toBe(
      join(plain.layout.projectDirectory, 'secure-v1', 'logs'),
    );
    expect(secure.layout.projectStateDirectories.checkpoints).toBe(
      join(plain.layout.projectDirectory, 'secure-v1', 'checkpoints'),
    );
    expect(secure.layout.projectStateDirectories.memory).toBe(
      plain.layout.projectStateDirectories.memory,
    );
    expect(() => createProductUserSessionStore(secure)).toThrow(/sealing|key holder/i);
  });

  it('keeps an incomplete choice resumable and refuses orphaned secure artifacts', () => {
    const userHome = home();
    const plain = createTestProductRuntime('test-product', { HOME: userHome });
    modeFile(plain.layout.userRoot, 'preparing');
    const preparing = resolveCliRuntimeContext({
      productConfig: plain.config,
      environment: plain.environment,
    });
    expect(preparing.conversationMode).toBe('preparing');
    expect(productSecureMode(preparing)).toBe(false);
    expect(() => createProductUserSessionStore(preparing)).toThrow(/preparation/i);
    rmSync(join(plain.layout.userRoot, 'secure', 'mode.json'));
    mkdirSync(join(plain.layout.userRoot, 'secure-v1'));
    expect(() =>
      resolveCliRuntimeContext({ productConfig: plain.config, environment: plain.environment }),
    ).toThrow(/secure.*mode|mode.*secure/i);
  });

  it('commits transitions as private files and refuses a stale expected mode', () => {
    const root = join(home(), 'state');
    expect(readProductConversationMode(root)).toBe('plain');
    writeProductConversationMode(root, 'plain', 'preparing');
    expect(readProductConversationMode(root)).toBe('preparing');
    expect(() => writeProductConversationMode(root, 'plain', 'secure')).toThrow(/changed/i);
    writeProductConversationMode(root, 'preparing', 'secure');
    expect(readProductConversationMode(root)).toBe('secure');
    writeProductConversationMode(root, 'secure', 'plain');
    expect(readProductConversationMode(root)).toBe('plain');
    if (process.platform !== 'win32') {
      expect(lstatSync(join(root, 'secure')).mode & 0o077).toBe(0);
      expect(lstatSync(join(root, 'secure', 'mode.json')).mode & 0o077).toBe(0);
    }
  });

  it('refuses a linked or malformed mode choice', () => {
    const root = join(home(), 'state');
    mkdirSync(join(root, 'secure'), { recursive: true, mode: 0o700 });
    const target = join(root, 'target');
    writeFileSync(target, '{"schemaVersion":1,"mode":"on"}', { mode: 0o600 });
    symlinkSync(target, join(root, 'secure', 'mode.json'));
    expect(() => readProductConversationMode(root)).toThrow(/ordinary private file/i);
    rmSync(join(root, 'secure', 'mode.json'));
    writeFileSync(join(root, 'secure', 'mode.json'), '{"schemaVersion":1,"mode":"unexpected"}', {
      mode: 0o600,
    });
    expect(() => readProductConversationMode(root)).toThrow(/invalid/i);
  });
});
