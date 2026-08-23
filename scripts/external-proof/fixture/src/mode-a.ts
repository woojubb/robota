/**
 * MODE A — build a product on the published framework, from outside the monorepo.
 *
 * The consumer declares a profile (branding + `providerDefinitions`), calls `assembleProduct`, and gets
 * runnable materials back. The load-bearing claim (ARCH-005 S2, owner Decision 1) is that the PROVIDER is
 * constructed IN-KERNEL from the definitions + the shell's already-resolved settings — the consumer never
 * builds a provider itself and never imports a vendor SDK.
 */

import { InteractiveSession } from '@robota-sdk/agent-framework';
import { assembleProduct } from '@robota-sdk/agent-product';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-builtin-providers';
import { createCodingPack } from '@robota-sdk/pack-coding';

import { ACME_PROVIDER_SETTINGS } from './acme.js';
import { check, checkEqual, checkThrows, mode, note, section } from './harness.js';

/**
 * ARCH-006: the pack is built by a FACTORY bound to the session's working directory — a context-free pack
 * would carry a disarmed working-directory path guard on its file tools (ARCH-010 has since made that guard fail closed; the pack's rule is now the same one stated a layer up). A consumer builds it exactly as
 * robota's own shell does, with the cwd it assembles the session under.
 */
const codingPack = createCodingPack({ cwd: process.cwd() });
import { asStandardOptions } from './surface-notes.js';

import type { IProductProfile } from '@robota-sdk/agent-product';

export function runModeA(): void {
  mode('MODE A — build a product on the published framework');

  const providerDefinitions = createDefaultProviderDefinitions();

  section('A1 — the minimal profile from the spec: branding + providerDefinitions only');
  const bareProfile: IProductProfile = {
    id: 'acme-assistant',
    agentName: 'acme',
    version: '0.1.0',
    providerDefinitions,
  };
  const bare = assembleProduct(bareProfile);
  checkEqual("assembled id is the consumer's own", bare.id, 'acme-assistant');
  checkEqual('agentName is the consumer\'s branding, not "robota"', bare.agentName, 'acme');
  checkEqual('version passes through', bare.version, '0.1.0');
  check('provider surface passes through', bare.providerDefinitions.length === 6);
  checkEqual('a bare profile yields no command modules', bare.commandModules.length, 0);
  checkEqual('a bare profile yields no tools', bare.tools.length, 0);
  checkEqual('a bare profile yields no subagents', bare.subagents.length, 0);
  check('buildRuntime seam is on the published surface', typeof bare.buildRuntime === 'function');
  check(
    'buildRuntimeOptions seam is on the published surface',
    typeof bare.buildRuntimeOptions === 'function',
  );
  note(
    'an honest baseline: a profile that declares nothing gets nothing — no hidden product opinion',
  );

  section('A2 — the provider is constructed IN-KERNEL from definitions + resolved settings');
  const withProvider = assembleProduct({
    ...bareProfile,
    providerSettings: ACME_PROVIDER_SETTINGS,
  });
  check('the consumer profile carries NO pre-built provider', bareProfile.provider === undefined);
  check('the kernel constructed one anyway', withProvider.provider !== undefined);
  checkEqual('it is the provider the definitions name', withProvider.provider?.name, 'openai');
  check(
    'it is a real IAIProvider code object (chat is callable)',
    typeof withProvider.provider?.chat === 'function',
  );
  check('it reports a version', typeof withProvider.provider?.version === 'string');
  checkThrows(
    'an unknown provider name is rejected BY THE KERNEL, naming the supported types',
    () =>
      assembleProduct({
        ...bareProfile,
        providerSettings: { name: 'acme-llm', model: 'acme-1' },
      }),
    /Unknown provider: acme-llm/,
  );
  note('Mode A consumers do not depend on any @robota-sdk/agent-provider-* package directly');

  section("A3 — Robota's own runtime capability arrives as a pack (their branding, our runtime)");
  const product = assembleProduct({
    ...bareProfile,
    providerSettings: ACME_PROVIDER_SETTINGS,
    packs: [codingPack],
    defaultPresetId: 'default',
  });
  checkEqual(
    'the coding command modules are present',
    product.commandModules.map((commandModule) => commandModule.name),
    ['agent-command-shell', 'agent-command-editor'],
  );
  checkEqual(
    'the ten built-in coding tools are present',
    product.tools.map((tool) => tool.getName()),
    [
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
    ],
  );
  checkEqual(
    'the built-in coding subagents are present',
    product.subagents.map((subagent) => subagent.name),
    ['general-purpose', 'Explore', 'Plan'],
  );
  checkEqual('nothing was rejected', product.rejectedCapabilities.length, 0);

  section('A4 — the assembled materials reach a real runtime session');
  const options = asStandardOptions(
    product.buildRuntimeOptions({
      session: { cwd: process.cwd(), provider: product.provider!, bare: true },
    }),
  );
  check(
    'the overlay carries the assembled command modules',
    (options.commandModules ?? []).length === 2,
  );
  check(
    'the overlay carries the pack tools as additionalTools',
    (options.additionalTools ?? []).length === 10,
  );
  const session = product.buildRuntime({
    session: { cwd: process.cwd(), provider: product.provider!, bare: true },
  });
  check(
    'buildRuntime returns a live framework InteractiveSession (one shared framework copy)',
    session instanceof InteractiveSession,
  );
  note(
    'runtime construction DELEGATES to agent-framework buildRuntimeSession — no re-implementation',
  );
}
