# Operation lock

## Purpose

Coordinate cooperating Node processes while a shared local operation commits.

## Contract

An acquired guard excludes other participating holders of the same namespace until release or process exit. Acquisition does not wait.

## Invariants

The guard file remains in place while its namespace is in use. A holder releases its guard even when its operation fails.

## Non-goals

The guard does not constrain programs that do not participate, including older versions, or programs able to replace its path. Network filesystem behavior is not qualified.

## Design decisions

An operating-system handle carries the guard so process termination releases it without treating a slow live holder as abandoned.
