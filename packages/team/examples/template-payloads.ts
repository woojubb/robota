export type TTemplateSummary = {
    id: string;
    name: string;
    description?: string;
    categoryId?: string;
};

export type TTemplatesListPayload = {
    templates: TTemplateSummary[];
};


