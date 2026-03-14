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
      <div className="min-h-screen bg-white p-6">
        <div className="mx-auto w-full max-w-3xl">
          <p className="text-xs text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white p-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link
            href="/dag-designer/cost-management"
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            &larr; Cost Management
          </Link>
          <h1 className="text-lg font-semibold text-gray-800">
            {isCreateMode ? "New Cost Meta" : `Edit: ${nodeTypeParam}`}
          </h1>
        </div>

        {/* Messages */}
        {errorMessage.length > 0 ? (
          <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{errorMessage}</div>
        ) : null}
        {successMessage.length > 0 ? (
          <div className="rounded border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700">{successMessage}</div>
        ) : null}

        {/* Form */}
        <div className="flex flex-col gap-4 rounded border border-gray-300 p-4">
          {/* nodeType */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-gray-600">Node Type</label>
            <input
              type="text"
              value={form.nodeType}
              onChange={(e) => { updateField("nodeType", e.target.value); }}
              disabled={!isCreateMode}
              placeholder="e.g. openai-gpt4o"
              className="rounded border border-gray-300 px-3 py-2 font-mono text-xs text-gray-800 disabled:bg-gray-100 disabled:text-gray-500"
            />
          </div>

          {/* displayName */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-gray-600">Display Name</label>
            <input
              type="text"
              value={form.displayName}
              onChange={(e) => { updateField("displayName", e.target.value); }}
              placeholder="e.g. OpenAI GPT-4o"
              className="rounded border border-gray-300 px-3 py-2 text-xs text-gray-800"
            />
          </div>

          {/* category */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-gray-600">Category</label>
            <select
              value={form.category}
              onChange={(e) => { updateField("category", e.target.value); }}
              className="rounded border border-gray-300 px-3 py-2 text-xs text-gray-800"
            >
              {CATEGORY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* estimateFormula */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-semibold text-gray-600">Estimate Formula</label>
              {isValidating ? (
                <span className="text-[10px] text-gray-400">validating...</span>
              ) : estimateValid !== null ? (
                estimateValid.valid ? (
                  <span className="text-[10px] text-green-600">&#10003; valid</span>
                ) : (
                  <span className="text-[10px] text-red-600">&#10007; {estimateValid.error ?? "invalid"}</span>
                )
              ) : null}
            </div>
            <textarea
              value={form.estimateFormula}
              onChange={(e) => { updateField("estimateFormula", e.target.value); }}
              placeholder="e.g. inputTokens * 0.003 + outputTokens * 0.006"
              rows={3}
              className="rounded border border-gray-300 px-3 py-2 font-mono text-xs text-gray-800"
            />
          </div>

          {/* calculateFormula */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-gray-600">Calculate Formula (optional)</label>
            <textarea
              value={form.calculateFormula}
              onChange={(e) => { updateField("calculateFormula", e.target.value); }}
              placeholder="e.g. actualTokens * 0.003"
              rows={3}
              className="rounded border border-gray-300 px-3 py-2 font-mono text-xs text-gray-800"
            />
          </div>

          {/* variables */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-semibold text-gray-600">Variables (JSON)</label>
              {variablesError.length > 0 ? (
                <span className="text-[10px] text-red-600">&#10007; {variablesError}</span>
              ) : null}
            </div>
            <textarea
              value={form.variables}
              onChange={(e) => { updateField("variables", e.target.value); }}
              placeholder='{ "inputTokens": 1000, "outputTokens": 500 }'
              rows={4}
              className="rounded border border-gray-300 px-3 py-2 font-mono text-xs text-gray-800"
            />
          </div>

          {/* enabled */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="enabled-toggle"
              checked={form.enabled}
              onChange={(e) => { updateField("enabled", e.target.checked); }}
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="enabled-toggle" className="text-xs text-gray-700">Enabled</label>
          </div>

          {/* Save */}
          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => { void handleSave(); }}
              disabled={isSaving || form.nodeType.trim().length === 0}
              className="rounded bg-black px-4 py-2 text-xs text-white hover:bg-gray-800 disabled:bg-gray-400"
            >
              {isSaving ? "Saving..." : isCreateMode ? "Create" : "Save"}
            </button>
            <Link
              href="/dag-designer/cost-management"
              className="rounded border border-gray-300 bg-white px-4 py-2 text-xs text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </Link>
          </div>
        </div>

        {/* Preview Section */}
        <div className="flex flex-col gap-3 rounded border border-gray-300 p-4">
          <h2 className="text-sm font-semibold text-gray-700">Formula Preview</h2>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-gray-600">Test Context (JSON)</label>
            <textarea
              value={previewContext}
              onChange={(e) => { setPreviewContext(e.target.value); }}
              rows={5}
              className="rounded border border-gray-300 px-3 py-2 font-mono text-xs text-gray-800"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { void handlePreview(); }}
              disabled={isPreviewing || form.estimateFormula.trim().length === 0}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-xs hover:bg-gray-50 disabled:text-gray-400"
            >
              {isPreviewing ? "Computing..." : "미리보기"}
            </button>

            {previewResult !== null ? (
              <span className="text-xs font-medium text-gray-800">
                예상 크레딧: {previewResult.estimatedCredits}
              </span>
            ) : null}
          </div>

          {previewError.length > 0 ? (
            <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{previewError}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
