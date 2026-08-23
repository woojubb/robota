#!/usr/bin/env node

/**
 * HARNESS-024 — env-gated LIVE provider smoke.
 *
 * Every provider/transport boundary in the test suite is scripted or replayed. That is deliberate
 * (deterministic, free, offline), but it means a whole class of breakage is invisible to CI: the
 * auth handshake, wire-format drift in the vendor SDK, a required request field the adapter stopped
 * sending (the Anthropic 400 / maxTokens family), and the shape of a streaming response. Those
 * regressions were each caught three times by a HUMAN running the CLI by hand. This script is the
 * mechanical replacement: one minimal REAL turn per credentialed provider.
 *
 * Gating (the whole point — an UNATTENDED run must never fail for lack of credentials):
 *   - A provider is selected only when its definition's `defaults.apiKey` is an `$ENV:<NAME>`
 *     reference AND `<NAME>` is present and non-empty in the environment.
 *   - No credentialed provider at all  →  clean SKIP, exit 0. Never a failure.
 *   - The provider list and the env-var names are read from the provider DEFINITIONS, so a newly
 *     added provider is covered automatically and this file holds no provider-name table.
 *
 * INFRA-061 — two corrections to that gating, both about a green run that verified nothing:
 *
 *   1. A run that exercised ZERO providers is reported to GitHub as a `::warning::` annotation and in
 *      the job summary. "Live provider smoke: success" otherwise reads as "the providers answered",
 *      when it may equally mean "there were no credentials, so nothing was called" — opposite facts
 *      behind the same green tick. The exit code is deliberately unchanged: a nightly that is red for
 *      an unprovisioned secret trains people to ignore it.
 *   2. An EXPLICIT single-provider request (`--provider <type>`) that cannot run is now a FAILURE.
 *      Someone dispatching the workflow for one named provider is asking a question; answering it with
 *      a silent green is the defect class this script exists to remove. The unattended nightly passes
 *      no `--provider`, so its never-fail posture is untouched.
 *
 * What each selected provider runs (two tiny calls, `maxTokens` capped — cents, not dollars):
 *   1. non-streaming `chat()`   — proves auth + request/response wire format.
 *   2. streaming `chatStream()` — proves the streaming shape (chunks arrive, text assembles).
 * Both must return non-empty assistant text or the provider is reported FAIL.
 *
 * Exit codes: 0 = every selected provider passed (or nothing was selected), 1 = a selected
 * provider's live call failed, or the workspace is not built.
 *
 * A provider that has a key but no model to call (OpenAI ships no default model by design) is
 * reported WARN, not FAIL, and does not change the exit code: this smoke exists to catch wire
 * drift, and a red nightly for a missing config value only trains people to ignore the signal.
 * The warning names the exact env var that fixes it.
 *
 * Secrets are never printed. Every line written by this script passes through `redactSecrets`,
 * which scrubs the resolved key values — vendor SDK errors sometimes echo request headers back.
 *
 * Run:
 *   node scripts/harness/live-provider-smoke.mjs [--provider <type>] [--report-file <path>]
 * Prerequisite: the provider packages must be built (`pnpm --filter @robota-sdk/agent-builtin-providers... build:js`).
 */

import { appendFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** Packages the smoke loads at runtime, by manifest name — never by build-output path. */
const PROVIDER_DEFAULTS_PACKAGE = '@robota-sdk/agent-builtin-providers';
const CORE_PACKAGE = '@robota-sdk/agent-core';

/** The one prompt every provider gets. Short, deterministic to grade, cheap to answer. */
export const SMOKE_PROMPT = 'Reply with exactly one word: pong';
/** Hard cap on generated tokens — this is a reachability probe, not a capability test. */
export const SMOKE_MAX_TOKENS = 32;
/** Per-call wall-clock budget. A hung provider must not hang the scheduled job. */
export const SMOKE_TIMEOUT_MS = 60_000;

const ENV_REFERENCE_PREFIX = '$ENV:';

/**
 * Per-provider model override env var, e.g. `LIVE_SMOKE_MODEL_OPENAI`.
 * Needed for providers whose definition ships no default model.
 */
export function modelOverrideEnvVar(providerType) {
  return `LIVE_SMOKE_MODEL_${providerType.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/** Name of the env var a definition's `$ENV:` apiKey reference points at, or undefined. */
export function apiKeyEnvVarOf(definition) {
  const reference = definition?.defaults?.apiKey;
  if (typeof reference !== 'string' || !reference.startsWith(ENV_REFERENCE_PREFIX))
    return undefined;
  const name = reference.slice(ENV_REFERENCE_PREFIX.length).trim();
  return name.length > 0 ? name : undefined;
}

/**
 * Pure selection: which provider definitions can be smoked with the given environment.
 *
 * Returns `{ runnable, unconfigured, skipped }` where
 *   - runnable     = key present AND a model to call (definition default or override env var)
 *   - unconfigured = key present but no model → WARN (does not fail the run)
 *   - skipped      = no credential in this environment → silent, expected, exit 0
 */
export function selectLiveProviders(definitions, env, options = {}) {
  const only = options.only;
  const runnable = [];
  const unconfigured = [];
  const skipped = [];

  for (const definition of definitions) {
    const type = definition.type;
    if (only !== undefined && only !== type) continue;

    const apiKeyEnvVar = apiKeyEnvVarOf(definition);
    if (apiKeyEnvVar === undefined) {
      // Local/self-hosted definitions carry a literal apiKey and a localhost baseURL. There is no
      // remote credential to gate on, and no such server in CI, so they are out of scope here.
      skipped.push({ type, reason: 'no $ENV: apiKey reference (local/self-hosted definition)' });
      continue;
    }

    const apiKey = env[apiKeyEnvVar];
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      skipped.push({ type, reason: `${apiKeyEnvVar} not set` });
      continue;
    }

    const overrideEnvVar = modelOverrideEnvVar(type);
    const model = env[overrideEnvVar] || definition.defaults?.model;
    if (typeof model !== 'string' || model.length === 0) {
      unconfigured.push({
        type,
        apiKeyEnvVar,
        reason: `${apiKeyEnvVar} is set but this provider ships no default model — set ${overrideEnvVar}`,
      });
      continue;
    }

    runnable.push({ type, apiKeyEnvVar, apiKey, model, definition });
  }

  return { runnable, unconfigured, skipped };
}

/** Replace every occurrence of every secret with a fixed marker. */
export function redactSecrets(text, secrets) {
  let output = String(text);
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) {
      output = output.split(secret).join('***REDACTED***');
    }
  }
  return output;
}

/** Extract plain text from a TUniversalMessage-ish value (content may be string or parts). */
export function messageText(message) {
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : '',
      )
      .join('');
  }
  return '';
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** One non-streaming turn. Resolves to `{ chars, ms }`; throws when the reply carries no text. */
async function runChatProbe(provider, createUserMessage, model) {
  const started = Date.now();
  const reply = await withTimeout(
    provider.chat([createUserMessage(SMOKE_PROMPT)], {
      model,
      maxTokens: SMOKE_MAX_TOKENS,
      temperature: 0,
    }),
    SMOKE_TIMEOUT_MS,
    'chat()',
  );
  const text = messageText(reply).trim();
  if (text.length === 0) throw new Error('chat() returned an empty assistant message');
  return { chars: text.length, ms: Date.now() - started };
}

/** One streaming turn. Resolves to `{ chars, chunks, ms }`; throws on an empty/silent stream. */
async function runStreamProbe(provider, createUserMessage, model) {
  const started = Date.now();
  const collect = (async () => {
    let assembled = '';
    let chunks = 0;
    for await (const chunk of provider.chatStream([createUserMessage(SMOKE_PROMPT)], {
      model,
      maxTokens: SMOKE_MAX_TOKENS,
      temperature: 0,
    })) {
      chunks += 1;
      assembled += messageText(chunk);
    }
    return { assembled: assembled.trim(), chunks };
  })();

  const { assembled, chunks } = await withTimeout(collect, SMOKE_TIMEOUT_MS, 'chatStream()');
  if (chunks === 0) throw new Error('chatStream() yielded no chunks');
  if (assembled.length === 0) throw new Error('chatStream() assembled no text across its chunks');
  return { chars: assembled.length, chunks, ms: Date.now() - started };
}

/** Smoke one selected provider. Never throws — the outcome is the return value. */
export async function smokeProvider(candidate, createUserMessage) {
  const { type, model, definition, apiKey } = candidate;
  const base = { type, model };
  let provider;
  try {
    provider = definition.createProvider({ apiKey, model });
  } catch (error) {
    return {
      ...base,
      status: 'fail',
      stage: 'createProvider',
      error: String(error?.message ?? error),
    };
  }

  try {
    const chat = await runChatProbe(provider, createUserMessage, model);

    if (typeof provider.chatStream !== 'function') {
      return {
        ...base,
        status: 'pass',
        chat,
        stream: { skipped: 'provider exposes no chatStream()' },
      };
    }
    const stream = await runStreamProbe(provider, createUserMessage, model);
    return { ...base, status: 'pass', chat, stream };
  } catch (error) {
    return { ...base, status: 'fail', stage: 'liveCall', error: String(error?.message ?? error) };
  } finally {
    if (typeof provider?.close === 'function') {
      await provider.close().catch(() => {});
    } else if (typeof provider?.dispose === 'function') {
      await provider.dispose().catch(() => {});
    }
  }
}

/** Render the human-readable report. Pure — the caller redacts and prints. */
export function formatReport({ runnable, unconfigured, skipped }, results) {
  const lines = [];

  if (runnable.length === 0) {
    lines.push('live-provider-smoke: SKIPPED — no provider credentials in this environment.');
    lines.push("  A provider runs only when its definition's $ENV: apiKey variable is set:");
    for (const entry of skipped) lines.push(`  - ${entry.type}: ${entry.reason}`);
    for (const entry of unconfigured) lines.push(`  - ${entry.type}: WARN ${entry.reason}`);
    lines.push('  This is the expected outcome without credentials and is not a failure.');
    return lines.join('\n');
  }

  lines.push(`live-provider-smoke: ${runnable.length} credentialed provider(s).`);
  for (const result of results) {
    if (result.status === 'pass') {
      const stream = result.stream.skipped
        ? `stream=skipped (${result.stream.skipped})`
        : `stream=${result.stream.chunks} chunks/${result.stream.chars} chars in ${result.stream.ms}ms`;
      lines.push(
        `  PASS ${result.type} (model=${result.model}) chat=${result.chat.chars} chars in ${result.chat.ms}ms, ${stream}`,
      );
    } else {
      lines.push(
        `  FAIL ${result.type} (model=${result.model}) at ${result.stage}: ${result.error}`,
      );
    }
  }
  for (const entry of unconfigured) lines.push(`  WARN ${entry.type}: ${entry.reason}`);
  for (const entry of skipped) lines.push(`  skip ${entry.type}: ${entry.reason}`);

  const failed = results.filter((r) => r.status === 'fail');
  lines.push(
    failed.length === 0
      ? `live-provider-smoke: PASS (${results.length}/${results.length} live providers reachable).`
      : `live-provider-smoke: FAIL (${failed.length}/${results.length} live providers broken).`,
  );
  return lines.join('\n');
}

/**
 * Why an explicitly-requested provider could not run, or undefined when the request is satisfiable.
 *
 * Only an EXPLICIT `--provider <type>` request is judged. Without one the caller asked for "whatever
 * is credentialed", and "nothing was" is a truthful answer to that question.
 */
export function explicitRequestFailure(selection, options = {}) {
  const requested = options.only;
  if (requested === undefined) return undefined;
  if (selection.runnable.some((candidate) => candidate.type === requested)) return undefined;

  const unconfigured = selection.unconfigured.find((entry) => entry.type === requested);
  if (unconfigured !== undefined) return `--provider ${requested}: ${unconfigured.reason}`;

  const skipped = selection.skipped.find((entry) => entry.type === requested);
  if (skipped !== undefined) return `--provider ${requested}: ${skipped.reason}`;

  return `--provider ${requested}: no provider definition of that type exists`;
}

/**
 * GitHub-Actions surfacing for a run that called nothing. Returns the lines to write, so the decision
 * is testable without an Actions environment. Empty when there is nothing to disclaim.
 */
export function zeroCoverageNotice(selection, env = {}) {
  if (selection.runnable.length > 0) return [];
  if (env.GITHUB_ACTIONS !== 'true') return [];
  const providers = [...selection.skipped, ...selection.unconfigured].map((e) => e.type).join(', ');
  return [
    '::warning title=live provider smoke exercised 0 providers::This run called no provider and ' +
      'therefore verified nothing. A green tick here means "no credentials were available", not ' +
      `"the providers answered". Uncovered: ${providers || 'none discovered'}.`,
  ];
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--provider') options.only = argv[++i];
    else if (argv[i] === '--report-file') options.reportFile = argv[++i];
  }
  return options;
}

/**
 * Locate a workspace package by its manifest `name`, and return its built Node ESM entry as
 * declared by that manifest's own `exports['.'].node.import`.
 *
 * The build-output location is NOT hardcoded here: it is read from the package that owns it, so a
 * change to the build layout moves this loader with it. Returns undefined when the package is not
 * built yet (a fresh checkout has no build output).
 */
export function resolveBuiltEntry(packageName, root = WORKSPACE_ROOT) {
  const packagesRoot = path.join(root, 'packages');
  if (!existsSync(packagesRoot)) return undefined;

  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = path.join(packagesRoot, entry.name);
    const manifestPath = path.join(packageDir, 'package.json');
    if (!existsSync(manifestPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    if (manifest.name !== packageName) continue;

    const nodeImport = manifest.exports?.['.']?.node?.import;
    if (typeof nodeImport !== 'string') return undefined;
    const absolute = path.join(packageDir, nodeImport);
    return existsSync(absolute) ? absolute : undefined;
  }
  return undefined;
}

/** Load the provider definitions + message factory from the BUILT workspace output. */
async function loadWorkspace() {
  const defaultsEntry = resolveBuiltEntry(PROVIDER_DEFAULTS_PACKAGE);
  const coreEntry = resolveBuiltEntry(CORE_PACKAGE);
  if (defaultsEntry === undefined || coreEntry === undefined) {
    return undefined;
  }
  const [{ createDefaultProviderDefinitions }, { createUserMessage }] = await Promise.all([
    import(pathToFileURL(defaultsEntry).href),
    import(pathToFileURL(coreEntry).href),
  ]);
  return { createDefaultProviderDefinitions, createUserMessage };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);

  const workspace = await loadWorkspace();
  if (workspace === undefined) {
    process.stdout.write(
      'live-provider-smoke: workspace is not built — run\n' +
        '  pnpm --filter @robota-sdk/agent-builtin-providers... build:js\n',
    );
    process.exitCode = 1;
    return;
  }

  const definitions = workspace.createDefaultProviderDefinitions();
  const selection = selectLiveProviders(definitions, env, options);
  const secrets = selection.runnable.map((candidate) => candidate.apiKey);

  const results = [];
  for (const candidate of selection.runnable) {
    results.push(await smokeProvider(candidate, workspace.createUserMessage));
  }

  const report = redactSecrets(formatReport(selection, results), secrets);
  process.stdout.write(`${report}\n`);

  for (const line of zeroCoverageNotice(selection, env)) process.stdout.write(`${line}\n`);
  if (env.GITHUB_STEP_SUMMARY !== undefined) {
    // `report` is already redacted above; the count is the line a reader of the run page needs, since
    // "success" alone cannot distinguish "the providers answered" from "nothing was called".
    await appendFile(
      env.GITHUB_STEP_SUMMARY,
      `### Live provider smoke\n\n` +
        `Providers actually called: **${selection.runnable.length}**\n\n` +
        `${report}\n`,
      'utf-8',
    );
  }

  if (options.reportFile !== undefined) {
    const summary = {
      generatedAt: new Date().toISOString(),
      // The key VALUES never leave this process; only the variable NAMES are recorded.
      credentialed: selection.runnable.map((c) => ({
        type: c.type,
        model: c.model,
        apiKeyEnvVar: c.apiKeyEnvVar,
      })),
      unconfigured: selection.unconfigured,
      skipped: selection.skipped,
      results,
    };
    const serialized = redactSecrets(JSON.stringify(summary, null, 2), secrets);
    await mkdir(path.dirname(path.resolve(options.reportFile)), { recursive: true });
    await writeFile(path.resolve(options.reportFile), `${serialized}\n`, 'utf-8');
  }

  if (results.some((result) => result.status === 'fail')) {
    process.exitCode = 1;
    return;
  }

  // An explicitly-named provider that could not run is a failure — see the header. Reported after the
  // report is written so the artefact still records what happened.
  const unsatisfied = explicitRequestFailure(selection, options);
  if (unsatisfied !== undefined) {
    process.stdout.write(
      `live-provider-smoke: FAIL — the requested provider was never called.\n  ${unsatisfied}\n`,
    );
    process.exitCode = 1;
  }
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
