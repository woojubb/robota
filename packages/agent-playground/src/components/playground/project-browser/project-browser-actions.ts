import type React from 'react';
import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { IToastProps } from '../../../hooks/use-toast';
import { ProjectManager } from '../../../lib/playground/project-manager';
import type { IPlaygroundProject } from '../../../lib/playground/project-manager';
import type { IProjectDraft } from './types';

type TToast = (props: IToastProps) => void;
type TProjectSetter = React.Dispatch<React.SetStateAction<IPlaygroundProject[]>>;

export function loadProjectList(): IPlaygroundProject[] {
  return ProjectManager.getInstance().getAllProjects();
}

function refreshProjectList(setProjects: TProjectSetter): void {
  setProjects(loadProjectList());
}

export function createProjectFromDraft(options: {
  newProject: IProjectDraft;
  setProjects: TProjectSetter;
  onSelectProject: (project: IPlaygroundProject) => void;
  setIsCreateDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setNewProject: React.Dispatch<React.SetStateAction<IProjectDraft>>;
  toast: TToast;
}): void {
  if (!options.newProject.name.trim()) {
    options.toast({
      title: 'Error',
      description: 'Project name is required',
      variant: 'destructive',
    });
    return;
  }

  const projectManager = ProjectManager.getInstance();
  const project = projectManager.createProject(
    options.newProject.name,
    options.newProject.description,
    { provider: options.newProject.provider },
  );

  options.setProjects(projectManager.getAllProjects());
  options.onSelectProject(project);
  options.setIsCreateDialogOpen(false);
  options.setNewProject({ name: '', description: '', provider: 'openai' });
  options.toast({ title: 'Success', description: 'Project created successfully' });
}

export function deleteProjectById(options: {
  projectId: string;
  projectName: string;
  setProjects: TProjectSetter;
  toast: TToast;
}): void {
  if (window.confirm(`Are you sure you want to delete "${options.projectName}"?`)) {
    ProjectManager.getInstance().deleteProject(options.projectId);
    refreshProjectList(options.setProjects);
    options.toast({ title: 'Success', description: 'Project deleted successfully' });
  }
}

export function exportProjectFile(project: IPlaygroundProject, toast: TToast): void {
  const dataStr = JSON.stringify(project, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${project.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  toast({ title: 'Success', description: 'Project exported successfully' });
}

export function importProjectFromData(options: {
  importData: string;
  setProjects: TProjectSetter;
  onSelectProject: (project: IPlaygroundProject) => void;
  setIsImportDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setImportData: React.Dispatch<React.SetStateAction<string>>;
  toast: TToast;
}): void {
  try {
    const projectData = JSON.parse(options.importData) as TUniversalValue;
    const projectManager = ProjectManager.getInstance();
    const imported = projectManager.importProject(projectData);

    options.setProjects(projectManager.getAllProjects());
    options.onSelectProject(imported);
    options.setIsImportDialogOpen(false);
    options.setImportData('');
    options.toast({ title: 'Success', description: 'Project imported successfully' });
  } catch {
    options.toast({
      title: 'Error',
      description: 'Invalid project data',
      variant: 'destructive',
    });
  }
}
