const ENV_REFERENCE_PREFIX = '$ENV:';

export function isEnvReference(value: string): boolean {
  return value.startsWith(ENV_REFERENCE_PREFIX);
}

export function getEnvReferenceName(value: string): string | undefined {
  if (!isEnvReference(value)) {
    return undefined;
  }
  const envName = value.slice(ENV_REFERENCE_PREFIX.length).trim();
  return envName.length > 0 ? envName : undefined;
}

export function resolveEnvReference(value: string): string | undefined {
  const envName = getEnvReferenceName(value);
  if (envName === undefined) {
    return value;
  }
  const resolved = process.env[envName];
  return resolved !== undefined && resolved.length > 0 ? resolved : undefined;
}

export function hasUsableSecretReference(value: string | undefined): boolean {
  if (value === undefined || value.length === 0) {
    return false;
  }
  return resolveEnvReference(value) !== undefined;
}
