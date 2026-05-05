const TREE_HEIGHT_SM = 320;
const TREE_HEIGHT_MD = 400;
const TREE_HEIGHT_LG = 600;

export function getTreeHeightClass(height: string | number): string {
  if (height === '100%') return 'h-full';
  if (height === '320px' || height === TREE_HEIGHT_SM) return 'h-80';
  if (height === '400px' || height === TREE_HEIGHT_MD) return 'h-[400px]';
  if (height === '600px' || height === TREE_HEIGHT_LG) return 'h-[600px]';
  return 'h-[400px]';
}
