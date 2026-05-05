const CONTAINER_HEIGHT_MD = 400;
const CONTAINER_HEIGHT_LG = 600;
const CONTAINER_HEIGHT_XL = 800;

export function getContainerHeightClass(height: string | number): string {
  if (height === '100%') return 'h-full';
  if (height === '400px' || height === CONTAINER_HEIGHT_MD) return 'h-[400px]';
  if (height === '600px' || height === CONTAINER_HEIGHT_LG) return 'h-[600px]';
  if (height === '800px' || height === CONTAINER_HEIGHT_XL) return 'h-[800px]';
  return 'h-[600px]';
}
