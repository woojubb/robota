// Command host-effect contracts — SSOT relocated to @robota-sdk/agent-interface-transport (DATA-001).
// CMD-004 Phase 2: the split contract (host actions / UI intents) is re-exported alongside the
// deprecated legacy union during the staged migration.
export type {
  TCommandEffect,
  TCommandHostAction,
  TCommandUiIntent,
} from '@robota-sdk/agent-interface-transport';
