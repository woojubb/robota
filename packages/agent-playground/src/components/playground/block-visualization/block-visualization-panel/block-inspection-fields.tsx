import React from 'react';

import type { IBlockMessage } from '../../../../lib/playground/block-tracking';

const MS_PER_SECOND = 1000;

interface IBlockInspectionFieldsProps {
  selectedBlock: IBlockMessage;
}

function formatDuration(duration: number): string {
  return duration < MS_PER_SECOND ? `${duration}ms` : `${(duration / MS_PER_SECOND).toFixed(1)}s`;
}

const BlockIdentityFields: React.FC<IBlockInspectionFieldsProps> = ({ selectedBlock }) => {
  const { blockMetadata } = selectedBlock;

  return (
    <>
      <div>
        <label className="text-xs font-medium text-gray-500">ID</label>
        <div className="text-sm font-mono bg-gray-100 p-2 rounded">{blockMetadata.id}</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500">Type</label>
          <div className="text-sm">{blockMetadata.type}</div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">State</label>
          <div className="text-sm">{blockMetadata.visualState}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-gray-500">Level</label>
          <div className="text-sm">{blockMetadata.level}</div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-500">Children</label>
          <div className="text-sm">{blockMetadata.children.length}</div>
        </div>
      </div>
    </>
  );
};

const BlockExecutionFields: React.FC<IBlockInspectionFieldsProps> = ({ selectedBlock }) => {
  const { executionContext } = selectedBlock.blockMetadata;

  return (
    <>
      {executionContext?.toolName && (
        <div>
          <label className="text-xs font-medium text-gray-500">Tool</label>
          <div className="text-sm">{executionContext.toolName}</div>
        </div>
      )}

      {executionContext?.duration && (
        <div>
          <label className="text-xs font-medium text-gray-500">Duration</label>
          <div className="text-sm">{formatDuration(executionContext.duration)}</div>
        </div>
      )}
    </>
  );
};

const BlockPayloadFields: React.FC<IBlockInspectionFieldsProps> = ({ selectedBlock }) => {
  const { blockMetadata, content } = selectedBlock;

  return (
    <>
      <div>
        <label className="text-xs font-medium text-gray-500">Content</label>
        <div className="text-sm bg-gray-100 p-2 rounded max-h-32 overflow-y-auto">{content}</div>
      </div>

      {blockMetadata.renderData && (
        <div>
          <label className="text-xs font-medium text-gray-500">Render Data</label>
          <div className="text-xs bg-gray-100 p-2 rounded max-h-40 overflow-y-auto font-mono">
            {JSON.stringify(blockMetadata.renderData, null, 2)}
          </div>
        </div>
      )}
    </>
  );
};

export const BlockInspectionFields: React.FC<IBlockInspectionFieldsProps> = ({ selectedBlock }) => {
  return (
    <div className="space-y-3">
      <BlockIdentityFields selectedBlock={selectedBlock} />
      <BlockExecutionFields selectedBlock={selectedBlock} />
      <BlockPayloadFields selectedBlock={selectedBlock} />
    </div>
  );
};
