import type { IWebProductIdentity } from '@robota-sdk/agent-ui-web/client';

/** Each page belongs to its host's explicit public identity or the selected build identity. */
export function resolvePageProductIdentity(
  document: Pick<Document, 'getElementById'>,
  buildIdentity: IWebProductIdentity,
): IWebProductIdentity {
  const element = document.getElementById('product-config');
  if (!element) return buildIdentity;
  let value: unknown;
  try { value = JSON.parse(element.textContent ?? ''); } catch { throw new Error('Invalid public product configuration.'); }
  if (typeof value !== 'object' || value === null) throw new Error('Invalid public product configuration.');
  const config = value as Partial<IWebProductIdentity>;
  const displayName = config.identity?.displayName;
  const cliName = config.identity?.cliName;
  const browserNamespace = config.storage?.browserNamespace;
  if (![displayName, cliName, browserNamespace].every((field) => typeof field === 'string' && field.trim() !== '')) {
    throw new Error('Public product configuration is missing required identity fields.');
  }
  return { identity: { displayName: displayName!, cliName: cliName! }, storage: { browserNamespace: browserNamespace! } };
}
