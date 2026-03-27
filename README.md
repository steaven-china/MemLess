# MLEX Agent

MLEX 是一个**可运行的 CLI / Web AI Agent**，核心特色是“分层记忆系统”：
- 对话事件自动分块封存（block sealing）
- 混合检索（关键词 + 向量 + 关系图）
- 可选关系抽取与预测触发
- 支持把工具调用（含文件读取）写入记忆与关系

如果你在做需要长期上下文的 Agent 项目（研发助手、项目记忆助手、流程追踪助手），这个仓库可以直接作为基础框架。

---

## 你会得到什么

- **开箱可跑**：`mlex chat` / `mlex web` / `mlex ask`
- **可替换后端**：`memory` / `sqlite` / `lance` / `chroma`
- **可替换模型提供方**：`rule-based` / `openai` / `deepseek-reasoner`
- **可观察可调参**：debug trace、检索权重、压缩策略、预测策略
- **工具调用可入库**：`web.search.record`、`web.fetch.record`、`readonly.list`、`readonly.read`

---

## 项目结构（速览）

```text
src/
  agent/                 # Agent 主循环、provider、tool executor
  memory/
    processing/          # seal/index 主链
    management/          # retention/compression 策略
    relation/            # relation 提取、图、存储
    prediction/          # 图嵌入、随机游走、主动触发
    output/              # context 组装、raw 回溯
  search/                # 外部搜索与网页抓取
  web/                   # 内置 http 服务与前端页面
  cli/                   # 命令行入口
```

---

## 环境要求

- Node.js `>=20`（推荐 `22+`）
- npm `>=10`

> SQLite 后端依赖 `node:sqlite`。若当前运行时不支持，请改用 `memory` 或 `lance` 后端。

---

## 快速开始

```bash
npm install
npm run build
npx mlex chat --provider rule-based
```

开发模式：

```bash
npm run dev
```

Web 模式：

```bash
npm run web
```

---

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run typecheck` | TypeScript 类型检查（no emit） |
| `npm test` | 运行全部 Vitest 测试 |
| `npm run build` | tsup 构建到 `dist/` |
| `npm run acceptance` | 验收测试 |
| `npm run verify:arch` | `typecheck -> test -> build -> acceptance` |

CLI 入口：

| 命令 | 说明 |
| --- | --- |
| `mlex chat` | 交互式对话（TUI） |
| `mlex web` | 启动 Web UI + API |
| `mlex ask` | 单次提问 |
| `mlex ingest <file>` | 导入文本到记忆 |
| `mlex swarm` | 多 agent 协作 |
| `mlex files:list` | 只读列目录 |
| `mlex files:read` | 只读读文件 |

---

## 核心概念

### 1) Seal（封存）
对话事件先进入 active block，达到策略条件后封存为历史 block。

### 2) Retrieval（检索）
检索融合三路信号：
- 关键词匹配
- 向量相似度
- 关系图扩展

### 3) Retention（保留策略）
支持 `raw / compressed / conflict`，并可在输出时做 raw backtrack。

### 4) Relation（关系）
支持启发式与 LLM 抽取，关系写入图与持久层。

### 5) Prediction / Proactive
支持图嵌入 + 随机游走预测，并带主动触发策略（可配置）。

---

## Provider 配置示例

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

## 存储后端示例

### SQLite（推荐默认）

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

## 搜索增强模式

`MLEX_SEARCH_AUGMENT_MODE` 支持：
- `lazy`：仅模型显式调用时搜索
- `auto`：在 `history.query` 前自动搜索并入库
- `scheduled`：定时跑种子 query 入库
- `predictive`：配合 proactive 预测触发

---

## 工具调用入库（重点）

当前支持把以下工具结果写入记忆：
- `web.search.record`
- `web.fetch.record`
- `readonly.list`
- `readonly.read`

其中 `readonly.read` 会额外记录：
- 文件快照语义（`contentHash` / `versionKey` / `nearDuplicateKey`）
- 文件关系边（如 `SNAPSHOT_OF_FILE`、`FILE_MENTIONS_BLOCK`）
- 文件向量入库（独立 `file_vectors` 表）

---

## Web API（简表）

- `GET /healthz`
- `GET /api/capabilities`
- `POST /api/chat`
- `POST /api/chat/stream`（SSE）
- `POST /api/seal`
- `GET /api/debug/*`（需开启 debug api）
- `GET /api/files/list`、`GET /api/files/read`（需开启 file api）

---

## 常见问题

### Q1: `node:sqlite` 不可用
请升级 Node，或切到 `memory/lance/chroma` 后端。

### Q2: Windows 下 `spawn EPERM`（esbuild）
常见原因是安全软件拦截或执行权限受限。优先先跑 `npm run typecheck` 确认代码层面状态。

---

## 开发与贡献建议

每次改动后建议按顺序执行：

```bash
npm run typecheck
npm test
npm run build
```

若改动涉及架构链路，再执行：

```bash
npm run verify:arch
```

---

## License

本项目基于 [Apache License 2.0](./LICENSE) 发布。
补充归属声明见 [NOTICE](./NOTICE)。
