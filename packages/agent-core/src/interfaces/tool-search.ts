/**
 * Tool search vocabulary (CLI-1990) — the client-side residency contract.
 *
 * A tool schema may declare `deferLoading` (`IToolSchema`); when the policy engages, such a schema
 * is WITHHELD from the request entirely until it is loaded — by the model calling the search tool,
 * or by a `toolChoice` that forces the tool. This is stronger than the vendor feature it is named
 * after: `defer_loading` keeps a definition out of the context window while the request still
 * carries it, whereas here the schema leaves the request. Every provider gets the same behaviour,
 * because the model-visible artifact is an ordinary function tool and the catalog is ours.
 *
 * The full contract is agent-core `docs/SPEC.md` § Tool Residency and Tool Search.
 */

import type { IToolSchema } from './tool-schema';

/**
 * The registered name of the model-facing search tool.
 *
 * Owned here rather than in the package that ships the tool because the execution layer names it in
 * the unknown-tool remedy — the message that tells a model which tool loads the one it just called.
 * agent-tools registers its builtin under this name.
 */
export const TOOL_SEARCH_TOOL_NAME = 'ToolSearch';

/**
 * `IAgentConfig.toolSearch`. `'auto'` (the default) engages deferral by threshold —
 * `resolveToolSearchMode` — so ten resident tools cost nothing; `'on'` / `'off'` force the answer.
 */
export type TToolSearchSetting = 'auto' | 'on' | 'off';

/** The resolved answer: whether deferred schemas are withheld from the model's tool list. */
export type TToolSearchMode = 'on' | 'off';

/**
 * The catalog a search tool loads through — the port `IToolExecutionContext.deferredTools` carries.
 *
 * Narrow on purpose: a tool that can list and load must not be able to register, remove or execute.
 */
export interface IDeferredToolCatalog {
  /**
   * Deferred tools not yet loaded — the population a search can still discover. Empty while
   * deferral is not engaged, because nothing is withheld then.
   */
  listDeferredTools(): IToolSchema[];
  /**
   * Mark the named deferred tools loaded for the rest of the session and return their schemas. A
   * resident name is returned as it is (it was never withheld); an unknown name throws, naming the
   * entry, and then nothing is loaded — the check runs over every name before the first load.
   */
  loadDeferredTools(names: readonly string[]): IToolSchema[];
}
