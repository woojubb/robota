# product-config Specification

## Purpose

Defines product configuration as explicit data so hosts and build tools can select independent products from one common source.

## Contract

Each resolution uses only caller-supplied sources and returns its own immutable configuration. Explicit empty input is a choice and cannot fall back to another source. Installed artifact identity is authoritative: operational settings may be overridden, while conflicting selected-file or product-alias identity is refused. Ambient canonical inputs belong only to an environment stamped with the running product identity; unrelated products cannot redirect artifact configuration. Declared non-secret artifact defaults are subordinate to runtime sources and resolve against the invocation home rather than the build host.

Public and host projections are defined by the same contract as validation and guidance. Private references stay with the adapter that needs them and are never embedded as artifact identity or runtime defaults. Shared settings compatibility is a product choice without conferring project authority. Cryptographic domain labels are public protocol data; they do not contain key material.

## Invariants

The pure entry has no filesystem, environment or working-directory access and no product-name branches. The Node entry reads only an explicitly selected environment file and anchors relative host paths to that file. Neither entry discovers another product's configuration or retains values across resolutions.

## Design decisions

The configuration package is a leaf so host loading does not create dependencies from the SDK foundation to product composition. Narrow projections keep public builds and unrelated processes from receiving private configuration. Hardened derivation indices are validated without loading or generating key material.
