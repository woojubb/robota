/**
 * FLOW-007 LIVE end-to-end tests — `/workflows create` against a REAL LLM provider.
 *
 * These make real, billable network calls and are non-deterministic, so they are OPT-IN and never run
 * in normal `pnpm test` / CI. They run only when BOTH are true:
 *   - `RUN_LIVE_LLM=1` is set (explicit opt-in), and
 *   - a provider API key is present (currently `ANTHROPIC_API_KEY`).
 *
 * Run with:  `pnpm --filter @robota-sdk/agent-command-workflows test:live`
 * (the `test:live` script sets `RUN_LIVE_LLM=1`; the key comes from your environment — see the
 * `provider-keys-local-run` note: it must be in `~/.zshenv` to be visible to the test shell).
 *
 * They automate the same scenarios verified by hand for FLOW-007 (existing-node authoring, a
 * multi-step pipeline the model composes, a Phase-3 prompt node created + persisted + executed, and a
 * re-run-from-disk round-trip) so the exact checks are repeatable next time.
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import { executeWorkflowsCreate } from '../create-command.js';
import { executeWorkflowsRun } from '../run-command.js';

const OPT_IN = process.env['RUN_LIVE_LLM'] === '1';
const HAS_KEY = Boolean(
  process.env['ANTHROPIC_API_KEY'] ??
  process.env['OPENAI_API_KEY'] ??
  process.env['GEMINI_API_KEY'] ??
  process.env['DEEPSEEK_API_KEY'] ??
  process.env['DASHSCOPE_API_KEY'],
);
const RUN_LIVE = OPT_IN && HAS_KEY;

// Real LLM calls take a few seconds each; give generous headroom.
const LIVE_TIMEOUT_MS = 90_000;

let providerDefinitions: readonly IProviderDefinition[];
let dir: string;

beforeAll(() => {
  providerDefinitions = createDefaultProviderDefinitions();
});
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow007-live-'));
});
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

async function create(desc: string, extraArgs = ''): ReturnType<typeof executeWorkflowsCreate> {
  return executeWorkflowsCreate(`"${desc}"${extraArgs ? ` ${extraArgs}` : ''}`, dir, {
    providerDefinitions,
  });
}

describe.skipIf(!RUN_LIVE)(
  'FLOW-007 live LLM authoring (opt-in: RUN_LIVE_LLM=1 + a provider key)',
  () => {
    it(
      'authors + runs an existing-node uppercase workflow → output is uppercased',
      async () => {
        const r = await create(
          'convert the input text to uppercase',
          '--input text="live scenario one"',
        );
        expect(r.success).toBe(true);
        expect(r.message).toContain('LIVE SCENARIO ONE');
      },
      LIVE_TIMEOUT_MS,
    );

    it(
      'lets the model compose a multi-step pipeline (trim then uppercase)',
      async () => {
        const r = await create(
          'trim the surrounding whitespace from the input and then uppercase it',
          '--input text="   padded value   "',
        );
        expect(r.success).toBe(true);
        // The exact quoted value appears only if the output was BOTH trimmed AND uppercased — the
        // untrimmed form renders as `"   PADDED VALUE   "`, which does not contain this substring.
        // (The run always echoes the raw input on the `input` node, so we can't assert absence of it.)
        expect(r.message).toContain('"PADDED VALUE"');
      },
      LIVE_TIMEOUT_MS,
    );

    it(
      'Phase 3: creates a prompt node, persists it WITH the active provider, and executes it live',
      async () => {
        const r = await create(
          'rewrite the input text in the style of a pirate',
          '--input text="Please read the document before the meeting."',
        );
        expect(r.success).toBe(true);

        const nodeFiles = await readdir(join(dir, '.workflows', 'nodes'));
        const manifestFile = nodeFiles.find((f) => f.endsWith('.node.json'));
        expect(manifestFile).toBeDefined();

        const manifest = JSON.parse(
          await readFile(join(dir, '.workflows', 'nodes', manifestFile as string), 'utf-8'),
        ) as { kind: string; provider?: string; systemPromptTemplate: string };
        expect(manifest.kind).toBe('prompt');
        // The authored node must persist a provider (inherited from the active provider) so it reloads
        // deterministically instead of silently defaulting.
        expect(manifest.provider).toBeTruthy();
        expect(manifest.systemPromptTemplate).toContain('{{');

        // The prompt node ran without error (success above) and surfaced a text output. The transform
        // content itself is non-deterministic, so we assert structure, not exact wording.
        expect(r.message).toContain('.text');
      },
      LIVE_TIMEOUT_MS,
    );

    it(
      'the saved Phase-3 artifact re-runs from disk (reloads the persisted prompt node)',
      async () => {
        // Author one whose name we control, then re-run it purely from disk.
        const created = await create(
          'rephrase the input as an enthusiastic startup pitch',
          '--name pitch-live --input text="We store files."',
        );
        expect(created.success).toBe(true);

        const rerun = await executeWorkflowsRun('.workflows/pitch-live.json', dir);
        expect(rerun.success).toBe(true);
        expect(rerun.message).toContain('completed');
      },
      LIVE_TIMEOUT_MS,
    );
  },
);

// Guard: if opted in but no key is present, make the misconfiguration loud rather than silently green.
describe.skipIf(!OPT_IN || HAS_KEY)('FLOW-007 live tests requested but no provider key', () => {
  it('fails clearly so the missing key is not mistaken for a pass', () => {
    throw new Error(
      'RUN_LIVE_LLM=1 was set but no provider API key is present. Set ANTHROPIC_API_KEY (see the provider-keys-local-run note).',
    );
  });
});
