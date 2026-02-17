"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  DagDesigner,
  useDagDesignApi,
  type IRunPreviewProgressHooks,
  type IPreviewResult,
} from "@robota-sdk/dag-designer";
import {
  EXECUTION_PROGRESS_EVENTS,
  DagDefinitionValidator,
  TASK_PROGRESS_EVENTS,
  type IDagDefinition,
  type IDagError,
  type INodeManifest,
  type TPortPayload,
  type TResult,
} from "@robota-sdk/dag-core";
import {
  buildDagTemplate,
  DEFAULT_DAG_TEMPLATE_KEY,
  getDagTemplatePreset,
  listDagTemplatePresets,
  type TDagTemplateKey,
} from "../templates";

export interface IDagDesignerScreenProps {
  initialDagId: string;
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
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [draftCreated, setDraftCreated] = useState<boolean>(false);
  const [catalogNodes, setCatalogNodes] = useState<INodeManifest[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<TDagTemplateKey>(DEFAULT_DAG_TEMPLATE_KEY);
  const [isCommandBarOpen, setIsCommandBarOpen] = useState<boolean>(true);
  const [isNodeExplorerOpen, setIsNodeExplorerOpen] = useState<boolean>(true);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(true);
  const [isRunStarting, setIsRunStarting] = useState<boolean>(false);
  const templateMetadataList = listDagTemplatePresets();
  const selectedTemplatePreset = getDagTemplatePreset(selectedTemplateId);

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

  const toDagError = (code?: string): IDagError => ({
    code: code ?? "DAG_VALIDATION_PREVIEW_UNKNOWN",
    category: "validation",
    message: "Preview request failed.",
    retryable: false,
  });

  const createDraft = async (): Promise<void> => {
    if (hasBindingBlockingError) {
      setLog(`Create blocked: ${bindingBlockingErrors[0]?.code ?? "DAG_VALIDATION_BINDING_REQUIRED"}`);
      return;
    }
    const created = await designApi.createDraft({
      definition,
      correlationId: "web-dag-create",
    });
    if (created.ok) {
      setLog(`Create success: ${created.value.dagId}:${created.value.version}`);
      setDraftCreated(true);
      return;
    }
    if ("error" in created) {
      setLog(`Create failed: ${created.error[0]?.code}`);
      return;
    }
    setLog("Create failed: UNKNOWN_ERROR");
  };

  const updateDraft = async (): Promise<void> => {
    if (hasBindingBlockingError) {
      setLog(`Update blocked: ${bindingBlockingErrors[0]?.code ?? "DAG_VALIDATION_BINDING_REQUIRED"}`);
      return;
    }
    const updated = await designApi.updateDraft({
      dagId,
      version,
      definition,
      correlationId: "web-dag-update",
    });
    if (updated.ok) {
      setLog(`Update success: ${updated.value.dagId}:${updated.value.version}`);
      return;
    }
    if ("error" in updated) {
      setLog(`Update failed: ${updated.error[0]?.code}`);
      return;
    }
    setLog("Update failed: UNKNOWN_ERROR");
  };

  const validateDraft = async (): Promise<void> => {
    if (hasBindingBlockingError) {
      setLog(`Validate blocked: ${bindingBlockingErrors[0]?.code ?? "DAG_VALIDATION_BINDING_REQUIRED"}`);
      return;
    }
    const validated = await designApi.validate({
      dagId,
      version,
      correlationId: "web-dag-validate",
    });
    if (validated.ok) {
      setLog(`Validate success: ${validated.value.dagId}:${validated.value.version}`);
      return;
    }
    if ("error" in validated) {
      setLog(`Validate failed: ${validated.error[0]?.code}`);
      return;
    }
    setLog("Validate failed: UNKNOWN_ERROR");
  };

  const publishDraft = async (): Promise<void> => {
    if (hasBindingBlockingError) {
      setLog(`Publish blocked: ${bindingBlockingErrors[0]?.code ?? "DAG_VALIDATION_BINDING_REQUIRED"}`);
      return;
    }
    const published = await designApi.publish({
      dagId,
      version,
      correlationId: "web-dag-publish",
    });
    if (published.ok) {
      setLog(`Publish success: ${published.value.dagId}:${published.value.version}`);
      return;
    }
    if ("error" in published) {
      setLog(`Publish failed: ${published.error[0]?.code}`);
      return;
    }
    setLog("Publish failed: UNKNOWN_ERROR");
  };

  const onPreviewResult = (result: TResult<IPreviewResult, IDagError>): void => {
    if (result.ok) {
      setLog(
        `Preview success: dagRunId=${result.value.dagRunId}, totalCostUsd=${result.value.totalCostUsd.toFixed(6)}, nodes=${result.value.traces.length}`
      );
      return;
    }
    if ("error" in result) {
      setLog(`Preview failed: ${result.error.code}`);
      return;
    }
    setLog("Preview failed: UNKNOWN_ERROR");
  };

  const runPreviewOnServer = async (input: {
    definition: IDagDefinition;
    input: TPortPayload;
  }, hooks?: IRunPreviewProgressHooks): Promise<TResult<IPreviewResult, IDagError>> => {
    const started = await designApi.startPreviewRun({
      definition: input.definition,
      input: input.input,
      correlationId: "web-dag-preview-start",
    });
    if ("error" in started) {
      return { ok: false, error: toDagError(started.error[0]?.code) };
    }
    hooks?.onRunStarted(started.value.dagRunId);
    let unsubscribe: (() => void) | undefined;
    const waitForTerminalEvent = new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error("DAG_VALIDATION_PREVIEW_RUN_EVENT_TIMEOUT")), 120000);
      unsubscribe = designApi.subscribeRunProgress({
        dagRunId: started.value.dagRunId,
        onEvent: (event) => {
          hooks?.onRunProgressEvent(event);
          if (
            event.eventType === EXECUTION_PROGRESS_EVENTS.COMPLETED
            || event.eventType === EXECUTION_PROGRESS_EVENTS.FAILED
          ) {
            clearTimeout(timeoutId);
            unsubscribe?.();
            resolve();
          }
        },
        onError: () => {
          clearTimeout(timeoutId);
          unsubscribe?.();
          reject(new Error("DAG_VALIDATION_PREVIEW_RUN_EVENT_STREAM_FAILED"));
        },
      });
    });
    const startExecution = await designApi.startPreviewRunExecution({
      dagRunId: started.value.dagRunId,
      correlationId: "web-dag-preview-start-execution",
    });
    if ("error" in startExecution) {
      unsubscribe?.();
      return { ok: false, error: toDagError(startExecution.error[0]?.code) };
    }
    try {
      await waitForTerminalEvent;
    } catch (error) {
      return {
        ok: false,
        error: toDagError(error instanceof Error ? error.message : "DAG_VALIDATION_PREVIEW_RUN_EVENT_FAILED"),
      };
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await designApi.getPreviewRunResult({
        dagRunId: started.value.dagRunId,
        correlationId: "web-dag-preview-result",
      });
      if ("value" in result) {
        return { ok: true, value: result.value };
      }
      const firstCode = result.error[0]?.code;
      if (firstCode && firstCode !== "DAG_VALIDATION_PREVIEW_RUN_NOT_TERMINAL") {
        return { ok: false, error: toDagError(firstCode) };
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    return { ok: false, error: toDagError("DAG_VALIDATION_PREVIEW_RUN_RESULT_TIMEOUT") };
  };

  const runPublishedOnServer = async (): Promise<void> => {
    if (hasBindingBlockingError || isRunStarting) {
      return;
    }
    setIsRunStarting(true);
    const created = await designApi.triggerRun({
      dagId,
      version,
      input: {},
      correlationId: "web-dag-run-create",
    });
    if ("error" in created) {
      setIsRunStarting(false);
      setLog(`Run failed(create): ${created.error[0]?.code}`);
      return;
    }
    const dagRunId = created.value.dagRunId;
    let unsubscribe: (() => void) | undefined;
    let terminalEventType: string | undefined;
    let completedTaskCount = 0;
    let failedTaskCount = 0;
    const waitForTerminalEvent = new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error("DAG_VALIDATION_RUN_EVENT_TIMEOUT")), 120000);
      unsubscribe = designApi.subscribeRunProgress({
        dagRunId,
        onEvent: (event) => {
          if (event.eventType === TASK_PROGRESS_EVENTS.COMPLETED) {
            completedTaskCount += 1;
          }
          if (event.eventType === TASK_PROGRESS_EVENTS.FAILED) {
            failedTaskCount += 1;
          }
          if (
            event.eventType === EXECUTION_PROGRESS_EVENTS.COMPLETED
            || event.eventType === EXECUTION_PROGRESS_EVENTS.FAILED
          ) {
            terminalEventType = event.eventType;
            clearTimeout(timeoutId);
            unsubscribe?.();
            resolve();
          }
        },
        onError: () => {
          clearTimeout(timeoutId);
          unsubscribe?.();
          reject(new Error("DAG_VALIDATION_RUN_EVENT_STREAM_FAILED"));
        },
      });
    });
    const started = await designApi.startRunExecution({
      dagRunId,
      correlationId: "web-dag-run-start",
    });
    if ("error" in started) {
      unsubscribe?.();
      setIsRunStarting(false);
      setLog(`Run failed(start): ${started.error[0]?.code}`);
      return;
    }
    try {
      await waitForTerminalEvent;
      setLog(
        `Run done: dagRunId=${dagRunId}, terminal=${terminalEventType ?? "unknown"}, completedTasks=${completedTaskCount}, failedTasks=${failedTaskCount}`
      );
    } catch (error) {
      setLog(`Run failed(stream): ${error instanceof Error ? error.message : "UNKNOWN_ERROR"}`);
    } finally {
      unsubscribe?.();
      setIsRunStarting(false);
    }
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
        setDefinition(loaded.value);
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
  }, [props.initialDagId]);

  const applySelectedTemplate = (): void => {
    const nextDefinition = buildDagTemplate(selectedTemplateId, { dagId, version });
    setDefinition(nextDefinition);
    setLog(`Template applied: ${selectedTemplatePreset.metadata.name} (${dagId}:${version})`);
  };

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
      <header className="absolute inset-x-0 top-0 z-40 flex h-9 items-center justify-between border-b border-gray-300 bg-white/95 px-3 backdrop-blur-sm">
        <div className="min-w-0 text-xs font-semibold text-gray-800">DAG Designer: {dagId}</div>
        <div className="flex items-center gap-2">
          <Link className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] shadow-sm hover:bg-gray-50" href="/dag-designer">
            DAG List
          </Link>
          <button
            type="button"
            className="rounded border border-gray-300 bg-white px-2 py-1 text-[11px] shadow-sm hover:bg-gray-50"
            onClick={() => setIsCommandBarOpen((current) => !current)}
          >
            {isCommandBarOpen ? "Hide Controls" : "Show Controls"}
          </button>
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
        </div>
      </header>

      <div className="absolute inset-0 pt-9">
        <DagDesigner.Root
          definition={definition}
          manifests={catalogNodes}
          onDefinitionChange={setDefinition}
          assetUploadBaseUrl={baseUrl}
          onPreviewResult={onPreviewResult}
          onRunPreview={runPreviewOnServer}
          initialInput={{}}
          className="relative h-full w-full overflow-hidden"
        >
          <DagDesigner.Canvas className="h-full w-full" />
          {isCommandBarOpen ? (
            <div className="pointer-events-auto absolute left-1/2 top-2 z-30 w-[min(96vw,900px)] -translate-x-1/2 rounded border border-gray-300 bg-white/95 p-3 shadow-lg backdrop-blur-sm">
              <div className="flex flex-wrap items-end justify-start gap-2">
                <label className="flex min-w-[240px] flex-col gap-1 text-xs">
                  Template
                  <select
                    className="rounded border border-gray-300 px-3 py-2 font-mono text-xs"
                    value={selectedTemplateId}
                    onChange={(event) => setSelectedTemplateId(event.target.value as TDagTemplateKey)}
                  >
                    {templateMetadataList.map((template) => (
                      <option key={template.templateId} value={template.templateId}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="rounded border border-gray-300 bg-white px-3 py-2 text-xs hover:bg-gray-50" onClick={applySelectedTemplate}>
                  Apply Template
                </button>
                <button className="rounded bg-black px-3 py-2 text-xs text-white" onClick={createDraft} disabled={hasBindingBlockingError}>
                  Create Draft
                </button>
                <button className="rounded bg-black px-3 py-2 text-xs text-white" onClick={updateDraft} disabled={!draftCreated || hasBindingBlockingError}>
                  Update Draft
                </button>
                <button className="rounded bg-black px-3 py-2 text-xs text-white" onClick={validateDraft} disabled={hasBindingBlockingError}>
                  Validate
                </button>
                <button className="rounded bg-black px-3 py-2 text-xs text-white" onClick={publishDraft} disabled={hasBindingBlockingError}>
                  Publish
                </button>
                <button
                  className="rounded bg-black px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void runPublishedOnServer()}
                  disabled={hasBindingBlockingError || isRunStarting}
                >
                  {isRunStarting ? "Running..." : "Run Runtime"}
                </button>
              </div>
            </div>
          ) : null}

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
        </DagDesigner.Root>
      </div>
    </div>
  );
}
