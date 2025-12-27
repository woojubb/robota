export type TemplateSummary = {
  id: string;
  name: string;
  description?: string;
  categoryId?: string;
};

export type TemplatesListPayload = {
  templates: TemplateSummary[];
};


