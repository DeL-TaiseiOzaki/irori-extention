# PROGRESS

> Historical checkpoint summaries, newest first. Original detailed checkpoints
> were local files under `.claude/checkpoints/` and are absent from this checkout.
> New local checkpoints belong in `.local/agents/checkpoints/` (git-ignored).
> Shared runtime paths in the summaries describe the recorded sessions; current
> ownership is defined in [AGENTS.md](AGENTS.md) and the
> [workspace contract](../AGENTS.md). Product design records now live in `docs/`.

## 2026-09-09-052742

# セッションサマリ — 核心機能の欠陥発見と修正、UI プロトタイプ

## 何をしたのか

前回チェックポイント以降、「1 つのフォルダを正しく分割して見せる」という本拡張の
核心が**実際には成立していなかった**ことを発見し、修正した。あわせて UI の実現可能性を
実測し、リリースパイプラインの穴を塞いだ。

1. **PR #11 マージ** — シンボリックリンク走査と既定 Raw レイヤーの修正、エージェント
   運用基盤と設計ドキュメント。マージ後に `.vsix` 同梱事故（148 ファイル・630KB）を
   発見し `.vscodeignore` で修正（8 ファイル・31KB）。
2. **PR #12（未マージ）** — リリースパイプラインの 3 つの穴。`.vsix` 内容検査、
   バージョン更新スクリプト、CHANGELOG からのリリースノート生成。
3. **UI 実現可能性の実測** — モックアップの 2×2 グリッドは VS Code のサイドバーでは
   表現不可能（`viewsContainers` は 3 キーのみ、`initialSize` は高さのみ）。
   WebviewView プロトタイプを作り、性能・幅・失う affordance を数値で計測した。
4. **核心の欠陥発見** — 実 fixture（本物の submodule 2 つ + 本物の symlink マウント）で
   測ったところ、分類が 3 通りに壊れていた。根本原因は `ClassifiedFile` がスコープを
   持たないこと。
5. **PR #13** — スコープ単位の分類とマウント検出。ユニットテスト 29 → 102。

## どういうやり取りをユーザーと行ったのか

`/init` 完了後の「ルール書き換え承認」から始まり、個人 KB・チーム KB・複数 Google Drive を
組み合わせた UI 構想の相談を受けた。調査の結果を報告し、ユーザーの指示「1,2,3,4 全部進めて」
で 4 系統を並列実行。

その後ユーザーから UI モックアップ画像が提示され、実現可能性を検証。案 2（WebviewView）を
選択したうえで「実際の画面見たい」との要望を受け、実 VS Code のスクリーンショットを撮影。

**決定的な転換点**は「あくまでこれは view で、実情は 1 つのリポジトリの中に submodule を
クローンし、複数の Google Drive を rclone する、つまり 1 つのフォルダであることは変わりない」
というユーザーの説明。これを受けて実 fixture で検証したところ、核心が成立していないことが
判明した。

続けてユーザーから 3 つの設計制約が示された。

- チーム/エンタープライズの schema はそのフォルダに置いたままにする（Claude Code や
  Codex の仕様上もそれが望ましい）
- チーム schema は個人 schema へ選択的に引き上げる想定だが、ベースは submodule 内
- `contents/` にはローカルファイルを一切入れない。個人 PC で発生する raw は
  すべて自分の Google Drive に入れる

最後の制約は特に効き、マウント判定の推論が不要になった。

## どうやったのか

`.claude/rules/delegation.md` に従い、調査・実装はすべて委譲した。独立した単位は
1 メッセージで並列起動している。`general-purpose-opus` に scope 分割の実装・UI 実現可能性
調査・実 vault 検証・グリッド実データ接続を、`general-purpose-sonnet` にルール書き換えと
検証手順作成を、`claude-code-guide` にスキル解決順序とネスト `CLAUDE.md` の仕様確認を委譲。

検証は主エージェントが自分で行った。特に分類結果は `node -e` で自分で再現し、
`.vsix` 同梱ガードは自分で事故を再現して落ちることを確認し、`search.followSymlinks` の
既定値は手元の VS Code バイナリと nls バンドルから自分で引いた。

DESIGN.md はすべて型付き writer 経由。手書きは一切していない。

## 途中でどういう課題が起こったのか

**主エージェントの誤りが 2 件。** ①「symlink スキップが macOS のマウント戦略を殺す」と
広く述べたが、`walk()` は `roots` 経由でしか呼ばれず、ワークスペース内は `findFiles` が
支配していた。②「submodule の `.claude/` を拾えていないのがバグ」と報告したが、
ユーザーの指摘で逆と判明。誤っていたのは `**/CLAUDE.md` が無制限に拾う側だった。

**スキル優先順位の推測が事実と逆。** 「project が黙って勝つのか」と推測したが、実際は
`Personal > Project` で、`~/.claude/skills/` がリポジトリの正典スキルを上書きする。
teamai-cli 判断資料の R7 を Critical へ格上げし、R1 を抜いてトップリスクになった。

**型付き writer の追記による矛盾が 2 件。** DESIGN.md の TODO 節と CHANGELOG の
Unreleased 節で、旧記述と新記述が併存した。いずれも書き直して解消。

**`.vsix` 同梱事故。** `.vscodeignore` は除外リスト方式のため、追加したディレクトリが
素通りしていた。さらに `tmp/` に置いたスクリーンショットも同梱される状態になり、
ユーザーの指示で削除。

**Codex のサンドボックスが不安定。** `bwrap: No permissions to create a new namespace` で
起動失敗する回、600 秒でタイムアウトする回、空応答を返す回があった。成功した回は
設計判断に有効に働いた（`identity-mismatch` の優先順位バグ、マウント上部固定案の却下）。

**画像ビューアのフックタイムアウト。** 後半のスクリーンショットは主エージェントが
自分で開けず、委譲先の記述をそのまま伝える形になった。数値的な非空検証のみ自分で実施。

## 将来のアクション

1. **PR #12 と #13 が未マージ。** #12 をマージすると `.vsix` 同梱事故が CI で止まる。
2. **rclone の実機検証が未実施。** Mac で `./scripts/verify-rclone-mount.sh --mount-path <先>`。
   最も決定的なのはチェック #1（combine バックエンド）で、これが通らなければ rclone
   採用の前提が崩れる。
3. **FR-15 未実装** — チーム schema の個人 schema への引き上げ操作。
4. **UI 配置が未決** — グリッドは既定 299px では読めない。レスポンシブに畳むか、
   エディタ領域など幅のある場所に置くか。エディタ領域の WebviewPanel は
   `#808080` の均一フレームになる問題があり、切り分け未了。
5. **未実装の中核機能** — manifest、dangling/orphan 検出、層ごとのコンテキスト予算。
6. **デバイス判定の限界** — bind mount の誤判定、btrfs/overlayfs/APFS での警告漏れ。
   差し替え箇所は `deviceIdOf()` に閉じている。
7. **teamai-cli は現時点で採用しない推奨。** 反転トリガは 2 つ目のリポジトリの必要性、
   または 2 人目の開発者によるドリフト観測、加えて名前衝突検出チェックの整備。

## 2026-09-08-023011

# セッションサマリ — /init から多重 Drive 設計の決着まで

## 何をしたのか

`/init` によるプロジェクトコンテキストの初期化から始まり、irori の層モデルに
関する設計決着の記録、リポジトリのルール整備、そして実装ブロッカーの修正までを
一続きで実施した。成果は 5 系統。

1. **`/init` 完了** — `docs/DESIGN.md` を要件 14 件・NFR 7 件・技術選定 8 件・
   Agent Roles 5 件・Key Decisions 6 件・散文 5 節で初期化し、`.claude/STATE.md` の
   Repository Identity を設定した。
2. **ルール 2 件を実態に合わせて全面書き換え** — `.claude/rules/dev-environment.md` と
   `.claude/rules/testing.md` が Python/uv/ruff/pytest 前提だったため、npm + TypeScript +
   esbuild + eslint + mocha + @vscode/test-cli という本リポジトリの実態に置き換えた。
3. **多重 Google Drive 設計の決着を DESIGN.md へ記録** — Key Decisions 6 行を追記し、
   制約節と TODO 節を更新。未決は 11 件から 10 件、🔴 は 3 件から 2 件へ減った。
4. **実装ブロッカー 2 件を修正** — シンボリックリンクの無言スキップと、既定 `raw`
   レイヤーが構造上ゼロ件になる問題。`src/walk.ts` を新規に切り出し、ユニットテストは
   11 件から 29 件へ増えた。
5. **調査文書 3 件と検証スクリプト 1 件を作成** — Drive マウント機構の比較、
   teamai-cli の採否判断資料、実機検証手順とその実行スクリプト。

## どういうやり取りをユーザーと行ったのか

`/init` 実行中にユーザーから大量の設計ノート（irori Obsidian 版、層の軸と生成物の
置き場）が投入され、これが以降すべての作業の権威ある入力になった。ノートは 4 層から
3 層（schema / Knowledge_Base / contents）への決着と、「生成物そのものは層に入らない。
入るのは参照と来歴」という 2 つの結論を含んでいた。

`/init` 完了報告時に `.claude/rules/` のスタック不一致を指摘し、書き換えの承認を求めた。
ユーザーは「着手して」と承認。

続いてユーザーから本題の相談。個人 KB・チーム KB・個人 Google ドライブ・チーム Google
ドライブを組み合わせた運用 UI を作りたい、チーム KB は git submodule として導入する案、
複数 Drive をどう `contents` 層に収めるか、rclone や GWS CLI が使えるか、そして
Tencent/teamai-cli の検討依頼。

調査と設計の結果を報告した際、次の 4 つの行動を提示し、ユーザーは「1,2,3,4 全部進めて」と
指示した。すべて完了。

最後にユーザーの指示で本チェックポイントを実行した。

## どうやったのか

`.claude/rules/delegation.md` の委譲優先方針に従い、主エージェントは調査を直接行わず、
以下を委譲した。独立した単位は 1 メッセージで並列起動している。

- `general-purpose-opus`: DESIGN.md 入力 JSON の構成、Drive マウント機構と teamai-cli の
  外部調査、多重 Drive アーキテクチャの Codex 相談、実装ブロッカーの修正。
- `general-purpose-sonnet`: ルール 2 ファイルの書き換え（並列）、teamai-cli 判断資料、
  rclone 検証手順。
- `claude-code-guide`: スキル解決順序の事実確認。

Codex CLI は 2 回相談した。多重 Drive アーキテクチャ（`gpt-5.6-sol`、read-only、178 秒）と
シンボリックリンク・roots のセマンティクス（同、142 秒）。いずれも編集ゼロ、HEAD 不変。

DESIGN.md と STATE.md はすべて型付き writer 経由で書いた（`update_design.py`、
`append_state_block.py`）。手書きは一切していない。

検証は委譲せず主エージェントが実行した。`npm run check-types` / `lint` / `test:unit` を
自分で回し、`git diff --stat` と実際の差分を自分で読み、報告された事実（コード行、
CI 設定、VS Code バイナリ内の設定既定値）を一次ソースで確認した。

## 途中でどういう課題が起こったのか

**主エージェント自身の誤りが 1 件。** シンボリックリンクのスキップを「macOS のマウント
戦略を殺す」と広く述べたが、`walk()` は `roots` 経由の外部走査からしか呼ばれない。
ワークスペース内のマウントは `vscode.workspace.findFiles` を通り、VS Code 側の
`search.followSymlinks`（既定 true）に支配される。訂正して検証手順を 8a / 8b に分割させた。

**推測が事実と逆だった件が 1 件。** スキル名衝突時に「project が黙って勝つのか」と推測したが、
実際の解決順序は `Enterprise > Personal > Project > Plugin > Bundled` で Personal が勝つ。
teamai-cli が書き込む `~/.claude/skills/` が、本リポジトリの正典スキルを黙って上書きする
という逆向きの失敗モードだった。teamai-cli 判断資料の R7 を Critical へ格上げし、
R1（供給網）を抜いてトップリスクになった。

**型付き writer の追記による矛盾が 1 件。** `update_design.py` はセクション末尾に追記する
ため、TODO 節に旧「🔴 join key は未決」と新「解決済み」が併存した。TODO 節を書き直して解消。

**委譲先が自分の修正のテスト中にバグを 1 件発見。** 検証スクリプトの設定読み取り
フォールバックが `grep -E`（ERE）に BRE 記法を渡しており、明示的な override が
すべて黙って無視されていた。修正済み。

**環境制約。** 本環境は Linux コンテナで rclone も `/dev/fuse` も Obsidian も無い。
対象機は Mac / Windows のため、実機検証は実行できず、手順とスクリプトの作成に留めた。
rclone `combine` が期待どおり動くかの結論はまだ出ていない。

## 将来のアクション

1. **CHANGELOG 未更新。** 既定レイヤーの挙動変更（`contents/**` `raw/**` `data/**`
   `attachments/**` が「その他」から「Raw」へ移動）は 0.1.0 公開済み拡張に対する
   利用者可視の変更。リリース前に必須。
2. **`readFollowSymlinks()` の置き場所。** `LayeredKbConfig` ではなく
   `vscode.workspace.getConfiguration` を直接読んでいる。`readConfig()` に寄せるべき。
3. **実機検証。** Mac で `./scripts/verify-rclone-mount.sh --mount-path <マウント先>` を
   走らせ、最も決定的なチェック #1（combine バックエンド）の結論を出す。
   これが通らなければ rclone 採用の理由が消える。
4. **未コミット。** `src/walk.ts` など新規 2 件を含む変更が作業ツリーに乗ったまま。
5. **残る 🔴 未決 2 件** — 一般 vault 向けの分類主信号（frontmatter か path か）と、
   Obsidian プラグインのリポジトリ境界。
6. **teamai-cli** は現時点で採用しない推奨。反転トリガは 2 つ目のリポジトリの必要性、
   または 2 人目の開発者によるドリフト観測。加えて `~/.claude/skills/` と
   `<repo>/.claude/skills/` の名前衝突を検出するチェックの整備が前提条件。
