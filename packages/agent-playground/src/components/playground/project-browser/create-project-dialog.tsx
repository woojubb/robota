import { Plus } from 'lucide-react';
import { Button } from '../../ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../ui/dialog';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import { Textarea } from '../../ui/textarea';
import type { TPlaygroundProvider } from '../../../lib/playground/project-manager';
import type { IProjectDraft } from './types';

interface ICreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newProject: IProjectDraft;
  onNewProjectChange: React.Dispatch<React.SetStateAction<IProjectDraft>>;
  onCreate: () => void;
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  newProject,
  onNewProjectChange,
  onCreate,
}: ICreateProjectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="w-4 h-4 mr-2" />
          New Project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <ProjectNameField newProject={newProject} onNewProjectChange={onNewProjectChange} />
          <ProjectDescriptionField
            newProject={newProject}
            onNewProjectChange={onNewProjectChange}
          />
          <ProjectProviderField newProject={newProject} onNewProjectChange={onNewProjectChange} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onCreate}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectNameField({
  newProject,
  onNewProjectChange,
}: Pick<ICreateProjectDialogProps, 'newProject' | 'onNewProjectChange'>) {
  return (
    <div>
      <Label htmlFor="project-name">Project Name</Label>
      <Input
        id="project-name"
        placeholder="Enter project name..."
        value={newProject.name}
        onChange={(event) =>
          onNewProjectChange((previous) => ({ ...previous, name: event.target.value }))
        }
      />
    </div>
  );
}

function ProjectDescriptionField({
  newProject,
  onNewProjectChange,
}: Pick<ICreateProjectDialogProps, 'newProject' | 'onNewProjectChange'>) {
  return (
    <div>
      <Label htmlFor="project-description">Description</Label>
      <Textarea
        id="project-description"
        placeholder="Enter project description..."
        value={newProject.description}
        onChange={(event) =>
          onNewProjectChange((previous) => ({ ...previous, description: event.target.value }))
        }
      />
    </div>
  );
}

function ProjectProviderField({
  newProject,
  onNewProjectChange,
}: Pick<ICreateProjectDialogProps, 'newProject' | 'onNewProjectChange'>) {
  return (
    <div>
      <Label htmlFor="project-provider">AI Provider</Label>
      <Select
        value={newProject.provider}
        onValueChange={(value: TPlaygroundProvider) =>
          onNewProjectChange((previous) => ({ ...previous, provider: value }))
        }
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="openai">OpenAI</SelectItem>
          <SelectItem value="anthropic">Anthropic</SelectItem>
          <SelectItem value="google">Google</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
