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

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  "ai-inference": {
    bg: "bg-[var(--studio-accent-violet-dim)]",
    text: "text-[var(--studio-accent-violet)]",
  },
  transform: {
    bg: "bg-[var(--studio-accent-cyan)]/15",
    text: "text-[var(--studio-accent-cyan)]",
  },
  io: {
    bg: "bg-[var(--studio-accent-amber-dim)]",
    text: "text-[var(--studio-accent-amber)]",
  },
  custom: {
    bg: "bg-[var(--studio-accent-rose-dim)]",
    text: "text-[var(--studio-accent-rose)]",
  },
};

function getCategoryStyle(category: string): { bg: string; text: string } {
  return CATEGORY_STYLES[category] ?? {
    bg: "bg-[var(--studio-bg-surface)]",
    text: "text-[var(--studio-text-secondary)]",
  };
}

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
    <div className="studio-grid-bg min-h-screen p-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between rounded-xl border border-[var(--studio-border-subtle)] bg-[var(--studio-bg-elevated)]/80 px-6 py-4 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            <Link
              href="/dag-designer"
              className="text-xs text-[var(--studio-text-muted)] transition-all duration-200 hover:text-[var(--studio-accent-violet)]"
            >
              &larr; DAG List
            </Link>
            <div className="h-4 w-px bg-[var(--studio-border)]" />
            <h1 className="font-sans text-xl font-semibold text-[var(--studio-text)]">Cost Management</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-4 py-2 text-xs text-[var(--studio-text-secondary)] transition-all duration-200 hover:border-[var(--studio-border)] hover:bg-[var(--studio-bg-elevated)] hover:text-[var(--studio-text)]"
              onClick={() => {
                void fetchCostMetas();
              }}
              disabled={isLoading}
            >
              Refresh
            </button>
            <Link
              href="/dag-designer/cost-management/new"
              className="rounded-lg bg-[var(--studio-accent-violet)] px-4 py-2 text-xs font-medium text-white shadow-[0_0_16px_var(--studio-accent-violet-dim)] transition-all duration-200 hover:bg-[var(--studio-accent-violet)]/90 hover:shadow-[0_0_24px_var(--studio-accent-violet-dim)]"
            >
              새 노드 등록
            </Link>
          </div>
        </div>

        {/* Error */}
        {errorMessage.length > 0 ? (
          <div className="rounded-lg border border-[var(--studio-accent-rose)]/30 bg-[var(--studio-accent-rose-dim)] px-4 py-3 text-xs text-[var(--studio-accent-rose)]">{errorMessage}</div>
        ) : null}

        {/* Table Header */}
        <div className="grid grid-cols-[1fr_1fr_100px_80px_1fr] px-5 py-2">
          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--studio-text-muted)]">Node Type</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--studio-text-muted)]">Display Name</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--studio-text-muted)]">Category</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--studio-text-muted)]">Status</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--studio-text-muted)]">Estimate Formula</span>
        </div>

        {/* Items */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-sm text-[var(--studio-text-muted)]">Loading...</span>
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-sm text-[var(--studio-text-muted)]">No cost metas registered.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((item) => {
              const catStyle = getCategoryStyle(item.category);
              return (
                <Link
                  key={item.nodeType}
                  href={`/dag-designer/cost-management/${encodeURIComponent(item.nodeType)}`}
                  className="group grid grid-cols-[1fr_1fr_100px_80px_1fr] items-center rounded-xl border border-[var(--studio-border-subtle)] bg-[var(--studio-bg-elevated)] px-5 py-3.5 transition-all duration-200 hover:border-[var(--studio-accent-violet)]/30 hover:bg-[var(--studio-bg-surface)] hover:shadow-[0_0_20px_var(--studio-accent-violet-dim)]"
                >
                  <span className="font-mono text-sm text-[var(--studio-text)] group-hover:text-[var(--studio-accent-violet)]">{item.nodeType}</span>
                  <span className="text-xs text-[var(--studio-text-secondary)]">{item.displayName}</span>
                  <span>
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-medium ${catStyle.bg} ${catStyle.text}`}>
                      {item.category}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        item.enabled
                          ? "bg-[var(--studio-accent-emerald)] shadow-[0_0_6px_var(--studio-accent-emerald-dim)]"
                          : "bg-[var(--studio-text-muted)]"
                      }`}
                    />
                    <span className={`text-[10px] ${item.enabled ? "text-[var(--studio-accent-emerald)]" : "text-[var(--studio-text-muted)]"}`}>
                      {item.enabled ? "ON" : "OFF"}
                    </span>
                  </span>
                  <span className="truncate rounded bg-[var(--studio-bg-surface)] px-2 py-1 font-mono text-[11px] text-[var(--studio-text-muted)]" title={item.estimateFormula}>
                    {truncateFormula(item.estimateFormula)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
