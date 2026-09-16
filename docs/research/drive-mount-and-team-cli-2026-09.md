# Drive Mounting and `Tencent/teamai-cli` — Tool Evaluation

**Date:** 2026-09-08 · **Author:** `general-purpose-opus` (external research)
**Question:** how can several Google Drives (personal + team/Shared) be made to appear as
mounts *inside* one real `contents/` directory, and does `Tencent/teamai-cli` belong anywhere
near this project?

**Binding constraints** (from `docs/DESIGN.md` and the user's design note):

- `contents/` must be a **real directory**; the mounts go *inside* it. `contents` itself must
  never be a symlink, because git stores a symlink as a file and the trailing-slash
  `contents/` ignore rule then fails to match.
- The contents of `contents/` legitimately **differ per machine**. Absence is not evidence of
  breakage. This is the reason FR-10 (manifest) exists.
- Consumers: the VS Code extension today (`roots` scanning, `FileDecorationProvider`), a
  planned Obsidian plugin. Obsidian cannot reach outside the vault, and has **no filesystem
  access at all on mobile**.

---

## 0. Verdict table

| Tool | Verdict | Decisive reason |
|---|---|---|
| `Tencent/teamai-cli` | **does not fit** | Real, active, MIT, Tencent-owned — but it is a git-repo distributor of agent skills/rules/MCP config. Zero filesystem-mount and zero Google Drive surface. |
| rclone | **fits with caveats** | `rclone backend -o config drives drive:` emits a `combine` remote that exposes My Drive **and every Shared Drive as sibling subdirectories of one remote**, mountable onto a single empty directory inside `contents/`. Caveat: a per-OS FUSE layer, and nothing on mobile. |
| Google Drive for Desktop | **fits with caveats** | It already puts My Drive and Shared drives under one predictable per-account root (`G:\`, `~/Library/CloudStorage/GoogleDrive-<email>/`), but the mount point is OS-/app-controlled and cannot be placed inside `contents/` — a link per account is still required, and on Windows the target volume reports as FAT. |
| "GWS CLI" (`gws`, GAM, `gcloud`, Drive REST API) | **does not fit** | All of them are API-level only. None mounts a filesystem. `gcloud` does not touch Google Drive at all, and the `googleworkspace/cli` README says in so many words: "This is **not** an officially supported Google product." |

---

## 1. `Tencent/teamai-cli`

### 1.1 It exists, and it is what the name suggests

Verified through the GitHub API on 2026-09-08:

| Field | Value |
|---|---|
| Repository | `Tencent/teamai-cli` — <https://github.com/Tencent/teamai-cli> |
| Description | "Make Every Team AI Native" |
| Created | 2026-04-27 |
| Last push | 2026-09-07 (i.e. yesterday) |
| Stars / forks / open issues | 1,237 / 100 / 28 |
| Language | TypeScript |
| Archived / disabled | `false` / `false` |
| Latest releases | `v0.23.0-beta.3` (2026-09-07), `v0.23.0-beta.1` (2026-09-04), `v0.22.0` (2026-09-02) |
| Licence | MIT — the `LICENSE` file states "teamai-cli is licensed under MIT. teamai-cli does not impose any additional restrictions beyond those specified in the license." (<https://raw.githubusercontent.com/Tencent/teamai-cli/main/LICENSE>) |

Note: the GitHub API reports `license: NOASSERTION` because the file is prefixed with Tencent's
standard preamble; the body is verbatim MIT.

Contributor concentration is high — `jeff-r2026` has 461 of the commits, the second contributor
89, and the rest are in the single digits (`/repos/Tencent/teamai-cli/contributors`). This is a
young, fast-moving, effectively single-maintainer project inside a large org, four months old
and still on `0.x` betas.

### 1.2 What it actually does

From the README (<https://github.com/Tencent/teamai-cli/blob/main/README.md>) and
`docs/providers.md`:

It distributes a *team's* AI-agent configuration — skills, rules, hooks, MCP server definitions,
docs — to each member's local AI coding tools (Claude Code, Codex, CodeBuddy, WorkBuddy,
OpenCode, Cursor, Qoder, JoyCode, …). The workflow is `push → review & merge → pull`, and the
transport is **an ordinary git repository**: the team repo holds the resources, members run
`teamai pull`, and the CLI writes them into tool-specific directories such as
`~/.claude/skills/`.

Architecture consequences:

- **No server component of its own.** Distribution is whatever git host you already use.
  `docs/providers.md` lists GitHub (`gh` CLI OAuth or `GITHUB_TOKEN`), GitLab (`GITLAB_TOKEN`),
  GitCode, CNB, plain Git (credential helper / SSH), and TGit (腾讯工蜂). **Only the TGit
  provider is Tencent-hosted infrastructure**; every other provider is external, so the tool can
  be run with no traffic to Tencent at all.
- Runtime dependencies are consistent with that: `simple-git`, `fs-extra`, `yaml`, `zod`,
  `commander`, `web-tree-sitter` / `tree-sitter-wasms` (the code-graph ingestion), `listr2`,
  `ora`, `chalk` (`package.json`, v0.22.0). There is no cloud SDK.
- Install is `npm install -g teamai-cli`; the binary is `teamai`.

Commands include `init` / `pull` / `push`, `skill` / `rule` / `hook` / `mcp`, `recall`
(knowledge search), `import` / `codebase` (code-graph ingestion), `digest` / `session save` /
`dashboard`, and `roles` / `tags` / `source`. Its "Team Knowledge Recall" builds a searchable
knowledge base stored as structured markdown plus graph data in a `teamwiki/` directory **inside
the team git repo**.

### 1.3 Relation to this project

- **Google Drive: none.** No mention anywhere in the README or the provider docs.
- **File sync: only in the git sense.** It syncs configuration files between a git repo and
  local tool directories. It does not mount, stream, or virtualise anything.
- **Knowledge base: yes, but the wrong half.** `teamwiki/` is git-tracked markdown — precisely
  the `schema` + `Knowledge_Base` side that irori already handles with git. It has nothing
  to say about the `contents/` layer, which is defined by being *outside* git.
- **Overlap risk.** Its `skills` / `rules` / `hooks` distribution model overlaps this
  repository's own `.claude/` + `.agents/` + `.codex/` boundary (see `CLAUDE.md`, "Native
  Runtime Boundary"). Adopting it would mean handing that boundary to a four-month-old `0.x`
  tool. That is a separate decision from the mount question and should not be bundled with it.

**Verdict: does not fit** the problem it was named against. It is not vapourware and not
mislabelled — it simply solves an unrelated problem.

---

## 2. rclone

Current release **v1.75.1**, published 2026-09-04 (`/repos/rclone/rclone/releases/latest`).
MIT, 59.6k stars, last push 2026-09-07.

### 2.1 The decisive capability: `combine` + one mount

`rclone` has a `combine` backend that grafts several remotes into one directory tree:
`upstreams = dir=remote:path dir2=remote2:path` (<https://rclone.org/combine/>, page last
updated 2026-03-17).

And it ships a purpose-built generator for exactly this case:

> **Configuring for Google Drive Shared Drives** — Rclone has a convenience feature for making
> a combine backend for all the shared drives you have access to. Assuming your main (non shared
> drive) Google drive remote is called `drive:` you would run
> `rclone backend -o config drives drive:`

which emits `alias` remotes per drive plus:

```
[AllDrives]
type = combine
upstreams = "My Drive=My Drive:" "Test Drive=Test Drive:"
```

> If you then add that config to your config file … then you can access all the shared drives in
> one place with the `AllDrives:` remote.

So **one** `rclone mount AllDrives: contents/drive` produces `contents/drive/My Drive/`,
`contents/drive/<Shared Drive A>/`, `contents/drive/<Shared Drive B>/` — several Google Drives
inside one real directory, with `contents/` itself untouched as a plain directory. A second
account is a second `combine` remote and a second mount at, say, `contents/drive-work/`.

This matters because a single Drive remote cannot span both kinds of drive: the Drive backend
docs state that "One remote can only be configured to access either My Drive or a single Shared
Drive" (<https://rclone.org/drive/>). `combine` is the documented escape hatch, and
`--drive-team-drive` / the `team_drive` config key is what pins each upstream.

### 2.2 FUSE layer per OS, and the macFUSE licensing question

**macOS.** The rclone docs say mounting "can be done either via built-in NFS server, macFUSE
(also known as osxfuse) or FUSE-T. macFUSE is a traditional FUSE driver utilizing a macOS kernel
extension (kext). FUSE-T is an alternative FUSE system which 'mounts' via an NFSv4 local server."
(<https://rclone.org/commands/rclone_mount/>). For macOS they recommend the dedicated
`rclone nfsmount` command, noting that `rclone mount` itself "still uses FUSE (macFUSE/FUSE-T)
and does not switch to NFS via a flag."

On the licensing premise in the brief — it is **half right, and the half that is wrong is the
half that matters**:

- macFUSE is genuinely no longer fully open source. The project's own wiki says "Since May 2019
  (version 3.9) some components of the macFUSE software are no longer open source, e.g. the
  kernel extension", and "Bundling or integrating macFUSE with commercial software requires a
  paid-for license" (<https://github.com/macfuse/macfuse/wiki/Open-Source-Status>). The
  restriction is on **redistribution / bundling with commercial software**, not on a user
  installing it.
- macFUSE is nevertheless alive and current: **5.3.3 released 2026-07-04**, with a 5.4.0
  developer preview dated 2026-09-07, requiring macOS 12+ (<https://macfuse.github.io/>).
  Crucially it now has an **FSKit backend**: "Thanks to the new FSKit backend in macFUSE,
  supported file systems can now run entirely in user space on macOS 26. That means no more
  rebooting into recovery mode to enable support for the macFUSE kernel extension."
- The kext-free alternative is **FUSE-T** (<https://github.com/macos-fuse-t/fuse-t>, 1,590
  stars, latest release **1.2.7, 2026-06-03**, `NOASSERTION` licence per the GitHub API — its
  exact terms are *unverified*, see §6). rclone's forum documents `rclone mount remote: /mnt
  -o "backend=fskit"` working on macOS 26.x with fuse-t ≥ 1.2.1
  (<https://forum.rclone.org/t/macos-rclone-mount-with-fuse-t-via-fskit/53608>, posts
  2026-03-31 → 2026-04-08).

Practical answer: **`rclone mount` still works on modern macOS**, by three independent routes
(macFUSE kext, macFUSE FSKit backend on macOS 26, FUSE-T with or without FSKit), plus
`rclone nfsmount` which needs no FUSE at all. The licence never blocks an end user; it would
only block irori from *shipping* macFUSE inside a `.vsix`, which nothing in the design
proposes.

Documented FUSE-T caveats (rclone docs, "current as of FUSE-T version 1.0.14" — older than the
current 1.2.7, so treat as possibly stale): file access and modification times cannot be set
separately, so "viewing files with various tools, notably macOS Finder, will cause rclone to
update the modification time of the file. This may make rclone upload a full new copy of the
file." And with `--read-only`, writes "fail silently as opposed to with a clear warning as in
macFUSE."

**Windows.** "To run `rclone mount` on Windows, you will need to download and install WinFsp"
(<https://winfsp.dev>). Decisively for this design, rclone can mount **onto a directory path**:
a drive letter, `*` for the next free letter, or "a path representing a nonexistent subdirectory
of an existing parent directory or drive", e.g. `rclone mount remote:path/to/files
C:\path\parent\mount`. So `contents\` exists as a real directory and `contents\drive` is created
by the mount. This sidesteps the entire `mklink` problem described in §3.3.

**Linux.** `fusermount` / `fusermount3`. Note the AppArmor snag on newer Ubuntu: `rclone mount`
can fail with `fusermount3: mount failed: Permission denied`, fixed with
`sudo aa-disable /usr/bin/fusermount3`.

**Mountpoint rule (Linux/macOS):** the mountpoint must be an **empty, existing** directory —
which is exactly the `contents/<name>/` shape the design wants.

### 2.3 VFS cache modes and what they cost

From `rclone mount` docs:

| Mode | Behaviour | Cost |
|---|---|---|
| `off` (default) | Reads/writes straight to the remote, nothing on disk. | "Files can't be opened for both read AND write"; "Files opened for write can't be seeked"; `O_APPEND`/`O_TRUNC` ignored; "If an upload fails it can't be retried". Many editors will misbehave. |
| `minimal` | As `off`, but read+write opens are buffered to disk. | Write-only opens still can't seek; failed uploads still not retried. |
| `writes` | Read-only opens stream; write and read-write opens are buffered to disk first. | "This mode should support all normal file system operations." Failed uploads retried with exponential backoff up to 1 minute. Costs disk for written files. |
| `full` | All reads *and* writes buffered to disk, as sparse files with per-range tracking. | Same compatibility as `writes` plus read caching. "IMPORTANT not all file systems support sparse files. In particular FAT/exFAT do not. Rclone will perform very badly if the cache directory is on a filesystem which doesn't support sparse files." |

For a knowledge base that VS Code and Obsidian will open and save files in, `--vfs-cache-mode
writes` is the practical floor and `full` the comfortable setting. The docs also warn: "You
**should not** run two copies of rclone using the same VFS cache with the same or overlapping
remotes if using `--vfs-cache-mode > off`. This can potentially cause data corruption." — i.e.
each mount needs its own `--cache-dir`.

### 2.4 Does it look like a normal directory to `readdir`/`stat`?

Yes. It is a real kernel-level filesystem; `readdir` and `stat` are ordinary syscalls, which is
what the extension's `roots` scanning (`resolveRoots` in `src/workspaceIndex.ts`) and any
Obsidian/VS Code file scan actually issue. The relevant caching knobs:

- `--dir-cache-time` default **5m0s** — how long a directory listing is considered fresh.
- `--attr-timeout` default **1s** — how long the *kernel* caches size/mtime per entry. The docs
  explain why 0s is not used: "this causes quite a few problems such as rclone using too much
  memory, rclone not serving files to samba and excessive time listing directories." And the
  risk of raising it: "You may see corruption if the remote file changes length during this
  window."
- `--poll-interval` default **1m0s**, "Only on supported remotes." The Google Drive backend
  **does** support it: `backend/drive/drive.go` implements `func (f *Fs) ChangeNotify(...)` and
  asserts `_ fs.ChangeNotifier = (*Fs)(nil)`
  (<https://github.com/rclone/rclone/blob/master/backend/drive/drive.go>). So a change made in
  the Drive web UI surfaces in the mount within ~1 minute, rather than waiting out the 5-minute
  directory cache.
- Performance escape hatches: `--no-modtime`, `--no-checksum`, `--read-only`.

The honest headline from the docs: "File systems expect things to be 100% reliable, whereas
cloud storage systems are a long way from 100% reliable. The rclone sync/copy commands cope with
this with lots of retries. However rclone mount can't use retries in the same way without making
local copies of the uploads."

### 2.5 Known failure modes

- **Latency and rate limits.** The Drive backend docs state: "Drive has quite a lot of rate
  limiting. This causes rclone to be limited to transferring about 2 files per second only.
  Individual files may be transferred much faster at 100s of MiB/s but lots of small files can
  take a long time." A cold recursive walk of a large `contents/` tree is a directory-listing
  storm against a rate-limited API. `--fast-list` gives "up to 20x faster" listing for large
  folders (a documented benchmark: 10,600 directories / 39,000 files, 22:05 → 0:58), but it is a
  *sync/copy* flag, not something the VFS applies to on-demand `readdir`.
- **File watching.** The mount does not push change events for remote-side edits; it polls.
  Anything that relies on a watcher firing when Drive changes underneath it will be up to
  `--poll-interval` late, and up to `--dir-cache-time` late on backends with no polling.
  Whether Linux `inotify` / macOS FSEvents fire for *local* writes through the mount is
  **unverified** (see §6) — but it is not needed for a `readdir`-based rescan, which is what
  irori FR-7 does.
- **Symlinks.** "By default the VFS does not support symlinks." Enabling `--links` /
  `--vfs-links` stores each symlink as a regular file with a `.rclonelink` extension whose
  contents are the target path. An open issue is noted: "duplicate files being created when
  symlinks are moved into directories." Do not rely on symlinks living *inside* an rclone Drive
  mount.
- **Google Drive shortcuts** behave like symlinks and are dereferenced by default;
  `--drive-skip-shortcuts` ignores them, and rclone detects and omits recursive folder
  shortcuts.
- **Network down.** Not documented explicitly. Behaviour follows the backend: listings served
  from the directory cache until it expires, then I/O errors. With `--vfs-cache-mode full`,
  already-cached ranges remain readable and writes queue in the cache for retry.
- **Two rclone processes over one VFS cache** → possible data corruption (see §2.3).

### 2.6 Mobile

There is no rclone mount inside Obsidian on iOS or Android. iOS has no FUSE. On Android, rclone
can run under Termux, but the Obsidian vault must be a real folder in device storage or app
storage (<https://obsidian.md/help/android>), and Google Drive on Android is a Storage Access
Framework provider, not a POSIX-visible mount. **On mobile, `contents/` is simply empty.** That
is not a regression — it is the exact scenario FR-10/FR-11 exist for.

---

## 3. Google Drive for Desktop

### 3.1 What it gives you today

- **Platforms: Windows and macOS only.** Linux is not supported
  (<https://support.google.com/drive/answer/2375082>).
- **Default mount points**, quoted from the Workspace admin doc
  (<https://knowledge.workspace.google.com/admin/drive/set-up-drive-for-desktop-for-your-organization>,
  formerly `support.google.com/a/answer/7491144`):
  - Windows: "The default streaming location is `G:`, but may be another location that you've
    configured."
  - macOS: "The default streaming location is
    `/Users/<Local Username>/Library/CloudStorage/<Workspace Email Address>`, but may be another
    location that you've configured." In practice the leaf is
    `GoogleDrive-<email>` — e.g. `/Users/foo/Library/CloudStorage/GoogleDrive-foo@example.com/My Drive/`.
- **My Drive and Shared drives both appear** under that root: users "discover 'My Drive',
  'Shared drives', and other synced folders" in Finder / File Explorer
  (<https://support.google.com/drive/answer/7329379>). This is the one thing Drive for Desktop
  does better than anything else out of the box — Shared Drives are first-class siblings, no
  extra configuration.
- **Multiple accounts:** "You can use up to 4 accounts at one time with Google Drive for
  desktop." On macOS each signed-in account gets its own `~/Library/CloudStorage/GoogleDrive-<email>/`
  root, so the paths are per-account and predictable-by-construction.
- **Streaming vs mirroring:** switchable in Settings → Preferences → "Folders from Drive" →
  "Mirror files". Note the asymmetry: when mirroring, "My Drive files download to the folder you
  select", while "Shared drives, other computers, and backed-up USB devices still appear and are
  still streamable" (<https://support.google.com/drive/answer/13470231>). **Shared Drives are
  never mirrored** — they are always the virtual streaming filesystem.

### 3.2 Is the path stable enough to put in config? Partly.

- macOS: the path is *deterministic* (`$HOME/Library/CloudStorage/GoogleDrive-<email>/`) but
  **not configurable**: "you may find a notification that says 'Folder location is controlled by
  macOS' and you won't be able to update the mount point"
  (<https://support.google.com/drive/answer/13470231>), consistent with the older page stating
  that under File Provider files appear in `~/Library/CloudStorage` and "You can't change this
  location" (<https://support.google.com/drive/answer/12178485>).
- Windows: the drive letter *is* configurable (Settings → Preferences → Advanced settings →
  "Google Drive streaming location" → Folder → Drive letter), which cuts both ways — it is
  stable per machine, but not the same across machines.

Net: the path is predictable enough to *derive* per machine, and not stable enough to hardcode
in a shared config. This is a direct argument for the manifest (FR-10) recording a
machine-independent identifier plus a per-machine resolution, rather than an absolute path —
the same failure the design note recorded for the 95 GB `pptx_sample/` hardcoded paths.

### 3.3 Why it cannot, by itself, put drives inside `contents/`

The mount point is app- and OS-controlled. To get it inside `contents/` you need a link, and
that is where the platform difference bites:

- **macOS** — verified by the user on 2026-09-07: symlinks into both My Drive and Shared Drives
  work for read and write, and `git check-ignore` confirms `contents/` excludes them. Nothing in
  the research contradicts that.
- **Windows** — junctions are the problem. Microsoft's own reference
  (<https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions>, updated
  2025-07-08) states a junction "can also link directories located on different local volumes on
  the same computer" but that references to "mapped network volumes" are not permitted. Google's
  own admin FAQ states: "Drive for desktop creates a virtual Drive, which appears as a FAT file
  system" and "The Drive for desktop content cache supports connected APFS (macOS), HFS+ (macOS),
  or NTFS (Windows) file systems"
  (<https://knowledge.workspace.google.com/admin/drive/drive-sync-faq-for-admins>). That is the
  mechanism behind the user's observed `mklink /J` failure on a Shared Drive.
  - The untested variant, `mklink /D`, is more promising in principle: a symbolic link lives on
    the NTFS side and Microsoft documents that "Symbolic links can point directly to a remote
    file or directory using the UNC path"
    (<https://learn.microsoft.com/en-us/windows/win32/fileio/creating-symbolic-links>). But it
    carries a deployment cost: creating symbolic links requires the
    `SeCreateSymbolicLinkPrivilege` user right, and "By default, members of the Administrators
    group have this right"
    (<https://learn.microsoft.com/en-us/windows/security/threat-protection/security-policy-settings/create-symbolic-links>).
    Whether `mklink /D` actually resolves against the Drive virtual volume is **unverified** —
    it needs a machine with a Shared Drive to test. See §6.
- **Mirroring as a workaround** does not help: mirroring only applies to My Drive, never to
  Shared Drives (§3.1), so the team case — the whole reason for this research — is exactly the
  case it does not cover.

### 3.4 Second-order effects worth designing around

- macOS File Provider changes semantics: dragging items in or out **moves** rather than copies;
  "Spotlight search will only search a subset of your files"; QuickLook previews only work for
  downloaded files; and with syncing paused you "can't download files"
  (<https://support.google.com/drive/answer/12178485>). The same page notes that under File
  Provider, "In many settings, you can't stream files and you need to fully download files before
  you can examine them" — meaning a full-tree scan can *materialise* files, not just list them.
- No mobile story at all: Drive for Desktop is desktop-only by definition.

---

## 4. "GWS CLI" and the API-vs-mount distinction

This is the part of the brief where the answer is a clean line, so state it plainly:
**every CLI in this category performs API-level file operations. None of them mounts a
filesystem.** They can `list`, `download`, `upload`, `move`, and `share`. They cannot make
`readdir("contents/team-drive")` return anything.

What actually exists:

| Thing | What it is | Mount? |
|---|---|---|
| `gws` — <https://github.com/googleworkspace/cli> | Rust CLI, Apache-2.0, 30,773 stars, created 2026-03-02, last push 2026-09-05, latest tagged release `v0.22.5` (2026-03-31). Builds its command surface dynamically from Google's Discovery Service; covers Drive, Gmail, Calendar, Sheets, Docs, Chat, Admin. Ships 100+ Agent Skills (`SKILL.md`) plus OpenClaw / Gemini CLI extension support. **Its README says: "This is *not* an officially supported Google product."** Despite the org name. | **No.** Commands are HTTP calls: `gws drive files list --params '{"pageSize": 10}'`, `gws drive files create --json '{...}' --upload ./report.pdf`. |
| `gcloud` (Google Cloud SDK) | The genuinely official Google CLI — but for **Google Cloud Platform**. It does not manage Google Drive or Workspace user data. <https://cloud.google.com/cli> | **No**, and not applicable. |
| Google Workspace Admin SDK / Drive REST API v3 | The official *APIs*. Everything else on this list is a wrapper over them. | **No.** |
| GAM — <https://github.com/GAM-team/GAM> (Apache-2.0, 4,300 stars, last push 2026-09-07) and GAMADV-XTD3 — <https://github.com/taers232c/GAMADV-XTD3> (833 stars, last push **2025-05-05**, i.e. >12 months stale) | Community Python CLIs for Workspace administration, including bulk Drive file management via the Drive API. | **No.** |
| `gdrive` — <https://github.com/glotlabs/gdrive> (Rust, MIT, 2,092 stars) | A Drive CLI client. **Last push 2024-08-03 — over two years stale.** | **No.** |
| `gcsfuse` — <https://github.com/GoogleCloudPlatform/gcsfuse> (Apache-2.0, 2,307 stars, last push 2026-09-07) | Google's own FUSE filesystem — for **Google Cloud Storage buckets**, a different product. Named similarly enough to cause exactly this confusion. | Mounts, but **not Google Drive**. |
| `google-drive-ocamlfuse` — <https://github.com/astrada/google-drive-ocamlfuse> (MIT, 5,963 stars, last push 2026-08-23) | A FUSE filesystem over Google Drive. The only non-rclone mounting option found that is still maintained. Linux-oriented; OCaml. | **Yes**, but it has no `combine` equivalent, so multiple drives = multiple independent mounts and configs. |

If the user's "GWS CLI" meant `gws`, it is a genuinely interesting tool for *scripted* Drive
operations and for giving a CLI agent Drive access through its agent skills — but it is
orthogonal to the mount question, and its "official" appearance is misleading.

---

## 5. Cross-cutting constraints the design must absorb

### 5.1 Obsidian's own position on symlinks is a warning, not a green light

The design note's plan — real `contents/` directory, symlinks inside it — is *possible* in
Obsidian but explicitly discouraged by Obsidian themselves
(<https://obsidian.md/help/symlinks>, source at
`obsidianmd/obsidian-help/en/Files and folders/Symbolic links and junctions.md`):

> **Use at your own risk** — We strongly advise against using symbolic links. By using symbolic
> links and junctions in your vault, you risk losing or corrupting your data, or crashing
> Obsidian.

Four of the listed limitations bear directly on this design:

1. "Symlink targets must be fully disjoint from the vault root or any other symlink targets."
   Fine here — Drive mounts are disjoint by construction — but it forbids one drive being
   symlinked twice under different names.
2. "Obsidian's file manager can't move files across device boundaries, so if you symlink to a
   folder on a different drive from your vault, you won't be able to drag files between that
   folder and other folders using Obsidian's file explorer. … Obsidian will see the move as a
   deletion and the creation of a new file. It will also *not* update any links that depended on
   the path of that file." **A Drive mount is always a different device.** This kills the naive
   version of FR-13 (raw → knowledge promotion) inside Obsidian: a promotion that moves a file
   out of `contents/` into `Knowledge_Base/` will be seen as delete+create and will silently
   break inbound links.
3. "Some sync tools, such as Git, don't follow symlinks, but rather sync the *path* the symlink
   points to." This is the same fact the design note already recorded, from Obsidian's side.
4. "File symlinks (as opposed to folder symlinks) *may* work, but aren't officially supported at
   this time. Changes performed outside of Obsidian aren't watched for, so if you change the
   file directly, Obsidian won't detect the change, update search indexes, etc."

Point 4 compounds with §2.5: a Drive-side change is late by the poll interval *and* may not be
watched by Obsidian at all. Any freshness guarantee has to come from an explicit rescan the
plugin triggers, not from a watcher.

Note that a **directory mount** (rclone / a mounted volume) is not a symlink and therefore
sidesteps limitation 1 and 3 entirely — but limitation 2 (device boundary) and limitation 4
(external changes unwatched) still apply, because they are about the filesystem, not the link.

### 5.2 Mobile: every option is "not present"

- Obsidian on Android stores the vault in device storage or app storage
  (<https://obsidian.md/help/android>); on iOS it lives in the app's own container / iCloud.
- No FUSE on iOS. No Drive-for-Desktop on either. No POSIX view of the Android Drive SAF
  provider.

Therefore on mobile, `contents/` is a real but **empty** directory. Every option in this report
converges on the same mobile answer, which means mobile does not discriminate between them —
it only reinforces FR-10/FR-11: the manifest is what makes "empty on this device" legible as a
normal state rather than as breakage.

### 5.3 Per-machine difference is structural, not incidental

Combining the above:

| Machine | What is inside `contents/` |
|---|---|
| macOS, personal account only | `My Drive` and any Shared Drives that account can see |
| macOS, personal + work accounts | two independent roots (Drive for Desktop) or two mounts (rclone) |
| Windows | same drives, different path shape (`G:` or a mount directory), different link mechanism |
| Linux | Drive for Desktop unavailable → rclone or `google-drive-ocamlfuse` only |
| iOS / Android | nothing |

A manifest entry keyed on an absolute path cannot survive this table. A manifest entry keyed on
`(drive identity, path within drive)` can, with a per-machine resolution step from drive identity
to local root. That resolution is derivable on every desktop platform:
`~/Library/CloudStorage/GoogleDrive-<email>/` on macOS, the configured letter on Windows, the
rclone remote name under either.

---

## 6. Unverified

Explicitly not confirmed by this research:

1. **`mklink /D` into a Google Drive Shared Drive on Windows.** Microsoft documents that symbolic
   links may target remote/UNC paths, and the link itself lives on NTFS, so it is plausible where
   `mklink /J` fails — but no primary source confirms it works against Drive's FAT-reporting
   virtual volume, and no test machine was available. This is the single highest-value
   experiment remaining.
2. **FUSE-T's exact licence.** GitHub reports `NOASSERTION`; fuse-t.org returned HTTP 403 to the
   fetch. If the design ever documents an install path, the licence needs reading first.
3. **Whether `inotify` (Linux) / FSEvents (macOS) fire for local writes through an rclone mount.**
   Remote-side changes are polled, that much is documented. Local-write event delivery was not
   confirmed either way. It does not affect a `readdir`-based rescan.
4. **Whether VS Code's or Obsidian's watchers behave acceptably over a File Provider path on
   macOS.** A search result asserted Finder Sync Extensions do not work on File Provider paths
   (<https://developer.apple.com/forums/thread/718381>), but that is a different API from a file
   watcher, and the extrapolation to VS Code / Obsidian was the search engine's inference, not a
   source's claim. Treated as unverified.
5. **Drive for Desktop's exact behaviour with 4 simultaneous accounts on macOS**, e.g. whether
   all four reliably materialise as separate `~/Library/CloudStorage/GoogleDrive-<email>/` roots.
   The 4-account limit is documented; the per-account path shape is documented in secondary
   sources and consistent with the admin doc's placeholder, but Google does not spell out the
   multi-account layout in one place. A user forum thread reports macOS allowing only 2 accounts
   in some cases (<https://support.google.com/drive/thread/303855577>) — unconfirmed.
6. **`teamai-cli` telemetry.** The dependency list contains no analytics SDK and the providers
   doc shows no mandatory Tencent endpoint, but the source was not read line by line.

---

## 7. Recommendation for the design agent

Not a design — just what the facts force:

1. **`contents/` stays a real directory.** Confirmed correct and unchallenged by anything found.
2. **Two mounting mechanisms are viable, and they are not mutually exclusive.** Drive for Desktop
   is the zero-install path that already exposes My Drive + Shared Drives per account but cannot
   place itself inside `contents/`; rclone is the path that *can* place several drives inside
   `contents/` in one mount, at the cost of a FUSE layer. Design for both by never assuming
   *how* a subdirectory of `contents/` got there.
3. **Do not key anything on an absolute path.** §3.2 and §5.3.
4. **Do not rely on a watcher for anything under `contents/`.** §2.5 and §5.1 point 4. An
   explicit rescan command is the only mechanism that works on every combination.
5. **Re-examine FR-13 (promotion) for the Obsidian target.** Moving a file out of a mounted
   `contents/` crosses a device boundary; Obsidian will read it as delete+create and will not
   fix inbound links (§5.1 point 2). A copy-plus-back-link, or a manifest-mediated reference
   rewrite, is likely required instead of a move.
6. **Keep `teamai-cli` out of this decision.** If it is evaluated at all, it is a separate
   question about how `.claude/` skills and rules are distributed to a team — and it would
   contend with this repository's existing runtime boundary.

---

## Appendix — source index

**teamai-cli**
- <https://github.com/Tencent/teamai-cli> · README, `docs/providers.md`, `LICENSE`, `package.json`
- GitHub API: `/repos/Tencent/teamai-cli`, `/commits`, `/releases`, `/contributors` (2026-09-08)

**rclone**
- <https://rclone.org/commands/rclone_mount/> · <https://rclone.org/drive/> ·
  <https://rclone.org/combine/> (last updated 2026-03-17) · <https://rclone.org/overview/>
- <https://github.com/rclone/rclone/blob/master/backend/drive/drive.go> (`ChangeNotify`)
- <https://forum.rclone.org/t/macos-rclone-mount-with-fuse-t-via-fskit/53608> (2026-03/04)

**FUSE layers**
- <https://macfuse.github.io/> (5.3.3, 2026-07-04) ·
  <https://github.com/macfuse/macfuse/wiki/Open-Source-Status>
- <https://github.com/macos-fuse-t/fuse-t> (1.2.7, 2026-06-03) · <https://winfsp.dev>

**Google Drive for Desktop**
- <https://knowledge.workspace.google.com/admin/drive/set-up-drive-for-desktop-for-your-organization>
- <https://knowledge.workspace.google.com/admin/drive/drive-sync-faq-for-admins>
- <https://support.google.com/drive/answer/7329379> ·
  <https://support.google.com/drive/answer/12178485> ·
  <https://support.google.com/drive/answer/13470231> ·
  <https://support.google.com/drive/answer/2375082>

**Windows link semantics**
- <https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions>
- <https://learn.microsoft.com/en-us/windows/win32/fileio/creating-symbolic-links>
- <https://learn.microsoft.com/en-us/windows/security/threat-protection/security-policy-settings/create-symbolic-links>

**CLIs**
- <https://github.com/googleworkspace/cli> · <https://cloud.google.com/cli> ·
  <https://github.com/GAM-team/GAM> · <https://github.com/taers232c/GAMADV-XTD3> ·
  <https://github.com/glotlabs/gdrive> · <https://github.com/GoogleCloudPlatform/gcsfuse> ·
  <https://github.com/astrada/google-drive-ocamlfuse>

**Obsidian**
- <https://obsidian.md/help/symlinks> · <https://obsidian.md/help/android> ·
  <https://obsidian.md/help/data-storage> · <https://obsidian.md/help/install>
