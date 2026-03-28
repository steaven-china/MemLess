# MLEX Agent

MLEX is a **runnable CLI/Web AI agent** built around a layered memory architecture:
- Automatic conversation block sealing
- Hybrid retrieval (keyword + vector + relation graph)
- Optional relation extraction and proactive prediction
- Tool-call persistence (including readonly file access) into memory and relations

If you are building an agent that needs long-lived context (engineering assistant, project memory assistant, workflow tracker), this repository can be used as a practical baseline.

---

## What You Get

- **Ready to run**: `mlex chat` / `mlex web` / `mlex ask`
- **Pluggable storage**: `memory` / `sqlite` / `lance` / `chroma`
- **Pluggable providers**: `rule-based` / `openai` / `deepseek-reasoner`
- **Observable and tunable**: debug trace, retrieval weights, compression policy, prediction policy
- **Tool calls can be persisted**: `web.search.record`, `web.fetch.record`, `readonly.list`, `readonly.read`

---

## Project Layout (Quick View)

```text
src/
  agent/                 # Agent loop, providers, tool executor
  memory/
    processing/          # seal/index pipeline
    management/          # retention/compression policy
    relation/            # relation extraction, graph, persistence
    prediction/          # graph embedding, random walk, proactive trigger
    output/              # context assembly, raw backtracking
  search/                # external search and web page fetch
  web/                   # built-in HTTP server and web UI
  cli/                   # command-line entry
```

---

## Requirements

- Node.js `>=20` (recommended `22+`)
- npm `>=10`

> The SQLite backend depends on `node:sqlite`. If your runtime does not support it, use `memory` or `lance` backend.

---

## Quick Start

```bash
npm install
npm run build
npx mlex chat --provider rule-based
```

Development mode:

```bash
npm run dev
```

Web mode:

```bash
npm run web
```

---

## Common Commands

| Command | Description |
| --- | --- |
| `npm run typecheck` | TypeScript type check (no emit) |
| `npm test` | Run all Vitest tests |
| `npm run build` | Build to `dist/` with tsup |
| `npm run acceptance` | Run acceptance tests |
| `npm run verify:arch` | `typecheck -> test -> build -> acceptance` |

CLI entries:

| Command | Description |
| --- | --- |
| `mlex chat` | Interactive chat (TUI) |
| `mlex web` | Start Web UI + API |
| `mlex ask` | One-shot question |
| `mlex ingest <file>` | Ingest text into memory |
| `mlex swarm` | Multi-agent collaboration |
| `mlex files:list` | Readonly directory listing |
| `mlex files:read` | Readonly file read |

---

## Core Concepts

### 1) Seal
Events first enter the active block, then get sealed into historical blocks when policy thresholds are met.

### 2) Retrieval
Retrieval fuses three signals:
- Keyword matching
- Vector similarity
- Relation-graph expansion

### 3) Retention
Supports `raw / compressed / conflict`, with optional raw backtracking during output assembly.

### 4) Relation
Supports both heuristic and LLM-based extraction; relations are written to graph and persistence.

### 5) Prediction / Proactive
Supports graph embedding + random-walk prediction and configurable proactive wake-up policies.

---

## Provider Setup Examples

### OpenAI

```bash
export OPENAI_API_KEY="YOUR_KEY"
export MLEX_PROVIDER="openai"
npx mlex chat --provider openai --model gpt-4.1-mini
```

### DeepSeek Reasoner

```bash
export DEEPSEEK_API_KEY="YOUR_KEY"
export MLEX_PROVIDER="deepseek-reasoner"
npx mlex chat --provider deepseek-reasoner --model deepseek-reasoner --stream
```

---

## Storage Backend Examples

### SQLite (recommended default)

```bash
export MLEX_STORAGE_BACKEND="sqlite"
export MLEX_RAW_STORE_BACKEND="sqlite"
export MLEX_RELATION_STORE_BACKEND="sqlite"
export MLEX_SQLITE_FILE=".mlex/memory.db"
npx mlex chat
```

### Lance

```bash
npx mlex chat --storage-backend lance --lance-file .mlex/blocks.json
```

### Chroma

```bash
export MLEX_STORAGE_BACKEND="chroma"
export MLEX_CHROMA_BASE_URL="http://127.0.0.1:8000"
export MLEX_CHROMA_COLLECTION="mlex-blocks"
npx mlex chat
```

---

## Search Augmentation Modes

`MLEX_SEARCH_AUGMENT_MODE` supports:
- `lazy`: search only when explicitly called by the model
- `auto`: auto-search and persist before `history.query`
- `scheduled`: periodically run seed queries and persist results
- `predictive`: trigger with proactive prediction flows

---

## Tool-Call Persistence (Important)

The following tool results can be written into memory:
- `web.search.record`
- `web.fetch.record`
- `readonly.list`
- `readonly.read`

`readonly.read` additionally records:
- File snapshot semantics (`contentHash`, `versionKey`, `nearDuplicateKey`)
- File relation edges (`SNAPSHOT_OF_FILE`, `FILE_MENTIONS_BLOCK`)
- File vectors in a dedicated `file_vectors` table

---

## Web API (Summary)

- `GET /healthz`
- `GET /api/capabilities`
- `POST /api/chat`
- `POST /api/chat/stream` (SSE)
- `POST /api/seal`
- `GET /api/debug/*` (debug API must be enabled)
- `GET /api/files/list`, `GET /api/files/read` (file API must be enabled)

---

## FAQ

### Q1: `node:sqlite` is unavailable
Upgrade Node.js, or switch to `memory/lance/chroma` backend.

### Q2: `spawn EPERM` on Windows (esbuild)
This is commonly caused by security software interception or restricted execution permissions. Run `npm run typecheck` first to validate code-level state.

---

## Development and Contribution

After each change, run in this order:

```bash
npm run typecheck
npm test
npm run build
```

If the change touches architecture-critical paths, also run:

```bash
npm run verify:arch
```

---

## License

This project is licensed under [Apache License 2.0](./LICENSE).
Additional attribution details are in [NOTICE](./NOTICE).
