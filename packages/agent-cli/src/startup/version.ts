import { readPackageVersion } from '@robota-sdk/agent-framework';

export const readVersion = (): string => readPackageVersion(import.meta.url);
