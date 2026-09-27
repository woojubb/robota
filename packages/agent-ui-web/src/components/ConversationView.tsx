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

import { driverAttributionText, isSameSurface } from '../driver-labels.js';
import { DiffLines } from './DiffLines.js';

import type {
  IActiveTool,
  IChangedFileSummary,
  ICommandOutputEntry,
  TConversationEntry,
} from '../hooks/useSessionClient.js';
import type { TDriverId } from '@robota-sdk/agent-interface-session';

interface IConversationViewProps {
  messages: readonly TConversationEntry[];
  activeTools: IActiveTool[];
  streamingText: string;
  isThinking: boolean;
  /** This connection's own driver id (§3289 §3), threaded to every message it renders. */
  ownDriverId: TDriverId | null;
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

function UserBlock({
  content,
  author,
  ownDriverId,
}: {
  content: string;
  author?: string;
  /** This connection's own driver id (§3289 §3): its own turns never carry a "from" label. */
  ownDriverId: TDriverId | null;
}): React.ReactElement {
  // REMOTE-014 E5 (display-only, OWNER PRINCIPLE): show WHO drove this turn when it wasn't this
  // connection's own — in plain words, never the raw server-assigned id.
  const coDriver =
    author && !isSameSurface(author, ownDriverId) ? driverAttributionText(author) : undefined;
  return (
    <div className="flex flex-col items-end gap-1.5 pl-12">
      {coDriver && <span className="px-1 text-[12.5px] text-subtle">{coDriver}</span>}
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

/**
 * #3288: a long path's directory is shortened FROM THE LEFT so the filename — the part someone
 * actually needs to recognise — is never the part that gets cut.
 */
const PATH_DISPLAY_MAX_CHARS = 52;
function shortenDirectoryFromLeft(path: string, maxChars: number = PATH_DISPLAY_MAX_CHARS): string {
  if (path.length <= maxChars) return path;
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash === -1) return path; // no directory part to shorten — the filename is never cut
  const fileName = path.slice(lastSlash + 1);
  const dir = path.slice(0, lastSlash);
  const budget = maxChars - fileName.length - 2; // room for the leading "…/"
  if (budget <= 0) return `…/${fileName}`;
  return `…${dir.slice(dir.length - budget)}/${fileName}`;
}

/** Best-effort read of a tool's raw JSON result payload (`IToolInvocationResult`-shaped). */
function parseToolResult(
  raw: string | undefined,
): { output?: string; error?: string; exitCode?: number } | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { output?: unknown; error?: unknown; exitCode?: unknown };
    return {
      ...(typeof parsed.output === 'string' && parsed.output ? { output: parsed.output } : {}),
      ...(typeof parsed.error === 'string' && parsed.error ? { error: parsed.error } : {}),
      ...(typeof parsed.exitCode === 'number' ? { exitCode: parsed.exitCode } : {}),
    };
  } catch {
    // allow-fallback: not the expected JSON shape — show it as plain text rather than nothing.
    return { output: raw };
  }
}

/** Long output folds after ~20 lines; "Show more" expands up to a hard cap with a trailing note. */
const OUTPUT_FOLD_LINES = 20;
const OUTPUT_EXPANDED_CAP_LINES = 500;
function FoldedOutput({ text }: { text: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const lines = text.split('\n');
  if (lines.length <= OUTPUT_FOLD_LINES) {
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-muted-foreground">
        {text}
      </pre>
    );
  }
  const capped = lines.slice(0, OUTPUT_EXPANDED_CAP_LINES);
  const shown = open ? capped : lines.slice(0, OUTPUT_FOLD_LINES);
  return (
    <div className="flex flex-col gap-1">
      <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-muted-foreground">
        {shown.join('\n')}
      </pre>
      {open && lines.length > OUTPUT_EXPANDED_CAP_LINES && (
        <p className="text-[12px] text-subtle">{lines.length - OUTPUT_EXPANDED_CAP_LINES} more lines</p>
      )}
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="self-start text-[12.5px] text-accent hover:underline"
      >
        {open ? 'Show less' : `Show more (${lines.length - OUTPUT_FOLD_LINES} more lines)`}
      </button>
    </div>
  );
}


function ToolCard({ tool }: { tool: IActiveTool }): React.ReactElement {
  const running = tool.status === 'running';
  const failed = tool.status === 'error';
  const [open, setOpen] = useState(false);
  const parsedResult = parseToolResult(tool.toolResultData);
  const hasDiff = tool.diffLines !== undefined && tool.diffLines.length > 0;
  const hasOutput = Boolean(parsedResult?.output) || Boolean(parsedResult?.error);
  const expandable = hasDiff || hasOutput;
  // #3288: a projected `/command` tool shows its command, never the internal provider tool name.
  const label = tool.commandName ? `Ran /${tool.commandName}` : tool.name;

  return (
    <div className="flex flex-col text-[14px]">
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => expandable && setOpen((value) => !value)}
        className={`group -mx-2 flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-1 text-left ${
          expandable ? 'hover:bg-hover' : 'cursor-default'
        }`}
      >
        <ToolIcon
          name={tool.name}
          className={`flex-shrink-0 ${failed ? 'text-destructive' : 'text-subtle'}`}
        />
        <span
          className={`flex-shrink-0 font-medium ${
            running ? 'gui-shimmer' : failed ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {label}
        </span>
        {tool.displayPath ? (
          // #3288: server-computed, workspace-relative, and never middle/end-truncated — only the
          // directory portion is shortened, from the left, so the filename always reads in full.
          <span
            className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-subtle"
            title={tool.displayPath}
          >
            {shortenDirectoryFromLeft(tool.displayPath)}
          </span>
        ) : (
          typeof tool.input === 'string' &&
          tool.input && (
            <span className="min-w-0 truncate font-mono text-[12.5px] text-subtle">{tool.input}</span>
          )
        )}
        <span className="ml-auto flex flex-shrink-0 items-center gap-1.5 text-[12.5px] text-subtle">
          {running ? (
            <LoaderCircle size={14} className="animate-spin" aria-label="running" />
          ) : failed ? (
            <span className="text-destructive">failed</span>
          ) : (
            <Check size={14} aria-label="done" />
          )}
          {expandable && (
            <ChevronRight
              size={13}
              className={`transition-transform ${open ? 'rotate-90' : ''}`}
            />
          )}
        </span>
      </button>
      {open && expandable && (
        <div className="flex flex-col gap-1 pb-1 pl-[25px] pt-0.5">
          {hasDiff && <DiffLines diffLines={tool.diffLines!} />}
          {!hasDiff && parsedResult?.output && <FoldedOutput text={parsedResult.output} />}
          {parsedResult?.error && (
            <p className="font-mono text-[12.5px] text-destructive">{parsedResult.error}</p>
          )}
          {typeof parsedResult?.exitCode === 'number' && (
            <p className="text-[12px] text-subtle">exit {parsedResult.exitCode}</p>
          )}
        </div>
      )}
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
function ToolGroup({ tools }: { tools: readonly IActiveTool[] }): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  // #3288: an internal signal tool (e.g. the goal-status tool) is never shown as a call — the goal
  // bar shows progress instead. A group made up ENTIRELY of internal tools renders nothing at all.
  const visible = tools.filter((tool) => !tool.internal);
  const failed = visible.filter((tool) => tool.status === 'error').length;
  const names = [...new Set(visible.map((tool) => (tool.commandName ? `/${tool.commandName}` : tool.name)))].join(
    ', ',
  );
  if (visible.length === 0) return null;
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
          {visible.length} tool {visible.length === 1 ? 'call' : 'calls'}
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
          {visible.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}

/** #3288: a turn that changed files ends with this compact row — a click opens that file's diff. */
function ChangedFilesRow({ files }: { files: readonly IChangedFileSummary[] }): React.ReactElement {
  const [openPath, setOpenPath] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-card px-2 py-1.5 text-[13px]">
      <p className="px-1 text-[12px] font-medium text-muted-foreground">Changed files</p>
      {files.map((file) => (
        <div key={file.path} className="flex flex-col">
          <button
            type="button"
            aria-expanded={openPath === file.path}
            onClick={() => setOpenPath((current) => (current === file.path ? null : file.path))}
            className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-hover"
          >
            <span
              className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-foreground"
              title={file.path}
            >
              {shortenDirectoryFromLeft(file.path)}
            </span>
            <span className="flex-shrink-0 font-mono text-[12px] text-accent">+{file.added}</span>
            <span className="flex-shrink-0 font-mono text-[12px] text-destructive">
              -{file.removed}
            </span>
          </button>
          {openPath === file.path && (
            <div className="pl-2">
              <DiffLines diffLines={file.diffLines} />
            </div>
          )}
        </div>
      ))}
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
  ownDriverId,
}: IConversationViewProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText, isThinking, activeTools.length]);

  const isEmpty =
    messages.length === 0 && !isThinking && activeTools.length === 0 && !streamingText;

  return (
    <main className="robota-ui h-full overflow-y-auto" aria-label="Conversation">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-6 pb-6 pt-8">
        {isEmpty && (
          <div className="flex h-full items-center justify-center">
            <p className="text-[14px] text-subtle">No messages yet</p>
          </div>
        )}

        {messages.map((entry) => {
          switch (entry.role) {
            case 'user':
              return (
                <UserBlock
                  key={entry.id}
                  content={entry.content}
                  author={entry.author}
                  ownDriverId={ownDriverId}
                />
              );
            case 'assistant':
              return <AgentBlock key={entry.id} content={entry.content} />;
            case 'command':
              return <CommandCard key={entry.id} entry={entry} />;
            case 'tools':
              return <ToolGroup key={entry.id} tools={entry.tools} />;
            case 'changed-files':
              return <ChangedFilesRow key={entry.id} files={entry.files} />;
          }
        })}

        {isThinking && !streamingText && <ThinkingIndicator />}

        {activeTools.some((tool) => !tool.internal) && (
          <div className="flex flex-col">
            {activeTools
              .filter((tool) => !tool.internal)
              .map((tool) => (
                <ToolCard key={tool.id} tool={tool} />
              ))}
          </div>
        )}

        {streamingText && <AgentBlock content={streamingText} isStreaming />}

        <div ref={bottomRef} />
      </div>
    </main>
  );
}
