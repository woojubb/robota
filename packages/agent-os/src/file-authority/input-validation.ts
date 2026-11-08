import { resolve } from 'node:path';

import { authorityError } from './contracts.js';

export function validateRootDirectory(rootDirectory: string): string {
  if (
    typeof rootDirectory !== 'string' ||
    rootDirectory.trim().length === 0 ||
    rootDirectory.includes('\0')
  ) {
    throw authorityError('INVALID_PATH', 'validate-root');
  }
  return resolve(rootDirectory);
}

export function validateRelativeSegments(relativeSegments: readonly string[]): void {
  if (!Array.isArray(relativeSegments) || relativeSegments.length === 0) {
    throw authorityError('INVALID_PATH', 'validate-segments');
  }
  for (let index = 0; index < relativeSegments.length; index += 1) {
    const segment = relativeSegments[index];
    if (
      typeof segment !== 'string' ||
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('\0') ||
      segment.includes('/') ||
      segment.includes('\\')
    ) {
      throw authorityError('INVALID_PATH', 'validate-segments', { segmentIndex: index });
    }
  }
}

export function validateReadBudget(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw authorityError('INVALID_PATH', 'validate-budget');
  }
}
