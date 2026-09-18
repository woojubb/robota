/**
 * Storage, workspace-trust and provider-security probes (OBSERVABILITY-1991). Read-only: existence,
 * `W_OK` access and mode bits are inspected, never written.
 */
import { join } from 'node:path';

import { getWorkspaceProjectIdentity } from '@robota-sdk/agent-framework';

import type { IDoctorCheck, IDoctorDeps, IDoctorInputs } from './doctor-types.js';
import type { ISettingsInspection } from '@robota-sdk/agent-framework';

const FORBIDDEN_MODE_BITS = 0o077;

/** `~/.robota` and `~/.robota/sessions` — the user store the restricted-workspace fallback writes. */
export function userStoragePaths(userHome: string): { root: string; sessions: string } {
  const root = join(userHome, '.robota');
  return { root, sessions: join(root, 'sessions') };
}

export type TUserStorageState = 'ok' | 'missing' | 'unwritable' | 'too-open' | 'mode-not-probed';

/** The state the repair allowlist re-reads immediately before writing. */
export function userStorageState(inputs: IDoctorInputs, deps: IDoctorDeps): TUserStorageState {
  const { root, sessions } = userStoragePaths(inputs.userHome);
  const facts = [deps.inspectPath(root), deps.inspectPath(sessions)];
  if (facts.some((f) => !f.exists)) return 'missing';
  if (facts.some((f) => !f.isDirectory || !f.writable)) return 'unwritable';
  if (deps.ownerOnlyGuarantee() !== 'posix-mode') return 'mode-not-probed';
  return facts.some((f) => f.mode !== undefined && (f.mode & FORBIDDEN_MODE_BITS) !== 0)
    ? 'too-open'
    : 'ok';
}

function userStorageCheck(inputs: IDoctorInputs, deps: IDoctorDeps): IDoctorCheck {
  const { root, sessions } = userStoragePaths(inputs.userHome);
  const base = { id: 'storage.user', label: 'User storage', path: root } as const;
  switch (userStorageState(inputs, deps)) {
    case 'missing':
      return {
        ...base,
        status: 'warn',
        cause: 'not initialized (created on first write)',
        detail: [root, sessions],
        repair: 'storage.user',
      };
    case 'unwritable':
      return {
        ...base,
        status: 'fail',
        cause: 'exists but is not a writable directory',
        detail: [root, sessions],
      };
    case 'too-open':
      return {
        ...base,
        status: 'warn',
        cause: 'not owner-only (mode allows group/other access)',
        detail: [root, sessions],
        repair: 'storage.user',
      };
    case 'mode-not-probed':
      return {
        ...base,
        status: 'not-probed',
        cause: 'owner-only mode is not asserted on this platform (windows-acl)',
      };
    default:
      return { ...base, status: 'ok', cause: 'writable, owner-only' };
  }
}

function projectStorageCheck(inputs: IDoctorInputs, deps: IDoctorDeps): IDoctorCheck {
  const access = inputs.projectAccess;
  if (access.status !== 'trusted') {
    return {
      id: 'storage.project',
      label: 'Project storage',
      status: 'not-configured',
      cause: 'project sources are disabled in an untrusted workspace',
    };
  }
  const root = join(getWorkspaceProjectIdentity(access.authority).worktreeRoot, '.robota');
  const facts = deps.inspectPath(root);
  if (!facts.exists) {
    return {
      id: 'storage.project',
      label: 'Project storage',
      status: 'not-configured',
      path: root,
      cause: 'absent (created on first write)',
    };
  }
  return facts.isDirectory && facts.writable
    ? {
        id: 'storage.project',
        label: 'Project storage',
        status: 'ok',
        path: root,
        cause: 'writable',
      }
    : {
        id: 'storage.project',
        label: 'Project storage',
        status: 'fail',
        path: root,
        cause: 'exists but is not a writable directory',
      };
}

function trustCheck(inputs: IDoctorInputs): IDoctorCheck {
  const access = inputs.projectAccess;
  if (access.status === 'trusted') {
    return {
      id: 'workspace.trust',
      label: 'Workspace trust',
      status: 'ok',
      path: access.identity.displayPath,
      cause: 'trusted',
    };
  }
  const cause =
    access.cause === undefined
      ? access.trustState
      : `${access.trustState}: ${access.cause.name}: ${access.cause.message}`;
  return {
    id: 'workspace.trust',
    label: 'Workspace trust',
    status:
      access.trustState === 'store-unavailable' || access.trustState === 'identity-unavailable'
        ? 'fail'
        : 'warn',
    ...(access.displayPath === undefined ? {} : { path: access.displayPath }),
    cause,
    detail: ['Project sources are disabled. Run: robota trust --yes'],
  };
}

/**
 * The credential-quarantine report `robota diagnose` already shipped (CLI-067), over the inspection's
 * parsed layers instead of a private re-read: a lower-trust layer that changed a profile's `baseURL`
 * without supplying its own key had the inherited key removed. Neither key is ever shown.
 */
function providerSecurityCheck(settings: ISettingsInspection): IDoctorCheck | undefined {
  const seen = new Map<string, { baseURL?: string; apiKey?: string }>();
  let quarantined = false;
  for (const layer of settings.layers) {
    for (const [name, profile] of Object.entries(layer.settings?.providers ?? {})) {
      const previous = seen.get(name);
      if (
        previous?.apiKey !== undefined &&
        profile.baseURL !== undefined &&
        profile.baseURL !== previous.baseURL &&
        profile.apiKey === undefined
      ) {
        quarantined = true;
      }
      seen.set(name, {
        baseURL: profile.baseURL ?? previous?.baseURL,
        apiKey: profile.apiKey ?? previous?.apiKey,
      });
    }
  }
  return quarantined
    ? {
        id: 'provider.security',
        label: 'Provider security',
        status: 'warn',
        cause: 'provider endpoint quarantined; inherited credential removed (credential redacted)',
      }
    : undefined;
}

/** Workspace trust, storage, then the provider-security report. */
export function probeStorageAndTrust(
  inputs: IDoctorInputs,
  deps: IDoctorDeps,
  settings: ISettingsInspection,
): IDoctorCheck[] {
  const security = providerSecurityCheck(settings);
  return [
    trustCheck(inputs),
    userStorageCheck(inputs, deps),
    projectStorageCheck(inputs, deps),
    ...(security === undefined ? [] : [security]),
  ];
}
