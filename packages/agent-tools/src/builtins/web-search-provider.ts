/**
 * NEUT-008: web-search provider port.
 *
 * Mirrors the retrieval/computer-use port precedent (`IRetrievalAdapter`, `IComputerDriver`):
 * the duck-typed port lives in `agent-tools` and `createWebSearchTool({ provider })` composes
 * over it. The vendor-specific default adapter (`./brave-search-provider.ts`) implements this
 * port and is the only place a vendor endpoint may live — the TOOL layer holds no vendor
 * literals.
 */

/** One web search result entry (the tool serializes these verbatim for the model). */
export interface IWebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

/** A search request: the query plus the maximum number of results the caller wants. */
export interface IWebSearchQuery {
  query: string;
  /** Requested maximum result count; a provider may cap it lower (vendor API limits). */
  limit: number;
}

/**
 * The web-search provider port. Implementations resolve their own credentials/endpoint and
 * THROW on failure (missing configuration, HTTP error, network error) — the tool layer converts
 * the thrown message into a structured `IToolInvocationResult` error.
 */
export interface IWebSearchProvider {
  search(request: IWebSearchQuery, signal?: AbortSignal): Promise<IWebSearchResultItem[]>;
}

/** Options for `createWebSearchTool`: inject a provider (default: the Brave Search adapter). */
export interface IWebSearchToolProviderOptions {
  provider?: IWebSearchProvider;
}
