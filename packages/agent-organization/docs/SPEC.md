# Organization resource contracts

## Purpose

Generic agents and hosts need shared canonical values and resource budget contracts without depending on an operator-owned authority implementation.

## Contract

The package provides deterministic, bounded canonical JSON for interoperable resource records and validates immutable resource units and budgets without coercing unsafe values. A caller that accepts external data must run the validators before treating the structural TypeScript contracts as trusted values.

## Invariants

Equivalent supported JSON values produce identical canonical bytes regardless of object insertion order. Unsupported or ambiguous values fail closed. Runtime validation retains the same numeric domain as the corresponding host admission contract.

## Non-goals

This package does not sign values, authorize operations, reserve resources, account for effects or provide a broker, ledger, transport or application service.

## Design decisions

The canonical encoder remains independent of Node and hosted services so a public consumer can use it in either a server or browser. The parent package owns the shared contracts; private host implementations depend downward on them and adapt generic schema failures to their own refusal class.
