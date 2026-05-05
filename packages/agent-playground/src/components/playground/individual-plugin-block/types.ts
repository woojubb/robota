import type { TUniversalValue } from '@robota-sdk/agent-core';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import type { IPluginBlock } from '../plugin-container-block-types';

export interface IIndividualPluginBlockProps {
  pluginBlock: IPluginBlock;
  onUpdate: (pluginBlock: IPluginBlock) => void;
  onRemove: () => void;
  onToggle: (enabled: boolean) => void;
  isEditable?: boolean;
}

export interface IPluginOptionInputProps {
  option: {
    type: string;
    default?: TUniversalValue;
    description: string;
    options?: string[];
  };
  value: TUniversalValue;
  onChange: (value: TUniversalValue) => void;
  disabled?: boolean;
}

export interface IPluginBlockHeaderProps {
  pluginBlock: IPluginBlock;
  isExpanded: boolean;
  hasErrors: boolean;
  categoryColor: string;
  CategoryIcon: LucideIcon;
  statusIcon: ReactNode;
  isEditable: boolean;
  onToggleEnabled: () => void;
  onRemove: () => void;
}
