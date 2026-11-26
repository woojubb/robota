/**
 * One live connection to an ACP agent: the byte streams its standard input and output carry, and
 * how to end it. The adapter never starts a process itself; whatever runs the agent sits behind
 * this port.
 */
export interface AcpConnection {
  /** Bytes sent to the agent, as newline-delimited JSON. */
  readonly toAgent: WritableStream<Uint8Array>;
  /** Bytes the agent sends back, as newline-delimited JSON. */
  readonly fromAgent: ReadableStream<Uint8Array>;
  /** Ends the connection and whatever runs behind it. Safe to call more than once. */
  close(): Promise<void>;
}

/** Yields a fresh connection to an agent, one for each participant session the roundtable opens. */
export interface AcpLauncher {
  launch(context: { conversationId: string; participantId: string }): Promise<AcpConnection>;
}
