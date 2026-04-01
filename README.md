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
- **Pluggable providers**: `rule-based` / `openai` / `deepseek-reasoner` / `anthropic-claude` / `google-gemini` / `openrouter` / `azure-openai` / `openai-compatible`
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

### Anthropic Claude

```bash
export ANTHROPIC_API_KEY="YOUR_KEY"
export MLEX_PROVIDER="anthropic-claude"
npx mlex chat --provider anthropic-claude --model claude-3-5-sonnet-latest
```

### Google Gemini

```bash
export GEMINI_API_KEY="YOUR_KEY"
export MLEX_PROVIDER="google-gemini"
npx mlex chat --provider google-gemini --model gemini-1.5-pro
```

### OpenRouter

```bash
export OPENROUTER_API_KEY="YOUR_KEY"
export MLEX_PROVIDER="openrouter"
npx mlex chat --provider openrouter --model openai/gpt-4o-mini
```

### Azure OpenAI

```bash
export AZURE_OPENAI_API_KEY="YOUR_KEY"
export AZURE_OPENAI_ENDPOINT="https://<resource>.openai.azure.com"
export AZURE_OPENAI_DEPLOYMENT="gpt4o"
export MLEX_PROVIDER="azure-openai"
npx mlex chat --provider azure-openai --model gpt-4o-mini
```

### OpenAI-compatible

```bash
export OPENAI_COMPATIBLE_API_KEY="YOUR_KEY"
export OPENAI_COMPATIBLE_BASE_URL="https://example.com/v1"
export MLEX_PROVIDER="openai-compatible"
npx mlex chat --provider openai-compatible --model gpt-4o-mini
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

## Customize AI Tags

You can customize the tag set used by AI taggers and persistence normalization.

### Environment variable

```bash
export MLEX_ALLOWED_AI_TAGS="important,normal,critical,ops"
```

### TOML

```toml
[component]
allowedAiTags = ["important", "normal", "critical", "ops"]
```

Notes:
- tags are normalized as lowercase + trimmed
- duplicates are removed
- unknown tags from model output are dropped
- if no valid tag remains, fallback prefers `normal` (or the first allowed tag)

---

## TagsIntro Injection (Tag Documentation Prompt)

You can inject tag-specific guidance into the system prompt via `TagsIntro.md` and `~/.mlex/tags.toml`.

On first startup, MLEX auto-creates both files if missing:
- `~/.mlex/config.toml`
- `~/.mlex/tags.toml`

### File-based injection

MLEX loads TagsIntro content in this order:
1. explicit runtime/CLI `--tags-intro <path>`
2. `AgentDocs/TagsIntro.md`
3. `TagsIntro.md` (workspace root)

The content is appended as a dedicated `=== TAGS INTRODUCTION ===` section in system prompt.

### Template variables

TagsIntro supports simple placeholders:
- `{{name}}` → replace with variable value
- `\{{` → escape into literal `{{`
- unknown variables resolve to empty string

### `~/.mlex/tags.toml`

Default path: `~/.mlex/tags.toml` (override with `--tags-toml` or `MLEX_TAGS_TOML`).

Example:

```toml
[docs]
intro = "Use tags consistently for {{team}} workflows."
item = [
  "critical: user-visible outage or rollback risk",
  "normal: routine state transitions"
]

[vars]
team = "payments"
owner = "oncall"
```

`[docs]` is rendered into the same TAGS INTRODUCTION section (before file-based TagsIntro docs).

### Runtime / env controls

- `--include-tags-intro <true|false>` / `MLEX_INCLUDE_TAGS_INTRO`
- `--tags-intro <path>` / `MLEX_TAGS_INTRO`
- `--tags-toml <path>` / `MLEX_TAGS_TOML`
- `--tags-vars key=value,key2=value2` / `MLEX_TAG_VAR_<KEY>=...`

### `config.toml` controls

You can also set TagsIntro behavior in `~/.mlex/config.toml`:

```toml
[component]
includeTagsIntro = true
tagsIntroPath = "AgentDocs/TagsIntro.md"
tagsTomlPath = "~/.mlex/tags.toml"

[component.tagsTemplateVars]
team = "payments"
owner = "oncall"
```

Precedence: runtime/CLI > env > config.toml > defaults.

Variable precedence: runtime `--tags-vars` > env `MLEX_TAG_VAR_*` > `component.tagsTemplateVars` > `~/.mlex/tags.toml` `[vars]`.

### Path notes (Windows / spaces)

- If a path contains spaces, always wrap it in quotes in CLI commands.
- Prefer absolute paths for `tagsTomlPath` to avoid ambiguity around shell `~` expansion.

Examples:

```bash
npx mlex chat --tags-toml "C:\Users\Steaven Jiang\.mlex\tags.toml"
npx mlex chat --tags-intro "D:\Work Space\MLEX\AgentDocs\TagsIntro.md"
```

---

## Search Augmentation Modes

`MLEX_SEARCH_AUGMENT_MODE` supports:
- `lazy`: search only when explicitly called by the model
- `auto`: auto-search and persist before `history.query`
- `scheduled`: periodically run seed queries and persist results
- `predictive`: trigger with proactive prediction flows

---

## Hybrid Performance Tuning

Hybrid retrieval now supports full performance knobs through `config.toml`, env, and CLI overrides.

### `config.toml` example

```toml
[manager]
hybridPrescreenRatio = 0.05
hybridPrescreenMin = 20
hybridPrescreenMax = 100
hybridRerankMultiplier = 3
hybridLocalCacheMaxEntries = 2000
hybridLocalCacheTtlMs = 300000

[component]
localEmbedBatchWindowMs = 5
localEmbedMaxBatchSize = 32
localEmbedQueueMaxPending = 1024
```

### PowerShell env example

```powershell
$env:MLEX_HYBRID_PRESCREEN_RATIO = "0.05"
$env:MLEX_HYBRID_PRESCREEN_MIN = "20"
$env:MLEX_HYBRID_PRESCREEN_MAX = "100"
$env:MLEX_HYBRID_RERANK_MULTIPLIER = "3"
$env:MLEX_HYBRID_LOCAL_CACHE_MAX = "2000"
$env:MLEX_HYBRID_LOCAL_CACHE_TTL_MS = "300000"
$env:MLEX_LOCAL_EMBED_BATCH_WINDOW_MS = "5"
$env:MLEX_LOCAL_EMBED_MAX_BATCH_SIZE = "32"
$env:MLEX_LOCAL_EMBED_QUEUE_MAX_PENDING = "1024"
```

### CLI overrides

- `--hybrid-prescreen-ratio <number>`
- `--hybrid-prescreen-min <number>`
- `--hybrid-prescreen-max <number>`
- `--hybrid-rerank-multiplier <number>`
- `--hybrid-local-cache-max <number>`
- `--hybrid-local-cache-ttl-ms <number>`
- `--local-embed-batch-window-ms <number>`
- `--local-embed-max-batch-size <number>`
- `--local-embed-queue-max-pending <number>`

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
