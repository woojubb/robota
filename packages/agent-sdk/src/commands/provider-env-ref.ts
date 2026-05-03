const ENV_REFERENCE_PREFIX = '$ENV:';

export function isEnvReference(value: string): boolean {
  return value.startsWith(ENV_REFERENCE_PREFIX);
}

export function formatEnvReference(name: string): string {
  return `${ENV_REFERENCE_PREFIX}${name}`;
}

export function resolveEnvReference(value: string): string | undefined {
  if (!isEnvReference(value)) {
    return value;
  }
  const envName = value.slice(ENV_REFERENCE_PREFIX.length).trim();
  if (envName.length === 0) {
    return undefined;
  }
  return process.env[envName];
}

export function hasUsableSecretReference(value: string | undefined): boolean {
  if (value === undefined || value.length === 0) {
    return false;
  }
  return resolveEnvReference(value) !== undefined;
}
