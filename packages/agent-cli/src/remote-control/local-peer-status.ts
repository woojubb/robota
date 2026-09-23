import type { ILocalPeerPresence } from './local-peer-presence.js';

type TActivityStatus = 'working' | 'needs-input' | 'idle' | undefined;

interface IObservedChannel {
  readonly isActiveForPeerStatus: boolean;
  getSession(): { getLocalActivityStatus(): TActivityStatus };
}

/** A passive snapshot reader: never becomes a permission/ask answering surface. */
export function bindLocalPeerStatus(
  presence: Pick<ILocalPeerPresence, 'publishStatus'>,
  channel: IObservedChannel,
  report: (message: string) => void = (message) => process.emitWarning(message),
): () => void {
  let lastStatus: TActivityStatus;
  let reportedFailure = false;
  const publish = (status: TActivityStatus): void => {
    if (status === lastStatus) return;
    try {
      presence.publishStatus(status);
      lastStatus = status;
      reportedFailure = false;
    } catch (error) {
      if (reportedFailure) return;
      reportedFailure = true;
      report(`Local peer activity publication failed: ${String(error)}`);
    }
  };
  const sample = (): void => {
    if (!channel.isActiveForPeerStatus) {
      publish(undefined);
      return;
    }
    try {
      publish(channel.getSession().getLocalActivityStatus());
    } catch (error) {
      publish(undefined);
      if (reportedFailure) return;
      reportedFailure = true;
      report(`Local peer activity observation failed: ${String(error)}`);
    }
  };
  sample();
  const timer = setInterval(sample, 250);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    try {
      presence.publishStatus(undefined);
    } catch (error) {
      report(`Local peer activity reset failed: ${String(error)}`);
    }
  };
}
