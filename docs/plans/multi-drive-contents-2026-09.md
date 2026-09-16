# One KB, N Drives and M Repositories — where the mounts go

> Status: design recommendation, not yet implemented. No source file was changed to produce it.
> Authority: the user's design note (2026-09-07) is normative; where this document extends it, that is
> marked. Settled decisions (three layers; artifacts do not live in a layer; `contents/` is a real
> directory holding mounts) are inputs here, not open questions.
> Related: `docs/DESIGN.md` FR-9..FR-13 and Constraints. Codex consult:
> `.claude/logs/codex/20260907T173614Z-multi-drive-contents.md`.

## 1. The question

The personal KB is to hold, at the same time:

1. a **team KB, entering as a git submodule**;
2. **several Google Drives** (personal + team), attached as mounts;
3. with all of them landing **in the `contents` layer**.

The note settled three layers on one axis — *is this inside or outside the system* — after diagnosing
(§2.2) that the previous four layers failed because two axes were resolved by one ordered
first-match-wins list. A git submodule is a **scope** boundary; a Drive mount is a **substrate**
boundary. Item 3 puts both inside one layer. The question is whether the single axis survives that.

## 2. Verdict: item 2 is consistent, items 1+3 together are not

**Attaching several Drives under `contents/` is consistent** with the settled model. It is a pure
N-instance generalisation of what §6 already established: `contents/` is a real directory, mounts go
inside it, one `.gitignore` line covers all of them. Nothing about the model assumed exactly one mount.

**Filing the team-KB submodule in the `contents` layer conflicts**, on three independent grounds:

| Ground | The conflict |
|---|---|
| Structural | The note's own §4 matrix already records `AI-Kommon/Research` as an **org-scope submodule with its own three layers** — `Research/CLAUDE.md` is its schema, `docs/`+`phases/` its Knowledge_Base, `sources/`+`datasets/` its contents. A submodule is a scope **cell spanning all three layers**, not a member of one. Filing it under `contents` puts a complete three-layer system inside one layer of the host. |
| Representational | `contents/` is *defined* as the git-excluded region — the single ignore line that replaced twelve groups of after-the-fact rules. A submodule is by definition a tracked gitlink. Co-locating them requires punching a negation exception through the exact line the three-layer model exists to collapse. |
| Semantic | `contents` means the exchange surface, whose declared writers are capture agents and generators. A submodule's writers are another organisation's humans and their agents, under another commit lifecycle. The note's property "answer one question and both the location *and the writer* are fixed" fails for that path. |

There is exactly one coherent reading in which item 1 works as stated, and it should be named so the
user can reject it deliberately: the host may treat the submodule as an **opaque imported blob** — an
exchange input whose internals never participate in irori at all, no layer classification, no
manifest, no panel. That is internally consistent, and it is not the team-KB use case: it discards the
matrix and gives up seeing team material as knowledge.

## 3. Does the single axis survive? Locally yes, globally no — and that is fine

The honest formulation, which the note left implicit:

- **Within one scope root**, the three layers remain a single axis: `path within scope -> schema |
  Knowledge_Base | contents`. Nothing here changes.
- **Across the whole installation** the model is genuinely two-dimensional: `(scope root, path within
  that root) -> layer`. The §4 matrix *is* that product; it was already two-dimensional on the page.

This is **not** the §2.2 defect returning. The defect was two axes resolved *simultaneously by one
ordered list*, so a file crossing both axes had two true answers and the list could return only one.
Here the two dimensions are resolved **in sequence by different mechanisms**: scope is resolved first,
as ownership and routing; layer is resolved second, inside the selected scope, by the existing
first-match-wins list. Sequenced resolution by distinct mechanisms is what the note's own cited pattern
does (Data Mesh domains with a nested medallion inside each).

The axis-relativity is the part the note never states: "inside or outside **the system**" presupposes a
frame. From the personal frame the team KB genuinely *is* something the system exchanges with the
outside — the user's intuition is correct at the level of the axis. What cannot survive is the
implementation corollary "the layer is the folder, evaluated by one list over the whole tree":
`contents/team-kb/CLAUDE.md` is contents in the parent frame and schema in the team frame, and a flat
list must return one answer. The classifier does not fail because a second axis was named; it fails
because it **flattens the frame**.

### The minimal correction is a pruning rule, not a recursive classifier

> **A declared scope root owns classification of everything beneath it. Ancestors do not
> layer-classify a scope root's descendants.**

Concretely: partition the file list by nearest enclosing declared scope root, then run the existing
`classifyFiles` once per partition with that scope's own layer list. `Research/CLAUDE.md` then has one
operative classification — `schema` **in the Research scope**. The host sees `Research/` as a scope
attachment, not as a contents-layer file.

This is deliberately weaker than a general recursive classifier and is preferred for that reason:
`classifyFiles` in `src/layers.ts` needs no change at all, only a partitioning step in front of it, and
first-match-wins keeps its current meaning inside each scope.

## 4. Recommended structure

```text
MY_MEMORY/                        # personal scope root (the repo itself)
├── AGENTS.md  .claude/           #   schema
├── Work/  Others/  Maps/         #   Knowledge_Base
├── Archive/  Daily/              #   deliberately outside the layers (note §4)
├── .gitmodules
├── .irori/
│   ├── mounts.yaml               # TRACKED: what should be attached, and the policy for it
│   └── manifest/                 # TRACKED: artifact rows
├── Research/                     # org scope root    (submodule, own 3 layers inside)
├── zenn_blogs/                   # public scope root (submodule, own 3 layers inside)
├── team-kb/                      # team scope root   (submodule — NOT under contents/)
└── contents/                     # host exchange surface; wholly git-excluded
    ├── Inbox/                    #   host-local exchange material
    ├── personal-drive/           #   mount, kind: exchange
    ├── attachments/              #   mount, kind: exchange
    └── team-file-share/          #   mount, kind: exchange
```

**Hard rule, stronger than a preference:** `contents/` holds **exchange material only**. Every scope
root — git or Drive-delivered — gets its own top-level path. The moment a scope root may *sometimes*
sit under `contents/`, `contents/` no longer denotes one thing and you need a classifier to find out
which — losing exactly the property (§4, "the location of a file is its layer") that made the
classifier unnecessary. A mounted, independently governed team *vault* is therefore a top-level scope
root whose substrate happens to be a Drive; it is not host contents.

*(Codex recommended this as a preference and offered "open the team vault as a separate
workspace/vault" as the cleaner option. Opening it separately is a valid fallback where the host cannot
enforce pruning — Obsidian mobile, or an API-only mount with no path — but it answers a different
question than the user asked, which is to have one KB that holds the others. Nested scope root with
pruning is the primary recommendation; separate vault is the documented fallback.)*

### `kind` is declared, never inferred

My earlier position was that the discriminator is "does the mounted thing describe itself?" — if it
carries a `CLAUDE.md`/`.claude/`, it is a system. **That is wrong as a tool rule and I withdraw it.**
Inferring `kind` from file contents means an accidental or hostile `CLAUDE.md` dropped into a file
share promotes that share into a trusted instruction scope. Discovery must never be trust.

- **Tool rule:** `kind: scope | exchange` is a **declared** field. Self-describing files found inside a
  mount are *validation evidence* only — a good reason to warn "this exchange mount contains
  schema-shaped files; did you mean to declare it a scope?" and never a reason to reclassify.
- **Human decision aid** (what the user should actually ask): does it have an independent authority or
  disclosure boundary? Its own commit/publication lifecycle? Must promotions stay inside it? Should its
  instructions ever load as agent instructions? Four yeses means `kind: scope`.

### Where a mount is declared — two stores, not three

| Store | Tracked? | Job |
|---|---|---|
| `.irori/mounts.yaml` | **tracked**, schema layer | *What should be attached*: `id`, `mountPoint` (vault-relative), `kind`, `scope`, `substrate`, `required`, `obtain` (human instructions), `expectedIdentity`. **No absolute paths, ever.** |
| local binding (gitignored file or host settings) | **never tracked** | *How this machine reaches it*: `id -> locator`, plus the last `observedIdentity` and observation timestamp. |

```yaml
# .irori/mounts.yaml  (tracked)
version: 1
mounts:
  - id: personal-drive
    mountPoint: contents/personal-drive
    kind: exchange
    scope: personal
    substrate: google-drive
    required: false
    obtain: "Sign in to the personal Drive account"
    expectedIdentity: { type: provider-id, value: "<opaque stable id>" }
  - id: team-file-share
    mountPoint: contents/team-file-share
    kind: exchange
    scope: team
    substrate: google-drive
    required: false
    obtain: "Request access from the team owner"

# scope roots carry policy, not a source (git already pins the source)
scopes:
  - path: team-kb
    scope: team
    trustInstructions: false     # its schema never loads as host agent instructions
```

The tracked half is what makes *"should be here but is not"* decidable on a fresh clone — the precise
information missing in the measured 95 GB failure, where six skill files referenced a Drive path by
hard-coded absolute string and nothing could detect its absence.

**Do not re-declare submodule sources.** `.gitmodules` plus the gitlink already declare and pin them;
duplicating that in the registry creates two sources of truth that will drift. The registry adds only
what git cannot carry: the host's **policy** for that scope root (disclosure level, instruction trust,
display name). A scope's *internal* layer definitions are declared by that scope itself and used for
display only.

### How a note refers to a file inside a mount

Never by absolute path, and never by a vault-relative path that embeds the mount point — the mount
point itself moves per OS and per account (§6: Windows shared drives are a FAT32 virtual FS where
`mklink /J` fails). Two machine-independent forms, with different jobs:

- **`(mount id, path within mount)`** — the durable address. Used inside manifest rows, and available
  as a `mount:<id>/<path>` string for the one case that needs a raw path: a skill's shell command. This
  is the direct, lintable replacement for the hard-coded absolute paths of the 95 GB case.
- **the manifest artifact ID** — how a *note* cites an artifact. Indirection through the manifest means
  a moved file updates one row rather than N notes.

## 5. Manifest

**Join key: a stable, tool-assigned artifact ID, namespaced by scope. Not a content hash.**

The decisive argument is the multi-mount requirement itself, which is information the note did not have
when it framed §8 as hash-or-ID: **the key must resolve when the file is absent.** On a machine without
the mount there are no bytes to hash, so a hash key cannot locate its own row, and "broken" becomes
indistinguishable from "not mounted here" — the one distinction the tool exists to provide (FR-11, and
the Reliability NFR). A re-render also changes the hash while the slot ("the Q3 deck") persists.

Namespacing (`<scopeId>/<localId>`) keeps the Johnny.Decimal virtue the note valued — a short,
speakable, tool-independent address — while making collisions across M repositories impossible; a bare
J.D. number is unique only within one system.

Hashes stay, as **per-version attributes**: integrity checking when bytes are present, a distinct
`modified` state, dedup, and immutable citation of one rendition. What is lost by removing the hash
*from the key* is nothing needed for resolution; what would be lost by dropping hashes altogether is
all of the above. Do not overload one hash as both slot identity and version identity.

```yaml
id: personal/0142                  # join key: stable, opaque-ish, namespaced
label: "Q3 review deck"            # speakable; not the key
location:                          # usually one entry; a list covers replicas
  - { mount: personal-drive, path: Reports/2026/Q3/deck.pptx }
scope: personal                    # recorded explicitly, not only inherited
substrate: google-drive
provenance:
  generator: quarterly-deck
  model: "<model id>"
  prompt: "<prompt ref>"
  sourceNotes: [ "kb://Work/Quarterly/Q3.md" ]
versions:
  - { sha256: "...", size: 1842371, observedAt: "2026-09-07T10:00:00Z" }
```

Resolution order: row by `id` -> `location.mount` via the tracked registry -> mount via the local
binding -> **verify mount identity** -> `path` inside the verified mount -> size/hash if requested.
Paths are normalised (NFC) and rejected if absolute or if they escape the mount root through `..`, a
symlink, or an alias.

**Metadata leakage.** The manifest is tracked, so a row describing a team artifact publishes its
filename, size and purpose into the personal repository. This qualifies FR-10: a row whose `scope` is
stricter than the repository's own scope must live in that scope's own manifest, or be reduced to an
opaque ID with no descriptive fields. *(This risk came from the Codex consult; it is not in the note.)*

## 6. Per-machine absence: a computed state, never stored as truth

Nothing about presence is written into the tracked manifest. State is computed per (row, machine):

| State | Meaning | Shown as |
|---|---|---|
| `not-configured` | Declared in the registry, no local binding | "not attached on this machine" + `obtain` text |
| `mount-unavailable` | Bound, but the locator is unreadable / offline / not signed in | "mount unavailable" + remedy |
| `identity-mismatch` | Bound and readable, but observed identity ≠ `expectedIdentity` | **hard error, checked first** |
| `unverified` | Bound and readable, identity could not be established | attached, with the caveat visible |
| `missing` | Mount bound, readable, identity OK — file absent | **the only genuinely dangling reference** |
| `present-unhydrated` | Enumerable placeholder; bytes not local (cloud streaming) | present; hash checks skipped |
| `modified` | Present, hash disagrees with every recorded version | present, informative |
| `ok` | Present and matching | — |

Two ordering rules carry most of the value:

1. **`identity-mismatch` is evaluated before any file-level check.** Otherwise files from the *wrong*
   Drive at the right path report `ok` — a silent, cross-scope wrong answer. *(Codex's catch; my
   original state list checked files first and had this bug.)*
2. **An unbound mount yields `not-evaluated`, never "clean".** Orphan and dangling scans over a mount
   that was not scanned must render absence of evidence as absence of evidence.

`required` modulates severity and notification; it does not change the state. A missing *optional*
artifact a note points at is still a dangling reference. *(Codex folded requiredness into the state as
`missing-required`/`missing-optional`; keeping policy orthogonal to observation is cleaner and keeps
the state machine reusable.)*

### What the tool must refuse to do

- Refuse to report `missing`/broken for a reference whose mount is not bound — on the reference Mac,
  every team-scope reference would otherwise alarm on every scan.
- Refuse to report a mount as clean when it was not scanned.
- Refuse to load a nested scope's `CLAUDE.md`/`AGENTS.md` as host agent instructions. Discovering a
  scope is not authorising it; `trustInstructions` defaults to false.
- Refuse a one-click promotion across a scope boundary (see §7).
- Refuse to write a manifest row whose `scope` is stricter than the repository it is being written into
  without an explicit disclosure confirmation.

## 7. Where the submodule boundary sits, and what breaks if it is confused

The submodule boundary is the **scope** boundary: the repository boundary is the disclosure boundary
(§4). The layer boundary is a **residency/role** boundary *inside* a scope. They are perpendicular — a
submodule crosses all three layers; a layer crosses all scopes. Confusing them breaks five things:

1. **Instruction contamination.** The submodule's `CLAUDE.md` is presented as host schema. A CLI agent
   reads the schema layer every turn, so another organisation's rules become the personal agent's own.
   This is the highest-severity failure and the reason `kind` and `trustInstructions` must be declared.
2. **Silent exfiltration through promotion.** FR-13's raw->knowledge promotion becomes a one-click move
   across a repository boundary, with no commit in the source repo, landing team material in a
   personal, git-tracked, possibly public repo. Promotion *within* a scope is a file move; *across*
   scopes it is a publication decision needing a permission check — a different operation, not a flag.
3. **`.gitignore` erosion.** The negation exception needed to keep a gitlink alive under `contents/`
   restarts the hole-digging that the single `contents/` line replaced.
4. **Context-budget mis-attribution.** FR-12 must report per scope. Summing a foreign scope's schema
   into the host's budget mis-states the number the metric exists to expose.
5. **Provenance thrown away.** A submodule pins an exact commit — the one place git supplies exact
   provenance for free — and filing it under a deliberately un-provenanced layer discards it.

## 8. What depends on the mount-tool choice

The choice between rclone, Google Drive for Desktop and a Workspace CLI is being established
separately. **Nothing structural above depends on it**: the registry schema, the two-store split, mount
ids, the manifest key and `{mount, path}` location, the state machine, the pruning rule and the refusal
rules are all tool-independent. A tool swap changes only the following, all confined to the binding and
the scanner:

| Surface | What a different tool changes |
|---|---|
| Locator shape | A POSIX path, a drive letter, or **no filesystem path at all** (API-only). Keep the locator an opaque string with a scheme, not an assumed path; "no filesystem representation" must be a first-class binding kind that still permits metadata-only checks. |
| Path materialisation | Symlink, junction, or a real FUSE mountpoint. The registry records `mountPoint` and stays agnostic. §6 already measured that a Windows shared drive admits no `mklink /J`; that becomes a permanent `not-configured`, not a bug. |
| Identity | Whether a stable provider id can be queried at all. If it cannot, and no marker can be written, the honest guarantee is `unverified` — never "correct drive". A marker file is forgeable by `cp -r`, so it is evidence, not proof. |
| Hydration | Drive for Desktop streams placeholders; rclone's behaviour depends on `--vfs-cache-mode`. Hashing an unhydrated file can force a multi-GB download, so integrity checks must be opt-in and size-bounded, and `present-unhydrated` must exist. |
| Change events | A FUSE mount may emit no filesystem events. Mount scanning needs an explicit rescan command and must not assume liveness. |
| Path semantics | Case folding, Unicode normalisation, reserved names, path-length limits. |
| Vault visibility | Whether Obsidian's indexer descends into the mount as placed. **Unverified assumption** — worth measuring before committing, since a symlink and a real mountpoint may behave differently, and that is itself a tool choice. |

## 9. N drives x M repositories: failure modes to design against

Beyond the above, the multiplicity itself introduces failures a single-mount design never sees. From
the Codex consult, filtered to the ones this design must answer:

- **Duplicate mount ids** across repositories that mean different things; **mount-point overlap** where
  one mount nests inside another; **a scope root inside a mounted tree**. All three need a validation
  pass — the natural home is an extension of `validateLayers`, which already rejects duplicate ids.
- **Identity cloning** (a copied marker validates the wrong drive) and **provider id reuse** after an
  account migration or a shared-drive recreation.
- **Account confusion**: the path exists and is readable but belongs to the wrong tenant — the case
  `identity-mismatch` exists for.
- **Stale `ok`** surviving an unmount, an account switch, or a permission revocation. Status must be
  snapshot-qualified with an observation timestamp, never cached as fact.
- **Symlink escape** out of a declared mount root, and **traversal cycles** across linked mounts.
- **Rename drift**: the provider keeps object identity while the manifest's relative path goes stale.
- **Recursive submodules** introducing scope roots the host never approved.
- **Submodule state**: uninitialised, detached, dirty or conflicted needs its own visible status; an
  uninitialised submodule looks exactly like an empty directory.
- **Scale**: hashing N mounts across M repositories duplicates I/O; cache keyed by (mount identity,
  path, observed version).

## 10. Relation to the mechanism that exists today

Verified against the source, not assumed:

- `hasExternalRoots` is `Array.isArray(layer.roots)` (`src/layers.ts:147`), which is **true for
  `roots: []`** — the shipped default `raw` layer. `classifyFiles` filters such layers out of
  in-workspace classification (`src/layers.ts:183`), and `scanExternal` then walks nothing. The shipped
  `raw` layer is therefore a silently empty panel with no explanation. That is exactly the
  `not-configured` state this design makes visible, and it already exists today.
- `walk()` skips every entry whose type includes `SymbolicLink` (`src/workspaceIndex.ts:227`). Any
  mount represented as a symlink is invisible to the external scanner as written. *(In-workspace
  scanning uses `vscode.workspace.findFiles`, whose symlink traversal is host-determined and was not
  verified here.)*
- `roots` is the ancestor of the local binding but cannot serve as one: it is **per layer** (a mount
  can belong to exactly one layer and cannot host a scope with its own layers); it stores an absolute
  path in **settings**, which are per-machine, so there is no tracked statement of what *should* be
  present — precisely the fresh-clone blindness of the 95 GB case; and `roots` layers are excluded from
  in-workspace classification, so a mount cannot participate in the host tree at all.
- Implementation shape implied: a partitioning step in front of `classifyFiles` (scope roots), plus a
  mount registry/binding pair. `classifyFiles`, `buildTree` and `validateLayers` keep their current
  semantics. **The eight-slot `package.json` view limit becomes a live constraint** once scopes × layers
  are shown separately — 3 layers × 3 scope roots does not fit in 8 slots, and this design does not
  solve that. It is a VS Code host limit the Obsidian target does not share.

## 11. Open items (note §8)

**Resolved here, with rationale:**

- 🔴 **Manifest join key** — stable tool-assigned ID, namespaced per scope, as the key; hash as a
  per-version attribute. Decided by a requirement the note did not have at the time: the key must
  resolve with no bytes present, or per-machine absence is not representable at all.
- 🔴 **Classification signal — for mounts and scope roots only.** `kind`, `scope` and
  `trustInstructions` are **declared**, never inferred from file contents, because inference makes a
  dropped `CLAUDE.md` a privilege escalation. This does **not** settle the note's broader question of
  declaration-vs-path-convention for ordinary files inside a scope, which stays open (below).

**Touched but deliberately left open:**

- 🔴 **Primary classification signal for files in a general user's vault** (frontmatter vs path). Only
  the mount/scope corner is settled above; the first-run-setup question is untouched.
- 🟡 **How far orphan detection goes.** One constraint added — an unscanned mount renders
  `not-evaluated`, never clean. The suggestion-not-classification boundary already agreed stands.
- 🟢 **Naming.** This design adds `kind: scope|exchange`, `contents/`, `.irori/mounts.yaml`. The
  `Knowledge_Base` underscore question now has more surface, and is still the user's call.
- 🟢 **Personal exercise vs company-wide standard.** Attaching a team KB with a disclosure policy and
  an instruction-trust flag is multi-tenant policy work, which raises the stakes of this choice. The
  decision remains the user's; nothing here presumes it.

**Not touched:** the default layer set for general users; `Ontology.csv` column design; whether the
Obsidian plugin lives in this repository; migration of the shipped `irori.layers` default.

## 12. Consult record

Codex CLI (`gpt-5.6-sol`, `--sandbox read-only`, 178 s) was consulted with the position above stated as
a target to attack; prompt and full response are in `.claude/logs/codex/`. It made no file edits
(wrapper snapshot: zero created/changed/deleted, HEAD unchanged).

Adopted from the consult, against my prior position: `kind` must be declared rather than inferred from
self-description (the security argument); two stores rather than three, with the marker demoted to
evidence folded into the binding's `observedIdentity`; `identity-mismatch` evaluated before file-level
checks; `present-unhydrated` as a distinct state; do not duplicate `.gitmodules` in the registry;
manifest metadata leakage; and the N×M failure list in §9.

Not adopted: its preference for opening an independently governed team vault as a separate
workspace/vault (recorded as a fallback — it answers a different question than the user asked); its
softening of scope-root placement to a preference (§4 makes it a hard rule, to preserve "the location
of a file is its layer"); folding `required` into the state machine (§6 keeps policy orthogonal to
observation); and its human-readable slug as the manifest key (§5 namespaces it, since its own
duplicate-id failure mode applies to artifact ids across M repositories).
