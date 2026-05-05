import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectBrowser } from '../project-browser';
import type {
  IPlaygroundProject,
  TPlaygroundProvider,
} from '../../../lib/playground/project-manager';

const projectManagerMock = vi.hoisted(() => {
  const instance = {
    getAllProjects: vi.fn(),
    createProject: vi.fn(),
    deleteProject: vi.fn(),
    importProject: vi.fn(),
  };

  return {
    instance,
    ProjectManager: {
      getInstance: vi.fn(() => instance),
    },
  };
});

vi.mock('../../../lib/playground/project-manager', () => ({
  ProjectManager: projectManagerMock.ProjectManager,
}));

const toastMock = vi.hoisted(() => ({
  toast: vi.fn(),
}));

vi.mock('../../../hooks/use-toast', () => ({
  useToast: () => toastMock,
}));

function createProject(
  id: string,
  overrides: Partial<IPlaygroundProject> = {},
): IPlaygroundProject {
  return {
    id,
    name: `Project ${id}`,
    description: `Description ${id}`,
    code: 'const value = 1;\nconsole.log(value);',
    provider: 'openai',
    config: {
      model: 'gpt-4o-mini',
      temperature: '0.7',
    },
    createdAt: new Date('2026-05-01T10:00:00.000Z'),
    updatedAt: new Date('2026-05-01T10:00:00.000Z'),
    version: '1.0.0',
    ...overrides,
  };
}

function renderProjectBrowser(options: {
  projects: IPlaygroundProject[];
  currentProjectId?: string;
}) {
  let projects = [...options.projects];
  const onSelectProject = vi.fn();
  const onCreateNew = vi.fn();

  projectManagerMock.instance.getAllProjects.mockImplementation(() => projects);
  projectManagerMock.instance.createProject.mockImplementation(
    (name: string, description: string, settings: { provider: TPlaygroundProvider }) => {
      const created = createProject('created', {
        name,
        description,
        provider: settings.provider,
        updatedAt: new Date('2026-05-05T12:00:00.000Z'),
      });
      projects = [created, ...projects];
      return created;
    },
  );
  projectManagerMock.instance.importProject.mockImplementation((project: IPlaygroundProject) => {
    projects = [project, ...projects];
    return project;
  });

  const renderResult = render(
    <ProjectBrowser
      onSelectProject={onSelectProject}
      onCreateNew={onCreateNew}
      currentProjectId={options.currentProjectId}
    />,
  );

  return { ...renderResult, onSelectProject, onCreateNew };
}

function clickLastButtonNamed(name: string): void {
  const buttons = screen.getAllByRole('button', { name });
  const button = buttons[buttons.length - 1];
  if (!button) {
    throw new Error(`Button not found: ${name}`);
  }
  fireEvent.click(button);
}

describe('ProjectBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads projects, sorts by updated time, searches, and selects a project', () => {
    const oldProject = createProject('old', {
      name: 'Alpha Workspace',
      provider: 'anthropic',
      updatedAt: new Date('2026-05-01T10:00:00.000Z'),
    });
    const newProject = createProject('new', {
      name: 'Beta Workspace',
      provider: 'google',
      updatedAt: new Date('2026-05-03T10:00:00.000Z'),
    });
    const { container, onSelectProject } = renderProjectBrowser({
      projects: [oldProject, newProject],
      currentProjectId: 'new',
    });

    expect(screen.getByText('Projects')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
    expect(container.textContent).toContain('google');
    expect(
      screen
        .getByText('Beta Workspace')
        .compareDocumentPosition(screen.getByText('Alpha Workspace')),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    fireEvent.change(screen.getByPlaceholderText('Search projects...'), {
      target: { value: 'alpha' },
    });

    expect(screen.getByText('Alpha Workspace')).toBeInTheDocument();
    expect(screen.queryByText('Beta Workspace')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Alpha Workspace'));

    expect(onSelectProject).toHaveBeenCalledWith(oldProject);
  });

  it('calls the empty-state create callback when no project matches', () => {
    const { onCreateNew } = renderProjectBrowser({ projects: [] });

    expect(screen.getByText('No projects found')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create New Project' }));

    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  it('creates a project through the create dialog and selects it', () => {
    const { onSelectProject } = renderProjectBrowser({ projects: [] });

    fireEvent.click(screen.getByRole('button', { name: 'New Project' }));
    fireEvent.change(screen.getByLabelText('Project Name'), {
      target: { value: 'Created Workspace' },
    });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Created description' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(projectManagerMock.instance.createProject).toHaveBeenCalledWith(
      'Created Workspace',
      'Created description',
      { provider: 'openai' },
    );
    expect(onSelectProject).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Created Workspace' }),
    );
    expect(toastMock.toast).toHaveBeenCalledWith({
      title: 'Success',
      description: 'Project created successfully',
    });
  });

  it('imports project JSON through the import dialog and selects the imported project', () => {
    const importedProject = createProject('imported', { name: 'Imported Workspace' });
    const { onSelectProject } = renderProjectBrowser({ projects: [] });

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    fireEvent.change(screen.getByLabelText('Project JSON Data'), {
      target: { value: JSON.stringify(importedProject) },
    });
    clickLastButtonNamed('Import');

    expect(projectManagerMock.instance.importProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'imported', name: 'Imported Workspace' }),
    );
    expect(onSelectProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'imported', name: 'Imported Workspace' }),
    );
    expect(toastMock.toast).toHaveBeenCalledWith({
      title: 'Success',
      description: 'Project imported successfully',
    });
  });
});
