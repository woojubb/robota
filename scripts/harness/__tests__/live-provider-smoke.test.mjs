import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  apiKeyEnvVarOf,
  formatReport,
  messageText,
  modelOverrideEnvVar,
  redactSecrets,
  resolveBuiltEntry,
  selectLiveProviders,
  smokeProvider,
} from '../live-provider-smoke.mjs';

/** Minimal stand-in for a real IProviderDefinition — only the fields the selector reads. */
function definition(type, defaults, createProvider) {
  return { type, defaults, ...(createProvider !== undefined && { createProvider }) };
}

const ANTHROPIC = definition('anthropic', {
  model: 'claude-sonnet-4-6',
  apiKey: '$ENV:ANTHROPIC_API_KEY',
});
const OPENAI = definition('openai', { apiKey: '$ENV:OPENAI_API_KEY' });
const LOCAL = definition('gemma', {
  model: 'local-model',
  apiKey: 'lm-studio',
  baseURL: 'http://localhost:1234/v1',
});

describe('apiKeyEnvVarOf', () => {
  it('reads the env-var name out of an $ENV: apiKey reference', () => {
    expect(apiKeyEnvVarOf(ANTHROPIC)).toBe('ANTHROPIC_API_KEY');
  });

  it('returns undefined for a literal apiKey (local/self-hosted definitions)', () => {
    expect(apiKeyEnvVarOf(LOCAL)).toBeUndefined();
  });

  it('returns undefined for an empty $ENV: reference', () => {
    expect(apiKeyEnvVarOf(definition('x', { apiKey: '$ENV:   ' }))).toBeUndefined();
  });
});

describe('modelOverrideEnvVar', () => {
  it('derives a shouty env-var name from the provider type', () => {
    expect(modelOverrideEnvVar('openai')).toBe('LIVE_SMOKE_MODEL_OPENAI');
    expect(modelOverrideEnvVar('openai-compatible')).toBe('LIVE_SMOKE_MODEL_OPENAI_COMPATIBLE');
  });
});

describe('selectLiveProviders (HARNESS-024 gating)', () => {
  it('selects nothing when the environment carries no provider credential', () => {
    const selection = selectLiveProviders([ANTHROPIC, OPENAI, LOCAL], {});

    expect(selection.runnable).toEqual([]);
    expect(selection.unconfigured).toEqual([]);
    expect(selection.skipped.map((s) => s.type)).toEqual(['anthropic', 'openai', 'gemma']);
  });

  it('selects only the provider whose $ENV: key is present and non-empty', () => {
    const selection = selectLiveProviders([ANTHROPIC, OPENAI, LOCAL], {
      ANTHROPIC_API_KEY: 'sk-live-key-value',
      OPENAI_API_KEY: '',
    });

    expect(selection.runnable).toHaveLength(1);
    expect(selection.runnable[0]).toMatchObject({
      type: 'anthropic',
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
      model: 'claude-sonnet-4-6',
    });
    expect(selection.skipped.map((s) => s.type)).toEqual(['openai', 'gemma']);
  });

  it('reports a keyed provider with no model as unconfigured (WARN), not runnable', () => {
    const selection = selectLiveProviders([OPENAI], { OPENAI_API_KEY: 'sk-openai-key-value' });

    expect(selection.runnable).toEqual([]);
    expect(selection.unconfigured[0].reason).toContain('LIVE_SMOKE_MODEL_OPENAI');
  });

  it('lets the per-provider model override supply the missing model', () => {
    const selection = selectLiveProviders([OPENAI], {
      OPENAI_API_KEY: 'sk-openai-key-value',
      LIVE_SMOKE_MODEL_OPENAI: 'gpt-test',
    });

    expect(selection.unconfigured).toEqual([]);
    expect(selection.runnable[0].model).toBe('gpt-test');
  });

  it('honours --provider by narrowing to a single type', () => {
    const selection = selectLiveProviders(
      [ANTHROPIC, OPENAI],
      {
        ANTHROPIC_API_KEY: 'sk-live-key-value',
        OPENAI_API_KEY: 'sk-openai-key-value',
        LIVE_SMOKE_MODEL_OPENAI: 'gpt-test',
      },
      { only: 'openai' },
    );

    expect(selection.runnable.map((c) => c.type)).toEqual(['openai']);
  });
});

describe('resolveBuiltEntry', () => {
  /** Fixture workspace: one package, its manifest, and optionally its built entry file. */
  async function workspace({ built }) {
    const root = await mkdtemp(path.join(tmpdir(), 'robota-live-smoke-'));
    const packageDir = path.join(root, 'packages', 'agent-core');
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({
        name: '@robota-sdk/agent-core',
        exports: { '.': { node: { import: './dist/node/index.js' } } },
      }),
      'utf8',
    );
    if (built) {
      const distDir = path.join(packageDir, 'dist', 'node');
      mkdirSync(distDir, { recursive: true });
      writeFileSync(path.join(distDir, 'index.js'), 'export const x = 1;\n', 'utf8');
    }
    return root;
  }

  it('reads the entry location from the owning package manifest, not a hardcoded path', async () => {
    const root = await workspace({ built: true });

    expect(resolveBuiltEntry('@robota-sdk/agent-core', root)).toBe(
      path.join(root, 'packages', 'agent-core', 'dist', 'node', 'index.js'),
    );
  });

  // A fresh CI checkout has no build output. This is the case that must NOT be mistaken for a
  // working workspace — the caller turns it into an explicit "not built" message, never a silent pass.
  it('returns undefined when the package is declared but not built', async () => {
    const root = await workspace({ built: false });

    expect(resolveBuiltEntry('@robota-sdk/agent-core', root)).toBeUndefined();
  });

  it('returns undefined for a package name no workspace manifest claims', async () => {
    const root = await workspace({ built: true });

    expect(resolveBuiltEntry('@robota-sdk/does-not-exist', root)).toBeUndefined();
  });
});

describe('redactSecrets', () => {
  it('scrubs every occurrence of a secret, including inside an echoed error body', () => {
    const secret = 'sk-ant-super-secret-value';
    const line = `401 invalid x-api-key: ${secret} (sent ${secret})`;

    const redacted = redactSecrets(line, [secret]);

    expect(redacted).not.toContain(secret);
    expect(redacted).toBe('401 invalid x-api-key: ***REDACTED*** (sent ***REDACTED***)');
  });

  it('ignores short/absent values so ordinary text is never mangled', () => {
    expect(redactSecrets('all good', ['', 'abc', undefined])).toBe('all good');
  });
});

describe('messageText', () => {
  it('reads string content and concatenates text parts', () => {
    expect(messageText({ content: 'pong' })).toBe('pong');
    expect(messageText({ content: [{ text: 'po' }, { text: 'ng' }] })).toBe('pong');
    expect(messageText({})).toBe('');
  });
});

describe('smokeProvider', () => {
  const candidate = {
    type: 'stub',
    model: 'stub-model',
    apiKey: 'sk-stub-key-value',
    definition: {
      createProvider: () => ({
        chat: async () => ({ content: 'pong' }),
        chatStream: async function* () {
          yield { content: 'po' };
          yield { content: 'ng' };
        },
      }),
    },
  };
  const createUserMessage = (content) => ({ role: 'user', content });

  it('passes when both the chat and the stream probe return text', async () => {
    const result = await smokeProvider(candidate, createUserMessage);

    expect(result.status).toBe('pass');
    expect(result.chat.chars).toBe(4);
    expect(result.stream.chunks).toBe(2);
  });

  it('fails — not throws — when the live call rejects', async () => {
    const failing = {
      ...candidate,
      definition: {
        createProvider: () => ({
          chat: async () => {
            throw new Error('401 authentication_error');
          },
        }),
      },
    };

    const result = await smokeProvider(failing, createUserMessage);

    expect(result).toMatchObject({ status: 'fail', stage: 'liveCall' });
    expect(result.error).toContain('401');
  });

  it('fails when the provider answers with an empty message (silent-success guard)', async () => {
    const empty = {
      ...candidate,
      definition: { createProvider: () => ({ chat: async () => ({ content: '   ' }) }) },
    };

    expect((await smokeProvider(empty, createUserMessage)).status).toBe('fail');
  });

  it('fails when the stream yields no chunks', async () => {
    const silent = {
      ...candidate,
      definition: {
        createProvider: () => ({
          chat: async () => ({ content: 'pong' }),
          // eslint-disable-next-line require-yield
          chatStream: async function* () {},
        }),
      },
    };

    const result = await smokeProvider(silent, createUserMessage);

    expect(result.status).toBe('fail');
    expect(result.error).toContain('no chunks');
  });

  it('passes with a recorded note when the provider exposes no chatStream()', async () => {
    const noStream = {
      ...candidate,
      definition: { createProvider: () => ({ chat: async () => ({ content: 'pong' }) }) },
    };

    const result = await smokeProvider(noStream, createUserMessage);

    expect(result.status).toBe('pass');
    expect(result.stream.skipped).toContain('no chatStream()');
  });
});

describe('formatReport', () => {
  it('states plainly that a credential-less run is not a failure', () => {
    const selection = selectLiveProviders([ANTHROPIC], {});

    const report = formatReport(selection, []);

    expect(report).toContain('SKIPPED');
    expect(report).toContain('not a failure');
    expect(report).toContain('ANTHROPIC_API_KEY not set');
  });

  it('names the provider and model on a pass', () => {
    const selection = { runnable: [{ type: 'anthropic' }], unconfigured: [], skipped: [] };
    const results = [
      {
        type: 'anthropic',
        model: 'claude-sonnet-4-6',
        status: 'pass',
        chat: { chars: 4, ms: 900 },
        stream: { chars: 4, chunks: 2, ms: 950 },
      },
    ];

    const report = formatReport(selection, results);

    expect(report).toContain('PASS anthropic (model=claude-sonnet-4-6)');
    expect(report).toContain('live-provider-smoke: PASS (1/1 live providers reachable).');
  });

  it('summarises a failure with its stage and message', () => {
    const selection = { runnable: [{ type: 'anthropic' }], unconfigured: [], skipped: [] };
    const results = [
      { type: 'anthropic', model: 'm', status: 'fail', stage: 'liveCall', error: '400 max_tokens' },
    ];

    const report = formatReport(selection, results);

    expect(report).toContain('FAIL anthropic (model=m) at liveCall: 400 max_tokens');
    expect(report).toContain('live-provider-smoke: FAIL (1/1 live providers broken).');
  });
});
