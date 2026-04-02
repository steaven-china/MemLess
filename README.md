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
| `mlex ingest <file>` | Import dataset into memory (`txt/json/jsonl`) |
| `mlex swarm` | Multi-agent collaboration |
| `mlex files:list` | Readonly directory listing |
| `mlex files:read` | Readonly file read |

---

## Data Importer (`mlex ingest`)

`mlex ingest` now imports records directly into memory blocks without going through LLM chat turns.

Supported input formats:
- `txt` (split by paragraph or line)
- `json` (array/object)
- `jsonl` / `ndjson` (one JSON object per line)

### CLI options

- `--format <auto|txt|json|jsonl>`: force format, default `auto` (by extension)
- `--text-field <name>`: text key for json/jsonl, default `text`
- `--role-field <name>`: role key for json/jsonl, default `role`
- `--time-field <name>`: timestamp key for json/jsonl, default `timestamp`
- `--default-role <system|user|assistant|tool>`: fallback role, default `user`
- `--text-split <paragraph|line>`: txt split mode, default `paragraph`
- `--seal-every <n>`: seal block every `n` imported records, default `1`
- `--max-records <n>`: import only first `n` parsed records
- `--dry-run`: parse and validate only, do not write memory

### PowerShell examples

```powershell
# txt (auto detect), split by paragraph
npx mlex ingest .\data\notes.txt --provider rule-based --storage-backend sqlite

# jsonl with custom field mapping
npx mlex ingest .\data\chat.jsonl --format jsonl --text-field content --role-field speaker --time-field ts --default-role user

# parse check only (no write)
npx mlex ingest .\data\dataset.json --format json --dry-run
```

`mlex ingest` prints import summary: detected format, imported count, skipped count, sealed count, and elapsed milliseconds.

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

## Topic Shift Proactive Trigger

MLEX now supports a dedicated topic-shift proactive signal (`topic_shift_soft` / `topic_shift_hard`).

Detection uses a chained check:
- current query vs previous query semantic similarity
- current query vs previous query keyword overlap
- current retrieval top blocks vs previous retrieval top blocks overlap

When at least 2 signals cross threshold, proactive follow-up can be injected to confirm new goals/constraints.

### `config.toml` example

```toml
[manager]
topicShiftTriggerEnabled = true
topicShiftMinKeywords = 2
topicShiftMinTokens = 3
topicShiftQuerySimilaritySoftMax = 0.35
topicShiftQuerySimilarityHardMax = 0.2
topicShiftKeywordOverlapSoftMax = 0.3
topicShiftKeywordOverlapHardMax = 0.15
topicShiftRetrievalOverlapSoftMax = 0.35
topicShiftRetrievalOverlapHardMax = 0.2
topicShiftSoftCooldownSeconds = 180
topicShiftHardCooldownSeconds = 600
```

### PowerShell env example

```powershell
$env:MLEX_TOPIC_SHIFT_TRIGGER_ENABLED = "true"
$env:MLEX_TOPIC_SHIFT_MIN_KEYWORDS = "2"
$env:MLEX_TOPIC_SHIFT_MIN_TOKENS = "3"
$env:MLEX_TOPIC_SHIFT_QUERY_SIMILARITY_SOFT_MAX = "0.35"
$env:MLEX_TOPIC_SHIFT_QUERY_SIMILARITY_HARD_MAX = "0.2"
$env:MLEX_TOPIC_SHIFT_KEYWORD_OVERLAP_SOFT_MAX = "0.3"
$env:MLEX_TOPIC_SHIFT_KEYWORD_OVERLAP_HARD_MAX = "0.15"
$env:MLEX_TOPIC_SHIFT_RETRIEVAL_OVERLAP_SOFT_MAX = "0.35"
$env:MLEX_TOPIC_SHIFT_RETRIEVAL_OVERLAP_HARD_MAX = "0.2"
$env:MLEX_TOPIC_SHIFT_SOFT_COOLDOWN_SECONDS = "180"
$env:MLEX_TOPIC_SHIFT_HARD_COOLDOWN_SECONDS = "600"
```

### CLI overrides

- `--topic-shift-trigger <true|false>`
- `--topic-shift-min-keywords <number>`
- `--topic-shift-min-tokens <number>`
- `--topic-shift-query-similarity-soft-max <number>`
- `--topic-shift-query-similarity-hard-max <number>`
- `--topic-shift-keyword-overlap-soft-max <number>`
- `--topic-shift-keyword-overlap-hard-max <number>`
- `--topic-shift-retrieval-overlap-soft-max <number>`
- `--topic-shift-retrieval-overlap-hard-max <number>`
- `--topic-shift-soft-cooldown-seconds <number>`
- `--topic-shift-hard-cooldown-seconds <number>`

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
hybridRerankHardCap = 16
hybridHashEarlyStopMinGap = 0.12
hybridLocalRerankTimeoutMs = 350
hybridRerankTextMaxChars = 512
hybridLocalCacheMaxEntries = 2000
hybridLocalCacheTtlMs = 300000

[component]
localEmbedBatchWindowMs = 5
localEmbedMaxBatchSize = 32
localEmbedQueueMaxPending = 1024
localEmbedExecutionProvider = "auto"
```

### PowerShell env example

```powershell
$env:MLEX_HYBRID_PRESCREEN_RATIO = "0.05"
$env:MLEX_HYBRID_PRESCREEN_MIN = "20"
$env:MLEX_HYBRID_PRESCREEN_MAX = "100"
$env:MLEX_HYBRID_RERANK_MULTIPLIER = "3"
$env:MLEX_HYBRID_RERANK_HARD_CAP = "16"
$env:MLEX_HYBRID_HASH_EARLY_STOP_MIN_GAP = "0.12"
$env:MLEX_HYBRID_LOCAL_RERANK_TIMEOUT_MS = "350"
$env:MLEX_HYBRID_RERANK_TEXT_MAX_CHARS = "512"
$env:MLEX_HYBRID_LOCAL_CACHE_MAX = "2000"
$env:MLEX_HYBRID_LOCAL_CACHE_TTL_MS = "300000"
$env:MLEX_LOCAL_EMBED_BATCH_WINDOW_MS = "5"
$env:MLEX_LOCAL_EMBED_MAX_BATCH_SIZE = "32"
$env:MLEX_LOCAL_EMBED_QUEUE_MAX_PENDING = "1024"
$env:MLEX_LOCAL_EMBED_EXECUTION_PROVIDER = "auto"
```

### CLI overrides

- `--hybrid-prescreen-ratio <number>`
- `--hybrid-prescreen-min <number>`
- `--hybrid-prescreen-max <number>`
- `--hybrid-rerank-multiplier <number>`
- `--hybrid-rerank-hard-cap <number>`
- `--hybrid-hash-early-stop-min-gap <number>`
- `--hybrid-local-rerank-timeout-ms <number>`
- `--hybrid-rerank-text-max-chars <number>`
- `--hybrid-local-cache-max <number>`
- `--hybrid-local-cache-ttl-ms <number>`
- `--local-embed-batch-window-ms <number>`
- `--local-embed-max-batch-size <number>`
- `--local-embed-queue-max-pending <number>`
- `--local-embed-execution-provider <provider>`

### GPU / NPU acceleration

`MLEX_LOCAL_EMBED_EXECUTION_PROVIDER` (or `localEmbedExecutionProvider`) controls the ONNX execution provider used by local embedding.

- `auto` (default): keep Transformers.js default provider order
- Typical acceleration values: `cuda`, `dml`, `openvino`, `qnn` (depends on your ONNX Runtime build)
- Robust fallback: if the configured provider fails at model load time, MLEX retries with `cpu`
- Important: this setting is only used when `MLEX_EMBEDDER=local|hybrid` (hash embedder ignores it)

#### Install GPU/NPU ONNX Runtime (required for real acceleration)

This repo currently uses `@xenova/transformers@2.17.2` (ORT ABI around `1.14.x`).
To enable hardware providers like `cuda`/`dml`, install the GPU runtime package alias:

```powershell
npm i onnxruntime-node@npm:onnxruntime-node-gpu@1.14.0 --save-exact
```

Then set:

```powershell
$env:MLEX_EMBEDDER = "hybrid"
$env:MLEX_LOCAL_EMBED_EXECUTION_PROVIDER = "cuda"  # or dml/qnn/openvino based on runtime
```

If provider is unavailable, MLEX prints a warning and falls back to CPU.

To switch back to CPU runtime package:

```powershell
npm i onnxruntime-node@1.14.0 --save-exact
```

---

## Chunk Manifest (Block-First + Context Expansion)

Chunk manifest is designed for compatibility mode:
- retrieval ranking still remains block-first
- chunk is used only to append nearby context blocks during assembly
- `chunkAffectsRetrieval` must stay `false` in current implementation

Important behavior:
- target/max settings are treated as **boundary hints**, not hard cuts
- if adjacent blocks are semantically continuous, a chunk can overflow these hints
- set `chunkManifestMaxTokens = 0` or `chunkManifestMaxBlocks = 0` to disable that bound check

### `config.toml` example

```toml
[manager]
chunkManifestEnabled = true
chunkAffectsRetrieval = false
chunkManifestTargetTokens = 1000
chunkManifestMaxTokens = 1400
chunkManifestMaxBlocks = 8
chunkManifestMaxGapMs = 900000
chunkNeighborExpandEnabled = true
chunkNeighborWindow = 1
chunkNeighborScoreGate = 0.75
chunkMaxExpandedBlocks = 4
```

### PowerShell env example

```powershell
$env:MLEX_CHUNK_MANIFEST_ENABLED = "true"
$env:MLEX_CHUNK_AFFECTS_RETRIEVAL = "false"
$env:MLEX_CHUNK_MANIFEST_TARGET_TOKENS = "1000"
$env:MLEX_CHUNK_MANIFEST_MAX_TOKENS = "1400"
$env:MLEX_CHUNK_MANIFEST_MAX_BLOCKS = "8"
$env:MLEX_CHUNK_MANIFEST_MAX_GAP_MS = "900000"
$env:MLEX_CHUNK_NEIGHBOR_EXPAND_ENABLED = "true"
$env:MLEX_CHUNK_NEIGHBOR_WINDOW = "1"
$env:MLEX_CHUNK_NEIGHBOR_SCORE_GATE = "0.75"
$env:MLEX_CHUNK_MAX_EXPANDED_BLOCKS = "4"
```

### CLI overrides

- `--chunk-manifest-enabled <true|false>`
- `--chunk-affects-retrieval <true|false>`
- `--chunk-manifest-target-tokens <number>`
- `--chunk-manifest-max-tokens <number>`
- `--chunk-manifest-max-blocks <number>`
- `--chunk-manifest-max-gap-ms <number>`
- `--chunk-neighbor-expand-enabled <true|false>`
- `--chunk-neighbor-window <number>`
- `--chunk-neighbor-score-gate <number>`
- `--chunk-max-expanded-blocks <number>`

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
- `GET /api/proactive/stream` (SSE, timer proactive push by `sessionId`)
- `POST /api/seal`
- `GET /api/debug/*` (debug API must be enabled)
- `GET /api/files/list`, `GET /api/files/read` (file API must be enabled)

`GET /api/debug/database` now includes structured proactive diagnostics:
- `proactive.latest` (latest proactive signal snapshot)
- `proactive.recent` (recent signal timeline)
- `proactive.nonTriggerReasons` (aggregated non-trigger reasons with counts)

---

## Bench Compare

Run hash vs hybrid benchmark suites with one command:

```bash
npm run bench:compare
```

Quick mode (smaller sample for fast regression checks):

```bash
npm run bench:compare:quick
```

Useful overrides:
- `--concurrency=<n>`
- `--max-cases=<n>`
- `--category-max-cases=<n>`
- `--report=<path>`

Example:

```bash
npx tsx scripts/bench-compare.ts --concurrency=2 --max-cases=60 --report=.mlex/bench/compare-custom.json
```

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
