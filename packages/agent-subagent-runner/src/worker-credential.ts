import type { ISerializableProviderProfile } from '@robota-sdk/agent-interface-execution';

/**
 * The worker is handed its provider credential through the environment only so it can build its
 * provider. Once built, the variable leaves this process's environment, so the commands the
 * subagent runs — tools, hooks, background shells — do not inherit it, unless the owner opted the
 * variable in for commands (`keep`).
 */
export function withholdProviderCredential(
  profile: Pick<ISerializableProviderProfile, 'apiKeyEnv'>,
  keep = false,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (keep || profile.apiKeyEnv === undefined) return;
  delete environment[profile.apiKeyEnv];
}
