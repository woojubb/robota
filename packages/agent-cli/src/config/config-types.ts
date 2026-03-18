/**
 * Zod schemas and TypeScript types for Robota CLI settings
 */
import { z } from 'zod';

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

/** Phase 2 placeholder — hooks are not implemented yet */
const HooksSchema = z.record(z.unknown()).optional();

export const SettingsSchema = z.object({
  /** Trust level used when no --permission-mode flag is given */
  defaultTrustLevel: z.enum(['safe', 'moderate', 'full']).optional(),
  provider: ProviderSchema.optional(),
  permissions: PermissionsSchema.optional(),
  env: EnvSchema,
  hooks: HooksSchema,
});

export type TSettings = z.infer<typeof SettingsSchema>;
export type TProviderSettings = z.infer<typeof ProviderSchema>;
export type TPermissionsSettings = z.infer<typeof PermissionsSchema>;

/**
 * Fully resolved config after merging all settings files and applying defaults.
 */
export interface IResolvedConfig {
  defaultTrustLevel: 'safe' | 'moderate' | 'full';
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
}
