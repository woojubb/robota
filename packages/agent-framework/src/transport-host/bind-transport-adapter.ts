import type {
  ITransportSettingsCapability,
  ITransportRunnerAdapter,
  TBoundConfigurableTransport,
  TBoundTransportAdapter,
  TTransportAdapter,
} from '@robota-sdk/agent-interface-transport';

/** Bind the exact session port outside the registry while preserving configure-before-attach. */
export function bindTransportAdapter<TSession, TAdapter extends TTransportAdapter<TSession>>(
  adapter: TAdapter,
  session: TSession,
): TAdapter extends ITransportSettingsCapability
  ? TBoundConfigurableTransport
  : TBoundTransportAdapter {
  const base = {
    binding: 'bound' as const,
    name: adapter.name,
    async start(): Promise<void> {
      adapter.attach(session);
      await adapter.start();
    },
    stop: () => adapter.stop(),
  };
  const bound: TBoundTransportAdapter =
    adapter.lifecycle.kind === 'runner'
      ? {
          ...base,
          lifecycle: adapter.lifecycle,
          waitForCompletion: () =>
            (adapter as ITransportRunnerAdapter<TSession>).waitForCompletion(),
        }
      : { ...base, lifecycle: adapter.lifecycle };

  if ('defaultEnabled' in adapter && typeof adapter.defaultEnabled === 'boolean') {
    const configurable = adapter as TTransportAdapter<TSession> & ITransportSettingsCapability;
    return Object.assign(bound, {
      defaultEnabled: configurable.defaultEnabled,
      ...(configurable.optionsSchema ? { optionsSchema: configurable.optionsSchema } : {}),
      ...(configurable.validateOptions
        ? { validateOptions: (options: Record<string, unknown>) => configurable.validateOptions!(options) }
        : {}),
      ...(configurable.configure
        ? { configure: (options: Record<string, unknown>) => configurable.configure!(options) }
        : {}),
    }) as TAdapter extends ITransportSettingsCapability
      ? TBoundConfigurableTransport
      : TBoundTransportAdapter;
  }
  return bound as TAdapter extends ITransportSettingsCapability
    ? TBoundConfigurableTransport
    : TBoundTransportAdapter;
}
