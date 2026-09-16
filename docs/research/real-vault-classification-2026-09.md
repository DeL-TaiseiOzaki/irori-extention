# Does irori actually split a real vault? (measured, 2026-09-09)

**Status:** measurement report. Every claim below is backed by output observed in a real
VS Code instance on this machine. Nothing here is inferred. **No source file was changed** —
this document only records what the shipped code does today.

**Why:** the core value proposition — one real folder containing git submodules and
rclone-style mounts is split into the five regions — had never been exercised. The grid spike
only ever rendered `syntheticModel()`, and `src/spike/gridModel.ts` says in its own comment
that its my/team split is "a spike-only stand-in for the scope-partitioning step". Nothing in
`src/` handles submodules, gitlinks, scope roots, or mounts.

**Environment:** VS Code 1.136.2 (linux-x64, downloaded by `@vscode/test-electron` into
`.vscode-test/`), Xvfb `:99`, extension loaded via `--extensionDevelopmentPath`, shipped
default settings only (`--user-data-dir` was a throwaway profile).

---

## 1. The fixture

Built by `scratchpad/build-fixture.sh` (throwaway, outside the repository) at
`…/scratchpad/fixture-vault/`. Shape, abbreviated:

```
fixture-vault/                     git repo = the personal vault, opened as the workspace root
  .claude/{settings.json,rules/coding.md}
  AGENTS.md  CLAUDE.md  .gitmodules
  knowledge/notes/{idea.md,daily.md}
  ontology/terms.csv
  contents/
    local-raw/{note-in-raw.md,sample.bin}     ordinary real directory
    gdrive    -> ../../mounts/gdrive-combine  symlink, resolves (rclone "combine" shape)
    onedrive  -> ../../mounts/not-mounted-here  symlink, DANGLING ("not mounted on this device")
  team-kb/engineering/   real git submodule (nested, where a naive glob catches it)
  partner-kb/            real git submodule (top level)

mounts/gdrive-combine/               the mount target, outside the vault
  MyDrive/{CLAUDE.md,notes/meeting-2026-09.md,data/rows.csv,media/photo.bin}
  SharedDrive-Alpha/{AGENTS.md,spec/spec.md}
  SharedDrive-Beta/archive/old.md
```

Each submodule carries its own three layers: `CLAUDE.md`, `AGENTS.md`, `.claude/rules/house.md`,
`docs/architecture.md`, `ontology/terms.csv`.

Confirmed real, not simulated:

```
$ git -C fixture-vault ls-files -s | grep -E '^(160000|120000)'
120000 … contents/gdrive
120000 … contents/onedrive
160000 … partner-kb
160000 … team-kb/engineering
$ git -C fixture-vault submodule status
 76fc9d9… partner-kb (heads/main)
 49db65e… team-kb/engineering (heads/main)
```

rclone itself is not installed here and FUSE is unavailable, so the *filesystem shape* rclone
produces on macOS (a symlink in `contents/` pointing at the mount) was reproduced with real
symlinks. That is the form the user verified on 2026-09-07.

## 2. How it was measured

`scratchpad/harness/probe.js` runs **inside the real extension host** (launched by
`harness/launch.js` through `@vscode/test-electron`, `--folder-uri` = the fixture). It

1. activates the shipped extension,
2. calls `vscode.workspace.findFiles` with the exact include/exclude `scanWorkspace()` builds,
3. instantiates the shipped `WorkspaceIndex` from `out/workspaceIndex.js` and awaits
   `refresh()` — i.e. the real scan path, the real `classifyFiles`, the real `buildTree`,
   the real `package.json` defaults,
4. toggles `search.followSymlinks` and re-measures.

```bash
npm run compile-tests && npm run compile
env -u ELECTRON_RUN_AS_NODE DISPLAY=:99 node …/scratchpad/harness/launch.js
```

Traps that had to be worked around: `ELECTRON_RUN_AS_NODE=1` in the ambient environment, and a
`--user-data-dir` under the scratchpad whose IPC socket path exceeds 107 chars (VS Code fails
to start with `listen EINVAL`) — the profile had to live at a short path.

## 3. Observed results

### Q1 — Does `findFiles` descend into a git submodule? **Yes, completely.**

All five files of *each* submodule are returned, nested and top level alike:

```
team-kb/engineering/.claude/rules/house.md      partner-kb/.claude/rules/house.md
team-kb/engineering/AGENTS.md                   partner-kb/AGENTS.md
team-kb/engineering/CLAUDE.md                   partner-kb/CLAUDE.md
team-kb/engineering/docs/architecture.md        partner-kb/docs/architecture.md
team-kb/engineering/ontology/terms.csv          partner-kb/ontology/terms.csv
```

The submodule's `.git` **file** (the gitlink) is returned only when excludes are disabled
entirely (`findFiles(include, null)`); it is absent both under the default excludes and under
the shipped `irori.exclude` — which of the two removes it was not isolated. Nothing about
the search stack treats a submodule as a boundary.

### Q2 — Does `findFiles` follow a symlink inside the workspace? **Yes, and it honours `search.followSymlinks`.**

This was previously recorded as architectural inference. It is now measured. Toggling the
setting and re-running the identical query:

```
search.followSymlinks=true  -> 27 files
search.followSymlinks=false -> 20 files
present ONLY when true:
  + contents/gdrive/MyDrive/CLAUDE.md
  + contents/gdrive/MyDrive/data/rows.csv
  + contents/gdrive/MyDrive/media/photo.bin
  + contents/gdrive/MyDrive/notes/meeting-2026-09.md
  + contents/gdrive/SharedDrive-Alpha/AGENTS.md
  + contents/gdrive/SharedDrive-Alpha/spec/spec.md
  + contents/gdrive/SharedDrive-Beta/archive/old.md
```

Exactly the seven files behind the symlink, and nothing else. The default is `true`, so the
mount is visible out of the box. Note also that `irori.followSymlinks` was `false`
(its shipped default) during the run in which all seven files *were* returned: **the
extension's own symlink knob has no effect on an in-workspace mount**; it only gates
`walkDirectory()` for a layer's external `roots`.

Supplementary (same harness, `harness/probe2.js`): writing a `.gitignore` containing
`contents/gdrive/`, `contents/onedrive/` and `*.bin` removed **nothing** — 27 → 28 files, the
delta being `.gitignore` itself — and `search.useIgnoreFiles=false` changed nothing either.
With the shipped exclude argument, ignore files do not hide a mount. (The combination
"`exclude` omitted entirely + `.gitignore` present" was **not tested**.)

### Q3 — Where does a submodule's `CLAUDE.md` land? **In the parent's schema layer, merged.**

Real `WorkspaceIndex` output, schema layer:

```
[schema] (10)
  .claude/rules/coding.md
  .claude/settings.json
  AGENTS.md
  CLAUDE.md
  contents/gdrive/MyDrive/CLAUDE.md
  contents/gdrive/SharedDrive-Alpha/AGENTS.md
  partner-kb/AGENTS.md
  partner-kb/CLAUDE.md
  team-kb/engineering/AGENTS.md
  team-kb/engineering/CLAUDE.md
```

Five different agent contracts — the vault's own, two submodules', and one from a mounted
shared drive — sit in one flat panel with nothing marking which repository each governs.

**Worse, the submodule's schema layer is torn in half.** `.claude/**` is root-anchored while
`**/CLAUDE.md` is not, so `team-kb/engineering/.claude/rules/house.md` misses schema and falls
through to `**/*.md`:

```
[knowledge] contains: partner-kb/.claude/rules/house.md
                      team-kb/engineering/.claude/rules/house.md
```

A submodule's `CLAUDE.md` is schema; the `.claude/` directory next to it is knowledge.

### Q4 — Where does a mounted drive's content land? **Scattered across four layers; almost never Raw.**

```
schema     contents/gdrive/MyDrive/CLAUDE.md, contents/gdrive/SharedDrive-Alpha/AGENTS.md
ontology   contents/gdrive/MyDrive/data/rows.csv
knowledge  contents/gdrive/MyDrive/notes/meeting-2026-09.md
           contents/gdrive/SharedDrive-Alpha/spec/spec.md
           contents/gdrive/SharedDrive-Beta/archive/old.md
           contents/local-raw/note-in-raw.md
raw        contents/gdrive/MyDrive/media/photo.bin, contents/local-raw/sample.bin
```

`raw` is defined last, so first-match-wins hands every `.md` and `.csv` under `contents/` to
`knowledge`/`ontology` first. Of the nine files under `contents/`, the Raw layer got two — only
the ones with an extension no earlier layer claims. `contents/**` is effectively dead for text.

### Q5 — What happens to the dangling symlink? **Silently skipped, with no diagnostic.**

`findFiles` returns nothing for it (no error, no warning). Through the VS Code FS API:

```
stat  contents/onedrive         -> type=64 size=29        (SymbolicLink, no Directory bit)
stat  contents/gdrive           -> type=66 size=4096      (SymbolicLink|Directory)
readDirectory contents          -> ['gdrive:66','local-raw:2','onedrive:64']
readDirectory contents/onedrive -> ERROR EntryNotFound (FileSystemError): ENOENT … scandir
```

So the information *is* available (`type === 64` means a link that resolves to nothing), but
nothing in `src/` looks at it: `scanWorkspace()` only consumes `findFiles` results, and the
`reportWalk()` diagnostics that would warn a user run exclusively on external `roots`. A user
whose drive is not mounted on this device sees an empty area and is told nothing.

### Q6 — Is any of this distinguishable in the output? **No. The information is simply absent.**

`ClassifiedFile` as produced for the fixture carries only two populated fields:

```json
{"key":"file:///…/fixture-vault/team-kb/engineering/CLAUDE.md",
 "relativePath":"team-kb/engineering/CLAUDE.md"}
```

`rootLabel` is `undefined` (single-root workspace); tree nodes carry only `name`/`path`. There
is no submodule flag, no scope-root id, no mount marker, no origin. `buildTree` renders
`team-kb/engineering/` and `contents/gdrive/` as ordinary directories, indistinguishable from
`knowledge/`.

Consequence, demonstrated by running the spike's five-region model over this real file list
(`buildGridModel` with `DEFAULT_LAYERS`):

```
[myKnowledge]   MY KNOWLEDGE BASE      … team-kb/engineering/.claude/rules/house.md
                                       … partner-kb/docs/architecture.md
[teamKnowledge] TEAM KNOWLEDGE BASES
   group "Engineering KB"              … knowledge/notes/idea.md        <- the user's own note
                                       … contents/local-raw/note-in-raw.md
   group "Research KB"                 … team-kb/engineering/docs/architecture.md
   group "Product KB"                  … contents/gdrive/MyDrive/notes/meeting-2026-09.md
```

The user's personal note is filed under a team KB; a team submodule's file is filed as the
user's own; one submodule is split across two invented groups. That is `bucketOf()` hashing the
path — there is nothing else in the model to split on.

## 4. What is broken

1. **No scope partitioning exists.** The my/team split has no input: the classification carries
   no origin. This is not a spike gap, it is a missing field in `ClassifiedFile`.
2. **Submodule schema is split between two layers.** `.claude/**` is root-anchored,
   `**/CLAUDE.md` is not. A submodule's `.claude/` lands in knowledge.
3. **All agent contracts merge into one flat schema panel**, with no indication of which
   repository each one governs.
4. **The Raw layer barely fires.** Layer order beats `contents/**` for every text file.
5. **A not-mounted drive is indistinguishable from an empty one.** The signal exists
   (`FileType` 64) and is discarded.
6. **`irori.followSymlinks` does not do what its name suggests** for the primary case: the
   in-workspace mount is governed by VS Code's `search.followSymlinks` (default `true`) instead.

## 5. Reproducing

```bash
bash …/scratchpad/build-fixture.sh
npm run compile-tests && npm run compile
env -u ELECTRON_RUN_AS_NODE DISPLAY=:99 node …/scratchpad/harness/launch.js   # → probe-report.json
env -u ELECTRON_RUN_AS_NODE DISPLAY=:99 node …/scratchpad/harness/launch2.js  # → probe2-report.json (.gitignore probe)
```

The harness deliberately lives outside the repository: it opens its own VS Code instance with
its own `extensionTestsPath`, so `npm test` (`out/test/*.test.js`) is untouched.
