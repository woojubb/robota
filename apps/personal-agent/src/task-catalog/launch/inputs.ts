/**
 * The values a launch is made from: what the person typed, checked against what the task asks for.
 * Nothing is kept that the task did not ask for, a required value cannot be left out, a choice is one
 * of its choices, and a page address passes the address rule. Every refusal names the label the person
 * saw beside the field.
 */
import { plainLine } from '../fields.js';
import { checkPageAddress } from './page-address.js';
import { LAUNCH_LIMITS, asInvalid } from './validate.js';
import { LaunchRefusedError } from './types.js';

import type { ITaskDefinition, ITaskInput } from '../types.js';
import type { ILaunchRecipe } from './recipes.js';
import type { TLaunchInputs } from './types.js';

function resolveOne(
  input: ITaskInput,
  given: string | number | undefined,
  pages: ReadonlySet<string>,
  allowedHosts: ReadonlySet<string>,
): string | number | undefined {
  const refuse = (why: string): never => {
    throw new LaunchRefusedError('invalid', `${input.label}: ${why}`);
  };
  // A text left empty counts as not given, so its default or its being optional applies.
  const blank = typeof given === 'string' && input.kind !== 'number' && given.trim() === '';
  const value = blank ? input.default : (given ?? input.default);
  if (value === undefined) return input.required ? refuse('this is needed') : undefined;
  if (input.kind === 'number') {
    if (typeof value !== 'number') return refuse('this must be a number');
    return value;
  }
  if (typeof value !== 'string') return refuse('this must be text');
  if (input.kind === 'choice') {
    if (!input.choices!.includes(value)) return refuse('pick one of the choices');
    return value;
  }
  const line = asInvalid(() => plainLine(value, input.label, LAUNCH_LIMITS.value));
  return pages.has(input.name) ? checkPageAddress(line, allowedHosts) : line;
}

/**
 * The checked values by input name, with defaults filled in. A value for an input the task does not
 * have is refused, so a request cannot carry anything the task did not ask for.
 */
export function resolveInputs(
  definition: ITaskDefinition,
  given: Readonly<Record<string, string | number>>,
  recipe: ILaunchRecipe,
  allowedHosts: ReadonlySet<string>,
): TLaunchInputs {
  const known = new Set(definition.inputs.map((input) => input.name));
  for (const name of Object.keys(given))
    if (!known.has(name))
      throw new LaunchRefusedError('invalid', `This task does not ask for ${name}`);
  const pages = new Set(recipe.pages);
  const resolved: Record<string, string | number> = {};
  for (const input of definition.inputs) {
    const value = resolveOne(input, given[input.name], pages, allowedHosts);
    if (value !== undefined) resolved[input.name] = value;
  }
  return resolved;
}

/**
 * Check values that are only suggested, as a person's own would be checked at Start: each is judged by
 * the rule of its input (a choice is one of its choices, a number a number, a page address the address
 * rule), but none is needed and none is a default. What comes back is each value as Start would keep it,
 * so what a form shows beforehand is what a start would use.
 */
export function checkSuggestedInputs(
  definition: ITaskDefinition,
  suggested: Readonly<Record<string, string>>,
  pages: readonly string[],
  allowedHosts: ReadonlySet<string>,
): Record<string, string> {
  const pageInputs = new Set(pages);
  const checked: Record<string, string> = {};
  for (const [name, text] of Object.entries(suggested)) {
    const input = definition.inputs.find((entry) => entry.name === name);
    if (input === undefined)
      throw new LaunchRefusedError('invalid', `This task does not ask for ${name}`);
    const given: string | number = input.kind === 'number' ? Number(text) : text;
    if (typeof given === 'number' && (text.trim() === '' || !Number.isFinite(given)))
      throw new LaunchRefusedError('invalid', `${input.label}: this must be a number`);
    const kept = resolveOne(input, given, pageInputs, allowedHosts);
    if (kept !== undefined) checked[name] = String(kept);
  }
  return checked;
}
