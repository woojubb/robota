/**
 * A thin terminal client for a session this terminal is attached to over the session protocol.
 *
 * It renders what the protocol carries and sends what the user types; the session owns everything
 * else. Leaving — `/exit`, `/quit`, Ctrl-C or Ctrl-] — only detaches: nothing is sent to the session,
 * so its turn continues and it keeps running. An observer is read-only and never sees a question it
 * could not answer.
 */

import { Box, render, useInput, useStdout } from 'ink';
import React, { useEffect, useRef, useState } from 'react';

import { Text } from './SafeText.js';

import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport/client';

export interface IAttachedSessionConnection {
  send(message: TClientMessage): void;
  subscribe(listener: (message: TServerMessage) => void): () => void;
  onClose(listener: () => void): () => void;
}

export type TAttachedSessionEnd = 'user' | 'closed';

export interface IAttachedSessionViewProps {
  readonly connection: IAttachedSessionConnection;
  readonly mode: 'drive' | 'observe';
  readonly sessionLabel: string;
  readonly driverId: string;
  readonly onDetach: (reason: TAttachedSessionEnd) => void;
}

type TLine = { readonly key: number; readonly text: string };
type TPrompt =
  | { readonly kind: 'permission'; readonly id: string; readonly toolName: string }
  | {
      readonly kind: 'ask';
      readonly id: string;
      readonly request: Extract<TServerMessage, { type: 'ask_request' }>['event']['request'];
    };

const MAX_LINES = 500;
const DETACH_KEY = '\x1d';

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string'
          ? part.text
          : '',
      )
      .filter((text) => text !== '')
      .join('\n');
  }
  return '';
}

function messageLine(message: unknown): string | undefined {
  if (typeof message !== 'object' || message === null || !('role' in message)) return undefined;
  const text = textOf('content' in message ? message.content : undefined);
  if (text === '') return undefined;
  if (message.role === 'user') return `› ${text}`;
  if (message.role === 'assistant') return text;
  return undefined;
}

function other(driverId: string | undefined, self: string): string {
  return driverId !== undefined && driverId !== self ? ` (${driverId})` : '';
}

export default function AttachedSessionView({
  connection,
  mode,
  sessionLabel,
  driverId,
  onDetach,
}: IAttachedSessionViewProps): React.ReactElement {
  const { stdout } = useStdout();
  const [label, setLabel] = useState(sessionLabel);
  const [lines, setLines] = useState<readonly TLine[]>([]);
  const [streaming, setStreaming] = useState('');
  const [working, setWorking] = useState(false);
  const [queued, setQueued] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<TPrompt | undefined>();
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState<string | undefined>();
  const nextKey = useRef(0);
  const detached = useRef(false);
  const streamed = useRef('');
  const promptRef = useRef<TPrompt | undefined>(undefined);

  // Every change of the open question goes through here. What was typed for a question belongs to
  // it: when that question is settled elsewhere or replaced, the typing is dropped in the same
  // update, so a masked answer is never shown in clear or sent as an ordinary prompt.
  const changePrompt = (next: TPrompt | undefined): void => {
    const previous = promptRef.current;
    if (previous?.kind === 'ask' && next?.id !== previous.id) setInput('');
    if (next?.kind === 'ask' && next.id !== previous?.id) setInput('');
    promptRef.current = next;
    setPrompt(next);
  };

  const detach = (reason: TAttachedSessionEnd): void => {
    if (detached.current) return;
    detached.current = true;
    onDetach(reason);
  };
  const append = (...texts: string[]): void => {
    setLines((current) =>
      [...current, ...texts.map((text) => ({ key: (nextKey.current += 1), text }))].slice(-MAX_LINES),
    );
  };

  useEffect(() => {
    const unsubscribe = connection.subscribe((message) => {
      switch (message.type) {
        case 'messages': {
          const snapshot = message.messages
            .map(messageLine)
            .filter((line): line is string => line !== undefined);
          setLines(snapshot.slice(-MAX_LINES).map((text) => ({ key: (nextKey.current += 1), text })));
          break;
        }
        case 'user_message':
          append(`› ${message.content}${other(message.driverId, driverId)}`);
          break;
        case 'text_delta':
          streamed.current += message.delta;
          setStreaming(streamed.current);
          break;
        case 'complete':
        case 'interrupted': {
          const text = streamed.current !== '' ? streamed.current : message.result.response;
          streamed.current = '';
          setStreaming('');
          if (text !== '') append(text);
          if (message.type === 'interrupted') append('(interrupted)');
          break;
        }
        case 'tool_start':
          append(`⏺ ${message.state.toolName} ${message.state.firstArg}`.trimEnd());
          break;
        case 'tool_end':
          append(`  ${message.state.toolName} ${message.state.result ?? 'done'}`);
          break;
        case 'thinking':
          setWorking(message.isThinking);
          break;
        case 'executing':
          setWorking(message.executing);
          break;
        case 'pending':
          setQueued(message.pending);
          break;
        case 'error':
          streamed.current = '';
          setStreaming('');
          append(`Error: ${message.message}`);
          break;
        case 'command_result':
          if (message.message !== '') append(message.message);
          break;
        case 'permission_request':
          if (mode === 'drive') {
            changePrompt({ kind: 'permission', id: message.event.id, toolName: message.event.toolName });
          }
          break;
        case 'ask_request':
          if (mode === 'drive') {
            changePrompt({ kind: 'ask', id: message.event.id, request: message.event.request });
          }
          break;
        case 'prompt_resolved':
          if (promptRef.current?.id === message.event.id) changePrompt(undefined);
          if (message.event.answererDriverId !== undefined && message.event.answererDriverId !== driverId) {
            setNotice(`A question was answered by ${message.event.answererDriverId}.`);
          }
          break;
        case 'ui_intent':
          setNotice('That command opens a screen an attached terminal cannot show.');
          break;
        case 'session_renamed':
          setLabel(message.event.name);
          break;
        case 'history_cleared':
          setLines([]);
          break;
        case 'protocol_error':
          setNotice(message.message);
          break;
        default:
          break;
      }
    });
    const unclose = connection.onClose(() => detach('closed'));
    // Snapshot first, then live: what happened before this terminal arrived, then what follows.
    for (const type of ['get-messages', 'get-context', 'get-executing', 'get-pending'] as const) {
      connection.send({ type });
    }
    return () => {
      unsubscribe();
      unclose();
    };
    // The connection is fixed for the view's life.
  }, [connection]);

  const answerAsk = (current: Extract<TPrompt, { kind: 'ask' }>): void => {
    const options = current.request.options ?? [];
    const text = input.trim();
    if (options.length > 0) {
      const picks = text.split(/[\s,]+/u).filter((part) => part !== '').map(Number);
      const values = picks.every((pick) => Number.isInteger(pick) && pick >= 1 && pick <= options.length)
        ? [...new Set(picks)].map((pick) => options[pick - 1]!.value)
        : undefined;
      const min = current.request.minSelect ?? 1;
      const max = current.request.maxSelect ?? 1;
      if (values !== undefined && values.length >= min && values.length <= max) {
        connection.send({ type: 'ask-response', id: current.id, response: { type: 'answer', values } });
      } else if (current.request.allowFreeText === true && text !== '') {
        connection.send({ type: 'ask-response', id: current.id, response: { type: 'answer', values: [], text } });
      } else {
        setNotice(`Choose ${max > 1 ? 'numbers' : 'a number'} from 1 to ${options.length}.`);
        return;
      }
    } else {
      if (text === '' && current.request.allowEmpty !== true) return;
      connection.send({ type: 'ask-response', id: current.id, response: { type: 'answer', values: [], text: input } });
    }
    changePrompt(undefined);
  };

  const submit = (): void => {
    const text = input.trim();
    setInput('');
    if (text === '') return;
    if (text.startsWith('/')) {
      const [name = '', ...rest] = text.slice(1).split(/\s+/u);
      // In a shared session `/exit` would end it for everyone, whatever its arguments; here it only
      // takes this terminal away.
      if (name === 'exit' || name === 'quit') {
        detach('user');
        return;
      }
      connection.send({ type: 'command', name, args: rest.join(' ') });
      return;
    }
    connection.send({ type: 'submit', prompt: text });
  };

  useInput((typed, key) => {
    if (typed === DETACH_KEY || (key.ctrl && (typed === ']' || typed === 'c'))) {
      detach('user');
      return;
    }
    if (mode === 'observe') {
      if (typed === 'q') detach('user');
      return;
    }
    if (prompt?.kind === 'permission') {
      const answer = typed === 'y' ? true : typed === 'n' || key.escape ? false : typed === 'a' ? 'allow-session' : undefined;
      if (answer !== undefined) {
        connection.send({ type: 'permission-response', id: prompt.id, result: answer });
        changePrompt(undefined);
      }
      return;
    }
    if (prompt?.kind === 'ask' && key.escape) {
      connection.send({ type: 'ask-response', id: prompt.id, response: { type: 'cancelled' } });
      changePrompt(undefined);
      return;
    }
    if (key.return) {
      if (prompt?.kind === 'ask') answerAsk(prompt);
      else submit();
      return;
    }
    if (key.backspace || key.delete) {
      setInput((current) => Array.from(current).slice(0, -1).join(''));
      return;
    }
    if (!key.ctrl && !key.meta && typed !== '') setInput((current) => current + typed);
  });

  const height = Math.max(8, stdout.rows ?? 24);
  const visible = lines.slice(-Math.max(1, height - 8));
  const maskedAsk = prompt?.kind === 'ask' && prompt.request.masked === true;
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        {mode === 'drive' ? `Attached to ${label} — drive` : `Observing ${label} — read only`}
      </Text>
      {visible.map((line) => (
        <Text key={line.key}>{line.text}</Text>
      ))}
      {streaming !== '' && <Text>{streaming}</Text>}
      {working && <Text>Working…</Text>}
      {queued !== null && <Text>Queued: {queued}</Text>}
      {notice !== undefined && <Text>{notice}</Text>}
      {prompt?.kind === 'permission' && (
        <Text>Allow {prompt.toolName}? y yes / n no / a allow for this session</Text>
      )}
      {prompt?.kind === 'ask' && (
        <>
          <Text>{prompt.request.title}</Text>
          {(prompt.request.options ?? []).map((option, index) => (
            <Text key={option.value}>
              {index + 1}. {option.label}
            </Text>
          ))}
        </>
      )}
      {mode === 'drive' && (
        <Text>› {maskedAsk ? '*'.repeat(Array.from(input).length) : input}</Text>
      )}
      <Text wrap="truncate-end">
        {mode === 'drive'
          ? 'Enter send · /exit, Ctrl-C or Ctrl-] detach (the session keeps running)'
          : 'Read only · q, Ctrl-C or Ctrl-] detach (the session keeps running)'}
      </Text>
    </Box>
  );
}

/** Render the attached view until the user detaches or the session closes the connection. */
export async function renderAttachedSessionView(
  options: Omit<IAttachedSessionViewProps, 'onDetach'>,
): Promise<TAttachedSessionEnd> {
  let ended: TAttachedSessionEnd = 'user';
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const instance = render(
    <AttachedSessionView
      {...options}
      onDetach={(reason) => {
        ended = reason;
        finish();
      }}
    />,
    { exitOnCtrlC: false },
  );
  try {
    await Promise.race([done, instance.waitUntilExit()]);
  } finally {
    instance.unmount();
  }
  return ended;
}
