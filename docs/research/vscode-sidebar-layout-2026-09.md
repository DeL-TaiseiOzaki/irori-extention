# VS Code Sidebar Layout — Can the Two-Column irori Mockup Be Built?

> **Investigated:** 2026-09-08 · **Host baseline:** VS Code stable ≈ 1.136
> (`@types/vscode@1.136.0` published 2026-09-02; the copy installed in this
> repo is `1.134.0`, published 2026-08-19, resolved from the declared
> `"@types/vscode": "^1.105.0"`).
> **Repo target:** `engines.vscode` `^1.105.0` (VS Code 1.105, released 2025-10-09).
> **Scope:** investigation only. No source file, `package.json`, or workflow was modified.

---

## 1. Verdict

**The mockup cannot be built as drawn.** A VS Code view container lays its views
out in exactly one dimension, chosen by *where the container lives*, and the
choice is made by the workbench — not by the extension, and not by any
contribution point. In a sidebar the orientation is hard-coded to vertical. There
is no grid layout for views anywhere in the workbench, so "row 1 full width, then
a 2×2 grid" has no expressible form.

The decisive code is `ViewPaneContainer`'s orientation getter
(`src/vs/workbench/browser/parts/views/viewPaneContainer.ts`, microsoft/vscode
`main`, read 2026-09-08):

```ts
private get orientation(): Orientation {
    switch (this.viewDescriptorService.getViewContainerLocation(this.viewContainer)) {
        case ViewContainerLocation.Sidebar:
        case ViewContainerLocation.AuxiliaryBar:
            return Orientation.VERTICAL;
        case ViewContainerLocation.Panel: {
            return isHorizontal(this.layoutService.getPanelPosition()) ? Orientation.HORIZONTAL : Orientation.VERTICAL;
        }
    }

    return Orientation.VERTICAL;
}
```

with `isHorizontal` in
`src/vs/workbench/services/layout/browser/layoutService.ts`:

```ts
export function isHorizontal(position: Position): boolean {
	return position === Position.BOTTOM || position === Position.TOP;
}
```

Read this as a three-line law:

| Container location | View layout | Who decides |
|---|---|---|
| Primary Side Bar (`activitybar`) | **Vertical stack, always** | Workbench. Not configurable. |
| Secondary Side Bar (`secondarySidebar`) | **Vertical stack, always** | Workbench. Not configurable. |
| Panel (`panel`) | **Single horizontal row** when the panel is docked bottom or top; vertical when the user docks it left or right | Workbench, following the *user's* panel position |

`Orientation` is a two-valued enum consumed by a `PaneView`. There is no third
value, no wrap, and no row/column count. **A grid is not "hard" — it is
unrepresentable.**

---

## 2. The Four Questions, Answered

### Q1 — Can `contributes.views` / `viewsContainers` lay views out in columns?

**No.** The full JSON schema for both contribution points lives in
`src/vs/workbench/api/browser/viewsExtensionPoint.ts`. The complete set of
properties on a view descriptor is:

`type` · `id` · `name` · `when` · `icon` · `contextualTitle` · `visibility` ·
`initialSize` · `accessibilityHelpContent`

(plus `remoteName` on the separate remote descriptor, and `agentSessions`, both
gated by proposed APIs). Nothing in that list expresses position, column,
row, or span. The two that sound like layout are not:

- `visibility` — `"visible" | "hidden" | "collapsed"`, and only as an *initial*
  state: *"Initial state of the view when the extension is first installed. Once
  the user has changed the view state by collapsing, moving, or hiding the view,
  the initial state will not be used again."*
- `initialSize` — *"The initial size of the view. The size will behave like the
  css 'flex' property, and will set the initial size when the view is first
  shown. **In the side bar, this is the height of the view.** This value is only
  respected when the same extension owns both the view and the view container."*

`initialSize` is the closest thing to layout control the API offers, and the
schema's own description says that in a side bar it controls **height**. It is a
flex weight along the container's single axis — it cannot start a second column.

The container schema accepts exactly three location keys:

```ts
export const viewsContainersContribution: IJSONSchema = {
	type: 'object',
	properties: {
		'activitybar': { /* "Contribute views containers to Activity Bar" */ },
		'panel':       { /* "Contribute views containers to Panel" */ },
		'secondarySidebar': { /* "Contribute views containers to Secondary Side Bar" */ }
	},
	additionalProperties: false
};
```

`additionalProperties: false` — there is no fourth location and no escape hatch.

> **Documentation lag, flagged.** The public page
> <https://code.visualstudio.com/api/references/contribution-points> still says
> under `contributes.viewsContainers`: *"At present, you can contribute them to
> the Activity Bar (`activitybar`) and Panel (`panel`)."* That sentence is
> **stale as of 2026-09-08** — see Q-Secondary below. Prefer the source schema
> over the prose page for this contribution point.

### Q2 — Can the *user* drag views side by side manually?

**Partly — and never into columns inside one sidebar.**

What a user genuinely can do (VS Code docs, *Custom Layout*,
<https://code.visualstudio.com/docs/configure/custom-layout>):

- *"At any time, you can drag and drop views and panels into the Primary or
  Secondary Side Bar. VS Code will remember the layout of views and panels
  across your sessions."*
- *"You can drag and drop views and panels between these regions"* (Primary Side
  Bar ↔ Panel), and *"you can also add views and panels to existing view or
  panel to create groups."*
- *"You can also customize layouts via the keyboard with the **View: Move View**
  and **View: Move Focused View** commands."*

So the reachable horizontal arrangements are exactly two:

1. **Primary Side Bar | editor | Secondary Side Bar** — two vertical stacks
   separated by the editor. The Secondary Side Bar is *"always positioned
   opposite the Primary Side Bar, regardless if you switched the position of the
   Primary Side Bar"*, so the two columns are **never adjacent**.
2. **A bottom/top Panel** — a genuine single row of adjacent panes, below the
   editor rather than in the sidebar.

Dragging a view *within* one sidebar only reorders the vertical stack; the drop
overlay is constructed from `this.orientation ?? Orientation.VERTICAL` in
`viewPaneContainer.ts`, i.e. the drop targets are the vertical ones.

**Can an extension set this up programmatically? No.** `workbench.action.moveView`
and `workbench.action.moveFocusedView` are both `Action2`s in
`src/vs/workbench/browser/actions/layoutActions.ts` that terminate in a
`quickInputService.createQuickPick(...)` with placeholder *"Select a Destination
for the View"*. `moveFocusedView` accepts an optional `viewId` argument (so the
*source* can be pre-selected), but the **destination is always chosen by the
user**. There is no `moveViews` command and no destination parameter. Nothing in
`node_modules/@types/vscode/index.d.ts` exposes view placement, part sizing, or
sidebar width; the only sidebar mentions in the whole 21,240-line file are two
prose comments inside `WebviewView`'s doc block about the user switching views.
`workbench.action.increaseViewWidth` exists but is a fixed-step nudge on the
focused part, not a setter.

**An extension can therefore only pick a *default* location (via
`viewsContainers`) and suggest the rest.** Any two-column arrangement the user
reaches by dragging is theirs to keep or undo, and `View: Reset View Locations`
throws it away.

### Q3 — Does a `WebviewView` change the answer?

**Yes for pixels, no for the surrounding structure — and it is the only option
that renders the mockup faithfully.**

A view may declare `"type": "webview"`; the schema's own wording:

> *"Type of the view. This can either be `tree` for a tree view based view or
> `webview` for a webview based view. The default is `tree`."* — with
> `webview` described as *"The view is backed by a `WebviewView` registered by
> `registerWebviewViewProvider`."*

`window.registerWebviewViewProvider(viewId, provider, options?)` is stable in the
installed `@types/vscode`, and a `WebviewView` exposes `title`, `description`,
`badge`, and a full `Webview`. Inside that one pane, arbitrary HTML — including
`display: grid` with `grid-column: span 2` for the Schema row — renders exactly
as drawn.

The constraint is unchanged at the level above: **the webview is still one pane
in a vertical stack**. So the viable form is *one* webview holding all five
panes, not five webviews arranged in a grid.

What one full-sidebar webview costs, concretely:

| Lost | Why |
|---|---|
| Native tree behaviour | `TreeView` list virtualization, type-ahead find, expand/collapse state persistence, `showCollapseAll` — all must be re-implemented in the webview |
| `TreeView.reveal(...)` | The `TreeView<T>` interface's `reveal` (*"Reveals the given element in the tree view. If the tree view is not visible then the tree view is shown and element is revealed."*) has no webview equivalent |
| Native drag & drop | `TreeViewOptions.dragAndDropController?: TreeDragAndDropController<T>` is a tree-only option; dragging a file from a webview into an editor group is not supported |
| `view/item/context` menus | Right-click inside a webview goes to `webview/context`, a coarser surface than `viewItem == …` matching |
| `viewsWelcome` | The repo's 9 `viewsWelcome` entries (empty-workspace prompt, "Configure Layers" link) apply to tree views only |
| Accessibility | The tree `role`, `aria-level`/`aria-expanded`, and screen-reader semantics must be hand-authored; the tree renderer already does this (`treeView.ts` explicitly *"Associate the inline toolbar with the tree item so screen readers…"*) |
| Keyboard navigation | Arrow/Home/End/type-ahead is free in a tree, hand-rolled in a webview |
| Performance | The reference vault in `DESIGN.md` is **15,118 files**. A `TreeView` fetches children lazily through `TreeDataProvider`; a webview needs its own virtualization or it will choke |
| Cheap layer decoration | Badge/colour per row currently comes free from the layer definition through the tree renderer |

Explicitly **not** lost:

- **Theming.** The webview gets `--vscode-*` CSS variables and theme-change
  events, so it can match the active theme — at the cost of writing the CSS.
- **Explorer decorations.** `src/explorerDecorations.ts` uses
  `FileDecorationProvider`, which decorates the *standard* explorer. It is
  independent of how irori renders its own panes and survives either choice.
- **Reveal in explorer.** `irori.revealInExplorer` is a command; a webview can
  fire it via `postMessage` → `executeCommand`.
- **The view badge.** `WebviewView.badge?: ViewBadge | undefined` matches
  `TreeView.badge`.

VS Code's own UX guidance pushes the other way:
<https://code.visualstudio.com/api/ux-guidelines/views> says *"Limit the use of
custom Webview Views"*.

### Q4 — Does any extension achieve a genuine multi-column sidebar?

**No, and the honest reason is that the API does not permit it.**

The canonical request, microsoft/vscode#26777 *"Allow multiple views to show at
the same time"* (opened 2017-05-16, **1,168 reactions**, 111 comments), was
**closed on 2022-04-12** — resolved by the Secondary Side Bar (a second vertical
stack on the opposite side) and by drag-and-drop between regions, *not* by
columns inside one sidebar. The related microsoft/vscode#106254 *"More flexible
layout (split sidebars etc)"* was closed within two hours of being filed
(2020-09-07).

Extensions with heavy sidebar UI converge on one of the shapes ranked in §5 —
one webview view (GitLens, Copilot Chat, Continue and similar all render one
webview per pane, stacked), or several stacked tree views. None produce columns,
because `Orientation` has no value that would let them.

---

## 3. The `+` Per Named Group — What the User Actually Gets

In the mockup, `Engineering KB` carries its own always-visible `+`, at the same
visual weight as the panel header's `+`. **Native tree views cannot reproduce
that.** They produce something visibly different in two ways.

**Where the actions come from.** `TreeItem.contextValue`'s own doc block in
`node_modules/@types/vscode/index.d.ts` shows the only mechanism:

```
 * For example, a tree item is given a context value as `folder`. When contributing actions to `view/item/context`
 * using `menus` extension point, you can specify context value for key `viewItem` in `when` expression like `viewItem == folder`.
```

The tree renderer resolves the toolbar for a row from that menu, selecting the
`inline` group as the primary actions
(`src/vs/workbench/browser/parts/views/treeView.ts`):

```ts
const result = getContextMenuActions(menuData, 'inline');
```

**Difference 1 — the `+` is hidden until you hover.** The stylesheet
`src/vs/workbench/browser/parts/views/media/views.css` sets:

```css
.customview-tree .monaco-list .monaco-list-row .custom-view-tree-node-item .actions {
	display: none;
}

.customview-tree .monaco-list .monaco-list-row:hover .custom-view-tree-node-item .actions,
.customview-tree .monaco-list .monaco-list-row.selected .custom-view-tree-node-item .actions,
.customview-tree .monaco-list .monaco-list-row.focused .custom-view-tree-node-item .actions {
	display: block;
}
```

So a row's inline `+` appears only on **hover, focus, or selection**. A mockup
screenshot showing three `+` buttons simultaneously visible on three collapsed
group rows is not a state the tree renderer produces — at most one row is
hovered or focused at a time.

**Difference 2 — a group row is a list row, not a header.** `Engineering KB` in a
tree is a `TreeItem` inside the pane's list: same row height, same indentation
grid, same font as its children. The mockup draws it as a section header with its
own chrome. Real view headers — the ones that *do* carry persistent `+` and `…`
buttons — come from the `view/title` menu, contributed with `"when": "view ==
<viewId>"` and `"group": "navigation"`; the contribution-points page's own
example captions the result as *"an action in the panel when the terminal is
open"*, and states the group convention on the sibling `editor/title` menu:
*"`navigation` and `1_run` are shown in the primary editor title area. The other
groups are shown in the secondary area - under the `...` menu."* There is exactly
**one** such header per registered view.

**Net:** panel-level `+` / `…` are faithful and free. Group-level `+` is
achievable in function but not in appearance — it becomes a hover-revealed inline
icon on an ordinary tree row. Only a webview reproduces the drawn appearance.

---

## 4. Slot Budget — Is 8 a Real Constraint Here?

**Under the mockup as described: no.**

`src/extension.ts` declares:

```ts
/** package.json に静的に宣言してあるビュー枠の数（レイヤー数の上限） */
export const SLOT_COUNT = 8;
```

and the reason, in the same file: *"レイヤーごとに独立したパネル．ビューは動的に追加できないため，一定数の枠を用意して設定に応じてタイトルと表示/非表示を切り替える．"*
`DESIGN.md` records the same constraint: *"VS Code declares views in
`package.json` `contributes` and cannot register them dynamically."* That is
correct and still true — nothing in `index.d.ts` registers a view at runtime;
`createTreeView(viewId, …)` binds a provider to an **already-declared** id.

The mockup nests `Engineering KB` / `Research KB` / `Product KB` **inside** the
Team panels as collapsible groups. That is the fixed-5 reading, and it is the
correct one:

- 5 panels ≤ 8 slots, with 3 spare.
- Scopes are **`TreeItem`s**, not views. `N` scopes cost zero slots.
- Adding a 9th team scope adds a tree node, not a view.

**The 8-slot ceiling only becomes live under the other reading** — one registered
view per (scope × layer) cell. That is what
`docs/plans/multi-drive-contents-2026-09.md` already warns about:

> *"The eight-slot `package.json` view limit becomes a live constraint once
> scopes × layers are shown separately — 3 layers × 3 scope roots does not fit in
> 8 slots."*

Both statements are true and they are not in conflict: 3 × 3 = 9 > 8 for the
one-view-per-cell design; the mockup is not that design. **Rendering scopes as
tree nodes rather than views is what dissolves the ceiling** — and it is the only
approach that scales to an unbounded number of team scopes, because static
declaration cannot.

One caveat worth recording: raising `SLOT_COUNT` is cheap (more `package.json`
entries) but not free — every slot is an eagerly created `TreeView` in
`activate()`, each with a `viewsWelcome` entry, and the empty ones show up in the
view-container's "hide/show views" context menu as `Layer 6`, `Layer 7`, `Layer 8`.

---

## 5. Alternatives, Ranked

Ranked by **how well the arrangement preserves the meaning of the model**
(scope resolved first, layer second — see
`docs/plans/multi-drive-contents-2026-09.md` §"A declared scope root owns
classification of everything beneath it"), then scalability, then visual
resemblance to the mockup.

### 1. One scope-major `TreeView` — `scope → layer → contents`

```
My Knowledge Base
  Schema · Knowledge Base · Contents
Engineering
  Schema · Knowledge Base · Contents
Research
  …
```

- **Gives:** exactly the model's resolution order; real scope identity instead of
  a "My/Team" proxy; unbounded `N` (scopes are nodes); all native tree behaviour,
  `reveal`, DnD, accessibility, `viewsWelcome`, context menus; **1 slot**.
- **Costs:** the matrix is no longer visible at a glance — a user expands a scope
  to see its three layers; no per-region view headers; scope-row `+` is
  hover-revealed. Zero resemblance to the mockup.

### 2. One full-sidebar `WebviewView` rendering the `1 + 2×2` CSS grid

- **Gives:** the mockup, faithfully — the grid, the independently collapsible
  named groups, permanently visible `+` on every group; unbounded `N` inside one
  registered view; **1 slot**.
- **Costs:** everything in the Q3 table — native tree, `reveal`, DnD,
  `view/item/context`, `viewsWelcome`, accessibility, keyboard nav, and
  virtualization on a 15,118-file vault, all re-implemented by hand. It also
  *teaches a wrong model*: a full-width Schema row implies Schema is global, and
  "My | Team" columns imply ownership is the scope axis when the real axis is the
  individual scope root.

### 3. Three stacked `TreeView`s — one per layer, scopes nested inside each

- **Gives:** the three-layer vocabulary without inventing "My/Team" pseudo-layers;
  every (scope, layer) cell reachable; unbounded `N`; native everything;
  **3 slots**; a small, honest change from today's code.
- **Costs:** it transposes the model — the user picks a *layer* before a *scope*,
  the reverse of how classification resolves; each scope is split across three
  panels instead of owning its three layers.

### 4. Primary Side Bar (personal) + Secondary Side Bar (team) — two real columns

- **Gives:** two genuine vertical columns, natively, declared by the extension
  itself (see §6); native tree views and headers; strong personal/team separation.
- **Costs:** the columns are **separated by the editor**, never adjacent; the
  full-width Schema row cannot span them (it must be duplicated or assigned to one
  side); "personal vs team" is a presentation category, not the scope axis, so
  Engineering / Research / Product still nest below it; the user must keep both
  sidebars open and both containers selected, and the extension cannot enforce
  that; **it raises the required `engines.vscode` floor from `^1.105.0` to
  `^1.106.0`**.

### 5. A `panel`-located view container — a true horizontal row

- **Gives:** the only place in the workbench where views are genuinely side by
  side (`Orientation.HORIZONTAL`), natively, with real view headers carrying
  persistent `+` / `…` from `view/title`.
- **Costs:** one row, never a grid; it leaves the sidebar the mockup asks for;
  the orientation **silently flips to vertical** if the user docks the panel left
  or right, and the extension cannot prevent that; the per-scope variant reaches
  the slot ceiling at 9 scopes, and the per-layer variant is just option 3 rotated.

### 6. Five stacked `TreeView`s — Schema / My KB / Team KB / My Contents / Team Contents

- **Gives:** the mockup's five named regions with five real headers and five real
  `+` / `…` toolbars; native everything; unbounded `N` as nested nodes;
  **5 of 8 slots**; the smallest delta from the current code.
- **Costs:** it encodes `layer → ownership → scope`, the furthest of all options
  from scope-first; the same scope appears twice (under KB and under Contents);
  it promotes "My/Team" to a structural axis it is not; and without the columns
  it reads as five unrelated lists — the mockup's whole point, the visible 2-D
  matrix, is exactly what is dropped.

---

## 6. The Secondary Side Bar, Evaluated Properly

**A single extension can place view containers in the Primary Side Bar, the
Panel, and the Secondary Side Bar simultaneously** — `viewsContainers` is an
object whose three keys are independent arrays, and
`addCustomViewContainers` in `viewsExtensionPoint.ts` maintains a separate order
counter per location and registers each:

```ts
case 'activitybar':      … ViewContainerLocation.Sidebar);      break;
case 'panel':            … ViewContainerLocation.Panel);        break;
case 'secondarySidebar': … ViewContainerLocation.AuxiliaryBar); break;
```

Two facts that decide how usable this is:

**It is stable, not proposed.** `viewsExtensionPoint.ts` calls
`isProposedApiEnabled` exactly three times — for `remote`
(`contribViewsRemote`), `agentSessions` (`chatSessionsProvider`), and
`accessibilityHelpContent` (`contribAccessibilityHelpContent`). **Not** for
`secondarySidebar`. And `vscode.proposed.contribSecondarySideBar.d.ts` no longer
exists in `src/vscode-dts/` on `main`.

**It was finalized in VS Code 1.106.** The v1.104 release notes (August 2025
milestone) said: *"Extensions can contribute view containers to the `activitybar`
and `panel`. We have now added support for contributing to the `secondarySidebar`
as well. This is currently behind the `contribSecondarySideBar` proposed API. We
are hoping to finalize this API soon."* The v1.106 notes then said: *"Extension
authors can now register view containers in the Secondary Side Bar by using the
new `secondarySidebar` contribution point."* `@types/vscode@1.106.0` was
published **2025-11-12**.

> **Cost, stated plainly:** using it means `engines.vscode` must move from
> `^1.105.0` to `^1.106.0`, dropping VS Code 1.105 users. Note the spelling:
> the contribution key is `secondarySidebar` (lowercase `b`), even though the
> proposal flag was `contribSecondarySideBar`.

**What the extension still cannot do:** move an existing view there at runtime
(Q2 — QuickPick only), guarantee the Secondary Side Bar is open (the user's
`workbench.secondarySideBar.defaultVisibility` setting governs it), guarantee the
right container is the selected one in either bar, or prevent `View: Reset View
Locations` from undoing everything.

**Assessment:** this is the closest *native* thing to two columns, and it is
worth knowing it exists — but it is not the mockup. The mockup's two columns are
adjacent and share a full-width header row above them; the Secondary Side Bar's
column sits on the far side of the editor and cannot be spanned. It buys
horizontal separation at the price of an engine bump, a fragile multi-part layout
the user must maintain, and a "My vs Team" split that is a presentation category
rather than the model's actual scope axis.

---

## 7. Codex Consult

**Ran successfully** (the previously observed `bwrap: No permissions to create a
new namespace` failure did not occur):
`python3 .claude/skills/_shared/codex_consult.py --prompt-file .claude/logs/codex/prompt-sidebar-layout.md --label sidebar-layout --caller general-purpose-opus --sandbox read-only`
→ `{"ok": true, "exit_code": 0, "model": "gpt-5.6-sol", "duration_sec": 278.1}`,
read-only, zero files changed.

- Prompt: `.claude/logs/codex/20260908T063914Z-sidebar-layout.prompt.md`
- Response: `.claude/logs/codex/20260908T063914Z-sidebar-layout.md`

Codex was given the verified API facts as ground truth and asked only the design
question. Its ranking matches §5 above (it independently produced the same order
and the same top choice). Its three load-bearing judgements:

1. **Scope-major is the correct primary axis.** *"The semantic hierarchy should be
   `scope root → layer → path/item`. That follows the classification algorithm
   directly."* Layer-major is a legitimate alternate **projection**, not the
   primary representation.
2. **"Personal" and "Team" must not replace the scope axis.** They may be optional
   grouping labels *above* real scopes, but `Engineering`, `Research`, `Product`
   and the personal root are the meaningful nodes. This is the specific way the
   mockup's 2-column split misrepresents the model.
3. **The mockup does not exceed 8 slots** — it implies five fixed panels with
   scopes nested inside, and the one-view-per-scope reading *"would be incorrect
   and unscalable."* Independent agreement with §4.

Its stated risk against its own recommendation: *"A Webview grid would look
closer, but risks teaching the wrong model — especially that Schema is global and
'My/Team' are the actual scope dimension."*

---

## 8. Recommendation

**Option 1 — one scope-major `TreeView` (`scope → layer → contents`) — with
option 3 as the pragmatic step if a smaller change is wanted.**

The single reason: the mockup's grid is an attempt to *draw* a 2-D matrix that
VS Code cannot draw, and every arrangement that gets closest to the picture
(options 2, 4, 6) gets there by promoting "My vs Team" to a structural axis it
is not — so it buys visual fidelity by teaching a wrong model. A scope-major tree
gives up the picture and keeps the meaning, and it is the only option where an
unbounded number of team scopes costs nothing.

If the user's requirement is the *picture* rather than the model, option 2 (one
webview) is the only faithful answer, and the Q3 table is the invoice.

**Do not** ship option 4 or 5 as the default. Both require the user to maintain a
layout the extension cannot establish or enforce, and both are one
`View: Reset View Locations` away from being undone.

---

## 9. Sources

**VS Code source** (github.com/microsoft/vscode, branch `main`, read 2026-09-08):

- `src/vs/workbench/browser/parts/views/viewPaneContainer.ts` — `orientation` getter (the decisive fact)
- `src/vs/workbench/services/layout/browser/layoutService.ts` — `isHorizontal`
- `src/vs/workbench/api/browser/viewsExtensionPoint.ts` — `viewsContainersContribution`, `viewDescriptor` schema, `addCustomViewContainers`, the three `isProposedApiEnabled` gates
- `src/vs/workbench/browser/actions/layoutActions.ts` — `workbench.action.moveView`, `MoveFocusedViewAction`, `IncreaseViewSizeAction`
- `src/vs/workbench/browser/parts/views/treeView.ts` — `getContextMenuActions(menuData, 'inline')`
- `src/vs/workbench/browser/parts/views/media/views.css` — hover/focus reveal of row actions

**Type definitions in this repo** — `node_modules/@types/vscode/index.d.ts` (v1.134.0):
`TreeView<T>` (`reveal`, `badge`, `title`), `TreeViewOptions<T>`
(`dragAndDropController`, `showCollapseAll`), `TreeItem.contextValue`,
`WebviewView`, `WebviewViewProvider`, `window.registerWebviewViewProvider`.

**Documentation:**

- <https://code.visualstudio.com/api/references/contribution-points> — `contributes.views`, `contributes.viewsContainers` (**stale** on locations), `contributes.menus` groups
- <https://code.visualstudio.com/docs/configure/custom-layout> — Secondary Side Bar, drag-and-drop of views, `View: Move View`
- <https://code.visualstudio.com/api/ux-guidelines/views> — *"Limit the use of custom Webview Views"*; views draggable to the Secondary Sidebar
- VS Code release notes v1.104 (proposed) and v1.106 (finalized) — `secondarySidebar`

**Issues:**

- <https://github.com/microsoft/vscode/issues/26777> — *Allow multiple views to show at the same time*; 1,168 reactions; closed 2022-04-12
- <https://github.com/microsoft/vscode/issues/106254> — *More flexible layout (split sidebars etc)*; closed 2020-09-07
- <https://github.com/microsoft/vscode/issues/264346> — *Test: Extensions can register views in secondary sidebar*; August 2025 milestone
- <https://github.com/microsoft/vscode/issues/151681>, <https://github.com/microsoft/vscode/issues/198087> — the requests that led to it

**Repo inputs:** `package.json` (`contributes.viewsContainers`, 8 `views` slots,
9 `viewsWelcome` entries), `src/extension.ts` (`SLOT_COUNT = 8`),
`src/explorerDecorations.ts`, `docs/DESIGN.md` (view-surface constraint;
15,118-file reference vault), `docs/plans/multi-drive-contents-2026-09.md`
(scope-root model; the 3×3-does-not-fit-in-8 warning).

**Dates to re-check** — VS Code ships roughly monthly (1.134.0 → 2026-08-19,
1.136.0 → 2026-09-02). The `Orientation` law in §1 has held since view containers
existed and is structural, so it is the least likely to change. The
`secondarySidebar` finalization (1.106) and the stale documentation page are the
two most likely to move.
