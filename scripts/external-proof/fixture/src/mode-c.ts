/**
 * MODE C — consume OUR preset by id while adding your OWN capability pack.
 *
 * Three claims: a Robota built-in preset (`careful-reviewer`) is reusable by id with nothing registered;
 * a consumer-authored `ICapabilityPack` merges ADDITIVELY on top of the product's base modules and our
 * `pack-coding`; and a deliberate id collision is REPORTED on the rejection channel rather than silently
 * dropped or silently overridden.
 *
 * TOOL AXIS (ARCH-006). All three axes are now additive on the same terms. `agent-framework`'s
 * `createSession` no longer hard-codes its default tool set: `defaultTools` REPLACES that tier (`[]`
 * suppresses it entirely) and the assembled list is deduped BY NAME, first occurrence wins. So a pack
 * contributing a NEW tool is additive, a pack whose tools mirror the framework defaults is no longer
 * DUPLICATED, and a product profile can hand the whole tool surface to its packs. Section C5 measures
 * each of those from the published surface.
 */

import { mergeCapabilityPacks } from '@robota-sdk/agent-capability-pack';
import { InteractiveSession } from '@robota-sdk/agent-framework';
import * as frameworkNamespace from '@robota-sdk/agent-framework';
import { createDefaultTools } from '@robota-sdk/agent-tool-defaults';
import { assembleProduct } from '@robota-sdk/agent-product';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-provider-defaults';
import { createCodingPack } from '@robota-sdk/pack-coding';

import {
  ACME_PROVIDER_SETTINGS,
  acmeBaseCommandModule,
  acmePack,
  acmeSubagent,
  acmeTicketTool,
} from './acme.js';
import { check, checkEqual, mode, note, section } from './harness.js';

/**
 * ARCH-006: the pack is built by a FACTORY bound to the session's working directory — a context-free pack
 * would carry a disarmed working-directory path guard on its file tools (ARCH-010 has since made that guard fail closed; the pack's rule is now the same one stated a layer up). A consumer builds it exactly as
 * robota's own shell does, with the cwd it assembles the session under.
 */
const codingPack = createCodingPack({ cwd: process.cwd() });
import { asStandardOptions } from './surface-notes.js';

import type { ICapabilityPack } from '@robota-sdk/agent-capability-pack';

export async function runModeC(): Promise<void> {
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
  section('C5 — the tool axis at PARITY with the command and subagent axes (ARCH-006)');
  // ARCH-010: `cwd` is required. This proof only compares tool NAMES, so any root would do — which
  // is exactly why it must be an explicit one rather than an omission: the omission is what used to
  // produce a tool set with no containment boundary at all.
  const frameworkDefaultToolNames = createDefaultTools({ cwd: process.cwd() }).map((tool) =>
    tool.getName(),
  );
  const codingPackToolNames = (codingPack.tools ?? []).map((tool) => tool.getName());
  check(
    'a pack tool the framework does NOT ship is genuinely additive — it reaches the runtime',
    !frameworkDefaultToolNames.includes('AcmeTicketLookup') &&
      (options.additionalTools ?? []).some((tool) => tool.getName() === 'AcmeTicketLookup'),
  );
  // ARCH-035 — the four assertions the item's verification scenario names. Until this change the
  // aggregator was published by `@robota-sdk/agent-framework` and `pack-coding` rebuilt the same list
  // by hand; the two were held together by a NAME-equality pin, which is the pin that let ARCH-021's
  // first TC-05 pass while being unable to fail. The set has ONE owner now, so the questions worth
  // asking from outside the monorepo changed.
  const ALWAYS_PRESENT = [
    'Shell',
    'Bash',
    'Read',
    'Write',
    'Edit',
    'Glob',
    'Grep',
    'WebFetch',
    'WebSearch',
    'AskUserQuestion',
  ];
  checkEqual(
    'ARCH-035: the leaf ships exactly the always-present set, read from the published tarball',
    frameworkDefaultToolNames,
    ALWAYS_PRESENT,
  );

  // The adapter gating is the part that made this a SUPERSET rather than a duplicate of the pack's
  // list, and it is why deleting the tier outright was rejected: `retrievalAdapter` would have been
  // left declared, threaded, and reaching nothing.
  const withRetrieval = createDefaultTools({
    cwd: process.cwd(),
    retrievalAdapter: { retrieve: async () => ({ symbols: [], totalTokens: 0 }) },
  }).map((tool) => tool.getName());
  checkEqual(
    'ARCH-035: supplying a retrievalAdapter adds exactly CodebaseRetrieval and nothing else',
    withRetrieval.filter((name) => !ALWAYS_PRESENT.includes(name)),
    ['CodebaseRetrieval'],
  );

  checkEqual(
    "ARCH-035: pack-coding's tools ARE the always-present set — structurally now, not by a name pin",
    codingPackToolNames,
    ALWAYS_PRESENT,
  );

  // The runner's route, closed on the PUBLISHED surface too. The type-level guarantee (the runner has
  // no manifest edge to the leaf) belongs to `pnpm typecheck`; what a consumer of the tarballs can
  // observe is that the symbol is simply gone from the framework's runtime barrel.
  check(
    'ARCH-035: @robota-sdk/agent-framework no longer exports createDefaultTools',
    !Object.prototype.hasOwnProperty.call(frameworkNamespace, 'createDefaultTools'),
  );
  check(
    'and every one of them is overlaid — the framework now DEDUPES them by name instead of listing ' +
      'each tool twice',
    codingPackToolNames.every((name) =>
      (options.additionalTools ?? []).some((tool) => tool.getName() === name),
    ),
  );

  // The suppression seam, exercised on the PUBLISHED surface: `defaultTools: []` is accepted by the
  // shipped `.d.ts` (this file type-checks with skipLibCheck:false) and builds a live session in which
  // the framework contributes NO tool of its own — so the profile's packs own the whole tool surface.
  const packOwnedSession = product.buildRuntime({
    session: {
      cwd: process.cwd(),
      provider: product.provider!,
      bare: true,
      defaultTools: [],
    },
  });
  check(
    'a consumer can SUPPRESS the framework default tier (`defaultTools: []`) and still build a session',
    packOwnedSession instanceof InteractiveSession,
  );
  const packOwnedOptions = asStandardOptions(
    product.buildRuntimeOptions({
      session: {
        cwd: process.cwd(),
        provider: product.provider!,
        bare: true,
        defaultTools: [],
      },
    }),
  );
  checkEqual(
    'with the tier suppressed, every tool in the session comes from the profile’s packs',
    (packOwnedOptions.additionalTools ?? []).map((tool) => tool.getName()),
    [...codingPackToolNames, 'AcmeTicketLookup'],
  );
  checkEqual(
    'and the suppression is carried, not silently dropped',
    (packOwnedOptions.defaultTools ?? ['NOT-SUPPRESSED']).length,
    0,
  );

  // The property that makes suppression SAFE, measured from outside: because the pack is built by a
  // factory bound to a cwd, the file tools it contributes are scoped to it. A context-free pack would
  // hand a product that suppresses the framework tier an UNSANDBOXED Read/Write/Edit.
  const packRead = (packOwnedOptions.additionalTools ?? []).find(
    (tool) => tool.getName() === 'Read',
  );
  const readOutcome = await packRead!.execute(
    { filePath: '/etc/hostname' } as never,
    {
      toolName: 'Read',
      parameters: {},
    } as never,
  );
  const readResult = JSON.parse(String((readOutcome as { data?: unknown }).data)) as {
    success: boolean;
    error?: string;
  };
  check(
    'and the pack-owned Read is SCOPED — it denies a path outside the cwd the pack was built with',
    readResult.success === false &&
      (readResult.error ?? '').includes('outside the working directory'),
  );

  note(
    'THEREFORE, precisely: `createSession` assembles `defaultTools ⊕ additionalTools ⊕ goalTool` and ' +
      'deduplicates by tool name (FIRST occurrence wins). A pack contributing a NEW tool is additive; a ' +
      'pack contributing a tool the framework already ships is deduped, never duplicated; and a product ' +
      'that wants its packs to OWN the tool surface passes `defaultTools: []`. Removing a pack from such ' +
      'a profile removes its tools from the product — the same load-bearing property the command and ' +
      'subagent axes already had.',
  );
  note(
    'SAFETY: a pack that owns the tool surface MUST carry the session context. `createCodingPack` takes a ' +
      'REQUIRED `cwd` for exactly that reason — `agent-tools` USED TO disarm its working-directory path guard ' +
      'when `cwd` is undefined, so a context-free pack paired with `defaultTools: []` would ship an ' +
      'unsandboxed Read/Write/Edit. There is deliberately no context-free `codingPack` constant.',
  );
  note(
    'PRECEDENCE, and why it points this way: a name collision keeps the FRAMEWORK default and drops the ' +
      'contribution, rather than the reverse. The default tier is constructed WITH the session context ' +
      "(cwd supplies agent-tools' working-directory path guard, plus the sandbox client and retrieval " +
      'adapter); an already-constructed pack tool carries none of it, so letting a collision silently ' +
      'swap one in would weaken a security guarantee. Replacement stays fully expressible through the ' +
      'EXPLICIT `defaultTools` seam — never as a side effect of a collision. This mirrors ' +
      "mergeCapabilityPacks' own rule: additive merge, never a silent override.",
  );
  note(
    "NOT MEASURABLE FROM OUTSIDE: the framework exposes no public accessor for a built session's final " +
      'tool list, so the dedupe ITSELF is measured in-repo (agent-framework ' +
      'src/__tests__/create-session-default-tools.test.ts, 8 red-first cases). What this proof measures ' +
      'from the published surface is the seam that makes it reachable: the `defaultTools` option on the ' +
      'shipped session-options type, the overlay that carries the pack tools into it, and the scoping of ' +
      'the pack-owned file tools. `robota` itself now consumes exactly this shape — its profile builds ' +
      'pack-coding with the shell cwd and passes `defaultTools: []`, so its coding tools come FROM the ' +
      'pack (asserted in-repo by agent-cli src/__tests__/robota-runtime-seam.test.ts).',
  );
  note(
    'COMMAND + SUBAGENT AXES: fully additive — command modules are passed as data and subagents arrive ' +
      'through the framework agentDefinitions injection seam added by ARCH-005 S2.',
  );
}
