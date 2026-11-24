/**
 * Which page addresses a task may be given. The address is typed by the person, and it can have been
 * pasted from a mail or a page, so the host checks it with the rule the agent's own browser keeps: an
 * https address on a public site, with no user name or password in it. The browser still judges every
 * request again when it opens the page, including where a name resolves to; this check only keeps a
 * request the browser would refuse from becoming a goal.
 */
import { isRestrictedHost } from '../../browser/playwright-browser.js';
import { LaunchRefusedError } from './types.js';

const URL_LIMIT = 2048;

/**
 * The address in its normal spelling. `allowedHosts` are exact `host:port` origins the owner named as
 * reachable although they are local or private (the same list the browser takes); only for those is
 * http accepted, since a public site is reached over https.
 */
export function checkPageAddress(raw: string, allowedHosts: ReadonlySet<string>): string {
  const refuse = (why: string): never => {
    throw new LaunchRefusedError('invalid', why);
  };
  if (raw.length > URL_LIMIT || /[\s\p{Cc}]/u.test(raw))
    return refuse('The page address must be one short address with no spaces');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // allow-fallback: text that is not an address is refused with a sentence for the person.
    return refuse('The page address must be a full address such as https://example.com/page');
  }
  if (url.username !== '' || url.password !== '')
    return refuse('The page address must not contain a user name or password');
  if (allowedHosts.has(url.host) && (url.protocol === 'https:' || url.protocol === 'http:'))
    return url.href;
  if (url.protocol !== 'https:') return refuse('The page address must start with https://');
  if (isRestrictedHost(url.hostname))
    return refuse('The page address must be a public site, not this machine or a private network');
  return url.href;
}
