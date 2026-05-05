import { ScrollArea } from '../../ui/scroll-area';
import type { IPlaygroundProject } from '../../../lib/playground/project-manager';
import { ProjectCard } from './project-card';
import { ProjectEmptyState } from './project-empty-state';
import type { IProjectBrowserState } from './types';

interface IProjectGridProps {
  state: IProjectBrowserState;
  currentProjectId?: string;
  onSelectProject: (project: IPlaygroundProject) => void;
  onCreateNew: () => void;
}

export function ProjectGrid({
  state,
  currentProjectId,
  onSelectProject,
  onCreateNew,
}: IProjectGridProps) {
  return (
    <ScrollArea className="h-[600px]">
      {state.filteredAndSortedProjects.length === 0 ? (
        <ProjectEmptyState searchTerm={state.searchTerm} onCreateNew={onCreateNew} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {state.filteredAndSortedProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isCurrent={currentProjectId === project.id}
              onSelectProject={onSelectProject}
              onExportProject={state.handleExportProject}
              onDeleteProject={state.handleDeleteProject}
            />
          ))}
        </div>
      )}
    </ScrollArea>
  );
}
