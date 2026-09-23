/**
 * Leaf type module for {@link TToolDraft}.
 *
 * Split out of `PlaygroundApp.tsx` so `playground-modals.tsx` can depend on this type without
 * importing back from `PlaygroundApp.tsx`, which previously created an import cycle between the
 * two.
 */
export type TToolDraft = { name: string; description: string };
