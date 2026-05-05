export interface IExampleTemplate {
  name: string;
  description: string;
  code: string;
}

export interface IExampleTemplates {
  basic: IExampleTemplate;
  tools: IExampleTemplate;
  streaming: IExampleTemplate;
  multiProvider: IExampleTemplate;
  plugins: IExampleTemplate;
}
