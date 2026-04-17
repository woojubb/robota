'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDagDesignApi } from '@robota-sdk/dag-designer';
import type { IDagDefinition } from '@robota-sdk/dag-core';

interface IDefinitionListItem {
  dagId: string;
  latestVersion: number;
  statuses: IDagDefinition['status'][];
}
import {
  buildDagTemplate,
  DEFAULT_DAG_TEMPLATE_KEY,
  listDagTemplatePresets,
  type TDagTemplateKey,
} from './templates';

function buildAutoDagId(): string {
  return `dag-${Date.now()}`;
}

const DAG_API_CONFIG = {
  baseUrl: process.env.NEXT_PUBLIC_DAG_API_BASE_URL ?? 'http://localhost:3012',
};
const TEMPLATE_METADATA_LIST = listDagTemplatePresets();

export default function DagDesignerListPage() {
  const router = useRouter();
  const designApi = useDagDesignApi(DAG_API_CONFIG);
  const [items, setItems] = useState<IDefinitionListItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [selectedTemplateId, setSelectedTemplateId] =
    useState<TDagTemplateKey>(DEFAULT_DAG_TEMPLATE_KEY);
  const templateMetadataList = TEMPLATE_METADATA_LIST;
  const selectedTemplate = templateMetadataList.find(
    (template) => template.templateId === selectedTemplateId,
  );
  const sortedItems = useMemo(
    () =>
      [...items]
        .filter((item) => !item.dagId.startsWith('run-copy:'))
        .sort((left, right) => left.dagId.localeCompare(right.dagId)),
    [items],
  );

  const refreshList = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    const listed = await designApi.list({ correlationId: 'web-dag-list-page' });
    if (listed.ok) {
      setItems(listed.value);
      setErrorMessage('');
      setIsLoading(false);
      return;
    }
    setErrorMessage(`List failed: ${'error' in listed ? listed.error[0]?.code : 'UNKNOWN_ERROR'}`);
    setIsLoading(false);
  }, [designApi]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  const createNewDag = async (): Promise<void> => {
    if (isCreating) {
      return;
    }
    setIsCreating(true);
    const dagId = buildAutoDagId();
    const definition: IDagDefinition = buildDagTemplate(selectedTemplateId, { dagId, version: 1 });
    const created = await designApi.createDraft({
      definition,
      correlationId: 'web-dag-list-create',
    });
    if (created.ok) {
      router.push(`/dag-designer/${encodeURIComponent(created.value.dagId)}`);
      return;
    }
    setErrorMessage(
      `Create failed: ${'error' in created ? created.error[0]?.code : 'UNKNOWN_ERROR'}`,
    );
    setIsCreating(false);
  };

  return (
    <div className="studio-grid-bg min-h-screen p-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between rounded-xl border border-[var(--studio-border-subtle)] bg-[var(--studio-bg-elevated)]/80 px-6 py-4 backdrop-blur-sm">
          <h1 className="font-sans text-xl font-semibold text-[var(--studio-text)]">DAG List</h1>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-[var(--studio-text-secondary)]">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--studio-text-muted)]">
                Template
              </span>
              <select
                className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-3 py-1.5 text-xs text-[var(--studio-text)] outline-none transition-all duration-200 focus:border-[var(--studio-accent-violet)] focus:ring-1 focus:ring-[var(--studio-accent-violet-dim)]"
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
            <Link
              href="/dag-designer/cost-management"
              className="rounded-lg bg-[var(--studio-accent-amber-dim)] px-4 py-2 text-xs font-medium text-[var(--studio-accent-amber)] transition-all duration-200 hover:bg-[var(--studio-accent-amber)]/25 hover:shadow-[0_0_12px_var(--studio-accent-amber-dim)]"
            >
              비용 관리
            </Link>
            <button
              type="button"
              className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-4 py-2 text-xs text-[var(--studio-text-secondary)] transition-all duration-200 hover:border-[var(--studio-border)] hover:bg-[var(--studio-bg-elevated)] hover:text-[var(--studio-text)]"
              onClick={() => {
                void refreshList();
              }}
              disabled={isLoading}
            >
              Refresh
            </button>
            <button
              type="button"
              className="rounded-lg bg-[var(--studio-accent-violet)] px-4 py-2 text-xs font-medium text-white shadow-[0_0_16px_var(--studio-accent-violet-dim)] transition-all duration-200 hover:bg-[var(--studio-accent-violet)]/90 hover:shadow-[0_0_24px_var(--studio-accent-violet-dim)] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                void createNewDag();
              }}
              disabled={isCreating}
            >
              {isCreating ? 'Creating...' : 'New DAG'}
            </button>
          </div>
        </div>

        {/* Template Info */}
        {selectedTemplate ? (
          <div className="rounded-lg border border-[var(--studio-border-subtle)] bg-[var(--studio-bg-elevated)] px-4 py-3 text-xs">
            <span className="font-medium text-[var(--studio-text)]">{selectedTemplate.name}</span>
            <span className="ml-2 text-[var(--studio-text-secondary)]">
              {selectedTemplate.description}
            </span>
          </div>
        ) : null}

        {/* Error */}
        {errorMessage.length > 0 ? (
          <div className="rounded-lg border border-[var(--studio-accent-rose)]/30 bg-[var(--studio-accent-rose-dim)] px-4 py-3 text-xs text-[var(--studio-accent-rose)]">
            {errorMessage}
          </div>
        ) : null}

        {/* DAG Cards */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-sm text-[var(--studio-text-muted)]">Loading...</span>
          </div>
        ) : sortedItems.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-sm text-[var(--studio-text-muted)]">
              No DAG definitions found.
            </span>
          </div>
        ) : (
          <div className="grid gap-3">
            {sortedItems.map((item) => (
              <Link
                key={item.dagId}
                href={`/dag-designer/${encodeURIComponent(item.dagId)}`}
                className="studio-surface group grid grid-cols-[2fr_100px_160px] items-center rounded-xl border border-[var(--studio-border-subtle)] bg-[var(--studio-bg-elevated)] px-5 py-4 transition-all duration-200 hover:border-[var(--studio-accent-violet)]/30 hover:bg-[var(--studio-bg-surface)] hover:shadow-[0_0_20px_var(--studio-accent-violet-dim)]"
              >
                <span className="font-mono text-sm text-[var(--studio-text)] group-hover:text-[var(--studio-accent-violet)]">
                  {item.dagId}
                </span>
                <span className="text-xs text-[var(--studio-text-secondary)]">
                  v{item.latestVersion}
                </span>
                <div className="flex gap-1.5">
                  {item.statuses.map((status) => (
                    <span
                      key={status}
                      className="rounded-full bg-[var(--studio-accent-violet-dim)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--studio-accent-violet)]"
                    >
                      {status}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
