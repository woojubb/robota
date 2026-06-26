export type TParsedInput =
  | { type: 'slash-command'; name: string; args: string[] }
  | { type: 'user-message'; text: string };

/** Return true if text starts with '/' followed by a non-whitespace character. */
export function isSlashCommand(text: string): boolean {
  return /^\/\S/.test(text);
}

/** Tokenise '/name arg1 arg2' → { name, args }. */
export function tokeniseSlashCommand(text: string): { name: string; args: string[] } {
  const body = text.slice(1).trim();
  const parts = body.split(/\s+/);
  const name = parts[0] ?? '';
  const args = parts.slice(1).filter((p) => p.length > 0);
  return { name, args };
}

/** Parse raw user input into a structured command or message. */
export function parseInput(text: string): TParsedInput {
  if (!isSlashCommand(text)) return { type: 'user-message', text };
  const { name, args } = tokeniseSlashCommand(text);
  return { type: 'slash-command', name, args };
}
