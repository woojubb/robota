import { useCallback, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { buildDagChatDraft, type IDagChatDraftResult } from '../chat-builder/dag-chat-draft.js';
import { useDagDesignerContext, type IDagDesignerContextValue } from './dag-designer-context.js';

export interface IDagDesignerChatBuilderProps {
  className?: string;
  placeholder?: string;
}

interface IChatBuilderController {
  prompt: string;
  setPrompt: (prompt: string) => void;
  lastResult?: IDagChatDraftResult;
  catalogNodeCount: number;
  canSubmit: boolean;
  submit: (event: FormEvent<HTMLFormElement>) => void;
}

const DEFAULT_PLACEHOLDER = 'Describe the DAG to build...';

export function DagDesignerChatBuilder(props: IDagDesignerChatBuilderProps): ReactElement {
  const controller = useDagChatBuilderController(useDagDesignerContext());
  return (
    <form
      className={`flex h-full min-h-0 flex-col border border-[var(--studio-border)] bg-[var(--studio-bg-elevated)] ${props.className ?? ''}`}
      onSubmit={controller.submit}
    >
      <ChatBuilderHeader
        catalogNodeCount={controller.catalogNodeCount}
        lastResult={controller.lastResult}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        <PromptInput
          prompt={controller.prompt}
          placeholder={props.placeholder ?? DEFAULT_PLACEHOLDER}
          onPromptChange={controller.setPrompt}
        />
        <ChatBuilderActions controller={controller} />
        <ChatBuilderResult result={controller.lastResult} />
      </div>
    </form>
  );
}

function useDagChatBuilderController(context: IDagDesignerContextValue): IChatBuilderController {
  const [prompt, setPrompt] = useState<string>('');
  const [lastResult, setLastResult] = useState<IDagChatDraftResult | undefined>(undefined);
  const catalogNodeCount = useMemo(
    () => Object.keys(context.objectInfo).length,
    [context.objectInfo],
  );
  const canSubmit = prompt.trim().length > 0 && catalogNodeCount > 0;
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      const result = buildDagChatDraft({
        prompt,
        definition: context.definition,
        objectInfo: context.objectInfo,
      });
      setLastResult(result);
      applyDraftResult(context, result);
    },
    [context, prompt],
  );
  return { prompt, setPrompt, lastResult, catalogNodeCount, canSubmit, submit };
}

function applyDraftResult(context: IDagDesignerContextValue, result: IDagChatDraftResult): void {
  if (result.status !== 'applied') {
    return;
  }
  context.resetRunProgress();
  context.onDefinitionChange(result.definition);
  const selectedNodeId = result.addedNodeIds[result.addedNodeIds.length - 1];
  if (selectedNodeId) {
    context.setSelectedEdgeId(undefined);
    context.setSelectedNodeId(selectedNodeId);
  }
}

function ChatBuilderHeader(props: {
  catalogNodeCount: number;
  lastResult?: IDagChatDraftResult;
}): ReactElement {
  const statusLabel = props.lastResult ? formatStatusLabel(props.lastResult) : 'Ready';
  return (
    <div className="flex shrink-0 items-center justify-between border-b border-[var(--studio-border)] px-3 py-2">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-[var(--studio-text)]">Assistant</h2>
        <p className="text-xs text-[var(--studio-text-muted)]">{props.catalogNodeCount} nodes</p>
      </div>
      <span className="rounded border border-[var(--studio-border)] px-2 py-1 text-xs text-[var(--studio-text-secondary)]">
        {statusLabel}
      </span>
    </div>
  );
}

function PromptInput(props: {
  prompt: string;
  placeholder: string;
  onPromptChange: (prompt: string) => void;
}): ReactElement {
  return (
    <textarea
      className="min-h-[72px] w-full resize-none rounded border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-2 text-sm text-[var(--studio-text)] outline-none transition-all placeholder:text-[var(--studio-text-muted)] focus:border-[var(--studio-accent-violet)]"
      value={props.prompt}
      onChange={(event) => props.onPromptChange(event.target.value)}
      placeholder={props.placeholder}
    />
  );
}

function ChatBuilderActions(props: { controller: IChatBuilderController }): ReactElement {
  const { controller } = props;
  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        className="rounded border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2.5 py-1.5 text-xs text-[var(--studio-text-secondary)] transition-all hover:bg-[var(--studio-bg)] hover:text-[var(--studio-text)] disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => controller.setPrompt('')}
        disabled={controller.prompt.length === 0}
      >
        Clear
      </button>
      <button
        type="submit"
        className="rounded bg-[var(--studio-accent-violet)] px-2.5 py-1.5 text-xs text-white transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!controller.canSubmit}
        title={controller.catalogNodeCount === 0 ? 'Refresh node catalog first.' : undefined}
      >
        Build Draft
      </button>
    </div>
  );
}

function ChatBuilderResult(props: { result?: IDagChatDraftResult }): ReactElement {
  return (
    <div className="min-h-0 flex-1 overflow-auto rounded border border-[var(--studio-border-subtle)] bg-[var(--studio-bg)] p-2">
      <p className="text-sm text-[var(--studio-text-secondary)]">
        {props.result?.message.content ?? 'No draft yet.'}
      </p>
      <AddedNodeList result={props.result} />
      <WarningList result={props.result} />
    </div>
  );
}

function AddedNodeList(props: { result?: IDagChatDraftResult }): ReactElement | null {
  if (!props.result || props.result.addedNodeIds.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {props.result.addedNodeIds.map((nodeId) => (
        <span
          key={nodeId}
          className="rounded border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-0.5 font-mono text-xs text-[var(--studio-text-secondary)]"
        >
          {nodeId}
        </span>
      ))}
    </div>
  );
}

function WarningList(props: { result?: IDagChatDraftResult }): ReactElement | null {
  if (!props.result || props.result.warnings.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 space-y-1">
      {props.result.warnings.map((warning) => (
        <p key={warning.code} className="text-xs text-[var(--studio-accent-amber)]">
          {warning.message}
        </p>
      ))}
    </div>
  );
}

function formatStatusLabel(result: IDagChatDraftResult): string {
  if (result.status === 'applied') {
    return `${result.addedNodeIds.length} added`;
  }
  if (result.status === 'needs-catalog') {
    return 'No catalog';
  }
  if (result.status === 'empty-prompt') {
    return 'Empty';
  }
  return 'No plan';
}
