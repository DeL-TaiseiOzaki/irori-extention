# irori for VS Code

> **開発終了（2026-09-18）.** この拡張の開発は終了しました．層モデルとその分類は
> デスクトップアプリ [irori](https://github.com/DeL-TaiseiOzaki/irori) が実装しており，
> 今後の開発はそちらに一本化します．新しい拡張 ID
> `del-taiseiozaki.irori-extention` では公開しません．旧 Marketplace エントリ
> `del-taiseiozaki.layeredkb`（v0.2.0）は取り下げます．
> このリポジトリは記録として残し，読める状態を保ちます．経緯は
> [docs/DESIGN.md](docs/DESIGN.md) の Key Decisions を参照してください．

Personal Knowledge Base（PKB）のワークスペースを，役割ごとの **レイヤー** に分けて表示する VS Code 拡張機能です．

PKB を CLI エージェント（Claude Code など）と一緒に運用すると，ワークスペースには性質の異なるファイルが混在します．
irori は開いているフォルダはそのままに，ユーザーが設定した層分けに従ってファイルやフォルダを **層ごとの独立したパネル** に振り分けて表示します．
フォルダ構成を変える必要はありません．

```
┌ irori ───────────────┐
│ ▾ スキーマ層          12  │  .claude/, CLAUDE.md, AGENTS.md ...
│ ▾ オントロジー層       3  │  *.csv
│ ▾ ナレッジベース層   148  │  *.md
│ ▾ Raw データ層       902  │  ~/Google Drive/PKB-raw（Git 管理外）
│ ▾ その他               7  │  上記以外
└──────────────────────────┘
```

| レイヤー | 役割 | Git 管理 | 既定で含まれるもの |
| --- | --- | --- | --- |
| **スキーマ層** | CLI エージェントの振る舞いを規定する層 | ○ | `.claude/**`, `CLAUDE.md`, `AGENTS.md`, `.cursor/**`, `.codex/**`, `.gemini/**`, `.github/copilot-instructions.md`, `.mcp.json` など |
| **オントロジー層** | この PKB のオントロジー | ○ | `**/*.csv`, `**/*.tsv`, `ontology/**` |
| **ナレッジベース層** | メインの知見・情報 | ○ | `**/*.md`, `**/*.mdx` |
| **Raw データ層** | Google Drive などの生データ置き場 | × | `roots` に指定したフォルダ配下の全ファイル（未設定なら空） |
| **その他** | どのレイヤーにも属さないファイル | | 上記以外（`irori.showOtherLayer` で非表示可） |

## 機能

- **レイヤーごとのパネル**: アクティビティバーの irori アイコンを開くと，各レイヤーが独立したパネル（ビュー）として並びます．パネルのタイトルにファイル数を表示します．
  パネルはドラッグで並べ替え・エクスプローラーへの移動ができます．
- **ワークスペース外フォルダ**: レイヤーに `roots` を指定すると，Google Drive など Git 管理外のフォルダを走査してそのパネルに表示します．
- **標準エクスプローラーの装飾**: 各ファイルに所属レイヤーのバッジ（`S` / `O` / `K`）と色を付けます（`irori.decorateExplorer` で無効化可）．
- **コンパクトフォルダー**: 子が 1 つしかないフォルダーは `a/b/c` のように 1 行にまとめます．
- **自動更新**: ファイルの追加・削除・設定変更を検知して再走査します（`roots` のフォルダも監視します）．
- **ファイル操作**: クリックで開く，右クリックで「横に開く」「エクスプローラーで表示」「OS で表示」「パスをコピー」．
- **マルチルート対応**: 複数のワークスペースフォルダはルート名を先頭に付けて表示します．

## レイヤーのカスタマイズ

レイヤーは `irori.layers` 設定で自由に定義できます（最大 8 個）．上から順に評価され，最初に一致したレイヤーが採用されます（first-match-wins）．
`roots` を持つレイヤーは指定フォルダだけを走査し，ワークスペース内ファイルの分類には参加しません．

`.vscode/settings.json` の例（Raw データ層に Google Drive のフォルダを割り当てる）:

```jsonc
{
  "irori.layers": [
    {
      "id": "schema",
      "label": "スキーマ層",
      "icon": "law",
      "badge": "S",
      "color": "charts.purple",
      "patterns": [".claude/**", "**/CLAUDE.md", "**/AGENTS.md", ".mcp.json"]
    },
    {
      "id": "ontology",
      "label": "オントロジー層",
      "icon": "type-hierarchy",
      "badge": "O",
      "color": "charts.orange",
      "patterns": ["ontology/**", "**/*.csv"]
    },
    {
      "id": "knowledge",
      "label": "ナレッジベース層",
      "icon": "book",
      "badge": "K",
      "color": "charts.blue",
      "patterns": ["**/*.md"]
    },
    {
      "id": "raw",
      "label": "Raw データ層",
      "icon": "database",
      "patterns": ["**/*"],
      "roots": ["~/Google Drive/PKB-raw", "../raw-data"]
    }
  ]
}
```

各レイヤーのフィールド:

| フィールド | 必須 | 説明 |
| --- | --- | --- |
| `id` | ○ | 一意な ID（`other` は予約済み） |
| `label` | ○ | パネルに表示する名前 |
| `patterns` | ○ | ルートからの相対 glob（`**`，ブレース展開可） |
| `roots` | | 走査するフォルダ（絶対パス，`~`，またはワークスペース相対パス）．指定するとワークスペース外専用のレイヤーになる |
| `description` | | ツールチップの説明 |
| `icon` | | [codicon](https://microsoft.github.io/vscode-codicons/dist/codicon.html) の名前 |
| `badge` | | 標準エクスプローラーに出すバッジ（1〜2 文字） |
| `color` | | 標準エクスプローラーの装飾色（テーマカラー ID，例 `charts.blue`） |

その他の設定:

| 設定 | 既定値 | 説明 |
| --- | --- | --- |
| `irori.exclude` | `node_modules`, `.git`, `dist`, `out` | 走査から除外する glob（ワークスペースでは `files.exclude` に加えて適用） |
| `irori.showOtherLayer` | `true` | 「その他」パネルを表示する |
| `irori.compactFolders` | `true` | コンパクトフォルダー表示 |
| `irori.decorateExplorer` | `true` | 標準エクスプローラーにバッジと色を付ける |

## 開発

```bash
npm install
```

| コマンド | 内容 |
| --- | --- |
| `npm run watch` | esbuild と tsc の型チェックをウォッチ実行 |
| `npm run compile` | 型チェック + Lint + バンドル（開発ビルド） |
| `npm run package` | 型チェック + Lint + バンドル（本番ビルド，minify） |
| `npm run lint` | ESLint |
| `npm run check-types` | 型チェックのみ |
| `npm run test:unit` | 分類・ツリー構築ロジックの単体テスト（VS Code 不要） |
| `npm test` | 拡張機能の統合テスト（VS Code を起動） |

VS Code でこのフォルダを開き，`F5`（Run Extension）で拡張機能ホストが起動します．

### ディレクトリ構成

```
src/
├── extension.ts            # エントリポイント（ビュー枠・コマンド・装飾の登録）
├── layers.ts               # レイヤー定義・分類・ツリー構築（VS Code API 非依存）
├── config.ts               # 設定の読み込みと検証
├── workspaceIndex.ts       # ワークスペースと roots の走査，分類結果の保持
├── layerTreeProvider.ts    # 1 レイヤー分の TreeDataProvider
├── explorerDecorations.ts  # FileDecorationProvider
└── test/
    ├── extension.test.ts   # 統合テスト
    └── unit/               # 単体テスト
```

ビューは動的に追加できないため，`package.json` に 8 個のビュー枠（`irori.slot0`〜`slot7`）を静的に宣言し，設定に応じてタイトルと表示/非表示を切り替えています．

## 公開

### 初回のみ: publisher と Personal Access Token の準備

1. [Azure DevOps](https://dev.azure.com/) にサインインし，組織を 1 つ作ります（無ければ）．
2. 右上のユーザー設定から **Personal access tokens** を開き，次の設定でトークンを作ります．
   - Organization: **All accessible organizations**
   - Scopes: **Custom defined** → **Marketplace: Manage**
3. [Marketplace の管理ページ](https://marketplace.visualstudio.com/manage) で publisher を作ります．
   ID は `package.json` の `publisher`（`del-taiseiozaki`）と一致させてください．
4. GitHub リポジトリの **Settings → Secrets and variables → Actions** に，2 で作ったトークンを `VSCE_PAT` という名前で登録します．

### リリース手順

変更点を `CHANGELOG.md` の `## Unreleased` に書いてから，バージョンを上げて main にマージし，
同じ番号のタグを push します．Release ワークフローがビルド・テスト・.vsix の内容検査・
Marketplace 公開・GitHub Release 作成（本文は CHANGELOG の該当節）まで行います．

```bash
./scripts/bump-version.sh minor --dry-run   # 何が変わるか先に確認する
./scripts/bump-version.sh minor             # package.json / package-lock.json / CHANGELOG.md を更新
git diff                                    # 差分を自分で確認する
git add package.json package-lock.json CHANGELOG.md
git commit -m "0.2.0"
git tag v0.2.0
git push origin HEAD
git push origin v0.2.0                      # これが Marketplace への公開を起動する
```

`bump-version.sh` はコミットもタグも作りません（公開は取り消せないため，最後の一押しは人が行う）．
作業ツリーが汚れている，`## Unreleased` が無い・空，バージョンが下がる場合は実行を拒否します．

`.vsix` に入るファイルは許可リストで検査されます．手元で確認するには:

```bash
npm run compile && ./scripts/check-vsix-contents.sh
```

タグを push しても Release が走らなかった場合（ワークフローが main に入る前にタグを push した場合など）は，
GitHub の **Actions → Release → Run workflow** で「Use workflow from」にそのタグ（例: `v0.1.0`）を選んで手動実行できます．

手元から直接公開する場合:

```bash
npx @vscode/vsce login del-taiseiozaki   # トークンを入力
npx @vscode/vsce package                 # .vsix を生成（内容確認用）
npx @vscode/vsce publish                 # Marketplace へ公開
```

公開後，[Marketplace](https://marketplace.visualstudio.com/items?itemName=del-taiseiozaki.irori-extention) に反映されるまで数分かかります．
