import type { RTCDataChannel } from 'werift';

interface IWebRtcDeliveryLifecycleOptions {
  readonly cleanup: () => void;
  readonly onDropped: () => void;
  readonly onDeliveryError: (error: Error, event: string) => void;
}

/** Owns carrier-drop state so delivery failures cannot leak into committed session operations. */
export class WebRtcDeliveryLifecycle {
  private generation = 0;
  private paired = false;
  private dropped = false;

  constructor(private readonly options: IWebRtcDeliveryLifecycleOptions) {}

  reset(generation: number): void {
    this.generation = generation;
    this.paired = false;
    this.dropped = false;
  }

  accept(generation: number): void {
    if (generation === this.generation) this.paired = true;
  }

  handleDrop(generation: number): void {
    if (generation !== this.generation || !this.paired || this.dropped) return;
    this.dropped = true;
    this.options.cleanup();
    this.options.onDropped();
  }

  handleFailure(channel: RTCDataChannel, generation: number, error: Error, event: string): void {
    if (generation !== this.generation || this.dropped) return;
    const notifyDrop = this.paired;
    if (notifyDrop) this.dropped = true;
    try {
      this.options.onDeliveryError(error, event);
    } catch {
      // Observer failure cannot interrupt carrier cleanup or a committed session operation.
    }
    this.options.cleanup();
    try {
      channel.close();
    } catch {
      // already closing/closed
    }
    if (notifyDrop) this.options.onDropped();
  }
}
