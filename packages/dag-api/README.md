# @robota-sdk/dag-api

DAG controller and narrow service-port contract package.

Worker execution and advancement contracts belong to `@robota-sdk/dag-worker`, while framework
assembly contracts belong to `@robota-sdk/dag-framework`. This package exposes only the service ports
consumed by DAG controllers, including run creation, reads, cancellation, and progress events.

See [docs/README.md](docs/README.md) and [docs/SPEC.md](docs/SPEC.md) for the package contract.
