import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildServeSessionOptions } from '../../modes/serve-mode.js';
import {
  createPromptHistorySurface,
  readPromptHistorySetting,
  resolvePromptHistoryEnablement,
  resolvePromptHistoryProject,
  resolvePromptHistoryRenderFields,
} from '../prompt-history-enablement.js';

import type { TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('prompt-history enablement (SCREEN-1993 TC-06)', () => {
  it('is on by default; settings turn it off; the env kill switch and opt-in win over settings', () => {
    expect(resolvePromptHistoryEnablement({ settings: undefined, env: {} })).toBe(true);
    expect(resolvePromptHistoryEnablement({ settings: false, env: {} })).toBe(false);
    expect(
      resolvePromptHistoryEnablement({ settings: true, env: { ROBOTA_PROMPT_HISTORY: '0' } }),
    ).toBe(false);
    expect(
      resolvePromptHistoryEnablement({ settings: false, env: { ROBOTA_PROMPT_HISTORY: '1' } }),
    ).toBe(true);
    expect(
      resolvePromptHistoryEnablement({ settings: false, env: { ROBOTA_PROMPT_HISTORY: 'yes' } }),
    ).toBe(false);
    expect(readPromptHistorySetting({ promptHistory: false })).toBe(false);
    expect(readPromptHistorySetting({ promptHistory: 'off' })).toBeUndefined();
    expect(readPromptHistorySetting(undefined)).toBeUndefined();
  });

  it('derives the project key from the resolved identity for every trust state, else the real cwd', () => {
    const identity = { repositoryKey: 'k', displayPath: '/repo', worktreeRoot: '/repo/root' };
    const restricted = (
      trustState: 'untrusted' | 'revoked' | 'stale/replaced' | 'identity-unavailable',
      withIdentity: boolean,
    ): TWorkspaceProjectAccess => ({
      status: 'restricted',
      reason: 'WorkspaceAuthorityRequired',
      trustState,
      ...(withIdentity ? { identity } : {}),
    });
    expect(resolvePromptHistoryProject(restricted('untrusted', true), '/elsewhere')).toBe(
      '/repo/root',
    );
    expect(resolvePromptHistoryProject(restricted('revoked', true), '/elsewhere')).toBe(
      '/repo/root',
    );
    expect(resolvePromptHistoryProject(restricted('stale/replaced', true), '/elsewhere')).toBe(
      '/repo/root',
    );
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-prompt-history-cwd-')));
    roots.push(cwd);
    expect(resolvePromptHistoryProject(restricted('identity-unavailable', false), cwd)).toBe(cwd);
  });

  it('yields no writer and no source when disabled, and one file serving both when enabled', () => {
    expect(createPromptHistorySurface({ enabled: false, project: '/p' })).toEqual({});
    const surface = createPromptHistorySurface({ enabled: true, project: '/p' });
    expect(surface.promptHistory?.project).toBe('/p');
    expect(surface.promptHistoryProject).toBe('/p');
    expect(surface.promptHistorySource).toBe(surface.promptHistory?.writer);
  });
});

describe('prompt-history composition (SCREEN-1993 TC-07)', () => {
  // A live trusted authority can only be minted by the trust service against a repository; the
  // identity-carrying restricted access takes the same project-key path (TC-06 covers the table).
  const trusted: TWorkspaceProjectAccess = {
    status: 'restricted',
    reason: 'WorkspaceAuthorityRequired',
    trustState: 'untrusted',
    identity: { repositoryKey: 'k', displayPath: '/repo', worktreeRoot: '/repo/root' },
  };

  it('hands the TUI the writer, the source and the project key in one resolved surface', () => {
    const fields = resolvePromptHistoryRenderFields({
      settings: undefined,
      env: {},
      access: trusted,
      cwd: '/elsewhere',
    });
    expect(fields.promptHistory?.project).toBe('/repo/root');
    expect(fields.promptHistoryProject).toBe('/repo/root');
    expect(fields.promptHistorySource).toBe(fields.promptHistory?.writer);
  });

  it('hands the TUI nothing when the kill switch is set', () => {
    expect(
      resolvePromptHistoryRenderFields({
        settings: { promptHistory: true },
        env: { ROBOTA_PROMPT_HISTORY: '0' },
        access: trusted,
        cwd: '/elsewhere',
      }),
    ).toEqual({});
  });

  it('the serve projection carries no writer: prompt intake is TUI state', () => {
    const options = buildServeSessionOptions({
      cwd: '/work',
      args: {
        permissionMode: undefined,
        maxTurns: undefined,
        noSessionPersistence: true,
        forkSession: undefined,
        sessionName: undefined,
      } as never,
      preset: {},
    } as never);
    expect('promptHistory' in options).toBe(false);
  });
});
