/**
 * #3288: whether a `/loop` invocation's arguments are the `stop <id>` verb.
 *
 * `InteractiveSession.executeCommand`'s mid-turn control-action bypass (so `/loop stop <id>` can
 * reach a loop while its own turn is still running, mirroring `isGoalCancelVerb`) and the `/loop`
 * command module's own routing both need the identical answer — one parses it, the other imports
 * it, so the two can never drift apart.
 */
export function isLoopStopVerb(args: string): boolean {
  return /^stop(?:\s|$)/.test(args.trim());
}
