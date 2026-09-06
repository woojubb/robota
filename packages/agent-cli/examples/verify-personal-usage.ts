import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { createNodeHostSessionStore } from '@robota-sdk/agent-framework';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

const exampleDirectory = dirname(fileURLToPath(import.meta.url));
const cliBinary = join(exampleDirectory, '..', 'dist', 'node', 'bin.js');
if (!existsSync(cliBinary)) {
  throw new Error('Build @robota-sdk/agent-cli before running the personal-usage scenario.');
}

const scenarioRoot = mkdtempSync(join(tmpdir(), 'robota-personal-usage-'));
const isolatedHome = join(scenarioRoot, 'home');
const now = new Date();
const timestamp = now.toISOString();
const secret = 'PROMPT_CONTENT_MUST_NOT_APPEAR';

const usage = {
  kind: 'exact' as const,
  scope: 'turn' as const,
  promptTokens: 30,
  completionTokens: 12,
  totalTokens: 42,
  contextUsedTokens: 42,
  contextMaxTokens: 200_000,
  contextUsedPercentage: 0.021,
  costStatus: 'estimated' as const,
  costUsd: 0.0042,
};

const record: IInteractiveSessionRecord = {
  id: 'usage-scenario-session',
  cwd: `/private/${secret}`,
  createdAt: timestamp,
  updatedAt: timestamp,
  messages: [
    {
      id: 'secret-message',
      role: 'user',
      content: secret,
      state: 'complete',
      timestamp: now,
    },
  ],
  history: [
    {
      id: 'usage-observation_scenario-turn',
      timestamp: now,
      category: 'event',
      type: 'usage-observation',
      data: {
        usageObservationId: 'scenario-turn',
        turnId: 'scenario-turn',
        outcome: 'success',
        modelId: 'scenario-model',
        providerId: 'scenario-provider',
        surface: 'cli',
        usage,
      },
    },
    {
      id: 'usage-summary_scenario-turn',
      timestamp: now,
      category: 'event',
      type: 'usage-summary',
      data: usage,
    },
    {
      id: 'tool-start_scenario-turn',
      timestamp: now,
      category: 'event',
      type: 'tool-start',
      data: { toolName: 'Read', firstArg: secret },
    },
  ],
};

try {
  const store = createNodeHostSessionStore(join(isolatedHome, '.robota', 'sessions'));
  store.save(record);

  const run = (args: readonly string[]) =>
    spawnSync(process.execPath, [cliBinary, 'usage', ...args], {
      cwd: scenarioRoot,
      env: { ...process.env, HOME: isolatedHome },
      encoding: 'utf8',
    });

  const json = run(['--period', '30d', '--timezone', 'UTC', '--format', 'json']);
  if (json.status !== 0) throw new Error(`JSON command failed: ${json.stderr}`);
  const report = JSON.parse(json.stdout) as {
    schemaVersion: number;
    daily: Array<{ partial: boolean }>;
    totals: { sessions: number; turns: number; totalTokens: number; costStatus: string };
    byModel: Array<{ key: string }>;
    byActivity: Array<{ key: string; count: number }>;
  };
  if (
    report.schemaVersion !== 1 ||
    report.totals.sessions !== 1 ||
    report.totals.turns !== 1 ||
    report.totals.totalTokens !== 42 ||
    report.totals.costStatus !== 'estimated' ||
    report.daily.length !== 30 ||
    report.daily.at(-1)?.partial !== true ||
    report.byModel[0]?.key !== 'scenario-model' ||
    report.byActivity[0]?.key !== 'tool:Read'
  ) {
    throw new Error(`Unexpected JSON report: ${json.stdout}`);
  }
  if (json.stdout.includes(secret)) throw new Error('JSON output leaked persisted content.');

  const text = run(['--period', '7d', '--timezone', 'UTC']);
  const textMarkers = [
    'Personal usage — 7d (UTC)',
    '42 tokens',
    'estimated',
    '(partial)',
    'By model',
    'scenario-model',
    'By surface',
    'cli',
    'Activity',
    'tool:Read',
    'Coverage:',
  ];
  if (text.status !== 0 || textMarkers.some((marker) => !text.stdout.includes(marker))) {
    throw new Error(`Text command failed or omitted usage: ${text.stderr}${text.stdout}`);
  }
  if (text.stdout.includes(secret)) throw new Error('Text output leaked persisted content.');

  const invalid = run(['--period', '14d']);
  if (invalid.status === 0 || !invalid.stderr.includes('expected 7d or 30d')) {
    throw new Error('Invalid period did not fail with the documented diagnostic.');
  }

  process.stdout.write(
    `${JSON.stringify({
      scenario: 'personal-usage-cli',
      jsonExit: json.status,
      textExit: text.status,
      invalidExit: invalid.status,
      totals: report.totals,
      privacyLeak: false,
    })}\n`,
  );
} finally {
  rmSync(scenarioRoot, { recursive: true, force: true });
}
