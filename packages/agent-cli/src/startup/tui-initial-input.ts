/**
 * What the terminal UI's prompt starts with, unsent: a deep link's prompt (shown as coming from a
 * link), else the words given after `robota` (`robota "fix the failing test"`), else nothing.
 */
export function tuiInitialInputProps(
  linkPrompt: string | undefined,
  positional: readonly string[],
): { readonly initialInput?: string; readonly initialInputOrigin?: 'external-link' } {
  if (linkPrompt !== undefined)
    return { initialInput: linkPrompt, initialInputOrigin: 'external-link' };
  const typed = positional.join(' ').trim();
  return typed === '' ? {} : { initialInput: typed };
}
