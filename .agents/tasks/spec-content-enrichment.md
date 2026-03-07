# SPEC.md Content Enrichment

## Status: pending

## Priority: medium

## Summary

All 31 workspace packages have SPEC.md files (harness:scan passes), but many are minimal stubs that don't meet the quality gate defined in AGENTS.md.

## Required Sections (per AGENTS.md)

- Scope
- Boundaries
- Architecture Overview
- Type Ownership
- Public API Surface
- Extension Points
- Error Taxonomy
- Test Strategy
- Class Contract Registry

## High Priority Packages

### agents
- Current SPEC.md is ~5 lines
- Most complex package in the repo — needs full expansion
- Should document plugin system, DI, event architecture, provider contracts

### sessions
- Minimal spec
- Should document ChatInstance lifecycle, SessionManager, template system

### team
- Minimal spec
- Should document team collaboration patterns

### workflow
- Minimal spec
- Should document event system, visualization contracts

### playground
- Minimal spec
- Should document UI component contracts, statistics types

## Lower Priority

- dag-* packages already have reasonable SPEC.md content from recent updates
- apps/ specs are acceptable for current stage

## Acceptance Criteria

- agents SPEC.md covers all 9 required sections with substantive content
- Top 5 packages above have at least Scope, Boundaries, Architecture Overview, Type Ownership filled in
