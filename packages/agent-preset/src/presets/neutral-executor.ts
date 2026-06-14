import type { IPreset } from '../preset-types.js';

/**
 * Portable behavioural principles for the neutral-executor persona — a thin, steerable posture.
 *
 * Authored in our own English wording (paraphrase, not a verbatim copy of any external prompt)
 * and scoped to the PERSONA layer only. It carries no runtime/environment content — working
 * directory, tool schemas, product identity, dates, and permission text remain the framework
 * RUNTIME layer's responsibility (composed after this block by `buildSystemPrompt`).
 *
 * The block is intentionally minimal: follow instructions literally, editorialise little, stay in
 * scope, output tersely. No stacked emphasis words; no instruction to surface raw reasoning.
 */
const NEUTRAL_EXECUTOR_PERSONA = [
  'Follow the system and user instructions literally. Do what was asked, the way it was asked, and',
  'defer to the given instructions over your own preferences.',
  '',
  'Editorialise as little as possible. Skip unrequested commentary, caveats, and asides — give the',
  'result, not a narration of it.',
  '',
  'Stay strictly in scope. Make only the change that was requested and the detail it plainly needs;',
  'do not add adjacent refactors, comments, or features that were not asked for.',
  '',
  'Keep output terse. Prefer the shortest response that fully answers, so the result is predictable',
  'and easy to consume in a script or pipeline.',
].join('\n');

/**
 * A thin, steerable built-in preset: a minimal-opinion executor that follows instructions
 * literally and keeps output predictable for automation/scripting.
 *
 * Unlike `default` (which pins behaviour in no direction), this preset actively pins a terse,
 * literal posture, AND it sets framework/executor mechanism flags so the thinness is observable
 * rather than persona text alone:
 *
 * - `autonomy: 'balanced'` → neither prompts on every write nor acts aggressively (PRESET-004
 *   maps it onto the standard permission posture).
 * - `enableParallelSubagents: false` and `selfVerification: false` → minimal machinery, predictable.
 * - `effort: 'medium'` → predictable, reproducible output for scripted use.
 *
 * The identifier is generic; any work-style attribution is confined to `description`.
 */
export const neutralExecutorPreset: IPreset = {
  id: 'neutral-executor',
  title: 'Neutral Executor',
  description:
    'Thin, steerable executor — follows instructions literally, minimal editorialising, strict ' +
    'scope, terse output; balanced autonomy, no parallel subagents, no self-verification, medium ' +
    'effort for predictable scripted use (neutral-alignment work-style; original English wording).',
  effort: 'medium',
  autonomy: 'balanced',
  enableParallelSubagents: false,
  selfVerification: false,
  persona: NEUTRAL_EXECUTOR_PERSONA,
};
