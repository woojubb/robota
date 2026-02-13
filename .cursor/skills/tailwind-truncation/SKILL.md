---
name: tailwind-truncation
description: Provide Tailwind truncation patterns for single-line and multi-line text. Use when discussing text ellipsis, truncation, or line-clamp usage.
---

# Tailwind Truncation

## Rule Anchor
- `.cursor/rules/tailwind-css-only-policy.mdc`

## Scope
Use this skill for text truncation patterns using Tailwind utilities.

## Single Line Ellipsis
```jsx
<div className="truncate">Long text here...</div>
```

## Multi-line Ellipsis
```jsx
<div className="line-clamp-3">Multi-line text here...</div>
```

## Height-based Truncation
```jsx
<div className="h-16 overflow-hidden">Content here...</div>
```

## When Tailwind Doesn't Work
1. Verify required plugins are installed (e.g., line-clamp).
2. Check `tailwind.config.js` for missing utilities.
3. Use arbitrary values when needed (e.g., `h-[64px]`).
