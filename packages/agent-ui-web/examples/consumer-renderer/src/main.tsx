import {
  ProductIdentityProvider,
  SessionSurface,
  rememberSessionForRestore,
  resolveClientRuntimeHost,
  useWsSession,
  type IClientRuntimeBridge,
  type IClientRuntimeHost,
  type IClientTrustQuestion,
  type TClientTrustChoice,
} from '@robota-sdk/agent-ui-web/client';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import './main.css';

declare global {
  interface Window {
    cedarBridge?: IClientRuntimeBridge;
  }
}

const product = {
  identity: { displayName: 'Cedar Agent', cliName: 'cedar' },
  storage: { browserNamespace: 'cedar.agent' },
} as const;

const host = resolveClientRuntimeHost({
  bridge: window.cedarBridge,
  document,
  location,
});

function Session({ endpoint }: { endpoint: string }): React.ReactElement {
  const state = useWsSession(endpoint);
  const { openSettings } = state;
  useEffect(() => {
    if (state.status === 'connected') host.signalReady();
  }, [state.status]);
  useEffect(() => host.onOpenSettings(openSettings), [openSettings]);

  const reconnect = host.restartRuntime
    ? async (): Promise<void> => {
        const sessionId = state.sessionListing?.currentSessionId;
        if (sessionId) rememberSessionForRestore(product.storage.browserNamespace, sessionId);
        await host.restartRuntime?.();
      }
    : undefined;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-end border-b border-border bg-card px-4 py-2">
        <button
          type="button"
          onClick={() => state.send({ type: 'command', name: 'cedar-review', args: '' })}
          disabled={state.status !== 'connected'}
          className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
        >
          Cedar review
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <SessionSurface
          state={state}
          surface="app"
          onReconnect={reconnect}
          pickFiles={host.pickFiles}
          getPathForFile={host.getPathForFile}
          onOpenMemoryInEditor={host.openMemoryInEditor}
        />
      </div>
    </div>
  );
}

function Trust({ question, onAnswer }: {
  question: IClientTrustQuestion;
  onAnswer: (choice: TClientTrustChoice) => void;
}): React.ReactElement {
  return (
    <main className="agent-ui flex h-full flex-col items-center justify-center gap-4 bg-background text-foreground">
      <h1>Trust this folder?</h1>
      <p>{question.folder}</p>
      <ul>{question.loads.map((load) => <li key={load}>{load}</li>)}</ul>
      <div className="flex gap-2">
        <button onClick={() => onAnswer('trust')}>Trust</button>
        <button onClick={() => onAnswer('restricted')}>Restricted</button>
        <button onClick={() => onAnswer('quit')}>Quit</button>
      </div>
    </main>
  );
}

function App({ runtime }: { runtime: IClientRuntimeHost }): React.ReactElement {
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [trust, setTrust] = useState<IClientTrustQuestion | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const unsubscribe = runtime.onState((status, detail) => {
      if (status === 'fatal') setFatal(detail || 'The agent process stopped.');
    });
    void (async () => {
      try {
        const question = await runtime.trustQuestion?.();
        if (!active) return;
        if (question) { setTrust(question); return; }
        setEndpoint(await runtime.getEndpoint());
      } catch (error) {
        if (active) setFatal(String(error));
      }
    })();
    return () => { active = false; unsubscribe(); };
  }, [runtime]);

  async function answerTrust(choice: TClientTrustChoice): Promise<void> {
    try {
      const result = await runtime.answerTrust?.(choice);
      if (result?.error) { setFatal(result.error); return; }
      if (choice === 'quit') return;
      setTrust(null);
      setEndpoint(await runtime.getEndpoint());
    } catch (error) {
      setFatal(String(error));
    }
  }

  if (fatal) return <main className="agent-ui p-6" role="alert">{fatal}</main>;
  if (trust) return <Trust question={trust} onAnswer={(choice) => { void answerTrust(choice); }} />;
  if (!endpoint) return <main className="agent-ui p-6">Starting Cedar Agent…</main>;
  return <Session endpoint={endpoint} />;
}

createRoot(document.getElementById('root')!).render(
  <ProductIdentityProvider value={product}><App runtime={host} /></ProductIdentityProvider>,
);
