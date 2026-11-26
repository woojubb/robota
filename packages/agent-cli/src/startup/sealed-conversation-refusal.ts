/**
 * The one line a command prints in secure mode when everything it reports lives in saved
 * conversations. They are sealed there and a command holds no key, so it has nothing to total or
 * analyse; the terminal opens them after `/unlock`. Said up front, before any store is built, so the
 * refusal names the cause instead of the factory's generic one.
 */
export function sealedConversationRefusal(cliName: string, command: string): string {
  return `\`${cliName} ${command}\` reads saved conversations, which are sealed in secure mode; open them in the terminal after /unlock.\n`;
}
