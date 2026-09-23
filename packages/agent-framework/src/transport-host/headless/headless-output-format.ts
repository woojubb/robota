/**
 * Leaf module for the output-format vocabulary (issue #2052: the ONE owner of the type and the
 * runtime constant together).
 *
 * Split out of `headless-runner.ts` so `headless-output.ts` can depend on {@link TOutputFormat}
 * without importing back from `headless-runner.ts`, which previously created an import cycle
 * between the two.
 */
export const OUTPUT_FORMATS = ['text', 'json', 'stream-json'] as const;
export type TOutputFormat = (typeof OUTPUT_FORMATS)[number];
