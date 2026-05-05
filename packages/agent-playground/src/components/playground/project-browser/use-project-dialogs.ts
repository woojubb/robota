import { useState } from 'react';
import { useToast } from '../../../hooks/use-toast';
import type { IPlaygroundProject } from '../../../lib/playground/project-manager';
import {
  createProjectFromDraft,
  deleteProjectById,
  exportProjectFile,
  importProjectFromData,
} from './project-browser-actions';
import type { IProjectDraft } from './types';

const EMPTY_PROJECT_DRAFT: IProjectDraft = {
  name: '',
  description: '',
  provider: 'openai',
};

export function useProjectDialogs(options: {
  setProjects: React.Dispatch<React.SetStateAction<IPlaygroundProject[]>>;
  onSelectProject: (project: IPlaygroundProject) => void;
}) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [newProject, setNewProject] = useState<IProjectDraft>(EMPTY_PROJECT_DRAFT);
  const [importData, setImportData] = useState('');
  const { toast } = useToast();

  return {
    isCreateDialogOpen,
    setIsCreateDialogOpen,
    isImportDialogOpen,
    setIsImportDialogOpen,
    newProject,
    setNewProject,
    importData,
    setImportData,
    handleCreateProject: () =>
      createProjectFromDraft({
        ...options,
        newProject,
        setIsCreateDialogOpen,
        setNewProject,
        toast,
      }),
    handleImportProject: () =>
      importProjectFromData({
        ...options,
        importData,
        setIsImportDialogOpen,
        setImportData,
        toast,
      }),
    handleDeleteProject: (projectId: string, projectName: string) =>
      deleteProjectById({ projectId, projectName, setProjects: options.setProjects, toast }),
    handleExportProject: (project: IPlaygroundProject) => exportProjectFile(project, toast),
  };
}
