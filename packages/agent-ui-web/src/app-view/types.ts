import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport';

/**
 * The document a finished call's source declared, as the server answers `read-app-view`. Taken from
 * the wire type so this package needs no dependency on the core package that owns the shape.
 */
export type TAppView = Extract<TServerMessage, { type: 'app_view' }>['view'];

/** What a tool call made for a view came to (`app_tool_result`), without its correlation id. */
export type TAppToolOutcome = Omit<
  Extract<TServerMessage, { type: 'app_tool_result' }>,
  'type' | 'requestId'
>;

/** The arguments a view passes to a tool, in the shape `call-app-tool` carries them. */
export type TAppToolArguments = Extract<TClientMessage, { type: 'call-app-tool' }>['arguments'];

/** One observation of a tool result, as the wire carries it. */
export type TAppToolPart = NonNullable<TAppToolOutcome['parts']>[number];
