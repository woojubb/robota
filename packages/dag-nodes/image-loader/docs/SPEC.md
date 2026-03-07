# Image Loader Node Specification

## Scope
- Owns the `image-loader` DAG node package for Robota.
- Provides node-level behavior for loading image data into DAG execution flows.

## Boundaries
- Must follow `AbstractNodeDefinition`, `NodeIoAccessor`, and DAG error code conventions.
- Does not own shared DAG contracts outside this node package.
