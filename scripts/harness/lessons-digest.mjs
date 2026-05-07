import { runLessonsDigest } from './lessons-lib.mjs';

async function main() {
  const result = await runLessonsDigest();
  process.stdout.write('auto-lessons digest updated.\n');
  process.stdout.write(`weekly_digest: ${result.weeklyDigestPath}\n`);
  process.stdout.write(`auto_lessons: ${result.autoLessonsPath}\n`);
  process.stdout.write(`patterns: ${result.groups.length}\n`);
}

void main();
