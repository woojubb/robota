import { useEffect, useState } from 'react';
import type { IPlaygroundProject } from '../../../lib/playground/project-manager';
import { loadProjectList } from './project-browser-actions';

export function useProjectList() {
  const [projects, setProjects] = useState<IPlaygroundProject[]>([]);

  useEffect(() => {
    setProjects(loadProjectList());
  }, []);

  return { projects, setProjects };
}
