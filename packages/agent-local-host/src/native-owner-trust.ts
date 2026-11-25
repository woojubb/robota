import { requestWorkspaceRootBroker } from './workspace-root-broker.js';
import { workspaceRootBrokerEndpoint } from './workspace-root-broker-process.js';

// What a native owner shell asks the live broker of its user-state root once the person has answered
// its own question. The product's own status request already started that broker before the person was
// asked, so none of these launches a process: the shell's executable is not the product's binary.

/** Only the shell that showed the person the folder and heard the answer calls this. */
export async function approvePreparedCandidate(
  userRoot: string,
  folder: string,
  candidate: string,
): Promise<boolean> {
  return (
    (
      await requestWorkspaceRootBroker(workspaceRootBrokerEndpoint(userRoot), {
        op: 'approve',
        candidate,
        root: folder,
      })
    ).status === 'trusted'
  );
}

export async function prepareRestrictedRoot(
  userRoot: string,
  root: string,
): Promise<string | undefined> {
  const response = await requestWorkspaceRootBroker(workspaceRootBrokerEndpoint(userRoot), {
    op: 'prepare',
    root,
  });
  return response.status === 'prepared' ? response.candidate : undefined;
}

/** Promote the root shown to the person into a live Restricted choice without granting project reads. */
export async function retainRestrictedRoot(
  userRoot: string,
  root: string,
  candidate: string,
): Promise<string | undefined> {
  const response = await requestWorkspaceRootBroker(workspaceRootBrokerEndpoint(userRoot), {
    op: 'retainRestricted',
    root,
    candidate,
  });
  return response.status === 'restricted-held' ? response.hold : undefined;
}

export async function assertRestrictedRoot(
  userRoot: string,
  root: string,
  hold: string,
): Promise<string> {
  const response = await requestWorkspaceRootBroker(workspaceRootBrokerEndpoint(userRoot), {
    op: 'assertRestricted',
    root,
    hold,
  });
  if (response.status !== 'restricted-root') {
    throw new Error('The Restricted folder changed after approval.');
  }
  return response.tag;
}

export async function releaseRestrictedRoot(userRoot: string, hold: string): Promise<void> {
  const response = await requestWorkspaceRootBroker(workspaceRootBrokerEndpoint(userRoot), {
    op: 'releaseRestricted',
    hold,
  });
  if (response.status !== 'released') {
    throw new Error('The Restricted folder hold could not be released.');
  }
}
