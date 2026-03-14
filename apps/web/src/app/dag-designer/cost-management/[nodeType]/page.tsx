"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

interface ICostMetaForm {
  nodeType: string;
  displayName: string;
  category: string;
  estimateFormula: string;
  calculateFormula: string;
  variables: string;
  enabled: boolean;
}

interface IValidationResult {
  valid: boolean;
  error?: string;
}

interface IPreviewResult {
  estimatedCredits: number;
  breakdown?: Record<string, unknown>;
}

const DAG_API_BASE_URL = process.env.NEXT_PUBLIC_DAG_API_BASE_URL ?? "http://localhost:3012";

const CATEGORY_OPTIONS = [
  { value: "ai-inference", label: "AI Inference" },
  { value: "transform", label: "Transform" },
  { value: "io", label: "I/O" },
  { value: "custom", label: "Custom" },
];

const EMPTY_FORM: ICostMetaForm = {
  nodeType: "",
  displayName: "",
  category: "ai-inference",
  estimateFormula: "",
  calculateFormula: "",
  variables: "{}",
  enabled: true,
};

export default function CostMetaEditPage() {
  const params = useParams<{ nodeType: string }>();
  const router = useRouter();
  const rawNodeType = params.nodeType;
  const isCreateMode = rawNodeType === "new";
  const nodeTypeParam = isCreateMode ? "" : decodeURIComponent(rawNodeType);

  const [form, setForm] = useState<ICostMetaForm>({ ...EMPTY_FORM });
  const [isLoading, setIsLoading] = useState<boolean>(!isCreateMode);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  // Validation state
  const [estimateValid, setEstimateValid] = useState<IValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const validateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Preview state
  const [previewContext, setPreviewContext] = useState<string>('{\n  "input": {},\n  "config": {}\n}');
  const [previewResult, setPreviewResult] = useState<IPreviewResult | null>(null);
  const [isPreviewing, setIsPreviewing] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string>("");

  // Variables JSON validation
  const [variablesError, setVariablesError] = useState<string>("");

  const fetchExisting = useCallback(async (): Promise<void> => {
    if (isCreateMode) return;
    setIsLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch(`${DAG_API_BASE_URL}/v1/cost-meta/${encodeURIComponent(nodeTypeParam)}`);
      if (!response.ok) {
        setErrorMessage(`Failed to fetch cost meta: ${response.status} ${response.statusText}`);
        setIsLoading(false);
        return;
      }
      const data = await response.json();
      setForm({
        nodeType: data.nodeType ?? "",
        displayName: data.displayName ?? "",
        category: data.category ?? "ai-inference",
        estimateFormula: data.estimateFormula ?? "",
        calculateFormula: data.calculateFormula ?? "",
        variables: data.variables != null ? JSON.stringify(data.variables, null, 2) : "{}",
        enabled: data.enabled ?? true,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setErrorMessage(`Failed to fetch cost meta: ${message}`);
    } finally {
      setIsLoading(false);
    }
  }, [isCreateMode, nodeTypeParam]);

  useEffect(() => {
    void fetchExisting();
  }, [fetchExisting]);

  // Debounced formula validation
  const validateFormula = useCallback((formula: string): void => {
    if (validateTimerRef.current !== null) {
      clearTimeout(validateTimerRef.current);
    }
    if (formula.trim().length === 0) {
      setEstimateValid(null);
      return;
    }
    setIsValidating(true);
    validateTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(`${DAG_API_BASE_URL}/v1/cost-meta/validate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ formula }),
          });
          const result: IValidationResult = await response.json();
          setEstimateValid(result);
        } catch {
          setEstimateValid({ valid: false, error: "Validation request failed" });
        } finally {
          setIsValidating(false);
        }
      })();
    }, 500);
  }, []);

  function updateField<K extends keyof ICostMetaForm>(key: K, value: ICostMetaForm[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSuccessMessage("");

    if (key === "estimateFormula") {
      validateFormula(value as string);
    }

    if (key === "variables") {
      try {
        JSON.parse(value as string);
        setVariablesError("");
      } catch {
        setVariablesError("Invalid JSON");
      }
    }
  }

  async function handleSave(): Promise<void> {
    setIsSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    // Validate variables JSON before saving
    let parsedVariables: unknown = {};
    try {
      parsedVariables = JSON.parse(form.variables);
    } catch {
      setErrorMessage("Variables field contains invalid JSON.");
      setIsSaving(false);
      return;
    }

    const payload = {
      nodeType: form.nodeType,
      displayName: form.displayName,
      category: form.category,
      estimateFormula: form.estimateFormula,
      calculateFormula: form.calculateFormula.length > 0 ? form.calculateFormula : undefined,
      variables: parsedVariables,
      enabled: form.enabled,
    };

    try {
      const url = isCreateMode
        ? `${DAG_API_BASE_URL}/v1/cost-meta`
        : `${DAG_API_BASE_URL}/v1/cost-meta/${encodeURIComponent(nodeTypeParam)}`;
      const method = isCreateMode ? "POST" : "PUT";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        setErrorMessage(`Save failed: ${response.status} ${response.statusText} — ${body}`);
        setIsSaving(false);
        return;
      }

      setSuccessMessage(isCreateMode ? "Created successfully." : "Updated successfully.");
      if (isCreateMode) {
        router.push(`/dag-designer/cost-management/${encodeURIComponent(form.nodeType)}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setErrorMessage(`Save failed: ${message}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePreview(): Promise<void> {
    setIsPreviewing(true);
    setPreviewError("");
    setPreviewResult(null);

    let parsedContext: unknown;
    try {
      parsedContext = JSON.parse(previewContext);
    } catch {
      setPreviewError("Invalid JSON in test context.");
      setIsPreviewing(false);
      return;
    }

    try {
      const response = await fetch(`${DAG_API_BASE_URL}/v1/cost-meta/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          formula: form.estimateFormula,
          variables: JSON.parse(form.variables),
          context: parsedContext,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        setPreviewError(`Preview failed: ${response.status} — ${body}`);
        setIsPreviewing(false);
        return;
      }

      const result: IPreviewResult = await response.json();
      setPreviewResult(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setPreviewError(`Preview failed: ${message}`);
    } finally {
      setIsPreviewing(false);
    }
  }

  if (isLoading) {
    return (
      <div className="studio-grid-bg min-h-screen p-8">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-center py-20">
          <span className="text-sm text-[var(--studio-text-muted)]">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="studio-grid-bg min-h-screen p-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {/* Header */}
        <div className="flex items-center gap-4 rounded-xl border border-[var(--studio-border-subtle)] bg-[var(--studio-bg-elevated)]/80 px-6 py-4 backdrop-blur-sm">
          <Link
            href="/dag-designer/cost-management"
            className="text-xs text-[var(--studio-text-muted)] transition-all duration-200 hover:text-[var(--studio-accent-violet)]"
          >
            &larr; Cost Management
          </Link>
          <div className="h-4 w-px bg-[var(--studio-border)]" />
          <h1 className="font-sans text-xl font-semibold text-[var(--studio-text)]">
            {isCreateMode ? "New Cost Meta" : `Edit: ${nodeTypeParam}`}
          </h1>
        </div>

        {/* Messages */}
        {errorMessage.length > 0 ? (
          <div className="rounded-lg border border-[var(--studio-accent-rose)]/30 bg-[var(--studio-accent-rose-dim)] px-4 py-3 text-xs text-[var(--studio-accent-rose)]">{errorMessage}</div>
        ) : null}
        {successMessage.length > 0 ? (
          <div className="rounded-lg border border-[var(--studio-accent-emerald)]/30 bg-[var(--studio-accent-emerald-dim)] px-4 py-3 text-xs text-[var(--studio-accent-emerald)]">{successMessage}</div>
        ) : null}

        {/* Form */}
        <div className="flex flex-col gap-5 rounded-xl border border-[var(--studio-border-subtle)] bg-[var(--studio-bg-elevated)] p-6">
          {/* nodeType */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-medium uppercase tracking-wider text-[var(--studio-text-muted)]">Node Type</label>
            <input
              type="text"
              value={form.nodeType}
              onChange={(e) => { updateField("nodeType", e.target.value); }}
              disabled={!isCreateMode}
              placeholder="e.g. openai-gpt4o"
              className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-4 py-2.5 font-mono text-sm text-[var(--studio-text)] outline-none transition-all duration-200 placeholder:text-[var(--studio-text-muted)] focus:border-[var(--studio-accent-violet)] focus:shadow-[0_0_12px_var(--studio-accent-violet-dim)] disabled:bg-[var(--studio-bg)] disabled:text-[var(--studio-text-muted)]"
            />
          </div>

          {/* displayName */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-medium uppercase tracking-wider text-[var(--studio-text-muted)]">Display Name</label>
            <input
              type="text"
              value={form.displayName}
              onChange={(e) => { updateField("displayName", e.target.value); }}
              placeholder="e.g. OpenAI GPT-4o"
              className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-4 py-2.5 text-sm text-[var(--studio-text)] outline-none transition-all duration-200 placeholder:text-[var(--studio-text-muted)] focus:border-[var(--studio-accent-violet)] focus:shadow-[0_0_12px_var(--studio-accent-violet-dim)]"
            />
          </div>

          {/* category */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-medium uppercase tracking-wider text-[var(--studio-text-muted)]">Category</label>
            <select
              value={form.category}
              onChange={(e) => { updateField("category", e.target.value); }}
              className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-4 py-2.5 text-sm text-[var(--studio-text)] outline-none transition-all duration-200 focus:border-[var(--studio-accent-violet)] focus:shadow-[0_0_12px_var(--studio-accent-violet-dim)]"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* estimateFormula */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <label className="text-[10px] font-medium uppercase tracking-wider text-[var(--studio-text-muted)]">Estimate Formula</label>
              {isValidating ? (
                <span className="text-[10px] text-[var(--studio-text-muted)]">validating...</span>
              ) : estimateValid !== null ? (
                estimateValid.valid ? (
                  <span className="flex items-center gap-1 text-[10px] text-[var(--studio-accent-emerald)]">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--studio-accent-emerald)] shadow-[0_0_6px_var(--studio-accent-emerald-dim)]" />
                    valid
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] text-[var(--studio-accent-rose)]">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--studio-accent-rose)] shadow-[0_0_6px_var(--studio-accent-rose-dim)]" />
                    {estimateValid.error ?? "invalid"}
                  </span>
                )
              ) : null}
            </div>
            <textarea
              value={form.estimateFormula}
              onChange={(e) => { updateField("estimateFormula", e.target.value); }}
              placeholder="e.g. inputTokens * 0.003 + outputTokens * 0.006"
              rows={3}
              className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg)] px-4 py-3 font-mono text-sm text-[var(--studio-accent-cyan)] outline-none transition-all duration-200 placeholder:text-[var(--studio-text-muted)] focus:border-[var(--studio-accent-violet)] focus:shadow-[0_0_12px_var(--studio-accent-violet-dim)]"
            />
          </div>

          {/* calculateFormula */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-medium uppercase tracking-wider text-[var(--studio-text-muted)]">Calculate Formula <span className="normal-case tracking-normal text-[var(--studio-text-muted)]">(optional)</span></label>
            <textarea
              value={form.calculateFormula}
              onChange={(e) => { updateField("calculateFormula", e.target.value); }}
              placeholder="e.g. actualTokens * 0.003"
              rows={3}
              className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg)] px-4 py-3 font-mono text-sm text-[var(--studio-accent-cyan)] outline-none transition-all duration-200 placeholder:text-[var(--studio-text-muted)] focus:border-[var(--studio-accent-violet)] focus:shadow-[0_0_12px_var(--studio-accent-violet-dim)]"
            />
          </div>

          {/* variables */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <label className="text-[10px] font-medium uppercase tracking-wider text-[var(--studio-text-muted)]">Variables (JSON)</label>
              {variablesError.length > 0 ? (
                <span className="flex items-center gap-1 text-[10px] text-[var(--studio-accent-rose)]">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--studio-accent-rose)] shadow-[0_0_6px_var(--studio-accent-rose-dim)]" />
                  {variablesError}
                </span>
              ) : null}
            </div>
            <textarea
              value={form.variables}
              onChange={(e) => { updateField("variables", e.target.value); }}
              placeholder='{ "inputTokens": 1000, "outputTokens": 500 }'
              rows={4}
              className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg)] px-4 py-3 font-mono text-sm text-[var(--studio-text-secondary)] outline-none transition-all duration-200 placeholder:text-[var(--studio-text-muted)] focus:border-[var(--studio-accent-violet)] focus:shadow-[0_0_12px_var(--studio-accent-violet-dim)]"
            />
          </div>

          {/* enabled */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={form.enabled}
              onClick={() => { updateField("enabled", !form.enabled); }}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-200 ${
                form.enabled
                  ? "bg-[var(--studio-accent-emerald)] shadow-[0_0_10px_var(--studio-accent-emerald-dim)]"
                  : "bg-[var(--studio-border)]"
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200 ${
                  form.enabled ? "translate-x-[18px]" : "translate-x-[3px]"
                }`}
              />
            </button>
            <label className="text-xs text-[var(--studio-text-secondary)]">Enabled</label>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3 border-t border-[var(--studio-border-subtle)] pt-5">
            <button
              type="button"
              onClick={() => { void handleSave(); }}
              disabled={isSaving || form.nodeType.trim().length === 0}
              className="rounded-lg bg-[var(--studio-accent-violet)] px-5 py-2.5 text-xs font-medium text-white shadow-[0_0_16px_var(--studio-accent-violet-dim)] transition-all duration-200 hover:bg-[var(--studio-accent-violet)]/90 hover:shadow-[0_0_24px_var(--studio-accent-violet-dim)] disabled:opacity-40 disabled:shadow-none"
            >
              {isSaving ? "Saving..." : isCreateMode ? "Create" : "Save"}
            </button>
            <Link
              href="/dag-designer/cost-management"
              className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-5 py-2.5 text-xs text-[var(--studio-text-secondary)] transition-all duration-200 hover:bg-[var(--studio-bg-elevated)] hover:text-[var(--studio-text)]"
            >
              Cancel
            </Link>
          </div>
        </div>

        {/* Preview Section */}
        <div className="flex flex-col gap-4 rounded-xl border border-[var(--studio-border-subtle)] bg-[var(--studio-bg-elevated)] p-6">
          <h2 className="text-sm font-semibold text-[var(--studio-text)]">Formula Preview</h2>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-medium uppercase tracking-wider text-[var(--studio-text-muted)]">Test Context (JSON)</label>
            <textarea
              value={previewContext}
              onChange={(e) => { setPreviewContext(e.target.value); }}
              rows={5}
              className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg)] px-4 py-3 font-mono text-sm text-[var(--studio-text-secondary)] outline-none transition-all duration-200 placeholder:text-[var(--studio-text-muted)] focus:border-[var(--studio-accent-violet)] focus:shadow-[0_0_12px_var(--studio-accent-violet-dim)]"
            />
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => { void handlePreview(); }}
              disabled={isPreviewing || form.estimateFormula.trim().length === 0}
              className="rounded-lg border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-4 py-2 text-xs text-[var(--studio-text-secondary)] transition-all duration-200 hover:bg-[var(--studio-bg-elevated)] hover:text-[var(--studio-text)] disabled:opacity-40"
            >
              {isPreviewing ? "Computing..." : "미리보기"}
            </button>

            {previewResult !== null ? (
              <div className="flex items-center gap-2 rounded-lg bg-[var(--studio-accent-amber-dim)] px-4 py-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--studio-accent-amber)]">예상 크레딧</span>
                <span className="font-mono text-lg font-semibold text-[var(--studio-accent-amber)] drop-shadow-[0_0_8px_var(--studio-accent-amber-dim)]">
                  {previewResult.estimatedCredits}
                </span>
              </div>
            ) : null}
          </div>

          {previewError.length > 0 ? (
            <div className="rounded-lg border border-[var(--studio-accent-rose)]/30 bg-[var(--studio-accent-rose-dim)] px-4 py-3 text-xs text-[var(--studio-accent-rose)]">{previewError}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
