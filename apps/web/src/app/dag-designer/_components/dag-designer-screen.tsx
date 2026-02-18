"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  DagDesigner,
  useDagDesignApi,
  useDagDesignerContext,
  type IRunProgressHooks,
  type IRunResult,
} from "@robota-sdk/dag-designer";
import {
  EXECUTION_PROGRESS_EVENTS,
  DagDefinitionValidator,
  type IDagDefinition,
  type IDagError,
  type INodeManifest,
  type TPortPayload,
  type TResult,
} from "@robota-sdk/dag-core";
import {
  buildDagTemplate,
} from "../templates";

export interface IDagDesignerScreenProps {
  initialDagId: string;
}

interface IDagHeaderActionBarProps {
  hasBindingBlockingError: boolean;
  disabledReason?: string;
  isSaving: boolean;
  isPublishing: boolean;
  onSave: () => Promise<void>;
  onPublish: () => Promise<void>;
}

function DagHeaderActionBar(props: IDagHeaderActionBarProps): ReactElement {
  const context = useDagDesignerContext();
  const [isRunStarting, setIsRunStarting] = useState<boolean>(false);
  const isActionBlocked = props.hasBindingBlockingError;

  const run = async (): Promise<void> => {
    if (isActionBlocked || isRunStarting) {
      return;
    }
    setIsRunStarting(true);
    context.resetRunProgress();
    try {
      const runResult = context.onRun
        ? await context.onRun({
          definition: context.definition,
          input: context.initialInput ?? {}
        }, {
          onRunStarted: context.setActiveDagRunId,
          onRunProgressEvent: context.applyRunProgressEvent
        })
        : {
          ok: false as const,
          error: {
            code: "DAG_VALIDATION_RUNNER_NOT_CONFIGURED",
            category: "validation" as const,
            message: "Run handler is not configured.",
            retryable: false
          }
        };
      context.setRunResult(runResult.ok ? runResult.value : undefined);
      context.onRunResult?.(runResult);
    } finally {
      setIsRunStarting(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <button
          className="rounded bg-black px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void props.onSave()}
          disabled={isActionBlocked || props.isSaving}
          title={isActionBlocked ? props.disabledReason : undefined}
        >
          {props.isSaving ? "Saving..." : "Save Changes"}
        </button>
        <button
          className="rounded bg-black px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void props.onPublish()}
          disabled={isActionBlocked || props.isPublishing}
          title={isActionBlocked ? props.disabledReason : undefined}
        >
          {props.isPublishing ? "Publishing..." : "Publish"}
        </button>
        <button
          className="rounded bg-black px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => void run()}
          disabled={isActionBlocked || isRunStarting}
          title={isActionBlocked ? props.disabledReason : undefined}
        >
          {isRunStarting ? "Running..." : "Run"}
        </button>
      </div>
      {isActionBlocked && props.disabledReason ? (
        <div className="text-[11px] text-red-600">{props.disabledReason}</div>
      ) : null}
    </div>
  );
}

interface IActionToastState {
  message: string;
  type: "success" | "error" | "info";
}

interface IInitialNodeSelectionEffectProps {
  nodeId?: string;
}

function InitialNodeSelectionEffect(props: IInitialNodeSelectionEffectProps): null {
  const context = useDagDesignerContext();
  const initializedRef = useRef<boolean>(false);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }
    if (typeof props.nodeId !== "string") {
      return;
    }
    const nodeExists = context.definition.nodes.some((node) => node.nodeId === props.nodeId);
    if (!nodeExists) {
      return;
    }
    context.setSelectedEdgeId(undefined);
    context.setSelectedNodeId(props.nodeId);
    initializedRef.current = true;
  }, [context, props.nodeId]);

  return null;
}

function getActionButtonDisabledReason(bindingBlockingErrors: IDagError[]): string | undefined {
  const firstError = bindingBlockingErrors[0];
  if (!firstError) {
    return undefined;
  }
  if (firstError.code.startsWith("DAG_VALIDATION_BINDING_")) {
    return "Blocked: fix binding errors before action.";
  }
  return `Blocked: ${firstError.code}`;
}

function getToastClassName(type: IActionToastState["type"]): string {
  if (type === "success") {
    return "border-green-300 bg-green-50 text-green-700";
  }
  if (type === "error") {
    return "border-red-300 bg-red-50 text-red-700";
  }
  return "border-gray-300 bg-gray-50 text-gray-700";
}

export function DagDesignerScreen(props: IDagDesignerScreenProps) {
  const baseUrl = process.env.NEXT_PUBLIC_DAG_API_BASE_URL ?? "http://localhost:3011";
  const designApi = useDagDesignApi({ baseUrl });
  const [log, setLog] = useState<string>("Ready");
  const [dagId, setDagId] = useState<string>(props.initialDagId);
  const [version, setVersion] = useState<number>(1);
  const [definition, setDefinition] = useState<IDagDefinition>(
    buildDagTemplate("blank", { dagId: props.initialDagId, version: 1 })
  );
  const definitionRef = useRef<IDagDefinition>(definition);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [draftCreated, setDraftCreated] = useState<boolean>(false);
  const [catalogNodes, setCatalogNodes] = useState<INodeManifest[]>([]);
  const [isNodeExplorerOpen, setIsNodeExplorerOpen] = useState<boolean>(true);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [actionToast, setActionToast] = useState<IActionToastState | undefined>(undefined);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const initialSelectedNodeId = useMemo(() => {
    const nodeIds = new Set(definition.nodes.map((node) => node.nodeId));
    const isGeminiTemplateGraph = nodeIds.has("image_source_a_1")
      && nodeIds.has("image_source_b_1")
      && nodeIds.has("gemini_image_compose_1");
    if (!isGeminiTemplateGraph) {
      return undefined;
    }
    return "image_source_a_1";
  }, [definition.nodes]);

  const showActionToast = useCallback((message: string, type: IActionToastState["type"]): void => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = undefined;
    }
    setActionToast({ message, type });
    toastTimerRef.current = setTimeout(() => {
      setActionToast(undefined);
      toastTimerRef.current = undefined;
    }, 2500);
  }, []);

  useEffect(() => (
    () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    }
  ), []);

  const bindingBlockingErrors = useMemo(() => {
    const validated = DagDefinitionValidator.validate(definition);
    if (validated.ok) {
      return [];
    }
    if ("error" in validated) {
      return validated.error.filter((error) => error.code.startsWith("DAG_VALIDATION_BINDING_"));
    }
    return [];
  }, [definition]);
  const hasBindingBlockingError = bindingBlockingErrors.length > 0;
  const actionButtonDisabledReason = useMemo(
    () => getActionButtonDisabledReason(bindingBlockingErrors),
    [bindingBlockingErrors]
  );
  const applyDefinitionChange = useCallback((nextDefinition: IDagDefinition): void => {
    definitionRef.current = nextDefinition;
    setDefinition(nextDefinition);
  }, []);

  const toDagError = (code?: string): IDagError => ({
    code: code ?? "DAG_VALIDATION_RUN_UNKNOWN",
    category: "validation",
    message: "Run request failed.",
    retryable: false,
  });

  const saveDefinition = async (): Promise<void> => {
    if (hasBindingBlockingError) {
      setLog(`Save blocked: ${bindingBlockingErrors[0]?.code ?? "DAG_VALIDATION_BINDING_REQUIRED"}`);
      showActionToast(actionButtonDisabledReason ?? "Save blocked.", "error");
      return;
    }
    if (isSaving) {
      return;
    }
    setIsSaving(true);
    try {
      const nextDefinition: IDagDefinition = {
        ...definitionRef.current,
        dagId,
        version: version + 1,
        status: "draft",
      };
      const saved = await designApi.createDraft({
        definition: nextDefinition,
        correlationId: "web-dag-create",
      });

      if (saved.ok) {
        applyDefinitionChange(saved.value);
        setDagId(saved.value.dagId);
        setVersion(saved.value.version);
        setDraftCreated(saved.value.status === "draft");
        setLog(`Save success: ${saved.value.dagId}:${saved.value.version} (working version)`);
        showActionToast("Saved.", "success");
        return;
      }
      if ("error" in saved) {
        setLog(`Save failed: ${saved.error[0]?.code}`);
        showActionToast("Save failed.", "error");
        return;
      }
      setLog("Save failed: UNKNOWN_ERROR");
      showActionToast("Save failed.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const publishDraft = async (): Promise<void> => {
    if (hasBindingBlockingError) {
      setLog(`Publish blocked: ${bindingBlockingErrors[0]?.code ?? "DAG_VALIDATION_BINDING_REQUIRED"}`);
      showActionToast(actionButtonDisabledReason ?? "Publish blocked.", "error");
      return;
    }
    if (isPublishing) {
      return;
    }
    setIsPublishing(true);
    try {
      const published = await designApi.publish({
        dagId,
        version,
        correlationId: "web-dag-publish",
      });
      if (published.ok) {
        setLog(`Publish success: ${published.value.dagId}:${published.value.version} (published snapshot)`);
        showActionToast("Published.", "success");
        return;
      }
      if ("error" in published) {
        setLog(`Publish failed: ${published.error[0]?.code}`);
        showActionToast("Publish failed.", "error");
        return;
      }
      setLog("Publish failed: UNKNOWN_ERROR");
      showActionToast("Publish failed.", "error");
    } finally {
      setIsPublishing(false);
    }
  };

  const onRunResult = (result: TResult<IRunResult, IDagError>): void => {
    if (result.ok) {
      setLog(
        `Run success: dagRunId=${result.value.dagRunId}, totalCostUsd=${result.value.totalCostUsd.toFixed(6)}, nodes=${result.value.traces.length}`
      );
      showActionToast("Run completed.", "success");
      return;
    }
    if ("error" in result) {
      setLog(`Run failed: ${result.error.code}`);
      showActionToast("Run failed.", "error");
      return;
    }
    setLog("Run failed: UNKNOWN_ERROR");
    showActionToast("Run failed.", "error");
  };

  const runOnServer = async (input: {
    definition: IDagDefinition;
    input: TPortPayload;
  }, hooks?: IRunProgressHooks): Promise<TResult<IRunResult, IDagError>> => {
    const waitFor = async (ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const started = await designApi.createRun({
      definition: input.definition,
      input: input.input,
      correlationId: "web-dag-run-create",
    });
    if ("error" in started) {
      return { ok: false, error: toDagError(started.error[0]?.code) };
    }
    hooks?.onRunStarted(started.value.dagRunId);
    let unsubscribe: (() => void) | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const cleanupRunSubscription = (): void => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = undefined;
      }
    };
    const waitForTerminalEvent = new Promise<void>((resolve, reject) => {
      timeoutId = setTimeout(() => {
        cleanupRunSubscription();
        reject(new Error("DAG_VALIDATION_RUN_EVENT_TIMEOUT"));
      }, 120000);
      unsubscribe = designApi.subscribeRunProgress({
        dagRunId: started.value.dagRunId,
        maxReconnectAttempts: 5,
        initialReconnectDelayMs: 500,
        onEvent: (event) => {
          hooks?.onRunProgressEvent(event);
          if (
            event.eventType === EXECUTION_PROGRESS_EVENTS.COMPLETED
            || event.eventType === EXECUTION_PROGRESS_EVENTS.FAILED
          ) {
            cleanupRunSubscription();
            resolve();
          }
        },
        onError: () => {
          cleanupRunSubscription();
          reject(new Error("DAG_VALIDATION_RUN_EVENT_STREAM_FAILED"));
        },
      });
    });
    const startExecution = await designApi.startRun({
      dagRunId: started.value.dagRunId,
      correlationId: "web-dag-run-start",
    });
    if ("error" in startExecution) {
      cleanupRunSubscription();
      return { ok: false, error: toDagError(startExecution.error[0]?.code) };
    }
    try {
      await waitForTerminalEvent;
    } catch (error) {
      cleanupRunSubscription();
      return {
        ok: false,
        error: toDagError(error instanceof Error ? error.message : "DAG_VALIDATION_RUN_EVENT_FAILED"),
      };
    }
    cleanupRunSubscription();
    const result = await designApi.getRunResult({
      dagRunId: started.value.dagRunId,
      correlationId: "web-dag-run-result:0",
    });
    if ("value" in result) {
      return { ok: true, value: result.value };
    }
    const shouldRetryInitial = result.error[0]?.code === "DAG_VALIDATION_RUN_NOT_TERMINAL" || result.error[0]?.retryable === true;
    if (!shouldRetryInitial) {
      return { ok: false, error: toDagError(result.error[0]?.code) };
    }
    const maxAttempts = 7;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      await waitFor(Math.min(4000, 250 * (2 ** attempt)));
      const nextResult = await designApi.getRunResult({
        dagRunId: started.value.dagRunId,
        correlationId: `web-dag-run-result:${attempt}`,
      });
      if ("value" in nextResult) {
        return { ok: true, value: nextResult.value };
      }
      const retryable = nextResult.error[0]?.code === "DAG_VALIDATION_RUN_NOT_TERMINAL"
        || nextResult.error[0]?.retryable === true;
      if (!retryable) {
        return { ok: false, error: toDagError(nextResult.error[0]?.code) };
      }
    }
    return { ok: false, error: toDagError("DAG_VALIDATION_RUN_NOT_TERMINAL") };
  };

  const refreshNodeCatalog = async (): Promise<void> => {
    const listed = await designApi.listNodeCatalog();
    if (listed.ok) {
      setCatalogNodes(listed.value);
      return;
    }
    setLog(`Node catalog refresh failed: ${"error" in listed ? listed.error[0]?.code : "UNKNOWN_ERROR"}`);
  };

  useEffect(() => {
    setDagId(props.initialDagId);
  }, [props.initialDagId]);

  useEffect(() => {
    const load = async (): Promise<void> => {
      setLoadState("loading");
      const loaded = await designApi.load({
        dagId: props.initialDagId,
        correlationId: "web-dag-load-route",
      });
      if (loaded.ok) {
        applyDefinitionChange(loaded.value);
        setDagId(loaded.value.dagId);
        setVersion(loaded.value.version);
        setDraftCreated(loaded.value.status === "draft");
        setLog(`Load success: ${loaded.value.dagId}:${loaded.value.version}`);
        setLoadState("ready");
        return;
      }
      setLoadState("error");
      setLog(`Load failed: ${"error" in loaded ? loaded.error[0]?.code : "UNKNOWN_ERROR"}`);
    };
    void load();
    void refreshNodeCatalog();
  }, [applyDefinitionChange, props.initialDagId]);

  if (loadState === "loading") {
    return <div className="p-6 text-sm text-gray-700">Loading DAG...</div>;
  }
  if (loadState === "error") {
    return (
      <div className="p-6 text-sm text-red-700">
        <p className="mb-3 font-semibold">Failed to load DAG.</p>
        <p className="mb-4">{log}</p>
        <Link className="rounded border border-gray-300 px-3 py-2 text-xs hover:bg-gray-50" href="/dag-designer">
          Back to DAG List
        </Link>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-white">
      <div className="absolute inset-0">
        <DagDesigner.Root
          definition={definition}
          manifests={catalogNodes}
          onDefinitionChange={applyDefinitionChange}
          assetUploadBaseUrl={baseUrl}
          onRunResult={onRunResult}
          onRun={runOnServer}
          initialInput={{}}
          className="relative h-full w-full overflow-hidden"
        >
          <InitialNodeSelectionEffect nodeId={initialSelectedNodeId} />
          <div className="flex h-full min-h-0 flex-col">
            <header className="z-40 flex h-9 shrink-0 items-center justify-between border-b border-gray-300 bg-white/95 px-3 backdrop-blur-sm">
              <div className="min-w-0 text-xs font-semibold text-gray-800">DAG Designer: {dagId}</div>
              <div className="flex items-center gap-2">
                <Link className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] shadow-sm hover:bg-gray-50" href="/dag-designer">
                  DAG List
                </Link>
                <button
                  type="button"
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] shadow-sm hover:bg-gray-50"
                  onClick={() => setIsNodeExplorerOpen((current) => !current)}
                >
                  {isNodeExplorerOpen ? "Hide Explorer" : "Show Explorer"}
                </button>
                <button
                  type="button"
                  className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] shadow-sm hover:bg-gray-50"
                  onClick={() => setIsInspectorOpen((current) => !current)}
                >
                  {isInspectorOpen ? "Hide Inspector" : "Show Inspector"}
                </button>
                <DagHeaderActionBar
                  hasBindingBlockingError={hasBindingBlockingError}
                  disabledReason={actionButtonDisabledReason}
                  isSaving={isSaving}
                  isPublishing={isPublishing}
                  onSave={saveDefinition}
                  onPublish={publishDraft}
                />
              </div>
            </header>

            <div className="relative min-h-0 flex-1">
              <DagDesigner.Canvas className="h-full w-full" />

              {isNodeExplorerOpen ? (
                <div className="absolute bottom-0 left-0 top-0 z-20 w-[320px]">
                  <div className="flex h-full min-h-0 flex-col rounded-none border-r border-gray-300 bg-white/95 shadow-lg backdrop-blur-sm">
                    <div className="flex items-center justify-between border-b border-gray-300 px-3 py-2">
                      <span className="text-xs font-semibold text-gray-700">Node Catalog</span>
                      <button
                        type="button"
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] hover:bg-gray-50"
                        onClick={refreshNodeCatalog}
                      >
                        Refresh
                      </button>
                    </div>
                    <div className="min-h-0 flex-1 p-2">
                      <DagDesigner.NodeExplorer className="h-full border-0 p-0" />
                    </div>
                  </div>
                </div>
              ) : null}

              {isInspectorOpen ? (
                <div className="absolute bottom-0 right-0 top-0 z-20 w-[380px]">
                  <div className="h-full overflow-auto border-l border-gray-300 bg-white/95 shadow-lg backdrop-blur-sm">
                    <div className="flex flex-col gap-2 p-2">
                      <DagDesigner.NodeConfig />
                      <DagDesigner.NodeIoTrace />
                      <DagDesigner.EdgeInspector />
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 w-[min(96vw,800px)] -translate-x-1/2">
                <div className="pointer-events-auto rounded border border-gray-300 bg-white/95 px-3 py-2 shadow-lg backdrop-blur-sm">
                  <p className="mb-1 text-xs font-medium">Latest Result</p>
                  <DagDesigner.RunProgressSummary className="mb-1 font-mono text-[11px] text-gray-700" />
                  <pre className="max-h-20 overflow-auto text-xs">{log}</pre>
                </div>
              </div>
              {actionToast ? (
                <div className="pointer-events-none absolute right-3 top-3 z-50">
                  <div className={`rounded border px-3 py-2 text-xs shadow ${getToastClassName(actionToast.type)}`}>
                    {actionToast.message}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </DagDesigner.Root>
      </div>
    </div>
  );
}
