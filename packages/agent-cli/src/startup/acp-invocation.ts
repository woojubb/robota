import { parseCliArgs, subcommandWord, type IParsedCliArgs } from '../utils/cli-args.js';
import {
  formatHeadlessWorkspaceTrustError,
  requiresHeadlessWorkspaceTrust,
} from './workspace-trust-admission.js';

import type { TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import type { TAcpWorkspaceAdmission } from '@robota-sdk/agent-transport-acp';

/** Pure process-mode validation shared by local and hosted execution before any carrier starts. */
export function validateAcpInvocation(args: IParsedCliArgs, cliName: string): { acp: boolean } {
  const acp = subcommandWord(args) === 'acp';
  if (!acp) return { acp };
  if (args.positional.length !== 1) throw new Error(`Usage: ${cliName} acp [options]`);
  if (
    args.serve ||
    args.printMode ||
    args.goal !== undefined ||
    args.open ||
    args.configure ||
    args.configureProvider !== undefined ||
    args.reset
  ) {
    throw new Error(`${cliName} acp cannot be combined with another process mode or setup command`);
  }
  return { acp };
}

/**
 * The parsed arguments of a `the product acp` run that will speak ACP on stdout, or `undefined`.
 * Only such a run has stdout reserved for the protocol. A help request is not one: its text must
 * reach stdout like any other help.
 */
export function acpProtocolArgs(argv: readonly string[]): IParsedCliArgs | undefined {
  if (!argv.includes('acp')) return undefined;
  try {
    const parsed = parseCliArgs([...argv]);
    return subcommandWord(parsed) === 'acp' && !parsed.help ? parsed : undefined;
  } catch {
    // allow-fallback: the normal parser reports an invalid invocation later.
    return undefined;
  }
}

export interface IAcpWorkspaceAdmissionInput {
  readonly access: TWorkspaceProjectAccess;
  readonly cwd: string;
  readonly cliName: string;
  /** Safe mode, or a Restricted start a person asked for: the two starts the headless gate lets through. */
  readonly restrictedByChoice: boolean;
}

/**
 * The headless trust gate, asked when the editor creates its session instead of before startup.
 * Exiting at startup would show the editor a crashed agent with no reason; a protocol error can
 * carry the command that grants access.
 */
export function admitAcpWorkspace(input: IAcpWorkspaceAdmissionInput): TAcpWorkspaceAdmission {
  if (input.restrictedByChoice || !requiresHeadlessWorkspaceTrust(input.access)) {
    return { admitted: true };
  }
  return {
    admitted: false,
    message: [
      formatHeadlessWorkspaceTrustError(input.access, input.cwd, input.cliName),
      'Then start the agent again.',
    ].join('\n'),
  };
}
