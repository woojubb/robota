---
'@robota-sdk/agent-core': patch
---

CORE-041: `z.nativeEnum()` and `z.date()` convert; the rest of the boundary is published, not discovered

`zodToJsonSchema` threw `Unsupported Zod type: …` on five constructs, so a schema Zod accepts could
not be turned into a tool or a structured-output spec. Re-running the decision the item reserved,
those five are two different problems:

- **`ZodNativeEnum` and `ZodDate` are exactly expressible** and were missing for no reason.
  A native enum becomes an `enum` of its VALUES — for a numeric TypeScript enum the compiler's
  reverse mapping is filtered out, so a field accepting `0` is no longer advertised as accepting
  `"Low"`. A date becomes `{ type: 'string', format: 'date-time' }`, which is not a lossy stand-in:
  JSON has no date type, so a string is what the provider receives either way.
- **`ZodTuple`, `ZodIntersection` and `ZodLazy` are not expressible**, and still throw. A tuple needs
  positional `items` (the subset models `items` as one schema), an intersection needs `allOf`,
  recursion needs `$ref` — none of which the field-enumerated provider mappers would forward.
  Adopting `zod-to-json-schema` does not dissolve this, as CORE-039 had conceded it might: the
  library emits exactly those constructs. The difficulty was never parsing Zod; the target language
  cannot say these things.

Mapping them lossily was rejected — a tuple flattened to `array of anyOf[...]` would tell the model
that any order and any length are acceptable, a contract the author did not write.

The error now names the construct, says why the subset cannot carry it, and names a Zod expression to
write instead. `Unsupported Zod type: ZodTuple` told a consumer the name of their own construct and
nothing they could act on.
