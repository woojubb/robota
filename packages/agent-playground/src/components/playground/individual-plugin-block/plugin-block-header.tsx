'use client';

import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { forwardRef, type HTMLAttributes } from 'react';

import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { CardHeader, CardTitle } from '../../ui/card';
import { Switch } from '../../ui/switch';
import type { IPluginBlockHeaderProps } from './types';

type TPluginBlockHeaderProps = IPluginBlockHeaderProps & HTMLAttributes<HTMLDivElement>;

export const PluginBlockHeader = forwardRef<HTMLDivElement, TPluginBlockHeaderProps>(
  function PluginBlockHeader(
    {
      pluginBlock,
      isExpanded,
      hasErrors,
      categoryColor,
      CategoryIcon,
      statusIcon,
      isEditable,
      onToggleEnabled,
      onRemove,
      className,
      ...triggerProps
    },
    ref,
  ) {
    return (
      <CardHeader
        ref={ref}
        className={`pb-2 cursor-pointer hover:bg-gray-50 ${className || ''}`}
        {...triggerProps}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="h-3 w-3 text-gray-400" />
            ) : (
              <ChevronRight className="h-3 w-3 text-gray-400" />
            )}
            <CategoryIcon className={`h-4 w-4 ${categoryColor}`} />
            <CardTitle className="text-xs font-medium">{pluginBlock.plugin.name}</CardTitle>
            {statusIcon}
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs px-1 py-0">
              Priority: {pluginBlock.priority}
            </Badge>
            <Switch
              checked={pluginBlock.isEnabled}
              onCheckedChange={onToggleEnabled}
              disabled={!isEditable}
            />
            {isEditable && (
              <Button
                size="sm"
                variant="ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove();
                }}
                className="h-6 w-6 p-0 text-red-500"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Badge variant="secondary" className="text-xs">
            {pluginBlock.category}
          </Badge>
          <span>{pluginBlock.stats.calls} calls</span>
          {pluginBlock.stats.errors > 0 && (
            <span className="text-red-500">{pluginBlock.stats.errors} errors</span>
          )}
        </div>
        {pluginBlock.validationErrors.length > 0 && (
          <div className="mt-1 text-xs text-red-600">{pluginBlock.validationErrors[0]}</div>
        )}
      </CardHeader>
    );
  },
);
