"use client";

import { useMemo, useState } from "react";
import { DesignerApiClient } from "@robota-sdk/dag-designer";
import type { IDagDefinition } from "@robota-sdk/dag-core";

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
        config: {},
      },
      {
        nodeId: "processor",
        nodeType: "processor",
        dependsOn: ["entry"],
        config: {},
      },
    ],
    edges: [{ from: "entry", to: "processor" }],
  };
}

export default function DagDesignerPage() {
  const baseUrl = process.env.NEXT_PUBLIC_DAG_API_BASE_URL ?? "http://localhost:3011";
  const client = useMemo(() => new DesignerApiClient({ baseUrl }), [baseUrl]);
  const [log, setLog] = useState<string>("Ready");
  const [dagId, setDagId] = useState<string>("dag-web-sample");
  const [version, setVersion] = useState<number>(1);

  const createDraft = async (): Promise<void> => {
    const definition = createSampleDefinition();
    definition.dagId = dagId;
    definition.version = version;

    const created = await client.createDefinition({
      definition,
      correlationId: "web-dag-create",
    });
    if (created.ok) {
      setLog(`Create success: ${created.value.dagId}:${created.value.version}`);
      return;
    }
    if ("error" in created) {
      setLog(`Create failed: ${created.error[0]?.code}`);
      return;
    }
    setLog("Create failed: UNKNOWN_ERROR");
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

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-6 py-8">
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
            onChange={(event) => setDagId(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-2 text-sm">
          Version
          <input
            className="rounded border border-gray-300 px-3 py-2 font-mono"
            type="number"
            min={1}
            value={version}
            onChange={(event) => setVersion(Number(event.target.value))}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <button className="rounded bg-black px-4 py-2 text-sm text-white" onClick={createDraft}>
          Create Draft
        </button>
        <button className="rounded bg-black px-4 py-2 text-sm text-white" onClick={validateDraft}>
          Validate
        </button>
        <button className="rounded bg-black px-4 py-2 text-sm text-white" onClick={publishDraft}>
          Publish
        </button>
      </div>

      <div className="rounded border border-gray-300 bg-gray-50 p-4">
        <p className="mb-2 text-sm font-medium">Latest Result</p>
        <pre className="overflow-x-auto text-xs">{log}</pre>
      </div>
    </div>
  );
}
