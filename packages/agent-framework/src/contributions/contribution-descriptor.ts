/** A declarative host contract. Supported format and source identity never confer execution authority. */
export interface IContributionDescriptor {
  readonly schemaVersion: 1;
  readonly identity: string;
  readonly installedRevision: string;
  readonly generation: string;
  readonly source: { readonly kind: 'bundle' | 'mcp' | 'skill'; readonly location: string };
  readonly requiredCapabilities: readonly string[];
  readonly contributions: readonly {
    readonly identity: string;
    readonly kind: 'command' | 'skill' | 'hook' | 'agent' | 'mcp';
    readonly source: string;
    readonly requiredCapabilities: readonly string[];
    readonly disposition: 'supported' | 'unavailable' | 'unsupported';
    readonly reason?: string;
  }[];
  readonly lifecycle: {
    readonly activation: 'unadmitted' | 'disabled';
    readonly activeCalls: 'host-owned';
  };
  readonly diagnostics: readonly { readonly component: string; readonly code: string }[];
}
