import {
  createTuiSessionEventNotice,
  type ITuiSessionEventNotice,
  type TTuiNoticeInput,
} from './tui-session-events.js';

import type { TInteractiveEventName } from '@robota-sdk/agent-interface-session';

const NOTICE_LIMIT = 50;

/** Bounded append-only render projection, deliberately separate from canonical session history. */
export class TuiSessionNoticeStore {
  private sequence = 0;
  readonly notices: ITuiSessionEventNotice[] = [];

  add(input: TTuiNoticeInput): void {
    this.append(createTuiSessionEventNotice(this.nextId(), input));
  }

  addDeliveryError(error: Error, event: TInteractiveEventName): void {
    this.append({
      id: this.nextId(),
      event: 'delivery-error',
      message: `Session event delivery failed (${event}): ${error.message}`,
    });
  }

  private nextId(): string {
    this.sequence += 1;
    return `session-event-${this.sequence}`;
  }

  private append(notice: ITuiSessionEventNotice): void {
    this.notices.push(notice);
    const overflow = this.notices.length - NOTICE_LIMIT;
    if (overflow > 0) this.notices.splice(0, overflow);
  }
}
