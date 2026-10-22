import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport';

export type TAppView = Extract<TServerMessage, { type: 'app_view' }>['view'];

export type TAppToolOutcome = Omit<
  Extract<TServerMessage, { type: 'app_tool_result' }>,
  'type' | 'requestId'
>;

export type TAppToolArguments = Extract<TClientMessage, { type: 'call-app-tool' }>['arguments'];

export type TAppToolPart = NonNullable<TAppToolOutcome['parts']>[number];
