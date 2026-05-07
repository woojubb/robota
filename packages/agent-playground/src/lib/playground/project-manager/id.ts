import { RANDOM_ID_BASE } from './constants';

export function generateProjectId(): string {
  return Date.now().toString(RANDOM_ID_BASE) + Math.random().toString(RANDOM_ID_BASE).substr(2);
}
