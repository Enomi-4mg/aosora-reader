# コード署名の方針

配布物に署名していないと、Windows は SmartScreen の「WindowsによってPCが保護されました」を、
macOS は Gatekeeper の「開発元を検証できません」を出す。
どちらも実行はできるが、初見の人はここでほぼ離脱する。

さらに**自動更新は署名が前提**になる。
macOS の Squirrel.Mac は更新物の署名を検証するので、署名が無いと自動更新が成立しない。
Windows は無署名でも技術的には更新できるが、更新のたびに SmartScreen を踏ませることになる。

この文書は、Windows を SignPath Foundation（無償）で、macOS を Apple Developer Program（有償）で
まかなう前提で、何が要るかを整理したもの。

## 全体像

| | Windows | macOS |
|---|---|---|
| 仕組み | Authenticode | Developer ID + notarization |
| 証明書の出どころ | SignPath Foundation | Apple Developer Program |
| 費用 | 無償（OSS 枠） | 年 99 USD |
| 証明書上の発行元 | **SignPath Foundation** | 自分（個人名または法人名） |
| 自動更新への必要性 | 無くても動くが毎回警告 | **必須** |

SignPath には macOS 向けの鍵管理（CryptoTokenKit 経由で `codesign` に証明書を渡す）もあるが、
それは**手持ちの Apple 証明書を預ける**仕組みで、Apple の証明書を発行してくれるわけではない。
notarization も Apple のサービスなので別途必要になる。
つまり **macOS は SignPath では無償にならない**。

---

## Windows: SignPath Foundation

### 申請前に満たすべき条件

SignPath Foundation の OSS 枠には、技術的な条件と運用上の条件の両方がある。
現状との対応は次のとおり。

| 条件 | 現状 |
|---|---|
| OSI 承認のライセンスで、商用デュアルライセンスが無いこと | ✅ MIT |
| ソースリポジトリを自分たちで保持していること | ✅ Enomi-4mg/aosora-reader（public） |
| ビルドが完全に自動化され、リポジトリと連携していること | ✅ `.github/workflows/release.yml` |
| 積極的に保守されていること | ✅ |
| **署名する形で既にリリース済みであること** | ❌ **v0.1.0 は下書きのまま** |
| 機能が配布ページに説明されていること | ⚠️ README はあるが、リリースページの説明は未記入 |
| **ホームページに「Code signing policy」の節があること** | ❌ 未着手 |
| 全メンバーが SignPath と GitHub で MFA を使っていること | ⚠️ 要確認 |
| 役割（author / reviewer / approver）が定義されていること | ❌ 未着手（個人開発なので兼任の明記で足りるはず） |
| 署名物のメタデータが揃っていること（製品名・版） | ✅ `青空Reader` / `0.1.0` が exe に入っていることを確認済み |

**最初に潰すべきは「リリース済みであること」**。
いまの v0.1.0 は下書きなので、申請の前に公開する必要がある。
無署名のまま一度公開し、そのうえで署名を申請する、という順番になる。

### Code signing policy の節

これは申請の必須条件で、内容も決まっている。README に次を含む節を置く。

- 無償のコード署名を SignPath.io から提供されていること
- 証明書が SignPath Foundation によって発行されていること
- チームの役割とその担当者
- プライバシーに関する記述

承認後でないと書けない部分があるので、申請の直前に下書きし、承認後に確定させる。

### 証明書上の発行元が変わる

Windows が「確認済みの発行元」として表示するのは **SignPath Foundation** であって、
`青空Reader` でも `miyashu` でもない。これは無償枠の仕組み上そうなるもので、回避できない。
利用者から見ると「SignPath Foundation が発行元の青空Reader」になる。

また、Code of Conduct に反した場合、Foundation の判断で証明書を失効させられる。

---

## CI 側の設計

### 落とし穴: latest.yml のハッシュ

**署名はファイルの中身を変える。**
electron-builder はビルドの最後に `latest.yml` / `latest-mac.yml` を書き、
その中に各配布物の SHA-512 を base64 で入れている。

```yaml
files:
  - url: aosora-reader-0.1.0-arm64.zip
    sha512: 34las8T4B+6V+fcAIFjw6NIgAwqXRAl1a61d3slYgQe32Hyp...
```

（この形式は実際のビルド成果物で確認済み。ファイルの SHA-512 を base64 にしたものと一致する。）

ビルド後に署名すると、このハッシュが実物と食い違う。
electron-updater はダウンロードしたファイルのハッシュを検証するので、**更新が必ず失敗する**。
しかも失敗するのは次の版を配ったときなので、気づくのが遅れる。

対処は2つに1つ。

1. **マニフェストが作られる前に署名する**（electron-builder の署名フック）
2. **署名後にマニフェストを作り直す**

### 案A: 署名後にマニフェストを作り直す（推奨）

SignPath は自社サーバー上で、GitHub Actions の成果物を受け取って署名する。
したがってビルドとは別のステップになる。

```
build    →  成果物をアップロード
            ↓
sign     →  SignPath/github-action-submit-signing-request で提出
            承認を待って、署名済みファイルを受け取る
            ↓
manifest →  署名済みファイルの SHA-512 で latest.yml を書き直す
            ↓
release  →  下書き Release にまとめる
```

`release.yml` に `sign` と `manifest` の2ジョブを挟む形になる。
SignPath のアクションに渡すのは API トークン（Secrets）、組織 ID、
プロジェクト・署名ポリシー・アーティファクト構成の各 slug。

マニフェストの書き直しは短いスクリプトで足りる。
ハッシュは「ファイルの SHA-512 を base64」なので、`node:crypto` だけで計算できる。

**この案を推す理由**は、SignPath の署名が「提出 → 人間の承認 → 署名」という非同期の流れで、
ビルドの途中で待たせるより、独立したジョブにしたほうが見通しが良いため。

### 案B: electron-builder の署名フック

`win.sign` にモジュールを指定すると、electron-builder がアプリ本体の exe と
NSIS インストーラの双方に対してフックを呼ぶ。
この中で署名すれば、マニフェストは署名済みファイルから計算されるので書き直しが要らない。

ただし **SignPath は署名要求ごとに人手の承認を求める**。
フックは複数回呼ばれるので、1回のビルドで承認が複数回必要になる。
また、この構成が実際に動いている事例を確認できていない。

### NSIS の中身は署名できない

SignPath は ZIP や MSI のような複合ファイルなら中身も署名できるが、
**NSIS インストーラは開けない**という報告がある。
つまり署名できるのはインストーラ本体（PE ファイル）で、
その中に入っているアプリ本体の exe は無署名のまま残る。

ダウンロード時と実行時に SmartScreen が見るのはインストーラなので、
実用上はこれで目的を果たす。
アプリ本体まで署名したい場合は案Bが要る。
ここは onboarding のときに SignPath 側へ確認するのが早い。

---

## macOS: Apple Developer Program

**署名しない限り、mac の自動更新は実装できない。**
Squirrel.Mac が更新物の署名を検証するので、zip ターゲットを用意しても署名が無ければ動かない。

要るもの:

- Apple Developer Program の登録（年 99 USD）
- Developer ID Application 証明書
- notarization（`notarytool` で Apple に提出し、結果を staple する）

CI では、証明書を `CSC_LINK` / `CSC_KEY_PASSWORD` で渡し、
notarization 用に `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` を Secrets に置く。
いまのワークフローは `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` で署名を明示的に止めているので、
その行を外すところから始まる。

---

## 進め方

1. **v0.1.0 を公開する**（申請の前提。無署名のままでよい）
2. README に Code signing policy の節を下書きする
3. 役割を明記する（個人開発なので「author / reviewer / approver をすべて自分が兼ねる」で足りるはず）
4. SignPath Foundation に申請する
5. 承認後、`release.yml` に `sign` / `manifest` の2ジョブを足す
6. マニフェスト再生成のスクリプトを書く
7. 次の版で、署名済み配布物から実際に更新できることを確認する
8. macOS をやるかどうかは、年 99 USD を払うかの判断

1〜4 は手続きで、こちらで完結しない。5〜7 は承認が下りてからでないと書いても確かめられない。

## 未確認のこと

- SignPath Foundation の審査にどれだけかかるか、どの程度の利用実績を求められるかは、
  公開情報からは読み取れなかった
- NSIS インストーラの中身を署名できないという話は、公式文書ではなく他プロジェクトの報告による
- 案B（署名フック）で実際に通している事例を確認できていない
- electron-builder 27 以降は `latest*.yml` 自体に署名する仕組みが入っている。
  いまは 26 系なので手で書き直せるが、上げるときはこの前提が変わる
