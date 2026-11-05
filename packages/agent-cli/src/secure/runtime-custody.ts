/**
 * Who may act as the owner of a secure runtime, and whether its read keys are open: the one place
 * that decides both.
 *
 * A link is admitted by what it proved (its standing). Before anyone certified the runtime only its
 * spawner is admitted, and the one thing a spawner can do is certify it, once, after which every
 * spawner link ends and no new one is admitted. After that only the owner is admitted. The owner
 * unlocks the runtime by handing it read keys over the link, and what takes them away again is
 * always the same few things: the owner's own request, the last link closing, a lock command that
 * needs no proof (taking access away is something anyone who could stop the runtime can do), and
 * fifteen minutes in which the owner did nothing. Locking never closes a link, and every change is
 * told to every link.
 *
 * The socket, the request line and the commands answered from the runtime's own state belong to the
 * control endpoint; they meet here through `IRuntimeAdmission` and nowhere else.
 */
import {
  LinkRefusedError,
  type IReadKeys,
  type IRuntimeIdentity,
  type ITrustRoot,
} from '@robota-sdk/agent-keyring';
import {
  OwnerRequestRefusedError,
  serveRuntimeLink,
  type IAdmittedRuntimeLink,
  type IOwnerControlRequest,
  type IOwnerLinkDesk,
  type IOwnerLinkSessions,
  type IRuntimeCustodyState,
  type IRuntimeLinkPorts,
  type TGrantOutcome,
  type TOwnerControlResult,
} from '@robota-sdk/agent-transport-link';

import { KeyringStoreError } from './keyring-store.js';
import { LinkSession } from './link-session.js';
import { isOwnerControlAct } from './owner-input.js';
import { MAX_ATTACHED_SURFACES } from '../session-inventory/supervised-attach.js';

import type { Duplex } from 'node:stream';

import type {
  IRuntimeAdmission,
  IRuntimeAdmissionContext,
  IRuntimeAdmissionStatus,
  TRuntimeAdmissionFactory,
} from '../session-inventory/runtime-admission.js';
import type { TSupervisedAttachTarget } from '../session-inventory/supervised-attach.js';
import type { KeyHolder } from './key-holder.js';

export interface IRuntimeCustodyOptions {
  /** This runtime's identity, whose spawner exchange has already run. */
  readonly identity: IRuntimeIdentity;
  readonly holder: KeyHolder;
  /** What a bound link reaches: the host's sessions through a binder, or the one session. */
  readonly attachTarget: TSupervisedAttachTarget;
  /** It runs without the project's own configuration. */
  readonly restricted?: boolean;
  readonly handshakeTimeoutMs?: number;
  readonly closeFlushTimeoutMs?: number;
}

/** What a runtime's stop rules follow: its spawner coming and going, and its certification. */
export type TCustodyEvent = 'spawner-linked' | 'spawner-dropped' | 'certified';

const NOT_THE_OWNER = 'Only the owner may ask this.';

const notAllowed = (): OwnerRequestRefusedError => new OwnerRequestRefusedError('not-allowed', NOT_THE_OWNER);

export class RuntimeCustody implements IRuntimeAdmission {
  readonly #options: IRuntimeCustodyOptions;
  readonly #links = new Set<IAdmittedRuntimeLink>();
  readonly #listeners = new Set<(event: TCustodyEvent) => void>();
  #context: IRuntimeAdmissionContext | undefined;
  #daemon = false;
  #surfaces = 0;
  #drivers = 0;
  #seenSpawner = false;

  constructor(options: IRuntimeCustodyOptions) {
    this.#options = options;
    // Every change of what the keys can do is told to every link, whoever caused it.
    options.holder.onLock(() => this.#announce());
    options.holder.onUnlock(() => this.#announce());
  }

  /** What the control endpoint is given: the custody, once it knows this runtime start's binding. */
  readonly admission: TRuntimeAdmissionFactory = (context) => {
    this.#context = context;
    return this;
  };

  serveLink(stream: Duplex, rest: Buffer): void {
    const context = this.#context;
    if (context === undefined) {
      stream.destroy();
      return;
    }
    const { identity, handshakeTimeoutMs, closeFlushTimeoutMs } = this.#options;
    serveRuntimeLink(stream, {
      identity,
      binding: context.binding,
      rest,
      ...(handshakeTimeoutMs !== undefined ? { handshakeTimeoutMs } : {}),
      ...(closeFlushTimeoutMs !== undefined ? { closeFlushTimeoutMs } : {}),
      admit: (link) => this.#admit(link, context),
    });
  }

  lock(): void {
    this.#options.holder.lock('explicit');
  }

  status(): IRuntimeAdmissionStatus {
    return {
      certified: this.#options.identity.certified,
      daemon: this.#daemon,
      restricted: this.#options.restricted === true,
    };
  }

  takeDaemonRole(): boolean {
    if (!this.#options.identity.certified) return false;
    this.#daemon = true;
    return true;
  }

  /** How many links its spawner holds open now. */
  spawnerLinks(): number {
    let count = 0;
    for (const link of this.#links) if (link.standing === 'spawner') count += 1;
    return count;
  }

  /** Whether a spawner ever linked, including before the readiness observer began. */
  hasSeenSpawner(): boolean {
    return this.#seenSpawner;
  }

  /** Be told when a spawner link opens or closes and when the runtime is certified; returns the way to stop. */
  onChange(listener: (event: TCustodyEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #emit(event: TCustodyEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // allow-fallback: a rule that fails must not keep the custody's own work, or the other rules, from running.
      }
    }
  }

  #state(): IRuntimeCustodyState {
    return { unlocked: this.#options.holder.isUnlocked, certified: this.#options.identity.certified };
  }

  #announce(): void {
    const state = this.#state();
    for (const link of [...this.#links]) {
      try {
        link.notifyCustody(state);
      } catch {
        // allow-fallback: the link is already failing; one link's failure must not keep the others uninformed.
      }
    }
  }

  #acquireSurface(): (() => void) | undefined {
    if (this.#surfaces >= MAX_ATTACHED_SURFACES) return undefined;
    this.#surfaces += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#surfaces -= 1;
    };
  }

  #admit(link: IAdmittedRuntimeLink, context: IRuntimeAdmissionContext): IRuntimeLinkPorts {
    const session = new LinkSession({
      link,
      target: this.#options.attachTarget,
      acquireSurface: () => this.#acquireSurface(),
      nextDriverId: () => `attach:${(this.#drivers += 1)}`,
      onOwnerInput: () => this.#options.holder.touch(),
    });
    const ports = {
      desk: this.#deskOf(link, session, context),
      sessions: this.#sessionsOf(link),
      session,
    };
    // Counted only once its ports exist: a link counted here is one whose `closed` will be called.
    this.#links.add(link);
    if (link.standing === 'spawner') {
      this.#seenSpawner = true;
      this.#emit('spawner-linked');
    }
    return ports;
  }

  #deskOf(link: IAdmittedRuntimeLink, session: LinkSession, context: IRuntimeAdmissionContext): IOwnerLinkDesk {
    const isOwner = link.standing === 'owner';
    const requireOwner = (): void => {
      if (!isOwner) throw notAllowed();
    };
    return {
      custody: () => this.#state(),
      installTrustRoot: (root) => {
        if (link.standing !== 'spawner') {
          throw new OwnerRequestRefusedError('not-allowed', 'Only the spawner installs a trust root.');
        }
        this.#installTrustRoot(root, link);
      },
      unlock: (keys) => {
        requireOwner();
        return this.#unlock(keys);
      },
      lock: (reason) => {
        requireOwner();
        this.#options.holder.lock(reason);
      },
      control: (request) => {
        // Binding a session is what a spawner is admitted for; every other command is the owner's.
        if (request.command === 'attach') return { ...session.bind(request.fields['mode']) };
        requireOwner();
        if (isOwnerControlAct(request.command)) this.#options.holder.touch();
        return answerOf(context, request);
      },
      closed: () => {
        this.#links.delete(link);
        try {
          session.end();
        } finally {
          // The keys go with the last link whatever the host's cleanup of its binding did.
          if (this.#links.size === 0) this.#options.holder.lock('last-client-detached');
          if (link.standing === 'spawner') this.#emit('spawner-dropped');
        }
      },
    };
  }

  #sessionsOf(link: IAdmittedRuntimeLink): IOwnerLinkSessions {
    return {
      question: () => {
        if (link.standing !== 'owner') throw notAllowed();
        // Until an owner surface can show the notice and take the answer, a runtime that cannot ask refuses.
        return {
          kind: 'refused',
          message:
            'This runtime cannot ask whether a session not verified as yours may be opened. Resume it at a terminal.',
        };
      },
      openAccepted: () => {
        if (link.standing !== 'owner') throw notAllowed();
        throw new OwnerRequestRefusedError(
          'unverified',
          'This runtime cannot open a session that is not verified as yours.',
        );
      },
    };
  }

  #installTrustRoot(root: ITrustRoot, link: IAdmittedRuntimeLink): void {
    try {
      this.#options.identity.installTrustRoot(root, link.binding);
    } catch (error) {
      if (error instanceof LinkRefusedError) {
        throw new OwnerRequestRefusedError(error.reason, error.message);
      }
      throw error;
    }
    this.#announce();
    this.#emit('certified');
    // The spawner's part is over: its links end once the answer to this request has gone out.
    setImmediate(() => {
      for (const open of [...this.#links]) if (open.standing === 'spawner') open.close();
    });
  }

  #unlock(keys: IReadKeys): TGrantOutcome {
    try {
      return this.#options.holder.unlockWithGrant(keys);
    } catch (error) {
      if (error instanceof KeyringStoreError && error.code === 'missing') {
        throw new OwnerRequestRefusedError(
          'no-keyring',
          'This runtime has no keyring file to check the read keys against.',
        );
      }
      throw error;
    }
  }
}

/** One command's answer from the runtime's own state, as plain JSON the link can carry. */
function answerOf(context: IRuntimeAdmissionContext, request: IOwnerControlRequest): TOwnerControlResult {
  return JSON.parse(JSON.stringify(context.control(request.command, request.fields))) as TOwnerControlResult;
}
