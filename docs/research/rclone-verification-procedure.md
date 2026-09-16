# Verifying the multi-drive `contents/` assumptions on a real Mac / Windows machine

**Status:** verification procedure, not a design document. It tests claims made in
`docs/research/drive-mount-and-team-cli-2026-09.md` (the research) against
`docs/plans/multi-drive-contents-2026-09.md` (the design that depends on them).
**Why this document exists:** this repository's own dev container has no `rclone`, no
`/dev/fuse`, no Obsidian, and no Google account signed in, so none of the research's
"Unverified" claims (§6 of the research doc) could be exercised there. Everything below has
to be run by a human, on their own Mac or Windows machine, at least once.

**Companion script:** `scripts/verify-rclone-mount.sh` automates what it safely can. Read
its `--help` output (or the header comment) for the full flag/environment-variable list; this
document explains *why* each check exists and what a failure means, and covers the checks the
script cannot run at all (Windows, Obsidian).

**Design change (2026-09-09) — read this before check 1.** The shape being verified is no
longer "several whole drives behind one mount". It is **three separately mounted, individually
named folders**:

| Mount point | Source |
|---|---|
| `contents/my-contents` | one named folder inside **My Drive** of a personal Google account |
| `contents/team-contents-1` | one named folder inside a **Shared Drive** of a work Google Workspace account |
| `contents/team-contents-2` | one named folder inside a **different Shared Drive** (or a different folder) of that same work account |

The `combine` backend is **not used** and must not be reintroduced — it existed only to serve
the abandoned "N whole drives, one mount" shape. This demotes what used to be the decisive
check (check 1) and introduces a new one; see check 1 and check 1-legacy for both, and
"Setup: the three folder-scoped mounts" below for the commands to get there.

## How to use this document

1. Run `scripts/verify-rclone-mount.sh --help` once to see what it automates.
2. Do "Setup: the three folder-scoped mounts" first — checks 1 and 3-8 all assume the three
   remotes exist and are folder-scoped.
3. Work through checks 1-8 below in order (check 8 splits into 8a and 8b — see "What
   controls what" for why; check 1-legacy is retained for the record and can be skipped).
   Each one names whether it is **automated** (run the script, optionally with a flag) or
   **manual** (Windows, Obsidian — do this by hand, following the exact steps given).
4. Every check states **what it proves**, **the command**, **the expected result**, and
   **what it means if it fails** — read that last part before running anything. A check whose
   failure has no consequence for the design is not included here.
5. Record your results using the template in "Results log" at the end. Do not paste raw
   `rclone config show`/`config dump` output, `rclone.conf`, or OAuth/refresh tokens into that
   log, into chat, or into a ticket — see Safety below.

## Prerequisites

- macOS: `brew install rclone` (and `brew install fswatch` if you want check 4 automated).
  For an actual mount you additionally need a FUSE layer — macFUSE or FUSE-T — or you can use
  `rclone nfsmount` instead of `rclone mount` to avoid FUSE entirely; see the research doc §2.2.
- **Your own Google OAuth client ID — now mandatory, not optional.** rclone's Drive
  documentation states (retrieved 2026-09-09): "This shared `client_id` is being retired and
  will stop working during 2026. To avoid interruption you must create and use your own
  `client_id`, so creating one is now required rather than merely recommended."
  (<https://rclone.org/drive/#making-your-own-client-id>). Today's date is inside that
  retirement window, so do this step *first* — a remote created with a blank `client_id` may
  authenticate today and stop working without warning. One client ID can be reused for all
  three remotes below. **[documented]**
- Three `drive` remotes configured (`rclone config`) — one personal, two for the work account.
  See "Setup: the three folder-scoped mounts" for the exact flow. The work account must have
  access to the Shared Drives in question.
- Windows: WinFsp (<https://winfsp.dev>) for `rclone mount`; Git for Windows for
  `git check-ignore`; an administrator or Developer-Mode account for `mklink /D`.
- Obsidian: only if you intend to run check 7, and only against a **throwaway vault**.

## Setup: the three folder-scoped mounts

Copy-pasteable, in order. Every command below is traceable to rclone's own documentation;
anything inferred or read from rclone's source rather than its docs is labelled inline.
**Nothing in this section was executed while writing it** — this repository's container has no
`rclone`, no FUSE, and no Google account, so treat all of it as "documented, not observed".

Names used throughout (rename freely, but stay consistent):

| Remote | Account | Scope |
|---|---|---|
| `gdrive-personal` | personal Google account | one folder in My Drive |
| `gdrive-work-team1` | work Workspace account | one folder in Shared Drive A |
| `gdrive-work-team2` | work Workspace account | one folder in Shared Drive B |

If both work folders live in the **same** Shared Drive, you need only two remotes — configure
`gdrive-work-team1` once and pin the second folder with a second remote created by
`rclone config` → `c) Copy remote`, or simply use two different `root_folder_id` values on two
copies. Two mounts still need two remotes (or two path suffixes), because a mount takes exactly
one source path.

### Step 0 — create your own client ID (mandatory, see Prerequisites)

Follow <https://rclone.org/drive/#making-your-own-client-id> to the end and keep the client ID
and client secret. rclone's docs note the practical ceiling this sets: "The default Google quota
is 10 transactions per second so it is recommended to stay under that number as if you use more
than that, it will cause rclone to rate limit and make things slower", and "If you have multiple
services running, it is recommended to use an API key for each service." **[documented]** With
three mounts sharing one client ID, that per-client-ID quota — not your network — is the first
thing you will hit. **[inferred from the documented quota]**

### Step 1 — create the three remotes

Run `rclone config` once per remote. The prompts below are quoted from rclone's own documented
transcript (<https://rclone.org/drive/>); `[snip]` marks parts left at their default.

**Personal / My Drive** — answer **n** to the Shared Drive question:

```text
rclone config
n) New remote
name> gdrive-personal
Storage> drive
client_id> <your client ID from step 0>
client_secret> <your client secret from step 0>
scope> 1                                   # "Full access all files, excluding Application Data Folder."
service_account_file>                      # leave blank
Use web browser to automatically authenticate rclone with remote?
y/n> y                                     # sign in with the PERSONAL account
Configure this as a Shared Drive (Team Drive)?
y/n> n
```

**Work / Shared Drive A** — answer **y**, then pick the drive from the list:

```text
rclone config
n) New remote
name> gdrive-work-team1
Storage> drive
client_id> <same client ID is fine>
client_secret> <same client secret>
scope> 1
service_account_file>
y/n> y                                     # sign in with the WORK account
Configure this as a Shared Drive (Team Drive)?
y/n> y
Fetching Shared Drive list...
Choose a number from below, or type in your own value
 1 / Rclone Test
   \ "xxxxxxxxxxxxxxxxxxxx"
Enter a Shared Drive ID> 1                 # the NUMBER from the list, or paste an ID
```

rclone's docs describe exactly this: answering `y` "will fetch the list of Shared Drives from
google and allow you to configure which one you want to use. You can also type in a Shared Drive
ID if you prefer", and the resulting config gains `team_drive: xxxxxxxxxxxxxxxxxxxx`.
**[documented]** After this, the remote's root is that Shared Drive — confirmed in rclone's
source, `backend/drive/drive.go`, which falls back to `f.rootFolderID = f.opt.TeamDriveID` when
no `root_folder_id` is set. **[source-verified, not stated in the prose docs]**

**Work / Shared Drive B** — identical, `name> gdrive-work-team2`, pick the other drive.

To list the Shared Drives and their IDs at any time:

```bash
rclone backend drives gdrive-work-team1:
```

Documented as "List the Shared Drives available to this account", returning JSON objects with
`id`, `kind` and `name`. **[documented]** Do **not** add `-o config` here: that variant emits a
`combine` remote, which this design no longer uses.

**Two Google accounts on one machine is the normal case, and needs nothing special.** Each
remote is its own `[section]` in a single INI file with its own `token`, and rclone's docs state
plainly "You can define as many storage paths as you like in the config file." The only
requirement is that you sign in with the right account in the browser step for each remote — the
OAuth flow is per-remote. **[documented for the mechanism; "two Google accounts specifically" is
inferred, since the docs never call the case out separately]**

### Step 2 — get the folder ID for each of the three folders

Documented method, from rclone's "Root folder ID" section: open the folder in the Drive web
interface and take **the last segment of the URL**. For
`https://drive.google.com/drive/folders/1XyfxxxxxxxxxxxxxxxxxxxxxxxxxKHCh`, the ID is
`1XyfxxxxxxxxxxxxxxxxxxxxxxxxxKHCh`. **[documented]**

CLI alternative — `i` is documented as "ID of object" and `p` as "path" for `rclone lsf
--format`, and `--dirs-only` as "Only list directories":

```bash
rclone lsf --dirs-only --format "ip" gdrive-personal:
rclone lsf --dirs-only --format "ip" gdrive-work-team1:
```

**[flags documented; this exact combination was not run — treat the output shape as unverified]**

### Step 3 — pin each remote to its folder (recommended: by ID)

```bash
rclone config update gdrive-personal   root_folder_id=1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
rclone config update gdrive-work-team1 root_folder_id=1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
rclone config update gdrive-work-team2 root_folder_id=1CCCCCCCCCCCCCCCCCCCCCCCCCCCCCC
```

`rclone config update name [key value]+` with `key=value` pairs is documented, with the example
`rclone config update myremote env_auth=true`. **[documented]** `root_folder_id` is documented
as "ID of the root folder. Leave blank normally. Fill in to access 'Computers' folders (see
docs), or for rclone to use a non root folder as its starting point." **[documented]**

**Leave `team_drive` set on the two work remotes — do not clear it.** rclone's source shows why:
`root_folder_id` wins for the *root*, while `team_drive` continues to scope the *listing query*
(`list.DriveId(f.opt.TeamDriveID)` plus `list.Corpora("drive")` when `team_drive` is non-empty).
The two keys together mean "this folder, inside this Shared Drive".
**[source-verified in `backend/drive/drive.go`; the prose docs do not spell this combination out
— treat "both keys together" as unverified until check 1 passes on your machine]**

**Gotcha worth knowing before it bites you:** re-running `rclone config` on a work remote and
re-answering the Shared Drive question **wipes `root_folder_id`** — the config handler sets
`opt.TeamDriveID = driveID` and then `opt.RootFolderID = ""`. If a mount suddenly shows the whole
Shared Drive instead of your folder, this is the first thing to check.
**[source-verified in `backend/drive/drive.go`; not documented]**

### Step 4 — mount, macOS

**The mount point must already exist and be empty on macOS.** rclone documents: "On
Linux/macOS/FreeBSD start the mount like this, where `/path/to/local/mount` is an **empty**
**existing** directory". The "nonexistent subdirectory of an existing parent" property is a
**Windows-only** rule (see step 5) — do not carry it over to macOS. **[documented]**

```bash
mkdir -p contents/my-contents contents/team-contents-1 contents/team-contents-2

rclone nfsmount gdrive-personal:   contents/my-contents     --vfs-cache-mode full --daemon
rclone nfsmount gdrive-work-team1: contents/team-contents-1 --vfs-cache-mode full --daemon
rclone nfsmount gdrive-work-team2: contents/team-contents-2 --vfs-cache-mode full --daemon
```

To stop them — note that with `--daemon` the documented stop is a signal, not just `umount`:

```bash
# rclone's documented unmount for "OS X or Linux when using nfsmount"
umount contents/my-contents contents/team-contents-1 contents/team-contents-2
# a mount started with --daemon leaves an rclone process behind; rclone's docs say to stop it
# with a SIGTERM: "you will need to send SIGTERM signal to the rclone process using kill command"
pkill -TERM -f 'rclone nfsmount'
```

**[both quoted parts documented; the exact `pkill` pattern is a convenience, not from the docs —
check with `ps` first if you run other rclone processes]**

**Why `nfsmount` and what it costs.** rclone's `serve nfs` documentation states its purpose
outright: "The primary purpose for this command is to enable the mount command on recent macOS
versions where installing FUSE is very cumbersome", and the mount docs list the built-in NFS
server alongside macFUSE and FUSE-T as one of the three macOS options, describing it as spinning
up an NFS server and mounting it for you. So it is documented as *the way to avoid the FUSE
install*, and rclone recommends it on macOS. **[documented]** Two honest caveats:

- rclone's *generated* `nfsmount` synopsis still says it mounts "as a file system with FUSE" —
  that line is shared boilerplate from the common mount library, not a statement about
  `nfsmount` specifically. That no kernel FUSE driver is needed is strongly implied by the
  documented purpose and by the OpenBSD note ("There is no FUSE-based mount option on OpenBSD,
  so `nfsmount` is the only way to mount rclone remotes as a local filesystem"), but rclone
  never writes the sentence "nfsmount does not require macFUSE". **[inferred, high confidence —
  this is the single claim in this section most worth confirming on the real machine]**
- The mount is **read-only** without a cache mode: "When using NFS mount on macOS, if you don't
  specify `--vfs-cache-mode` the mount point will be read-only", and `serve nfs` adds "Modifying
  files through the NFS protocol requires VFS caching ... (`full` is recommended)". The
  `--vfs-cache-mode full` above is therefore not optional for a writable vault folder.
  **[documented]**

If you would rather use `rclone mount` on macOS, install macFUSE or FUSE-T first and substitute
`rclone mount` for `rclone nfsmount` — same arguments. Note FUSE-T's documented caveats: reading
a file can update its modification time (which "may make rclone upload a full new copy of the
file"), and `--read-only` fails writes *silently*. **[documented]**

**Japanese and spaced folder names.** With `root_folder_id` pinning there is nothing to quote —
that is the practical reason it is recommended below. If you use the path form instead, quote it:
rclone documents single quotes on macOS/Linux (`rclone copy 'Important files?' remote:backup`)
and double quotes on Windows. Separately, on macOS keep the Unicode normalization default —
rclone: "It is highly recommended to keep the default of `--no-unicode-normalization=false` for
all `mount` and `serve` commands on macOS." Japanese folder names are exactly the case where
NFC/NFD normalization differences show up. **[documented]**

### Step 5 — mount, Windows

**The mount point must NOT exist; its parent must.** rclone documents, for fixed-drive mode:
"you can either mount to an unused drive letter, or to a path representing a **nonexistent**
subdirectory of an **existing** parent directory or drive", and again in the examples: "to path
`C:\path\parent\mount` (where parent directory or drive must exist, and mount must **not**
exist)". This is the property that lets a mount live inside a real, un-touched `contents\`
without a junction — which is the whole point, since the research already found `mklink /J`
fails against Drive's virtual volume. **[documented]**

Requires WinFsp (<https://winfsp.dev>) — "To run rclone mount on Windows, you will need to
download and install WinFsp". **[documented]** Run each in its own window (PowerShell), with
`contents\` present and the three leaf folders absent:

```powershell
rclone mount gdrive-personal:   C:\path\to\repo\contents\my-contents     --vfs-cache-mode full
rclone mount gdrive-work-team1: C:\path\to\repo\contents\team-contents-1 --vfs-cache-mode full
rclone mount gdrive-work-team2: C:\path\to\repo\contents\team-contents-2 --vfs-cache-mode full
```

- **Do not add `--network-mode`.** "Mounting to a directory path is not supported in this mode,
  it is a limitation Windows imposes on junctions, so the remote must always be mounted to a
  drive letter." That would force you back to drive letters, i.e. back to the problem this
  layout exists to avoid. **[documented]**
- `--daemon` does nothing here: "On Windows you can run mount in foreground only, the flag is
  ignored." **[documented]**
- Prefer a **non-elevated** prompt. Drives created as Administrator are invisible to
  non-elevated Explorer — though rclone also notes "mapping to a directory path, instead of a
  drive letter, does not suffer from the same limitations", which is another point in favour of
  the `contents\<name>` layout. **[documented]**
- Stop a foreground mount with Ctrl+C. **[documented]**

### `--vfs-cache-mode`: use `full`, and cap it

For a directory an editor both reads and writes, `full` is the right value, and it is what
rclone recommends for NFS-backed mounts. The documented ladder:

| Mode | Behaviour | Fit here |
|---|---|---|
| `off` (default) | no disk cache; "can't open files for simultaneous read/write"; no upload retry | unusable for an editor |
| `minimal` | only simultaneous read/write files buffered | still missing seek-on-write |
| `writes` | reads stream from remote, writes buffered to disk; "should support all normal file system operations"; failed uploads retried | workable |
| `full` | all reads and writes buffered; sparse cache files; "otherwise identical to `--vfs-cache-mode writes`" | **recommended** |

**[all documented]** `full` costs disk, and by default that cost is uncapped:
`--vfs-cache-max-size` has "default off" (unlimited) and `--vfs-cache-max-age` defaults to
`1h0m0s`. rclone also warns the cache "may exceed these quotas" because open files cannot be
evicted and the check only runs every `--vfs-cache-poll-interval` (default 1 minute). So pass an
explicit cap on each mount, e.g.:

```bash
--vfs-cache-mode full --vfs-cache-max-size 5G --vfs-cache-max-age 24h
```

The *flags and defaults* are documented; **the specific 5G/24h numbers are a judgement call, not
a recommendation from rclone. [inferred]** Two further documented constraints: the cache
directory is set by `--cache-dir`, and "not all file systems support sparse files. In particular
FAT/exFAT do not. Rclone will perform very badly if the cache directory is on a filesystem which
doesn't support sparse files" — keep `--cache-dir` off any exFAT external disk.

### Folder pinning: path suffix or `root_folder_id`?

**Recommendation: `root_folder_id`.** Use the path suffix (`gdrive-work-team1:プロジェクト/資料`)
only as a temporary, human-readable way to confirm you picked the right folder before pinning it.

| | Path suffix `remote:path/to/folder` | `root_folder_id` / `--drive-root-folder-id` |
|---|---|---|
| Survives the folder being **renamed** in Drive | no | **yes** |
| Survives the folder being **moved** | no | yes **[inferred]** |
| Spaces in the name | needs shell quoting, per-OS rules | nothing to quote |
| Japanese in the name | works, but exposed to macOS NFC/NFD normalization | nothing to normalize |
| Readable in `rclone.conf` | yes | no — an opaque ID |

The decisive reason is Google's own guarantee about IDs: "A unique, opaque ID for each file. File
IDs are stable throughout the life of the file, even if the file name changes."
(<https://developers.google.com/workspace/drive/api/guides/about-files>). **[documented]** A path
suffix, by contrast, is resolved by name on every start, so a colleague renaming a Shared Drive
folder silently breaks the mount. Google's page states the rename guarantee explicitly; it does
not separately spell out moves, so "survives a move" is **[inferred]** from IDs being stable "for
the life of the file".

The one real cost of ID pinning is that `rclone.conf` becomes unreadable to a human — you cannot
tell which folder `1BBB...` is. Keep the ID→folder mapping in your own notes rather than as a
comment in `rclone.conf`: the INI format does document `;`/`#` comments, but rclone rewrites the
file whenever it refreshes a token ("the configuration file must be writable, because rclone
needs to update the tokens inside it"), and whether comments survive that rewrite is
**unverified**.

### Keeping the three mounts running

**macOS.** `--daemon` is documented and puts the mount in the background: "On Linux and macOS,
you can run mount in either foreground or background (aka daemon) mode. Mount runs in foreground
mode by default. Use the `--daemon` flag to force background mode." **[documented]** That is all
`--daemon` does — it does **not** survive logout or reboot. rclone's install page has an
"Autostart" section with subsections for **Windows** and **Linux** (systemd) and **no macOS
subsection at all**. A launchd LaunchAgent/LaunchDaemon is therefore **community practice, not
documented by rclone** — verified by reading rclone's install page, which simply does not cover
it. **[documented absence]**

**Windows.** rclone documents three routes, in its own order of preference:

1. **Startup folder shortcut** — `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`.
   rclone: "This is the easiest approach to autostarting of rclone, but it offers no
   functionality to set it to run as different user, or to set conditions or actions on certain
   events." **[documented]**
2. **Task Scheduler** — "can be used to configure rclone to be started automatically in a highly
   configurable way, e.g. periodically on a schedule, on user log on, or at system startup."
   **[documented; rclone's own recommendation over the Startup folder]**
3. **Windows service** — rclone documents a built-in integration via WinFsp and gives the exact
   command shape:

   ```powershell
   New-Service -Name Rclone -BinaryPathName 'c:\rclone\rclone.exe mount remote:/files X: --config c:\rclone\config\rclone.conf --log-file c:\rclone\logs\mount.txt'
   ```

   **[documented verbatim — note that rclone's own example mounts to a drive letter; adapting it
   to a `contents\<name>` directory path is [inferred], and the service runs as the local system
   account]**. Two documented consequences of running as a service: you must pass `--config`
   explicitly, because "when running rclone as another user, it will not use the configuration
   file from your profile unless you tell it to"; and add `--no-console` (rclone ≥ 1.54) plus
   `--log-file`, since rclone is a console application.

Also documented, with their status stated plainly by rclone itself:

- **NSSM** and **WinSW** — rclone recommends both by name for wrapping any rclone command as a
  service. They are third-party tools that rclone documents, not rclone features.
  **[documented recommendation of a third-party tool]**
- **WinFsp.Launcher** — rclone says of it: "This is currently not officially supported by Rclone,
  but with WinFsp version 2019.3 B2 / v1.5B2 or later it should be possible through path
  rewriting". Treat as **not supported**, despite appearing in rclone's own docs.
  **[documented as unsupported]**

For three mounts you need three of whichever unit you choose — three scheduled tasks, three
services. Nothing in rclone manages a group of mounts as one unit. **[inferred from the absence
of any such feature in the mount docs]**

### Is `rclone.conf` portable between machines?

**Yes, and rclone documents the copy explicitly:** "Rclone stores all of its configuration in a
single file. This can easily be copied to configure a remote rclone (although some backends do
not support reusing the same configuration, consult your backend documentation to be sure)"
(<https://rclone.org/remote_setup/#configuring-by-copying-the-config-file>). The Google Drive
backend page states no such restriction. **[documented; "drive has no restriction" is inferred
from its absence]**

Locations — or just run `rclone config file`, which "you will see where the default location is
for you":

| OS | Default | Notes |
|---|---|---|
| macOS / Linux | `~/.config/rclone/rclone.conf` | `$XDG_CONFIG_HOME/rclone/rclone.conf` if that variable is set |
| Windows | `%APPDATA%\rclone\rclone.conf` | |

**[documented]** rclone searches five locations in priority order, with `rclone.conf` beside the
executable first — which is also the documented way to run "portable" from a USB stick.
`--config <path>` and the `RCLONE_CONFIG` environment variable override the search entirely.

**What you are copying is a live credential file. Treat it exactly like a private key:**

- A **Google OAuth refresh token per remote, in plain text** — the documented example config
  shows `token: {"access_token":"XXX","token_type":"Bearer","refresh_token":"XXX", ...}` sitting
  in the file. Copying the file to a second machine gives that machine standing access to **both
  Google accounts** — including the work Workspace account — until the token is revoked in the
  account's security settings. **[documented]**
- Your `client_id` and `client_secret`, in plain text. **[documented]**
- rclone's own statement: "The configuration file will typically contain login information, and
  should therefore have restricted permissions so that only the current user can read it. Rclone
  tries to ensure this when it writes the file." Passwords elsewhere in the file are merely
  **obscured**, not encrypted. **[documented]**

Practical handling: transfer over `scp`/an encrypted channel, never a chat message, a ticket, a
shared drive, or this repository; keep it out of git (it is not under `contents/`, so nothing
here ignores it for you); and on the destination machine confirm the permissions are
user-only. `rclone config password` encrypts the whole file at rest — but then every mount start
needs the password, which conflicts with the autostart section above unless you set
`RCLONE_CONFIG_PASS`, and rclone's docs qualify that with "If it is safe in your environment".
**[documented; whether it is worth it here is your call]**

One caveat that follows from the docs rather than being stated by them: "When token-based
authentication are used, the configuration file must be writable, because rclone needs to update
the tokens inside it." Two machines refreshing the *same* refresh token independently is
therefore a configuration rclone never describes as supported. If mounts start failing on one
machine after you use the other, re-authorize per machine (`rclone config reconnect <remote>:`)
rather than sharing one token. **[inferred — the failure mode is plausible and cheap to avoid,
but it was not reproduced]**

## What controls what

There are **two independent, unrelated settings** that decide whether a mount is visible, and
which one applies depends entirely on *where* the mount lives. This is the split check 8a/8b
exists to make legible — a reader who mounts at `contents/drive` and sees nothing needs to know
which of the two knobs is theirs before touching either one.

| Mount location | Read by | Governing setting | Default | Default source |
|---|---|---|---|---|
| **Inside the workspace** (e.g. `contents/drive` — the design's primary case) | VS Code's own `vscode.workspace.findFiles()`, called from `scanWorkspace()` in `src/workspaceIndex.ts` | `search.followSymlinks` (a **VS Code editor setting**, not this extension's) | **`true`** | Confirmed directly against this repo's own downloaded test binary: `.vscode-test/vscode-linux-x64-1.136.1/resources/app/out/vs/workbench/workbench.desktop.main.js` registers `"search.followSymlinks":{type:"boolean",...,default:!0}`. `@types/vscode`'s `findFiles` JSDoc does not spell out that it consults this exact setting — that link is architectural (both are documented to share VS Code's search engine), not a verbatim primary-source statement, so treat "the setting exists with default `true`" as confirmed and "findFiles specifically honours it" as high-confidence inference, not a proven fact. |
| **A layer's external `roots`** (outside the workspace) | This extension's own `walkDirectory()` in `src/walk.ts`, called from `scanExternal()` | `irori.followSymlinks` (this **extension's own setting**) | **`false`** | This extension's own `package.json` configuration contribution (`irori.followSymlinks`, `"default": false`). |

Both settings can be overridden per-workspace in `.vscode/settings.json`; checks 8a/8b read
that file (path configurable via `--workspace-settings`) and report the *effective* value, not
just the shipped default.

## Safety

- The script is read-only by default. The one write it can perform (check 4) is gated behind
  `--allow-write` and is a single named file created and removed inside a subdirectory it
  creates under the mount you point it at.
- The script never runs `rm -rf`, never mounts or unmounts anything itself (you create the
  mount yourself, in your own terminal, before pointing `--mount-path` at it), and never
  touches `rclone.conf` or any credential.
- Raw `rclone` output that could contain drive/team names (check 1) is written to a file
  under the script's own scratch directory (`chmod 600`), never printed to your terminal. The
  script prints that file's path at the end and does **not** delete it automatically — review
  it, then remove the scratch directory yourself when you are done.
- Never paste `rclone.conf`, `rclone config show`/`config dump` output, or any OAuth/refresh
  token into this document, a commit, chat, or a ticket. If you need to share a failure, share
  the exit code and the last few non-sensitive lines only.

## The checks

### 1. Each of the three remotes resolves to exactly its intended folder — MANUAL, DECISIVE

**Why this is now the decisive check.** Until 2026-09-09 the decisive check was check 1-legacy
below: whether `rclone backend -o config drives <remote>:` could emit a `combine` remote exposing
My Drive and every Shared Drive as siblings. That mattered while the design was "several whole
drives behind one mount". **It no longer is.** The design is three named folders, mounted
separately at `contents/my-contents`, `contents/team-contents-1` and `contents/team-contents-2`,
and `combine` is not used at all — so "can rclone merge N drives into one tree?" decides nothing
here. The question that decides everything is narrower and more dangerous: **does each remote's
root land on exactly the one folder it is supposed to, and nothing above it?**

Getting this wrong does not produce an error. It produces a mount that silently exposes an entire
Shared Drive — every colleague's folder in it — inside the vault, where the extension will index
it and Obsidian will try to walk it. That is a data-exposure failure, not a broken build, which
is why it now outranks every other check in this document.

**What it proves:** each of the three remotes has its root at the intended folder — not at My
Drive's root, and not at a Shared Drive's root.

**Command** (after completing "Setup: the three folder-scoped mounts", before mounting anything):

```bash
rclone lsd gdrive-personal:
rclone lsd gdrive-work-team1:
rclone lsd gdrive-work-team2:

# lsd lists directories only, so a target folder holding just files looks empty.
# Confirm with a non-recursive listing that includes files:
rclone lsf gdrive-personal:
```

`rclone lsd` is documented as "Lists the directories in the source path to standard output. Does
not recurse by default." **[documented]** No mount, no FUSE, and no WinFsp is needed to run it —
this check works on a bare rclone install on either OS.

**Expected result:** each command lists **the subdirectories of the intended folder, and nothing
else**. Read the output against what you see in the Drive web UI for that folder.

**What it means if it fails:**

- *You see the sibling folders of your target, or a Shared Drive's whole top level* — the remote
  is not scoped. Re-check Setup step 3: `root_folder_id` is missing, misspelled, or was wiped by
  a later `rclone config` run (see the gotcha in step 3). **Do not mount until this is fixed** —
  a mount at this point publishes the whole drive into `contents/`.
- *`gdrive-work-team1:` errors or shows nothing* — the folder ID may be correct but `team_drive`
  was cleared, so the listing query is no longer scoped to that Shared Drive. Both keys must be
  present on the work remotes.
- *Only the personal remote works* — the two work remotes were probably authorized with the
  personal Google account in the browser step. Re-run `rclone config` for them and watch which
  account the browser is signed in as.

Only after all three pass is it meaningful to run checks 2-8.

### 1-legacy (demoted 2026-09-09). Combine remote exposes My Drive and every Shared Drive as siblings — AUTOMATED, now informational only

> **Demoted, not deleted.** This check used to be described here as "the single most
> decisive check in this whole procedure". It is kept verbatim below because that sentence
> was load-bearing and a reader who remembers it needs to see what replaced it. It is no
> longer decisive for one reason only: the design stopped using the `combine` backend (see
> "Design change (2026-09-09)" at the top). Its outcome now changes nothing — a PASS does
> not make the design work and a FAIL does not break it. Run it only if you are curious
> whether the account can see its Shared Drives at all; check 1 above answers that more
> directly, per-remote. **Do not act on its recommendation to fall back to one symlink per
> drive** — that fallback belonged to the abandoned multi-drive shape too.

> **The companion script still runs the old check under `--only 1`.**
> `scripts/verify-rclone-mount.sh` is out of scope for this update and was not changed, so
> its check 1 still tests the `combine` mechanism and still prints a PASS/FAIL verdict for
> it. That verdict is now **informational**; the script has no check corresponding to check
> 1 above. Treat `--only 1` output accordingly, and do not read a FAIL there as a blocker.

*Original text, unchanged except for the struck claim at the end:*

**What it proves:** the single decisive capability the whole "one mount instead of N
symlinks" idea depends on (research §2.1): `rclone backend -o config drives <remote>:`
generates a `combine` remote whose `upstreams` list includes My Drive and every Shared Drive
the account can see, as sibling subdirectories of one remote.

**Command:**

```bash
rclone config                       # one-time: create a `drive:` remote if you don't have one
scripts/verify-rclone-mount.sh --only 1
# or, to see the raw (unredacted) output yourself, run the underlying command directly:
rclone backend -o config drives drive:
```

**Expected result:** `PASS`, with an upstream count greater than 1 if the account has at
least one Shared Drive. The emitted config block looks like:

```
[AllDrives]
type = combine
upstreams = "My Drive=My Drive:" "Test Drive=Test Drive:"
```

This command does **not** write to `rclone.conf` — you still paste the `[AllDrives]` section
in yourself before the remote is mountable.

**What it means if it fails:** if this account genuinely has Shared Drives and the command
still does not produce a `combine` section (or errors), the entire premise of "several drives,
one mount, one `contents/` entry" is false for this rclone version/account. There is no reason
to introduce a FUSE layer at all in that case — fall back to what the research already
confirmed works on macOS: one symlink per drive, still inside a real `contents/` (research
§3.3). ~~This is **the single most decisive check in this whole procedure**: if the user runs
only one check, it should be this one, because its answer decides whether rclone is worth
adopting over the already-working symlink approach at all.~~ **No longer true as of 2026-09-09**
— see the demotion note above. Check 1 is now the check to run if you run only one.

### 2. A mount/symlink inside a real `contents/` stays git-ignored; `contents/` itself as a symlink does not — AUTOMATED, no rclone or Drive account needed

**What it proves:** the specific trap the design note calls out — a trailing-slash
`.gitignore` pattern like `contents/` only matches paths whose `contents` segment is an actual
directory on disk. If `contents` itself were ever replaced with a symlink, the pattern would
stop matching it. A mount or symlink placed *inside* an un-touched, real `contents/` directory
is a different, safe case: the parent segment is still a real directory, so everything beneath
it is still excluded regardless of what the leaf entries are.

**Command:**

```bash
scripts/verify-rclone-mount.sh --only 2
```

This is fully synthetic — it builds a throwaway git repo under its own scratch directory and
never touches rclone, Drive, or your real `contents/`. It runs identically on Linux, so it is
one of the two checks this procedure could already run in the dev container that produced the
research (the other being the environment banner).

**Expected result:** `PASS`. The message states that a symlink placed inside a real
`contents/` was ignored, and that a symlinked `contents` itself was not (or, on some git
versions, that the trap did not reproduce — the script treats only the first half, the design's
actual shape, as pass/fail-bearing).

**What it means if it fails:** if the *safe* case (mount inside a real `contents/`) is not
ignored on your git version, the single-`.gitignore`-line design is broken outright — do not
attach any mount until you understand why (check for a conflicting `.gitignore`/`.git/info/exclude`
rule, or an unusually old/new git). This would force reintroducing the per-mount ignore rules
the design specifically exists to avoid (research §5.1 point 3).

### 3. Windows: `rclone mount` onto a nonexistent `contents\` subdirectory vs. `mklink /J` vs. `mklink /D` — MANUAL (Windows only)

**What it proves:** three different ways to get a Shared Drive to appear inside `contents\`,
and which ones actually work. The research already established that `mklink /J` (a junction)
fails against Google Drive's FAT-reporting virtual volume, and left `mklink /D` (a true NTFS
symbolic link) and `rclone mount` onto a not-yet-existing subdirectory unverified.

**Commands (PowerShell, run from inside the repo, with `contents\` already existing as a
plain folder — never delete or recreate `contents` itself for this test):**

```powershell
# (a) The already-suspected failure: a junction into a Shared Drive.
# Replace the target with a real Shared Drive path under your Drive-for-Desktop root.
mklink /J contents\team-drive-junction "G:\Shared drives\<some shared drive>"

# (b) The unverified case: a true NTFS symbolic link. Needs an elevated prompt or
# Developer Mode (SeCreateSymbolicLinkPrivilege).
mklink /D contents\team-drive-symlink "G:\Shared drives\<some shared drive>"
# Then, from Git Bash or PowerShell with Git for Windows on PATH:
git check-ignore -v contents/team-drive-symlink
# ...and confirm you can actually list and open a file through it, not just that the link exists.

# (c) The rclone case: mount directly onto a path that does not exist yet, one level under
# an existing contents\. WinFsp must already be installed (https://winfsp.dev).
rclone mount gdrive-work-team1: contents\team-drive-rclone --vfs-cache-mode full
# (run in its own window/job; Ctrl+C or a second `rclone rc` call to stop it)
```

**Expected result:** (a) fails, reproducing the research's documented failure. (b) is
unverified — record whether the symlink is created at all, and if so whether it resolves to
readable/writable files. (c) succeeds, per the rclone documentation cited in the research
(§2.2): rclone can mount onto "a path representing a nonexistent subdirectory of an existing
parent directory," which `contents\team-drive-rclone` is.

**What it means if it fails:**
- If (c) also fails: Windows has **no confirmed working mechanism** to embed a Shared Drive
  inside `contents\` at all, which is a genuine, permanent platform gap — the manifest must
  report `not-configured` for team-scope mounts on that machine (design §6) rather than the
  tooling silently pretending it works.
- If (b) succeeds: it becomes a lighter-weight alternative to rclone specifically on Windows,
  worth recording either way — this resolves the research's single highest-value open item
  (research §6, item 1).
- (a) failing is expected and confirmatory, not alarming — it is the case that motivated this
  whole procedure.

### 4. Local writes through the mount produce a filesystem event — AUTOMATED, opt-in write

**What it proves:** whether editors/indexers watching the mount can rely on a live update, or
must poll/rescan explicitly. The design has already assumed the pessimistic answer ("do not
rely on a watcher for anything under `contents/`," research §7 recommendation #4) — this check
either confirms that assumption or finds it overly cautious.

**Command:**

```bash
mkdir -p contents/verify-test
rclone nfsmount gdrive-personal: contents/verify-test --vfs-cache-mode full &  # your own terminal
scripts/verify-rclone-mount.sh --mount-path contents/verify-test --allow-write --only 4
# afterwards: kill the rclone mount job, then `umount contents/verify-test` (macOS)
```

Without `--allow-write` this check always SKIPs — writing something through the mount is
unavoidable to observe a write event at all, so this is the one check in the script gated
behind an explicit opt-in (see Safety above).

**Expected result:** most likely `FAIL` (no event observed within 15 seconds), which is the
*expected, safe* outcome. `PASS` (an event fires) is a pleasant bonus, not something to design
around, because it does not tell you whether VS Code's or Obsidian's *own* file watcher behaves
the same way over this specific mount type.

**What it means if it fails (i.e., if it "passes" in the intuitive sense — no event fires):**
confirms FR-7's explicit rescan command is mandatory, not a nice-to-have — nothing under
`contents/` should ever assume a watcher will notice a remote-side or even a local-side change.
If it unexpectedly *succeeds* reliably, it is still not safe to build a design around, for the
reason above — but it is worth noting for a future "trigger a rescan automatically after a
local save" optimization.

### 5. Recursive listing time and Drive rate-limit exposure — AUTOMATED, read-only, bounded by default

**What it proves:** how expensive a `readdir`-based scan (what FR-7's rescan does, through
either `vscode.workspace.findFiles()` or this extension's own `walkDirectory()` depending on
where the mount lives — see "What controls what" above and check 8a/8b) is against a real
mount, and whether it risks the documented ~2 files/second Drive rate limit (research §2.5).

**Command:**

```bash
scripts/verify-rclone-mount.sh --mount-path contents/my-contents --only 5
# add --deep for a full recursive walk instead of the default depth-2 scan -- see the warning below
```

**Expected result:** `PASS`, reporting a file count and elapsed time. By default the scan is
bounded to depth 2 specifically so that running this check does not itself become the thing
that trips the rate limit; `--deep` does a full recursive walk and is explicitly the scenario
most likely to trigger throttling — **do not run `--deep` repeatedly in a short window**, and
expect it to take a long time on a large tree (the research cites a documented benchmark: a
similarly sized tree took over 22 minutes without `--fast-list`).

**What it means if it fails:** a rate-limit error appearing during a read-only listing means
any eager, unbounded FR-7 rescan (e.g., on every save, or on every extension activation) must
instead be throttled, debounced, or made depth-bounded/lazy by default — an eager full walk on
activation is not safe to ship as-is.

### 6. macOS File Provider: does a metadata-only scan pull file bytes? — AUTOMATED, read-only, macOS only

**What it proves:** whether a plain `readdir`+`stat` pass (no file content ever opened) forces
Google Drive for Desktop to download a placeholder file's bytes, or whether it stays a
cloud-only placeholder. This decides whether a naive orphan/dangling-reference scan is safe to
run eagerly, or must be opt-in and size-bounded (design §8: "Hashing an unhydrated file can
force a multi-GB download").

**Command:**

```bash
scripts/verify-rclone-mount.sh --only 6
# or, if auto-detection of ~/Library/CloudStorage/GoogleDrive-* doesn't find your account:
scripts/verify-rclone-mount.sh --file-provider-path "$HOME/Library/CloudStorage/GoogleDrive-you@example.com" --only 6
```

This check never opens a file's contents — only `find` (directory listing) and `stat`
(metadata) are used, which is the point of the test.

**Expected result:** `PASS`, reporting that at least one sampled file still looks like a
cloud-only placeholder (on-disk blocks smaller than the reported size) after the scan touched
it. If every sampled file was already fully materialized before the scan ran, you get `SKIP`
(inconclusive, not a pass) — try again against a larger tree, or right after using Drive for
Desktop's "Free up space" action so you have a genuinely cloud-only file to sample.

**What it means if it fails:** if metadata-only access turns out to force materialization,
then even FR-7's basic rescan (not just an opt-in integrity check) would silently download
arbitrary amounts of data on every scan — this is a much stronger constraint than the design
currently assumes, and `present-unhydrated` handling would need to move earlier, into the scan
itself rather than only into hash/integrity checks.

### 7. Obsidian's indexer over a mounted vault path — MANUAL ONLY, throwaway vault only

**Use a brand-new or duplicated throwaway vault. Never point Obsidian at your real vault for
this test.** Obsidian's own documentation is explicit: "We strongly advise against using
symbolic links. By using symbolic links and junctions in your vault, you risk losing or
corrupting your data, or crashing Obsidian" (<https://obsidian.md/help/symlinks>, quoted in the
research §5.1). This check exists specifically to see whether that risk materializes for this
design's shape (a real `contents/` with a mount or symlink inside it) — treat any data loss
during this test as expected and acceptable *because it is a throwaway vault*, not something to
be surprised by.

**Steps:**

1. Create a new, empty Obsidian vault somewhere disposable (e.g., `~/ObsidianVaultThrowaway`).
   Do **not** open your real vault for this.
2. Create a `contents/` folder inside it, and inside that, either a symlink to a small test
   folder in your Drive, or an rclone mount (same commands as check 4/5, pointed at this
   throwaway vault's `contents/` instead of the repo's).
3. Open the throwaway vault in Obsidian. Watch for: does the mounted folder appear in the file
   explorer at all? Does it descend into it? Does search find files inside it? Does Obsidian
   hang, crash, or report a corruption warning?
4. Try renaming/moving a file *inside* the mount using Obsidian's own file explorer, and watch
   whether it silently becomes a delete+create (per the research §5.1 point 2, expected because
   a mount is a different device from the vault root) and whether inbound links break.
5. Close Obsidian, then delete the entire throwaway vault when done.

**What it means if it fails (Obsidian does not descend into it, or worse, corrupts/crashes):**
this is the check most likely to force revisiting the design's hard rule in
`multi-drive-contents-2026-09.md` §4 that a mounted, independently governed vault must be its
own top-level scope root rather than something nested under `contents/`. If Obsidian cannot
tolerate the mount at all, the "separate vault" fallback that the design's own Codex consult
proposed (and the design currently declines as the primary approach) becomes the only option
for the Obsidian target specifically, even if the VS Code extension continues to handle mounts
fine.

### 8a. A mount inside the workspace — does VS Code's own file search see it? — AUTOMATED

This is the design's **primary case**: mounts live at `contents/<name>`, which is inside the
workspace/vault, not in a layer's `roots`. Files there are collected by `scanWorkspace()` in
`src/workspaceIndex.ts` via `vscode.workspace.findFiles()` — `walk()`/`walkDirectory()` (§8b)
is **never called** for this path. `findFiles` is not this extension's code; whether it descends
into a symlinked mount is governed entirely by VS Code's own `search.followSymlinks` setting
(see "What controls what" above for exactly what was confirmed about it, and where).

**What it proves:** given the *filesystem* fact (is `--mount-path` a symlink or a real
directory entry) and the *effective* `search.followSymlinks` value in your workspace, whether
VS Code's file search should see anything through this specific mount. The script cannot launch
VS Code and execute a real search, so treat this as a configuration-derived verdict to be
confirmed empirically (open the workspace, check whether files under the mount appear at all),
not as a substitute for actually looking.

**Command:**

```bash
scripts/verify-rclone-mount.sh --mount-path contents/my-contents --only 8a
# add --workspace-settings <path>/.vscode/settings.json if you're not running this from the
# workspace root, or want to check a different workspace's override
```

**Expected result:** an **rclone FUSE mount point** is a real directory entry, not a symlink,
so `PASS` regardless of the setting. A **plain `ln -s` symlink** (e.g. linking directly into a
Drive-for-Desktop path) depends on the effective `search.followSymlinks` value: `PASS` if it
resolves to `true` (VS Code's own default), `FAIL` if something set it to `false`.

**What it means if it fails:** a symlinked mount with `search.followSymlinks: false` will not
appear anywhere in the workspace — not in the Explorer, not in a workspace search, not to this
extension (which never even gets a chance to apply its own logic, since `findFiles` filters it
out first). The fix is either to turn `search.followSymlinks` back on, or to use a real mount
point (rclone) instead of a symlink for anything placed inside the workspace.

### 8b. A mount under a layer's `roots` — does `walkDirectory()` see it? — AUTOMATED

This is the **secondary case**: a mount registered as one of a layer's external `roots`
(outside the workspace folder). These are read by `scanExternal()` calling this extension's own
`walkDirectory()` in `src/walk.ts`, governed by this extension's own `irori.followSymlinks`
setting (search both `src/walk.ts` and `src/workspaceIndex.ts` for `followSymlinks` to confirm
the current behaviour — **do not rely on a specific line number**, since another agent may be
changing this code around the same time this procedure is read).

**Command:**

```bash
scripts/verify-rclone-mount.sh --mount-path /absolute/path/to/a/roots-configured/mount --only 8b
```

**Expected result:** an **rclone FUSE mount point** is a real directory entry, not a symlink —
`PASS` regardless of the setting. A **plain `ln -s` symlink** depends on the effective
`irori.followSymlinks` value: `FAIL` with the shipped default (`false` — the extension
skips it and shows a one-time warning naming how many symlinks it skipped), `PASS` if you turn
the setting on (cycle/depth/entry-count limits apply once it does follow links).

**What it means if it fails:** with the default `false`, a symlinked `roots` entry is silently
absent from that layer's panel except for the one-time warning — this is expected, current
behaviour, not a bug. The remedy is either `irori.followSymlinks: true` in
`.vscode/settings.json`, or using a real mount point instead of a symlink for that root.

## Results log (fill in per machine)

| # | Check | OS / machine | Date | Result | Notes (no tokens, no raw config) |
|---|---|---|---|---|---|
| 1 | each remote resolves to its folder (DECISIVE) | | | PASS/FAIL | one row per remote if they differ |
| 1-legacy | combine remote (informational) | | | PASS/FAIL/SKIP/not-run | no longer blocking |
| 2 | gitignore trap | | | PASS/FAIL/SKIP | |
| 3a | mklink /J | Windows | | works/fails | |
| 3b | mklink /D | Windows | | works/fails | |
| 3c | rclone mount onto nonexistent subdir | Windows | | works/fails | |
| 4 | file watch | | | PASS/FAIL/SKIP | |
| 5 | scan cost | | | PASS/FAIL/SKIP | files/sec observed |
| 6 | File Provider materialization | macOS | | PASS/SKIP | |
| 7 | Obsidian | | | descends / does not / crashes | |
| 8a | workspace mount vs. `search.followSymlinks` | | | PASS/FAIL/SKIP | mount type + effective setting value |
| 8b | `roots` mount vs. `irori.followSymlinks` | | | PASS/FAIL/SKIP | mount type + effective setting value |

Feed confirmed results back into `docs/plans/multi-drive-contents-2026-09.md` and
`docs/research/drive-mount-and-team-cli-2026-09.md` §6 ("Unverified") as a follow-up —
this document only verifies; it does not update those files itself.
