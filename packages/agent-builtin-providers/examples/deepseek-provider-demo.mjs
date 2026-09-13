#!/usr/bin/env node
/**
 * Offline DeepSeek definition and built-in default-composition verification.
 *
 * Usage (from this package): node examples/deepseek-provider-demo.mjs
 * Prerequisites: built agent-builtin-providers and its provider dependencies.
 * This creates definitions only: no provider instances, environment-key resolution or requests.
 * Actual CLI wiring is covered by agent-cli/src/__tests__/robota-assembly-equivalence.test.ts
 * ("offers the same provider surface"), not by inspecting generated bundle chunks.
 */
import { createDeepSeekProviderDefinition } from '@robota-sdk/agent-provider-openai-compatible';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-builtin-providers';

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

// ── Scenario 2: DeepSeek in the public built-in default composition ────────────
console.log('\n=== Scenario 2: DeepSeek is in the built-in default definitions ===\n');

const defs = createDefaultProviderDefinitions();
const deepseekDef = defs.find((d) => d.type === 'deepseek');
const allTypes = defs.map((d) => d.type);

console.log(`  provider types in built-in defaults: ${allTypes.join(', ')}`);

check('default definitions is an array', Array.isArray(defs));
check('deepseek entry present in default definitions', !!deepseekDef);
check('deepseek is last in the default list', allTypes[allTypes.length - 1] === 'deepseek');
check('deepseek displayName === "DeepSeek"', deepseekDef?.displayName === 'DeepSeek');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log();
if (allPassed) {
  console.log('PASS — DeepSeek definition and built-in default composition verified offline.');
  process.exit(0);
} else {
  console.log('FAIL — one or more scenarios did not pass.');
  process.exit(1);
}
