"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface ICostMeta {
  nodeType: string;
  displayName: string;
  category: string;
  enabled: boolean;
  estimateFormula: string;
}

const DAG_API_BASE_URL = process.env.NEXT_PUBLIC_DAG_API_BASE_URL ?? "http://localhost:3012";

export default function CostManagementListPage() {
  const [items, setItems] = useState<ICostMeta[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string>("");

  const fetchCostMetas = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch(`${DAG_API_BASE_URL}/v1/cost-meta`);
      if (!response.ok) {
        setErrorMessage(`Failed to fetch cost metas: ${response.status} ${response.statusText}`);
        setIsLoading(false);
        return;
      }
      const data: ICostMeta[] = await response.json();
      setItems(data);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setErrorMessage(`Failed to fetch cost metas: ${message}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchCostMetas();
  }, [fetchCostMetas]);

  function truncateFormula(formula: string, maxLength: number = 40): string {
    if (formula.length <= maxLength) {
      return formula;
    }
    return `${formula.slice(0, maxLength)}...`;
  }

  return (
    <div className="min-h-screen bg-white p-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/dag-designer"
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              &larr; DAG List
            </Link>
            <h1 className="text-lg font-semibold text-gray-800">Cost Management</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded border border-gray-300 bg-white px-3 py-2 text-xs hover:bg-gray-50"
              onClick={() => {
                void fetchCostMetas();
              }}
              disabled={isLoading}
            >
              Refresh
            </button>
            <Link
              href="/dag-designer/cost-management/new"
              className="rounded bg-black px-3 py-2 text-xs text-white hover:bg-gray-800"
            >
              새 노드 등록
            </Link>
          </div>
        </div>

        {errorMessage.length > 0 ? (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{errorMessage}</div>
        ) : null}

        <div className="overflow-hidden rounded border border-gray-300">
          <div className="grid grid-cols-[1fr_1fr_100px_80px_1fr] border-b border-gray-300 bg-gray-50 px-3 py-2 text-[11px] font-semibold text-gray-600">
            <span>Node Type</span>
            <span>Display Name</span>
            <span>Category</span>
            <span>Enabled</span>
            <span>Estimate Formula</span>
          </div>
          {isLoading ? (
            <div className="px-3 py-4 text-xs text-gray-600">Loading...</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-4 text-xs text-gray-600">No cost metas registered.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {items.map((item) => (
                <Link
                  key={item.nodeType}
                  href={`/dag-designer/cost-management/${encodeURIComponent(item.nodeType)}`}
                  className="grid grid-cols-[1fr_1fr_100px_80px_1fr] px-3 py-2 text-xs hover:bg-gray-50"
                >
                  <span className="font-mono text-gray-800">{item.nodeType}</span>
                  <span className="text-gray-700">{item.displayName}</span>
                  <span className="text-gray-700">{item.category}</span>
                  <span>
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        item.enabled
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {item.enabled ? "ON" : "OFF"}
                    </span>
                  </span>
                  <span className="truncate font-mono text-gray-500" title={item.estimateFormula}>
                    {truncateFormula(item.estimateFormula)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
