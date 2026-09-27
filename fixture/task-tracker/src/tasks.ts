import { validateTaskTitle } from './task-title.ts';

export interface Task {
  id: number;
  title: string;
  done: boolean;
}

const tasks: Task[] = [];

export function createTask(title: string): Task {
  const result = validateTaskTitle(title);
  if (!result.ok) throw new Error(result.error);
  const task = { id: tasks.length + 1, title: result.title, done: false };
  tasks.push(task);
  return task;
}

export function listTasks(): readonly Task[] {
  return tasks;
}
