# Contracts

Published interfaces shared with other repositories. Nothing here imports code from them.

- `hop.v1.schema.json`: the hop ingestion payload (`uv run pogoscout-dev contracts`).
- `ml-classify.v1.openapi.yaml`: `POST /api/v1/classify` contract with `pogoscout-material-model`.
- `ml-classify.v1.example.json`: example request fields and response; a platform test validates it.
- `taxonomy.pogo-materials-v2.json`: the 10 controlled material labels from the material model.
