import type { TUniversalValue } from '@robota-sdk/agent-core';
import { getBuiltinTemplates } from '../project-manager-templates';
import { CURRENT_VERSION } from './constants';
import { getDefaultCodeForProvider, getDefaultModelForProvider } from './defaults';
import { generateProjectId } from './id';
import { createImportedProject } from './import-project';
import { calculateProjectStats } from './stats';
import { loadProjectsFromStorage, saveProjectsToStorage } from './storage';
import type {
  IPlaygroundProject,
  IProjectMetadata,
  IProjectSettings,
  IProjectStats,
} from './types';

export class ProjectManager {
  private static instance: ProjectManager;
  private projects: Map<string, IPlaygroundProject> = new Map();

  private constructor() {
    this.projects = loadProjectsFromStorage();
  }

  static getInstance(): ProjectManager {
    if (!ProjectManager.instance) {
      ProjectManager.instance = new ProjectManager();
    }
    return ProjectManager.instance;
  }

  getAllProjects(): IPlaygroundProject[] {
    return Array.from(this.projects.values()).sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
    );
  }

  createProject(
    name: string,
    description: string = '',
    settings: IProjectSettings,
  ): IPlaygroundProject {
    const now = new Date();
    const id = this.generateId();
    const { provider, ...configExtras } = settings;

    const project: IPlaygroundProject = {
      id,
      name,
      description,
      code: getDefaultCodeForProvider(provider),
      provider,
      config: {
        model:
          typeof settings.model === 'string'
            ? settings.model
            : getDefaultModelForProvider(provider),
        temperature: typeof settings.temperature === 'string' ? settings.temperature : '0.7',
        ...configExtras,
      },
      createdAt: now,
      updatedAt: now,
      version: CURRENT_VERSION,
    };

    this.projects.set(id, project);
    this.saveToStorage();
    return project;
  }

  importProject(projectData: TUniversalValue): IPlaygroundProject {
    const project = createImportedProject(projectData, this.generateId(), new Date());
    this.projects.set(project.id, project);
    this.saveToStorage();
    return project;
  }

  saveProject(
    projectData: Omit<IPlaygroundProject, 'id' | 'createdAt' | 'updatedAt' | 'version'>,
  ): string {
    const now = new Date();
    const id = this.generateId();
    this.projects.set(id, {
      ...projectData,
      id,
      createdAt: now,
      updatedAt: now,
      version: CURRENT_VERSION,
    });
    this.saveToStorage();
    return id;
  }

  updateProject(
    id: string,
    updates: Partial<Omit<IPlaygroundProject, 'id' | 'createdAt' | 'version'>>,
  ): boolean {
    const project = this.projects.get(id);
    if (!project) return false;
    this.projects.set(id, { ...project, ...updates, updatedAt: new Date() });
    this.saveToStorage();
    return true;
  }

  loadProject(id: string): IPlaygroundProject | null {
    return this.projects.get(id) || null;
  }

  deleteProject(id: string): boolean {
    const deleted = this.projects.delete(id);
    if (deleted) this.saveToStorage();
    return deleted;
  }

  listProjects(): IProjectMetadata[] {
    return Array.from(this.projects.values())
      .map((project) => ({
        id: project.id,
        name: project.name,
        description: project.description,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        provider: project.provider,
        linesOfCode: project.code.split('\n').length,
      }))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  exportProject(id: string): string | null {
    const project = this.projects.get(id);
    return project ? JSON.stringify(project, null, 2) : null;
  }

  duplicateProject(id: string): string | null {
    const original = this.projects.get(id);
    if (!original) return null;

    const newId = this.generateId();
    const now = new Date();
    this.projects.set(newId, {
      ...original,
      id: newId,
      name: `${original.name} (Replica)`,
      createdAt: now,
      updatedAt: now,
    });
    this.saveToStorage();
    return newId;
  }

  getProjectStats(): IProjectStats {
    return calculateProjectStats(Array.from(this.projects.values()));
  }

  searchProjects(query: string): IProjectMetadata[] {
    const lowercaseQuery = query.toLowerCase();
    return this.listProjects().filter(
      (project) =>
        project.name.toLowerCase().includes(lowercaseQuery) ||
        (project.description && project.description.toLowerCase().includes(lowercaseQuery)) ||
        project.provider.toLowerCase().includes(lowercaseQuery),
    );
  }

  getBuiltinTemplates(): Array<Omit<IPlaygroundProject, 'id' | 'createdAt' | 'updatedAt'>> {
    return getBuiltinTemplates();
  }

  createFromTemplate(templateIndex: number): string | null {
    const templates = getBuiltinTemplates();
    const template = templates[templateIndex];
    if (!template) return null;
    return this.saveProject(template);
  }

  private saveToStorage(): void {
    saveProjectsToStorage(this.projects);
  }

  private generateId(): string {
    return generateProjectId();
  }
}
