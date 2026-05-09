#!/usr/bin/env node
/**
 * deepseek-api-provider backlog User Execution Test Scenario
 *
 * Verifies that @robota-sdk/agent-provider-deepseek is a correctly implemented
 * public SDK package and that DeepSeek is wired into the CLI default provider list.
 *
 * Scenarios:
 *   1. createDeepSeekProviderDefinition() returns correct type, displayName, defaults,
 *      requiresApiKey, and model catalog (including deprecated aliases)
 *   2. DEFAULT_PROVIDER_DEFINITIONS in agent-cli includes a DeepSeek entry
 *
 * Usage: node scripts/examples/deepseek-provider-demo.mjs
 * Prerequisites: pnpm build (agent-provider-deepseek and agent-cli dist must exist)
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

const PASS = 'YES ✓';
const FAIL = 'NO ✗';
let allPassed = true;

function check(label, condition) {
  const result = condition ? PASS : FAIL;
  if (!condition) allPassed = false;
  console.log(`  ${label}: ${result}`);
}

// ── Scenario 1: createDeepSeekProviderDefinition() public SDK API ─────────────
console.log(
  '\n=== Scenario 1: createDeepSeekProviderDefinition() returns correct definition ===\n',
);

const { createDeepSeekProviderDefinition } = await import(
  resolve(repoRoot, 'packages/agent-provider-deepseek/dist/node/index.js')
);

const def = createDeepSeekProviderDefinition();

console.log(`  type: ${def.type}`);
console.log(`  displayName: ${def.displayName}`);
console.log(`  defaults.model: ${def.defaults?.model}`);
console.log(`  defaults.apiKey: ${def.defaults?.apiKey}`);
console.log(`  defaults.baseURL: ${def.defaults?.baseURL}`);
console.log(`  requiresApiKey: ${def.requiresApiKey}`);
console.log(`  modelCatalog.entries: ${def.modelCatalog?.entries?.map((e) => e.id).join(', ')}`);

check('type === "deepseek"', def.type === 'deepseek');
check('displayName === "DeepSeek"', def.displayName === 'DeepSeek');
check('defaults.model === "deepseek-v4-flash"', def.defaults?.model === 'deepseek-v4-flash');
check(
  'defaults.apiKey references DEEPSEEK_API_KEY',
  def.defaults?.apiKey?.includes('DEEPSEEK_API_KEY'),
);
check(
  'defaults.baseURL === "https://api.deepseek.com"',
  def.defaults?.baseURL === 'https://api.deepseek.com',
);
check('requiresApiKey === true', def.requiresApiKey === true);

const entries = def.modelCatalog?.entries ?? [];
const activeIds = entries.filter((e) => e.lifecycle === 'active').map((e) => e.id);
const deprecatedIds = entries.filter((e) => e.lifecycle === 'deprecated').map((e) => e.id);

check('model catalog has active deepseek-v4-flash', activeIds.includes('deepseek-v4-flash'));
check('model catalog has active deepseek-v4-pro', activeIds.includes('deepseek-v4-pro'));
check('deprecated alias deepseek-chat present', deprecatedIds.includes('deepseek-chat'));
check('deprecated alias deepseek-reasoner present', deprecatedIds.includes('deepseek-reasoner'));

// ── Scenario 2: DeepSeek wired into CLI default provider definitions ───────────
console.log('\n=== Scenario 2: DeepSeek is in CLI DEFAULT_PROVIDER_DEFINITIONS ===\n');

// Import the compiled agent-cli module that exports DEFAULT_PROVIDER_DEFINITIONS.
// The chunk file bundles provider-default-definitions.ts which wires in DeepSeek.
const cliDist = resolve(repoRoot, 'packages/agent-cli/dist/node');
let cliChunk;
try {
  const { readdirSync } = await import('node:fs');
  const chunks = readdirSync(cliDist).filter((f) => f.startsWith('chunk-') && f.endsWith('.js'));
  for (const chunk of chunks) {
    const mod = await import(resolve(cliDist, chunk));
    if (mod.DEFAULT_PROVIDER_DEFINITIONS) {
      cliChunk = mod;
      break;
    }
  }
} catch (e) {
  console.log(`  error loading CLI dist: ${e.message}`);
}

if (!cliChunk) {
  check('DEFAULT_PROVIDER_DEFINITIONS found in CLI dist', false);
} else {
  const defs = cliChunk.DEFAULT_PROVIDER_DEFINITIONS;
  const deepseekDef = defs.find((d) => d.type === 'deepseek');
  const allTypes = defs.map((d) => d.type);

  console.log(`  provider types in DEFAULT_PROVIDER_DEFINITIONS: ${allTypes.join(', ')}`);

  check('DEFAULT_PROVIDER_DEFINITIONS exists', Array.isArray(defs));
  check('deepseek entry present in DEFAULT_PROVIDER_DEFINITIONS', !!deepseekDef);
  check(
    'deepseek is last in the list (after openai, gemini, qwen)',
    allTypes[allTypes.length - 1] === 'deepseek',
  );
  check('deepseek displayName === "DeepSeek"', deepseekDef?.displayName === 'DeepSeek');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log();
if (allPassed) {
  console.log(
    'PASS — DeepSeek provider SDK package and CLI integration are correctly implemented.',
  );
  process.exit(0);
} else {
  console.log('FAIL — one or more scenarios did not pass.');
  process.exit(1);
}
