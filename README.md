# 青空Reader

青空文庫の作品をデスクトップで読むための電子書籍リーダー。
Electron + React + TypeScript / macOS 向け。

現在の到達点: **Phase 1（基本リーダー）完了**。Phase 2（読書支援機能）は未着手。

## 使い方

```bash
npm install
npm run dev
```

「作品を追加」から青空文庫の `.txt` / `.zip` を選ぶか、本棚にドラッグ&ドロップする。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発起動 |
| `npm run build` | ビルド |
| `npm test` | ユニットテスト |
| `npm run typecheck` | 型検査 |
| `npm run dist` | macOS 向け dmg を作る |

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

### 不変条件 B — レイアウトは「インライン軸オフセット」1つに還元する

CSS multicolumn は**インライン軸方向**にあふれる。

| writingMode | インライン軸 | ページ送り |
|---|---|---|
| `horizontal-tb` | 水平 | `translateX` |
| `vertical-rl` | 垂直 | `translateY` |

つまり縦横の違いは「その1つの量を X に割り当てるか Y に割り当てるか」でしかない。
`LayoutController` はこの1軸だけを動かし、`next()` / `previous()` / `goToPosition()`
という論理操作から先に縦横の分岐を出さない。

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
npm test                                        # ユニットテスト 101件
npx vite-node scripts/probe-samples.mjs <dir>   # 実ファイルのパース検査
npm run build && npx electron scripts/e2e-reader.mjs <dir>   # 実機での §17 検証 22件
```

`<dir>` には手元の青空文庫ファイル（.zip / .txt）を置いたディレクトリを指定する。
**実データはリポジトリに含めていない。**

ページ幾何が絡む項目は jsdom では検証できない（レイアウトが無い）ため、
`e2e-reader.mjs` が実際の Electron 上で確認する役割を持つ。

`scripts/spike-layout.mjs` は不変条件 B を実測したスパイク。
Electron を上げ直したときに縦書き multicolumn の挙動が変わっていないか確認できる。

## 外字変換表の再生成

`src/shared/data/gaiji-kuten.json` は生成物だがコミットしてある（実行時に通信しないため）。
更新するときだけ:

```bash
curl -O https://x0213.org/codetable/jisx0213-2004-std.txt
node scripts/build-gaiji-table.mjs jisx0213-2004-std.txt
```

## Phase 2 に向けて

未実装（要件 §5）: ブックマーク / ハイライト / メモ / 注釈一覧 / 辞書 /
読了時間推定 / 読書統計 / TTS / 著者情報 / 集中モード。

DB スキーマ（`bookmarks` / `highlights` / `notes` / `reading_sessions`）と
ハイライト描画の仕組みは Phase 1 の時点で用意してあるので、
Phase 2 は主に UI と Service の追加になる。
