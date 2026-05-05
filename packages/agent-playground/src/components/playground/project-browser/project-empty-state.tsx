import { FolderOpen, Plus } from 'lucide-react';
import { Button } from '../../ui/button';

interface IProjectEmptyStateProps {
  searchTerm: string;
  onCreateNew: () => void;
}

export function ProjectEmptyState({ searchTerm, onCreateNew }: IProjectEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <FolderOpen className="w-12 h-12 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold mb-2">No projects found</h3>
      <p className="text-muted-foreground mb-4">
        {searchTerm
          ? 'Try adjusting your search or filters'
          : 'Create your first project to get started'}
      </p>
      <Button onClick={onCreateNew}>
        <Plus className="w-4 h-4 mr-2" />
        Create New Project
      </Button>
    </div>
  );
}
