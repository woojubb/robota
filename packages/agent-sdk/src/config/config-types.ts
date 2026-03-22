/**
 * Zod schemas and TypeScript types for Robota CLI settings
 */
import { z } from 'zod';
import type { THooksConfig } from '@robota-sdk/agent-core';

const ProviderSchema = z.object({
  name: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
});

const PermissionsSchema = z.object({
  /** Patterns that are always approved without prompting */
  allow: z.array(z.string()).optional(),
  /** Patterns that are always denied */
  deny: z.array(z.string()).optional(),
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

/** Discriminated union of all hook definition types */
const HookDefinitionSchema = z.discriminatedUnion('type', [
  CommandHookDefinitionSchema,
  HttpHookDefinitionSchema,
  PromptHookDefinitionSchema,
  AgentHookDefinitionSchema,
]);

const HookGroupSchema = z.object({
  matcher: z.string(),
  hooks: z.array(HookDefinitionSchema),
});

/** All Phase 1 hook events */
const HooksSchema = z
  .object({
    PreToolUse: z.array(HookGroupSchema).optional(),
    PostToolUse: z.array(HookGroupSchema).optional(),
    SessionStart: z.array(HookGroupSchema).optional(),
    Stop: z.array(HookGroupSchema).optional(),
    PreCompact: z.array(HookGroupSchema).optional(),
    PostCompact: z.array(HookGroupSchema).optional(),
    UserPromptSubmit: z.array(HookGroupSchema).optional(),
    Notification: z.array(HookGroupSchema).optional(),
  })
  .optional();

/** Plugin enablement map: plugin name -> enabled flag */
const EnabledPluginsSchema = z.record(z.boolean()).optional();

/** Extra marketplace sources: name -> { source: IMarketplaceSource } */
const MarketplaceSourceSchema = z.object({
  source: z.object({
    type: z.enum(['github', 'git', 'local', 'url']),
    repo: z.string().optional(),
    url: z.string().optional(),
    path: z.string().optional(),
    ref: z.string().optional(),
  }),
});
const ExtraKnownMarketplacesSchema = z.record(MarketplaceSourceSchema).optional();

export const SettingsSchema = z.object({
  /** Trust level used when no --permission-mode flag is given */
  defaultTrustLevel: z.enum(['safe', 'moderate', 'full']).optional(),
  /** Response language (e.g., "ko", "en", "ja"). Injected into system prompt. */
  language: z.string().optional(),
  provider: ProviderSchema.optional(),
  permissions: PermissionsSchema.optional(),
  env: EnvSchema,
  hooks: HooksSchema,
  /** Plugin enablement map: plugin name -> enabled/disabled */
  enabledPlugins: EnabledPluginsSchema,
  /** Extra marketplace URLs for BundlePlugin discovery */
  extraKnownMarketplaces: ExtraKnownMarketplacesSchema,
});

export type TSettings = z.infer<typeof SettingsSchema>;
export type TProviderSettings = z.infer<typeof ProviderSchema>;
export type TPermissionsSettings = z.infer<typeof PermissionsSchema>;

/**
 * Fully resolved config after merging all settings files and applying defaults.
 */
export interface IResolvedConfig {
  defaultTrustLevel: 'safe' | 'moderate' | 'full';
  /** Response language code (e.g., "ko", "en"). Undefined = no language constraint. */
  language?: string;
  provider: {
    name: string;
    model: string;
    apiKey: string | undefined;
  };
  permissions: {
    allow: string[];
    deny: string[];
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
}
