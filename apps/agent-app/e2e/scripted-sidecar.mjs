#!/usr/bin/env node
/**
 * GUI-002 e2e fixture — a deterministic "robota" sidecar (no LLM / API key).
 *
 * The Electron main process spawns this via `ROBOTA_GUI_SIDECAR_CMD`, passing `ROBOTA_WS_TOKEN` +
 * `ROBOTA_WS_PORT` in the env exactly as it would for the real CLI. It stands up the **REAL**
 * `WsTransport` (so the GUI-002 T5 loopback-auth — reject-before-emit on a bad/missing token — is
 * exercised for real against the token the GUI presents) and attaches a **scripted** EventEmitter session
 * that replies deterministically, so the headless e2e can assert connect → render → submit → permission.
 */

import { EventEmitter } from 'node:events';

import { WsTransport } from '@robota-sdk/agent-transport-ws';

const launchToken = process.env.ROBOTA_WS_TOKEN;
const port = Number.parseInt(process.env.ROBOTA_WS_PORT ?? '0', 10);
if (!launchToken || !port) {
  console.error('scripted-sidecar: ROBOTA_WS_TOKEN + ROBOTA_WS_PORT required');
  process.exit(1);
}
const rejectAdmission = process.env.ROBOTA_E2E_REJECT_ADMISSION === '1';
const token = rejectAdmission ? `rejected-${launchToken}` : launchToken;

/** Yield a macrotask so the renderer's streaming-text React state/ref flushes between emits. */
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/** A scripted IInteractiveSession: EventEmitter for on/off/emit, deterministic submit + permission. */
class ScriptedSession extends EventEmitter {
  #pendingPermission = null;

  getMessages() {
    return [];
  }
  getExecutionWorkspaceSnapshot() {
    return { entries: [] };
  }
  getContextState() {
    return { usedPercentage: 0, usedTokens: 0, maxTokens: 200000 };
  }
  getPendingPrompt() {
    return this.#pendingPermission ? 'permission' : null;
  }
  isExecuting() {
    return false;
  }
  getActiveDriverId() {
    return null;
  }
  getPendingCount() {
    return 0;
  }

  async submit(input) {
    // Echo the user's turn, then reply. A prompt containing "permission" raises a gated tool prompt.
    // Space the emits across ticks: a real LLM streams `text_delta` over time BEFORE `complete`, so the
    // renderer's streaming-text ref is populated by the time `complete` moves it into a message. Emitting
    // synchronously would race that React state update (a fixture artifact, not an app bug).
    this.emit('user_message', input);
    if (String(input).toLowerCase().includes('permission')) {
      this.#pendingPermission = 'perm-1';
      await tick();
      this.emit('permission_request', {
        id: 'perm-1',
        toolName: 'write_file',
        toolArgs: { path: 'x' },
      });
      return;
    }
    if (String(input).toLowerCase().includes('fail')) {
      await tick();
      this.emit('thinking', true);
      this.emit('text_delta', 'Partial reply before failure.');
      await tick();
      this.emit('error', new Error('Scripted provider failure'));
      return;
    }
    await tick();
    this.emit('thinking', true);
    this.emit('text_delta', 'Hello from the scripted agent.');
    await tick();
    this.emit('thinking', false);
    this.emit('complete', { success: true, content: 'Hello from the scripted agent.' });
  }

  resolvePermission(id, result) {
    if (id !== this.#pendingPermission) return;
    this.#pendingPermission = null;
    this.emit('prompt_resolved', { id });
    // After the owner allows, the "tool" completes (spaced across ticks, as above).
    void (async () => {
      await tick();
      this.emit('text_delta', result ? 'Wrote the file.' : 'Denied.');
      await tick();
      this.emit('complete', { success: true, content: result ? 'Wrote the file.' : 'Denied.' });
    })();
  }

  resolveAsk() {}
  executeCommand() {
    return Promise.resolve({ message: 'ok', success: true });
  }
  abort() {}
  cancelQueue() {}
}

const session = new ScriptedSession();
const usageBySource = {
  sessionId: 'usage-e2e-session',
  totalTokens: 42,
  promptTokens: 30,
  completionTokens: 12,
  costUsd: 0.0042,
  costExact: false,
  bySource: [],
  timeline: [
    { turnIndex: 0, source: { scope: 'main' }, label: 'main', spans: [], totalDurationMs: 0 },
  ],
};
const transport = new WsTransport({
  token,
  port,
  maxRetries: 0,
  allowedOrigins: ['file://'],
  personalUsageReporter: ({ period, timezone }) => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      period,
      timezone,
      interval: { startDate: today, endDate: today },
      totals: {
        sessions: 1,
        turns: 1,
        promptTokens: 30,
        completionTokens: 12,
        totalTokens: 42,
        costUsd: 0.0042,
        costStatus: 'estimated',
      },
      daily: [
        {
          date: today,
          partial: true,
          sessionIds: ['usage-e2e-session'],
          totals: {
            sessions: 1,
            turns: 1,
            promptTokens: 30,
            completionTokens: 12,
            totalTokens: 42,
            costUsd: 0.0042,
            costStatus: 'estimated',
          },
        },
      ],
      byModel: [
        {
          key: 'scripted-model',
          label: 'scripted-model',
          turns: 1,
          promptTokens: 30,
          completionTokens: 12,
          totalTokens: 42,
          costUsd: 0.0042,
          costStatus: 'estimated',
          sessionIds: ['usage-e2e-session'],
        },
      ],
      byProvider: [
        {
          key: 'unknown',
          label: 'unknown',
          turns: 1,
          promptTokens: 30,
          completionTokens: 12,
          totalTokens: 42,
          costUsd: 0.0042,
          costStatus: 'estimated',
          sessionIds: ['usage-e2e-session'],
        },
      ],
      bySurface: [
        {
          key: 'desktop-app',
          label: 'desktop-app',
          turns: 1,
          promptTokens: 30,
          completionTokens: 12,
          totalTokens: 42,
          costUsd: 0.0042,
          costStatus: 'estimated',
          sessionIds: ['usage-e2e-session'],
        },
      ],
      bySource: [],
      byActivity: [{ key: 'tool:Read', label: 'Read', kind: 'tool', count: 2 }],
      sessionIds: ['usage-e2e-session'],
      coverage: {
        validSessions: 1,
        corruptSessions: 0,
        unsupportedSessions: 0,
        duplicateObservations: 0,
        legacyObservations: 0,
        unknownModelObservations: 0,
        unknownProviderObservations: 0,
        unknownSurfaceObservations: 0,
        corruptSessionIds: [],
        unsupportedSessionIds: [],
      },
    };
  },
  usageReporter: () => usageBySource,
  storedSessionUsageReporter: () => usageBySource,
});
transport.attach(session);
await transport.start();
console.error(`scripted-sidecar: listening on 127.0.0.1:${port} (token-gated)`);

if (rejectAdmission) {
  setTimeout(() => process.exit(17), 1_000);
}

// Graceful shutdown so the GUI's window-close SIGTERM path is exercised without an orphan.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    void transport.stop().finally(() => process.exit(0));
  });
}
