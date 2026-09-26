# Contracts

Published interfaces shared with other repositories. Nothing here imports code from them.

- `hop.v2.schema.json`: the hop ingestion payload (`uv run pogoscout-dev contracts`). Sensor values
  are signal strengths from 0 to 1 against the calibrated background, not probabilities.
  `schema_version` 1.0 (values 0 or 1) is still accepted.
- `hop.v1.schema.json`: the previous payload, kept for producers that have not moved to 2.0.
- `risk.v2.cases.json`: risk assessment test cases (rules `risk-2`, Bayesian evidence fusion, see
  `docs/API.md`) and the deciban to probability table. The API and the web client both run them,
  so the two implementations cannot drift apart.
- `ml-classify.v1.openapi.yaml`: `POST /api/v1/classify` contract with `pogoscout-material-model`.
- `ml-classify.v1.example.json`: example request fields and response; a platform test validates it.
- `taxonomy.pogo-materials-v2.json`: the 10 controlled material labels from the material model.
