const RANDOM_ID_BASE = 36;
const RANDOM_ID_LENGTH = 6;

export function generateBlockId(): string {
  return `block_${Date.now()}_${Math.random().toString(RANDOM_ID_BASE).substr(2, RANDOM_ID_LENGTH)}`;
}
