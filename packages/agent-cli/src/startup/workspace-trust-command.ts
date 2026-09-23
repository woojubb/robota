import {
  createNodeWorkspaceTrustService,
  type TWorkspaceProjectAccess,
  type WorkspaceTrustService,
} from '@robota-sdk/agent-framework';

type TWorkspaceTrustAction = 'status' | 'grant' | 'revoke';

function accessState(access: TWorkspaceProjectAccess): string {
  return access.status === 'trusted' ? 'trusted' : access.trustState;
}

function accessPath(access: TWorkspaceProjectAccess): string | undefined {
  return access.status === 'trusted' ? access.identity.displayPath : access.displayPath;
}

function printAccess(access: TWorkspaceProjectAccess): void {
  process.stdout.write(`Workspace trust: ${accessState(access)}\n`);
  const displayPath = accessPath(access);
  if (displayPath !== undefined) process.stdout.write(`Workspace: ${displayPath}\n`);
  if (access.status !== 'trusted') {
    process.stdout.write(
      'Project settings, hooks, plugins, skills, and provider overrides are disabled.\n',
    );
    if (access.trustState !== 'identity-unavailable') {
      process.stdout.write('Grant access with: robota trust --yes\n');
    }
  }
}

/** Handle the pre-parse `robota trust` lifecycle command without loading project settings. */
export async function runWorkspaceTrustCommand(
  argv: readonly string[],
  cwd: string,
  service: WorkspaceTrustService = createNodeWorkspaceTrustService(),
): Promise<number> {
  const action = (argv.find((argument) => !argument.startsWith('-')) ??
    (argv.includes('--yes') ? 'grant' : 'status')) as TWorkspaceTrustAction;
  if (!['status', 'grant', 'revoke'].includes(action)) {
    process.stderr.write('Usage: robota trust [status|grant|revoke] [--yes]\n');
    return 1;
  }
  if (action !== 'status' && process.stdin.isTTY !== true && !argv.includes('--yes')) {
    process.stderr.write(`robota trust ${action} requires --yes in headless mode.\n`);
    return 1;
  }
  try {
    const access =
      action === 'grant'
        ? await service.grant(cwd)
        : action === 'revoke'
          ? await service.revoke(cwd)
          : await service.inspect(cwd);
    printAccess(access);
    return access.status === 'trusted' || action === 'status' ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `Workspace trust ${action} failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 1;
  }
}
