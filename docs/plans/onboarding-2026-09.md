# Onboarding a non-engineer — the setup as a product surface

> **Status:** design recommendation, 2026-09-10. Research and design only; no source file,
> `package.json`, or workflow was modified to produce it.
> **Authority:** the settled decisions in `docs/DESIGN.md` (Key Decisions, 2026-09-07
> → 2026-09-09) and `docs/plans/multi-drive-contents-2026-09.md` are **inputs**, not
> open questions. Where this document contradicts one, it says so explicitly and names the
> decision it contradicts.
> **Requirement being answered:** 「エンジニア以外にも簡単にできるようにすることが求められます。
> 私だけができればいいわけではない。」
> **Companion:** `docs/research/rclone-verification-procedure.md` — the checks that
> must be run on real hardware before parts of this design can be committed to.
> **Every external claim below carries a source URL and a retrieval date.** Anything not
> sourced is marked **[inference]** or **[unverified]**.

---

## 1. The count, and where it comes from

Today's procedure (`rclone-verification-procedure.md`) has five steps a non-engineer cannot
perform:

| # | Step | Why a non-engineer cannot do it |
|---|---|---|
| 1 | Create a Google Cloud project and an OAuth `client_id` | Cloud Console, OAuth consent screen, scope selection. rclone's shared id is retired during 2026, so this is now mandatory, not optional. |
| 2 | Run `rclone config` three times | A terminal, a 12-prompt interactive transcript, per-remote browser consent, and knowing which account to sign in as. |
| 3 | Read three folder IDs out of Drive web URLs and pin them with `rclone config update … root_folder_id=…` | Requires understanding that a URL segment is an opaque identifier, plus a second terminal command per remote. Getting it wrong silently exposes an entire Shared Drive inside the vault. |
| 4 | Know that `contents/` must be a real directory, never a symlink | A git-internals fact with no visible symptom until something is committed. |
| 5 | Register a launchd job (macOS) or a Scheduled Task (Windows) per mount | rclone documents no macOS autostart at all; three mounts need three units. |

**The target is to reduce five engineer-only steps to zero.** The proposal below reaches zero
on macOS, zero-or-one on Windows (pending one unverified check), and does **not** reach zero on
Linux, where Google ships no client at all.

---

## 2. Verdicts on the five hypotheses

| # | Hypothesis | Verdict |
|---|---|---|
| 1 | The extension ships its own OAuth `client_id`, removing step 1 | **Fails** for the mount; **holds** in one narrow shape (Workspace-Internal), and is **unnecessary** in the recommended design |
| 2 | A VS Code extension can complete a browser OAuth flow and store the refresh token in `context.secrets` | **Holds with caveats** — the API exists, but Google's *desktop* client type forces loopback, not `vscode://` |
| 3 | A folder picker replaces folder IDs | **Holds** — and the strongest version of it needs no Drive API and no OAuth at all |
| 4 | The two-store design is already the onboarding mechanism | **Holds with caveats** — the split is exactly right, the schema is missing five fields |
| 5 | Google Drive for Desktop may beat rclone for non-engineers | **Holds with caveats** on macOS — it wins on steps but **cannot prove folder identity** (§2.6); **blocked pending verification** on Windows; **fails** on Linux (no product) |

### 2.1 Hypothesis 1 — shipping our own `client_id`: **fails**

Four documented facts, taken together, make a shipped `client_id` for the *mount* the same
liability that is currently killing rclone's:

1. **Restricted scope.** `rclone mount` of an arbitrary Drive folder needs `scope=drive`
   (or `drive.readonly`). Google classifies both as **restricted**; only `drive.file` is
   non-sensitive.
   <https://developers.google.com/workspace/drive/api/guides/api-specific-auth> (2026-09-10)
2. **Restricted scope means an annual security assessment.** Restricted-scope apps must pass
   restricted-scope OAuth verification and a CASA security assessment, and must be re-verified
   "at least every 12 months".
   <https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification>
   (2026-09-10)
3. **Staying unverified is a hard ceiling, not a soft one.** "Unverified apps that are
   accessing restricted or sensitive scopes have a 100 new-user cap restriction", and "the user
   cap applies over the entire lifetime of the project, and it cannot be reset or changed."
   <https://support.google.com/cloud/answer/13463817> (2026-09-10). Staying in *Testing* status
   is worse still: such a project "is issued a refresh token expiring in 7 days".
   <https://developers.google.com/identity/protocols/oauth2> (2026-09-10)
4. **The quota and the bill are per project, not per user.** Drive API limits are
   "1,000,000 quota units per minute per project", "325,000 per minute per user per project",
   "1 TB per day per project". Today "all standard use of the Google Drive API is available at
   no additional cost", but "exceeding the quota request limits is planned to incur charges to
   your Google Cloud billing account later in 2026" (90 days' notice promised).
   <https://developers.google.com/workspace/drive/api/guides/limits> (2026-09-10)

Point 4 is the one that decides it, and it has already been tested at scale by somebody else.
rclone announced on 2026-07-06 that "Google will start charging for API requests on rclone's
built in default client-ID for Google Drive and Google Photos", estimated the exposure at
"millions of dollars per year", and is removing the shared id.
<https://forum.rclone.org/t/google-drive-and-google-photos-users-action-required/54005>,
<https://rclone.org/drive/> (both 2026-09-10). A irori-shipped `client_id` used for mount
traffic is rclone's situation in miniature: **every user's byte-level Drive traffic lands on the
publisher's project quota, and later in 2026 on the publisher's bill.** Adopting the mechanism
that is being retired underneath us, in the same year it is retired, is not a reduction in
setup steps — it is a transfer of an unbounded liability onto the maintainer.

**The one shape in which it holds:** a Google Workspace **Internal** OAuth app. Apps limited to
one Workspace / Cloud Identity organisation "don't need verification" and "will not be subject
to the unverified app screen or the 100-user cap".
<https://support.google.com/cloud/answer/13464323> (2026-09-10). If irori becomes a company
standard, one admin creates one Internal project once and every colleague reuses its
`client_id` — step 1 becomes an **org-level, one-time, admin** step rather than a per-user one.
That is a legitimate deployment mode and it should be documented, but it is not the answer for
a publicly distributed extension, and it does not describe the personal Google account half of
the requirement (a personal `@gmail.com` account is not in the org).

**And it is unnecessary.** See hypothesis 3: in the recommended tier the extension does not
call the Drive API at all.

### 2.2 Hypothesis 2 — browser OAuth from a VS Code extension: **holds with caveats**

Confirmed against the pinned API surface (`node_modules/@types/vscode/index.d.ts`, the
`^1.105.0` the manifest declares — a primary source, not a doc page):

- `window.registerUriHandler(handler)` exists. Documented constraints: the URI scheme must be
  `vscode.env.uriScheme`, the authority must be the extension id, and "an extension can only
  register a single uri handler in its entire activation lifetime".
- `env.asExternalUri` is documented *as the auth-flow mechanism*, with a worked OAuth example
  in the JSDoc, and "if the extension is running remotely, this function automatically
  establishes a port forwarding tunnel from the local machine to `target` on the remote".
- `ExtensionContext.secrets: SecretStorage` (`get`/`store`/`delete`/`keys`/`onDidChange`)
  stores values "encrypted", and "the secrets will not be synced across machines".

That last clause is a *feature* here, not a limitation: it matches the settled two-store split
exactly — a credential is per-machine by construction, like the gitignored local binding.

**The caveat that matters.** Google's *Desktop app* OAuth client type accepts **loopback
redirects only** — `http://127.0.0.1:port` or `http://[::1]:port`, port chosen at runtime with
no pre-registration. Out-of-band copy/paste "is no longer supported", and custom URI schemes
are called out as an impersonation risk.
<https://developers.google.com/identity/protocols/oauth2/native-app> (2026-09-10). So a
`vscode://del-taiseiozaki.irori-extention/...` redirect is **not** usable with a Desktop client, and
the idiomatic `registerUriHandler` route would require a *Web application* client plus an
https redirect page we would have to host and operate. VS Code's own built-in providers solve
this with a Microsoft-hosted redirect; irori has no such host and should not acquire one.

Consequence: **the loopback flow works on local desktop VS Code and breaks in Remote-SSH,
Codespaces and vscode.dev**, because the loopback listener is on the remote machine while the
browser is on the client, and the port-forwarded URL `asExternalUri` returns will not match the
`http://127.0.0.1:port` redirect Google requires. **[inference from the two documented
constraints; not a statement either vendor makes]** For the recommended tier this is moot — no
OAuth happens at all — and it is one more reason to keep OAuth out of the default path.

A second, larger remote-topology problem is *not* moot and applies to both tiers: in a remote
workspace the machine showing the UI, the machine running the extension host, the machine
holding the vault and the machine running Drive for Desktop need not be the same. A link created
"successfully" on the wrong one of them resolves to nothing. Tier 1 must detect this topology
and refuse rather than half-succeed — check 7 of §6. **[Codex's catch]**

### 2.3 Hypothesis 3 — a folder picker replaces folder IDs: **holds**, in a stronger form than proposed

Two mechanisms exist, and the cheap one is the right one.

**(a) The native folder dialog, for the Drive-for-Desktop tier — no OAuth, no API, no quota.**
When Drive for Desktop is running, the account is already a local path. The extension detects
the Drive root and opens `vscode.window.showOpenDialog({ canSelectFolders: true, defaultUri:
<drive root> })`. The user clicks the folder they mean. No `client_id`, no Drive API call, no
token, no consent screen, no verification, no quota, nothing to expire.

This is also the *more robust* option, for a reason that is easy to miss: on a Japanese-locale
machine the folder inside the Drive root is `マイドライブ`, not `My Drive`
(<https://support.google.com/drive/answer/10838124?hl=ja>, 2026-09-10). Any code that resolves
a Drive path by name is locale-dependent and will break; a dialog shows the user the names
their own machine uses and returns a path, so the extension never needs to know them. The only
name the extension matches is the account root itself — `~/Library/CloudStorage/GoogleDrive-*`
on macOS — which is a documented, non-localised shape
(<https://knowledge.workspace.google.com/admin/drive/set-up-drive-for-desktop-for-your-organization>,
2026-09-10).

**(b) The Google Picker, for the rclone tier — where there is no local path.** Google ships a
desktop/mobile Picker variant driven purely by an OAuth URL and an HTTP redirect: it "redirects
to the Google Picker within a new tab in the user's default browser", supports
`allow_folder_selection=true`, and returns `picked_file_ids` (plus a `code`) on the redirect.
Decisively for verification cost: "only the `drive.file` scope is permitted for these apps and
it can't be combined with any other scope."
<https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker>,
<https://developers.google.com/workspace/drive/picker/guides/overview-desktop> (2026-09-10).

`drive.file` is **non-sensitive**, so the 100-new-user cap — documented as applying to
"unverified apps that are accessing restricted **or sensitive** scopes" — does not bite, and no
CASA assessment is involved. A Picker-only `client_id` shipped with the extension is therefore
*qualitatively different* from a mount `client_id`: a handful of calls per setup, on a
non-sensitive scope, versus every byte of every user's Drive traffic on a restricted one.

**One thing the picker does *not* do, and a disagreement about it.** The picker returns an
identifier; it does not authorise rclone to read anything. Codex reads that as a reason to cut
the picker from the rclone story entirely. This document disagrees, on a distinction Codex
collapsed: the picker's job here is **identification**, and rclone's own `drive`-scoped token —
issued to the user's own client id, for the user's own account — supplies the **authorisation**.
A folder id obtained one way and read another is exactly how `root_folder_id` already works.
Codex's underlying point survives the disagreement and should be counted: the picker adds a
*second* consent screen for the same account, so it saves the user from copying an ID out of a
URL and costs them one more browser round trip.

**What is not established:** Google does **not** document whether picking a *folder* under
`drive.file` grants the app access to that folder's descendants. Searched across the scope
guide, both Picker overviews and the desktop integration guide on 2026-09-10; the
"limited vs expansive access" page is about Drive *sharing permissions*, a different concept.
**[unverified]** This does not block the design, because the picker's job here is to yield an
**ID to write into rclone's `root_folder_id`**, not to enumerate the tree — rclone does that
with its own credentials. Any future feature that wants the extension itself to list a mount
through the API must re-open this question first.

### 2.4 Hypothesis 4 — the two-store design as the onboarding mechanism: **holds with caveats**

The split is right and is exactly what makes onboarding decidable: `.irori/mounts.yaml` is
tracked, carries no secret and no absolute path, and states *what must exist*; the per-machine
binding is gitignored and states *how this machine reaches it*. A teammate who clones the vault
can be told precisely what is missing, which is the fresh-clone blindness the 95 GB failure
demonstrated (`multi-drive-contents-2026-09.md` §4).

Five fields are missing for onboarding specifically (three of them named by the Codex consult):

| Field | Why the current schema cannot do it |
|---|---|
| `source` — a portable address of the folder to connect (`{ substrate: google-drive, driveName: "…", folderName: "…", folderId: "…" }`) | Today the only guidance is `obtain:` free prose ("Request access from the team owner"). For a **team** mount every member connects the *same* folder, so its identity is a portable fact and belongs in the tracked half. Without it the wizard can only say "pick something"; with it the wizard can say "pick 〈Shared Drive A〉 › 〈素材〉", and can *verify* the pick. `folderId` must be optional: recording it publishes the folder's existence into the repository, which is the metadata-leakage caveat already recorded in `multi-drive-contents-2026-09.md` §5. |
| `allowedDrivers` + `preferredDriver` — a **capability declaration**, not one hard-coded driver | Repair advice is driver-specific ("Drive for Desktop is not running" vs "the rclone process exited"), and §2.6 means some mounts must *refuse* a driver that cannot prove identity. Declaring the permitted set is strictly better than a single `driver` hint, which was this document's first draft and which Codex correctly rejected. The settled rule that a mount is defined by *position*, not by how it was created, stays intact: this changes which driver the **wizard offers**, never how state is **computed**. |
| `identityPolicy` — `exact` \| `per-user-equivalent` | The field §2.6 turns on. `exact` means "connecting the wrong folder is a disclosure failure" and forbids any driver that can only reach `unverified`. Without it the wizard cannot know that a team scope root deserves more care than a personal inbox. |
| `displayName` (and `selectionLabel`) | `id` is a slug (`team-contents-1`). A non-engineer needs "営業チームの共有素材", and the dialog needs an instruction ("〈営業〉共有ドライブの〈素材〉を選んでください"). Cheap, and the difference between a legible wizard and a cryptic one. |
| `shortcutPolicy` — reject \| allow | A Google Drive *shortcut* selected in the dialog resolves today and can silently point elsewhere later, or break. Rejecting shortcuts by default is a one-line rule that removes a whole class of unexplainable failure. **[Codex's catch]** |

`required` already exists and should drive the wizard's ordering (required mounts first) —
without changing the state machine, per the decision that policy stays orthogonal to
observation. Codex additionally proposed `accessMode` (read-only vs read-write) and
`availabilityPolicy` (online-only acceptable vs offline materialisation required); both are
reasonable and neither is load-bearing for onboarding, so they are recorded here and left out
of the minimum set.

The **per-machine binding** correspondingly gains: the chosen driver, the local path, the
observed account, the observed identity *and how it was established*, and the timestamp of the
last successful verification. "How it was established" is what lets the UI distinguish
`unverified`-because-tier-1 from `unverified`-because-the-check-failed.

### 2.5 Hypothesis 5 — Drive for Desktop over rclone: **holds with caveats** (macOS), **blocked** (Windows), **fails** (Linux)

What Drive for Desktop removes, measured against the five steps: **step 1 (no OAuth project at
all), step 2 (no `rclone config`), step 3 (a native dialog, per hypothesis 3), and step 5 (it
is an ordinary desktop application that starts at login and manages its own lifecycle).** Step 4
is absorbed by the extension in either tier. That is the whole list.

What it costs:

- **macOS: a symlink is unavoidable, and it works.** On macOS 12.1 and later Drive for Desktop
  uses File Provider and "macOS controls the mount point" — the `DefaultMountPoint` setting
  explicitly "does not apply".
  <https://knowledge.workspace.google.com/admin/drive/advanced-drive-for-desktop-configuration>
  (2026-09-10). So the mount cannot be relocated into `contents/` and a link is required. The
  user verified on 2026-09-07 that a symlink into both My Drive and a Shared Drive works for
  read and write and that `git check-ignore` still excludes it (`DESIGN.md`). Node's
  `fs.symlink` `type` argument is Windows-only and ignored elsewhere, so on macOS this is a
  plain, unprivileged `symlink(2)`.
- **Windows: this is where it gets thin.** `fs.symlink(target, path, 'junction')` is the
  privilege-free option, but "junction points on NTFS volumes can only point to directories"
  and a junction "cannot reference a non-local volume"
  (<https://nodejs.org/api/fs.html>, <https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions>,
  2026-09-10), while Google states "Drive for desktop creates a virtual Drive, which appears as
  a FAT file system"
  (<https://knowledge.workspace.google.com/admin/drive/drive-sync-faq-for-admins>) — which is
  the mechanism behind the user's observed `mklink /J` failure. The remaining option,
  `type: 'dir'` (a true NTFS symbolic link), requires `SeCreateSymbolicLinkPrivilege`:
  Administrators hold it by default, **or any user holds it once Developer Mode is enabled** —
  "for users who have Developer Mode enabled, the mklink command will now successfully create a
  symlink if the user is not running as an administrator"
  (<https://blogs.windows.com/windowsdeveloper/2016/12/02/symlinks-windows-10/>, applies from
  Windows 10 Creators Update onward). **Whether `mklink /D` resolves into the Drive virtual
  volume at all is still unverified** — it is check 3b of
  `rclone-verification-procedure.md` and remains the single highest-value experiment in the
  project. Until it is run, Windows tier 1 is a *proposal*, not a plan.
- **Linux: the product does not exist.** Drive for Desktop is "Windows and macOS only"
  (<https://support.google.com/drive/answer/2375082>). Linux users stay on the rclone tier.
  This is not a gap this design can close.
- **A detection gap the tier introduces.** `src/mounts.ts` returns `attached` for any symlink
  that resolves. If Drive for Desktop is installed but signed out or not running, the
  `~/Library/CloudStorage/GoogleDrive-<email>/` path can still exist while yielding nothing, so
  the mount would render `attached` and empty — the single worst state for a non-engineer,
  because it looks correct. Tier 1 therefore needs a **non-emptiness probe** on top of link
  resolution before it may report `attached`. **[inference from `src/mounts.ts:87` +
  File Provider behaviour; not measured]**

**Is a two-tier design coherent, or two half-supported paths?** Coherent on the *model*, and
**not equivalent on identity** — which is the correction §2.6 makes. Three settled decisions
make the model tool-agnostic: `contents/` holds mounts and nothing else, *position* (not inode
type) is what makes something a mount, and the registry records `mountPoint` while staying
agnostic about materialisation (`DESIGN.md` 2026-09-09; `multi-drive-contents-2026-09.md` §8).
So the registry schema, the state machine, the manifest and the scanner are genuinely shared.
But an earlier draft of this document claimed the tiers differ "only in provisioning and in
repair prose", and that was wrong: they also differ in **how strongly identity can be
established**, and identity is the axis the whole absence machine is ordered around. §2.6 states
the correction and §3.1 carries it into the recommendation.

### 2.6 The correction: tier 1 cannot prove folder identity

This is the strongest objection to the design, it came out of the Codex consult (§9), and it
stands.

The settled ordering rule is that `identity-mismatch` is evaluated **before any file-level
check**, because otherwise "files from the *wrong* Drive at the right path report `ok` — a
silent, cross-scope wrong answer" (`multi-drive-contents-2026-09.md` §6). Tier 2 can satisfy
this: rclone's `root_folder_id` **is** the Google folder ID, and Google guarantees "file IDs are
stable throughout the life of the file, even if the file name changes"
(<https://developers.google.com/workspace/drive/api/guides/about-files>, 2026-09-10).

**Tier 1 has no such handle.** A local path under `~/Library/CloudStorage/GoogleDrive-<email>/`
carries the *account* (the email is in the path — a real identity signal, and more than Codex
credited) but **not the folder**. The concrete failure: a user with a personal and a work
account, each holding a folder named `Team Knowledge`, connects the personal one. The symlink
resolves, files are there, the state machine says `attached`, and irori indexes and presents
the wrong knowledge base — a silent isolation failure, not onboarding friction.

Two consequences, both of which the existing vocabulary can already express:

1. **A tier-1 mount is `unverified` on the identity axis, permanently, and must say so.**
   `multi-drive-contents-2026-09.md` §6 already defines `unverified` as "bound and readable,
   identity could not be established → attached, with the caveat visible", and the research
   already concluded that where a provider id cannot be queried "the honest guarantee is
   `unverified` — never 'correct drive'". Tier 1 must therefore never render `ok`; the badge it
   earns is `attached, unverified`.
2. **A mount whose identity policy is `exact` may not be offered tier 1.** Connecting the wrong
   folder for a *personal exchange* mount is an annoyance; doing it for a *team scope root* is a
   disclosure failure of exactly the kind the `kind`-is-declared decision exists to prevent. So
   `identityPolicy` becomes a per-mount, tracked field (§2.4), and the wizard offers tier 1 only
   where the policy permits `unverified`.

**The experiment that would lift this.** Drive for Desktop is widely reported to record the
Drive item id alongside the local file — an extended attribute on macOS, an alternate data
stream on Windows — and to keep a local metadata SQLite database per account. **None of this is
documented by Google, none of it is a supported API, and none of it was verified here.**
**[unverified]** If a stable, readable item id turns out to be obtainable, tier 1's identity
gap closes and consequence 2 above disappears. Until then it stands, and it is the single
highest-value experiment after the Windows link question.

---

## 3. The recommended design

### 3.1 Two tiers, one model

| | **Tier 1 — Drive for Desktop** (default) | **Tier 2 — rclone** (advanced) |
|---|---|---|
| Audience | everyone on macOS; Windows **blocked pending check 3b** | Linux; Windows today; any mount needing verified identity |
| OAuth project | **none** | the user's own, or an org-Internal one |
| Folder selection | native folder dialog over the local Drive root | Google Picker (`drive.file`) or a pasted ID |
| Materialisation | symlink created by the extension (`'dir'` on Windows, plain on macOS) | real FUSE/WinFsp mountpoint at an empty dir |
| **Identity strength** | **account only** (from the path); folder identity **unverifiable** → permanently `unverified` (§2.6) | folder ID pinned in `root_folder_id`; `identity-mismatch` decidable |
| Eligible mounts | those whose `identityPolicy` permits `unverified` | any, including `identityPolicy: exact` |
| Autostart | the app's own | launchd / Task Scheduler / Windows service, per mount |
| Extra installs | Drive for Desktop | rclone (no official `.pkg`/`.msi`) + WinFsp (Windows) or macFUSE/FUSE-T (macOS, unless `nfsmount`) |
| Engineer-only steps | 0 (macOS) / **blocked** (Windows, pending check 3b; 0–1 if it passes) | 5 — unchanged |

Note for tier 2 on macOS: the easiest install is the one that does not work. rclone's own page
says of the Homebrew build "This version of rclone will not support `mount` any more … If
mounting is wanted on macOS, either install a precompiled binary or enable the relevant option
when installing from source" (<https://rclone.org/install/>, 2026-09-10). Tier 2 is genuinely
engineer territory and the plan should stop pretending otherwise.

### 3.2 The numbered procedure a non-engineer actually performs (tier 1, macOS)

1. **Install VS Code and the irori extension** from the Marketplace.
2. **Open the vault.** The extension's walkthrough offers *Clone knowledge base…*; it invokes
   the built-in Git extension's `git.clone` command and then runs
   `git submodule update --init --recursive` itself, so team knowledge bases are populated
   without the word "submodule" ever appearing. *(`git.clone` is a command contributed by the
   built-in Git extension, not part of the stable extension API — a version-pinning risk to
   accept knowingly.* **[inference]**)
3. **Install Google Drive for Desktop** — a normal signed installer from Google.
4. **Sign in**, once per Google account (personal, work). Drive for Desktop supports up to 4
   accounts (<https://support.google.com/drive/answer/7329379>, 2026-09-10).
5. **Click "接続" on each mount the vault declares** and pick the folder in the dialog that
   opens on the Drive root. The extension creates `contents/`, creates the link, records the
   per-machine binding, rescans and turns the row green.

**Five steps, none of them engineer-only — but two of them are loops, and the count is a
happy-path count.** Step 4 repeats per Google account (two, in the reference layout) and step 5
repeats per declared mount (three). Codex would number this seven phases by splitting out
"confirm each account is mounted and ready" and "verify, including submodules"; those are tool
actions rather than things the human does, so they are not counted as steps here — but they are
places the flow can *stall*, and a stalled flow is indistinguishable from a broken one to a
non-engineer, which is why §5 gives each of them a state and a button. Conditional extra steps
that do not appear on the happy path: authenticating to the git host, and an organisation
policy that blocks Drive for Desktop.

**Windows is blocked, not merely caveated.** *If and only if* check 3b shows `mklink /D`
resolves into a Shared Drive — and holds across reboot, sign-out/sign-in and offline mode —
Windows is the same list plus a one-time **Settings → Privacy & security → For developers →
Developer Mode** toggle before step 5: six steps, one of which is a settings switch. If check 3b
fails, Windows gets tier 2 or is marked unsupported. It does **not** get the
`DefaultMountPoint`-inside-the-vault workaround: that exposes the whole account root as one
mount, contradicts the settled one-folder-per-mount decision, couples the Drive provider's
lifecycle to the repository directory, and breaks outright with two accounts or two vaults.
Shipping an architectural exception to avoid validating one primitive is the wrong trade, and
this is the point on which the Codex consult was most emphatic (§9).

**Linux** is unchanged: tier 2, five engineer-only steps.

### 3.3 What the extension does on the user's behalf

Each of these is a step deleted from the human's list, and each is mechanical enough to be safe:

- Create `contents/` as a **real directory** (`fs.mkdir`), and never as a link — step 4 of the
  old list, absorbed completely and permanently. Add `contents/` to `.gitignore` if absent.
- Detect the Drive root: glob `~/Library/CloudStorage/GoogleDrive-*` (macOS); read
  `DefaultMountPoint` from `HKEY_CURRENT_USER\Software\Google\DriveFS` / probe the configured
  drive letter (Windows). Both documented at
  <https://knowledge.workspace.google.com/admin/drive/advanced-drive-for-desktop-configuration>.
  Never resolve `My Drive` by name (§2.3).
- Create the mount point: `fs.symlink(target, mountPoint, 'dir')` for tier 1; `fs.mkdir` of an
  empty directory for tier 2 on macOS/Linux; **not** creating it at all for tier 2 on Windows,
  where rclone requires the leaf to *not* exist.
- Write the gitignored per-machine binding, and only there — never an absolute path into a
  tracked file.
- Run `git submodule update --init --recursive`, and distinguish an uninitialised submodule
  from an empty directory (`multi-drive-contents-2026-09.md` §9).
- Verify and report: identity first, then contents, per the settled ordering.

### 3.4 Where the setup UI lives

**`contributes.walkthroughs` for the linear part; QuickPicks and native dialogs for the
per-mount part; no new webview.**

The walkthrough fits the one-time, ordered, checkable half of the job: it opens automatically
after install, renders as a native checklist, its step descriptions can invoke commands through
`command:` links, and its steps tick themselves via `completionEvents` — `onCommand:`,
`onSettingChanged:`, `onContext:`, `onView:`, `extensionInstalled:`
(<https://code.visualstudio.com/api/references/contribution-points#contributes.walkthroughs>,
2026-09-10). `onContext:` is the important one: the extension already computes mount state, so
"Google ドライブに接続する" can complete itself the moment a real mount is observed, rather than
when a button is pressed. A checklist that reflects *observed reality* is exactly what a
non-engineer needs and exactly what a static document cannot be.

What the walkthrough cannot do is render N mounts discovered from `mounts.yaml`, so per-mount
work is a `irori.connectMount` command driven by a QuickPick (mount list) plus
`showOpenDialog` (folder choice), and the persistent surface stays the mount rows already
decided on 2026-09-09 (drawn in place, badge-marked).

**Against a webview wizard:** the project already carries one *provisional* webview decision —
rendering the layer × scope matrix — whose cost (`reveal`, drag-and-drop, context menus,
`viewsWelcome`, keyboard navigation, accessibility, virtualisation at 15,118 files) is
explicitly unresolved pending a prototype (`DESIGN.md`, 2026-09-08). Adding a second webview
doubles an unsettled bet and buys layout freedom the setup flow does not need. Revisit only if
the matrix prototype confirms the webview, at which point the wizard becomes a panel in
something that already exists.

---

## 4. What genuinely cannot be absorbed

The irreducible minimum, and why each one is irreducible:

1. **Installing an application.** Neither VS Code nor an extension may install Google Drive for
   Desktop silently; it is a signed OS-level installer with a filesystem provider.
2. **Signing in to a Google account, once per account.** Consent must be given to Google, by
   the human, in a browser Google controls. Any design that removes this is a design that steals
   credentials.
3. **Choosing which folder is which.** Which Drive folder is "my materials" and which is "the
   sales team's" is knowledge only the human has. The tool can make the choice a click; it
   cannot make it for them.
4. **Being granted access to a team's Shared Drive.** An access request is a decision by another
   human in another organisation.

**Count: 4 irreducible acts, expressed as 5 numbered steps** (installing the extension and
opening the vault are two instances of act 1's category; the sign-in repeats per account).
Everything else on the old list — the Cloud project, the three `rclone config` runs, the folder
IDs, the `contents/` directory rule, and the three scheduled tasks — is absorbed or deleted.

Note the honest asymmetry: acts 1–3 are things a non-engineer does every week with other
software. Act 4 has no technical content at all. **None of the four requires a terminal.**

---

## 5. Failure and repair

A non-engineer cannot debug, so the tool must satisfy three properties: never assert a state it
has not observed, never show a cause it has not established, and always offer exactly one
next action.

The three states `src/mounts.ts` computes today (`attached` / `unavailable` / `local-data`) are
the observation vocabulary. Onboarding adds the *declared* dimension, which is where the eight
FR-11 states come from: a mount can now be known-and-absent, not merely absent.

| What happened | State | What the user is shown | The one action |
|---|---|---|---|
| Vault cloned, nothing connected yet | `not-configured` | "この端末にはまだ接続されていません" + `displayName` + `source` | **接続** (opens the dialog) |
| Drive for Desktop not running / signed out | `mount-unavailable` | "Google ドライブ アプリが動いていません" — a *driver-specific* sentence, from the `driver` hint | **Drive for Desktop を開く** |
| Link resolves but the target is empty | `mount-unavailable`, **not** `attached` | same as above | same |
| Connected to the wrong folder or the wrong account | `identity-mismatch` | "別のドライブに繋がっています" — **checked before any file-level check** | **接続し直す** |
| Submodule never initialised | (new) `scope-not-initialised` | "チームのナレッジベースがまだ取得されていません" — distinct from "empty folder" | **取得する** (runs `submodule update --init`) |
| A real local directory where a mount belongs | `local-data` | "マウントされていない場所にファイルが溜まっています。この端末にしかありません" | **開いて確認する** — never a delete |
| rclone token expired (tier 2 only) | `mount-unavailable` | "再ログインが必要です" | **再接続** (`rclone config reconnect`) |

**Eight states are the user-facing summary, not the diagnosis.** Underneath them the tool needs
distinguishable *causes*, because the same badge has different buttons: driver not installed,
driver not running, signed out, wrong account, permission denied by org policy, offline,
hydration pending, hydration failed, target deleted, broken shortcut, wrong or broken symlink,
mount-point conflict, git authentication failure, and unsupported execution topology (a remote
workspace where the extension host and the Drive mount are not the same filesystem). A repair
message needs six things: the mount's `displayName`, the expected target, what was actually
observed (account / path / identity), the cause, **one** button, and the result of the retry.
**[the cause list is Codex's; adopted]**

Three rules that follow, and that the existing decisions already imply:

- **Repair is a button, never a command line.** If a state's remedy cannot be expressed as one
  button, that state has not been designed yet.
- **The tool never deletes anything to fix a state.** `local-data` in particular is data that
  exists on exactly one machine and is backed up nowhere.
- **A state whose cause is not established is named observationally.** The 2026-09-09 decision
  (`unavailable`, not `not attached` or `broken`) generalises: the driver may add a *likely*
  cause sentence, and must be phrased as one.
- **`ok` may never mean "the directory entry exists".** With streaming, a directory can
  enumerate perfectly while none of its bytes are local; that is `present-unhydrated`, which the
  state machine already has, and it must be reachable from the *scan*, not only from an
  integrity check. A placeholder tree mistaken for a healthy mount is, per Codex, the second
  most likely field failure after wrong-folder selection.

Can a non-engineer get back on their own? For tiers-1 states, yes: every row above resolves to
one button, and the two most common real failures — the Drive app not running, and a laptop
signed out after an OS update — are exactly the ones the driver hint names. For tier 2, no: a
dead FUSE mount, a stale `rclone.conf` token, or a WinFsp upgrade needs a terminal. **That
asymmetry is the strongest argument for tier 1 being the default, independent of step count.**

---

## 6. What must be verified before this is built

| # | Question | Where | Consequence if it fails |
|---|---|---|---|
| 1 | Does `mklink /D` (Node `'dir'`) resolve into a Drive for Desktop **Shared Drive** on Windows? | `rclone-verification-procedure.md` check 3b | Windows tier 1 cannot use links. Fallbacks: point `DefaultMountPoint` at `<vault>\contents\gdrive` (works, but exposes the whole account root as one mount and **contradicts the 2026-09-09 decision that each mount points at one folder** — must be a deliberate, recorded exception, not a silent one), or make Windows tier 2. |
| 2 | With Drive for Desktop signed out, does the `CloudStorage` path still resolve? | new — needs a Mac | Decides whether the non-emptiness probe in §2.5 is mandatory or belt-and-braces. |
| 3 | Does a metadata-only scan through File Provider materialise bytes? | check 6 | If yes, the first rescan after onboarding downloads gigabytes on the user's first day — the worst possible first impression. |
| 4 | Does `vscode.workspace.findFiles` descend a symlinked mount inside the workspace? | check 8a | Tier 1 is symlink-based; if `search.followSymlinks` is off, tier 1 shows nothing at all. The wizard must read the effective setting and offer to fix it. |
| 5 | Does picking a folder under `drive.file` grant descendant access? | undocumented (§2.3) | Only blocks a future extension-side listing feature; not the picker's use here. |
| 6 | Is a stable Drive item id readable from the local filesystem (xattr / ADS / per-account metadata DB)? | new — needs a Mac and a Windows box (§2.6) | If **yes**, tier 1's identity gap closes and `identityPolicy: exact` mounts become eligible for it. If **no**, tier 1 is permanently `unverified` on identity and team scope roots stay on tier 2. |
| 7 | In a Remote-SSH / Codespaces workspace, where do the extension host, the vault and the Drive mount actually live? | new | If they can differ, tier 1 must detect the topology and refuse rather than create a link that resolves on the wrong machine. **[Codex's catch]** |
| 8 | Does a "Shared with me" folder appear under the local Drive root without the user first adding a shortcut to My Drive? | new | Decides whether the wizard must *instruct* the user to add a shortcut before step 5 — a hidden sixth step if it does. |

Items 1, 4 and 6 gate delivery (6 gates only the `exact`-identity subset). Items 2, 3 and 7 gate
quality. Items 5 and 8 gate nothing structural.

---

## 7. The host question — VS Code or Obsidian?

**Recommendation: do not re-prioritise the Obsidian port on the strength of this requirement.
Re-prioritise it on the strength of one measurement (check 7), which is cheap and unrun.**

The intuition — non-engineers use Obsidian, engineers use VS Code — is correct about the
audience and wrong about the mechanism, for four reasons:

1. **The entire non-engineer gain comes from the host doing filesystem work.** An Obsidian
   desktop plugin *can* do it: `require('fs')` and Electron APIs are available with
   `isDesktopOnly: true` in the manifest
   (<https://docs.obsidian.md/Reference/TypeScript+API/PluginManifest/isDesktopOnly>,
   2026-09-10). So capability is not the blocker.
2. **The blocker is that tier 1 is symlinks, and Obsidian's own documentation says not to.**
   "We strongly advise against using symbolic links. By using symbolic links and junctions in
   your vault, you risk losing or corrupting your data, or crashing Obsidian"
   (<https://obsidian.md/help/symlinks>). Shipping a wizard whose first act is the thing the
   host vendor warns against is not a defensible product.
3. **Mobile is empty by construction**, so the audience most likely to be reached through
   Obsidian is the audience for whom `contents/` cannot exist at all.
4. **Git is not an Obsidian concept.** Step 2 of §3.2 — clone and initialise submodules — has
   no host support there; team knowledge bases would need a bundled git implementation or a
   different distribution mechanism entirely. That is a larger project than the mount work.

**The decision gate.** Check 7 of `rclone-verification-procedure.md` asks whether Obsidian's
indexer descends into a mount placed inside the vault. If a **real mountpoint** (rclone, not a
symlink) is tolerated, then reasons 2 is answered for tier 2 and the Obsidian port becomes the
better host for a non-engineer audience — at which point the tier ordering **inverts on that
host**: rclone/real-mountpoint becomes tier 1 there precisely because it is not a symlink. That
is a concrete, falsifiable trigger rather than a preference, and it costs one throwaway vault
and an afternoon.

Meanwhile the product's own premise argues for staying: irori exists for "people who run a
Personal Knowledge Base together with CLI agents such as Claude Code" (`DESIGN.md`). A
non-engineer running Claude Code is running it in a terminal, and overwhelmingly in VS Code's.
The non-engineer who will never open a terminal is a *different product's* user, and serving
them is a scope decision for the user to make, not a mount-mechanism decision.

**What the port would cost, if chosen:** the 8-slot view limit disappears (`registerView` can
be called freely), which is a real gain given 3 layers × 3 scopes exceeds 8 today. Against it:
no `roots` equivalent, no official explorer-decoration API (CSS-injection instead, which can
conflict with other plugins), the symlink warning above, FR-13 promotion breaking across a
device boundary (Obsidian reads it as delete+create and does not fix inbound links), and
git/submodule handling to build from nothing.

---

## 8. What this contradicts, stated plainly

One settled decision is in tension with this proposal, and one is superseded in emphasis:

- **In tension, and resolved by refusing the workaround.** "Each mount points at one specific
  folder, not at a whole drive" (2026-09-09). Tier 1 honours it on macOS: the symlink targets a
  folder *inside* the Drive root, so the scoping decision survives intact. On Windows, if check
  3b fails, the only remaining mechanism — `DefaultMountPoint` → `<vault>\contents\gdrive` —
  would expose the whole account root and break the decision. §3.2 **declines** that workaround:
  Windows falls back to tier 2 or is marked unsupported. The tension is therefore recorded and
  closed, not left for the user to arbitrate — but if the user *wants* the coarse-grained
  Windows path, it is theirs to grant as an explicit, platform-scoped exception, and it should be
  written into `DESIGN.md` as one rather than adopted silently.
- **Qualified.** "Per-machine absence is computed at read time … mount identity is checked
  before any file-level check" (2026-09-08). §2.6 shows tier 1 cannot perform that check at all.
  The ordering rule is not violated — `unverified` is the state the design already reserved for
  exactly this — but the *default* tier now sits permanently in it, which is a stronger claim
  than the original decision anticipated and deserves to be recorded as such.
- **Superseded in emphasis.** "rclone is the reference mechanism … Google Drive for Desktop
  and Workspace CLIs are rejected for this role" (2026-09-08). The reasoning still holds *for
  the constraint it was decided under* — that a link into `contents/` fails on Windows. This
  document does not overturn it; it argues that the constraint set has changed (a
  non-engineer audience makes the FUSE layer, the Cloud project and the three scheduled tasks
  costs of the *first* order), and that the Windows link question is still open rather than
  settled negative, because only `mklink /J` was tested.

---

## 9. Codex consult record

Two calls, both `gpt-5.6-sol`, `--sandbox read-only`, through
`.claude/skills/_shared/codex_consult.py`. The design above was handed over **as a target to
attack**, not as a proposal to endorse.

- **First call — timed out.** 600 s, zero response characters. The stderr log shows it spent the
  budget re-verifying the source facts by web search rather than judging the design. No file was
  edited (`changed_files: []`, HEAD unchanged; the one file the wrapper's snapshot lists as
  created is *this document*, written by the caller while the call ran).
  Log: `.claude/logs/codex/20260909T183341Z-onboarding-non-engineer.md`.
- **Second call — succeeded**, 161 s, 8,050 characters, after the prompt was rewritten to forbid
  web search and to state the facts as given. No file edited; HEAD unchanged. Log:
  `.claude/logs/codex/20260909T184419Z-onboarding-non-engineer-2.md`. **Caveat on its authority:**
  it reports that "repository inspection was attempted, but the environment's filesystem sandbox
  failed before reading the requested plan", so it judged the *summary* it was given, not the
  repository. Its verdicts are worth what a well-briefed outsider's are worth.

**Adopted, against this document's earlier position:**

- The identity objection (§2.6) — the decisive correction. `expectedIdentity` is toothless in
  tier 1, so tier 1 is permanently `unverified` on the identity axis and `identityPolicy: exact`
  mounts may not use it. This document had claimed the tiers differed only in provisioning and
  repair prose; that was wrong.
- Windows: block on check 3b rather than shipping the `DefaultMountPoint`-inside-the-vault
  exception (§3.2).
- `allowedDrivers` / `preferredDriver` instead of a single `driver` hint, plus `identityPolicy`
  and `shortcutPolicy` (§2.4).
- Causes beneath the eight states, and the six things a repair message needs (§5).
- Google Drive shortcuts, "Shared with me" needing a My Drive shortcut, and remote-workspace
  topology as first-class failure modes (§2.2, §6).
- "`ok` may never mean the directory entry exists" — streamed placeholders as the second most
  likely field failure (§5).
- The step count is a happy-path count containing two loops, and it is unproven until the §6
  checks run (§3.2).

**Not adopted, with reasons:**

- *"Claim A holds with caveats — a distributed desktop app can ship a Drive client id at
  scale."* True in the abstract and the disagreement is smaller than it looks: Codex's own list
  of what that requires (verification, annual assessment, quota management, abuse controls,
  support, eventual billing) is precisely the argument for **fails** in the concrete case of a
  single-maintainer MIT extension. The verdict stays, scoped as Codex phrases it: irori will
  not operate a shared restricted-scope Drive credential service.
- *"Cut the Google Picker from the rclone story."* Codex conflated identification with
  authorisation; see §2.3. Its cost point is adopted, its conclusion is not.
- *"Claim C fails — the extension cannot absorb sign-in state, org policy, git credentials,
  filesystem privileges."* Claim C never asserted it could; those are §4's irreducible acts and
  §5's failure states. The disagreement is about what Claim C said, not about the design.
- *Seven phases rather than five steps.* The two extra phases are things the **tool** does. They
  are recorded in §3.2 as stall points with states and buttons rather than promoted to user
  steps, because a user cannot perform "confirm the account is mounted and ready" — they can
  only wait for it.

---

## 10. Source index

**Google OAuth and verification** (all retrieved 2026-09-10)
- <https://developers.google.com/identity/protocols/oauth2/native-app> — desktop clients,
  loopback only, OOB unsupported, PKCE recommended
- <https://developers.google.com/identity/protocols/oauth2> — 7-day refresh tokens in Testing
- <https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification>
  — CASA, annual re-verification
- <https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification>
  — submission materials, 3–5 business days
- <https://support.google.com/cloud/answer/13463817> — 100 new-user cap, lifetime of project
- <https://support.google.com/cloud/answer/13464323> — exemptions; Internal apps

**Google Drive API and Picker** (2026-09-10)
- <https://developers.google.com/workspace/drive/api/guides/api-specific-auth> — scope
  classification
- <https://developers.google.com/workspace/drive/api/guides/limits> — per-project quota,
  planned charging later in 2026
- <https://developers.google.com/workspace/drive/picker/guides/overview-desktop> and
  <https://developers.google.com/workspace/drive/picker/guides/desktop-mobile-picker> —
  desktop Picker, `allow_folder_selection`, `drive.file` only

**Google Drive for Desktop** (2026-09-10)
- <https://knowledge.workspace.google.com/admin/drive/advanced-drive-for-desktop-configuration>
  — `DefaultMountPoint`, File Provider on macOS 12.1+
- <https://knowledge.workspace.google.com/admin/drive/set-up-drive-for-desktop-for-your-organization>
  — default streaming locations
- <https://knowledge.workspace.google.com/admin/drive/drive-sync-faq-for-admins> — FAT virtual
  filesystem
- <https://support.google.com/drive/answer/2375082> — Windows and macOS only
- <https://support.google.com/drive/answer/7329379> — up to 4 accounts
- <https://support.google.com/drive/answer/10838124?hl=ja> — `マイドライブ` under a Japanese locale

**rclone** (2026-09-10)
- <https://rclone.org/drive/> — shared `client_id` retired during 2026; 10 tps guidance
- <https://forum.rclone.org/t/google-drive-and-google-photos-users-action-required/54005>
  (posted 2026-07-06) — Google charging for the default client-ID
- <https://rclone.org/install/> — no official `.pkg`/`.msi`; Homebrew build has no `mount`

**Windows link semantics** (2026-09-10)
- <https://learn.microsoft.com/en-us/windows/win32/fileio/hard-links-and-junctions>
- <https://learn.microsoft.com/en-us/windows/security/threat-protection/security-policy-settings/create-symbolic-links>
- <https://blogs.windows.com/windowsdeveloper/2016/12/02/symlinks-windows-10/> — Developer Mode
- <https://nodejs.org/api/fs.html> — `fs.symlink` `type`: `'dir' | 'file' | 'junction'`

**VS Code** (2026-09-10)
- `node_modules/@types/vscode/index.d.ts` @ `^1.105.0` — `registerUriHandler`,
  `asExternalUri`, `SecretStorage` (primary source, read locally)
- <https://code.visualstudio.com/api/references/contribution-points#contributes.walkthroughs>

**Obsidian** (2026-09-10)
- <https://docs.obsidian.md/Reference/TypeScript+API/PluginManifest/isDesktopOnly>
- <https://obsidian.md/help/symlinks>
