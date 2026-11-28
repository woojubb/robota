import { parseArgs } from 'node:util';

import { adminPaths } from '../admin/paths.js';
import { adminDownload, adminRequest, adminUpload, UnreachableError } from '../admin/client.js';
import { EXIT, exitCodeFor } from '../admin/protocol.js';
import type {
  IAccountView,
  IRestoreResult,
  IStatusReport,
  IUpgradeResult,
} from '../control-plane.js';
import { errorMessage, HostError } from '../errors.js';
import { formatAccount, formatList, formatRestore, formatStatus, formatUpgrade } from './format.js';
import { type ICliIo, readAll, readHidden, readLine } from './io.js';

export const USAGE = `Usage: personal-agent-host <command>

Commands:
  serve                       Run the control plane (see the guide for the required settings)
  check-config                Validate the environment
  add <id> --provider <type>  Add an account. The model key is read from stdin, or asked for
                              on a terminal without echo; it is never an argument.
      [--model <name>] [--base-url <url>] [--backend container|vm]
      [--key-source account|operator|none]
      [--memory-mb <n>] [--cpus <n>] [--pids <n>]
  suspend <id>                Stop an account's unit and keep its state
  resume <id>                 Start a suspended account again
  delete <id> [--confirm <id>]
                              Remove an account and its state; the id must be typed back
  access-code <id>            Print the account's access code
  upgrade <id> | --all        Move accounts to the unit image now configured; each new image
                              is proven healthy first, else the previous one is restored
  backup <id> > file          Write a consistent copy of an account's state to stdout (the unit is
                              stopped for a moment). The file holds the access code and connector
                              tokens, not the model key: keep it like a secret.
  restore <id> < file         Replace an account's state with a backup read from stdin; the archive
      [--from-other-account]  is checked first and the previous state is put back on any failure.
                              A backup of another account needs --from-other-account.
  list | show <id> | status   Inspect accounts and the host

Options: --json prints the machine-readable result. The state directory comes from
PERSONAL_AGENT_HOST_STATE_DIR.

Exit codes: 0 done, 1 failed, 2 usage, 3 refused, 4 no such account, 5 control plane not reachable.
`;

class UsageError extends Error {}

const CLIENT_COMMANDS = [
  'add',
  'suspend',
  'resume',
  'delete',
  'access-code',
  'upgrade',
  'backup',
  'restore',
  'list',
  'show',
  'status',
] as const;
type ClientCommand = (typeof CLIENT_COMMANDS)[number];

export function isClientCommand(value: string | undefined): value is ClientCommand {
  return CLIENT_COMMANDS.includes(value as ClientCommand);
}

const OPTIONS = {
  json: { type: 'boolean' },
  provider: { type: 'string' },
  model: { type: 'string' },
  'base-url': { type: 'string' },
  backend: { type: 'string' },
  'key-source': { type: 'string' },
  'memory-mb': { type: 'string' },
  cpus: { type: 'string' },
  pids: { type: 'string' },
  confirm: { type: 'string' },
  all: { type: 'boolean' },
  'from-other-account': { type: 'boolean' },
} as const;

const ALLOWED: Record<ClientCommand, readonly string[]> = {
  add: [
    'json',
    'provider',
    'model',
    'base-url',
    'backend',
    'key-source',
    'memory-mb',
    'cpus',
    'pids',
  ],
  delete: ['json', 'confirm'],
  suspend: ['json'],
  resume: ['json'],
  'access-code': ['json'],
  upgrade: ['json', 'all'],
  backup: [],
  restore: ['json', 'from-other-account'],
  list: ['json'],
  show: ['json'],
  status: ['json'],
};

const NEEDS_ID: ReadonlySet<ClientCommand> = new Set<ClientCommand>([
  'add',
  'suspend',
  'resume',
  'delete',
  'access-code',
  'backup',
  'restore',
  'show',
]);

function parse(command: ClientCommand, args: string[]) {
  // A key on the command line would sit in the process list and the shell history.
  if (args.some((a) => /^--(?:api-?key|key|secret|token)(?:=|$)/u.test(a))) {
    throw new UsageError(
      'The model key is never an argument: pipe it on stdin, or run on a terminal to be asked',
    );
  }
  let parsed;
  try {
    parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (error) {
    throw new UsageError(errorMessage(error));
  }
  for (const name of Object.keys(parsed.values)) {
    if (!ALLOWED[command].includes(name)) {
      throw new UsageError(`--${name} does not apply to ${command}`);
    }
  }
  if (command === 'upgrade' && (parsed.values.all === true) === parsed.positionals.length > 0) {
    throw new UsageError('upgrade needs one account id, or --all');
  }
  const expected =
    command === 'upgrade' ? parsed.positionals.length : NEEDS_ID.has(command) ? 1 : 0;
  if (parsed.positionals.length !== expected) {
    throw new UsageError(
      expected === 1 ? `${command} needs exactly one account id` : `${command} takes no arguments`,
    );
  }
  return { id: parsed.positionals[0] as string | undefined, values: parsed.values };
}

function limit(values: Record<string, unknown>, name: string): number | undefined {
  const raw = values[name];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (typeof raw !== 'string' || raw.trim() === '' || !Number.isFinite(value)) {
    throw new UsageError(`--${name} must be a number`);
  }
  return value;
}

async function readKey(io: ICliIo): Promise<string> {
  return io.stdin.isTTY === true ? readHidden(io, 'Model key (input is hidden): ') : readAll(io);
}

async function addBody(values: Record<string, unknown>, id: string, io: ICliIo) {
  if (typeof values.provider !== 'string') throw new UsageError('add needs --provider <type>');
  const keySource = (values['key-source'] as string | undefined) ?? 'account';
  const limits = {
    ...(limit(values, 'memory-mb') !== undefined ? { memoryMb: limit(values, 'memory-mb') } : {}),
    ...(limit(values, 'cpus') !== undefined ? { cpus: limit(values, 'cpus') } : {}),
    ...(limit(values, 'pids') !== undefined ? { pids: limit(values, 'pids') } : {}),
  };
  return {
    id,
    backend: (values.backend as string | undefined) ?? 'container',
    provider: {
      type: values.provider,
      ...(values.model !== undefined ? { model: values.model } : {}),
      ...(values['base-url'] !== undefined ? { baseUrl: values['base-url'] } : {}),
    },
    keySource,
    ...(keySource === 'account' ? { apiKey: await readKey(io) } : {}),
    ...(Object.keys(limits).length > 0 ? { limits } : {}),
  };
}

async function confirmation(values: Record<string, unknown>, id: string, io: ICliIo) {
  if (typeof values.confirm === 'string') return values.confirm;
  if (io.stdin.isTTY === true) {
    return readLine(io, `Deleting ${id} wipes its state. Type the account id to confirm: `);
  }
  throw new HostError(
    'confirmation-required',
    `Deleting ${id} wipes its state; repeat the account id with --confirm ${id}`,
  );
}

async function execute(
  command: ClientCommand,
  id: string | undefined,
  values: Record<string, unknown>,
  socket: string,
  io: ICliIo,
): Promise<{ result: unknown; text: string; to?: 'stderr' }> {
  const path = `/v1/accounts/${id ?? ''}`;
  const account = (result: unknown): { result: unknown; text: string } => ({
    result,
    text: formatAccount(result as IAccountView),
  });
  switch (command) {
    case 'add':
      return account(
        await adminRequest(socket, 'POST', '/v1/accounts', await addBody(values, id ?? '', io)),
      );
    case 'suspend':
    case 'resume':
      return account(await adminRequest(socket, 'POST', `${path}/${command}`));
    case 'show':
      return account(await adminRequest(socket, 'GET', path));
    case 'delete': {
      const result = await adminRequest(socket, 'POST', `${path}/delete`, {
        confirmation: await confirmation(values, id ?? '', io),
      });
      return { result, text: `Deleted ${id}\n` };
    }
    case 'upgrade': {
      const result = await adminRequest<IUpgradeResult>(
        socket,
        'POST',
        id === undefined ? '/v1/upgrade' : `${path}/upgrade`,
      );
      return { result, text: formatUpgrade(result) };
    }
    case 'backup': {
      // The archive is the output, so nothing else may be written to stdout.
      if (io.stdout.isTTY === true) {
        throw new UsageError(
          `backup writes an archive; redirect it to a file: personal-agent-host backup ${id} > ${id}.tar`,
        );
      }
      const bytes = await adminDownload(socket, `${path}/backup`, io.stdout);
      return {
        result: { account: id, bytes },
        text:
          `Backed up ${id}: ${bytes} bytes. The archive holds the account's access code and ` +
          'connector tokens, so keep it like a secret.\n',
        to: 'stderr',
      };
    }
    case 'restore': {
      if (io.stdin.isTTY === true) {
        throw new UsageError(
          `restore reads an archive from stdin; redirect a file: personal-agent-host restore ${id} < ${id}.tar`,
        );
      }
      const flag = values['from-other-account'] === true ? '?from-other-account=true' : '';
      const result = await adminUpload<IRestoreResult>(socket, `${path}/restore${flag}`, io.stdin);
      return { result, text: formatRestore(result) };
    }
    case 'access-code': {
      const result = await adminRequest<{ code: string }>(socket, 'POST', `${path}/access-code`);
      return { result, text: `${result.code}\n` };
    }
    case 'list': {
      const result = await adminRequest<IAccountView[]>(socket, 'GET', '/v1/accounts');
      return { result, text: formatList(result) };
    }
    case 'status': {
      const result = await adminRequest<IStatusReport>(socket, 'GET', '/v1/status');
      return { result, text: formatStatus(result) };
    }
  }
}

/** Runs one client command against the admin socket and returns its exit code. */
export async function runClient(
  command: ClientCommand,
  args: string[],
  env: NodeJS.ProcessEnv,
  io: ICliIo,
): Promise<number> {
  try {
    const { id, values } = parse(command, args);
    const { socket } = adminPaths(env);
    const { result, text, to } = await execute(command, id, values, socket, io);
    (to === 'stderr' ? io.stderr : io.stdout).write(
      values.json === true ? `${JSON.stringify(result, null, 2)}\n` : text,
    );
    return EXIT.ok;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`${error.message}\nRun "personal-agent-host" without arguments for usage.\n`);
      return EXIT.usage;
    }
    io.stderr.write(`${errorMessage(error)}\n`);
    if (error instanceof UnreachableError) return EXIT.unreachable;
    return error instanceof HostError ? exitCodeFor(error.code) : EXIT.failed;
  }
}
