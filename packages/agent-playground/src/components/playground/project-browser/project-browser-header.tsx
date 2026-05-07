import { CreateProjectDialog } from './create-project-dialog';
import { ImportProjectDialog } from './import-project-dialog';
import type { IProjectBrowserState } from './types';

interface IProjectBrowserHeaderProps {
  state: IProjectBrowserState;
}

export function ProjectBrowserHeader({ state }: IProjectBrowserHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-2xl font-bold">Projects</h2>
        <p className="text-muted-foreground">Manage your Robota playground projects</p>
      </div>
      <div className="flex space-x-2">
        <ImportProjectDialog
          open={state.isImportDialogOpen}
          onOpenChange={state.setIsImportDialogOpen}
          importData={state.importData}
          onImportDataChange={state.setImportData}
          onImport={state.handleImportProject}
        />
        <CreateProjectDialog
          open={state.isCreateDialogOpen}
          onOpenChange={state.setIsCreateDialogOpen}
          newProject={state.newProject}
          onNewProjectChange={state.setNewProject}
          onCreate={state.handleCreateProject}
        />
      </div>
    </div>
  );
}
