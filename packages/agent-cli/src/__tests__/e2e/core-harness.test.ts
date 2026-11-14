import { createTestProductRuntime } from '../helpers/product-runtime.js';
/**
 * A default run carries the product's core harness: the first request the model receives holds it
 * once, `/context prompt` lists it as its own section, and a preset or `--system-prompt` composes
 * with it by the stated rule.
 */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startCli } from '../../cli.js';
import { CORE_HARNESS_PROMPT } from '../../harness/core-harness.js';
import { createTrustedWorkspaceProjectAccess } from '../helpers/trusted-workspace-project-access.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { IScriptedProvider } from '@robota-sdk/agent-core/testing';

const ORIGINAL_ARGV = process.argv;
const ORIGINAL_HOME = process.env.HOME;

let base: string;
let home: string;
let project: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-core-harness-')));
  home = join(base, 'home');
  project = join(base, 'project');
  mkdirSync(join(home, '.test-product', 'presets'), { recursive: true });
  writeFileSync(
    join(home, '.test-product', 'settings.json'),
    JSON.stringify({
      currentProvider: 'scripted',
      providers: { scripted: { type: 'scripted', model: 'scripted-model' } },
    }),
  );
  writeFileSync(
    join(home, '.test-product', 'presets', 'acme.json'),
    JSON.stringify({
      id: 'acme',
      title: 'Acme',
      description: 'A preset with its own system prompt',
      systemPrompt: 'ACME-PRESET-GUIDANCE',
    }),
  );
  mkdirSync(project);
  process.env.HOME = home;
  vi.spyOn(process, 'cwd').mockReturnValue(project);
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit:${String(code ?? 0)}`);
  }) as never);
});

afterEach(() => {
  process.argv = ORIGINAL_ARGV;
  process.env.HOME = ORIGINAL_HOME;
  rmSync(base, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** The structured part of a command's json envelope: what `/context prompt` lists. */
interface IEnvelopeData {
  readonly sections?: readonly { readonly id: string; readonly characters: number }[];
}

function scriptedDefinition(scripted: IScriptedProvider): IProviderDefinition {
  return {
    type: 'scripted',
    defaults: { model: 'scripted-model' },
    requiresApiKey: false,
    createProvider: () => scripted.provider,
  };
}

async function run(
  prompt: string,
  extra: readonly string[] = [],
): Promise<{ result: string; data: IEnvelopeData | undefined; scripted: IScriptedProvider }> {
  const scripted = createScriptedProvider([{ text: 'ok' }, { text: 'ok' }]);
  process.argv = [
    'node',
    'test-product',
    '-p',
    prompt,
    '--output-format',
    'json',
    '--no-session-persistence',
    ...extra,
  ];
  const out: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    out.push(String(chunk));
    return true;
  }) as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  try {
    await startCli({
      productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }),
      providerDefinitions: [scriptedDefinition(scripted)],
      projectAccess: await createTrustedWorkspaceProjectAccess(project),
    });
  } catch (error) {
    if (!/^process\.exit:\d+$/.test(error instanceof Error ? error.message : String(error))) {
      throw error;
    }
  } finally {
    vi.mocked(process.stdout.write).mockRestore();
    vi.mocked(process.stderr.write).mockRestore();
  }
  const envelope = JSON.parse(out.join('').trim()) as { result?: string; data?: IEnvelopeData };
  return { result: envelope.result ?? '', data: envelope.data, scripted };
}

function systemText(scripted: IScriptedProvider): string {
  return (scripted.requests[0] ?? [])
    .filter((message) => message.role === 'system')
    .map((message) => message.content ?? '')
    .join('\n');
}

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe('the core harness in a default run', () => {
  it('reaches the model once and is listed as its own prompt section', async () => {
    const prompt = await run('hello');
    expect(occurrences(systemText(prompt.scripted), CORE_HARNESS_PROMPT)).toBe(1);

    const listing = await run('/context prompt');
    const listed = listing.data?.sections?.find((section) => section.id === 'preset-system-prompt');
    expect(listing.result).toContain('preset-system-prompt');
    expect(listed?.characters).toBe(CORE_HARNESS_PROMPT.length);

    const section = await run('/context prompt preset-system-prompt');
    expect(section.result).toBe(CORE_HARNESS_PROMPT);
  }, 60_000);

  it('keeps a preset’s own system prompt after the core', async () => {
    const prompt = await run('hello', ['--preset', 'acme']);
    expect(systemText(prompt.scripted)).toContain(`${CORE_HARNESS_PROMPT}\n\nACME-PRESET-GUIDANCE`);
  }, 60_000);

  it('leaves a caller-supplied whole prompt as the whole prompt', async () => {
    const prompt = await run('hello', ['--system-prompt', 'WHOLE-PROMPT-ONLY']);
    expect(systemText(prompt.scripted)).toContain('WHOLE-PROMPT-ONLY');
    expect(systemText(prompt.scripted)).not.toContain(CORE_HARNESS_PROMPT);
  }, 60_000);
});
