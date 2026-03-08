"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useDagDesignApi, type IDefinitionListItem } from "@robota-sdk/dag-designer";
import type { IDagDefinition } from "@robota-sdk/dag-core";
import {
  buildDagTemplate,
  DEFAULT_DAG_TEMPLATE_KEY,
  listDagTemplatePresets,
  type TDagTemplateKey,
} from "./templates";

function buildAutoDagId(): string {
  return `dag-${Date.now()}`;
}

export default function DagDesignerListPage() {
  const router = useRouter();
  const baseUrl = process.env.NEXT_PUBLIC_DAG_API_BASE_URL ?? "http://localhost:3011";
  const designApi = useDagDesignApi({ baseUrl });
  const [items, setItems] = useState<IDefinitionListItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<TDagTemplateKey>(DEFAULT_DAG_TEMPLATE_KEY);
  const templateMetadataList = listDagTemplatePresets();
  const selectedTemplate = templateMetadataList.find((template) => template.templateId === selectedTemplateId);
  const sortedItems = useMemo(
    () => [...items]
      .filter((item) => !item.dagId.startsWith("run-copy:"))
      .sort((left, right) => left.dagId.localeCompare(right.dagId)),
    [items]
  );

  const refreshList = async (): Promise<void> => {
    setIsLoading(true);
    const listed = await designApi.list({ correlationId: "web-dag-list-page" });
    if (listed.ok) {
      setItems(listed.value);
      setErrorMessage("");
      setIsLoading(false);
      return;
    }
    setErrorMessage(`List failed: ${"error" in listed ? listed.error[0]?.code : "UNKNOWN_ERROR"}`);
    setIsLoading(false);
  };

  useEffect(() => {
    void refreshList();
  }, []);

  const createNewDag = async (): Promise<void> => {
    if (isCreating) {
      return;
    }
    setIsCreating(true);
    const dagId = buildAutoDagId();
    const definition: IDagDefinition = buildDagTemplate(selectedTemplateId, { dagId, version: 1 });
    const created = await designApi.createDraft({
      definition,
      correlationId: "web-dag-list-create",
    });
    if (created.ok) {
      router.push(`/dag-designer/${encodeURIComponent(created.value.dagId)}`);
      return;
    }
    setErrorMessage(`Create failed: ${"error" in created ? created.error[0]?.code : "UNKNOWN_ERROR"}`);
    setIsCreating(false);
  };

  return (
    <div className="min-h-screen bg-white p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-800">DAG List</h1>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <span>Template</span>
              <select
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                value={selectedTemplateId}
                onChange={(event) => setSelectedTemplateId(event.target.value as TDagTemplateKey)}
                disabled={isCreating}
              >
                {templateMetadataList.map((template) => (
                  <option key={template.templateId} value={template.templateId}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="rounded border border-gray-300 bg-white px-3 py-2 text-xs hover:bg-gray-50"
              onClick={() => {
                void refreshList();
              }}
              disabled={isLoading}
            >
              Refresh
            </button>
            <button
              type="button"
              className="rounded bg-black px-3 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                void createNewDag();
              }}
              disabled={isCreating}
            >
              {isCreating ? "Creating..." : "New DAG"}
            </button>
          </div>
        </div>
        {selectedTemplate ? (
          <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
            <span className="font-semibold text-gray-800">{selectedTemplate.name}</span>
            <span className="ml-2">{selectedTemplate.description}</span>
          </div>
        ) : null}

        {errorMessage.length > 0 ? (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{errorMessage}</div>
        ) : null}

        <div className="overflow-hidden rounded border border-gray-300">
          <div className="grid grid-cols-[2fr_100px_140px] border-b border-gray-300 bg-gray-50 px-3 py-2 text-[11px] font-semibold text-gray-600">
            <span>DAG ID</span>
            <span>Latest</span>
            <span>Status</span>
          </div>
          {isLoading ? (
            <div className="px-3 py-4 text-xs text-gray-600">Loading...</div>
          ) : sortedItems.length === 0 ? (
            <div className="px-3 py-4 text-xs text-gray-600">No DAG definitions found.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {sortedItems.map((item) => (
                <Link
                  key={item.dagId}
                  href={`/dag-designer/${encodeURIComponent(item.dagId)}`}
                  className="grid grid-cols-[2fr_100px_140px] px-3 py-2 text-xs hover:bg-gray-50"
                >
                  <span className="font-mono text-gray-800">{item.dagId}</span>
                  <span className="text-gray-700">{item.latestVersion}</span>
                  <span className="text-gray-700">{item.statuses.join(", ")}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
