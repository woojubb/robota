'use client';

import React, { useRef, useEffect, useLayoutEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Globe,
  LoaderCircle,
  Pencil,
  Search,
  SquareTerminal,
  Wrench,
} from 'lucide-react';

import type {
  IActiveTool,
  ICommandOutputEntry,
  TConversationEntry,
} from '../hooks/useSessionClient.js';

interface IConversationViewProps {
  messages: readonly TConversationEntry[];
  activeTools: IActiveTool[];
  streamingText: string;
  isThinking: boolean;
}

/** Agent markdown, set as reading prose: headings step down gently, code sits on its own quiet surface. */
function AgentMarkdown({ children }: { children: string }): React.ReactElement {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children: c }) => (
          <h1 className="mt-6 text-[20px] font-semibold leading-snug tracking-[-0.015em] first:mt-0">
            {c}
          </h1>
        ),
        h2: ({ children: c }) => (
          <h2 className="mt-6 text-[17px] font-semibold leading-snug tracking-[-0.01em] first:mt-0">
            {c}
          </h2>
        ),
        h3: ({ children: c }) => (
          <h3 className="mt-5 text-[15px] font-semibold leading-snug first:mt-0">{c}</h3>
        ),
        p: ({ children: c }) => <p>{c}</p>,
        pre: ({ children: c }) => (
          <pre className="overflow-x-auto rounded-xl bg-sidebar px-4 py-3.5 font-mono text-[13px] leading-[1.65]">
            {c}
          </pre>
        ),
        code: ({ className, children: c }) => {
          const isBlock = Boolean(className);
          return isBlock ? (
            <code className={`font-mono ${className ?? ''}`}>{c}</code>
          ) : (
            <code className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[0.85em]">{c}</code>
          );
        },
        ul: ({ children: c }) => (
          <ul className="ml-5 list-outside list-disc space-y-1.5 marker:text-subtle">{c}</ul>
        ),
        ol: ({ children: c }) => (
          <ol className="ml-5 list-outside list-decimal space-y-1.5 marker:text-subtle">{c}</ol>
        ),
        li: ({ children: c }) => <li className="pl-1">{c}</li>,
        strong: ({ children: c }) => <strong className="font-semibold">{c}</strong>,
        em: ({ children: c }) => <em className="italic">{c}</em>,
        a: ({ href, children: c }) => (
          <a
            href={href}
            className="text-accent underline decoration-accent/40 underline-offset-[3px] hover:decoration-accent"
            target="_blank"
            rel="noopener noreferrer"
          >
            {c}
          </a>
        ),
        table: ({ children: c }) => (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">{c}</table>
          </div>
        ),
        thead: ({ children: c }) => <thead>{c}</thead>,
        th: ({ children: c }) => (
          <th className="border-b border-border px-3 py-2 text-left text-[13px] font-medium text-muted-foreground">
            {c}
          </th>
        ),
        td: ({ children: c }) => <td className="px-3 py-2 align-top">{c}</td>,
        blockquote: ({ children: c }) => (
          <blockquote className="border-l-2 border-subtle/50 pl-4 text-muted-foreground">
            {c}
          </blockquote>
        ),
        hr: () => <hr className="mx-auto my-7 w-12 border-subtle/40" />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

/** Shorten a driver id for a compact co-drive attribution chip (device ids are long SHA-256 hashes). */
function shortDriver(author: string): string {
  return author.length > 12 ? `${author.slice(0, 8)}…` : author;
}

function UserBlock({ content, author }: { content: string; author?: string }): React.ReactElement {
  // REMOTE-014 E5 (display-only, OWNER PRINCIPLE): show WHO drove this turn when it wasn't the local owner.
  const coDriver = author && author !== 'owner' ? author : undefined;
  return (
    <div className="flex flex-col items-end gap-1.5 pl-12">
      {coDriver && (
        <span className="px-1 text-[12.5px] text-subtle">from {shortDriver(coDriver)}</span>
      )}
      <div className="max-w-full whitespace-pre-wrap break-words rounded-[20px] bg-raised px-4 py-2.5 text-[15px] leading-relaxed text-foreground">
        {content}
      </div>
    </div>
  );
}

function AgentBlock({
  content,
  isStreaming = false,
}: {
  content: string;
  isStreaming?: boolean;
}): React.ReactElement {
  return (
    <div className="gui-prose">
      <AgentMarkdown>{content}</AgentMarkdown>
      {isStreaming && (
        <span className="ml-1 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-foreground/70 align-middle" />
      )}
    </div>
  );
}

/** A recognisable glyph for the common tools; anything else is a wrench. */
function ToolIcon({ name, className }: { name: string; className?: string }): React.ReactElement {
  const key = name.toLowerCase();
  const props = { size: 15, strokeWidth: 1.75, className };
  if (/(read|view|cat|open)/u.test(key)) return <FileText {...props} />;
  if (/(grep|glob|search|find|list|ls)/u.test(key)) return <Search {...props} />;
  if (/(edit|write|patch|replace|create)/u.test(key)) return <Pencil {...props} />;
  if (/(bash|shell|exec|run|command|terminal)/u.test(key)) return <SquareTerminal {...props} />;
  if (/(web|fetch|http|url|browse)/u.test(key)) return <Globe {...props} />;
  if (/(agent|task|delegate)/u.test(key)) return <Bot {...props} />;
  return <Wrench {...props} />;
}

function ToolCard({ tool }: { tool: IActiveTool }): React.ReactElement {
  const running = tool.status === 'running';
  const failed = tool.status === 'error';
  return (
    <div className="flex min-w-0 items-center gap-2.5 py-1 text-[14px]">
      <ToolIcon
        name={tool.name}
        className={`flex-shrink-0 ${failed ? 'text-destructive' : 'text-subtle'}`}
      />
      <span
        className={`flex-shrink-0 font-medium ${
          running ? 'gui-shimmer' : failed ? 'text-destructive' : 'text-muted-foreground'
        }`}
      >
        {tool.name}
      </span>
      {typeof tool.input === 'string' && tool.input && (
        <span className="min-w-0 truncate font-mono text-[12.5px] text-subtle">{tool.input}</span>
      )}
      <span className="ml-auto flex flex-shrink-0 items-center text-[12.5px] text-subtle">
        {running ? (
          <LoaderCircle size={14} className="animate-spin" aria-label="running" />
        ) : failed ? (
          <span className="text-destructive">failed</span>
        ) : (
          <Check size={14} aria-label="done" />
        )}
      </span>
    </div>
  );
}

/**
 * Command output taller than this starts folded, so one reply never buries the conversation. Lines
 * count where layout cannot be measured; a rendered card also folds on its measured height, because
 * a few long wrapped lines are as tall as many short ones.
 */
const COMMAND_FOLD_LINES = 12;
const COMMAND_FOLD_HEIGHT_PX = 280;

const COMMAND_TONE: Record<ICommandOutputEntry['tone'], { dot: string; text: string }> = {
  success: { dot: 'bg-accent', text: 'text-foreground/90' },
  error: { dot: 'bg-destructive', text: 'text-destructive' },
  info: { dot: 'bg-subtle', text: 'text-muted-foreground' },
};

/** A slash command's outcome, where it was typed: monospace, line breaks kept, long output folded. */
function CommandCard({ entry }: { entry: ICommandOutputEntry }): React.ReactElement {
  const lines = entry.content.split('\n');
  const bodyRef = useRef<HTMLPreElement>(null);
  const [tall, setTall] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body) setTall(body.scrollHeight > COMMAND_FOLD_HEIGHT_PX);
  }, [entry.content]);
  const byLines = lines.length > COMMAND_FOLD_LINES;
  const foldable = byLines || tall;
  const folded = foldable && !open;
  const shown = folded && byLines ? lines.slice(0, COMMAND_FOLD_LINES).join('\n') : entry.content;
  const tone = COMMAND_TONE[entry.tone];
  return (
    <div
      data-testid="command-output"
      data-tone={entry.tone}
      className="overflow-hidden rounded-xl bg-card"
    >
      <div className="flex items-center gap-2 px-4 pt-3 text-[13px]">
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        <span className="font-mono font-medium text-foreground">/{entry.name}</span>
      </div>
      <div className="relative">
        <pre
          ref={bodyRef}
          style={folded ? { maxHeight: COMMAND_FOLD_HEIGHT_PX } : undefined}
          className={`overflow-hidden whitespace-pre-wrap break-words px-4 pb-3 pt-1.5 font-mono text-[13px] leading-[1.65] ${tone.text}`}
        >
          {shown}
        </pre>
        {folded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" />
        )}
      </div>
      {foldable && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-1.5 px-4 pb-2.5 pt-1 text-left text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <ChevronDown size={14} className={open ? 'rotate-180' : ''} />
          {open ? 'Show less' : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

/** One line per finished turn's tool calls; the calls themselves open on demand. */
function ToolGroup({ tools }: { tools: readonly IActiveTool[] }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const failed = tools.filter((tool) => tool.status === 'error').length;
  const names = [...new Set(tools.map((tool) => tool.name))].join(', ');
  return (
    <div className="text-[14px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group -mx-2 flex max-w-full items-center gap-2.5 rounded-lg px-2 py-1 text-left text-muted-foreground hover:bg-hover hover:text-foreground"
      >
        <Wrench size={15} strokeWidth={1.75} className="flex-shrink-0 text-subtle" />
        <span className="flex-shrink-0">
          {tools.length} tool {tools.length === 1 ? 'call' : 'calls'}
        </span>
        <span className="min-w-0 truncate text-subtle">{names}</span>
        {failed > 0 && (
          <span className="flex-shrink-0 rounded-md bg-destructive/12 px-1.5 text-[12.5px] text-destructive">
            {failed} failed
          </span>
        )}
        <ChevronRight
          size={14}
          className={`flex-shrink-0 text-subtle transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && (
        <div className="mt-0.5 flex flex-col pl-[25px]">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThinkingIndicator(): React.ReactElement {
  return <p className="gui-shimmer w-fit text-[15px] font-medium">Thinking…</p>;
}

export function ConversationView({
  messages,
  activeTools,
  streamingText,
  isThinking,
}: IConversationViewProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText, isThinking, activeTools.length]);

  const isEmpty =
    messages.length === 0 && !isThinking && activeTools.length === 0 && !streamingText;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-6 pb-6 pt-8">
        {isEmpty && (
          <div className="flex h-full items-center justify-center">
            <p className="text-[14px] text-subtle">No messages yet</p>
          </div>
        )}

        {messages.map((entry) => {
          switch (entry.role) {
            case 'user':
              return <UserBlock key={entry.id} content={entry.content} author={entry.author} />;
            case 'assistant':
              return <AgentBlock key={entry.id} content={entry.content} />;
            case 'command':
              return <CommandCard key={entry.id} entry={entry} />;
            case 'tools':
              return <ToolGroup key={entry.id} tools={entry.tools} />;
          }
        })}

        {isThinking && !streamingText && <ThinkingIndicator />}

        {activeTools.length > 0 && (
          <div className="flex flex-col">
            {activeTools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}

        {streamingText && <AgentBlock content={streamingText} isStreaming />}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}
