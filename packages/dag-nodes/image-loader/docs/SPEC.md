# Image Loader Node Specification

## Purpose

DAG node that converts a media reference input into a binary image output for downstream
image-processing nodes.

## Contract

- Pure data transformation: no external provider dependencies, no network calls.
- Delegates media-reference parsing and validation to the shared `NodeIoAccessor` accessor rather
  than parsing references itself.

## Non-goals

- Does not redefine core DAG node contracts — extends `AbstractNodeDefinition` from
  `@robota-sdk/dag-node`.
