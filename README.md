# semantic-platform

Enterprise semantic platform. BI, process, and knowledge agents share one semantic contract. Models are built with 「场景驱动语义构建」: a business-scenario description becomes requirement goals `G[]`, and only the semantic objects that support those goals are added. Results settle into business-domain Namespaces. A dialogue-driven harness proposes changes as diffable patches; a person confirms the release.

M0 is the contract scaffold. M1 adds rule versions, calculation receipts, evidence labels, and the two teaching-case evals. There is still no query engine, and agents do not write systems of record.

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
packages/kernel       load, validate, diff, patch, rule versions, receipts, eval
packages/cli          semantic validate | diff | eval | export-osi
packages/mcp-server   MCP read tools; write tools stay behind the approval gate
packages/harness      dialogue kernel wrapping DeepSeek Harness
packages/workbench    zh-CN web shell
examples/hr-leave     hr Namespace, including eval_hr_001
examples/finance-expense   finance Namespace, including eval_exp_001
config/auth.example.yaml   OIDC placeholder + local admin account
config/llm.example.yaml    Ark base URL and model; key is ARK_API_KEY only
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
pnpm dev:workbench:api   # 需要 LOCAL_ADMIN_PASSWORD
pnpm dev:workbench
pnpm mcp   # stdio, SEMANTIC_MODEL_DIR defaults to examples/hr-leave
```

`semantic export-osi <dir> --target osi|metricflow|snowflake` selects the OSI stub or a metric-compiler stub. The default target is `osi`.

The workbench API checks the local admin username `admin` against `LOCAL_ADMIN_PASSWORD`. The password is not stored in the repo. Enterprise SSO is configured in `config/auth.example.yaml` but is not connected. Start `pnpm dev:workbench:api` and `pnpm dev:workbench`, then open the Vite URL. Choose 教学夹具公司, a project, and a scenario. Asking a fixture question returns a tool receipt. Leave stays blocked by the open sick-leave gap. Expense can be released by the logged-in admin, and the record can be read back. Git merges and tickets are not a release gate.

## What M1 runs

- `semantic eval` still checks that golden questions, answers, and `expectedObjects` resolve. Cases marked as calculation-basis or version-interference also have to pass the release gate: correct basis, correct version, correct citation, and a complete tool receipt.
- `eval_hr_001`: Friday through next Monday is 2 working days, so HR approval is not required, and remaining leave is 8 days. Treating the span as 4 calendar days and requiring HR approval fails the gate.
- `eval_exp_001`: Wednesday through Friday is 3 calendar days, the in-force cap is 300, the 420 invoice reimburses 300, and 120 is out of pocket. Choosing the superseded 150 rate fails the gate.
- MCP read tools include `query_rule_version`, `get_leave_days`, `get_trip`, `get_limit`, `retrieve_evidence`, and `get_eval_case`. The default server does not register write tools.
- LLM settings live in `config/llm.example.yaml`. `LLM_BASE_URL` and `LLM_MODEL` override them. `ARK_API_KEY` is never stored in the repo.

## What is still stubbed

- Eval scoring does not answer open questions outside the two teaching fixtures.
- OSI export returns `status: "stub"` and `osiVersion: "unspecified"`. Actions, policies, eval cases, gap logs, mappings, and rules are listed as extensions because the internal model is a superset of OSI.
- MetricFlow and Snowflake semantic view compilers return the same metric list and do not emit runnable projects.
- Write tools are not registered on the default MCP server. When the write scaffold is enabled, `invoke_action` and `propose_patch` still return `not_implemented`, and `approve_leave`, `submit_expense`, and `ingest_eval_case` stop at the approval gate without writing.
- The workbench does not load the model. 试问沙箱 replies with a fixed notice. 评测 tells you to use the CLI.
- The dialogue kernel can validate a proposed patch, but it does not call Ark or run the live DeepSeek Harness loop.

## Open questions

- Which OSI specification version should the exporter target once it stops being a stub?
- Should metric expressions stay free text, or become a MetricFlow-compatible subset? M0 does not parse them.
- May a Relation, Metric, or Action write-back target cross Namespaces? M0 rejects that.
- Which OIDC provider, and what session shape, replaces the placeholder issuer?
- Where does human release confirmation happen: a workbench action, a Git pull request, or an external ticket?
- Should an open GapLog block release? M0 keeps the gap and does not block.
- EvalCase may be its own document or an entry inside a CasePack. The HR example keeps a CasePack of three cases. `eval_hr_001` and `eval_exp_001` are standalone documents.
