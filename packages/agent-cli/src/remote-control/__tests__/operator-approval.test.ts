import { describe, expect, it, vi } from 'vitest';

import { createTerminalOperatorApprover, type ITerminalHandoffHost } from '../operator-approval.js';

import type { ISecretTerminal, ISecretTerminalSession } from '../../devices/secret-terminal.js';
import type { ICapabilityApprovalRequest } from '@robota-sdk/agent-interface-session-mobility';

/**
 * The operator is asked on this machine's own terminal — never through the session, whose prompts any
 * connected surface may answer, so a device already driving could otherwise approve the next one.
 */

const DRIVE: ICapabilityApprovalRequest = {
  capability: 'drive',
  scope: 'connection',
  deviceId: 'dev-1234567890abcdef',
  locality: 'another-host',
};

function host(canHandoff = true) {
  const runWithTerminal = vi.fn();
  const h: ITerminalHandoffHost = {
    canHandoffTerminal: () => canHandoff,
    runWithTerminal: <T>(fn: () => Promise<T>): Promise<T> => {
      runWithTerminal();
      return fn();
    },
  };
  return Object.assign(h, { runs: runWithTerminal });
}

function terminal(answers: Array<string | Error>): {
  session: ISecretTerminalSession;
  prompts: string[];
  written: string[];
} {
  const prompts: string[] = [];
  const written: string[] = [];
  const term: ISecretTerminal = {
    write: (text) => {
      written.push(text);
    },
    clearScreen: () => {},
    readLine: async (prompt) => {
      prompts.push(prompt);
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next ?? '';
    },
  };
  return { session: { run: (work) => work(term) }, prompts, written };
}

describe('createTerminalOperatorApprover', () => {
  it('says no without asking when this process has no terminal to ask on', async () => {
    const openTerminal = vi.fn();
    const approver = createTerminalOperatorApprover({
      getHost: () => host(false),
      openTerminal,
    });
    await expect(approver.approve(DRIVE)).resolves.toBe(false);
    expect(openTerminal).not.toHaveBeenCalled();
  });

  it('says no when there is no session yet', async () => {
    const approver = createTerminalOperatorApprover({ getHost: () => undefined });
    await expect(approver.approve(DRIVE)).resolves.toBe(false);
  });

  it('allows only on an explicit yes typed at the terminal', async () => {
    const { session, prompts, written } = terminal(['yes']);
    const h = host();
    const approver = createTerminalOperatorApprover({
      getHost: () => h,
      openTerminal: () => session,
    });
    await expect(approver.approve(DRIVE)).resolves.toBe(true);
    expect(h.runs).toHaveBeenCalledTimes(1);
    const shown = [...written, ...prompts].join('');
    expect(shown).toContain('dev-123456');
    expect(shown).toMatch(/drive this session/);
  });

  it.each(['', 'n', 'no', 'maybe'])('treats %j as no', async (answer) => {
    const { session } = terminal([answer]);
    const approver = createTerminalOperatorApprover({
      getHost: () => host(),
      openTerminal: () => session,
    });
    await expect(approver.approve(DRIVE)).resolves.toBe(false);
  });

  it('treats a cancel at the terminal, or a terminal that cannot open, as no', async () => {
    const cancelled = terminal([new Error('cancelled at the terminal')]);
    await expect(
      createTerminalOperatorApprover({
        getHost: () => host(),
        openTerminal: () => cancelled.session,
      }).approve(DRIVE),
    ).resolves.toBe(false);
    await expect(
      createTerminalOperatorApprover({
        getHost: () => host(),
        openTerminal: () => undefined,
      }).approve(DRIVE),
    ).resolves.toBe(false);
  });

  it('shows a delegated task without the control sequences a peer could put in it', async () => {
    const { session, written, prompts } = terminal(['no']);
    const approver = createTerminalOperatorApprover({
      getHost: () => host(),
      openTerminal: () => session,
    });
    await approver.approve({
      capability: 'delegate',
      scope: 'request',
      deviceId: 'dev-1',
      locality: 'same-host',
      summary: 'run tests\u001b[2J\u001b]0;owned\u0007\r\nApprove? yes',
    });
    const shown = [...written, ...prompts].join('');
    expect(shown).toContain('run tests');
    expect(shown).not.toContain('\u001b[2J');
    expect(shown).not.toContain('\u0007');
    expect(shown).not.toContain('owned\u0007');
  });

  it('drops invisible and direction-changing characters from a peer’s text', async () => {
    const { session, written } = terminal(['no']);
    const approver = createTerminalOperatorApprover({
      getHost: () => host(),
      openTerminal: () => session,
    });
    await approver.approve({
      capability: 'delegate',
      scope: 'request',
      locality: 'same-host',
      summary: 'safe\u202etxt.exe\u200b\u2066x\u2069\ufeff',
    });
    const shown = written.join('');
    for (const ch of ['\u202e', '\u200b', '\u2066', '\u2069', '\ufeff']) {
      expect(shown).not.toContain(ch);
    }
  });

  it('does not ask about a connection that is already gone', async () => {
    const openTerminal = vi.fn();
    const h = host();
    const gone = new AbortController();
    gone.abort();
    const approver = createTerminalOperatorApprover({ getHost: () => h, openTerminal });
    await expect(approver.approve(DRIVE, gone.signal)).resolves.toBe(false);
    expect(h.runs).not.toHaveBeenCalled();
    expect(openTerminal).not.toHaveBeenCalled();
  });

  it('withdraws the question when the connection goes away, and the next one is asked', async () => {
    const prompts: string[] = [];
    let answerNext: string | undefined;
    const session: ISecretTerminalSession = {
      run: (work) =>
        work({
          write: () => {},
          clearScreen: () => {},
          readLine: (prompt, readOptions) => {
            prompts.push(prompt);
            if (answerNext !== undefined) return Promise.resolve(answerNext);
            // Nobody answers; only the withdrawal ends this question.
            return new Promise((_resolve, reject) => {
              readOptions?.signal?.addEventListener('abort', () => reject(new Error('withdrawn')));
            });
          },
        }),
    };
    const approver = createTerminalOperatorApprover({
      getHost: () => host(),
      openTerminal: () => session,
    });
    const leaving = new AbortController();
    const first = approver.approve(DRIVE, leaving.signal);
    const second = approver.approve(DRIVE, new AbortController().signal);
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    answerNext = 'yes';
    leaving.abort();
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(prompts).toHaveLength(2);
  });

  it('asks one question at a time', async () => {
    let active = 0;
    let maxActive = 0;
    const h = {
      canHandoffTerminal: () => true,
      runWithTerminal: async <T>(fn: () => Promise<T>): Promise<T> => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return await fn();
        } finally {
          active -= 1;
        }
      },
    };
    const { session } = terminal(['yes', 'no']);
    const approver = createTerminalOperatorApprover({
      getHost: () => h,
      openTerminal: () => session,
    });
    const results = await Promise.all([approver.approve(DRIVE), approver.approve(DRIVE)]);
    expect(results).toEqual([true, false]);
    expect(maxActive).toBe(1);
  });
});
