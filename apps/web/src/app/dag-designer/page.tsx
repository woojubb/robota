"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DagDesignerCanvas,
  DesignerApiClient,
  type IDefinitionListItem,
  type IPreviewResult,
} from "@robota-sdk/dag-designer";
import {
  DagDefinitionValidator,
  type IDagDefinition,
  type IDagError,
  type INodeManifest,
  type TResult,
} from "@robota-sdk/dag-core";

function createSampleDefinition(): IDagDefinition {
  return {
    dagId: "dag-web-sample",
    version: 1,
    status: "draft",
    nodes: [
      {
        nodeId: "image_source_1",
        nodeType: "image-source",
        dependsOn: [],
        inputs: [],
        outputs: [
          { key: "image", label: "Image", order: 0, type: "binary", required: true, binaryKind: "image", mimeTypes: ["image/png"] },
        ],
        config: {
          uri: "file://sample-image.png",
          mimeType: "image/png",
        },
      },
      {
        nodeId: "ok_emitter_1",
        nodeType: "ok-emitter",
        dependsOn: ["image_source_1"],
        inputs: [
          { key: "image", label: "Image", order: 0, type: "binary", required: true, binaryKind: "image", mimeTypes: ["image/png"] },
        ],
        outputs: [
          { key: "status", label: "Status", order: 0, type: "string", required: true },
        ],
        config: {},
      },
      {
        nodeId: "transform_1",
        nodeType: "transform",
        dependsOn: [],
        inputs: [
          { key: "text", label: "Text", order: 0, type: "string", required: false },
          { key: "data", label: "Data", order: 1, type: "object", required: false },
        ],
        outputs: [
          { key: "text", label: "Text", order: 0, type: "string", required: false },
          { key: "data", label: "Data", order: 1, type: "object", required: false },
        ],
        config: {
          prefix: "demo",
        },
      },
    ],
    edges: [
      {
        from: "image_source_1",
        to: "ok_emitter_1",
        bindings: [
          { outputKey: "image", inputKey: "image" },
        ],
      },
    ],
    costPolicy: {
      runCostLimitUsd: 0.01,
      costCurrency: "USD",
      costPolicyVersion: 1,
    },
  };
}

export default function DagDesignerPage() {
  const baseUrl = process.env.NEXT_PUBLIC_DAG_API_BASE_URL ?? "http://localhost:3011";
  const client = useMemo(() => new DesignerApiClient({ baseUrl }), [baseUrl]);
  const [log, setLog] = useState<string>("Ready");
  const [dagId, setDagId] = useState<string>("dag-web-sample");
  const [version, setVersion] = useState<number>(1);
  const [definition, setDefinition] = useState<IDagDefinition>(createSampleDefinition());
  const [draftCreated, setDraftCreated] = useState<boolean>(false);
  const [catalogNodes, setCatalogNodes] = useState<INodeManifest[]>([]);
  const [definitionList, setDefinitionList] = useState<IDefinitionListItem[]>([]);
  const [selectedListDagId, setSelectedListDagId] = useState<string>("");
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
    const created = await client.createDefinition({
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
    const updated = await client.updateDraft({
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
    const validated = await client.validateDefinition({
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
    const published = await client.publishDefinition({
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
      setLog(`Preview success: totalCostUsd=${result.value.totalCostUsd.toFixed(6)}, nodes=${result.value.traces.length}`);
      return;
    }
    if ("error" in result) {
      setLog(`Preview failed: ${result.error.code}`);
      return;
    }
    setLog("Preview failed: UNKNOWN_ERROR");
  };

  const refreshNodeCatalog = async (): Promise<void> => {
    const listed = await client.listNodeCatalog();
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

  const reloadNodeCatalog = async (): Promise<void> => {
    const reloaded = await client.reloadNodeCatalog();
    if (!reloaded.ok) {
      if ("error" in reloaded) {
        setLog(`Node catalog reload failed: ${reloaded.error[0]?.code}`);
        return;
      }
      setLog("Node catalog reload failed: UNKNOWN_ERROR");
      return;
    }
    const refreshed = await client.listNodeCatalog();
    if (refreshed.ok) {
      setCatalogNodes(refreshed.value);
      setLog(`Node catalog reloaded: loaded=${reloaded.value.loadedCount}, visible=${refreshed.value.length}`);
      return;
    }
    setLog(`Node catalog reloaded but list failed`);
  };

  useEffect(() => {
    void refreshNodeCatalog();
  }, []);

  const loadByDagId = async (): Promise<void> => {
    const loaded = await client.getDefinition({
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
    const listed = await client.listDefinitions({
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
    const loaded = await client.getDefinition({
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
    <div className="mx-auto flex h-screen w-full max-w-[1600px] flex-col gap-4 overflow-hidden px-4 py-4 md:px-6 md:py-6">
      <h1 className="shrink-0 text-2xl font-semibold">DAG Designer Host (Web)</h1>
      <p className="shrink-0 text-sm text-gray-600">
        Base URL: <span className="font-mono">{baseUrl}</span>
      </p>

      <div className="shrink-0 grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="flex flex-col gap-2 text-sm">
          DAG ID
          <input
            className="rounded border border-gray-300 px-3 py-2 font-mono"
            value={dagId}
            onChange={(event) => {
              const nextDagId = event.target.value;
              setDagId(nextDagId);
              syncDefinitionIdentity(nextDagId, version);
            }}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          Version
          <input
            className="rounded border border-gray-300 px-3 py-2 font-mono"
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

      <div className="shrink-0 flex flex-wrap gap-2 md:gap-3">
        <button
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={createDraft}
          disabled={hasBindingBlockingError}
        >
          Create Draft
        </button>
        <button
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={updateDraft}
          disabled={!draftCreated || hasBindingBlockingError}
        >
          Update Draft
        </button>
        <button
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={validateDraft}
          disabled={hasBindingBlockingError}
        >
          Validate
        </button>
        <button
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={publishDraft}
          disabled={hasBindingBlockingError}
        >
          Publish
        </button>
        <button
          className="rounded bg-black px-4 py-2 text-sm text-white"
          onClick={loadByDagId}
        >
          Load by DAG ID
        </button>
        <button
          className="rounded bg-black px-4 py-2 text-sm text-white"
          onClick={refreshDefinitionList}
        >
          Refresh DAG List
        </button>
        <button
          className="rounded bg-black px-4 py-2 text-sm text-white"
          onClick={refreshNodeCatalog}
        >
          Refresh Node Catalog
        </button>
        <button
          className="rounded bg-black px-4 py-2 text-sm text-white"
          onClick={reloadNodeCatalog}
        >
          Reload Node Store
        </button>
      </div>

      <div className="shrink-0 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
        <select
          className="rounded border border-gray-300 px-3 py-2 font-mono text-sm"
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
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={loadFromSelectedList}
          disabled={selectedListDagId.trim().length === 0}
        >
          Load Selected DAG
        </button>
      </div>

      {hasBindingBlockingError ? (
        <div className="shrink-0 rounded border border-red-300 bg-red-50 px-4 py-3 text-xs text-red-800">
          <p className="mb-1 font-semibold">Blocking Binding Errors</p>
          {bindingBlockingErrors.map((error) => (
            <p key={`${error.code}-${error.message}`}>- {error.code}: {error.message}</p>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <DagDesignerCanvas
          definition={definition}
          manifests={catalogNodes}
          onDefinitionChange={setDefinition}
          onPreviewResult={onPreviewResult}
          initialInput={{}}
          className="h-full min-h-[680px]"
        />
      </div>

      <div className="shrink-0 rounded border border-gray-300 bg-gray-50 p-4">
        <p className="mb-2 text-sm font-medium">Latest Result</p>
        <pre className="max-h-24 overflow-auto text-xs">{log}</pre>
      </div>
    </div>
  );
}
