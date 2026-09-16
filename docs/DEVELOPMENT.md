# irori for VS Code development notes

Run commands from the extension repository. Use npm with `package-lock.json`;
`npm ci` installs the locked dependencies. CI uses Node 22. The authoritative
commands are in [package.json](../package.json), with contributor gates in
[AGENTS.md](../AGENTS.md).

`npm run compile` runs type checking and linting before bundling
`src/extension.ts` into `dist/extension.js`. `npm run package` produces the
production bundle; `vscode` remains an external supplied by the host. F5 in
VS Code runs the Extension Development Host through the configured watch task.
The `npm-run-all` command used by `npm run watch` is supplied by the
`npm-run-all2` package; the name difference is intentional.

| Test surface | Source location | Command and behavior |
| --- | --- | --- |
| Logic without a VS Code dependency | `src/test/unit/**/*.test.ts` | `npm run test:unit` compiles, then runs Mocha directly. No VS Code process or download. |
| Real VS Code API and extension behavior | `src/test/*.test.ts` (top level) | `npm test` builds and launches VS Code. `.vscode-test.mjs` selects `out/test/*.test.js`. |

Use the existing Mocha TDD interface (`suite` / `test`) and Node `assert`.
Keep pure classification and tree logic outside the VS Code dependency chain
so the unit suite stays host-independent. Use disposable vaults for mutation
checks and test meaningful ownership, contents and invalid-input behavior.
CI runs the unit suite; it does not run the real VS Code integration suite.
There is no configured formatter, mocking library or coverage threshold.

[CI](../.github/workflows/ci.yml) also verifies the package allow-list through
`bash scripts/check-vsix-contents.sh` after building. `.vscodeignore` excludes
product design documents and agent artifacts from the VSIX. An untracked file
can still enter the candidate package, so inspect a package-check failure
before changing the allow-list. Releases are handled by the separate
[tag-driven workflow](../.github/workflows/release.yml).
