"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DagDesigner,
  useDagDesignApi,
  type IDefinitionListItem,
  type IRunPreviewProgressHooks,
  type IPreviewResult,
} from "@robota-sdk/dag-designer";
import {
  DagDefinitionValidator,
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
} from "./templates";

export default function DagDesignerPage() {
  const baseUrl = process.env.NEXT_PUBLIC_DAG_API_BASE_URL ?? "http://localhost:3011";
  const designApi = useDagDesignApi({ baseUrl });
  const [log, setLog] = useState<string>("Ready");
  const [dagId, setDagId] = useState<string>("dag-web-sample");
  const [version, setVersion] = useState<number>(1);
  const [definition, setDefinition] = useState<IDagDefinition>(
    buildDagTemplate("blank", { dagId: "dag-web-sample", version: 1 })
  );
  const [templateInjectedOnInit, setTemplateInjectedOnInit] = useState<boolean>(false);
  const [draftCreated, setDraftCreated] = useState<boolean>(false);
  const [catalogNodes, setCatalogNodes] = useState<INodeManifest[]>([]);
  const [definitionList, setDefinitionList] = useState<IDefinitionListItem[]>([]);
  const [selectedListDagId, setSelectedListDagId] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<TDagTemplateKey>(DEFAULT_DAG_TEMPLATE_KEY);
  const [isCommandBarOpen, setIsCommandBarOpen] = useState<boolean>(false);
  const [isNodeExplorerOpen, setIsNodeExplorerOpen] = useState<boolean>(true);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(true);
  const templateMetadataList = listDagTemplatePresets();
  const defaultTemplatePreset = getDagTemplatePreset(DEFAULT_DAG_TEMPLATE_KEY);
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

  const syncDefinitionIdentity = (nextDagId: string, nextVersion: number): void => {
    setDefinition((current) => ({
      ...current,
      dagId: nextDagId,
      version: nextVersion,
    }));
  };

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
      const latestTrace = result.value.traces[result.value.traces.length - 1];
      const latestLlmTrace = [...result.value.traces]
        .reverse()
        .find((trace) => trace.nodeType === "llm-text");
      const latestNodeId = latestTrace ? latestTrace.nodeId : "none";
      const latestInputText = latestTrace ? JSON.stringify(latestTrace.input) : "{}";
      const latestOutputText = latestTrace ? JSON.stringify(latestTrace.output) : "{}";
      const latestLlmOutputText = latestLlmTrace ? JSON.stringify(latestLlmTrace.output) : "{}";
      setLog(
        `Preview success: dagRunId=${result.value.dagRunId}, totalCostUsd=${result.value.totalCostUsd.toFixed(6)}, nodes=${result.value.traces.length}, latestNode=${latestNodeId}, latestInput=${latestInputText}, latestOutput=${latestOutputText}, latestLlmOutput=${latestLlmOutputText}`
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
    const logRunProgressEvent = (event: { eventType: string; dagRunId: string }): void => {
      if (typeof window === "undefined") {
        return;
      }
      window.console.info("[DAG_RUN_PROGRESS_EVENT]", event);
    };

    const started = await designApi.startPreviewRun({
      definition: input.definition,
      input: input.input,
      correlationId: "web-dag-preview-start",
    });
    if ("error" in started) {
      return {
        ok: false,
        error: toDagError(started.error[0]?.code),
      };
    }
    hooks?.onRunStarted(started.value.dagRunId);

    let hasTerminalEvent = false;
    const waitForTerminalEvent = new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("DAG_VALIDATION_PREVIEW_RUN_EVENT_TIMEOUT"));
      }, 120000);
      const markDone = (): void => {
        if (hasTerminalEvent) {
          return;
        }
        hasTerminalEvent = true;
        clearTimeout(timeoutId);
        resolve();
      };
      const markError = (error: Error): void => {
        if (hasTerminalEvent) {
          return;
        }
        hasTerminalEvent = true;
        clearTimeout(timeoutId);
        reject(error);
      };
      const unsubscribe = designApi.subscribeRunProgress({
        dagRunId: started.value.dagRunId,
        onEvent: (event) => {
          logRunProgressEvent(event);
          hooks?.onRunProgressEvent(event);
          if (event.eventType === "execution.completed" || event.eventType === "execution.failed") {
            unsubscribe();
            markDone();
          }
        },
        onError: () => {
          if (typeof window !== "undefined") {
            window.console.error("[DAG_RUN_PROGRESS_EVENT_STREAM_ERROR]", {
              dagRunId: started.value.dagRunId
            });
          }
          unsubscribe();
          markError(new Error("DAG_VALIDATION_PREVIEW_RUN_EVENT_STREAM_FAILED"));
        },
      });
    });
    try {
      await waitForTerminalEvent;
    } catch (error) {
      return {
        ok: false,
        error: toDagError(error instanceof Error ? error.message : "DAG_VALIDATION_PREVIEW_RUN_EVENT_FAILED"),
      };
    }

    // After terminal event, allow a short bounded retry window for persistence/read visibility.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await designApi.getPreviewRunResult({
        dagRunId: started.value.dagRunId,
        correlationId: "web-dag-preview-result",
      });
      if ("value" in result) {
        return {
          ok: true,
          value: result.value,
        };
      }
      const firstCode = result.error[0]?.code;
      if (firstCode && firstCode !== "DAG_VALIDATION_PREVIEW_RUN_NOT_TERMINAL") {
        return {
          ok: false,
          error: toDagError(firstCode),
        };
      }
      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 100);
      });
    }
    return {
      ok: false,
      error: toDagError("DAG_VALIDATION_PREVIEW_RUN_RESULT_TIMEOUT"),
    };
  };

  const refreshNodeCatalog = async (): Promise<void> => {
    const listed = await designApi.listNodeCatalog();
    if (listed.ok) {
      setCatalogNodes(listed.value);
      setLog(`Node catalog refresh success: count=${listed.value.length}`);
      return;
    }
    if ("error" in listed) {
      setLog(`Node catalog refresh failed: ${listed.error[0]?.code}`);
      return;
    }
    setLog("Node catalog refresh failed: UNKNOWN_ERROR");
  };

  useEffect(() => {
    void refreshNodeCatalog();
  }, []);

  useEffect(() => {
    if (templateInjectedOnInit) {
      return;
    }
    if (definition.nodes.length > 0) {
      return;
    }
    const nextDefinition = buildDagTemplate(DEFAULT_DAG_TEMPLATE_KEY, { dagId, version });
    setDefinition(nextDefinition);
    setTemplateInjectedOnInit(true);
    setLog(`Template injected on init: ${defaultTemplatePreset.metadata.name}`);
  }, [dagId, definition.nodes.length, templateInjectedOnInit, version]);

  const applySelectedTemplate = (): void => {
    const nextDefinition = buildDagTemplate(selectedTemplateId, { dagId, version });
    setDefinition(nextDefinition);
    setLog(`Template applied: ${selectedTemplatePreset.metadata.name} (${dagId}:${version})`);
  };

  const loadByDagId = async (): Promise<void> => {
    const loaded = await designApi.load({
      dagId,
      version,
      correlationId: "web-dag-load",
    });
    if (loaded.ok) {
      setDefinition(loaded.value);
      setDagId(loaded.value.dagId);
      setVersion(loaded.value.version);
      setDraftCreated(loaded.value.status === "draft");
      setLog(`Load success: ${loaded.value.dagId}:${loaded.value.version}`);
      return;
    }
    if ("error" in loaded) {
      setLog(`Load failed: ${loaded.error[0]?.code}`);
      return;
    }
    setLog("Load failed: UNKNOWN_ERROR");
  };

  const refreshDefinitionList = async (): Promise<void> => {
    const listed = await designApi.list({
      correlationId: "web-dag-list",
    });
    if (listed.ok) {
      setDefinitionList(listed.value);
      setLog(`List success: count=${listed.value.length}`);
      return;
    }
    if ("error" in listed) {
      setLog(`List failed: ${listed.error[0]?.code}`);
      return;
    }
    setLog("List failed: UNKNOWN_ERROR");
  };

  const loadFromSelectedList = async (): Promise<void> => {
    if (selectedListDagId.trim().length === 0) {
      setLog("Load from list failed: EMPTY_DAG_ID");
      return;
    }
    const loaded = await designApi.load({
      dagId: selectedListDagId,
      correlationId: "web-dag-load-from-list",
    });
    if (loaded.ok) {
      setDefinition(loaded.value);
      setDagId(loaded.value.dagId);
      setVersion(loaded.value.version);
      setDraftCreated(loaded.value.status === "draft");
      setLog(`Load from list success: ${loaded.value.dagId}:${loaded.value.version}`);
      return;
    }
    if ("error" in loaded) {
      setLog(`Load from list failed: ${loaded.error[0]?.code}`);
      return;
    }
    setLog("Load from list failed: UNKNOWN_ERROR");
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-white">
      <header className="absolute inset-x-0 top-0 z-40 flex h-9 items-center justify-between border-b border-gray-300 bg-white/95 px-3 backdrop-blur-sm">
        <div className="min-w-0 text-xs font-semibold text-gray-800">DAG Designer</div>
        <div className="flex items-center gap-2">
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
            <div className="pointer-events-auto absolute left-1/2 top-2 z-30 w-[min(96vw,1100px)] -translate-x-1/2 rounded border border-gray-300 bg-white/95 p-3 shadow-lg backdrop-blur-sm">
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_auto]">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-2 text-xs">
                    DAG ID
                    <input
                      className="rounded border border-gray-300 px-3 py-2 font-mono text-xs"
                      value={dagId}
                      onChange={(event) => {
                        const nextDagId = event.target.value;
                        setDagId(nextDagId);
                        syncDefinitionIdentity(nextDagId, version);
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-xs">
                    Version
                    <input
                      className="rounded border border-gray-300 px-3 py-2 font-mono text-xs"
                      type="number"
                      min={1}
                      value={version}
                      onChange={(event) => {
                        const nextVersion = Number(event.target.value);
                        setVersion(nextVersion);
                        syncDefinitionIdentity(dagId, nextVersion);
                      }}
                    />
                  </label>
                </div>
                <div className="flex flex-wrap items-end justify-start gap-2 xl:justify-end">
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
                    <span className="text-[11px] leading-4 text-gray-600">
                      {selectedTemplatePreset.metadata.description}
                    </span>
                    <span className="text-[11px] leading-4 text-gray-500">
                      templateId: {selectedTemplatePreset.metadata.templateId}
                    </span>
                  </label>
                  <button
                    className="rounded border border-gray-300 bg-white px-3 py-2 text-xs hover:bg-gray-50"
                    onClick={applySelectedTemplate}
                  >
                    Apply Template
                  </button>
                  <button
                    className="rounded bg-black px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={createDraft}
                    disabled={hasBindingBlockingError}
                  >
                    Create Draft
                  </button>
                  <button
                    className="rounded bg-black px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={updateDraft}
                    disabled={!draftCreated || hasBindingBlockingError}
                  >
                    Update Draft
                  </button>
                  <button
                    className="rounded bg-black px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={validateDraft}
                    disabled={hasBindingBlockingError}
                  >
                    Validate
                  </button>
                  <button
                    className="rounded bg-black px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={publishDraft}
                    disabled={hasBindingBlockingError}
                  >
                    Publish
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[auto_auto_1fr_auto]">
                <button
                  className="rounded border border-gray-300 bg-white px-3 py-2 text-xs hover:bg-gray-50"
                  onClick={loadByDagId}
                >
                  Load by DAG ID
                </button>
                <button
                  className="rounded border border-gray-300 bg-white px-3 py-2 text-xs hover:bg-gray-50"
                  onClick={refreshDefinitionList}
                >
                  Refresh DAG List
                </button>
                <select
                  className="rounded border border-gray-300 px-3 py-2 font-mono text-xs"
                  value={selectedListDagId}
                  onChange={(event) => setSelectedListDagId(event.target.value)}
                >
                  <option value="">Select DAG from list</option>
                  {definitionList.map((item) => (
                    <option key={item.dagId} value={item.dagId}>
                      {item.dagId} (latest={item.latestVersion}, statuses={item.statuses.join(",")})
                    </option>
                  ))}
                </select>
                <button
                  className="rounded bg-black px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={loadFromSelectedList}
                  disabled={selectedListDagId.trim().length === 0}
                >
                  Load Selected DAG
                </button>
              </div>
            </div>
          ) : null}

          {hasBindingBlockingError ? (
            <div className="pointer-events-auto absolute left-1/2 top-2 z-30 w-[min(96vw,1100px)] -translate-x-1/2 rounded border border-red-300 bg-red-50 px-4 py-2 text-xs text-red-800 shadow-md">
              <p className="mb-1 font-semibold">Blocking Binding Errors</p>
              {bindingBlockingErrors.map((error, index) => (
                <p key={`${error.code}-${error.message}-${index}`}>- {error.code}: {error.message}</p>
              ))}
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
