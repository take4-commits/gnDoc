# gnDocRd — gnDoc 記法の描画ライブラリ

gnDoc の Markdown（色・枠・フロー図・部品・Mermaid・数式・グラフ など）を、**自分の HTML のページで gnDoc と同じ見た目に描く**ための JavaScript ライブラリです。MIT License で提供しています（[LICENSE](LICENSE)）。

## このフォルダの中身

| ファイル | 中身 |
| --- | --- |
| `gnDocRd.js` | 描画ライブラリ本体 |
| `gnDocRd.min.js` | 同じ物を縮めた版（どちらか一方を使う） |
| `gnDocRd-sample.html` | 使い方の見本。中に Markdown が入っていて、開くと gnDoc と同じ見た目で描かれます。書き換えて自分のページにできます |
| `gnDocRdLibGen.html` | 頼るライブラリ `gnDocRd-libs.js` を作る画面 |
| `LICENSE` | MIT License の全文 |

## 使い方

1. `gnDocRdLibGen.html` をブラウザで開き、「生成」を押して `gnDocRd-libs.js` を作ります（marked・Mermaid・KaTeX などの第三者のライブラリを、各配布元から取ってきて1本にまとめた物です。このリポジトリには入っていません。`gnDoc.exe` の隣で作った物を写しても使えます）
2. 3つを同じフォルダに置きます

```text
任意のフォルダ/
├── gnDocRd-sample.html   # 見本
├── gnDocRd.js            # または gnDocRd.min.js
└── gnDocRd-libs.js       # 1. で作った物
```

```html
<script src="gnDocRd-libs.js"></script>   <!-- 先に読み込む -->
<script src="gnDocRd.js"></script>
<div id="out"></div>
<script> gnDocRd.render('#out', '# 見出し\n\n{red:赤い字} と [[枠囲み]]'); </script>
```

## 主な関数

| 関数 | 働き |
| --- | --- |
| `gnDocRd.render(描く先, Markdown, 設定)` | 図・線まで描きます |
| `gnDocRd.renderScripts()` | ページの中の `<script type="text/markdown">` をまとめて描きます |
| `gnDocRd.print.openCopy('#out', 設定)` | gnDoc の 🖨 と同じ紙面で、写しの窓で刷ります |
| `await gnDocRd.exportHtml('#out', 設定)` | 1つのファイルで開ける HTML の文字列を返します（ライブラリ不要） |
| `gnDocRd.downloadHtml('#out', '資料.html', 設定)` | 単一HTML をダウンロードします |
| `await gnDocRd.checkUpdate()` | **呼んだときだけ**公式リポジトリで新しい版を確かめ、`{ current, latest, url, newer }` を返します（見本の「🆕 新しい版を確かめる」） |

* 外部サーバーで描く図（PlantUML・DBML・D2・Graphviz）は、**既定では送りません**。`gnDocRd.render('#out', md, { endpoints: { plantuml: 'https://kroki.io/plantuml' } })` のように送り先を渡したときだけ送ります
* 設定の全部（コメントの線・印刷の紙の上と下・透かし・単一HTML の地の色など）と、できること・できないことは、[gnDoc 取扱説明書 第15章](../docs/gnDocManual.md#15-描画ライブラリ-gndocrdjs) にあります
* 記法の書き方は [チートシート](../docs/gnDocCheatSheet.md) と [取扱説明書 第11章](../docs/gnDocManual.md#11-記法のリファレンス) のとおりです
* gnDocRd が自分から通信することはありません。通信するのは `checkUpdate()` を呼んだときと、外部描画の送り先を渡したときだけです（[通信の方針](../docs/gnDocNetworkPolicy.md) §3）
