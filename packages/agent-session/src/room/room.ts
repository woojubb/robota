/**
 * Room — shared-transcript multi-agent primitive (ROOM-001).
 *
 * Design: the shared transcript is a core `ConversationStore` (append-only rule applies;
 * speaker attribution rides `metadata.speaker`). Each turn the room renders the transcript
 * into a conversation log and passes it as the speaking agent's run input — the reference
 * pattern the speech project hand-rolled (reconstruct context per call), made first-class.
 */

import { ConversationStore } from '@robota-sdk/agent-core';

import type {
  IRoomMember,
  IRoomOptions,
  IRoomRunOptions,
  IRoomTranscriptEntry,
  IRoomView,
} from './types.js';

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_TRANSCRIPT_MESSAGES = 1000;

export class Room {
  private readonly members = new Map<string, IRoomMember>();
  private readonly store: ConversationStore;
  private readonly entries: IRoomTranscriptEntry[] = [];
  private readonly topic: string | undefined;
  private running = false;

  constructor(options: IRoomOptions = {}) {
    this.topic = options.topic;
    this.store = new ConversationStore(
      options.maxTranscriptMessages ?? DEFAULT_MAX_TRANSCRIPT_MESSAGES,
    );
  }

  /** Add a participant. Names are unique — joining an existing name is an error. */
  join(member: IRoomMember): void {
    if (this.members.has(member.name)) {
      throw new Error(`Room: member "${member.name}" already joined`);
    }
    this.members.set(member.name, member);
  }

  /** Remove a participant. The transcript keeps their past turns (append-only). */
  leave(name: string): void {
    if (!this.members.delete(name)) {
      throw new Error(`Room: member "${name}" is not in the room`);
    }
  }

  getMembers(): string[] {
    return Array.from(this.members.keys());
  }

  /** Attributed transcript so far (copy). */
  getTranscript(): IRoomTranscriptEntry[] {
    return [...this.entries];
  }

  /** The underlying append-only store messages (id/timestamp/metadata.speaker). */
  getTranscriptMessages() {
    return this.store.getMessages();
  }

  private view(): IRoomView {
    return {
      transcript: [...this.entries],
      members: this.getMembers(),
      turnCount: this.entries.length,
    };
  }

  /**
   * Run the sequential turn loop: selector picks a speaker (or `null` to end), the speaker's
   * agent runs on the rendered transcript, and the response is committed to the shared
   * transcript with speaker attribution. Turns are strictly sequential by construction.
   */
  async run(options: IRoomRunOptions): Promise<IRoomTranscriptEntry[]> {
    if (this.running) {
      throw new Error('Room: run() is already in progress on this room');
    }
    this.running = true;
    try {
      const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
      for (let turn = 0; turn < maxTurns; turn++) {
        if (options.signal?.aborted) break;
        const speaker = await options.selector.next(this.view());
        if (speaker === null) break;
        const member = this.members.get(speaker);
        if (!member) {
          throw new Error(
            `Room: selector picked unknown speaker "${speaker}" (members: ${this.getMembers().join(', ')})`,
          );
        }
        const content = await member.agent.run(this.renderTurnInput(member), {
          ...(options.signal && { signal: options.signal }),
        });
        const entry = this.commitTurn(member.name, content);
        options.onTurn?.(entry);
      }
      return this.getTranscript();
    } finally {
      this.running = false;
    }
  }

  /** Append an externally-produced turn (e.g. a human message) to the shared transcript. */
  say(speaker: string, content: string): IRoomTranscriptEntry {
    return this.commitTurn(speaker, content);
  }

  private commitTurn(speaker: string, content: string): IRoomTranscriptEntry {
    this.store.addAssistantMessage(content, [], { speaker });
    const messages = this.store.getMessages();
    const message = messages[messages.length - 1];
    const entry: IRoomTranscriptEntry = { speaker, content, message };
    this.entries.push(entry);
    return entry;
  }

  /** Render the shared transcript into the speaking agent's turn input. */
  private renderTurnInput(member: IRoomMember): string {
    const lines: string[] = [];
    lines.push(`You are "${member.name}" in a multi-party conversation.`);
    if (member.persona) lines.push(member.persona);
    if (this.topic) lines.push(`Topic: ${this.topic}`);
    lines.push('');
    if (this.entries.length === 0) {
      lines.push('The conversation has not started yet — you speak first.');
    } else {
      lines.push('Conversation so far:');
      for (const entry of this.entries) {
        lines.push(`${entry.speaker}: ${entry.content}`);
      }
    }
    lines.push('');
    lines.push(
      `Respond with your next contribution as "${member.name}". Reply with the message content only — no name prefix.`,
    );
    return lines.join('\n');
  }
}
