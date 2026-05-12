const FALLBACK_PROFILE_NAME = 'provider';
const FIRST_DUPLICATE_SUFFIX = 2;

export interface IProviderProfileNameSuggestionInput {
  type: string;
}

export interface IProviderProfileNameSuggestionOptions {
  existingProfileNames?: readonly string[];
}

export function suggestProviderProfileName(
  input: IProviderProfileNameSuggestionInput,
  options: IProviderProfileNameSuggestionOptions = {},
): string {
  const baseName = sanitizeProviderProfileName(input.type) ?? FALLBACK_PROFILE_NAME;
  const existing = new Set(options.existingProfileNames ?? []);
  if (!existing.has(baseName)) {
    return baseName;
  }

  let suffix = FIRST_DUPLICATE_SUFFIX;
  while (existing.has(`${baseName}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseName}-${suffix}`;
}

export function sanitizeProviderProfileName(value: string | undefined): string | undefined {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized !== undefined && normalized.length > 0 ? normalized : undefined;
}
