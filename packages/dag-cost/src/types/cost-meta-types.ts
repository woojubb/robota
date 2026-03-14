export type TCostMetaCategory = 'ai-inference' | 'transform' | 'io' | 'custom';

export interface ICostMeta {
    nodeType: string;
    displayName: string;
    category: TCostMetaCategory;
    estimateFormula: string;
    calculateFormula?: string;
    variables: Record<string, unknown>;
    enabled: boolean;
    updatedAt: string;
}
