/**
 * PEER-004 (#1863) — the composition leaf that makes this session discoverable.
 *
 * These cases exist because the two leaves underneath were both landed and called by nothing. What
 * is pinned here is the WIRING: that announcing publishes an entry a second reader can see, that a
 * clean exit removes it, and that a refused rendezvous is not quietly announced anyway.
 */

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { announceLocalPeerPresence } from '../local-peer-presence.js';

const scratch: string[] = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop() as string, { recursive: true, force: true });
});

function guardedDirectory(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'peer-presence-')));
  scratch.push(dir);
  return dir;
}

/** An exit subscription a case can fire, so the runner is never actually asked to exit. */
function exitBus() {
  const handlers: (() => void)[] = [];
  return {
    on: (_event: 'exit', handler: () => void) => {
      handlers.push(handler);
    },
    off: (_event: 'exit', handler: () => void) => {
      const at = handlers.indexOf(handler);
      if (at !== -1) handlers.splice(at, 1);
    },
    fire: () => {
      for (const handler of [...handlers]) handler();
    },
    get size() {
      return handlers.length;
    },
  };
}

const ALIVE = () => 'start-time-fixed';

describe('announcing makes this session discoverable', () => {
  it('publishes only fixed activity metadata, refreshes it, and clears on switch', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    try {
      const bus = exitBus();
      const presence = announceLocalPeerPresence({
        sessionId: 'session-one',
        guardedDirectory: guardedDirectory(),
        registry: { readStartTime: ALIVE, now: () => Date.now() },
        on: bus.on,
        off: bus.off,
      });
      expect(presence.list()[0]?.status).toBe('unknown');
      presence.publishStatus('working');
      expect(presence.list()[0]?.status).toBe('working');
      vi.advanceTimersByTime(31_000);
      expect(presence.list()[0]?.status).toBe('working');
      presence.publishStatus(undefined);
      expect(presence.list()[0]?.status).toBe('unknown');
      presence.withdraw();
      expect(bus.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('publishes an entry a second reader sees', () => {
    const dir = guardedDirectory();
    const bus = exitBus();
    const one = announceLocalPeerPresence({
      sessionId: 'session-one',
      name: 'first',
      guardedDirectory: dir,
      registry: { readStartTime: ALIVE },
      on: bus.on,
      off: bus.off,
    });
    const two = announceLocalPeerPresence({
      sessionId: 'session-two',
      guardedDirectory: dir,
      registry: { readStartTime: ALIVE },
      on: bus.on,
      off: bus.off,
    });

    // Each sees the other AND itself: the reader decides which row is its own, so the list must
    // carry both rather than a pre-filtered view whose filter nobody can inspect.
    expect(
      one
        .list()
        .map((p) => p.sessionId)
        .sort(),
    ).toEqual(['session-one', 'session-two']);
    expect(
      two
        .list()
        .map((p) => p.sessionId)
        .sort(),
    ).toEqual(['session-one', 'session-two']);
    expect(one.list().find((p) => p.sessionId === 'session-one')?.name).toBe('first');
  });

  it('carries liveness through instead of deciding it here', () => {
    const dir = guardedDirectory();
    const bus = exitBus();
    const presence = announceLocalPeerPresence({
      sessionId: 'session-one',
      guardedDirectory: dir,
      // A host that cannot answer. `unknown` must survive to the surface — rounding it to `alive`
      // is the guess the registry exists to refuse.
      registry: { readStartTime: () => undefined },
      on: bus.on,
      off: bus.off,
    });
    expect(presence.list()[0]?.liveness).toBe('unknown');
  });

  it('certifies a whole-second birth time only after the original process reannounces', () => {
    const birth = 'Wed Sep 23 13:40:17 2026';
    const birthMs = Date.parse(`${birth} UTC`);
    vi.useFakeTimers();
    vi.setSystemTime(birthMs + 100);
    try {
      const bus = exitBus();
      const presence = announceLocalPeerPresence({
        sessionId: 'session-one',
        guardedDirectory: guardedDirectory(),
        registry: {
          readStartTime: () => birth,
          startTimePrecision: 'seconds',
          now: () => Date.now(),
        },
        on: bus.on,
        off: bus.off,
      });
      expect(presence.list()[0]?.liveness).toBe('unknown');

      vi.advanceTimersByTime(901);
      expect(presence.list()[0]?.liveness).toBe('alive');
      presence.withdraw();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reannounce after withdrawal while certification is pending', () => {
    const birth = 'Wed Sep 23 13:40:17 2026';
    const birthMs = Date.parse(`${birth} UTC`);
    vi.useFakeTimers();
    vi.setSystemTime(birthMs + 100);
    try {
      const dir = guardedDirectory();
      const bus = exitBus();
      const presence = announceLocalPeerPresence({
        sessionId: 'session-one',
        guardedDirectory: dir,
        registry: {
          readStartTime: () => birth,
          startTimePrecision: 'seconds',
          now: () => Date.now(),
        },
        on: bus.on,
        off: bus.off,
      });
      presence.withdraw();
      vi.advanceTimersByTime(901);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recovers when the initial birth-time inspection fails', () => {
    const birth = 'Wed Sep 23 13:40:17 2026';
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(`${birth} UTC`) + 100);
    const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    try {
      let available = false;
      const bus = exitBus();
      const presence = announceLocalPeerPresence({
        sessionId: 'session-one',
        guardedDirectory: guardedDirectory(),
        registry: {
          readStartTime: () => (available ? birth : undefined),
          startTimePrecision: 'seconds',
          now: () => Date.now(),
        },
        on: bus.on,
        off: bus.off,
      });
      expect(presence.list()[0]?.liveness).toBe('unknown');
      expect(warning).toHaveBeenCalledTimes(1);

      available = true;
      vi.advanceTimersByTime(5_000);
      expect(presence.list()[0]?.liveness).toBe('alive');
      presence.withdraw();
    } finally {
      warning.mockRestore();
      vi.useRealTimers();
    }
  });

  it('preserves a valid birth time when a timed reannouncement fails, then recovers', () => {
    const birth = 'Wed Sep 23 13:40:17 2026';
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse(`${birth} UTC`) + 100);
    const warning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    try {
      let available = true;
      const dir = guardedDirectory();
      const bus = exitBus();
      const presence = announceLocalPeerPresence({
        sessionId: 'session-one',
        guardedDirectory: dir,
        registry: {
          readStartTime: () => (available ? birth : undefined),
          startTimePrecision: 'seconds',
          now: () => Date.now(),
        },
        on: bus.on,
        off: bus.off,
      });
      available = false;
      vi.advanceTimersByTime(901);
      const entry = JSON.parse(readFileSync(path.join(dir, readdirSync(dir)[0]!), 'utf8')) as {
        startedAt: string;
      };
      expect(entry.startedAt).toBe(birth);
      expect(warning).toHaveBeenCalledTimes(1);

      available = true;
      vi.advanceTimersByTime(5_000);
      expect(presence.list()[0]?.liveness).toBe('alive');
      presence.withdraw();
    } finally {
      warning.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('withdrawal is bound to the process ending', () => {
  it('removes the entry when the exit fires', () => {
    const dir = guardedDirectory();
    const bus = exitBus();
    announceLocalPeerPresence({
      sessionId: 'session-one',
      guardedDirectory: dir,
      registry: { readStartTime: ALIVE },
      on: bus.on,
      off: bus.off,
    });
    expect(readdirSync(dir)).toHaveLength(1);

    bus.fire();

    // A clean exit removes its own entry, so the common case never depends on the liveness floor.
    // Leaning on the detector instead would make every clean exit look like a crash until something
    // else noticed.
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('withdraws once, and unsubscribes so a later exit is not a second removal', () => {
    const dir = guardedDirectory();
    const bus = exitBus();
    const presence = announceLocalPeerPresence({
      sessionId: 'session-one',
      guardedDirectory: dir,
      registry: { readStartTime: ALIVE },
      on: bus.on,
      off: bus.off,
    });

    presence.withdraw();
    expect(readdirSync(dir)).toHaveLength(0);
    expect(bus.size).toBe(0);

    // Idempotent: an explicit withdraw followed by the real exit must not throw on a file that is
    // already gone. A process exiting is not a place an exception can be reported.
    expect(() => {
      presence.withdraw();
      bus.fire();
    }).not.toThrow();
  });
});

describe('the workspace claim (#3101 B2)', () => {
  function repository(): string {
    const dir = guardedDirectory();
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
    );
    const run = (...args: string[]): void => {
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
        cwd: dir,
        env,
        stdio: 'ignore',
      });
    };
    run('init', '-q');
    // The message names the directory: two identical empty commits in one second share a hash.
    run('-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', `root ${dir}`);
    return dir;
  }

  function announce(dir: string, sessionId: string, workspaceDirectory: string) {
    const bus = exitBus();
    return announceLocalPeerPresence({
      sessionId,
      guardedDirectory: dir,
      workspaceDirectory,
      registry: { readStartTime: ALIVE },
      on: bus.on,
      off: bus.off,
    });
  }

  it('publishes the claim with the entry and shows the relation the reader verified', () => {
    const dir = guardedDirectory();
    const shared = repository();
    const one = announce(dir, 'session-one', shared);
    announce(dir, 'session-two', shared);
    announce(dir, 'session-three', repository());
    announce(dir, 'session-four', guardedDirectory());

    const relation = (sessionId: string) =>
      one.list().find((peer) => peer.sessionId === sessionId)?.workspaceRelation;
    expect(relation('session-two')).toBe('same-worktree');
    expect(relation('session-three')).toBe('different-repo');
    expect(relation('session-four')).toBe('unknown');

    const entry = JSON.parse(readFileSync(path.join(dir, 'session-two.peer.json'), 'utf8')) as {
      workspace?: { worktreePath: string };
    };
    expect(entry.workspace?.worktreePath).toBe(shared);
  });

  it('reports a tampered claim as mismatched and does not believe it', () => {
    const dir = guardedDirectory();
    const one = announce(dir, 'session-one', repository());
    announce(dir, 'session-two', repository());
    const read = (sessionId: string) =>
      JSON.parse(readFileSync(path.join(dir, `${sessionId}.peer.json`), 'utf8')) as {
        workspace: { rootCommits: string[] };
      };
    const entry = read('session-two');
    entry.workspace.rootCommits = read('session-one').workspace.rootCommits;
    writeFileSync(path.join(dir, 'session-two.peer.json'), JSON.stringify(entry));

    const peer = one.list().find((summary) => summary.sessionId === 'session-two');
    expect(peer?.workspaceRelation).toBe('unknown');
    expect(peer?.workspaceClaim).toBe('mismatched');
  });
});
