/**
 * MODE B — author your OWN preset in code and layer it.
 *
 * The consumer hand-writes an `IPreset` against the published contract and passes it in the profile. Two
 * things must hold: the RESOLVED options reflect the preset (persona / model / permission posture, and the
 * posture reaches the runtime session options), and the preset does NOT leak — `assembleProduct` builds a
 * PER-CALL instance-scoped registry (ARCH-005 R8) rather than mutating agent-preset's module-level global.
 */

import { resolvePreset as globalResolvePreset } from '@robota-sdk/agent-preset';
import { assembleProduct } from '@robota-sdk/agent-product';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-builtin-providers';

import { ACME_PROVIDER_SETTINGS, acmeReviewerPreset } from './acme.js';
import { check, checkEqual, checkThrows, mode, note, section } from './harness.js';

export function runModeB(): void {
  mode('MODE B — author your own preset in code and layer it');

  const providerDefinitions = createDefaultProviderDefinitions();

  section("B1 — the consumer's own preset resolves through the assembled product");
  const product = assembleProduct({
    id: 'acme-review-tool',
    agentName: 'acme-review',
    providerDefinitions,
    providerSettings: ACME_PROVIDER_SETTINGS,
    presets: [acmeReviewerPreset],
    defaultPresetId: 'acme-reviewer',
  });

  checkEqual("the default preset id is the consumer's", product.defaultPresetId, 'acme-reviewer');
  checkEqual(
    'persona comes from the hand-written preset',
    product.defaultPreset?.persona,
    acmeReviewerPreset.persona,
  );
  checkEqual(
    'model comes from the hand-written preset',
    product.defaultPreset?.model,
    'gpt-4o-mini',
  );
  checkEqual('effort comes from the hand-written preset', product.defaultPreset?.effort, 'high');
  checkEqual('deniedTools comes from the hand-written preset', product.defaultPreset?.deniedTools, [
    'Shell',
  ]);
  checkEqual(
    'selfVerification comes from the hand-written preset',
    product.defaultPreset?.selfVerification,
    true,
  );
  checkEqual(
    'permission posture is DERIVED from autonomy: ask-first → permissionMode "default"',
    product.defaultPreset?.permissionMode,
    'default',
  );
  note(
    'the consumer set no permissionMode — the published resolver derived it from the autonomy dial',
  );

  section('B2 — the preset is resolvable by id and listed by the instance registry');
  checkEqual(
    'resolvePreset(id) returns the same persona',
    product.resolvePreset('acme-reviewer').persona,
    acmeReviewerPreset.persona,
  );
  check(
    'the instance registry lists the consumer preset alongside the built-ins',
    product.presets.listPresets().some((summary) => summary.id === 'acme-reviewer') &&
      product.presets.listPresets().some((summary) => summary.id === 'careful-reviewer'),
  );

  section('B3 — the posture reaches the real session options');
  const options = product.buildRuntimeOptions({
    session: { cwd: process.cwd(), provider: product.provider!, bare: true },
  });
  checkEqual(
    "the default preset's permissionMode is overlaid onto the session options",
    options.permissionMode,
    'default',
  );
  note('the overlay only fills permissionMode when the shell left it unset — the shell still wins');
  const explicit = product.buildRuntimeOptions({
    session: {
      cwd: process.cwd(),
      provider: product.provider!,
      bare: true,
      permissionMode: 'bypassPermissions',
    },
  });
  checkEqual(
    'an explicit shell permissionMode is NOT overwritten',
    explicit.permissionMode,
    'bypassPermissions',
  );

  section('B4 — R8: the preset does NOT leak into a second assembleProduct call');
  const second = assembleProduct({ id: 'acme-other-tool', providerDefinitions });
  check(
    "the second product's registry does not know the first product's preset",
    second.presets.getPreset('acme-reviewer') === undefined,
  );
  checkThrows(
    'resolving it from the second product throws Unknown preset',
    () => second.resolvePreset('acme-reviewer'),
    /Unknown preset: "acme-reviewer"/,
  );
  checkThrows(
    "agent-preset's module-level global registry was never mutated either",
    () => globalResolvePreset('acme-reviewer'),
    /Unknown preset: "acme-reviewer"/,
  );
  check(
    'the FIRST product still resolves it — registries are per-call, not per-process',
    product.resolvePreset('acme-reviewer').model === 'gpt-4o-mini',
  );
  checkEqual(
    'repeated assembly does not accumulate rejections',
    assembleProduct({
      id: 'acme-review-tool',
      providerDefinitions,
      presets: [acmeReviewerPreset],
      defaultPresetId: 'acme-reviewer',
    }).rejectedCapabilities.length,
    0,
  );
}
