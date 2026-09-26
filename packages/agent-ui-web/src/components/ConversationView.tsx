'use client';

import React, { useRef, useEffect, useLayoutEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

function AgentMarkdown({ children }: { children: string }): React.ReactElement {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children: c }) => (
          <h1 className="text-base font-bold mt-4 mb-2 text-foreground border-b border-border/50 pb-1.5">
            {c}
          </h1>
        ),
        h2: ({ children: c }) => (
          <h2 className="text-sm font-semibold mt-3 mb-1.5 text-foreground">{c}</h2>
        ),
        h3: ({ children: c }) => (
          <h3 className="text-sm font-medium mt-2 mb-1 text-muted-foreground">{c}</h3>
        ),
        p: ({ children: c }) => <p className="mb-2 last:mb-0 leading-relaxed text-sm">{c}</p>,
        pre: ({ children: c }) => (
          <pre className="bg-black/30 border border-border/40 rounded-lg p-3 my-2 overflow-x-auto text-xs font-mono leading-relaxed">
            {c}
          </pre>
        ),
        code: ({ className, children: c }) => {
          const isBlock = Boolean(className);
          return isBlock ? (
            <code className={`font-mono leading-relaxed ${className ?? ''}`}>{c}</code>
          ) : (
            <code className="font-mono text-[11px] bg-black/25 px-1.5 py-0.5 rounded text-amber-300/80 border border-border/30">
              {c}
            </code>
          );
        },
        ul: ({ children: c }) => (
          <ul className="list-disc list-outside ml-4 mb-2 space-y-0.5 text-sm">{c}</ul>
        ),
        ol: ({ children: c }) => (
          <ol className="list-decimal list-outside ml-4 mb-2 space-y-0.5 text-sm">{c}</ol>
        ),
        li: ({ children: c }) => <li className="leading-relaxed">{c}</li>,
        strong: ({ children: c }) => <strong className="font-semibold text-foreground">{c}</strong>,
        em: ({ children: c }) => <em className="italic text-muted-foreground/80">{c}</em>,
        a: ({ href, children: c }) => (
          <a
            href={href}
            className="text-primary underline underline-offset-2 hover:opacity-75 transition-opacity"
            target="_blank"
            rel="noopener noreferrer"
          >
            {c}
          </a>
        ),
        table: ({ children: c }) => (
          <div className="overflow-x-auto my-2 rounded-lg border border-border/50">
            <table className="w-full text-xs border-collapse">{c}</table>
          </div>
        ),
        thead: ({ children: c }) => <thead className="bg-muted/40">{c}</thead>,
        th: ({ children: c }) => (
          <th className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border/50 text-[11px] tracking-wide">
            {c}
          </th>
        ),
        td: ({ children: c }) => (
          <td className="px-3 py-2 border-b border-border/30 text-xs last-of-type:border-0">{c}</td>
        ),
        blockquote: ({ children: c }) => (
          <blockquote className="border-l-2 border-primary/40 pl-3 my-2 text-muted-foreground text-sm italic">
            {c}
          </blockquote>
        ),
        hr: () => <hr className="border-border/50 my-3" />,
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
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-primary/50 px-1">
        You
        {coDriver && (
          <span className="ml-1.5 text-primary/40 normal-case tracking-normal">
            · from {shortDriver(coDriver)}
          </span>
        )}
      </span>
      <div className="rounded-xl border border-primary/20 bg-primary/8 px-4 py-3 text-sm leading-relaxed text-foreground">
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
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-muted-foreground/50 px-1">
        Agent
      </span>
      <div className="rounded-xl border border-border/60 bg-card px-4 py-3 text-card-foreground">
        <AgentMarkdown>{content}</AgentMarkdown>
        {isStreaming && (
          <span className="inline-block w-[2px] h-[14px] bg-primary/60 ml-0.5 align-middle animate-pulse" />
        )}
      </div>
    </div>
  );
}

function ToolCard({ tool }: { tool: IActiveTool }): React.ReactElement {
  const running = tool.status === 'running';
  const failed = tool.status === 'error';
  return (
    <div
      className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-2 text-[11px] font-mono transition-colors ${
        running
          ? 'bg-amber-500/5 border-amber-500/20 text-amber-300/80'
          : failed
            ? 'bg-rose-500/5 border-rose-500/20 text-rose-300/80'
            : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-300/80'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
          running ? 'bg-amber-400 animate-pulse' : failed ? 'bg-rose-400' : 'bg-emerald-400'
        }`}
      />
      <span className="opacity-50">{running ? '▶' : failed ? '✕' : '✓'}</span>
      <span className="font-medium tracking-wide">{tool.name}</span>
      {typeof tool.input === 'string' && tool.input && (
        <span className="opacity-35 truncate max-w-[200px] text-[10px]">{tool.input}</span>
      )}
      <span className="ml-auto opacity-35 text-[10px]">
        {running ? 'running…' : failed ? 'failed' : 'done'}
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
  success: { dot: 'bg-primary/70', text: 'text-foreground/85' },
  error: { dot: 'bg-rose-400', text: 'text-rose-200/90' },
  info: { dot: 'bg-sky-400/80', text: 'text-muted-foreground' },
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
      className="rounded-lg border border-border/50 bg-black/20 font-mono text-[12px]"
    >
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        <span className="text-foreground/80">/{entry.name}</span>
      </div>
      <div className="relative">
        <pre
          ref={bodyRef}
          style={folded ? { maxHeight: COMMAND_FOLD_HEIGHT_PX } : undefined}
          className={`overflow-hidden whitespace-pre-wrap break-words px-3 py-2 leading-relaxed ${tone.text}`}
        >
          {shown}
        </pre>
        {folded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background/90 to-transparent" />
        )}
      </div>
      {foldable && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="w-full border-t border-border/40 px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground"
        >
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
    <div className="font-mono text-[11px]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-muted-foreground hover:bg-card/60 hover:text-foreground"
      >
        <span className="w-3 opacity-60">{open ? '▾' : '▸'}</span>
        <span>
          {tools.length} tool {tools.length === 1 ? 'call' : 'calls'}
        </span>
        <span className="truncate opacity-60">{names}</span>
        {failed > 0 && <span className="ml-auto text-rose-300/80">{failed} failed</span>}
      </button>
      {open && (
        <div className="ml-5 mt-1 flex flex-col gap-1">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThinkingIndicator(): React.ReactElement {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <span className="text-[10px] font-mono tracking-[0.14em] uppercase text-muted-foreground/50">
        Agent
      </span>
      <div className="flex gap-1 items-center">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-emerald-400/60 animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
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
    <div className="flex flex-col gap-3 p-4 overflow-y-auto h-full">
      {isEmpty && (
        <div className="flex h-full items-center justify-center">
          <p className="text-xs font-mono text-muted-foreground/50 tracking-widest uppercase">
            No messages yet
          </p>
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

      {activeTools.map((tool) => (
        <ToolCard key={tool.id} tool={tool} />
      ))}

      {streamingText && <AgentBlock content={streamingText} isStreaming />}

      <div ref={bottomRef} />
    </div>
  );
}
