import type { IPlaygroundProject } from '../../../lib/playground/project-manager';
import type { TProjectProviderFilter, TProjectSortKey } from './types';

export function parseProviderFilterValue(value: string): TProjectProviderFilter {
  if (value === 'all') {
    return 'all';
  }
  if (value !== 'openai' && value !== 'anthropic' && value !== 'google') {
    throw new Error(`[PLAYGROUND] Invalid provider filter value: "${value}"`);
  }
  return value;
}

export function filterAndSortProjects(
  projects: IPlaygroundProject[],
  searchTerm: string,
  sortBy: TProjectSortKey,
  filterProvider: TProjectProviderFilter,
): IPlaygroundProject[] {
  return projects
    .filter((project) => {
      const normalizedSearch = searchTerm.toLowerCase();
      const matchesSearch =
        project.name.toLowerCase().includes(normalizedSearch) ||
        (project.description || '').toLowerCase().includes(normalizedSearch);
      const matchesProvider = filterProvider === 'all' || project.provider === filterProvider;
      return matchesSearch && matchesProvider;
    })
    .sort((a, b) => compareProjects(a, b, sortBy));
}

function compareProjects(
  a: IPlaygroundProject,
  b: IPlaygroundProject,
  sortBy: TProjectSortKey,
): number {
  switch (sortBy) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'created':
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    case 'modified':
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    default:
      return 0;
  }
}

export function getProviderIcon(provider: string): string {
  switch (provider) {
    case 'openai':
      return '🤖';
    case 'anthropic':
      return '🧠';
    case 'google':
      return '🔍';
    default:
      return '⚡';
  }
}

export function formatProjectDate(date: string | Date): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return dateObj.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
