import {
  createAccessTokenVerifier,
  parsePublicHttpsUrl,
} from '@robota-sdk/agent-transport/node';
import type { IAccessTokenVerifierDeps } from '@robota-sdk/agent-transport/node';
import type {
  HostedOrganizationControl,
  IHostedOrganizationWorker,
} from '../hosted-organization-control.js';

export interface IDesktopBinding {
  readonly id: string;
  readonly user: string;
  readonly client: string;
  readonly session: string;
  readonly worker: IHostedOrganizationWorker;
}
export class DesktopRefused extends Error {
  constructor(readonly reason: string) {
    super(`Remote desktop refused: ${reason}`);
  }
}
export interface IDesktopProof {
  readonly binding: IDesktopBinding;
  readonly jti: string;
  readonly expiresAt: number;
  readonly credentialExpiresAt: number;
}
export interface IDesktopAuthorizationOptions {
  readonly publicUrl: string;
  readonly issuer: string;
  readonly control: HostedOrganizationControl;
  /** Owner-selected identities and sessions, never a caller's registry. */
  readonly bindings: readonly IDesktopBinding[];
  readonly verifierDeps?: IAccessTokenVerifierDeps;
  readonly now?: () => number;
}
export function desktopBindingKey(binding: IDesktopBinding): string {
  return JSON.stringify([
    binding.id,
    binding.user,
    binding.client,
    binding.session,
    binding.worker.resource,
    binding.worker.grantId,
    binding.worker.epoch,
    binding.worker.identity.tenant,
    binding.worker.identity.task,
    binding.worker.identity.rootTask,
    binding.worker.identity.actor,
    binding.worker.identity.runtime,
  ]);
}
/** A freshly verified issuer credential still needs current company authority and exact session ownership. */
export class HostedDesktopAuthorization {
  readonly url: URL;
  private readonly now: () => number;
  private readonly bindings: readonly IDesktopBinding[];
  constructor(private readonly options: IDesktopAuthorizationOptions) {
    this.url = parsePublicHttpsUrl(options.publicUrl, 'Desktop runtime');
    parsePublicHttpsUrl(options.issuer, 'Desktop issuer');
    this.now = options.now ?? Date.now;
    this.bindings = options.bindings.map((binding) => {
      const copy = structuredClone(binding);
      Object.freeze(copy.worker.identity);
      Object.freeze(copy.worker);
      return Object.freeze(copy);
    });
    if (
      options.bindings.length === 0 ||
      options.bindings.length > 100 ||
      options.bindings.some((binding) =>
        [binding.id, binding.user, binding.client, binding.session].some(
          (value) =>
            typeof value !== 'string' ||
            value.length === 0 ||
            value.length > 256 ||
            /[\r\n]/u.test(value),
        ),
      ) ||
      new Set(options.bindings.map((binding) => binding.id)).size !== options.bindings.length
    )
      throw new DesktopRefused('owner-bindings');
  }
  binding(id: string): IDesktopBinding {
    const binding = this.bindings.find((entry) => entry.id === id);
    if (!binding) throw new DesktopRefused('owner-binding');
    return binding;
  }
  async verify(
    token: string,
    binding: IDesktopBinding,
    operator = false,
    signal?: AbortSignal,
  ): Promise<IDesktopProof> {
    signal?.throwIfAborted();
    if (!this.bindings.some((entry) => desktopBindingKey(entry) === desktopBindingKey(binding)))
      throw new DesktopRefused('owner-binding');
    // Pairing and readiness do not extend stale issuer keys during an outage.
    const verifier = createAccessTokenVerifier(
      {
        issuer: this.options.issuer,
        resource: operator ? `${this.url.href.replace(/\/$/u, '')}/approval` : this.url.href,
        algorithms: ['EdDSA', 'ES256', 'RS256'],
        allowedSubjects: [binding.user],
        requiredScopes: operator ? ['desktop:approve'] : ['desktop:pair', 'desktop:drive'],
      },
      this.options.verifierDeps,
    );
    const verdict = await verifier.verify(token);
    if (!verdict.admitted) throw new DesktopRefused(verdict.refusal);
    // Decode only AFTER signature/issuer/audience/subject/scope verification.
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    const now = this.now();
    if (
      typeof claims.iat !== 'number' ||
      !Number.isSafeInteger(claims.iat) ||
      typeof claims.exp !== 'number' ||
      !Number.isSafeInteger(claims.exp) ||
      claims.iat * 1000 > now ||
      claims.exp * 1000 <= now ||
      claims.exp - claims.iat > 120 ||
      (claims.nbf !== undefined &&
        (typeof claims.nbf !== 'number' ||
          !Number.isSafeInteger(claims.nbf) ||
          claims.nbf * 1000 > now)) ||
      typeof claims.jti !== 'string' ||
      !/^[A-Za-z0-9_-]{8,256}$/u.test(claims.jti)
    )
      throw new DesktopRefused('short-lived-credential');
    if (
      claims.sub !== binding.user ||
      claims.client_id !== binding.client ||
      claims.tenant !== binding.worker.identity.tenant ||
      claims.task !== binding.worker.identity.task ||
      claims.session !== binding.session ||
      claims.workload !== binding.worker.identity.runtime ||
      claims.epoch !== binding.worker.epoch
    )
      throw new DesktopRefused('session-ownership');
    signal?.throwIfAborted();
    const grant = await this.options.control.admit(binding.worker, signal);
    signal?.throwIfAborted();
    return {
      binding,
      jti: claims.jti,
      credentialExpiresAt: claims.exp * 1000,
      expiresAt: Math.min(claims.exp * 1000, grant.expiresAt, now + 60_000),
    };
  }
  async current(binding: IDesktopBinding, signal?: AbortSignal): Promise<void> {
    if (!this.bindings.some((entry) => desktopBindingKey(entry) === desktopBindingKey(binding)))
      throw new DesktopRefused('owner-binding');
    await this.options.control.admit(binding.worker, signal);
  }
}
