# AGENTS Guidelines (MLEX)

This file defines repository-level guidance for coding agents.

## Scope
- Applies to the full tree rooted at `D:\Struc\MLEX`.

## Stack and Runtime
- Use Node.js `>=20`.
- Use TypeScript ESM (`moduleResolution: NodeNext`).
- Keep code compatible with the current `tsconfig.json`.

## Architecture Rules
- Keep the memory architecture modular:
  - `src/memory/processing/*` for seal/index pipelines
  - `src/memory/management/*` for retention/compression policy
  - `src/memory/relation/*` for extraction + graph + persistence
  - `src/memory/prediction/*` for embedding/walk/prediction
  - `src/memory/output/*` for retrieval assembly/backtracking
- Prefer dependency injection through `src/container.ts`.
- Avoid hard-coding providers or storage backends inside module internals.

## Coding Style
- Keep changes focused and minimal.
- Prefer explicit types over `any`.
- Avoid one-letter variable names.
- Do not add inline comments unless required for non-obvious behavior.
- Reuse existing utilities before adding new helpers.

## Validation Requirements
- After code changes, run:
  1. `npm run typecheck`
  2. `npm test`
  3. `npm run build`
- Do not ship changes that break any of the above.

## Docs
- Update `README.md` when adding CLI flags, modules, or runtime behavior.
- Keep examples copy-pastable in PowerShell.
