/**
 * Findings about the PUBLISHED surface, discovered while writing this consumer.
 *
 * These are recorded here rather than worked around silently. Nothing in the monorepo was changed to make
 * the proof pass; each item below is a real ergonomic edge a third party meets on the shipped `.d.ts`.
 *
 * ---
 * FINDING F1 — `buildRuntimeOptions` returns the UNION `TInteractiveSessionOptions`.
 *
 * `IAssembledProduct.buildRuntimeOptions` is typed `(input) => TInteractiveSessionOptions`, and that type is
 * `IInteractiveSessionStandardOptions | IInteractiveSessionInjectedOptions`. `additionalTools` and
 * `agentDefinitions` — the two fields the overlay ADDS — exist only on the standard branch, so a consumer
 * cannot read back the very materials the kernel just overlaid without narrowing the union first. The
 * return type does not track the branch of the input that produced it. Not a blocker (the narrowing below is
 * three lines), but the kernel could return the input's branch and remove the step entirely.
 *
 * FINDING F2 — `IInteractiveSessionStandardOptions.provider` is REQUIRED.
 *
 * The Mode A story is "the kernel constructs the provider, you do not". But `IAssembledProduct.provider` is
 * optional (`provider?: IAIProvider`) while the session options' `provider` is required, so a consumer who
 * relies on in-kernel construction still has to assert non-null at the call site (`product.provider!`)
 * even though the overlay would have filled it from `base.provider ?? materials.provider` anyway.
 *
 * FINDING F3 — `ICommandResult` is not re-exported from `@robota-sdk/agent-framework`.
 *
 * `ICommandModule` / `ISystemCommand` / `ICommandHostContext` are all exported, but the type an
 * `ISystemCommand.execute` RETURNS lives in `@robota-sdk/agent-interface-transport`. Authoring a command
 * module works because the return literal is contextually typed (see `acme.ts` — it needs no extra import),
 * but a consumer who wants to name the return type must reach into a second package.
 */

import type { TInteractiveSessionOptions } from '@robota-sdk/agent-framework';

/** The standard-construction branch of the session-options union (see FINDING F1). */
export type TStandardSessionOptions = Exclude<TInteractiveSessionOptions, { session: unknown }>;

/**
 * Narrow the overlaid options to the standard-construction branch, so the additive materials the kernel
 * just laid on (`additionalTools`, `agentDefinitions`) are readable. Throws rather than guessing — this
 * consumer always builds through the standard path.
 */
export function asStandardOptions(options: TInteractiveSessionOptions): TStandardSessionOptions {
  if ('session' in options) {
    throw new Error(
      'expected standard-construction session options, got the injected-session branch',
    );
  }
  return options;
}
