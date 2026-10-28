import type { IRemotePermission } from './remote-runtime.js';

const MAX_PERMISSION_TEXT_LENGTH = 4000;
// eslint-disable-next-line no-control-regex -- Approval must not hide or reorder request text.
const DISPLAY_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/u;

/** Return only a complete, unaltered request that the native dialog can present. */
export function remotePermissionText(event: IRemotePermission): string | undefined {
  const text = JSON.stringify(event);
  if (text.length > MAX_PERMISSION_TEXT_LENGTH || DISPLAY_CONTROLS.test(text)) return undefined;
  return text;
}
