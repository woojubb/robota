import type { IToolBlock } from '../tool-container-block-types';

export function getToolBlockClassName(toolBlock: IToolBlock, hasErrors: boolean): string {
  const activeClassName = toolBlock.isActive ? 'border-blue-500 bg-blue-50' : 'border-gray-200';
  const errorClassName = hasErrors ? 'border-red-300 bg-red-50' : '';
  const disabledClassName = !toolBlock.isEnabled ? 'opacity-60' : '';

  return `transition-all duration-200 border ${activeClassName} ${errorClassName} ${disabledClassName}`;
}
