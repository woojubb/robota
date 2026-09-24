import React, { createContext, useContext } from 'react';

const ProductDisplayNameContext = createContext('Assistant');

export function ProductDisplayNameProvider({
  name,
  children,
}: {
  name?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <ProductDisplayNameContext.Provider value={name?.trim() || 'Assistant'}>
      {children}
    </ProductDisplayNameContext.Provider>
  );
}

export function useProductDisplayName(): string {
  return useContext(ProductDisplayNameContext);
}
