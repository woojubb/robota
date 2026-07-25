/**
 * MODE C — consume OUR preset by id while adding your OWN capability pack.
 *
 * Three claims: a Robota built-in preset (`careful-reviewer`) is reusable by id with nothing registered;
 * a consumer-authored `ICapabilityPack` merges ADDITIVELY on top of the product's base modules and our
 * `pack-coding`; and a deliberate id collision is REPORTED on the rejection channel rather than silently
 * dropped or silently overridden.
 *
 * HONEST LIMITATION (recorded, not papered over). The pack TOOL axis is additive only through
 * `buildRuntime` / `buildRuntimeOptions`. `agent-framework`'s `createSession` hard-codes
 * `createDefaultTools()` and concatenates `additionalTools` without dedupe, so `robota`'s OWN surfaces
 * still take their tools from that framework default rather than from the pack. The command-module and
 * subagent axes ARE additive on both paths (subagents via the `agentDefinitions` injection seam). This
 * mode therefore exercises the tool axis THROUGH `buildRuntimeOptions` and asserts exactly that.
 */

import { mergeCapabilityPacks } from '@robota-sdk/agent-capability-pack';
import { createDefaultTools } from '@robota-sdk/agent-framework';
import { assembleProduct } from '@robota-sdk/agent-product';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider-defaults';
import { codingPack } from '@robota-sdk/pack-coding';

import {
  ACME_PROVIDER_SETTINGS,
  acmeBaseCommandModule,
  acmeCommandModule,
  acmePack,
  acmeSubagent,
  acmeTicketTool,
} from './acme.js';
import { check, checkEqual, mode, note, section } from './harness.js';
import { asStandardOptions } from './surface-notes.js';

import type { ICapabilityPack } from '@robota-sdk/agent-capability-pack';

export function runModeC(): void {
  mode("MODE C — our preset by id + the consumer's own capability pack");

  const providerDefinitions = createDefaultProviderDefinitions();
  const product = assembleProduct({
    id: 'acme-devtool',
    agentName: 'acme-devtool',
    providerDefinitions,
    providerSettings: ACME_PROVIDER_SETTINGS,
    baseCommandModules: [acmeBaseCommandModule],
    packs: [codingPack, acmePack],
    defaultPresetId: 'careful-reviewer',
  });

  section('C1 — OUR built-in preset, reused by id, with nothing registered by the consumer');
  checkEqual('the built-in id resolves', product.defaultPresetId, 'careful-reviewer');
  checkEqual('its autonomy posture is ours', product.defaultPreset?.autonomy, 'ask-first');
  checkEqual(
    'its derived permissionMode is ours',
    product.defaultPreset?.permissionMode,
    'default',
  );
  checkEqual('its effort dial is ours', product.defaultPreset?.effort, 'high');
  checkEqual('its selfVerification flag is ours', product.defaultPreset?.selfVerification, true);
  check(
    'its persona text ships with the package (not authored here)',
    (product.defaultPreset?.persona ?? '').includes('careful, review-oriented assistant'),
  );

  section('C2 — the consumer pack merges ADDITIVELY over base ⊕ our pack, in profile order');
  checkEqual(
    'command modules: base first, then packs in profile order',
    product.commandModules.map((commandModule) => commandModule.name),
    ['acme-shell-base', 'agent-command-shell', 'agent-command-editor', 'acme-tickets'],
  );
  checkEqual(
    "subagents: ours then the consumer's",
    product.subagents.map((subagent) => subagent.name),
    ['general-purpose', 'Explore', 'Plan', 'acme-triager'],
  );
  checkEqual("tools: the ten coding tools plus the consumer's", product.tools.length, 11);
  check(
    'the consumer tool is in the merged set',
    product.tools.some((tool) => tool.getName() === 'AcmeTicketLookup'),
  );
  checkEqual('a clean merge rejects nothing', product.rejectedCapabilities.length, 0);

  section('C3 — a deliberate id collision is REPORTED, never silently dropped or overridden');
  const collidingPack: ICapabilityPack = {
    id: 'acme-duplicate',
    commandModules: [{ name: 'acme-tickets', systemCommands: [] }, { name: 'acme-shell-base' }],
    tools: [acmeTicketTool],
    subagents: [{ ...acmeSubagent, description: 'a colliding redefinition' }],
  };
  const collided = assembleProduct({
    id: 'acme-devtool',
    providerDefinitions,
    baseCommandModules: [acmeBaseCommandModule],
    packs: [codingPack, acmePack, collidingPack],
  });

  const rejected = collided.rejectedCapabilities;
  checkEqual('exactly four collisions were reported', rejected.length, 4);
  check(
    'the pack-vs-pack command-module collision is reported with a reason',
    rejected.some(
      (entry) =>
        entry.kind === 'commandModule' &&
        entry.id === 'acme-tickets' &&
        entry.reason === 'duplicate commandModule id',
    ),
  );
  check(
    'the pack-vs-BASE collision carries a DIFFERENT reason',
    rejected.some(
      (entry) =>
        entry.kind === 'commandModule' &&
        entry.id === 'acme-shell-base' &&
        entry.reason === 'collides with base command module',
    ),
  );
  check(
    'the duplicate tool is reported',
    rejected.some((entry) => entry.kind === 'tool' && entry.id === 'AcmeTicketLookup'),
  );
  check(
    'the duplicate subagent is reported',
    rejected.some((entry) => entry.kind === 'subagent' && entry.id === 'acme-triager'),
  );
  checkEqual(
    'first registration wins: the merged set still holds exactly one acme-tickets module',
    collided.commandModules.filter((commandModule) => commandModule.name === 'acme-tickets').length,
    1,
  );
  checkEqual(
    'and the FIRST definition survived, not the collider',
    collided.commandModules.find((commandModule) => commandModule.name === 'acme-tickets')
      ?.systemCommands?.length,
    1,
  );
  checkEqual(
    'the surviving subagent is the original, not the redefinition',
    collided.subagents.find((subagent) => subagent.name === 'acme-triager')?.description,
    acmeSubagent.description,
  );
  check(
    'mergeCapabilityPacks is independently importable and reports the same collisions',
    mergeCapabilityPacks([acmeBaseCommandModule], [codingPack, acmePack, collidingPack]).rejected
      .length === 4,
  );

  section('C4 — the TOOL axis, exercised through buildRuntimeOptions (the honest path)');
  const options = asStandardOptions(
    product.buildRuntimeOptions({
      session: { cwd: process.cwd(), provider: product.provider!, bare: true },
    }),
  );
  check(
    'the consumer tool reaches the session options as an additionalTool',
    (options.additionalTools ?? []).some((tool) => tool.getName() === 'AcmeTicketLookup'),
  );
  checkEqual('all eleven merged tools are overlaid', (options.additionalTools ?? []).length, 11);
  checkEqual(
    'the command-module axis is overlaid on the same path',
    (options.commandModules ?? []).map((commandModule) => commandModule.name),
    ['acme-shell-base', 'agent-command-shell', 'agent-command-editor', 'acme-tickets'],
  );
  check(
    'the subagent axis reaches the runtime via the agentDefinitions injection seam',
    (options.agentDefinitions ?? []).some((definition) => definition.name === 'acme-triager'),
  );
  section(
    "C5 — the tool axis's limitation, VERIFIED from the published surface (not just asserted)",
  );
  const frameworkDefaultToolNames = createDefaultTools().map((tool) => tool.getName());
  const codingPackToolNames = (codingPack.tools ?? []).map((tool) => tool.getName());
  check(
    'a pack tool the framework does NOT ship is genuinely additive — it reaches the runtime',
    !frameworkDefaultToolNames.includes('AcmeTicketLookup') &&
      (options.additionalTools ?? []).some((tool) => tool.getName() === 'AcmeTicketLookup'),
  );
  checkEqual(
    "but pack-coding's tools are name-identical to the framework default set",
    codingPackToolNames,
    frameworkDefaultToolNames,
  );
  check(
    'and the overlay only APPENDS to additionalTools — it cannot suppress the framework defaults',
    codingPackToolNames.every((name) =>
      (options.additionalTools ?? []).some((tool) => tool.getName() === name),
    ),
  );
  note(
    'THEREFORE, precisely: `createSession` assembles `[...createDefaultTools(), ...additionalTools]` with ' +
      'no dedupe and no suppression hook. A consumer pack contributing a NEW tool is fully additive. A ' +
      'pack contributing a tool the framework already ships (as pack-coding does, deliberately) would be ' +
      "DUPLICATED, and no pack can remove or replace a framework default. That is why robota's own " +
      'surfaces still take their tools from createDefaultTools() rather than from the pack.',
  );
  note(
    'SCOPE OF THE CLAIM: the tool axis is additive through buildRuntime/buildRuntimeOptions for NEW tools ' +
      'only; making the framework default tool set injectable/suppressible is out of ARCH-005 scope and is ' +
      'filed as ARCH-006. Nothing stronger is claimed here.',
  );
  note(
    'COMMAND + SUBAGENT AXES: fully additive — command modules are passed as data and subagents arrive ' +
      'through the framework agentDefinitions injection seam added by ARCH-005 S2.',
  );
}
