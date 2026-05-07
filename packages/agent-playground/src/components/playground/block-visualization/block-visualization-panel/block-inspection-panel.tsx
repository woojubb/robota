import React from 'react';

import { Button } from '../../../ui/button';
import type { IBlockMessage } from '../../../../lib/playground/block-tracking';
import { BlockInspectionEmptyState } from './block-inspection-empty-state';
import { BlockInspectionFields } from './block-inspection-fields';

interface IBlockInspectionPanelProps {
  selectedBlock: IBlockMessage | null;
  onClose: () => void;
}

export const BlockInspectionPanel: React.FC<IBlockInspectionPanelProps> = ({
  selectedBlock,
  onClose,
}) => {
  if (!selectedBlock) {
    return <BlockInspectionEmptyState />;
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Block Inspector</h3>
        <Button variant="ghost" size="sm" onClick={onClose}>
          ×
        </Button>
      </div>

      <BlockInspectionFields selectedBlock={selectedBlock} />
    </div>
  );
};
