/**
 * Extra parameters for the authorization request, such as `prompt=consent` or a service's own switch
 * for a long-lived sign-in. They are plain words the person chose, never secrets, and they cannot
 * replace any parameter the sign-in itself sets (PKCE, `state`, the redirect, the client, the scope
 * and the resource), so a definition cannot turn the flow against its own protections.
 */

const MAX_PARAMS = 4;
const NAME = /^[a-z][a-z0-9_]{0,31}$/;
/** RFC 3986 unreserved characters: nothing that could change how the URL is read. */
const VALUE = /^[A-Za-z0-9._~-]{1,64}$/;

/** What the authorization request already carries, or hands authority to something else. */
export const OWNED_AUTHORIZATION_PARAMS: ReadonlySet<string> = new Set([
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'code_challenge',
  'code_challenge_method',
  'resource',
  'request',
  'request_uri',
]);

/** The parameters as a plain record, or a sentence saying what is wrong with them. */
export function checkAuthorizationParams(value: unknown): Record<string, string> | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'must be an object of parameter names and values';
  }
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > MAX_PARAMS) {
    return `must hold between 1 and ${MAX_PARAMS} parameters`;
  }
  const checked: Record<string, string> = {};
  for (const [name, parameter] of entries) {
    if (!NAME.test(name))
      return 'has a parameter name that is not lower-case letters, digits and _';
    if (OWNED_AUTHORIZATION_PARAMS.has(name)) {
      return `cannot set "${name}": the sign-in sets it itself`;
    }
    if (typeof parameter !== 'string' || !VALUE.test(parameter)) {
      return `has a value for "${name}" that is not 1 to 64 letters, digits and . _ ~ -`;
    }
    checked[name] = parameter;
  }
  return checked;
}
