import { Search } from 'lucide-react';
import { Input } from '../../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select';
import type { IProjectBrowserState, TProjectSortKey } from './types';

interface IProjectBrowserFiltersProps {
  state: IProjectBrowserState;
}

export function ProjectBrowserFilters({ state }: IProjectBrowserFiltersProps) {
  return (
    <div className="flex items-center space-x-4">
      <div className="flex-1">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            placeholder="Search projects..."
            value={state.searchTerm}
            onChange={(event) => state.setSearchTerm(event.target.value)}
            className="pl-10"
          />
        </div>
      </div>
      <Select
        value={state.sortBy}
        onValueChange={(value: TProjectSortKey) => state.setSortBy(value)}
      >
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="modified">Last Modified</SelectItem>
          <SelectItem value="created">Date Created</SelectItem>
          <SelectItem value="name">Name</SelectItem>
        </SelectContent>
      </Select>
      <Select value={state.filterProvider} onValueChange={state.handleFilterProviderChange}>
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Providers</SelectItem>
          <SelectItem value="openai">OpenAI</SelectItem>
          <SelectItem value="anthropic">Anthropic</SelectItem>
          <SelectItem value="google">Google</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
