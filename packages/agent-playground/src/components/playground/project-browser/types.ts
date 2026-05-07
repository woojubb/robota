import type React from 'react';
import type {
  IPlaygroundProject,
  TPlaygroundProvider,
} from '../../../lib/playground/project-manager';

export type TProjectSortKey = 'name' | 'created' | 'modified';
export type TProjectProviderFilter = TPlaygroundProvider | 'all';

export interface IProjectBrowserProps {
  onSelectProject: (project: IPlaygroundProject) => void;
  onCreateNew: () => void;
  currentProjectId?: string;
}

export interface IProjectDraft {
  name: string;
  description: string;
  provider: TPlaygroundProvider;
}

export interface IProjectBrowserState {
  filteredAndSortedProjects: IPlaygroundProject[];
  searchTerm: string;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  sortBy: TProjectSortKey;
  setSortBy: React.Dispatch<React.SetStateAction<TProjectSortKey>>;
  filterProvider: TProjectProviderFilter;
  handleFilterProviderChange: (value: string) => void;
  isCreateDialogOpen: boolean;
  setIsCreateDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isImportDialogOpen: boolean;
  setIsImportDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newProject: IProjectDraft;
  setNewProject: React.Dispatch<React.SetStateAction<IProjectDraft>>;
  importData: string;
  setImportData: React.Dispatch<React.SetStateAction<string>>;
  handleCreateProject: () => void;
  handleImportProject: () => void;
  handleDeleteProject: (projectId: string, projectName: string) => void;
  handleExportProject: (project: IPlaygroundProject) => void;
}
