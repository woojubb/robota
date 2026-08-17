/**
 * `@robota-sdk/agent-remote-pairing/local` — SEC-010 local-peer admission.
 *
 * A separate entry point because it is NODE-ONLY: the main entry is isomorphic (WebCrypto, no Node
 * built-ins) and runs in the browser remote client, while this needs the filesystem. A browser has
 * no local peers and no directory permissions to judge, so nothing here belongs on that surface.
 */
export {
  admitLocalPeerDirectory,
  admitLocalPeerSocket,
  refuseLocalPeer,
} from './peer-credential.js';
export type {
  IGuardedDirectoryOptions,
  ILocalPeerAdmission,
  ILocalPeerBinding,
  TLocalPeerTrust,
} from './peer-credential.js';
