/**
 * Ambient declaration for global (non-CSS-Module) stylesheet imports.
 *
 * Next.js bundles `import './globals.css'` through its own loader, so the specifier never has to
 * resolve to a TypeScript declaration at runtime. `next-env.d.ts` only declares `*.module.css`.
 * TypeScript 5 silently ignored a side-effect import it could not resolve; TypeScript 7 reports it
 * (TS2882), so the declaration has to be stated rather than implied.
 */
declare module '*.css';
