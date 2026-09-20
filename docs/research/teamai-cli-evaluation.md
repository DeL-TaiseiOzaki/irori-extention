# `Tencent/teamai-cli` — Standalone Adoption Evaluation

**Date:** 2026-09-08 · **Author:** `general-purpose-sonnet` (decision brief, synthesized from prior
research) · **Status:** decision-support only — no adoption decision is made here.

**Historical scope (2026-09-14).** This evaluation records the repository
layout and tool behavior inspected on 2026-09-08. The shared `.claude/`,
`.codex/`, `.agents/`, `AGENTS.md` and `CLAUDE.md` now live at `KB_design/`;
product documents moved to this repository's `docs/`. Claims below about
irori owning and Git-tracking that runtime, the old skill catalog and
`scripts/check.sh` describe the inspected baseline. Use the
[workspace contract](../../../AGENTS.md) for current ownership, and recheck
version-dependent tool claims before making an adoption decision.

**Scope note.** This is its own agenda item, deliberately separated from the Google Drive
mounting question. The two are unrelated: teamai-cli has no filesystem-mount and no Google Drive
surface at all (confirmed in the source research below). Do not read this brief as part of that
decision, and do not let that decision block this one or vice versa.

**Primary source.** All facts about teamai-cli below are carried forward from
`docs/research/drive-mount-and-team-cli-2026-09.md` §1 ("`Tencent/teamai-cli`"), which
verified them via the GitHub API and the project's own README/docs/LICENSE on 2026-09-08. That
research is not repeated here beyond what each section needs; see it for the full derivation.
Claims not already sourced there are marked accordingly, and anything neither sourced nor
independently checkable in this session is marked **unverified**.

---

## 1. What It Is

teamai-cli is an MIT-licensed, Tencent-maintained (`Tencent/teamai-cli`,
<https://github.com/Tencent/teamai-cli>) command-line tool that distributes a *team's* shared
AI-coding-agent configuration — skills, rules, hooks, and MCP server definitions — from one git
repository into each member's local tool directories (e.g. `~/.claude/skills/`), via a
`push → review & merge → pull` workflow layered on an ordinary git host (GitHub, GitLab, GitCode,
CNB, plain git, or Tencent's own TGit). It additionally ships a `teamwiki/` team-knowledge feature
— structured markdown plus graph data, stored git-tracked inside the same team repository. It has
no server component of its own, no filesystem-mount capability, and no connection to Google
Drive or any cloud-storage product.

---

## 2. The Problem It Solves, and Whether This Repository Has It

**The problem it solves:** keeping a *team's* shared AI-agent configuration in sync across every
member's individual machine, so that when the shared skills/rules/hooks improve, each developer's
local Claude Code / Codex / other tool picks up the change without a manual copy step — the
`teamai pull` step is the thing that would otherwise be forgotten.

**Does this repository have that problem?** The evidence in hand says no, or at most a
hypothetical version of it:

- `git log` shows a single commit author (`DeL-TaiseiOzaki`) for this repository; there is no
  evidence of a second human collaborator maintaining an independently-configured local
  `~/.claude/skills/` that has drifted from what is checked in.
- This repository already solved the *general* version of "keep agent config consistent across
  runtimes and machines" — by making `.claude/`, `.agents/`, and `.codex/` **project-scoped and
  git-tracked** (`CLAUDE.md`, "Native Runtime Boundary"; confirmed structurally by
  `scripts/check.sh`, read in full for this brief). Cloning or pulling the repository already
  delivers the exact `.claude/` state for that commit — there is no separate "pull my agent
  config" step to forget, because it is the same `git pull` that gets the code. This is a
  stronger consistency guarantee than teamai-cli's model provides (see §3.1): it is versioned
  *with* the code it governs, not distributed on a separate, driftable cadence.
- teamai-cli's actual target — per its own README/providers model — is **cross-repository**
  personal tooling (`~/.claude/skills/`, shared by *every* repo a developer touches on that
  machine), not this-repository-specific config. Nothing in the materials available shows this
  user working across a second repository that would need to share `.claude/` content with this
  one.

**Conclusion: hypothetical, not evidenced, for this repository today.** What would settle it,
concretely:
1. A second human contributor joins this repository and an actual, observed conflict appears
   between the committed `.claude/skills/` and something they have independently configured
   locally — i.e. real drift, not a theoretical one.
2. The user starts a **second repository** that needs the same skills/rules/hooks as this one. At
   that point "share config across repos" becomes a current need, and the alternatives in §5
   become directly comparable rather than abstract.

---

## 3. Overlap and Collision Analysis

This is the core of the brief — everything else is context for this section.

### 3.1 Two different scopes, not one

This repository's skills live at `<repo>/.claude/skills/` — **project scope**: committed to this
repository's own git history (per `git status --porcelain`, `.claude/` is currently untracked but
present and about to be committed), resolved relative to the checkout, and covered by
`scripts/check.sh`.

teamai-cli's documented target is `~/.claude/skills/` — **user/home scope**: one directory per
developer machine, shared across *every* repository that developer works in, populated by
`teamai pull` from whatever team repo they configured, and physically a different absolute path
from this repository's `.claude/skills/` on every machine.

teamai-cli's ability to target a *project-scoped* directory instead of the home directory is
**unverified** — the primary research (§1.2 there) states the home-directory target as the
documented example but does not confirm or rule out a project-scope mode. The analysis below
therefore covers both the documented default and the unconfirmed alternative.

### 3.2 Collide, shadow, or duplicate?

**File-level: they do not collide.** `~/.claude/skills/<name>/` and `<repo>/.claude/skills/<name>/`
are different filesystem paths. `teamai pull` writing into the home directory cannot overwrite,
delete, or otherwise touch anything under this repository's checkout. There is no race, no merge
conflict, no risk of the tool clobbering a project file.

**Tool-discovery level: they do not coexist — Personal shadows Project, and Personal is exactly where teamai-cli writes.** Claude Code's own documented skill resolution order is `Enterprise > Personal > Project > Plugin > Bundled` (official docs, "Skill Resolution Order": <https://code.claude.com/docs/en/skills.md>). For any *unscoped* skill name that exists in both `~/.claude/skills/` (Personal) and `<repo>/.claude/skills/` (Project), the Personal copy wins outright; the Project copy is not loaded, merged, or blended with it — one skill runs, not both. (Directory-scoped skills, the `apps/web:deploy` qualified-name form, are a separate case: they get qualified names and do not shadow unscoped skills of the same base name — not relevant here, since this repository's fifteen skills are all unscoped.) Whether the developer is warned that a project skill has been shadowed is **not documented** by that page; treat "silent" as the working assumption rather than as an open question. This reverses the framing in the previous draft of this brief: the two scopes were treated as merely coexisting, with drift a matter of interpretation; they in fact resolve to exactly one definition, and teamai-cli's own write target is the scope that wins.

**Concrete shadowing risk for this repository specifically.** This repository's own skill catalog (`CLAUDE.md`, "Skill Catalog") names fifteen skills: `context-loader`, `init`, `design-tracker`, `checkpointing`, `catchup`, `feature`, `plan`, `tdd`, `team-execute`, `troubleshoot`, `simplify`, `spike`, `research-lib`, `update-lib-docs`, `codex-system`. Several of these are generic enough names (`plan`, `feature`, `troubleshoot`) that a team's independently authored skill set pulled via teamai-cli plausibly reuses one — and given the resolution order above, reuse is no longer merely "a second definition to reason about": it is an outright, silent override of this repository's canonical skill on every machine that has pulled it. Whether an actual collision exists is unknown without inspecting the team repo teamai-cli would be pointed at (none currently exists for this project) — but the check is now mandatory before any adoption, not merely advisable (see §4 R7, §6 criterion 5).

**Answer to "duplicate?":** yes, specifically for the `teamwiki/` feature. teamai-cli's
`teamwiki/` is git-tracked markdown living inside the (would-be) team repo — the same shape as the
`schema` + `Knowledge_Base` layers irori itself exists to manage (source research §1.3). If
this repository (or its developer's other projects) ever gets an actual irori-managed
knowledge base, `teamwiki/` and that knowledge base would be two independently-maintained "team
knowledge" surfaces with no defined relationship — an organizational duplication, not just a
skills one.

### 3.3 What happens to `scripts/check.sh`

Read in full for this brief. Every path check in it is `${ROOT}`-relative (36 occurrences of
`${ROOT}` and zero occurrences of `$HOME` or a `~` path — confirmed by `grep`). It has **no
visibility into `~/.claude/` at all**, structurally, not as an oversight.

- **Documented default (teamai-cli writes only to `~/.claude/`):** `check.sh` is completely blind
  to it. It will keep passing or failing exactly as it does today, regardless of what teamai-cli
  does in the home directory. That is not protection — it is the check having nothing to say about
  a scope it was never designed to cover. A developer's actual Claude Code session (which may load
  both scopes — see §3.2) can diverge from what `check.sh` verifies as "the repository's contract"
  with zero CI signal.
- **Unconfirmed alternative (teamai-cli misconfigured or capable of targeting
  `<repo>/.claude/skills/` directly):** partial, not full, coverage. `check.sh` §7
  (`check_native_boundaries`) enumerates only the **top-level** entries of `.claude/` against an
  allowlist (`agents`, `skills`, `rules`, `hooks`, `docs`, `logs`, `checkpoints`, `STATE.md`,
  `settings.json`, `settings.local.json`, `settings.orchestra.json`, `orchestra-version`) — it
  would not flag a new *skill directory* dropped under the already-allowed `skills/` top-level
  entry. `check.sh` §8 (`check_skill_scripts`) does recurse into `.claude/skills/**/*.py`
  and `*.sh` and requires each to be referenced from project markdown — an orphan script teamai-cli
  dropped without matching documentation would be caught there, but a skill delivered purely as
  markdown/YAML (no `.py`/`.sh`) would not be.

**Net finding:** under the tool's own documented behavior, `scripts/check.sh` provides **zero**
coverage of anything teamai-cli would do — the boundary it guards and the scope teamai-cli writes
to simply do not intersect. If adoption is pursued, closing this gap (either extending `check.sh`
to inspect `~/.claude/` state, or an explicit, documented decision that project-scope and
personal-scope are deliberately separate and unverified-by-CI) is a prerequisite, not an
afterthought — see §6.

### 3.4 "Two sources of truth" — confirmed, and it runs the other way

For any skill name that exists in **both** `<repo>/.claude/skills/` and (via teamai-cli) `~/.claude/skills/`: not two sources of truth in the sense of two competing definitions a developer must choose between — one definition, chosen for them, silently. Per Claude Code's documented skill resolution order (§3.2, <https://code.claude.com/docs/en/skills.md>), Personal scope beats Project scope unconditionally. **The loser is always this repository's own skill, not the imported one.** `CLAUDE.md` calls `.claude/` "the physical source" for the runtime (Native Runtime Boundary); that claim is true only on a machine that has not pulled a same-named Personal skill. The concrete failure mode: a developer edits `<repo>/.claude/skills/foo/SKILL.md`, commits it, gets it merged — and it never takes effect in their own session, because their `~/.claude/skills/foo/` (pulled from the team repo) is the one Claude Code actually loads. Whether they are told this is happening is undocumented (§3.2); assume it is silent. This is no longer a conditional risk contingent on unverified merge behaviour — it is the confirmed, default behaviour of the scope teamai-cli writes into, and it is the central, unconditional cost of adoption, independent of every other risk in §4.

---

## 4. Risk Register

| # | Risk | Rating | Evidence | Mitigation |
|---|------|--------|----------|------------|
| R1 | Supply-chain / executable-instruction injection: a compromised or careless push to the shared team repo plants a hook, skill, or MCP server definition that runs arbitrary code the next time a member does `teamai pull` and then uses the affected tool. Hooks and MCP server definitions are executable, not inert config — this repository's own `.claude/hooks/` (wired through `.claude/settings.json`) is the same class of object. | **High** | Architectural — confirmed by teamai-cli's own stated command surface (`hook`, `mcp`) in the primary source (§1.2) and by this repository's own hook mechanism being the same shape. | Enforce PR-level review on every push to the team repo with the same rigor as code review (the tool's own `push → review & merge → pull` model assumes this — the mitigation is enforcing the existing step, not adding a new one); treat hook/MCP diffs as high-severity regardless of how small the diff looks; restrict merge rights on the team repo. |
| R2 | Immaturity: `v0.23.0-beta.3`, created 2026-04-27, i.e. four months old at evaluation time, still on `0.x`. Breaking changes and undocumented behavior shifts between releases are plausible. | **Medium-High** | Primary source §1.1, sourced to the GitHub API (<https://github.com/Tencent/teamai-cli>, releases endpoint). | Pin an exact version rather than `npm install -g teamai-cli` unpinned; do not depend on it for anything load-bearing until a `1.x` track record exists (see §6 trigger). |
| R3 | Bus factor: one contributor (`jeff-r2026`) holds 461 commits, the next-largest 89, the rest in single digits. | **Medium** | Primary source §1.1, sourced to the GitHub API contributors endpoint (<https://github.com/Tencent/teamai-cli/graphs/contributors> shape; exact figures from `/repos/Tencent/teamai-cli/contributors`, 2026-09-08). Tencent's organizational backing partially offsets pure abandonment risk but does not remove the single-reviewer-of-record pattern. | Monitor commit/release cadence before deepening dependence; keep an explicit exit plan — `teamwiki/` and skill/rule files are plain git + markdown/YAML, so they remain usable even if the tool's development stops. |
| R4 | Tencent-hosted provider (TGit / 腾讯工蜂): the only provider in its list that is Tencent-operated infrastructure. | **Low, opt-in** | Primary source §1.2: "Only the TGit provider is Tencent-hosted infrastructure; every other provider is external" (GitHub, GitLab, GitCode, CNB, plain git). Whether TGit is the tool's *default* choice (as opposed to merely available) is **unverified** — the source research does not state a default. | Simply do not select TGit as the provider; every other listed provider requires no traffic to Tencent, per the same source. |
| R5 | Telemetry / data collection to Tencent. | **Unverified, treat as open** | Primary source §6 item 6, explicit: "The dependency list contains no analytics SDK and the providers doc shows no mandatory Tencent endpoint, but the source was not read line by line." Not resolved by this brief either — no fetch tool was available in this session. | Before adoption, read the source (or run it under network monitoring) rather than infer from the dependency list alone. |
| R6 | Governance gap: `scripts/check.sh` has no visibility into the scope teamai-cli writes to (§3.3), so this repository's existing "the runtime layout is verified" guarantee silently stops covering the developer's actual environment. | **Medium** | Direct reading of `scripts/check.sh` (zero `$HOME`/`~` references, 36 `${ROOT}`-relative checks) for this brief. | Extend `check.sh` (or a parallel script) to inspect `~/.claude/` state if adopted, or explicitly document that project- and personal-scope are unverified-by-design and accept that. |
| R7 | **Canonical-skill shadowing (now the top risk — see note below).** Claude Code's documented skill resolution order is `Enterprise > Personal > Project > Plugin > Bundled` — Personal scope (`~/.claude/skills/`, exactly where teamai-cli writes) outranks Project scope (`<repo>/.claude/skills/`, this repository's canonical skills). For any skill name teamai-cli pulls that matches one of this repository's fifteen, the Personal copy wins outright: not merged, not loaded, and whether the developer is warned is undocumented — treat it as silent. Failure mode: a developer edits and commits `<repo>/.claude/skills/foo/SKILL.md`, and it never takes effect on their own machine. This also falsifies `CLAUDE.md`'s "Native Runtime Boundary" claim that `.claude/` is the *physical source* for the runtime, on any machine that has pulled a same-named skill. | **Critical** | Official Claude Code docs, "Skill Resolution Order": <https://code.claude.com/docs/en/skills.md>. `scripts/check.sh` cannot detect this (§3.3: zero `$HOME`/`~` references, confirmed by direct read). | No existing tool in this repository detects this. Any adoption requires a new check that diffs skill names between `~/.claude/skills/` and `<repo>/.claude/skills/` and fails on collision, since `scripts/check.sh` structurally cannot (it never inspects `$HOME`). Until that check exists, treat any team-repo skill name matching this repository's catalog as an active override, not a hypothetical one. |
| R8 | Team-knowledge duplication: `teamwiki/` (teamai-cli) vs. any future irori-managed knowledge base — two independently maintained "team knowledge" surfaces with no defined relationship, and (unlike R7) no documented resolution order between them. | **Medium** | §3.2, §3.4 analysis; teamai-cli's `teamwiki/` feature (primary source §1.2). | Keep `teamwiki/` and any irori knowledge base explicitly scoped to different purposes if both exist. |

**Top risk re-ranked: R7 (canonical-skill shadowing) now outranks R1 (supply-chain injection).** Three reasons. First, R7 is unconditional — it fires on a bare name collision, no malicious or careless push required, where R1 needs an adversarial or careless act. Second, R7 is invisible to the mitigation that helps R1: reviewing the team repo carefully does not surface a shadowing collision, because the collision is only visible from *this* repository's own skill catalog, not from anything in the team repo's diff; `scripts/check.sh` has no visibility into either (§3.3), but R1 at least has ordinary PR review as a working mitigation, and R7 does not until a dedicated check exists (§4 R7 mitigation). Third, R7 falsifies a specific, documented claim in this repository's own `CLAUDE.md` ("Native Runtime Boundary" — `.claude/` as physical source), rather than being a generic risk any "pull shared config" tool would carry. R1's worst case (arbitrary code execution) still has a higher damage ceiling than R7's worst case (silently wrong behaviour, not execution or exfiltration) — but R7's near-certainty against this repository's generically named skills, and its complete invisibility to team-repo review, make it the more likely and more insidious failure in practice. Both remain live risks; neither is dismissed by the other.

---

## 5. Alternatives

Honest comparison — "do nothing" is evaluated as a real option, not a strawman, since §2
found no evidenced need yet.

| Option | Pros | Cons |
|---|---|---|
| **Adopt teamai-cli** | Purpose-built for cross-repo skill/rule/hook sync; active project; `push → review & merge → pull` already assumes a review gate. | All of §4; writes to a scope (`~/.claude/`) this repository's own tooling cannot see or verify (§3.3); introduces a second source of truth for any overlapping skill name (§3.4). |
| **Plain git submodule of a shared `.claude/`** | No new dependency or tool to learn; this repository already demonstrates the underlying pattern (project-scoped, git-tracked `.claude/`); review happens through the submodule repo's normal PR flow; fully offline-capable; no home-directory mutation, so `scripts/check.sh`'s existing coverage is unaffected in kind (it would need to learn about the submodule path, but the *scope* stays project-relative, which the script already understands). | Submodules are easy to forget to update (`git submodule update --remote` is a manual, rememberable step — the exact class of problem teamai-cli's `pull` step is designed around); still project-scoped, so it does not address a developer's *cross-repo* personal skill need any better than the status quo; if the submodule path is not literally `.claude/`, something still has to place its content there, reintroducing `check.sh`'s existing "no symlinks" constraint. |
| **Private npm package** | Versioned and pinned exactly like this repository's own dependencies (`package-lock.json` is already authoritative per `.claude/rules/dev-environment.md`); reuses tooling already in use (npm) instead of adding a new CLI; release review follows the normal package-publish process. | Someone still has to write and maintain the glue that places package contents into `.claude/` (or `~/.claude/`) with correct permissions/references — exactly the part teamai-cli already built and maintains; a private registry (or gated scoped org) is itself infrastructure to run, pay for, and secure. |
| **Do nothing (status quo)** | Zero new dependency, zero new attack surface, zero new home-directory mutation; already works today; is the exact mechanism `scripts/check.sh` was written to verify, so no migration or coverage-gap risk at all; §2 found no evidenced need it fails to meet *today*. | Does not solve a genuine cross-repository sharing need if/when one appears (§2's second trigger); until then, sharing config with a hypothetical second repository means manual copy-paste with no reconciliation tooling. |

---

## 6. Decision Criteria

**Adopt when all of the following hold:**

1. A real, observed instance of the problem exists — either a second contributor's independently
   configured `~/.claude/skills/` has actually drifted and conflicted with this repository's
   committed skills, or a second repository now needs the same skills/rules/hooks as this one
   (§2's two triggers).
2. The team can commit to reviewing every push to the shared team repo with the same rigor as a
   code PR, specifically for hooks and MCP definitions (R1).
3. teamai-cli has shipped a stable `1.x` release, or has an extended multi-month `0.x` track
   record with no breaking changes (R2) — i.e. the beta-instability risk has visibly retired.
4. Either `scripts/check.sh` (or an equivalent) has been extended to cover the `~/.claude/` state
   teamai-cli introduces, or the team has explicitly decided and documented that project-scope and
   personal-scope are deliberately unverified-by-CI (R6).
5. A collision-detection check exists and has been run clean against the intended team repo's
   skill names, compared against this repository's fifteen (`context-loader`, `init`,
   `design-tracker`, `checkpointing`, `catchup`, `feature`, `plan`, `tdd`, `team-execute`,
   `troubleshoot`, `simplify`, `spike`, `research-lib`, `update-lib-docs`, `codex-system`) —
   before every pull, not once at adoption time. A name match is now a confirmed, silent
   override of this repository's own skill (§3.2, §3.4, §4 R7), not a negotiable precedence to
   resolve, so "checked and accepted" is not a substitute for the check existing.
   `scripts/check.sh` cannot perform it (§3.3); a new script is required (§4 R7 mitigation).

**Do not adopt (or defer) when:**

- The only motivation is that the tool looks useful, with no observed drift or second-repository
  need (§2's evidentiary gap is still open).
- The team cannot commit to code-level review discipline on the shared team repo (R1 unmitigated).
- The project remains single-repository with config needs fully met by the current project-scoped,
  git-tracked `.claude/` (i.e. the status quo already works, per §5's "do nothing" row).
- No collision-detection check exists yet (§6 criterion 5), and the team is unwilling to build
  one before the first pull — adopting anyway means adopting into a confirmed, silent
  shadowing hazard (§4 R7) with no way to see it happen.

---

## 7. Recommendation

**Recommendation (labelled as such, not a decision): do not adopt teamai-cli now — and the
skill-precedence fact strengthens this conclusion rather than changing it.** Keep `.claude/`,
`.agents/`, and `.codex/` project-scoped and git-tracked, exactly as `CLAUDE.md`'s "Native
Runtime Boundary" and `scripts/check.sh` already establish. The evidence in §2 (a single-author
repository, no observed configuration drift, and a status quo that already provides a
*stronger* consistency guarantee than teamai-cli's own distribution model) was already
sufficient on its own to fail §6's adoption criteria. What §3.2, §3.4, and §4 R7 add is a
confirmed, concrete cost of adopting anyway: teamai-cli writes into exactly the scope
(`~/.claude/skills/`) that Claude Code's own resolution order favors over this repository's
own `<repo>/.claude/skills/`, so any name collision silently and permanently overrides this
repository's canonical skill on the affected developer's machine, with no warning and no
existing check to catch it. That is a reason to be *more* cautious, not less.

**Trigger that would reverse this recommendation:** the moment a second repository needs to share
this repository's `.claude/` skills/rules/hooks, or a second, independently-configured developer
starts working in *this* repository and actual drift is observed (§2, §6 criterion 1) — **and**
the collision-detection check required by §6 criterion 5 exists and has been run clean against
the intended team repo first. Clearing only the first condition is no longer sufficient:
adopting before that check exists means adopting into a confirmed, silent shadowing hazard
(§4 R7) on day one, not merely a hypothetical one. At that point, re-run this evaluation against
§5's alternatives with a concrete second repository in hand, rather than a hypothetical one —
the comparison in §5 changes once there is a real second consumer to weigh against.

---

## Sources

- `docs/research/drive-mount-and-team-cli-2026-09.md` — primary research; all teamai-cli
  facts in §1 and the base rows of §4 are carried forward from its §1 and its Appendix source
  index, verified there via the GitHub API and the project's own repository files on 2026-09-08.
- <https://code.claude.com/docs/en/skills.md> — official Claude Code docs, "Skill Resolution
  Order" (`Enterprise > Personal > Project > Plugin > Bundled`); basis for §3.2, §3.4, §4 R7.
- <https://github.com/Tencent/teamai-cli> — repository (description, stars, license, activity).
- <https://github.com/Tencent/teamai-cli/blob/main/README.md> — distribution model, command
  surface, `teamwiki/`.
- <https://raw.githubusercontent.com/Tencent/teamai-cli/main/LICENSE> — MIT license text.
- `docs/providers.md` (in `Tencent/teamai-cli`, per the primary source's citation) — provider list
  (GitHub, GitLab, GitCode, CNB, plain git, TGit) and which is Tencent-hosted.
- This repository: `CLAUDE.md` ("Native Runtime Boundary", "Skill Catalog"), `scripts/check.sh`
  (read in full for §3.3), `git log` / `git status --porcelain` (single-author evidence, §2).

---

## 8. Reassessment, 2026-09-21

The owner asked whether teamai-cli's usefulness for irori had changed. It has
not, but the reasons are no longer the ones §7 gave, and two of them have been
answered by other means.

### The reversal triggers

§7 named two: a second repository, and drift observed with a second developer.

**The first fired on paper and was answered by a different solution.** There are
now three repositories plus a template. But on 2026-09-14 shared agent
configuration moved out of every repository and into the `KB_design` workspace
root, where `.agents/skills` is a symlink to the canonical `.claude/skills` and
`scripts/check_agent_config.py` enforces that. One copy exists, not three.
Adopting teamai would replace that single copy with a distribution to
`.claude/skills`, `.codex/skills`, `.opencode/skills` and so on in each
repository — precisely the duplication `irori-templete`'s ADR 001 D9 rejected,
and precisely what the 2026-09-14 migration removed.

**The second has not fired.** All three repositories still carry commits from
one author.

**The stated precondition is still unmet.** §7 required a check for name
collisions between `~/.claude/skills/` and `<repo>/.claude/skills/` before
adoption. teamai-cli still does not provide one: its guide states that
same-named user and project resources both remain in place and "the AI tool
decides runtime precedence". The nearest facilities are `teamai skill show` and
`teamai list skills --source all`.

### What changed in the tool

teamai-cli is materially more mature than at the 2026-09-08 evaluation: v0.24.0
stable and v0.25.0-beta.3, around 100 commits in the ten days to 2026-09-20,
4,840 stars, 55 contributors (though the top five still hold 87% of commits),
and CI running typecheck plus coverage across an OS/Node matrix. `--scope
project` is now the default, which substantially weakens the R7 risk this
document rated Critical — writes no longer land in `~/.claude/skills/` by
default. The LICENSE is MIT despite GitHub reporting `NOASSERTION`, which is an
artefact of Tencent's preamble.

### The decision

**Unchanged: do not adopt, for this workspace or for `irori-templete`.** The
duplication argument now decides it on its own, independently of the risks §4
listed. For irori as a product the answer is firmer still: teamai's project
scope writes CLI configuration directories into the repository it targets, which
is exactly what `irori/docs/SKILLS.md` guarantees irori never does and what
`tests/harnesses.test.ts` and `scripts/real-agents.ts` assert by comparing the
schema layer's hashes before and after a turn. Its defaults — self-updating
through a Stop hook, committing session statistics to the team repository —
also do not suit a note application whose users are not necessarily engineers.
Pi, one of irori's four harnesses, is unsupported: teamai's `omp` target is
Oh My Pi, a different package from the `@earendil-works/pi-coding-agent` irori
launches.

### Ideas worth taking without the tool

1. **A `teamai doctor`-style check that declared resources actually reached each
   harness.** irori's skill picker already names a package it cannot read; the
   step beyond is verifying that what a KB declares is what each CLI would
   resolve.
2. **Tombstones for deletion.** A removed skill currently just stops being
   listed; a record of the removal propagates the intent.
3. **Role and project namespaces for distribution scope.** `irori/docs/SKILLS.md`
   records a flat list as a known limitation; roles × projects is a shape worth
   borrowing if that limitation starts to bite.

### Two findings this reassessment surfaced

- **`.agents/skills/` is the convergent location, and now for a better reason
  than this document originally had.** Pi's own documentation lists
  `~/.agents/skills/` and `.agents/skills/` among its native search paths under
  the Agent Skills convention, and teamai itself recognises `.agents/skills` as
  "Central (Agent Skills)". `irori/docs/SKILLS.md` had justified the choice
  partly by claiming claudian used the directory; it does not, and that
  correction is being made in irori separately.
- **The `KB_design` workspace root is not under version control.** `AGENTS.md`,
  `.claude/`, `.codex/` and `scripts/` belong to no Git repository, so the
  shared configuration that the 2026-09-14 migration consolidated has no
  history, no review and no backup. That is a real gap, but it is answered by
  `git init` or a small private repository — not by a distribution tool.
