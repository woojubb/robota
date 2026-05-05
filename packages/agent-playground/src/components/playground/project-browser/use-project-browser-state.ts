import type { IProjectBrowserProps, IProjectBrowserState } from './types';
import { useProjectDialogs } from './use-project-dialogs';
import { useProjectFilters } from './use-project-filters';
import { useProjectList } from './use-project-list';

export function useProjectBrowserState({
  onSelectProject,
}: Pick<IProjectBrowserProps, 'onSelectProject'>): IProjectBrowserState {
  const { projects, setProjects } = useProjectList();
  const filterState = useProjectFilters(projects);
  const dialogState = useProjectDialogs({ setProjects, onSelectProject });

  return {
    ...filterState,
    ...dialogState,
  };
}
