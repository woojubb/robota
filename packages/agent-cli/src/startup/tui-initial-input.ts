/**
 * What the terminal UI's prompt starts with, unsent: a deep link's prompt (shown as coming from a
 * link), else the words given after `robota` (`robota "fix the failing test"`), else nothing. Words
 * that begin with a subcommand's name (a mistyped `robota session …`) are not a prompt.
 */
export function tuiInitialInputProps(
  linkPrompt: string | undefined,
  positional: readonly string[],
  isSubcommand: (word: string) => boolean = () => false,
): { readonly initialInput?: string; readonly initialInputOrigin?: 'external-link' } {
  if (linkPrompt !== undefined)
    return { initialInput: linkPrompt, initialInputOrigin: 'external-link' };
  const first = positional[0];
  if (first !== undefined && isSubcommand(first)) return {};
  const typed = positional.join(' ').trim();
  return typed === '' ? {} : { initialInput: typed };
}
