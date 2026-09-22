function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function valuesEqual(left, right) {
  return stableJson(left) === stableJson(right);
}

export function changedManifestKeys(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return Array.from(keys).filter((key) => !valuesEqual(before?.[key], after?.[key]));
}

// These commands are local authoring conveniences only. CI, product execution, build, test,
// release, and affected-scope entrypoints deliberately do not qualify by prefix or suffix.
const DEVELOPER_QUALITY_SCRIPT_NAMES = new Set([
  'harness:cleanup',
  'harness:lessons:digest',
  'harness:plan',
  'harness:record',
  'harness:review',
  'harness:run-context',
  'lint:fix',
  'lint:fix:staged',
]);

function isDeveloperQualityScript(name) {
  return DEVELOPER_QUALITY_SCRIPT_NAMES.has(name);
}

export function classifyRootManifestChange({ before, after }) {
  const changedKeys = changedManifestKeys(before, after);
  const changedScriptKeys =
    changedKeys.length === 1 && changedKeys[0] === 'scripts'
      ? changedManifestKeys(before?.scripts ?? {}, after?.scripts ?? {})
      : [];
  const developerQualityOnly =
    changedScriptKeys.length > 0 && changedScriptKeys.every((key) => isDeveloperQualityScript(key));

  return {
    kind: developerQualityOnly ? 'developer-quality-only' : 'workspace-wide',
    changedKeys,
    changedScriptKeys,
    workspaceWide: !developerQualityOnly,
  };
}
