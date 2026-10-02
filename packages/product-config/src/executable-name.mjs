/** Validate the executable basename used by hosts and the standalone GitHub Action.
 * @param {string} value
 * @returns {string}
 */
export function executableName(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value)) {
    throw new Error('expected an executable name');
  }
  return value;
}
