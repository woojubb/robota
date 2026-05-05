# @robota-sdk/dag-cli

JSON-first command-line client for Robota DAG orchestration APIs.

```bash
robota-dag --server-url http://localhost:3012 definitions list
robota-dag definitions create --file definition.json
robota-dag runs create --file definition.json --input @input.json --partial-start node-a
robota-dag runs start <preparationId>
robota-dag runs status <dagRunId>
robota-dag runs result <dagRunId>
```

Server URL resolution order:

1. `--server-url <url>`
2. `ROBOTA_DAG_SERVER_URL`
3. `http://localhost:3012`

See [docs/README.md](docs/README.md) and [docs/SPEC.md](docs/SPEC.md) for the package contract.
