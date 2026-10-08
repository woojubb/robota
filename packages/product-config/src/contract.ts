import { executableName as command } from './executable-name.mjs';

export type TConfigEnvironment = Readonly<Record<string, string | undefined>>;
export type TConfigExposure = 'public' | 'host' | 'private';
export type TConfigPhase = 'identity' | 'operational';
export type TConfigConsumer = 'build' | 'cli' | 'desktop' | 'web' | 'release' | 'deploy';

/** Configuration failures name the input, never its potentially private value. */
export class ProductConfigError extends Error {
  constructor(readonly variable: string, reason: string) {
    super(`${variable}: ${reason}`);
    this.name = 'ProductConfigError';
  }
}

interface ISettingMetadata {
  readonly phase: TConfigPhase;
  readonly exposure: TConfigExposure;
  readonly consumers: readonly TConfigConsumer[];
  readonly path?: boolean;
  readonly alias?: false;
  readonly defaultValue?: string;
}

export interface IProductSetting<T = unknown> extends ISettingMetadata {
  readonly variable: string;
  readonly description: string;
  readonly format: string;
  readonly required: boolean;
  readonly parse: (value: string) => T;
}

type TParser<T> = (value: string) => T;

function setting<T, const M extends ISettingMetadata>(
  variable: string,
  description: string,
  format: string,
  parser: TParser<T>,
  metadata: M,
) {
  return Object.freeze({
    variable, description, format, required: true, ...metadata, parse: parser,
  });
}

function optional<T, const M extends ISettingMetadata>(
  variable: string,
  description: string,
  format: string,
  parser: TParser<T>,
  metadata: M,
) {
  return Object.freeze({
    variable, description, format, required: false, ...metadata,
    parse: (value: string): T | undefined => value.trim() === '' ? undefined : parser(value),
  });
}

const text = (value: string): string => {
  if (!value.trim() || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) throw new Error('expected non-empty printable text');
  return value.trim();
};
const namespace = (value: string): string => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) throw new Error('expected a namespace of letters, numbers, dots, underscores or hyphens');
  return value;
};
const environmentPrefix = (value: string): string => {
  if (!/^[A-Z][A-Z0-9_]*_$/u.test(value)) throw new Error('expected an uppercase environment prefix ending in underscore');
  return value;
};
const packageScope = (value: string): string => {
  if (!/^@[a-z0-9][a-z0-9._-]*$/u.test(value)) throw new Error('expected a lowercase npm scope beginning with @');
  return value;
};
const appId = (value: string): string => {
  if (!/^[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/u.test(value)) throw new Error('expected a dotted application identifier');
  return value;
};
const protocolScheme = (value: string): string => {
  if (!/^[a-z][a-z0-9+.-]*$/u.test(value)) throw new Error('expected a lowercase URI scheme');
  return value;
};
const path = (value: string): string => text(value);
const projectDirectory = (value: string): string => {
  const result = path(value).replace(/\\/gu, '/');
  if (/^(?:\/|[A-Za-z]:|~|\$)/u.test(result) || result.includes('/') || result === '.' || result === '..') {
    throw new Error('expected one workspace-relative directory segment without traversal');
  }
  return result;
};
const url = (schemes: readonly string[]): TParser<string> => (value) => {
  const parsed = new URL(value);
  if (!schemes.includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash) {
    throw new Error('expected an absolute supported URL without credentials or fragment');
  }
  return parsed.href;
};
const homeRelativePath = (value: string): string => {
  const result = text(value).replace(/\\/gu, '/');
  if (
    /^(?:\/|[A-Za-z]:|~|\$)/u.test(result) ||
    result.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('expected a relative path without traversal');
  }
  return result;
};
const userSettingsFiles = (value: string): readonly string[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string'))
    throw new Error('expected relative file paths');
  return Object.freeze(parsed.map((entry: string) => homeRelativePath(entry)));
};
const projectSettingsFiles = (
  value: string,
): readonly { readonly scope: 'project' | 'project-local'; readonly relativePath: string }[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) throw new Error('expected project settings paths');
  return Object.freeze(
    parsed.map((entry: unknown) => {
      if (
        typeof entry !== 'object' ||
        entry === null ||
        !('scope' in entry) ||
        !('relativePath' in entry) ||
        (entry.scope !== 'project' && entry.scope !== 'project-local') ||
        typeof entry.relativePath !== 'string' ||
        Object.keys(entry).some((key) => key !== 'scope' && key !== 'relativePath')
      )
        throw new Error('expected project settings paths');
      return Object.freeze({
        scope: entry.scope,
        relativePath: homeRelativePath(entry.relativePath),
      });
    }),
  );
};
const webUrl = url(['https:', 'http:']);
const signalingUrl = url(['https:', 'http:', 'wss:', 'ws:']);
const derivationPath = (value: string): readonly number[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 255 ||
    !parsed.every((index) => typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < 0x80000000)) {
    throw new Error('expected a non-empty JSON array of hardened child indices from 0 through 2147483647');
  }
  return Object.freeze([...parsed] as number[]);
};
const packageAccess = (value: string): 'public' | 'restricted' => {
  if (value !== 'public' && value !== 'restricted') throw new Error('expected public or restricted');
  return value;
};

const publicIdentity = Object.freeze({ phase: 'identity', exposure: 'public', consumers: ['build', 'cli', 'desktop', 'web'] } as const);
const hostIdentity = Object.freeze({ phase: 'identity', exposure: 'host', consumers: ['build', 'cli', 'desktop'] } as const);
const hostOperation = Object.freeze({ phase: 'operational', exposure: 'host', consumers: ['build', 'cli', 'desktop'] } as const);
const publicOperation = Object.freeze({ phase: 'operational', exposure: 'public', consumers: ['build', 'cli', 'desktop', 'web'] } as const);
const releaseOperation = Object.freeze({ phase: 'operational', exposure: 'host', consumers: ['build', 'release'] } as const);
const deployOperation = Object.freeze({ phase: 'operational', exposure: 'host', consumers: ['build', 'deploy'] } as const);

/** The sole contract for variable names, parsing, documentation and exposure. */
export const PRODUCT_CONFIG_DESCRIPTORS = Object.freeze({
  identity: Object.freeze({
    id: setting('PRODUCT_ID', 'Product diagnostic identifier.', 'namespace', namespace, publicIdentity),
    displayName: setting('PRODUCT_DISPLAY_NAME', 'User-visible product name.', 'text', text, publicIdentity),
    cliName: setting('PRODUCT_CLI_NAME', 'Installed CLI executable name.', 'executable name', command, publicIdentity),
    envPrefix: setting('PRODUCT_ENV_PREFIX', 'External user-setting alias prefix; never aliases this input or config-file selection.', 'uppercase prefix ending in _', environmentPrefix, { ...publicIdentity, alias: false }),
    packageScope: setting('PRODUCT_PACKAGE_SCOPE', 'External generated package scope.', 'npm scope', packageScope, publicIdentity),
    repositoryUrl: optional('PROJECT_REPOSITORY_URL', 'Repository URL; absent omits repository links.', 'HTTP URL', webUrl, publicIdentity),
    websiteUrl: optional('PROJECT_HOMEPAGE_URL', 'Website URL; absent omits website links.', 'HTTP URL', webUrl, publicIdentity),
    docsUrl: optional('PROJECT_DOCS_URL', 'Documentation URL; absent omits documentation links.', 'HTTP URL', webUrl, publicIdentity),
    blogUrl: optional('PROJECT_BLOG_URL', 'Blog URL; absent omits blog links.', 'HTTP URL', webUrl, publicIdentity),
    appId: setting('PRODUCT_APP_ID', 'Installed desktop application identifier.', 'dotted application identifier', appId, publicIdentity),
    protocolScheme: setting('PRODUCT_PROTOCOL_SCHEME', 'Installed product launch URI scheme.', 'URI scheme', protocolScheme, publicIdentity),
    telemetryServiceName: setting('PRODUCT_TELEMETRY_SERVICE_NAME', 'Product service identity attached to telemetry resources.', 'namespace', namespace, hostIdentity),
    daemonNamespace: setting('PRODUCT_DAEMON_NAMESPACE', 'Local daemon, rendezvous and control-pipe namespace.', 'namespace', namespace, hostIdentity),
    desktopExecutableName: setting('PRODUCT_DESKTOP_EXECUTABLE', 'Bundled desktop runtime executable basename.', 'executable name', command, hostIdentity),
    mcpClientName: setting('PRODUCT_MCP_CLIENT_NAME', 'Product identity sent to MCP servers.', 'namespace', namespace, hostIdentity),
    modelCommandToolPrefix: setting('PRODUCT_MODEL_TOOL_PREFIX', 'Prefix for model-visible command and result-retrieval tools.', 'namespace', namespace, hostIdentity),
    promptFileReferenceTag: setting('PRODUCT_PROMPT_TAG', 'Model-visible workspace file-reference enclosure tag.', 'namespace', namespace, hostIdentity),
    editorTemporaryDirectoryPrefix: setting('PRODUCT_EDITOR_TEMP_PREFIX', 'Temporary editor directory prefix selected by the host.', 'namespace', namespace, hostIdentity),
  }),
  build: Object.freeze({
    defaultUserRoot: optional(
      'PRODUCT_DEFAULT_USER_STATE_DIR',
      'Non-secret artifact default relative to the invocation home.',
      'home-relative path',
      homeRelativePath,
      { ...hostOperation, consumers: ['build'] },
    ),
    defaultCacheRoot: optional(
      'PRODUCT_DEFAULT_CACHE_DIR',
      'Non-secret cache default relative to the invocation home.',
      'home-relative path',
      homeRelativePath,
      { ...hostOperation, consumers: ['build'] },
    ),
    defaultLogRoot: optional(
      'PRODUCT_DEFAULT_LOG_DIR',
      'Non-secret log default relative to the invocation home.',
      'home-relative path',
      homeRelativePath,
      { ...hostOperation, consumers: ['build'] },
    ),
    defaultProjectDirectory: optional(
      'PRODUCT_DEFAULT_PROJECT_STATE_DIR',
      'Artifact default for trusted project state.',
      'relative directory',
      projectDirectory,
      { ...hostOperation, consumers: ['build'] },
    ),
  }),
  settings: Object.freeze({
    sharedUserFiles: setting(
      'PRODUCT_SHARED_USER_SETTINGS',
      'Shared home-relative user settings files; [] disables shared user settings.',
      'JSON relative file array',
      userSettingsFiles,
      { ...hostOperation, defaultValue: '[".claude/settings.json"]' },
    ),
    sharedProjectFiles: setting(
      'PRODUCT_SHARED_PROJECT_SETTINGS',
      'Shared workspace-relative settings sources; [] disables shared project settings.',
      'JSON scoped relative file array',
      projectSettingsFiles,
      {
        ...hostOperation,
        defaultValue:
          '[{"scope":"project","relativePath":".claude/settings.json"},{"scope":"project-local","relativePath":".claude/settings.local.json"}]',
      },
    ),
  }),
  storage: Object.freeze({
    userRoot: setting('PRODUCT_USER_STATE_DIR', 'Selected user state root; relative input is resolved against the selected file directory.', 'path', path, { ...hostOperation, path: true }),
    projectDirectory: setting('PRODUCT_PROJECT_STATE_DIR', 'Product state directory relative to the trusted workspace.', 'relative directory', projectDirectory, hostOperation),
    cacheRoot: setting('PRODUCT_CACHE_DIR', 'Selected host cache root.', 'path', path, { ...hostOperation, path: true }),
    logRoot: setting('PRODUCT_LOG_DIR', 'Selected host log root.', 'path', path, { ...hostOperation, path: true }),
    browserNamespace: setting('PRODUCT_BROWSER_NAMESPACE', 'Browser draft and session-restore storage namespace.', 'namespace', namespace, publicIdentity),
    browserCredentialDatabase: setting('PRODUCT_BROWSER_CREDENTIAL_DATABASE', 'Browser credential IndexedDB database name.', 'namespace', namespace, publicIdentity),
  }),
  credentials: Object.freeze({
    serviceNamespace: setting('PRODUCT_CREDENTIAL_SERVICE', 'OS credential service namespace; fixed purposes are appended by the host.', 'namespace', namespace, hostIdentity),
  }),
  crypto: Object.freeze({
    namespace: setting('PRODUCT_CRYPTO_NAMESPACE', 'Public cryptographic domain label shared with protocol peers; unrelated to display name or key material.', 'namespace', namespace, publicIdentity),
    masterKeyDerivationPath: setting('SECURITY_MASTER_KEY_DERIVATION_PATH', 'Hardened master-key child indices; the derivation implementation applies the hardened bit.', 'JSON integer array', derivationPath, hostIdentity),
  }),
  services: Object.freeze({
    analyticsMeasurementId: optional('SERVICE_ANALYTICS_MEASUREMENT_ID', 'Optional Google Analytics measurement account; absent disables site tracking.', 'GA4 measurement ID', (value: string): string => {
      if (!/^G-[A-Z0-9]+$/u.test(value)) throw new Error('expected a GA4 measurement ID');
      return value;
    }, publicOperation),
    signalingUrl: optional('SERVICE_SIGNALING_URL', 'Signaling endpoint; required by callers before remote connectivity.', 'HTTP or WebSocket URL', signalingUrl, publicOperation),
    remoteClientUrl: optional('SERVICE_REMOTE_CLIENT_URL', 'Browser remote client endpoint; required before generating remote-client links.', 'HTTP URL', webUrl, publicOperation),
  }),
  release: Object.freeze({
    artifactPrefix: optional('PRODUCT_ARTIFACT_PREFIX', 'Generated installation and release filename prefix.', 'namespace', namespace, { ...hostIdentity, consumers: ['build', 'release'] }),
    version: optional('PROJECT_RELEASE_VERSION', 'Optional pinned installation version or full release tag.', 'version or tag', text, releaseOperation),
    tagPrefix: optional('PROJECT_RELEASE_TAG_PREFIX', 'Release tag prefix used in tags and workflow patterns.', 'letters, numbers, dots, underscores or hyphens', namespace, releaseOperation),
    channel: optional('PROJECT_RELEASE_CHANNEL', 'Release and update channel.', 'namespace', namespace, releaseOperation),
    baseUrl: optional('PROJECT_RELEASE_BASE_URL', 'Release download base URL.', 'HTTP URL', webUrl, releaseOperation),
    updateMetadataUrl: optional('PROJECT_UPDATE_METADATA_URL', 'Update metadata URL.', 'HTTP URL', webUrl, releaseOperation),
    installScriptUrl: optional('PROJECT_INSTALL_SCRIPT_URL', 'Installation script URL.', 'HTTP URL', webUrl, releaseOperation),
    npmRegistryUrl: optional('PROJECT_NPM_REGISTRY_URL', 'Explicit package publication registry.', 'HTTP URL', webUrl, releaseOperation),
    packageAccess: optional('PROJECT_PACKAGE_ACCESS', 'Published package access policy.', 'public or restricted', packageAccess, releaseOperation),
  }),
  deploy: Object.freeze({
    environment: optional('DEPLOY_ENVIRONMENT', 'Deployment environment selection.', 'namespace', namespace, deployOperation),
    projectName: optional('DEPLOY_PROJECT_NAME', 'Application deployment project.', 'namespace', namespace, deployOperation),
    docsProjectName: optional('DEPLOY_DOCS_PROJECT_NAME', 'Documentation deployment project.', 'namespace', namespace, deployOperation),
    blogProjectName: optional('DEPLOY_BLOG_PROJECT_NAME', 'Blog deployment project.', 'namespace', namespace, deployOperation),
    workerName: optional('DEPLOY_WORKER_NAME', 'Worker deployment name.', 'namespace', namespace, deployOperation),
    accountId: optional('DEPLOY_ACCOUNT_ID', 'Deployment account reference.', 'text', text, deployOperation),
    domain: optional('DEPLOY_DOMAIN', 'Registered deployment domain reference.', 'text', text, deployOperation),
    route: optional('DEPLOY_ROUTE', 'Deployment route reference.', 'text', text, deployOperation),
  }),
});

type TContract = typeof PRODUCT_CONFIG_DESCRIPTORS;
export type IProductConfig = {
  readonly [S in keyof TContract]: {
    readonly [F in keyof TContract[S]]: TContract[S][F] extends IProductSetting<infer T> ? T : never;
  };
};

type TFilteredConfig<K extends 'exposure' | 'phase', V> = {
  readonly [S in keyof TContract as {
    [F in keyof TContract[S]]: TContract[S][F] extends Record<K, V> ? F : never;
  }[keyof TContract[S]] extends never ? never : S]: {
    readonly [F in keyof TContract[S] as TContract[S][F] extends Record<K, V> ? F : never]:
      TContract[S][F] extends IProductSetting<infer T> ? T : never;
  };
};

export type IPublicProductConfig = TFilteredConfig<'exposure', 'public'>;
export type IHostProductConfig = TFilteredConfig<'exposure', 'public' | 'host'>;
export type IEmbeddedProductIdentity = TFilteredConfig<'phase', 'identity'>;

export const PRODUCT_CONFIG_FILE_VARIABLE = 'PRODUCT_CONFIG_FILE';

export interface IProductConfigEntry {
  readonly section: keyof IProductConfig;
  readonly field: string;
  readonly descriptor: IProductSetting;
}

/** Descriptor enumeration for host and build consumers, without duplicated key lists. */
export function productConfigEntries(): readonly IProductConfigEntry[] {
  return Object.freeze(Object.entries(PRODUCT_CONFIG_DESCRIPTORS).flatMap(([section, fields]) =>
    Object.entries(fields).map(([field, descriptor]) => Object.freeze({
      section: section as keyof IProductConfig, field, descriptor,
    })),
  ));
}

/** Product aliases apply to external setting names, never to bootstrap selectors. */
export function productSettingAlias(descriptor: IProductSetting, prefix: string): string | undefined {
  if (descriptor.alias === false) return undefined;
  return `${prefix}${descriptor.variable.replace(/^(?:PRODUCT|PROJECT|SERVICE|SECURITY|DEPLOY)_/u, '')}`;
}

/** A tracked guidance file, derived from the same contract used by the resolver. */
export function generateDefaultEnvironment(): string {
  const rows = [
    '# Generated product configuration contract. Product-specific values must be supplied explicitly.',
    '# Empty required values fail. Empty optional values disable that reference.',
    '# Relative host paths use the selected config file directory; no working-directory discovery.',
    '# Explicit config-file selector (no alias; host-only path).',
    `${PRODUCT_CONFIG_FILE_VARIABLE}=`, '',
  ];
  for (const { section, field, descriptor } of productConfigEntries()) {
    rows.push(
      `# ${section}.${field}: ${descriptor.description}`,
      `# ${descriptor.required ? 'Required' : 'Optional'}; ${descriptor.format}; ${descriptor.phase}; ${descriptor.exposure}; consumers: ${descriptor.consumers.join(', ')}`,
      `# Alias: ${descriptor.alias === false ? 'none (bootstrap)' : `<PRODUCT_ENV_PREFIX>${descriptor.variable.replace(/^(?:PRODUCT|PROJECT|SERVICE|SECURITY|DEPLOY)_/u, '')}`}`,
      `${descriptor.variable}=${descriptor.defaultValue ?? ''}`, '',
    );
  }
  return `${rows.join('\n').trimEnd()}\n`;
}
