import React, { createContext, useContext } from 'react';

const ProductDisplayNameContext = createContext('Assistant');
const ModelCommandToolPrefixContext = createContext<string | undefined>(undefined);

export function ProductDisplayNameProvider({
  name,
  modelCommandToolPrefix,
  children,
}: {
  name?: string;
  modelCommandToolPrefix?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <ProductDisplayNameContext.Provider value={name?.trim() || 'Assistant'}>
      <ModelCommandToolPrefixContext.Provider value={modelCommandToolPrefix}>
        {children}
      </ModelCommandToolPrefixContext.Provider>
    </ProductDisplayNameContext.Provider>
  );
}

export function useProductDisplayName(): string {
  return useContext(ProductDisplayNameContext);
}

export function useModelCommandToolPrefix(): string | undefined {
  return useContext(ModelCommandToolPrefixContext);
}
