import { useMemo, useState } from 'react';
import type { IPlaygroundProject } from '../../../lib/playground/project-manager';
import { filterAndSortProjects, parseProviderFilterValue } from './project-browser-utils';
import type { TProjectProviderFilter, TProjectSortKey } from './types';

export function useProjectFilters(projects: IPlaygroundProject[]) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<TProjectSortKey>('modified');
  const [filterProvider, setFilterProvider] = useState<TProjectProviderFilter>('all');

  const filteredAndSortedProjects = useMemo(
    () => filterAndSortProjects(projects, searchTerm, sortBy, filterProvider),
    [projects, searchTerm, sortBy, filterProvider],
  );

  return {
    filteredAndSortedProjects,
    searchTerm,
    setSearchTerm,
    sortBy,
    setSortBy,
    filterProvider,
    handleFilterProviderChange: (value: string) =>
      setFilterProvider(parseProviderFilterValue(value)),
  };
}
