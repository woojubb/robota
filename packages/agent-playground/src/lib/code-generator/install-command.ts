import { toPackageName } from '../provider-packages';
import { requireProviderTemplate } from './provider-templates';

/** The npm install command for the packages the generated code imports. */
export function getInstallCommand(provider: string): string {
  const providerPackage = toPackageName(requireProviderTemplate(provider).importPath);
  return `npm install @robota-sdk/agent-framework ${providerPackage}`;
}
