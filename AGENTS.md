# irori for VS Code contributor contract

**Development ended on 2026-09-18.** The desktop application irori is the single
implementation of the layer model, and this repository is kept readable as the
record of how that model was worked out. Nothing further is planned, and nothing
is published under `del-taiseiozaki.irori-extention`. See the Key Decisions
entry in [docs/DESIGN.md](docs/DESIGN.md) for why. Ordinary contribution
guidance below still applies to a correction or a record kept here; a new
feature belongs in irori.

irori for VS Code provided the desktop application's capabilities as a VS Code
extension. It is an independent TypeScript repository with its own version,
tests and releases.

When this checkout is inside `KB_design`, the [workspace contract](../AGENTS.md)
governs shared work. Shared skills, rules and runtime configuration live in
`../.claude/`, `../.codex/` and `../.agents/`. Keep product source and design
records here; do not recreate that shared runtime in this repository.

Load context for the task:

- Current features and configuration: [README](README.md).
- Toolchain, test placement and packaging: [development notes](docs/DEVELOPMENT.md).
- Layer behavior and design decisions: [docs/DESIGN.md](docs/DESIGN.md), then
  only the related notes under `docs/plans/` or `docs/research/`.
- Resuming previous work: [PROGRESS](PROGRESS.md) and the actual Git diff;
  dated checkpoints describe their recorded state, not current authorization.

Keep scope ownership and layer classification independent of VS Code where
practical. A nested declared scope owns its files; mounted contents remain
source material even when named `AGENTS.md` or `CLAUDE.md`. Preserve existing
user configuration and distinguish planned capabilities from shipped ones.

Run commands from this repository. Use `npm ci` when dependencies are missing.
For code changes run `npm run compile` and `npm run test:unit`; compile includes
type checking and linting. Run `npm test` for VS Code integration changes and
report a missing display/host dependency if it prevents execution. For packaging
changes run `bash scripts/check-vsix-contents.sh` after a build. Use disposable
vaults for filesystem mutation tests. Documentation-only changes need link and
diff checks, not an application test run.

Respond in Japanese; write code, identifiers, technical documents and commit
messages in English.
