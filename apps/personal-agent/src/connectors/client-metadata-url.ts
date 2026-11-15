/**
 * The address of the client metadata document that names this agent to a service that takes one in
 * place of a registration. It is the operator's setting, so a value that could never be used is
 * refused when the agent starts, not at every person's sign-in.
 */
import { isClientMetadataUrl } from '@robota-sdk/agent-mcp';

export const CLIENT_METADATA_URL_VARIABLE = 'PERSONAL_AGENT_CLIENT_METADATA_URL';

export function clientMetadataUrlFrom(
  environment: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const value = (environment[CLIENT_METADATA_URL_VARIABLE] ?? '').trim();
  if (value === '') return undefined;
  if (!isClientMetadataUrl(value)) {
    throw new Error(
      `${CLIENT_METADATA_URL_VARIABLE} must be an https address with a path, and no user name, password or fragment`,
    );
  }
  return value;
}
