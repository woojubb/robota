import {
  CenteredChrome,
  SessionSurface,
  rememberSessionForRestore,
  useWsSession,
} from '@robota-sdk/agent-ui-web/client';
import { useEffect, useState } from 'react';

import type { IGuiHost, IGuiTrustQuestion, TGuiTrustChoice } from './gui-host.js';

/**
 * The GUI compose-root: a thin binding over the GUI presentation core (`@robota-sdk/agent-ui-web`). It
 * owns NO session/command/permission logic — the sidecar owns everything below the wire, and the host
 * (desktop bridge or browser page) only says where that sidecar is.
 */

/**
 * Connect to the sidecar over WS and render the shared session surface. `SessionSurface` shows its own
 * connection-lost banner (issue #3280 §5) from `state.connectionLost` — this component's only job is
 * the host-specific `onReconnect` action: present only when the host can restart the runtime (desktop),
 * and remembering the session to switch back to once the restart's reload reconnects.
 */
function SessionView({ url, host }: { url: string; host: IGuiHost }): React.ReactElement {
  const state = useWsSession(url);
  useEffect(() => {
    if (state.status === 'connected') host.signalReady();
  }, [state.status, host]);
  const restart = host.restartRuntime;
  const currentSessionId = state.sessionListing?.currentSessionId ?? null;
  const onReconnect = restart
    ? async (): Promise<void> => {
        if (currentSessionId) rememberSessionForRestore(currentSessionId);
        await restart();
      }
    : undefined;
  return (
    <SessionSurface
      state={state}
      surface={host.kind === 'desktop' ? 'app' : 'web'}
      personalUsageEnabled
      onReconnect={onReconnect}
    />
  );
}

const TRUST_BUTTON =
  'rounded-lg px-4 py-2 text-[14px] font-medium disabled:opacity-60 focus-visible:outline focus-visible:outline-2';

/**
 * The runtime never started (or stopped for good before a session was ever live) — the reason the
 * host reported, in plain words, and a Try again that reuses the exact same restart flow the
 * connection-lost banner's Reconnect uses (issue #3282 §3): ask the CLI again, reload once it answers.
 */
function FatalDetail({
  detail,
  retry,
}: {
  detail?: string;
  retry?: () => Promise<void>;
}): React.ReactElement {
  const [retrying, setRetrying] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const tryAgain = (): void => {
    if (!retry) return;
    setRetrying(true);
    setFailed(null);
    retry().catch((error: unknown) => {
      setRetrying(false);
      setFailed(error instanceof Error ? error.message : String(error));
    });
  };
  return (
    <>
      {detail ? (
        <>
          The agent process stopped:
          <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-card p-4 text-left font-mono text-[12.5px] leading-relaxed text-muted-foreground">
            {detail}
          </pre>
        </>
      ) : (
        'The agent process stopped. Personal Usage is unavailable.'
      )}
      {retry ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={tryAgain}
            disabled={retrying}
            className="rounded-lg bg-primary px-4 py-2 text-[14px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {retrying ? 'Trying again…' : 'Try again'}
          </button>
        </div>
      ) : (
        <p className="mt-3">Restart the app to reconnect.</p>
      )}
      {failed ? <p className="mt-3 text-[13px] text-destructive">{failed}</p> : null}
    </>
  );
}

/**
 * The folder is not trusted yet (issue #3268): nothing has started. Trusting it lets the session load
 * the project's own configuration; Restricted starts without it; Quit closes the app.
 */
function TrustQuestion({
  question,
  answer,
}: {
  question: IGuiTrustQuestion;
  answer: (choice: TGuiTrustChoice) => Promise<{ error?: string }>;
}): React.ReactElement {
  const [answering, setAnswering] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const choose = (choice: TGuiTrustChoice): void => {
    setAnswering(true);
    setFailed(null);
    answer(choice).then(
      (result) => {
        // On success the host reloads the page; an error keeps the question up with the reason.
        if (result.error !== undefined) {
          setAnswering(false);
          setFailed(result.error);
        }
      },
      (error: unknown) => {
        setAnswering(false);
        setFailed(error instanceof Error ? error.message : String(error));
      },
    );
  };
  return (
    <div role="dialog" aria-labelledby="trust-title" className="flex h-full flex-col">
      <CenteredChrome tone="muted">
        <h1 id="trust-title" className="text-[16px] font-medium text-foreground">
          Do you trust this folder?
        </h1>
        <p className="mt-2 break-all font-mono text-[13px] text-foreground">{question.folder}</p>
        <p className="mt-3">
          Trusting this folder lets Robota use the project&apos;s own settings, hooks, skills and MCP
          servers. Restricted starts without them.
        </p>
        {/* #3282 §3: a row appears only when its state is known (never "[unavailable]" noise), and
            the list is closed by default — the sentence above is the answer for most people. */}
        {question.loads.length > 0 ? (
          <details className="mt-4 text-left">
            <summary className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground">
              Details
            </summary>
            <pre
              aria-label="What trust would load"
              className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-card p-4 font-mono text-[12px] leading-relaxed text-muted-foreground"
            >
              {question.loads.join('\n')}
            </pre>
          </details>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => choose('trust')}
            disabled={answering}
            className={`${TRUST_BUTTON} bg-primary text-primary-foreground hover:opacity-90`}
          >
            Trust folder
          </button>
          <button
            type="button"
            onClick={() => choose('restricted')}
            disabled={answering}
            className={`${TRUST_BUTTON} bg-card text-foreground hover:opacity-90`}
          >
            Start Restricted
          </button>
          <button
            type="button"
            onClick={() => choose('quit')}
            disabled={answering}
            className={`${TRUST_BUTTON} text-muted-foreground hover:text-foreground`}
          >
            Quit
          </button>
        </div>
        {failed ? (
          <p role="alert" className="mt-3 whitespace-pre-wrap text-[13px] text-destructive">
            {failed}
          </p>
        ) : null}
      </CenteredChrome>
    </div>
  );
}

/** Resolve the endpoint from the host, watch for a fatal sidecar state, then mount. */
export function App({ host }: { host: IGuiHost }): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  // `detail` is what the sidecar said before it stopped — the reason, and often the fix.
  const [fatal, setFatal] = useState<{ detail?: string } | null>(null);
  // Asked before the endpoint: in a folder not trusted yet the host starts nothing until the answer.
  const [trust, setTrust] = useState<IGuiTrustQuestion | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = host.onState((state, detail) => {
      if (state === 'fatal') setFatal(detail ? { detail } : {});
    });
    void (async () => {
      const question = (await host.trustQuestion?.()) ?? null;
      if (cancelled) return;
      if (question) {
        setTrust(question);
        return;
      }
      const endpoint = await host.getEndpoint();
      if (!cancelled) setUrl(endpoint);
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [host]);

  if (fatal) {
    return (
      <div role="alert" className="flex h-full flex-col">
        <CenteredChrome tone="fatal">
          <FatalDetail detail={fatal.detail} retry={host.restartRuntime} />
        </CenteredChrome>
      </div>
    );
  }
  if (trust && host.answerTrust) {
    return <TrustQuestion question={trust} answer={host.answerTrust} />;
  }
  if (!url) {
    return <CenteredChrome tone="muted">Starting the agent…</CenteredChrome>;
  }
  // A lost connection (issue #3280 §5) is shown by `SessionSurface` itself, above the conversation —
  // never a full-screen replacement — so it is not a branch here.
  return <SessionView url={url} host={host} />;
}
