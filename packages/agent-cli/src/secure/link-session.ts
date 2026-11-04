/**
 * The session protocol of one owner link: what an attached terminal's socket carries in the clear,
 * carried in sealed frames instead, for a link whose client has proved who it is.
 *
 * A link says what it is for before anything it sends is heard: until it asks to bind (`attach`, in
 * `drive` or `observe`), the session frames it sends are dropped, and it binds once. From then on it
 * is what an attached terminal is: the carrier decides the role and the session handler enforces it
 * (an observer never submits, answers or reads another session), each surface keeps to the same
 * backlog budget as a terminal on the plain socket, and a client that stops reading loses only its
 * own link. Standing narrows it further: a spawner may start sessions and drive them, and may not
 * list, switch to, rename or delete a stored one, because it holds no read keys and must not learn
 * or touch what the owner has stored.
 */
import {
  ATTACHED_SURFACE_MAX_PENDING_BYTES,
  createOutboundDelivery,
  createSessionMessageHandler,
} from '@robota-sdk/agent-transport';

import { isOwnerInput } from './owner-input.js';

import type { ISessionDirectory, TSessionBindingRole } from '@robota-sdk/agent-interface-session';
import type { TLinkMode } from '@robota-sdk/agent-keyring';
import type { IProtocolSession } from '@robota-sdk/agent-transport';
import type { IAdmittedRuntimeLink, ILinkSessionSink } from '@robota-sdk/agent-transport-link';
import type { TSupervisedAttachTarget } from '../session-inventory/supervised-attach.js';

export type TLinkAttachRefusal = 'unsupported-attach' | 'already-attached' | 'attach-limit';

export type TLinkAttachAnswer =
  | { readonly status: 'attached'; readonly driverId: string }
  | { readonly status: 'refused'; readonly reason: TLinkAttachRefusal };

export interface ILinkSessionOptions {
  readonly link: IAdmittedRuntimeLink;
  readonly target: TSupervisedAttachTarget;
  /** Takes one of the runtime's bound-surface slots, or `undefined` when they are all taken. */
  readonly acquireSurface: () => (() => void) | undefined;
  readonly nextDriverId: () => string;
  /** The owner did something a person does. */
  readonly onOwnerInput: () => void;
}

interface IBound {
  readonly handler: ReturnType<typeof createSessionMessageHandler>;
  readonly release: () => void;
  readonly countsInput: boolean;
}

interface IBinding {
  readonly session: IProtocolSession;
  readonly directory: ISessionDirectory | undefined;
  release(): void;
}

function bindingOf(target: TSupervisedAttachTarget, mode: TSessionBindingRole): IBinding {
  return 'binder' in target
    ? target.binder.bind(mode)
    : { session: target.session, directory: undefined, release: () => undefined };
}

/** A directory that starts sessions and nothing else: what a client without read keys may reach. */
function startOnly(directory: ISessionDirectory): ISessionDirectory {
  const refuse = (what: string): Promise<never> =>
    Promise.reject(new Error(`This link cannot ${what}.`));
  return {
    newSession: () => directory.newSession(),
    listSessions: () => {
      throw new Error('This link cannot list sessions.');
    },
    switchSession: () => refuse('switch to a stored session'),
    renameSession: () => refuse('rename a stored session'),
    deleteSession: () => refuse('delete a stored session'),
  };
}

export class LinkSession implements ILinkSessionSink {
  readonly #options: ILinkSessionOptions;
  readonly #standing: TLinkMode;
  #bound: IBound | undefined;
  #ended = false;

  constructor(options: ILinkSessionOptions) {
    this.#options = options;
    this.#standing = options.link.standing;
  }

  /** Binds this link to the runtime's session in `mode`, once. */
  bind(mode: unknown): TLinkAttachAnswer {
    if (mode !== 'drive' && mode !== 'observe') return refused('unsupported-attach');
    if (this.#bound !== undefined || this.#ended) return refused('already-attached');
    const releaseSurface = this.#options.acquireSurface();
    if (releaseSurface === undefined) return refused('attach-limit');
    const { link, target } = this.#options;
    let binding: IBinding;
    try {
      binding = bindingOf(target, mode);
    } catch (error) {
      releaseSurface();
      throw error;
    }
    const driverId = this.#options.nextDriverId();
    const directory =
      binding.directory !== undefined && this.#standing === 'spawner'
        ? startOnly(binding.directory)
        : binding.directory;
    const deliver = createOutboundDelivery(
      (message) => link.sendSession(JSON.stringify(message)),
      // A reader that stopped reading, or a frame too large to carry, costs only this link.
      () => link.close(),
      () => link.pendingBytes(),
      ATTACHED_SURFACE_MAX_PENDING_BYTES,
    );
    const handler = createSessionMessageHandler({
      session: binding.session,
      deliver,
      driverId,
      surface: 'attach',
      role: mode,
      ...(directory !== undefined ? { sessionDirectory: directory } : {}),
    });
    this.#bound = {
      handler,
      // Each step runs whatever the one before did: a binding or a slot is never kept for a link that is gone.
      release: () => {
        try {
          handler.cleanup();
        } finally {
          try {
            binding.release();
          } finally {
            releaseSurface();
          }
        }
      },
      // Only a driver the owner proved acts: an observer's refused input and a spawner's are not the owner at the keyboard.
      countsInput: this.#standing === 'owner' && mode === 'drive',
    };
    return { status: 'attached', driverId };
  }

  receive(data: string): void {
    const bound = this.#bound;
    if (bound === undefined) return;
    if (bound.countsInput && isOwnerInput(data)) this.#options.onOwnerInput();
    try {
      bound.handler.onMessage(data);
    } catch {
      // allow-fallback: a frame the handler cannot take ends this link, as it ends an attached terminal's connection.
      this.#options.link.close();
    }
  }

  /** The link is gone: unsubscribes from the session and gives the binding and the slot back. */
  end(): void {
    this.#ended = true;
    const bound = this.#bound;
    this.#bound = undefined;
    bound?.release();
  }
}

function refused(reason: TLinkAttachRefusal): TLinkAttachAnswer {
  return { status: 'refused', reason };
}
