export const FIXTURE_PRODUCTS = {
  cedar: { displayName: 'Cedar Agent', port: 43123, derivation: [101, 1], browserNamespace: 'cedar.agent' },
  amber: { displayName: 'Amber Agent', port: 43124, derivation: [102, 1], browserNamespace: 'amber.agent' },
} as const;

export type TFixtureProduct = keyof typeof FIXTURE_PRODUCTS;
