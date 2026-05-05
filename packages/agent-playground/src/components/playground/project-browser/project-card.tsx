import { Calendar, Code, Download, Trash2 } from 'lucide-react';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import type { IPlaygroundProject } from '../../../lib/playground/project-manager';
import { formatProjectDate, getProviderIcon } from './project-browser-utils';

interface IProjectCardProps {
  project: IPlaygroundProject;
  isCurrent: boolean;
  onSelectProject: (project: IPlaygroundProject) => void;
  onExportProject: (project: IPlaygroundProject) => void;
  onDeleteProject: (projectId: string, projectName: string) => void;
}

export function ProjectCard({
  project,
  isCurrent,
  onSelectProject,
  onExportProject,
  onDeleteProject,
}: IProjectCardProps) {
  return (
    <Card
      className={`cursor-pointer transition-all hover:shadow-md ${isCurrent ? 'ring-2 ring-primary' : ''}`}
      onClick={() => onSelectProject(project)}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <ProjectCardTitle project={project} isCurrent={isCurrent} />
          <ProjectCardActions
            project={project}
            onExportProject={onExportProject}
            onDeleteProject={onDeleteProject}
          />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
          {project.description || 'No description'}
        </p>
        <ProjectCardMetadata project={project} />
      </CardContent>
    </Card>
  );
}

function ProjectCardTitle({
  project,
  isCurrent,
}: Pick<IProjectCardProps, 'project' | 'isCurrent'>) {
  return (
    <div className="flex-1">
      <CardTitle className="text-base line-clamp-1">{project.name}</CardTitle>
      <div className="flex items-center space-x-2 mt-1">
        <Badge variant="secondary" className="text-xs">
          {getProviderIcon(project.provider)} {project.provider}
        </Badge>
        {isCurrent && (
          <Badge variant="default" className="text-xs">
            Current
          </Badge>
        )}
      </div>
    </div>
  );
}

function ProjectCardActions({
  project,
  onExportProject,
  onDeleteProject,
}: Pick<IProjectCardProps, 'project' | 'onExportProject' | 'onDeleteProject'>) {
  return (
    <div className="flex space-x-1" onClick={(event) => event.stopPropagation()}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onExportProject(project)}
        className="h-8 w-8 p-0"
      >
        <Download className="w-3 h-3" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onDeleteProject(project.id, project.name)}
        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  );
}

function ProjectCardMetadata({ project }: Pick<IProjectCardProps, 'project'>) {
  return (
    <div className="flex items-center justify-between text-xs text-muted-foreground">
      <div className="flex items-center space-x-1">
        <Calendar className="w-3 h-3" />
        <span>{formatProjectDate(project.updatedAt)}</span>
      </div>
      <div className="flex items-center space-x-1">
        <Code className="w-3 h-3" />
        <span>{project.code.split('\n').length} lines</span>
      </div>
    </div>
  );
}
