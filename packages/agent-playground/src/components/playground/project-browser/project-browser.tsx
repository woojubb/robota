'use client';

import { ProjectBrowserFilters } from './project-browser-filters';
import { ProjectBrowserHeader } from './project-browser-header';
import { ProjectGrid } from './project-grid';
import type { IProjectBrowserProps } from './types';
import { useProjectBrowserState } from './use-project-browser-state';

export function ProjectBrowser({
  onSelectProject,
  onCreateNew,
  currentProjectId,
}: IProjectBrowserProps) {
  const state = useProjectBrowserState({ onSelectProject });

  return (
    <div className="space-y-6">
      <ProjectBrowserHeader state={state} />
      <ProjectBrowserFilters state={state} />
      <ProjectGrid
        state={state}
        currentProjectId={currentProjectId}
        onSelectProject={onSelectProject}
        onCreateNew={onCreateNew}
      />
    </div>
  );
}
