export interface IProductPublicConfig {
  readonly services: { readonly analyticsMeasurementId?: string };
  readonly identity: {
    readonly displayName: string;
    readonly repositoryUrl?: string;
    readonly websiteUrl?: string;
    readonly docsUrl?: string;
    readonly blogUrl?: string;
  };
}
