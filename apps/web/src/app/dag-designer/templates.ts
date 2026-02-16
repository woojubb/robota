import type { IDagDefinition } from "@robota-sdk/dag-core";
import templateCatalogDocument from "./presets/index.json";
import blankTemplatePresetDocument from "./presets/blank.json";
import defaultTemplatePresetDocument from "./presets/default.json";

export type TDagTemplateKey = "blank" | "default";

export interface IDagTemplateContext {
  dagId: string;
  version: number;
}

export interface IDagTemplateMetadata {
  templateId: TDagTemplateKey;
  name: string;
  description: string;
}

export interface IDagTemplatePreset {
  metadata: IDagTemplateMetadata;
  definition: IDagDefinition;
}

interface ITemplateCatalogEntry {
  templateId: TDagTemplateKey;
  documentFile: string;
}

interface ITemplateCatalogDocument {
  defaultTemplateId: TDagTemplateKey;
  templates: ITemplateCatalogEntry[];
}

const TEMPLATE_CATALOG = templateCatalogDocument as ITemplateCatalogDocument;

const TEMPLATE_DOCUMENTS_BY_FILE: Record<string, IDagTemplatePreset> = {
  "blank.json": blankTemplatePresetDocument as IDagTemplatePreset,
  "default.json": defaultTemplatePresetDocument as IDagTemplatePreset,
};

function buildTemplateRegistryFromCatalog(catalog: ITemplateCatalogDocument): Record<TDagTemplateKey, IDagTemplatePreset> {
  const registry = {} as Record<TDagTemplateKey, IDagTemplatePreset>;
  for (const entry of catalog.templates) {
    const preset = TEMPLATE_DOCUMENTS_BY_FILE[entry.documentFile];
    if (!preset) {
      throw new Error(`DAG template document is missing for file=${entry.documentFile}`);
    }
    if (preset.metadata.templateId !== entry.templateId) {
      throw new Error(
        `DAG templateId mismatch: catalog=${entry.templateId}, document=${preset.metadata.templateId}, file=${entry.documentFile}`
      );
    }
    registry[entry.templateId] = preset;
  }
  if (!registry[catalog.defaultTemplateId]) {
    throw new Error(`DAG default template is missing in catalog: ${catalog.defaultTemplateId}`);
  }
  return registry;
}

const DAG_TEMPLATE_REGISTRY = buildTemplateRegistryFromCatalog(TEMPLATE_CATALOG);

export const DEFAULT_DAG_TEMPLATE_KEY: TDagTemplateKey = TEMPLATE_CATALOG.defaultTemplateId;

export function getDagTemplatePreset(templateKey: TDagTemplateKey): IDagTemplatePreset {
  return DAG_TEMPLATE_REGISTRY[templateKey];
}

export function listDagTemplatePresets(): IDagTemplateMetadata[] {
  return TEMPLATE_CATALOG.templates.map((entry) => getDagTemplatePreset(entry.templateId).metadata);
}

export function buildDagTemplate(templateKey: TDagTemplateKey, context: IDagTemplateContext): IDagDefinition {
  const template = getDagTemplatePreset(templateKey);
  const copiedDefinition = JSON.parse(JSON.stringify(template.definition)) as IDagDefinition;
  return {
    ...copiedDefinition,
    dagId: context.dagId,
    version: context.version,
  };
}
