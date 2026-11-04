/**
 * Who may send each command a supervised runtime's control socket understands, in plain mode and in
 * secure mode: one row per command, so a command added without a decision does not compile.
 *
 * Programs running as the same user can connect to the control socket, so in plain mode every
 * command is open to them and the socket's directory is the only admission. In secure mode what a
 * same-user program may do is limited to what costs the owner at most a stopped runtime, and
 * everything that reveals or changes anything else is the owner's, reached only inside an owner
 * link, which proves the owner before it carries a byte of it.
 */

/** Every command the endpoint knows, however it reaches the runtime. */
export type TControlCommandName =
  | 'status'
  | 'stop'
  | 'lock'
  | 'link'
  | 'attach'
  | 'connect'
  | 'rename'
  | 'link-pr'
  | 'unlink-pr'
  | 'events-list'
  | 'events-revoke'
  | 'take-daemon-role';

/** A plain runtime answers a command to anyone who names it, or does not know it. */
export type TPlainControlAccess = 'open' | 'absent';

/**
 * `open`: answered to any same-user program. `open-trimmed`: answered to any same-user program with
 * the owner's metadata left out (the owner link's `control` request returns it whole).
 * `owner-control`: only as a `control` request inside an owner link. `absent`: not a command here.
 */
export type TSecureControlAccess = 'open' | 'open-trimmed' | 'owner-control' | 'absent';

export interface IControlAccess {
  readonly plain: TPlainControlAccess;
  readonly secure: TSecureControlAccess;
}

/** A table with a row for each of `TCommand`, and no others. */
export type TControlAccessTable<TCommand extends string = TControlCommandName> = {
  readonly [C in TCommand]: IControlAccess;
};

export const CONTROL_ACCESS: TControlAccessTable = {
  // Liveness and activity are what makes "is it running" answerable without a proof. A secure runtime
  // leaves out what names the work: the session's name, its PR and its external event grants.
  status: { plain: 'open', secure: 'open-trimmed' },
  // Stopping a runtime a same-user program could kill anyway gives it nothing more.
  stop: { plain: 'open', secure: 'open' },
  // Locking only takes read keys away, which a program that could stop or kill the runtime can do
  // anyway; unlocking is the opposite and always needs a proof.
  lock: { plain: 'absent', secure: 'open' },
  // The request that opens an owner link; the link proves who is on the other end.
  link: { plain: 'absent', secure: 'open' },
  // Plain attach admits whoever names the id and generation; secure mode has no such admission.
  attach: { plain: 'open', secure: 'absent' },
  // Hands out the WebSocket URL with its token, which secure mode never starts.
  connect: { plain: 'open', secure: 'absent' },
  rename: { plain: 'open', secure: 'owner-control' },
  'link-pr': { plain: 'open', secure: 'owner-control' },
  'unlink-pr': { plain: 'open', secure: 'owner-control' },
  'events-list': { plain: 'open', secure: 'owner-control' },
  'events-revoke': { plain: 'open', secure: 'owner-control' },
  // Whether a certified runtime is its workspace's daemon is the owner's decision.
  'take-daemon-role': { plain: 'absent', secure: 'owner-control' },
};

export function isControlCommandName(value: unknown): value is TControlCommandName {
  return typeof value === 'string' && Object.hasOwn(CONTROL_ACCESS, value);
}
