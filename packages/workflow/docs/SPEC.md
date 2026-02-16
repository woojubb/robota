# Workflow Package Specification

## Scope
- Owns workflow graph/event handling and visualization-ready graph assembly logic.
- Handles node/edge construction from explicit event payload linkage.

## Event System Rules
- Event ownership and prefix rules are strict.
- Event names are consumed via exported constants from owning modules.
- Hardcoded event-name strings are prohibited.

## Graph Rules
- Connection derivation must be path-only and explicit-field based.
- No ID parsing, regex inference, delayed linking, or fallback linking paths.

## Terminology
- Agent hierarchy terms are prohibited.
- Use neutral terms such as `agent`, `agent instance`, and explicit execution context fields.
