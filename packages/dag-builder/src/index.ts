// @robota-sdk/dag-builder
// Declarative pipeline-to-IDagDefinition builder.

export {
  buildDagFromPipeline,
  type IDagBuildInput,
  type IDagBuildWarning,
  type IPipelineNodeSpec,
  type IParallelSpec,
  type TPipelineStage,
  type TDagBuildResult,
} from './dag-builder.js';

export {
  toDagWorkflowFile,
  fromDagWorkflowFile,
  toWorkflowNodeType,
  fromWorkflowNodeType,
  isWorkflowFileFormat,
  isLegacyDefinitionFormat,
  type IToWorkflowFileResult,
} from './dag-workflow-converter.js';

export const DAG_BUILDER_PACKAGE_NAME = '@robota-sdk/dag-builder';

export {
  DAG_DEFINITION_FILE_DECODE_OPTIONS,
  DagFileDecodeError,
  dagDefinitionFromParsedFile,
  decodeDagFile,
  formatDagFileDecodeFailure,
  type IDagFileDecodeFailure,
  type TDagFileFormat,
} from './parsed-dag-file.js';
