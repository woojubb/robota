"use client";

import { useMemo, useState } from "react";
import {
  DagDesignerCanvas,
  DesignerApiClient,
  type IPreviewResult,
} from "@robota-sdk/dag-designer";
import type { IDagDefinition, IDagError, TResult } from "@robota-sdk/dag-core";

function createSampleDefinition(): IDagDefinition {
  return {
    dagId: "dag-web-sample",
    version: 1,
    status: "draft",
    nodes: [
      {
        nodeId: "entry",
        nodeType: "input",
        dependsOn: [],
        inputs: [],
        outputs: [
          { key: "prompt", type: "string", required: true },
        ],
        config: {},
      },
      {
        nodeId: "llm",
        nodeType: "llm-text",
        dependsOn: ["entry"],
        inputs: [
          { key: "prompt", type: "string", required: true },
        ],
        outputs: [
          { key: "completion", type: "string", required: true },
        ],
        config: {},
      },
    ],
    edges: [
      {
        from: "entry",
        to: "llm",
        bindings: [
          { outputKey: "prompt", inputKey: "prompt" },
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

  const syncDefinitionIdentity = (nextDagId: string, nextVersion: number): void => {
    setDefinition((current) => ({
      ...current,
      dagId: nextDagId,
      version: nextVersion,
    }));
  };

  const createDraft = async (): Promise<void> => {
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

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col gap-6 px-6 py-8">
      <h1 className="text-2xl font-semibold">DAG Designer Host (Web)</h1>
      <p className="text-sm text-gray-600">
        Base URL: <span className="font-mono">{baseUrl}</span>
      </p>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

      <div className="flex flex-wrap gap-3">
        <button className="rounded bg-black px-4 py-2 text-sm text-white" onClick={createDraft}>
          Create Draft
        </button>
        <button
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={updateDraft}
          disabled={!draftCreated}
        >
          Update Draft
        </button>
        <button className="rounded bg-black px-4 py-2 text-sm text-white" onClick={validateDraft}>
          Validate
        </button>
        <button className="rounded bg-black px-4 py-2 text-sm text-white" onClick={publishDraft}>
          Publish
        </button>
      </div>

      <DagDesignerCanvas
        definition={definition}
        onDefinitionChange={setDefinition}
        onPreviewResult={onPreviewResult}
        initialInput={{ prompt: "hello world" }}
      />

      <div className="rounded border border-gray-300 bg-gray-50 p-4">
        <p className="mb-2 text-sm font-medium">Latest Result</p>
        <pre className="overflow-x-auto text-xs">{log}</pre>
      </div>
    </div>
  );
}
