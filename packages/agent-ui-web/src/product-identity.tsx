import { createContext, useContext, type ReactNode } from 'react';

/** Only the public identity needed by a browser surface; hosts resolve its values. */
export interface IWebProductIdentity {
  readonly identity: { readonly displayName: string; readonly cliName: string };
  readonly storage: { readonly browserNamespace: string };
}

const ProductIdentityContext = createContext<IWebProductIdentity | null>(null);

export function ProductIdentityProvider({ value, children }: {
  readonly value: IWebProductIdentity;
  readonly children?: ReactNode;
}): React.ReactElement {
  if (!value.identity.displayName || !value.identity.cliName || !value.storage.browserNamespace) {
    throw new Error('A public product identity is required');
  }
  // Changing product replaces the subtree so drafts, in-flight requests and session refs cannot cross it.
  return <ProductIdentityContext.Provider key={value.storage.browserNamespace} value={value}>{children}</ProductIdentityContext.Provider>;
}

export function useProductIdentity(): IWebProductIdentity {
  const identity = useContext(ProductIdentityContext);
  if (identity === null) throw new Error('ProductIdentityProvider is required');
  return identity;
}
