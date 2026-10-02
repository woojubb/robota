import type { IUniversalObjectValue } from '@robota-sdk/agent-core';
import type { IMCPResponseCacheHint, IMCPServerIdentity } from '../catalog/types.js';

export interface IMCPSkillResource {
  readonly uri: string;
  readonly digest: string;
  readonly size: number;
}

/** A server-scoped manifest; reading it does not approve or activate its instructions. */
export interface IMCPSkillEntry {
  readonly identity: IMCPServerIdentity;
  readonly uri: string;
  readonly frontmatter: IUniversalObjectValue & {
    readonly name: string;
    readonly description: string;
  };
  readonly resources: readonly IMCPSkillResource[] | 'dynamic';
  readonly manifestFingerprint: string;
}

export interface IMCPSkillRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface IMCPVerifiedSkillResource {
  readonly uri: string;
  readonly digest: string;
  readonly size: number;
  readonly text?: string;
  readonly blob?: string;
  readonly mimeType?: string;
  readonly cacheHint: IMCPResponseCacheHint;
}

export interface IMCPSkillsSession {
  /** Bounded complete pagination; metadata only, with no eager file reads or activation. */
  list(
    options: IMCPSkillRequestOptions & { readonly maxPages: number },
  ): Promise<readonly IMCPSkillEntry[]>;
  /** Confirm a URI even if the server's listing was partial or empty. */
  get(uri: string, options?: IMCPSkillRequestOptions): Promise<IMCPSkillEntry>;
  /** Read one file against the current observed manifest; no resource URI is fetched outside MCP. */
  read(
    entry: IMCPSkillEntry,
    uri: string,
    options?: IMCPSkillRequestOptions,
  ): Promise<IMCPVerifiedSkillResource>;
}
