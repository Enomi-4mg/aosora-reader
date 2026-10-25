# 青空Reader

青空文庫の作品をデスクトップで読むための電子書籍リーダー。
Electron + React + TypeScript / macOS・Windows 向け。

現在の到達点: **Phase 1（基本リーダー）+ Phase 2（読書支援機能）完了**。

Phase 2 では、栞・4色ハイライト・範囲/位置メモ・統合注釈一覧・コピー・
Wiktionary 辞書検索・読了時間推定・読書セッション記録・OS 読み上げ・著者情報・
fullscreen・集中モードを追加した。注釈と読み上げ位置もページ番号ではなく
`TextPosition` / `TextRange` で保存・追従する。

## 使い方

```bash
npm install
npm run dev
```

「青空文庫から追加」で公式カタログを検索するか、「ファイルから追加」で `.txt` / `.zip`
を選ぶ。ローカルファイルは本棚へのドラッグ&ドロップでも取り込める。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発起動 |
| `npm run build` | ビルド |
| `npm test` | ユニットテスト |
| `npm run typecheck` | 型検査 |
| `npm run dist` | macOS 向け dmg を作る(arm64 と x64 の2つ) |
| `npm run dist:win` | Windows 向け NSIS インストーラを作る |

配布物は `v0.2.0` のようなタグを push すると GitHub Actions が両 OS 分を作り、
下書きの Release にまとめる(`.github/workflows/release.yml`)。
タグと `package.json` の `version` は揃えること。食い違うとビルド前に止まる。

`npm run dist` は Intel Mac 向けの dmg も作るので、手元で片方だけ要るときは
`npm run dist -- --arm64` のようにアーキテクチャを指定する。

`npm run dist:win` を Apple Silicon の Mac で走らせると、アプリの梱包までは
進むがインストーラの生成で止まる。electron-builder が持つ `makensis` が
x86_64 バイナリで、Rosetta を要求するため。Windows か CI で作るほうが早い。

配布物に署名していないので、Windows は SmartScreen、macOS は Gatekeeper の警告が出る。
そのため自動更新も行わず、新しい版が出たことを知らせるだけにしてある。

## 設計の核 — 2つの不変条件

このアプリの難しさは機能の数ではなく、**位置情報を壊さないこと**にある。
縦書き・フォントサイズ変更・ページング・ハイライトを組み合わせた瞬間に、
「表示上の位置」を保存する設計は破綻する。全体が次の2点に依存している。

### 不変条件 A — `plainText` が唯一の座標空間

各 `Block` は `plainText` を持ち、Block 内のあらゆる位置はそのインデックスで表す。

- **ルビの読みは `plainText` に含めない。** 含めると検索・ハイライト・読了率が
  ルビの文字数で汚染される。実際『こころ』では「わたくし」がルビとして71回現れるが、
  検索にヒットするのは本文に地の文として現れる1回だけになる。
- 未対応注記は必ず**ゼロ幅**（`start === end`）。座標を消費しないので、
  将来パーサーがその注記に対応しても既存のハイライト位置がずれない。
- オフセットの単位は **UTF-16 コードユニット**。DOM の `Range.startOffset` と
  同じ単位なので、DOM ↔ Model の変換に一切の再計算が要らない。
  （JIS X 0213 第3・第4水準にはサロゲートペアの外字があるため
  「1文字 = 1オフセット」ではない点に注意）

読了率も読了時間も、ページ数ではなくこの文字オフセットから算出する。
だからフォントにもウィンドウサイズにも writingMode にも影響されない。

### 不変条件 B — ページ送りは画面上の左右移動に統一する

横書きは CSS multicolumn の列を左から右へ並べ、本文を左へ送る。
縦書きは writing-mode 本来の block progression で本文を右から左へ伸ばし、
次ページでは本文を右へ送る。

| writingMode | 本文の進行 | ページ送り |
|---|---|---|
| `horizontal-tb` | 左→右 | `translateX(-pageWidth)` |
| `vertical-rl` | 右→左 | `translateX(+pageWidth)` |

クリック位置・矢印キー・マウスドラッグと本文の移動を、すべてこの左右方向へ揃える。
`LayoutController` は `next()` / `previous()` / `goToPosition()` という論理操作を提供する。

**ページ番号はどこにも保存しない。** 保存するのは常に `TextPosition` で、
ページ番号は毎回そのつど幾何から導出し直す。

### 系 — ハイライトは CSS Custom Highlight API に集約する

ハイライト・検索一致・読み上げ中の文は、いずれも「任意の Range を塗る」処理。
multicolumn + transform の座標系で絶対配置オーバーレイを自前計算すると必ず破綻するので、
3機能とも `CSS.highlights` に寄せてある。実表示色は `::highlight()` 側でテーマごとに決める。

## 構成

```
src/
  shared/     main と renderer の両方から使う
    model/    Document Model / TextPosition / 設定
    parser/   青空文庫記法 → Document Model（ここに青空固有の知識を閉じ込める）
    data/     外字変換表（JIS X 0213 面区点 → Unicode, 11,233件）
  main/       fs / SQLite / Service / Repository
  preload/    contextBridge（renderer に Node API を出さない）
  renderer/   Document Model だけを見て描画する。青空文庫記法は知らない
    reader/dom/         DOM ↔ TextPosition の唯一の橋
    reader/layout/      ページ幾何
```

パースは**インポート時に一度だけ**行い、Document Model を DB に保存する。
毎回再パースしないのは速度ではなく安定性のためで、将来パーサーを改良したときに
blockId が変わって既存のハイライトが orphan 化するのを防ぐ。

## 検証

```bash
npm test                                        # ユニットテスト 113件
npx vite-node scripts/probe-samples.mjs <dir>   # 実ファイルのパース検査
npm run build && npx electron scripts/e2e-reader.mjs <dir>   # 実機での §17 検証 22件
npm run build && npx electron scripts/check-legibility.mjs   # 表示の視認性検証 11件
```

`<dir>` には手元の青空文庫ファイル（.zip / .txt）を置いたディレクトリを指定する。
**実データはリポジトリに含めていない。**

ページ幾何が絡む項目は jsdom では検証できない（レイアウトが無い）ため、
`e2e-reader.mjs` が実際の Electron 上で確認する役割を持つ。

`scripts/spike-layout.mjs` は不変条件 B を実測したスパイク。
Electron を上げ直したときに縦書き multicolumn の挙動が変わっていないか確認できる。

### 視認性の検証

`check-legibility.mjs` は `scripts/typography-specimen.txt`（ルビ・傍点各種・傍線各種・
太字・字下げ・外字・縦中横を網羅した組版見本）を取り込んで、次を数値で判定する。

- ルビの実効サイズ（8px 未満は判読困難）
- ルビが隣接行に接触しないか
- テーマごとのコントラスト比（WCAG AA 4.5:1 / 要件 §11）
- 一行あたりの文字数

**目視の印象は当てにならない。** 実際、最初にスクリーンショットを見たときは
「行が長すぎる」「ルビで行送りが不揃い」と感じたが、計測するとどちらも誤りだった
（一行 34 字、列ピッチ 27〜27px で均一）。判定は数値で行うこと。

## 外字変換表の再生成

`src/shared/data/gaiji-kuten.json` は生成物だがコミットしてある（実行時に通信しないため）。
更新するときだけ:

```bash
curl -O https://x0213.org/codetable/jisx0213-2004-std.txt
node scripts/build-gaiji-table.mjs jisx0213-2004-std.txt
```

## Phase 2 の実装境界

- `AnnotationRepository`: 栞・ハイライト・メモの CRUD と orphan 復旧
- `ReadingSessionRepository`: 開閉位置・経過時間・読書速度の記録
- `DictionaryProvider`: 初期 Provider は日本語版 Wiktionary。通信失敗は Reader から隔離
- `useTtsController`: Web Speech API を使う OS 読み上げと文単位の `TextRange` 追従
- `useAnnotationsStore`: UI 状態と IPC 永続化の分離

辞書以外の読書機能はオフラインで動作する。辞書検索が失敗しても本文閲覧、注釈、
読み上げは継続できる。
