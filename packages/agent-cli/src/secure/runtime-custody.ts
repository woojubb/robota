/**
 * Who may act as the owner of a secure runtime, and whether its read keys are open: the one place
 * that decides both.
 *
 * A link is admitted by what it proved (its standing). Before anyone certified the runtime only its
 * spawner is admitted, and the one thing a spawner can do is certify it, once, after which every
 * spawner link ends and no new one is admitted. After that only the owner is admitted. The owner
 * unlocks the runtime by handing it read keys over the link, and what takes them away again is
 * always the same few things: the owner's own request, the last attached client or grant owner
 * closing, a lock command that
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
} from '@robota-sdk/agent-transport/link';

import { KeyringStoreError } from '@robota-sdk/agent-local-host';
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
import type { KeyHolder } from '@robota-sdk/agent-local-host';
import type { SecureWorkspaceRootFence } from './workspace-root-fence.js';

export interface IRuntimeCustodyOptions {
  /** This runtime's identity, whose spawner exchange has already run. */
  readonly identity: IRuntimeIdentity;
  readonly holder: KeyHolder;
  /** What a bound link reaches: the host's sessions through a binder, or the one session. */
  readonly attachTarget: TSupervisedAttachTarget;
  readonly workspaceFence?: SecureWorkspaceRootFence;
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
  readonly #spawnerSessions = new Set<LinkSession>();
  readonly #ownerSessions = new Set<LinkSession>();
  readonly #attachedOwners = new Set<LinkSession>();
  readonly #grantOwners = new Set<LinkSession>();
  readonly #listeners = new Set<(event: TCustodyEvent) => void>();
  #context: IRuntimeAdmissionContext | undefined;
  #daemon = false;
  #surfaces = 0;
  #drivers = 0;
  #seenSpawner = false;
  /** A global lock retires every link admitted before this generation. */
  #grantEpoch = 0;
  /** The lock requester's reply is flushed before its link is retired. */
  #lockRequester: IAdmittedRuntimeLink | undefined;

  constructor(options: IRuntimeCustodyOptions) {
    this.#options = options;
    // Every change of what the keys can do is told to every link, whoever caused it.
    options.holder.onLock(() => {
      this.#retireGrantEpoch();
    });
    options.holder.onUnlock(() => {
      for (const session of this.#ownerSessions) session.invalidateOwnerDecisions();
      this.#announce();
    });
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
    this.#barrier('explicit');
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

  /** The holder has dropped its keys; no older link can install a delayed grant. */
  #retireGrantEpoch(): void {
    this.#grantEpoch += 1;
    this.#grantOwners.clear();
    for (const session of this.#ownerSessions) session.invalidateOwnerDecisions();
    this.#announce();
    const requester = this.#lockRequester;
    for (const link of [...this.#links]) {
      if (link !== requester) link.close();
    }
    if (requester !== undefined) setImmediate(() => requester.close());
  }

  #barrier(reason: 'explicit' | 'screen-lock' | 'suspend' | 'last-client-detached' | 'fault', requester?: IAdmittedRuntimeLink): void {
    const prior = this.#grantEpoch;
    this.#lockRequester = requester;
    try {
      this.#options.holder.lock(reason);
      // A lock while already locked still retires old links and pending grants.
      if (this.#grantEpoch === prior) this.#retireGrantEpoch();
    } finally {
      this.#lockRequester = undefined;
    }
  }

  #assertWorkspace(): void {
    try { this.#options.workspaceFence?.assertCurrent(); }
    catch {
      this.#barrier('fault');
      throw new OwnerRequestRefusedError('root-changed', 'The live workspace root or trust generation changed.');
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
    const grantEpoch = this.#grantEpoch;
    let nativeActivity = false;
    const session = new LinkSession({
      link,
      target: this.#options.attachTarget,
      acquireSurface: () => this.#acquireSurface(),
      nextDriverId: () => `attach:${(this.#drivers += 1)}`,
      onOwnerInput: () => { this.#assertWorkspace(); if (!nativeActivity) this.#options.holder.touch(); },
      ownerUnlocked: () => this.#options.holder.isUnlocked,
      workspaceCurrent: () => {
        try { this.#assertWorkspace(); return true; }
        catch { return false; }
      },
    });
    const ports = {
      desk: this.#deskOf(link, session, context, grantEpoch, () => { nativeActivity = true; }, () => nativeActivity),
      sessions: this.#sessionsOf(link, session, grantEpoch),
      session,
    };
    // Counted only once its ports exist: a link counted here is one whose `closed` will be called.
    this.#links.add(link);
    if (link.standing === 'owner') this.#ownerSessions.add(session);
    if (link.standing === 'spawner') {
      this.#spawnerSessions.add(session);
      this.#seenSpawner = true;
      this.#emit('spawner-linked');
    }
    return ports;
  }

  #deskOf(
    link: IAdmittedRuntimeLink,
    session: LinkSession,
    context: IRuntimeAdmissionContext,
    grantEpoch: number,
    requireNativeActivity: () => void,
    isNativeActivity: () => boolean,
  ): IOwnerLinkDesk {
    const isOwner = link.standing === 'owner';
    let detached = false;
    let driving = false;
    const requireCurrent = (): void => {
      if (detached) throw new OwnerRequestRefusedError('owner-detached', 'This owner has detached.');
      if (grantEpoch !== this.#grantEpoch) {
        throw new OwnerRequestRefusedError('stale-epoch', 'This owner link was retired by a runtime lock.');
      }
    };
    const requireOwner = (): void => {
      if (!isOwner) throw notAllowed();
      requireCurrent();
    };
    return {
      custody: () => this.#state(),
      installTrustRoot: (root) => {
        requireCurrent();
        if (link.standing !== 'spawner') {
          throw new OwnerRequestRefusedError('not-allowed', 'Only the spawner installs a trust root.');
        }
        this.#installTrustRoot(root, link);
      },
      unlock: (keys) => {
        requireOwner();
        requireCurrent();
        this.#assertWorkspace();
        const outcome = this.#unlock(keys);
        this.#grantOwners.add(session);
        return outcome;
      },
      lock: (reason) => {
        if (!isOwner) throw notAllowed();
        // A detached owner retains only the ability to narrow authority. This lets an OS lock
        // overtake an in-flight owner-detach without keeping its handover or read grant alive.
        if (grantEpoch !== this.#grantEpoch) {
          throw new OwnerRequestRefusedError('stale-epoch', 'This owner link was retired by a runtime lock.');
        }
        this.#barrier(reason, link);
      },
      control: (request) => {
        requireCurrent();
        if (request.command === 'owner-detach') {
          requireOwner();
          this.#assertWorkspace();
          detached = true;
          const wasAttached = this.#attachedOwners.delete(session);
          const hadGrant = this.#grantOwners.delete(session);
          try { session.revoke(); session.end(); }
          finally {
            if (this.#options.holder.isUnlocked && this.#attachedOwners.size === 0 &&
                (wasAttached || hadGrant)) {
              this.#barrier('last-client-detached', link);
            }
          }
          return { status: 'detached' };
        }
        if (request.command === 'workspace-root-proof') {
          requireOwner();
          this.#assertWorkspace();
          const proof = this.#options.workspaceFence?.proof();
          if (!proof) throw notAllowed();
          return { status: 'root-proof', tag: proof.tag, generation: proof.generation, trustTag: proof.trustTag };
        }
        if (request.command === 'custody-membership') {
          requireOwner();
          this.#assertWorkspace();
          return {
            status: 'membership',
            unlocked: this.#options.holder.isUnlocked,
            attachedOwners: this.#attachedOwners.size,
            epoch: this.#grantEpoch,
          };
        }
        if (request.command === 'desktop-activity-mode') {
          requireOwner();
          this.#assertWorkspace();
          if (this.#attachedOwners.has(session)) throw notAllowed();
          requireNativeActivity();
          return { status: 'native' };
        }
        if (request.command === 'desktop-activity') {
          requireOwner();
          this.#assertWorkspace();
          if (!isNativeActivity() || !this.#attachedOwners.has(session) || !this.#options.holder.isUnlocked) {
            throw notAllowed();
          }
          this.#options.holder.touch();
          return { status: 'recorded' };
        }
        // Binding a session is what a spawner is admitted for; every other command is the owner's.
        if (request.command === 'attach') {
          this.#assertWorkspace();
          const result = session.bind(request.fields['mode']);
          if (isOwner && result.status === 'attached') {
            this.#attachedOwners.add(session);
            driving = request.fields['mode'] === 'drive';
          }
          return { ...result };
        }
        requireOwner();
        this.#assertWorkspace();
        if (isOwnerControlAct(request.command)) this.#options.holder.touch();
        return answerOf(context, request);
      },
      closed: () => {
        // No queued grant may install keys after this transport disappears.
        const safeDetach = detached;
        detached = true;
        this.#links.delete(link);
        this.#spawnerSessions.delete(session);
        const wasAttached = this.#attachedOwners.delete(session);
        const hadGrant = this.#grantOwners.delete(session);
        try {
          if (!safeDetach && grantEpoch === this.#grantEpoch && (driving || hadGrant)) this.#barrier('fault');
          // A status/proof link is not a read lease. The last attached owner leaves before
          // host cleanup, so a slow release cannot keep read keys open.
          if (grantEpoch === this.#grantEpoch && this.#options.holder.isUnlocked && this.#attachedOwners.size === 0 &&
              (wasAttached || this.#grantOwners.size === 0)) {
            this.#barrier('last-client-detached');
          }
          session.end();
        } finally {
          this.#ownerSessions.delete(session);
          if (link.standing === 'spawner') this.#emit('spawner-dropped');
        }
      },
    };
  }

  #sessionsOf(link: IAdmittedRuntimeLink, session: LinkSession, grantEpoch: number): IOwnerLinkSessions {
    const requireCurrent = (): void => {
      if (grantEpoch !== this.#grantEpoch) {
        throw new OwnerRequestRefusedError('stale-epoch', 'This owner link was retired by a runtime lock.');
      }
    };
    return {
      question: (sessionId) => {
        requireCurrent();
        this.#assertWorkspace();
        if (link.standing !== 'owner') throw notAllowed();
        return session.question(sessionId);
      },
      cancelQuestion: () => {
        requireCurrent();
        this.#assertWorkspace();
        if (link.standing !== 'owner') throw notAllowed();
        session.cancelQuestion();
      },
      openAccepted: (bindingId, sessionId, digest, questionId) => {
        requireCurrent();
        this.#assertWorkspace();
        if (link.standing !== 'owner') throw notAllowed();
        return session.openAccepted(bindingId, sessionId, digest, questionId);
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
    // Certification ends every spawner's session authority before callbacks or another frame can run.
    for (const session of this.#spawnerSessions) session.revoke();
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
