# semantic-platform

M0 scaffold for an enterprise semantic platform. BI, process, and knowledge agents share one semantic contract. Models are built with 「场景驱动语义构建」: a business-scenario description becomes requirement goals `G[]`, and only the semantic objects that support those goals are added. Results settle into business-domain Namespaces. A dialogue-driven harness proposes changes as diffable patches; a person confirms the release.

This repository is an empty shell. The only domain content is a tiny HR leave example used to prove validation. There is no query engine.

Chinese design notes live in [docs/](docs/architecture.md).

## Stack

TypeScript and pnpm workspaces.

- The contract’s source of truth is JSON Schema. Ajv validates it, and the same schemas are shared by the kernel, CLI, and MCP server without a second model language.
- YAML is the authoring format (`js-yaml`). Patches are YAML too, so reviews stay readable.
- Node 22 runs TypeScript directly (type stripping), so the CLI and MCP server do not need a compile step.
- Vitest covers the kernel, CLI, and MCP tools.
- The workbench is a small Vite + React shell. Navigation is Simplified Chinese: 图谱 / 目录 / 试问沙箱 / 评测.
- MCP uses `@modelcontextprotocol/sdk` over stdio. Read tools and write tools are separate.

Lint in M0 is `tsc --noEmit` plus a terminology check. That is enough to keep the workspace type-safe before a style ruleset exists.

## Layout

```
packages/contract     JSON Schemas and Ajv validation
packages/kernel       load, validate, diff, patch, eval stub, OSI and compiler stubs
packages/cli          semantic validate | diff | eval | export-osi
packages/mcp-server   MCP skeleton
packages/workbench    zh-CN web shell
examples/hr-leave     one Namespace that must validate
config/auth.example.yaml   OIDC placeholder + local admin account
docs/                 architecture, objects, harness, roadmap
```

## Commands

```bash
pnpm install
pnpm lint
pnpm test
pnpm validate:examples
pnpm eval:examples
pnpm export:examples
pnpm dev:workbench
pnpm mcp   # stdio, SEMANTIC_MODEL_DIR defaults to examples/hr-leave
```

`semantic export-osi <dir> --target osi|metricflow|snowflake` selects the OSI stub or a metric-compiler stub. The default target is `osi`.

Authentication is not wired up. Copy `config/auth.example.yaml` when a real issuer exists. The local admin username is `admin`; the password is read from `LOCAL_ADMIN_PASSWORD` and is not stored in the repo. The workbench buttons only switch a placeholder session label.

## What is stubbed

- Eval scoring checks that golden questions, expected answers, and `expectedObjects` still resolve. It does not answer questions.
- OSI export returns `status: "stub"` and `osiVersion: "unspecified"`. Actions, policies, eval cases, gap logs, and mappings are listed as extensions because the internal model is a superset of OSI.
- MetricFlow and Snowflake semantic view compilers return the same metric list and do not emit runnable projects.
- MCP write tools `invoke_action` and `propose_patch` return `not_implemented`. `invoke_action` still reports whether the Action requires approval.
- The workbench does not load the model. 试问沙箱 replies with a fixed notice. 评测 tells you to use the CLI.
- The harness loop described in `docs/harness-flow.md` is not implemented.

## Open questions

- Which OSI specification version should the exporter target once it stops being a stub?
- Should metric expressions stay free text, or become a MetricFlow-compatible subset? M0 does not parse them.
- May a Relation, Metric, or Action write-back target cross Namespaces? M0 rejects that.
- Which OIDC provider, and what session shape, replaces the placeholder issuer?
- Where does human release confirmation happen: a workbench action, a Git pull request, or an external ticket?
- Should an open GapLog block release? M0 keeps the gap and does not block.
- EvalCase may be its own document or an entry inside a CasePack. The example uses a CasePack of three cases. Standalone files are valid but unused.
