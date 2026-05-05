import { RECENT_ACTIVITY_WINDOW_MS } from './constants';
import type { IPlaygroundProject, IProjectStats, TPlaygroundProvider } from './types';

export function calculateProjectStats(projects: IPlaygroundProject[]): IProjectStats {
  const oneWeekAgo = new Date(Date.now() - RECENT_ACTIVITY_WINDOW_MS);
  const providers: Record<TPlaygroundProvider, number> = { openai: 0, anthropic: 0, google: 0 };
  let totalLinesOfCode = 0;
  let recentActivity = 0;

  for (const project of projects) {
    totalLinesOfCode += project.code.split('\n').length;
    providers[project.provider] += 1;
    if (project.updatedAt > oneWeekAgo) recentActivity += 1;
  }

  return { totalProjects: projects.length, totalLinesOfCode, providers, recentActivity };
}
