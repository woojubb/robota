/**
 * Zod schemas and TypeScript types for Robota CLI settings
 */
import { z } from 'zod';

import type { THooksConfig } from '@robota-sdk/agent-core';
import type { TUniversalValue } from '@robota-sdk/agent-core';

const UniversalValueSchema: z.ZodType<TUniversalValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.undefined(),
    z.date(),
    z.array(UniversalValueSchema),
    z.record(UniversalValueSchema),
  ]),
);

const ProviderSchema = z.object({
  name: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  timeout: z.number().optional(),
  options: z.record(UniversalValueSchema).optional(),
});

const ProviderProfileSchema = z.object({
  type: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  timeout: z.number().optional(),
  options: z.record(UniversalValueSchema).optional(),
});

const PermissionsSchema = z.object({
  /** Patterns that are always approved without prompting */
  allow: z.array(z.string()).optional(),
  /** Patterns that are always denied */
  deny: z.array(z.string()).optional(),
  /** Patterns that always ask, in every mode including bypassPermissions */
  ask: z.array(z.string()).optional(),
});

const EnvSchema = z.record(z.string()).optional();

/** Command hook definition */
const CommandHookDefinitionSchema = z.object({
  type: z.literal('command'),
  command: z.string(),
  timeout: z.number().optional(),
});

/** HTTP hook definition */
const HttpHookDefinitionSchema = z.object({
  type: z.literal('http'),
  url: z.string(),
  headers: z.record(z.string()).optional(),
  timeout: z.number().optional(),
});

/** Prompt hook definition */
const PromptHookDefinitionSchema = z.object({
  type: z.literal('prompt'),
  prompt: z.string(),
  model: z.string().optional(),
});

/** Agent hook definition */
const AgentHookDefinitionSchema = z.object({
  type: z.literal('agent'),
  agent: z.string(),
  maxTurns: z.number().optional(),
  timeout: z.number().optional(),
});

/** SELFHOST-005: guardrail hook — runs the registered guardrail set (by name, or all) in parallel. */
const GuardrailHookDefinitionSchema = z.object({
  type: z.literal('guardrail'),
  guardrails: z.array(z.string()).optional(),
});

/** Discriminated union of all hook definition types */
const HookDefinitionSchema = z.discriminatedUnion('type', [
  CommandHookDefinitionSchema,
  HttpHookDefinitionSchema,
  PromptHookDefinitionSchema,
  AgentHookDefinitionSchema,
  GuardrailHookDefinitionSchema,
]);

const HookGroupSchema = z.object({
  /**
   * Optional identity, so a hook group can be REFERRED TO — which is what `disabledHooks` needs
   * (issue #2320). Optional so every settings file already in the wild stays valid; a group without
   * an id simply cannot be disabled from another layer.
   */
  id: z.string().optional(),
  matcher: z.string(),
  hooks: z.array(HookDefinitionSchema),
});

/**
 * Supported hook events — every member of agent-core's `THookEvent`, and kept that way by
 * `config/__tests__/hooks-schema-event-parity.test.ts` (issue #2430). A `z.object` STRIPS keys it
 * does not name, so an event missing here is not refused, it is silently discarded at settings load:
 * a `hooks.PermissionDecision` command hook never fired while the `permissions` block beside it in
 * the same file took effect, in every mode.
 */
/** Exported for the plugin loader's inspection (OBSERVABILITY-1991); the schema stays owned here. */
export const HooksSchema = z
  .object({
    PreToolUse: z.array(HookGroupSchema).optional(),
    PostToolUse: z.array(HookGroupSchema).optional(),
    SessionStart: z.array(HookGroupSchema).optional(),
    SessionEnd: z.array(HookGroupSchema).optional(),
    Stop: z.array(HookGroupSchema).optional(),
    StopFailure: z.array(HookGroupSchema).optional(),
    PreCompact: z.array(HookGroupSchema).optional(),
    PostCompact: z.array(HookGroupSchema).optional(),
    UserPromptSubmit: z.array(HookGroupSchema).optional(),
    SubagentStart: z.array(HookGroupSchema).optional(),
    SubagentStop: z.array(HookGroupSchema).optional(),
    WorktreeCreate: z.array(HookGroupSchema).optional(),
    WorktreeRemove: z.array(HookGroupSchema).optional(),
    PreModelCall: z.array(HookGroupSchema).optional(),
    PostModelCall: z.array(HookGroupSchema).optional(),
    PermissionDecision: z.array(HookGroupSchema).optional(),
  })
  .optional();

/** Plugin enablement map: plugin name -> enabled flag */
const EnabledPluginsSchema = z.record(z.boolean()).optional();

/** Extra marketplace sources: name -> { source: TMarketplaceSource } */
const MarketplaceSourceSchema = z.object({
  source: z.object({
    type: z.enum(['github', 'git', 'local', 'url']),
    repo: z.string().optional(),
    url: z.string().optional(),
    path: z.string().optional(),
    ref: z.string().optional(),
  }),
});
const ExtraKnownMarketplacesSchema = z.record(MarketplaceSourceSchema).optional().catch(undefined);
const AutoCompactThresholdSchema = z.union([z.number().gt(0).lte(1), z.literal(false)]).optional();

const TransportSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  options: z.record(UniversalValueSchema).optional(),
});

const SandboxSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  /** A confined command runs without a prompt; deny and ask rules still apply first. */
  autoAllowBashIfSandboxed: z.boolean().optional(),
  /** Commands (first word) that run unconfined, through the ordinary permission path. */
  excludedCommands: z.array(z.string()).optional(),
  /** Refuse to start when sandboxing is enabled but cannot run here, instead of running unconfined. */
  failIfUnavailable: z.boolean().optional(),
  filesystem: z
    .object({
      allowWrite: z.array(z.string()).optional(),
      denyRead: z.array(z.string()).optional(),
    })
    .optional(),
  network: z.object({ enabled: z.boolean().optional() }).optional(),
});

const PeerSettingsSchema = z.object({
  /**
   * Offer write and execute tools to a turn driven by another session on this host. Every such use
   * still asks the operator. Off by default: a peer turn only reads inside the workspace.
   */
  allowChanges: z.boolean().optional(),
});

export const SettingsSchema = z.object({
  /** Trust level used when no --permission-mode flag is given */
  defaultTrustLevel: z.enum(['safe', 'moderate', 'full']).optional(),
  /** Response language (e.g., "ko", "en", "ja"). Injected into system prompt. */
  language: z.string().optional(),
  /** Selected preset id (overridden by --preset). */
  preset: z.string().optional(),
  /** Active provider profile key from providers. */
  currentProvider: z.string().optional(),
  /** Provider profiles keyed by user-facing profile name. */
  providers: z.record(ProviderProfileSchema).optional(),
  /** Legacy single-provider settings. Prefer currentProvider + providers for new config. */
  provider: ProviderSchema.optional(),
  permissions: PermissionsSchema.optional(),
  env: EnvSchema,
  hooks: HooksSchema,
  /**
   * Hook-group ids this layer turns off (issue #2320). Applies only to groups declared by LATER
   * (lower-trust) layers — a user layer may disable a project hook; a project layer can never
   * disable a user's guard. See `mergeSettings`.
   */
  disabledHooks: z.array(z.string()).optional(),
  /** Plugin enablement map: plugin name -> enabled/disabled */
  enabledPlugins: EnabledPluginsSchema,
  /** Extra marketplace URLs for BundlePlugin discovery */
  extraKnownMarketplaces: ExtraKnownMarketplacesSchema,
  /** Auto-compact threshold as a 0-1 fraction. Set false to disable automatic compaction. */
  autoCompactThreshold: AutoCompactThresholdSchema,
  /** Transport enable/disable + options: transport name -> config */
  transports: z.record(TransportSettingsSchema).optional(),
  /** OS-level confinement of shell commands (bubblewrap on Linux, Seatbelt on macOS). */
  sandbox: SandboxSettingsSchema.optional(),
  /** What a turn driven by another agent session may do. */
  peers: PeerSettingsSchema.optional(),
  /** NEUT-004: host-selected active-task context root and optional enablement. */
  taskContext: z
    .object({
      enabled: z.boolean().optional(),
      dir: z.string().min(1).optional(),
    })
    .optional(),
});

export type TSettings = z.infer<typeof SettingsSchema>;
export type TProviderSettings = z.infer<typeof ProviderSchema>;
export type TPermissionsSettings = z.infer<typeof PermissionsSchema>;

/**
 * SEC-009: a settings object AFTER `$ENV:` resolution. `apiKeyEnv` — the name of the variable
 * `apiKey` was resolved from — is DERIVED during loading, never written by a user, which is why it
 * is absent from the schemas above: declaring it there would document an input key that is really
 * an output.
 *
 * It is declared as a type rather than left implicit because the resolution step produced the field
 * and the resolution PIPELINE then dropped it: `resolveActiveProviderProfile` builds
 * `IResolvedConfig['provider']` field by field, so a field nothing in the type system knew about was
 * silently not copied, and the credential origin never reached the caller that needs it.
 */
export type TEnvResolvedProviderProfile = z.infer<typeof ProviderProfileSchema> & {
  apiKeyEnv?: string;
};

export type TEnvResolvedSettings = Omit<TSettings, 'provider' | 'providers'> & {
  provider?: TProviderSettings & { apiKeyEnv?: string };
  providers?: Record<string, TEnvResolvedProviderProfile>;
};

/**
 * Fully resolved config after merging all settings files and applying defaults.
 */
export interface IResolvedConfig {
  defaultTrustLevel: 'safe' | 'moderate' | 'full';
  /** Response language code (e.g., "ko", "en"). Undefined = no language constraint. */
  language?: string;
  /** Active provider profile key when providers/currentProvider are used. */
  currentProvider?: string;
  provider: {
    name: string;
    model: string;
    apiKey: string | undefined;
    /**
     * Name of the environment variable `apiKey` was resolved FROM, when the stored value was a
     * `$ENV:` reference (SEC-009). Present so a caller that must SERIALIZE this config can carry
     * the reference and leave the resolved secret behind.
     */
    apiKeyEnv?: string;
    baseURL?: string;
    timeout?: number;
    options?: Record<string, TUniversalValue>;
  };
  permissions: {
    allow: string[];
    deny: string[];
    /** Patterns that always ask, in every mode including bypassPermissions (issue #3081). */
    ask?: string[];
  };
  env: Record<string, string>;
  hooks?: THooksConfig;
  /** Plugin enablement map: plugin name -> enabled/disabled */
  enabledPlugins?: Record<string, boolean>;
  /** Extra marketplace sources: name -> { source } */
  extraKnownMarketplaces?: Record<
    string,
    { source: { type: string; repo?: string; url?: string; path?: string; ref?: string } }
  >;
  /** Auto-compact threshold as a 0-1 fraction. Set false to disable automatic compaction. */
  autoCompactThreshold?: number | false;
  /** Transport enable/disable + options: transport name -> { enabled, options } */
  transports?: Record<string, { enabled?: boolean; options?: Record<string, unknown> }>;
  /**
   * NEUT-004: active-task context selection. A directory is required to scan; omitted
   * directories do not fall back to a framework-owned path. `enabled: false` disables it.
   */
  taskContext?: { enabled?: boolean; dir?: string };
  sandbox?: TSandboxSettings;
  /** What a turn driven by another agent session may do. */
  peers?: { allowChanges?: boolean };
}

export type TSandboxSettings = z.infer<typeof SandboxSettingsSchema>;
