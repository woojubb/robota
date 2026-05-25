export interface IOrgPolicy {
  /** Allowed provider profile names. Undefined = all allowed. */
  allowedProviders?: string[];
  /** Slash command names blocked by policy (without leading slash). */
  blockedCommands?: string[];
  /** If true, API keys must be stored as env references ($ENV:VAR), not plaintext. */
  requireApiKeyFromEnv?: boolean;
  /** Shown in policy violation messages so users know who to contact. */
  adminContact?: string;
}
