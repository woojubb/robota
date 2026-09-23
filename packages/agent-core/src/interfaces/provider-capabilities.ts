export interface IProviderFunctionCallingCapability {
  supported: boolean;
  reason?: string;
}

export interface IProviderNativeWebToolCapability {
  supported: boolean;
  enabled: boolean;
  source?: string;
  reason?: string;
}

export interface IProviderNativeWebToolCapabilities {
  webSearch: IProviderNativeWebToolCapability;
  webFetch: IProviderNativeWebToolCapability;
}

export interface IProviderCapabilities {
  functionCalling: IProviderFunctionCallingCapability;
  nativeWebTools: IProviderNativeWebToolCapabilities;
}

export interface IProviderNativeWebToolRequest {
  webSearch?: boolean;
  webFetch?: boolean;
}

const DEFAULT_NATIVE_WEB_SEARCH_REASON = 'Provider does not declare native web search support.';
const DEFAULT_NATIVE_WEB_FETCH_REASON = 'Provider does not declare native web fetch support.';

export function createDefaultProviderCapabilities(
  functionCallingSupported: boolean,
): IProviderCapabilities {
  return {
    functionCalling: { supported: functionCallingSupported },
    nativeWebTools: {
      webSearch: {
        supported: false,
        enabled: false,
        reason: DEFAULT_NATIVE_WEB_SEARCH_REASON,
      },
      webFetch: {
        supported: false,
        enabled: false,
        reason: DEFAULT_NATIVE_WEB_FETCH_REASON,
      },
    },
  };
}

// NOTE:
// `getProviderCapabilities` moved to `./provider.ts` (it takes an `IAIProvider`, and defining it
// here required importing `./provider`, while `provider.ts` imports this module's types —
// a module-level import cycle). Re-exported from `./provider` under the same name.

export function assertProviderNativeWebToolsAvailable(
  providerName: string,
  capabilities: IProviderCapabilities,
  request: IProviderNativeWebToolRequest | undefined,
): void {
  if (request?.webSearch === true) {
    assertNativeWebToolAvailable(providerName, 'web search', capabilities.nativeWebTools.webSearch);
  }
  if (request?.webFetch === true) {
    assertNativeWebToolAvailable(providerName, 'web fetch', capabilities.nativeWebTools.webFetch);
  }
}

function assertNativeWebToolAvailable(
  providerName: string,
  label: string,
  capability: IProviderNativeWebToolCapability,
): void {
  if (!capability.supported) {
    throw new Error(
      `Provider ${providerName} does not support native ${label}.${formatCapabilityReason(capability.reason)}`,
    );
  }
  if (!capability.enabled) {
    throw new Error(
      `Provider ${providerName} supports native ${label} but it is not enabled.${formatCapabilityReason(capability.reason)}`,
    );
  }
}

function formatCapabilityReason(reason: string | undefined): string {
  return reason ? ` ${reason}` : '';
}
