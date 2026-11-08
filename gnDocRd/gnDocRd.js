/*! gnDocRd.js — gnDoc 記法の描画ライブラリ gnDocRd（配布するのはこの1本）
 *  MIT License. Copyright (c) 2026 take4. https://github.com/take4-commits/gnDoc
 *
 *  中身（2026-10-18 利用者「配布ライブラリは、gnDocRdLibGen.js ではなく、gnDocRd.js とし、中身には、libgen含む」）:
 *    - 描画の本体（@gnDocRd-core）… gnDoc 記法の Markdown → HTML（gnDocRd.marked）と、図・線を描く処理（gnDocRd.hydrate ほか）。
 *      **gnDoc.html の区切りから tools/Build-GnDocRd.mjs が書き込む。この部分は直接直さない**
 *    - 簡単に使う入口（@gnDocRd-api）… gnDocRd.render(描く先, Markdown) ほか
 *    - 印刷（v0.4.1。gnDocRd.print）… Ctrl+P で gnDoc と同じ紙面（図の大きさ・紙の上と下・透かし・PDF の中のリンク）・🖨 と同じ写しの窓。
 *      部品の本体は描画の本体と同じく gnDoc.html から書き込む。描いた先へ結び付ける口（enable・openCopy・copyHtml）は @gnDocRd-api
 *    - gnDocRd.libgen（@gnDocRd-libgen）… gnDocRd が頼るライブラリ（marked・Mermaid ほか）を、試験済みの版で取得して1本（gnDocRd-libs.js）に束ねる
 *  gnDoc（exe・HTML 版）の LibGen.html も、このファイルを**手を加えずに**読み込んで使う（libgen だけを使う）。
 *  作る物（gnDocRd-libs.js）は第三者のソフトウェアの結合物。各ライブラリの著作権はそれぞれの権利者にあり、
 *  利用条件は各ライブラリのライセンスに従う（先頭に一覧を書き出す）。作者は第三者のソフトウェアを配らない（生成は使う人の手元）。
 *
 *  使い方（描く。見本は gnDocRd-sample.html。記法の詳しい仕様は gnDoc.exe 付属のドキュメント）:
 *    <script src="gnDocRd-libs.js"></script>   <!-- 先に。gnDocRdLibGen.html で作る -->
 *    <script src="gnDocRd.js"></script>
 *    await gnDocRd.render('#out', '# 見出し\n{red:赤い字} と [[枠]]');
 *
 *  使い方（頼るライブラリを作る）:
 *    const r = await gnDocRd.libgen.build({ log });        // 本体（各ライブラリのブロック＋highlight.js のテーマ）
 *    const text = await gnDocRd.libgen.generate({ log });   // 先頭の表示つきの gnDocRd-libs.js 全体
 *    await gnDocRd.libgen.checkUpdates({ log });            // 表より新しい版があるかを知らせるだけ（取り込まない）
 *
 *  **版は固定する**（2026-10-18 利用者「道具は、安定動作を優先」・docs/gnDoc 描画ライブラリ化 検討.md §7）。
 *  以前の LibGen は多くを「いつも最新」で取っていたので、作り直すたびに試していない版が入った
 *  （marked の主版が上がれば記法の拡張が壊れうる。Mermaid 12 では図の見た目が変わった・v0.3.18o）。
 *  版を上げるときは、下の表を直して作り直し、試験を全部回してからコミットする。
 *
 *  MIT License
 *
 *  Copyright (c) 2026 take4
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the "Software"), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in all
 *  copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *  SOFTWARE.
 */
// @gnDocRd-core:begin
// ここは tools/Build-GnDocRd.mjs が app/gnDoc.html（v0.4.3f）の区切りから書き込んだ物。**直接直さない**（gnDoc.html を直して作り直す）
;(function (root) {
    if (typeof document === 'undefined') return;   // 描くのにブラウザの DOM が要る
    // ---------- 補助の関数（gnDoc.html の @gnDocRd-deps） ----------
    // ---------- コードフェンスの情報文字列の解釈 ----------
    // ```js:src/main.js {3-5,9} showLineNumbers
    //   └言語  └ファイル名      └強調行     └行番号
    // 拡張を何も書かなければ従来と完全に同じ（```js は今までどおり）。
    // 強調行を指定した場合は、どの行かを数えられないと意味が無いので行番号を自動でONにする。
    function parseLineRanges(body) {
        const out = [];
        String(body).split(',').forEach(seg => {
            const s = seg.trim();
            if (!s) return;
            const m = /^(\d+)\s*-\s*(\d+)$/.exec(s);
            if (m) {
                const a = Math.min(+m[1], +m[2]), b = Math.max(+m[1], +m[2]);
                // 桁を打ち間違えた指定（{1-99999}）で要素を作りすぎないよう上限を設ける
                for (let i = a; i <= Math.min(b, a + 999); i++) out.push(i);
            } else if (/^\d+$/.test(s)) {
                out.push(+s);
            }
        });
        return out;
    }
    function parseFenceInfo(info) {
        let raw = String(info || '').trim();
        if (!raw) return { lang: '', file: '', hl: [], lineNumbers: false };
        const hl = [];
        // {1,3-5} は中に空白が入りうるので、空白分割より先に取り除く
        raw = raw.replace(/\{([\d,\s-]+)\}/g, (_, body) => { hl.push(...parseLineRanges(body)); return ' '; });
        const parts = raw.split(/\s+/).filter(Boolean);
        let spec = parts.shift() || '';
        let file = '';
        const colon = spec.indexOf(':');
        if (colon > 0) { file = spec.slice(colon + 1); spec = spec.slice(0, colon); }
        const flags = parts.map(p => p.toLowerCase());
        let lineNumbers = flags.includes('showlinenumbers') || hl.length > 0;
        if (flags.includes('nolinenumbers')) lineNumbers = false;
        return { lang: spec, file, hl: [...new Set(hl)].sort((a, b) => a - b), lineNumbers };
    }

    // ---------- PlantUML/DBML/D2 共通 ----------
    function deflatePlantUML(puml) {
        try {
            console.log('[deflatePlantUML] Input length:', puml.length);
            
            // Kroki / PlantUML v1.2024+ は zlib ラップ付き deflate + base64url を受け取る。
            // pako.deflateRaw ではなく pako.deflate を使うこと（ヘッダを落とすと 400 になる）。
            // pako は combined-libs.js の先頭で必ずロードされるため、未定義になるのは
            // combined-libs.js 自体が無い場合のみ。その場合は素の Markdown ビュワーとして
            // 動作し、ここでは null を返してソース表示へフォールバックする。
            if (typeof pako !== 'undefined') {
                console.log('[deflatePlantUML] Using pako deflate');
                const encoder = new TextEncoder();
                const utf8 = encoder.encode(puml);
                const compressed = pako.deflate(utf8, { level: 9 });
                console.log('[deflatePlantUML] Compressed length:', compressed.length);
                
                let binary = '';
                const chunkSize = 1024;
                for (let i = 0; i < compressed.length; i += chunkSize) {
                    const chunk = compressed.subarray(i, Math.min(i + chunkSize, compressed.length));
                    binary += String.fromCharCode(...Array.from(chunk));
                }
                const result = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
                console.log('[deflatePlantUML] Encoded result length:', result.length, 'First 50 chars:', result.substring(0, 50));
                return result;
            }

            console.error('[deflatePlantUML] pako is not available (combined-libs.js 未ロード)');
            return null;
        } catch (e) {
            console.error('[deflatePlantUML] Error:', e.message);
            return null;
        }
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    // Windows形式の区切り文字（\）を Markdown/URL の区切り（/）へ統一する。
    // HTMLのimgタグ（<img src=".\photo.png">）はエクスプローラーからパスをコピーした
    // ときにバックスラッシュのまま貼られることが多い。以降の判定・解決は全てこの
    // 正規化後の形（フォワードスラッシュ）を基準にする。
    function normalizeRelPath(href) {
        return String(href).replace(/\\/g, '/');
    }
    // data:/http(s):/blob:等のスキーム付きURL、絶対パス、".."を含むパスは対象外（相対パス画像候補のみtrue）
    function isLocalImageCandidate(href) {
        if (!href) return false;
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(href)) return false;
        if (normalizeRelPath(href).split(/[?#]/)[0].split('/').includes('..')) return false;
        return true;
    }

    // ---------- CSV → Chart.js config 変換 (```csv-chart 用) ----------
    // ダブルクォート内のカンマ/タブをエスケープとして扱う簡易分割（RFC4180の""エスケープのみ対応）
    function splitDelimited(line, delim) {
        const cells = [];
        let cur = '', inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"') {
                    if (line[i + 1] === '"') { cur += '"'; i++; }
                    else inQuotes = false;
                } else cur += ch;
            } else {
                if (ch === '"') inQuotes = true;
                else if (ch === delim) { cells.push(cur); cur = ''; }
                else cur += ch;
            }
        }
        cells.push(cur);
        return cells.map(c => c.trim());
    }

    function parseCsvToChartConfig(rawText) {
        const src = rawText.replace(/\r\n/g, '\n').trim();
        const sepIdx = src.indexOf('\n---\n');
        const metaText = sepIdx !== -1 ? src.slice(0, sepIdx) : '';
        const csvText = sepIdx !== -1 ? src.slice(sepIdx + 5) : src;

        // 1. メタデータ解析 (キー: 値)
        const meta = { type: 'bar', title: '' };
        metaText.trim().split('\n').forEach(line => {
            const idx = line.indexOf(':');
            if (idx !== -1) {
                const key = line.slice(0, idx).trim().toLowerCase();
                const val = line.slice(idx + 1).trim();
                meta[key] = val;
            }
        });

        // 2. データ行の分割（カンマ/タブ自動判定、""クォート対応）
        const dataLines = csvText.trim().split('\n').filter(l => l.trim() !== '');
        if (dataLines.length < 2) return null; // ヘッダー+データ1行以上が必要

        const delim = dataLines[0].includes('\t') ? '\t' : ',';
        const rows = dataLines.map(line => splitDelimited(line, delim));

        // 3. ヘッダー行の解析。`系列名|type` で複合グラフのtype個別指定、
        // `系列名|type|軸ID` でさらに軸の手動指定に対応する（`系列名|軸ID` のように
        // typeを省略して軸だけ指定することはできない。位置固定の2要素目をtypeと
        // 決め打ちしているため）。
        const rawHeaders = rows[0];
        const seriesTypes = {};
        const seriesAxis = {};
        const headers = rawHeaders.map((h, i) => {
            if (i === 0) return h;
            const parts = h.split('|').map(s => s.trim());
            if (parts.length >= 2 && parts[1]) seriesTypes[i] = parts[1];
            if (parts.length >= 3 && parts[2]) seriesAxis[i] = parts[2];
            return parts[0];
        });

        // 系列ごとの実効タイプ（`|type` 指定が無ければグラフ全体のtype）。
        // 「量」と「率」のように種類の異なる系列を1本の軸に重ねると、値の桁が
        // 大きい方にスケールが引っ張られ、小さい方（%等）がほぼ横一直線に潰れて
        // 読めなくなる（例: 来店者数300台前後 と 成約率20%前後 の複合グラフ）。
        // `|type` で明示的に型を分けている系列は「種類が違う」とみなし、
        // 主系列＝第1軸(y・左)、副系列＝第2軸(y1・右) へ自動で振り分ける。
        // さらに `|type|軸ID`（例: `|line|y2`）で軸を明示指定した系列は、
        // 種類が一致していてもその軸を優先する（第3軸以降は自動判定の対象外
        // のため、必ず手動指定する）。
        const baseType = meta.type || 'bar';
        const effectiveTypes = headers.slice(1).map((_, i) => seriesTypes[i + 1] || baseType);
        const resolvedAxes = effectiveTypes.map((t, i) => seriesAxis[i + 1] || (t === baseType ? 'y' : 'y1'));
        const hasNonPrimaryAxis = resolvedAxes.some(a => a !== 'y');
        // 複合軸は縦棒/折れ線ベースの直交座標グラフでのみ意味を持つ
        // （円・ドーナツ・レーダー等はyAxisID/scalesの概念自体が無く、指定すると壊れる）。
        // indexAxis:y（横棒）は値軸がx側に回るため対象外。
        const canDualAxis = (baseType === 'bar' || baseType === 'line') && meta.indexaxis !== 'y';
        const useMultiAxis = canDualAxis && hasNonPrimaryAxis;

        const xLabels = [];
        const datasets = headers.slice(1).map((header, i) => {
            const ds = { label: header, data: [] };
            if (seriesTypes[i + 1]) ds.type = effectiveTypes[i];
            if (useMultiAxis) ds.yAxisID = resolvedAxes[i];
            return ds;
        });

        for (let i = 1; i < rows.length; i++) {
            xLabels.push(rows[i][0]);
            for (let j = 1; j < headers.length; j++) {
                const val = parseFloat((rows[i][j] || '').replace(/[^\d.\-]/g, ''));
                datasets[j - 1].data.push(isNaN(val) ? 0 : val);
            }
        }

        // 4. Chart.js 設定オブジェクトの組み立て
        const config = {
            type: meta.type || 'bar',
            data: { labels: xLabels, datasets },
            options: {
                responsive: true,
                plugins: { title: { display: !!meta.title, text: meta.title } }
            }
        };
        if (meta.indexaxis) config.options.indexAxis = meta.indexaxis;
        if (useMultiAxis) {
            // 実際に使われている軸IDだけを組み立てる（'y' は系列が無くても必ず用意する）。
            // 各軸の系列が1本だけなら、軸ラベルに系列名を出す（2本以上載る場合は
            // どの名前を出すか一意に決まらないため無題のままにする）。
            const axisIds = ['y', ...new Set(resolvedAxes.filter(a => a !== 'y'))];
            config.options.scales = {};
            axisIds.forEach(axisId => {
                const labels = datasets.filter(d => d.yAxisID === axisId).map(d => d.label);
                config.options.scales[axisId] = {
                    type: 'linear',
                    position: axisId === 'y' ? 'left' : 'right',
                    title: { display: labels.length === 1, text: labels[0] || '' }
                };
                if (axisId !== 'y') config.options.scales[axisId].grid = { drawOnChartArea: false };
            });
        }
        // `layout: row` は Chart.js のスキーマ外の予約キー。renderChartJs側の
        // groupChartRows() が読み取った後に new Chart() 呼び出し前で削除する。
        if (meta.layout) config._layout = meta.layout;
        return config;
    }
    // ---------- 記法を読む層（gnDoc.html の @gnDocRd） ----------
    const gnDocRd = (function (deps) {
    const { escapeHtml, parseFenceInfo, deflatePlantUML, parseCsvToChartConfig, isLocalImageCandidate, normalizeRelPath } = deps;
    // 頼るライブラリの主版（gnDocRd.js の libgen の表と合わせる。違えば checkLibs() が知らせる）
    const REQUIRES = { marked: 18, Mermaid: 11 };
    // ---------- 色の語彙（{red:…}・表・枠・フロー図・template.js で共通） ----------
    // marked が無くても引けるよう、marked 拡張の if の外に置く。注記は下の「拡張記法: 文字色」にある。
    const MD_COLOR_TONES = ['red', 'blue', 'green', 'orange', 'yellow', 'purple', 'gray', 'teal', 'pink'];
    const MD_COLOR_TONE_JA = { red:'赤', blue:'青', green:'緑', orange:'橙', yellow:'黄', purple:'紫', gray:'灰', teal:'青緑', pink:'桃' };
    const MD_COLOR_ALIASES = {
        red:'red', blue:'blue', green:'green', orange:'orange', purple:'purple',
        gray:'gray', grey:'gray', teal:'teal', pink:'pink', yellow:'yellow',
        '赤':'red', '青':'blue', '緑':'green', '橙':'orange', 'オレンジ':'orange',
        '紫':'purple', '灰':'gray', '桃':'pink', 'ピンク':'pink',
        '黄':'yellow', 'イエロー':'yellow',
        // teal の和名。選択パレットは以前から「青緑」と表示していたのに記法としては
        // 未登録で、パレットからは選べるのに手で書くと効かない状態だった。
        '青緑':'teal'
    };
    MD_COLOR_TONES.forEach(base => {
        const ja = MD_COLOR_TONE_JA[base];
        // 極濃（dkdk）・極淡（ltlt）は 2026-09-29 に足した（5段。利用者決定）。
        // **接頭辞は下の表のものだけ。** ltltdkBlue / ltltltBlue のような重ねは登録しない
        // ＝未知の色名として素通しになる。CSS 綴りの別名（darkdark…）は作らない。
        // （ltdk・dklt は以前は「重ね」として素通しだったが、2026-10-07 から中間の段の名前になった）
        // 中間の2段（やや濃 dklt・やや淡 ltdk）は 2026-10-07 に足した（7段。利用者決定）。
        // 淡い順に ltlt ＜ lt ＜ ltdk ＜ 標準 ＜ dklt ＜ dk ＜ dkdk。ltdk は「淡と標準の中間」、dklt は「標準と濃の中間」。
        [['dkdk', null, '極濃'], ['dklt', null, 'やや濃'], ['dk', 'dark', '濃'], ['lt', 'light', '淡'], ['ltdk', null, 'やや淡'], ['ltlt', null, '極淡']].forEach(([short, long, jaPrefix]) => {
            const cls = short + base;
            MD_COLOR_ALIASES[cls] = cls;                       // dkred（正式表記 dkRed）
            if (long) MD_COLOR_ALIASES[long + base] = cls;     // darkred（CSS 綴りの別名）
            MD_COLOR_ALIASES[jaPrefix + ja] = cls;             // 濃赤
        });
    });
    const MD_HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

    // ---------- marked 拡張 ----------
    // 絵文字の名前。**英語名は GitHub と同じ**（持っていっても同じ絵文字になる）。
    // 日本語名も受ける（2026-09-30 利用者決定）。`:+2:` `:-2:` は GitHub に無い gnDoc 独自の名前（同）。
    // 表に無い名前は記法として扱わない（`:rocket_ship:` や `12:30:45` はそのまま文字で出る）。
    // テンプレートの「😀 絵文字」でも使うので、marked の有無に関わらず置く（v0.3.17y）。
    const GD_EMOJI = [
        ['😄', 'smile', '笑顔'], ['😊', 'blush', 'にっこり'], ['😆', 'laughing', '大笑い'],
        ['😂', 'joy', '泣き笑い'], ['😅', 'sweat_smile', '笑い汗'], ['😢', 'cry', '泣き顔'],
        ['😭', 'sob', '号泣'], ['🤔', 'thinking', '考え中'],
        ['👍', '+1', 'thumbsup', 'いいね'], ['👎', '-1', 'thumbsdown', 'よくない'],
        ['👍👍', '+2'], ['👎👎', '-2'],
        ['👏', 'clap', '拍手'], ['🙏', 'pray', 'お願い'], ['👀', 'eyes', '注目'],
        ['❤️', 'heart', 'ハート'], ['🎉', 'tada', 'お祝い'], ['⚠️', 'warning', '警告'],
        ['💡', 'bulb', 'ひらめき'], ['🔥', 'fire', '炎'], ['🚀', 'rocket', 'ロケット'],
        ['✅', 'white_check_mark', '完了'], ['❌', 'x', 'バツ'], ['⭕', 'o', 'マル'],
        ['❓', 'question', '質問'], ['❗', 'exclamation', 'びっくり'],
        ['📝', 'memo', 'メモ'], ['📌', 'pushpin', 'ピン'],
    ];
    // 外へ出す物（marked が無くても色の語彙と絵文字の表は使える）
    const api = {
        VERSION: '0.1.0-dev', REQUIRES,
        MD_COLOR_TONES, MD_COLOR_TONE_JA, MD_COLOR_ALIASES, MD_HEX_RE, GD_EMOJI,
        marked: null,                 // 記法の拡張を入れた marked の器（marked が無いときは null）
        // 設定（段階1-C）。endpoints は外部サーバー（kroki など）の送り先。**既定は送らない（null）**:
        // 図のソースが外へ出るので、使う側が明示したときだけ送る。gnDoc は設定パネルの値を渡す
        options: { endpoints: { plantuml: null, dbml: null, d2: null, graphviz: null } },
        configure(o) {
            if (o && o.endpoints) Object.assign(api.options.endpoints, o.endpoints);
            return api.options;
        },
        isGxFlow: () => false,        // 枠つきのフロー図の書き方か（選んだ場所で使える装飾を決めるのに使う）
        // 読み込まれたライブラリの主版が REQUIRES と違えば、その一覧を返す（gnDocRd.libgen が書く __GNDOCRD_LIBS__ を見る）
        checkLibs() {
            const libs = (typeof window !== 'undefined' && window.__GNDOCRD_LIBS__ && window.__GNDOCRD_LIBS__.libs) || {};
            return Object.keys(REQUIRES).filter(n => libs[n] && parseInt(libs[n], 10) !== REQUIRES[n])
                .map(n => ({ name: n, loaded: libs[n], requires: REQUIRES[n] + '.x' }));
        },
    };
    if (typeof marked === 'undefined') return api;
    // **個別の器**。拡張・描画の差し替え・walkTokens はすべてここへ入れる（以前は marked.use でページ全体の marked に入れていた）
    const md = new marked.Marked();
    {
        const mathExt = {
            name:'math', level:'inline', start(src){return src.indexOf('$');},
            tokenizer(src){
                // 文中の $…$ は、開きの $ の直後と閉じの $ の直前が空白でなく、閉じの $ の直後が数字でない物だけ（Pandoc と同じ決まり）。
                // 「$100 と $200」のような金額を数式と見ていた（課題管理 §1.22 D5・v0.4.0n）
                const block=/^\$\$([\s\S]+?)\$\$/, inline=/^\$(?=[^\s$])([^\$]*?[^\s\\$])?\$(?!\d)/; let m;
                if(m=block.exec(src)) return {type:'math',raw:m[0],text:m[1].trim(),displayMode:true};
                if((m=inline.exec(src)) && m[0].length>2) return {type:'math',raw:m[0],text:(m[1]||'').trim(),displayMode:false};
            },
            renderer(t){ if(typeof katex!=='undefined') try{return katex.renderToString(t.text,{displayMode:t.displayMode,throwOnError:false,strict:'ignore'});}catch(e){return `<code class="katex-error">${t.raw}</code>`;} return `<code class="katex-error">${t.raw}</code>`; }
        };
        const emojiMap = {};
        GD_EMOJI.forEach(([e, ...names]) => names.forEach(n => { emojiMap[n] = e; }));
        const emojiExt = {
            name:'emoji', level:'inline', start(src){return src.indexOf(':');},
            tokenizer(src){
                const m=/^:([A-Za-z0-9_+-]+|[぀-ヿ㐀-鿿]+):/.exec(src);
                if(m && Object.prototype.hasOwnProperty.call(emojiMap, m[1])) return {type:'emoji',raw:m[0],name:m[1]};
            },
            renderer(t){ return emojiMap[t.name]; }
        };
        // 印・下線・下付き・上付きの中も、ほかの装飾と同じく読み直す（v0.3.18w。`=={Red:赤}==` `++**太**++` が記号のまま出ていた）。
        // 以前は中の文字をそのまま差し込んでいたので、`==a<b==` の `<` も逃がされていなかった（読み直せば文字として逃がされる）。
        function gdNestInline(ctx, type, m) {
            const token = { type, raw: m[0], text: m[1], tokens: [] };
            ctx.lexer.inlineTokens(token.text, token.tokens);
            return token;
        }
        const markExt = {
            name:'mark', level:'inline', start(src){return src.indexOf('=');},
            tokenizer(src){ const m=/^==([^=]+)==/.exec(src); if(m) return gdNestInline(this, 'mark', m); },
            renderer(t){ return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; }
        };
        const insExt = {
            name:'ins', level:'inline', start(src){return src.indexOf('+');},
            tokenizer(src){ const m=/^\+\+([^+]+)\+\+/.exec(src); if(m) return gdNestInline(this, 'ins', m); },
            renderer(t){ return `<u>${this.parser.parseInline(t.tokens)}</u>`; }
        };
        const subExt = {
            name:'sub', level:'inline', start(src){return src.indexOf('~');},
            tokenizer(src){ const m=/^~([^~]+)~/.exec(src); if(m) return gdNestInline(this, 'sub', m); },
            renderer(t){ return `<sub>${this.parser.parseInline(t.tokens)}</sub>`; }
        };
        const supExt = {
            name:'sup', level:'inline', start(src){return src.indexOf('^');},
            tokenizer(src){ const m=/^\^([^^]+)\^/.exec(src); if(m) return gdNestInline(this, 'sup', m); },
            renderer(t){ return `<sup>${this.parser.parseInline(t.tokens)}</sup>`; }
        };
        // ---------- 脚注 [^1] と定義 [^1]: 本文（v0.4.3e・拡張案 C3'。GitHub と同じ書き方） ----------
        // 以前は定義の行がリンクの参照の定義として読まれて**黙って消え**、本文の [^1] は字のまま残っていた。
        // 描き方: 本文の [^1] は上付きの番号（押すと定義へ）。定義は**書いた場所に**「1 本文 ↩」として描く
        // （GitHub は文書の末尾へ集めて番号を振り直すが、gnDoc はブロックごとに描いて差分で描き直すので、
        //  書いた場所に置く。定義は文書の末尾に書くのがふつうなので、見た目はほぼ同じ）。
        // 定義の2行目以降は、行頭を2つ以上の空白かタブで下げて続ける。id は英数字と _- 以外を _ に（要素の id にするため）
        const gdFnId = s => 'gd-fn-' + String(s).replace(/[^\w-]/g, c => '_' + c.codePointAt(0).toString(16));
        const fnDefExt = {
            name: 'gdFnDef', level: 'block', start(src) { const m = /(^|\n)\[\^[^\]\s]+\]:/.exec(src); return m ? m.index + m[1].length : undefined; },
            tokenizer(src) {
                const m = /^\[\^([^\]\s]+)\]:[ \t]*([^\n]*(?:\n(?: {2,}|\t)[^\n]*)*)(?:\n+|$)/.exec(src);
                if (!m) return;
                const text = m[2].replace(/\n(?: {2,}|\t)/g, '\n');
                const token = { type: 'gdFnDef', raw: m[0], label: m[1], text, tokens: [] };
                this.lexer.inline(token.text, token.tokens);
                return token;
            },
            renderer(t) {
                const id = gdFnId(t.label), lab = escapeHtml(t.label);
                return `<div class="gd-fn-def" id="${id}"><span class="gd-fn-label">${lab}</span> <span class="gd-fn-body">${this.parser.parseInline(t.tokens)}</span> <a class="gd-fn-back" href="#${id}-ref" title="本文の [^${lab}] へ戻る">↩</a></div>\n`;
            }
        };
        const fnRefExt = {
            name: 'gdFnRef', level: 'inline', start(src) { return src.indexOf('[^'); },
            tokenizer(src) { const m = /^\[\^([^\]\s]+)\](?!:)/.exec(src); if (m) return { type: 'gdFnRef', raw: m[0], label: m[1] }; },
            renderer(t) { const id = gdFnId(t.label); return `<sup class="gd-fn-ref"><a href="#${id}" id="${id}-ref" title="脚注 ${escapeHtml(t.label)}">${escapeHtml(t.label)}</a></sup>`; }
        };

        // ---------- 拡張記法: 文字色 {red:テキスト} / 枠囲み [[テキスト]]・[[red:テキスト]] ----------
        // 色は「パレット名 → クラス」を基本とし、テーマごとの明度調整を CSS 側へ寄せる。
        // 任意色は #rgb / #rrggbb / #rrggbbaa の書式検証を通ったものだけ style へ出す
        // （DOMPurify の既定設定は style を素通しするため、ここが唯一の防波堤になる）。
        // 未知の色名は「記法として認識しない」= 素の文字列のまま流す。誤検出で本文が
        // 消えるより、書いたとおりに出る方が安全なため。
        // 濃淡は正式表記を dkRed / ltRed とし、darkRed / lightRed と 濃赤 / 淡赤 を別名で受ける。
        // 正式表記に略記を採ったのは、CSS の darkred(#8B0000) と混同されないため。gnDoc の色は
        // テーマ追従のクラスであって固定色ではないので、CSS と同じ綴りにすると嘘の約束になる。
        // また CSS には lightred が存在せず（lightblue/lightgreen はある）、dark/light を借りると
        // 8色を対称に揃えられない。独自語なら濃淡を対称に定義できる。
        // 引き方は「完全一致 → 小文字化して再検索」なので、キーは小文字で1つ登録すれば
        // dkRed / DkRed / dkred のどれでも当たる。
        // 色相は9色。yellow は表・枠の配色（表示機能拡張）で使うために 2026-09-18 に足した。
        // 濃淡は **5段**（極濃 dkdk・濃 dk・標・淡 lt・極淡 ltlt）。2026-09-29 に3段から広げた
        // （利用者決定。2026-09-18 の「4段目は書ける名前にしない」を差し替えた）。
        // **極淡だけは文字色ではなく地**になる（CSS 側の注記を参照）。
        // 色の語彙（MD_COLOR_TONES / MD_COLOR_ALIASES / MD_HEX_RE）は、この if の外（marked 拡張の直前）にある。
        // template.js の色判定（tplIsColor）も同じ表を引くため（課題管理 §1.22 C8）。
        function mdColorAttrs(spec){
            const name = MD_COLOR_ALIASES[spec] || MD_COLOR_ALIASES[String(spec).toLowerCase()];
            if (name) return { cls: ' gd-c-' + name, style: '' };
            if (MD_HEX_RE.test(spec)) return { cls: '', style: ` style="color:${spec}"` };
            return null;
        }
        const colorExt = {
            name:'mdcolor', level:'inline', start(src){ return src.indexOf('{'); },
            tokenizer(src){
                const m = /^\{([^\s:{}]{1,16}):([^{}\n]+)\}/.exec(src);
                if(!m) return;
                const attrs = mdColorAttrs(m[1]);
                if(!attrs) return;
                const token = { type:'mdcolor', raw:m[0], text:m[2], attrs, tokens:[] };
                // 入れ子の装飾を許す。**inlineTokens でその場で読む**（v0.3.18w）。inline() は「後でまとめて読む」予約で、
                // 本文の段落では読まれるが、1行だけを読む所（装飾枠の題・フロー図の箱・部品・注記・parseInline）では読まれず、中身が空になっていた。
                this.lexer.inlineTokens(token.text, token.tokens);
                return token;
            },
            renderer(t){ return `<span class="gd-fg${t.attrs.cls}"${t.attrs.style}>${this.parser.parseInline(t.tokens)}</span>`; }
        };
        // ---------- 表の属性行（表示機能拡張 第1段） ----------
        // GFM の表の直前に `{theme=Blue border=dashed-row width="20%, 30%, 50%"}` を置くと、
        // その表の配色・罫線・列幅をまとめて指定できる。仕様は
        // `docs/gnDoc 表示機能拡張仕様案（枠と表とカラー）_改訂版.md` §5。
        //
        // **後処理で「直前の段落を消して表に適用する」形にはしない。**
        // ビュワーは差分更新なので、**表だけを編集すると表のトークンだけが作り直される**。
        // 属性行の段落は前の描画で既に消えているため、後処理では拾えず**書式が消える**。
        // そこで、字句解析の段階で属性行を独立したトークンにし、walkTokens で
        // **直後の表トークンへ移す**。字句解析は毎回全文に走るので、どちらを編集しても付き直る。
        // 属性行のトークン自身は**何も描かない**（脚注定義や HTML コメントと同じ扱い。
        // 要素を生まないトークンは行番号の対応表が既に扱えている）。
        const TABLE_ATTR_RE = /^\{([^}\n]*)\}[ \t]*\n(?=[ \t]*\|)/;
        // 候補の先頭を marked へ知らせる用。**行頭の `{` だけ**を拾う
        // （行の途中の `{` を返すと、marked はそこで段落を切ってしまう）。
        const TABLE_ATTR_START_RE = /(^|\n)\{[^}\n]*\}[ \t]*\n[ \t]*\|/;
        const tableAttrExt = {
            name: 'gdTableAttr', level: 'block',
            // **行頭の `{` だけを候補にする。**
            // src.indexOf('{') をそのまま返すと、marked は**そこで段落を切って**
            // 拡張の tokenizer を呼ぶ。その結果「本文 {theme=Blue}」のような行から
            // `{theme=Blue}` だけが切り取られて消えた（着手前の版では段落のまま残る）。
            start(src) {
                const m = TABLE_ATTR_START_RE.exec(src);
                if (!m) return;
                return m.index + (m[1] ? 1 : 0);
            },
            tokenizer(src) {
                const m = TABLE_ATTR_RE.exec(src);
                if (!m) return;
                const attrs = parseTableAttrs(m[1]);
                // 中身が1つも解釈できなければ、ただの段落として扱わせる
                // （`{メモ}` のような本文を勝手に消さないため）。
                if (!attrs) return;
                return { type: 'gdTableAttr', raw: m[0], attrs };
            },
            renderer() { return ''; },
        };
        // `theme=Blue border=dashed-row width="20%, 30%"` を読む。
        // 知らない鍵は黙って捨てる（将来の拡張で古い版が壊れないように）。
        // frame（v0.4.1v）: 外枠を角丸で囲み、中は縦横の細線。
        // head（v0.4.1v）: row＝見出し行（既定）・col＝1列目を見出しにして見出し行は出さない・both＝両方。
        // line（v0.4.1v）: 枠線の色だけ（theme と同じ色名・濃淡）。書かなければ theme の色、theme も無ければアクセント色。
        // 利用者「表のスタイルについて、添付画像の様な枠付きの表示形式を設定で選べる仕様に出来るか？もしくは、マークダウン側の拡張で枠付きや枠の色などを指定可能な拡張仕様を検討」→「上記仕様で進めて」
        const TABLE_BORDERS = ['dashed-row','grid','clean','frame'];
        const TABLE_HEADS = ['row','col','both'];
        // 表の配色は**本文の色記法と同じ語彙**を引く。`{theme=Blue}` も `{theme=青}` も通る。
        // **濃淡（ltBlue・ltdkBlue・dkltRed・極淡青 など）も、装飾枠と同じ7段で受ける**
        // （2026-10-08 利用者「表の色指定について、lt,ltlt,ltdk, など、decoBk でサポートしている色指定を全て、指定可能に」）。
        // 以前は色相だけを受けていたので、`{theme=ltBlue}` は黙って捨てられ、灰の表になっていた。
        // 読み方は装飾枠の decoColorOf と同じ（{hue, tone}。極淡 ltlt は色相だけと同じ見た目なので tone は空）。
        // 解釈できない語は属性として採らない＝その行は本文として残る（第1段と同じ方針）。
        function tableThemeName(val) { return decoColorOf(val); }
        function parseTableAttrs(body) {
            const out = {};
            const re = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;
            let m;
            while ((m = re.exec(body)) !== null) {
                const key = m[1].toLowerCase();
                const val = (m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]).trim();
                if (key === 'theme') { const t = tableThemeName(val); if (t) { out.theme = t.hue; out.tone = t.tone; } }
                else if (key === 'border' && TABLE_BORDERS.includes(val.toLowerCase())) out.border = val.toLowerCase();
                else if (key === 'head' && TABLE_HEADS.includes(val.toLowerCase())) out.head = val.toLowerCase();
                else if (key === 'line') { const v = flowLineColorVar(val); if (v) out.line = v; }
                else if (key === 'width') {
                    // 「15%, 12%, 23%」を列ごとの幅にする。数値と単位だけを通す
                    // （style へ入れるので、素性の分からない文字列は入れない）。
                    const cols = val.split(',').map(x => x.trim())
                        .filter(x => /^\d+(?:\.\d+)?(?:%|px|em|rem|ch)$/.test(x));
                    if (cols.length) out.width = cols;
                }
            }
            return Object.keys(out).length ? out : null;
        }
        // ---------- 装飾枠・カード（表示機能拡張 第2段） ----------
        // ```decoBd{title="…" theme=青} … ``` で、地色・枠線・見出し帯の付いた枠を作る。
        //
        // **フェンス（コードブロック）として受ける。** 独自のブロック拡張を書けば
        // トークンを自前で持てるが、閉じフェンスの扱いを marked と二重に持つことになる。
        // フェンスなら marked が切ってくれて、行番号の対応表も既存の「フェンス1つ＝要素1つ」で通る。
        //
        // **名前は decoBd の1つだけ。** 仕様案は `decorativeBorder` / `deco` / `box` も
        // 認めているが、別名が増えるほど書き方が揃わなくなる（課題管理 §1.12）。
        // `box` は本文で普通に出る語でもあり、フェンス名に充てるには広すぎる。
        const DECO_FENCE_RE = /^\s*decoBd\s*(?:\{([^\n]*)\})?\s*$/i;
        function parseDecoFence(info) {
            const m = DECO_FENCE_RE.exec(String(info || ''));
            if (!m) return null;
            const body = m[1] || '';
            // **鍵を省いた書き方も受ける**（課題管理 §1.24・2026-09-30 利用者決定）:
            //     ```decoBd{"安全上の注意" 赤}      ```decoBd{"安全上の注意", 赤}
            //   題 … 最初の半角の `"…"`（または `'…'`）。**全角の引用符と「…」は題にしない**（利用者決定）。
            //   色 … 色相として読める語（`decoBd {green}` / `decoBd{青}`。2026-09-29 利用者決定）。
            //        **2つ以上書いたら後勝ち**（フロー図の箱 `[処理]{青,赤}` と同じ規則。2026-09-30 利用者決定）。
            //   `title=` と `theme=` を書いたときは、そちらが勝つ。`{}` を省いた書き方は受けない（利用者決定）。
            // **左から1回だけ読む。** 先に `鍵=値` を抜いてから残りを割ると、題の中の `=`
            // （`"a=b"`）を鍵と取り違える。読み分けるのは「鍵=値」「"…"」「それ以外の語」の3つ。
            // 値の区切りには `,` `、` も入れる（入れないと `theme=赤, title="…"` の色が `赤,` になって読めない）。
            // **濃淡付き（`{dkGreen}` `{ltdkRed}` `{極淡青}`）も受ける**（2026-10-07 利用者指示。7段）。
            // 濃淡は地の濃さになり、帯と枠線はそれより1つ濃い段、文字は地の明るさから白黒を決める（CSS 側）。
            // 色相だけ（`{赤}`）と極淡（`{ltltRed}`）はこれまでと同じ見た目（極淡の地）。
            const re = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"',、]+))|"([^"]*)"|'([^']*)'|([^\s"',、]+)/g;
            let keyTitle = null, keyTheme = '', quoted = null, wordTheme = '';
            let a;
            while ((a = re.exec(body)) !== null) {
                if (a[1] !== undefined) {
                    const key = a[1].toLowerCase();
                    const val = (a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4]).trim();
                    // 知らない鍵は黙って捨てる（将来の拡張で古い版が壊れないように）。
                    if (key === 'title') keyTitle = val;
                    else if (key === 'theme') keyTheme = decoColorOf(val) || '';
                } else if (a[5] !== undefined || a[6] !== undefined) {
                    if (quoted === null) quoted = (a[5] !== undefined ? a[5] : a[6]).trim();
                } else {
                    const t = decoColorOf(a[7]);
                    if (t) wordTheme = t;
                }
            }
            const c = keyTheme || wordTheme;
            return { title: keyTitle !== null ? keyTitle : (quoted || ''), theme: c ? c.hue : '', tone: c ? c.tone : '' };
        }
        // 色名を {hue, tone} にする（フロー図の箱と同じ読み方）。読めなければ null。
        function decoColorOf(val) {
            const name = MD_COLOR_ALIASES[val] || MD_COLOR_ALIASES[String(val).toLowerCase()];
            const m = name && FLOW_TONE_RE.exec(name);
            if (!m || !MD_COLOR_TONES.includes(m[2])) return null;
            return { hue: m[2], tone: m[1] === 'ltlt' ? '' : (m[1] || '') };
        }
        // 中身は **Markdown として描く**。箇条書きも太字も表も、枠の中でそのまま効く。
        // レンダラの中から marked.parse を呼んでよいことは実測で確かめてある
        // （外側の walkTokens は解析より前に終わっているので、状態を踏まない）。
        // 深さだけは止めておく。枠の中に枠を書き続けられると際限がないため。
        let decoDepth = 0;
        function renderDecoBorder(attrs, text) {
            const cls = ['gd-deco', 'gd-hue', 'gd-hue-' + (attrs.theme || 'gray')];
            if (attrs.tone) cls.push('gd-tone-' + attrs.tone);
            let inner;
            if (decoDepth >= 3) {
                inner = escapeHtml(text || '');
            } else {
                decoDepth++;
                try { inner = md.parse(text || ''); }
                catch (e) { inner = escapeHtml(text || ''); }
                finally { decoDepth--; }
            }
            // 題は**中身と同じ経路では描かない**。帯の中に段落や箇条書きが来ると帯が崩れる。
            // インライン記法だけを通す（`**強調**` は効き、`- 項目` は効かない）。
            const head = attrs.title
                ? `<div class="gd-deco-title">${md.parseInline(attrs.title)}</div>`
                : '';
            return `<div class="${cls.join(' ')}">${head}<div class="gd-deco-body">${inner}</div></div>`;
        }
        // ---------- フロー図（表示機能拡張 第3段） ----------
        // ```flow の中身を **Mermaid の flowchart へ書き換えて**描かせる（利用者決定・決定9）。
        // 自前で描かない理由は、**戻り線のルーティングを持たずに済む**こと。
        // 出力は既存の mermaid と同じ `<div class="mermaid">` なので、
        // 拡大・全画面・SVG保存・印刷・単一HTML書き出しが**そのまま効く**。
        //
        // 書き方（仕様案 §4 を、これまでの段と同じ約束へそろえたもの）:
        //     [ステップ1]{青}
        //     ->
        //     [ステップ2]
        //     ->
        //     [ステップ3]{橙}
        //
        //     3 -> 1 {label="再教育・ループ" bs=dashed}
        //
        // **箱の `{…}` には色名だけを書く。** 表や装飾枠が `theme=` を要るのは、
        // 同じ波かっこに `border=` や `width=` が同居するため。箱は色しか持たないので、
        // 鍵を書かせるのは手間が増えるだけになる。ここでも**書くのは色名ひとつ**。
        const FLOW_FENCE_RE = /^\s*flow\s*(?:\{([^\n]*)\})?\s*$/i;
        // `->` `<-` `<->` `-`（直線）。
        // **仕様案の `=`（結合）と `+`（追加）は見た目が定義されていない。**
        // 勝手に決めると後で食い違うので、**直線として描き、意味は与えない**。
        //
        // 2026-09-29（機能拡張案 X1・X5）:
        //   **太線** `=>` `<=` `<=>`（太矢印）と `==`（太い直線）。細線はこれまでどおり。
        //   **上下の別名** `↓`＝`->`、`↑`＝`<-`、`↕`＝`<->`、太は `⇓` `⇑` `⇕`。
        //   別名は**向きを保証しない**（横並びの図でも `↓` は右向きの矢印になる）。縦に並べたいときは `dir=縦`。
        // head は矢じりの付く端（from / to）。グリッドの自前描画も同じ表を引く。
        const FLOW_CONNECTORS = {
            '->':  { arrow: '-->',  rev: false, from: false, to: true,  thick: false },
            '<-':  { arrow: '-->',  rev: true,  from: true,  to: false, thick: false },
            '<->': { arrow: '<-->', rev: false, from: true,  to: true,  thick: false },
            '-':   { arrow: '---',  rev: false, from: false, to: false, thick: false },
            '=':   { arrow: '---',  rev: false, from: false, to: false, thick: false },
            '+':   { arrow: '---',  rev: false, from: false, to: false, thick: false },
            '=>':  { arrow: '==>',  rev: false, from: false, to: true,  thick: true },
            '<=':  { arrow: '==>',  rev: true,  from: true,  to: false, thick: true },
            '<=>': { arrow: '<==>', rev: false, from: true,  to: true,  thick: true },
            '==':  { arrow: '===',  rev: false, from: false, to: false, thick: true },
        };
        const FLOW_CONNECTOR_ALIASES = { '↓': '->', '↑': '<-', '↕': '<->', '⇓': '=>', '⇑': '<=', '⇕': '<=>' };
        const flowConnector = t => FLOW_CONNECTORS[FLOW_CONNECTOR_ALIASES[t] || t] || null;
        // 箱の `{…}`。**カンマ区切り・キーワード無し・順不同・後勝ち**（機能拡張案 X3）。
        //   色 … 色相（`青` `blue`）か、5段の濃淡付き（`dkBlue` `極淡青`）
        //   形 … `■`（角丸＝既定と同じ）`□`（角の立つ四角）`◇◆`（菱形）`○●`（円）`△▲`（三角）`▽▼`（逆三角）
        // **何も書かなければ角丸。**（2026-09-29 利用者決定。それまでの既定は角の立つ四角だった）
        // 色相だけ（`{青}`）と極淡（`{ltltBlue}`）は同じ見た目＝極淡の地に淡色の枠（これまでの `{青}`）。
        // 読めない語は捨てる（箱そのものは出す）。
        const FLOW_SHAPES = { '■': 'round', '□': 'rect', '◇': 'diamond', '◆': 'diamond', '○': 'circle', '●': 'circle',
                              '△': 'tri', '▲': 'tri', '▽': 'flip', '▼': 'flip' };
        // 7段（2026-10-07）。**長い接頭辞を先に置く**（dklt を dk＋ltred と読まないように）。
        const FLOW_TONE_RE = /^(dkdk|dklt|dk|ltlt|ltdk|lt)?([a-z]+)$/;
        function parseFlowBoxAttrs(body) {
            const out = { hue: '', tone: '', shape: 'round' };
            String(body || '').split(/[,、\s]+/).filter(Boolean).forEach(w => {
                if (FLOW_SHAPES[w]) { out.shape = FLOW_SHAPES[w]; return; }
                const name = MD_COLOR_ALIASES[w] || MD_COLOR_ALIASES[w.toLowerCase()];
                const m = name && FLOW_TONE_RE.exec(name);
                if (!m || !MD_COLOR_TONES.includes(m[2])) return;
                out.hue = m[2];
                out.tone = m[1] === 'ltlt' ? '' : (m[1] || '');
            });
            return out;
        }
        // 箱の色のクラス名。`gdf-blue`（地は極淡）／`gdf-dkblue` など（地がその濃さ、文字は自動で読める側）。
        const flowColorClass = b => 'gdf-' + (b.tone || '') + (b.hue || 'gray');
        function parseFlowFence(info) {
            const m = FLOW_FENCE_RE.exec(String(info || ''));
            if (!m) return null;
            const out = { dir: 'LR' };
            const re = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;
            let a;
            while ((a = re.exec(m[1] || '')) !== null) {
                const key = a[1].toLowerCase();
                const val = (a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4]).trim().toLowerCase();
                // 縦書き（上から下）も選べるようにする。安全の手順書は縦に並べることが多い。
                if (key === 'dir') out.dir = (val === '縦' || val === 'tb' || val === '下') ? 'TB' : 'LR';
            }
            return out;
        }
        // Mermaid のラベルへ入れてはいけない字を落とす。
        // `"` は文字列を閉じてしまい、図ごと「Parse error」になる。
        function flowLabel(s) {
            return String(s || '').replace(/"/g, '”').replace(/\n/g, ' ').trim();
        }
        // 箱の中身は **素の文字列に改行を入れて**渡す。実測でこうなった（Mermaid 11.16）:
        //
        //   | 書き方                                   | 改行             | `**太字**` |
        //   | markdown 文字列（`` ` `` で囲む形）       | **効かない**     | 効く       |
        //   | `<br>` / `<br/>` / `<b>`                 | **消される**     | 効かない   |
        //   | **素の文字列に改行**                      | **効く（`<br>`）** | 効かない   |
        //
        // **改行を採った。** markdown 文字列だと箱の中身が1段落に畳まれて折り返すだけになり、
        // 行ごとに並べた中身が読めなくなる（利用者報告・2026-09-18）。
        // 見出しの太字は失うが、箱の中では**1行目が見出し**だと位置で分かる。
        //
        // **書いた人の箇条書きの印（`-` `*` `+` `・`）は中黒へそろえる。**
        // そのまま渡すと `- ` が文字として出る（Mermaid はラベルの中を箇条書きにしない）。
        //
        // **修飾（`**太**` `{Red:赤}` など）は、描いた後に差し替える**（v0.3.18w・利用者決定 案A）。
        // Mermaid には修飾の印を外した素の文字を渡して箱の大きさと線を決めさせ、描き終えたら箱の中身を
        // 本文と同じ読み方の HTML に替える（applyFlowRich）。色や印は字の幅を変えないので、箱にそのまま収まる。
        // 中身の行の印は `- ` のように**後ろに空白が要る**（`**太**` で始まる行の頭の `*` を印と取り違えない。グリッドと同じ）。
        function flowNodeLines(title, body) {
            const lines = [];
            if (title) lines.push(String(title));
            (body || []).forEach(b => {
                const t = String(b || '').replace(FLOW_ITEM_MARK_RE, '').trim();
                if (t) lines.push('・' + t);
            });
            return lines;
        }
        function flowNodeText(lines) {
            if (!lines.length) return '" "';
            return '"' + lines.map(l => flowPlain(l).replace(/"/g, '”')).join('\n') + '"';
        }
        // 本文と同じ読み方の HTML（行内だけ）と、その文字だけ（数式は $…$ の原文に戻す。Mermaid 側の数式の置き換えに乗せる）。
        // 文字だけを取るのは template の中（読み込みも実行もされない）で行う。
        function flowRich(s) { try { return md.parseInline(String(s || '')); } catch (e) { return escapeHtml(String(s || '')); } }
        function flowPlain(s) {
            const src = String(s || '');
            if (!/[*_~=+^{[:$`<\\]/.test(src)) return src;
            const t = document.createElement('template');
            t.innerHTML = flowRich(src);
            t.content.querySelectorAll('.katex').forEach(k => { const a = k.querySelector('annotation'); k.replaceWith('$' + (a ? a.textContent : k.textContent) + '$'); });
            return t.content.textContent;
        }
        const FLOW_BOX_RE = /^\[([^\]]*)\]\s*(?:\{([^}]*)\})?\s*$/;
        // 線の `{…}` は**引用符の中の `}` で閉じない**（v0.3.18w。`{label="… {Red:赤}"}` で線ごと読めなくなっていた）。
        const FLOW_JUMP_RE = /^(\d+)\s*(<=>|<->|=>|<=|==|->|<-|[↓↑↕⇓⇑⇕])\s*(\d+)\s*(?:\{((?:"[^"]*"|'[^']*'|[^}"'])*)\})?\s*$/;
        // Mermaid の箱の書き方（形ごと）。三角は旧来の書き方に無いので新しい `@{ shape: … }` を使う
        // （同梱の Mermaid 11 で、改行入りのラベルも描けることを 2026-09-29 に確かめた）。
        function flowMermaidNode(id, text, shape) {
            switch (shape) {
                case 'rect':    return `${id}[${text}]`;
                case 'diamond': return `${id}{${text}}`;
                case 'circle':  return `${id}((${text}))`;
                case 'tri':     return `${id}@{ shape: tri, label: ${text} }`;
                case 'flip':    return `${id}@{ shape: flip-tri, label: ${text} }`;
                default:        return `${id}(${text})`;
            }
        }
        function flowToMermaid(src, opts, rich, notes) {
            const lines = String(src || '').split('\n');
            const boxes = [];      // { label, body[], hue }
            const links = [];      // Mermaid の1行
            // 同じ2つの箱を結ぶ線は、Mermaid が書いた順に 0, 1, … と番号を振る（ラベルの差し替え先の data-id）
            const pairNo = {};
            const pairKey = (x, y) => { const k = x + '_' + y; pairNo[k] = (pairNo[k] || 0); return 'L_' + k + '_' + (pairNo[k]++); };
            let pendingConn = null;
            const jumps = [];
            for (const raw of lines) {
                const line = raw.trim();
                if (!line || line.startsWith('#')) continue;      // 空行と覚え書きは読み飛ばす
                const jump = FLOW_JUMP_RE.exec(line);
                if (jump) { jumps.push(jump); continue; }
                const box = FLOW_BOX_RE.exec(line);
                if (box) {
                    boxes.push(Object.assign({ label: flowLabel(box[1]), body: [] }, parseFlowBoxAttrs(box[2])));
                    if (pendingConn && boxes.length >= 2) {
                        const c = flowConnector(pendingConn);
                        const a = 'n' + (boxes.length - 1), b = 'n' + boxes.length;
                        links.push(c.rev ? `  ${b} ${c.arrow} ${a}` : `  ${a} ${c.arrow} ${b}`);
                        if (c.rev) pairKey(b, a); else pairKey(a, b);
                    }
                    pendingConn = null;
                    continue;
                }
                if (flowConnector(line)) { pendingConn = line; continue; }
                // **箱の直後に続く行は、その箱の中身**（仕様案 §6 の書き方）。
                // 見出しの下に箇条書きを並べた箱が、そのまま1つの箱になる。
                // ただし**つなぎを挟んだあとの行は、新しい箱**として扱う。
                // つなぎを書いた時点で「次の箱」を意図しているのが明らかなため。
                if (!pendingConn && boxes.length) { boxes[boxes.length - 1].body.push(flowLabel(line)); continue; }
                // どの箱にも属さない読めない行は**黙って捨てない**。
                // 箱として出して、書いた人に見えるようにする（Mermaid は誤ると図ごと落ちる）。
                boxes.push({ label: flowLabel(line), body: [], hue: '', tone: '', shape: 'round' });
                pendingConn = null;
            }
            if (!boxes.length) return null;
            const out = ['flowchart ' + ((opts && opts.dir) || 'LR')];
            boxes.forEach((b, i) => {
                const ls = flowNodeLines(b.label, b.body);
                out.push('  ' + flowMermaidNode('n' + (i + 1), flowNodeText(ls), b.shape));
                if (rich && ls.some(l => flowPlain(l) !== l)) rich['n' + (i + 1)] = ls.map(flowRich);
            });
            out.push(...links);
            // 戻り線。**番号は箱の並び順**（1 から数える）。
            // `path=bottom` は Mermaid では指示できないので黙って捨てる（線は引かれる）。
            const linkStyles = [];
            let linkNo = links.length;      // Mermaid の linkStyle の番号は、線を書いた順（つなぎの線が先）
            for (const j of jumps) {
                const from = Number(j[1]), to = Number(j[3]);
                // 無い箱を指す線は引けない。**黙って捨てず、図の下に「引けなかった線」として出す**（v0.4.3e。
                // グリッド配置の flow と同じ扱い。以前はここで黙って捨てていた）
                if (!(from >= 1 && from <= boxes.length && to >= 1 && to <= boxes.length)) {
                    if (notes) notes.push(`引けなかった線: ${j[0].trim()}（箱は ${boxes.length} 個。番号は上から 1, 2, … と数えます）`);
                    continue;
                }
                const at = gxLineAttrs(j[4]);
                const label = at.label ? flowLabel(flowPlain(at.label)) : '', dashed = at.dashed;
                // 色は描く直前に今のテーマの色へ差し替える（renderMermaid。Mermaid の linkStyle は var() を読めない）
                if (at.color) { const ph = 'GDLC_' + at.color.slice(2).replace(/-/g, '_'); linkStyles.push(`  linkStyle ${linkNo} stroke:${ph},color:${ph}`); }
                linkNo++;
                // 太線に破線は無い（Mermaid に書き方が無い）。太さを優先する。
                const c = flowConnector(j[2]);
                const kind = c.thick ? c.arrow
                    : (c.from && c.to) ? (dashed ? '<-.->' : '<-->')
                    : (!c.from && !c.to) ? (dashed ? '-.-' : '---')
                    : (dashed ? '-.->' : '-->');
                const [x, y] = c.rev ? [to, from] : [from, to];
                out.push(`  n${x} ${kind}${label ? '|"' + label + '"|' : ''} n${y}`);
                const key = pairKey('n' + x, 'n' + y);
                if (rich && at.label && flowPlain(at.label) !== at.label) rich[key] = flowRich(at.label);
            }
            out.push(...linkStyles);
            // 色。**色を持たない classDef を置く**のが要点（CSS 側の注記を参照）。
            // **色を書かない箱にも灰を当てる。** 当てないと Mermaid の既定色（薄紫）が出て、
            // 「色を書かなければ灰」で揃えている表・装飾枠と食い違う。
            // さらに既定色は固定値なので、その箱だけテーマに追従しなくなる。
            const hues = [...new Set(boxes.map(flowColorClass))];
            hues.forEach(h => out.push(`  classDef ${h} stroke-width:1px`));
            boxes.forEach((b, i) => out.push(`  class n${i + 1} ${flowColorClass(b)}`));
            return out.join('\n');
        }
        // ---------- フロー図のグリッド配置（機能拡張案 X2） ----------
        // `|` で同じ行、`---` の行で次の行。**Mermaid では描かず、HTML で組む。**
        // Mermaid のブロック図（block-beta）も試したが、列を同じだけ割り当てても
        // **箱の幅が中身に合わせて変わった**（2026-09-29 実測: 65px と 49px）。
        // 「各行が全幅・行内は均等割・左右端がそろう」を守れないので採らなかった。
        //
        // **寸法はすべて割合で決め、実寸を測らない。** 箱の幅と隙間を % で持てば、
        // 箱の中心の横位置も % で決まる。線は行と行の間の「通路」（高さ固定）の中を
        // 縦→横→縦で引くので、**矢じりは常に真上か真下を向き**、画面幅が変わっても形が崩れない。
        // 描いた後に測らないので、**印刷・単一HTML書き出し・幅の変更でずれない**。
        //
        // 引けるのは**同じ行の隣どうし**と**上下に隣り合う行どうし**だけ。
        // それ以外（離れた箱・行を飛ばす線）は無理に引かず、図の下に「引けなかった線」として出す。
        // 書いた線を黙って捨てない（Mermaid と違い、図ごと落ちることもない）。
        const FLOW_GRID_GAP = 8;      // 箱と箱の隙間（行の幅に対する %）
        const FLOW_GRID_LANE = 44;    // 行と行の間の通路の高さ（px）
        const FLOW_GRID_SEP_RE = /^-{3,}$/;
        // 行頭の `|` は「同じ段の次の箱」（課題管理 §1.25 案B・2026-09-30 利用者決定）。
        const FLOW_GRID_CONT_RE = /^\|\s*(?=\[)/;
        function isFlowGrid(src) {
            return String(src || '').split('\n').some(l => {
                const t = l.trim();
                return FLOW_GRID_SEP_RE.test(t) || /^\[[^\]]*\]\s*(?:\{[^}]*\})?\s*\|/.test(t) || FLOW_GRID_CONT_RE.test(t);
            });
        }
        // 箱の中身の行に付ける箇条書きの印。**`-` `*` `+` は後ろに空白が要る**
        // （要らないことにすると、`**太字**` の頭の `*` を印と取り違えて削る）。
        const FLOW_ITEM_MARK_RE = /^(?:[-*+]\s+|・\s*)/;
        // `[A]{青} | [B]` を箱に分ける。`[…]` と `{…}` の中の `|` では切らない。
        // **空の欄も数える**のが splitFlowGridCells（中身の行で「何列目か」を `|` の数で決めるため）。
        function splitFlowGridCells(line) {
            const parts = []; let depth = 0, cur = '';
            for (const ch of line) {
                if (ch === '[' || ch === '{') depth++;
                else if ((ch === ']' || ch === '}') && depth > 0) depth--;
                if (ch === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
                cur += ch;
            }
            parts.push(cur);
            return parts.map(x => x.trim());
        }
        function splitFlowGridRow(line) { return splitFlowGridCells(line).filter(x => x !== ''); }
        const FLOW_GRID_EDGE_RE = /^(.+?)\s*(<=>|<->|=>|<=|==|->|<-|[↓↑↕⇓⇑⇕])\s*(.+?)\s*(?:\{((?:"[^"]*"|'[^']*'|[^}"'])*)\})?\s*$/;   // `{…}` は FLOW_JUMP_RE と同じ読み方
        function renderFlowGrid(src) {
            const rows = [[]];
            const boxes = [];          // { row, col, label, hue, tone, shape }
            const edges = [];          // { a, b, c, label, dashed, raw }
            const notes = [];
            // **箱の中身**（課題管理 §1.25 案B）。縦の flow と同じく、箱の直後の行はその箱の中身。
            // ただし中身を受けるのは**1行に箱が1つだけの行**の箱に限る。`[A] | [B]` の下の行は
            // どちらの箱の中身か決まらないので、黙ってどちらかへ入れずに「読めなかった行」として書き方を示す。
            // 中身のある箱を横に並べるときは、1行に1箱ずつ書き、同じ段の次の箱は行頭を `|` にする。
            //     [受付]{青}
            //     - 受付しました。
            //     | [確認]{緑}
            //     - 内容を確認
            // **案A も受ける**（v0.3.17t・2026-10-08 利用者「B案 対応したまま、A案も対応かのうか？」）。
            // 箱を2つ以上並べた行の下では、中身の行を `|` で列に分ける（表と同じ）。`|` の数で何列目の箱かが決まり、
            // 空の欄は飛ばす（2列目だけなら `| 内容`、3列目だけなら `| | 内容`）。`|` の無い行は1列目の箱へ入る。
            //     [受付]{青}      | [確認]{緑}
            //     - 受付しました。 | - 内容を確認
            //                    | - 不備は差し戻し
            // 案B の「行頭の `| [箱]`」とは、`|` の後が `[` かどうかで見分ける（FLOW_GRID_CONT_RE）。
            // 線は `|` を含まないので、`|` のある行は線として読まない（`回路図 | A -> B` を線と取り違えない）。
            let target = null;     // 中身を入れる箱。直前の箱の行に箱が2つ以上あれば、その箱の並び（配列）
            for (const raw of String(src || '').split('\n')) {
                const line = raw.trim();
                if (!line || line.startsWith('#')) continue;
                if (FLOW_GRID_SEP_RE.test(line)) { if (rows[rows.length - 1].length) rows.push([]); target = null; continue; }
                const cont = FLOW_GRID_CONT_RE.test(line);
                if (line.startsWith('[') || cont) {
                    // 箱の行。区切りの `---` を挟まずに次の箱の行が来たら、それも新しい行にする。
                    // 行頭が `|` なら同じ段に続ける。
                    if (!cont && rows[rows.length - 1].length) rows.push([]);
                    const added = [];
                    for (const part of splitFlowGridRow(cont ? line.replace(FLOW_GRID_CONT_RE, '') : line)) {
                        const m = FLOW_BOX_RE.exec(part);
                        const b = m ? Object.assign({ label: m[1] }, parseFlowBoxAttrs(m[2]))
                                    : { label: part, hue: '', tone: '', shape: 'round' };
                        b.body = [];
                        b.row = rows.length - 1; b.col = rows[b.row].length;
                        rows[b.row].push(b); boxes.push(b); added.push(b);
                    }
                    target = added.length === 1 ? added[0] : added;
                    continue;
                }
                if (Array.isArray(target)) {
                    const cells = splitFlowGridCells(line);
                    const isEdge = cells.length === 1 && !FLOW_ITEM_MARK_RE.test(line) && FLOW_GRID_EDGE_RE.test(line);
                    if (!isEdge) {
                        const extra = [];
                        cells.forEach((c, i) => {
                            const t = c.replace(FLOW_ITEM_MARK_RE, '').trim();
                            if (!t) return;
                            if (i < target.length) target[i].body.push(t); else extra.push(t);
                        });
                        if (extra.length) notes.push(`読めなかった欄（この段の箱は ${target.length} 個です。列は | の数で決まります）: ${extra.join(' | ')}`);
                        continue;
                    }
                }
                // **箇条書きの印で始まる行は、`->` を含んでいても線として読まない**
                // （`- 受付 -> 確認の順` を「- 受付 という箱からの線」と取り違えていた）。
                const item = FLOW_ITEM_MARK_RE.test(line);
                const e = item ? null : FLOW_GRID_EDGE_RE.exec(line);
                if (!e && target) {
                    const t = line.replace(FLOW_ITEM_MARK_RE, '').trim();
                    if (t) target.body.push(t);
                    continue;
                }
                if (e) {
                    target = null;
                    const at = gxLineAttrs(e[4]);
                    edges.push({ from: e[1].trim(), to: e[3].trim(), c: flowConnector(e[2]), label: at.label, dashed: at.dashed, color: at.color, raw: line });
                    continue;
                }
                notes.push(`読めなかった行: ${line}`);
            }
            while (rows.length && !rows[rows.length - 1].length) rows.pop();
            if (!boxes.length) return null;
            // 端点は**番号**（左上から行優先・1始まり）か**箱の見出し**。
            const find = key => /^\d+$/.test(key) ? (boxes[Number(key) - 1] || null) : (boxes.find(b => b.label.trim() === key) || null);
            const G = FLOW_GRID_GAP;
            const width = n => (100 - (n - 1) * G) / n;
            const centerX = b => { const w = width(rows[b.row].length); return b.col * (w + G) + w / 2; };
            const gapEdges = new Map();    // "row:col" → 隣の箱との間の線（col と col+1 の間）
            const laneEdges = new Map();   // 上の行番号 → その下の通路の線
            for (const e of edges) {
                const a = find(e.from), b = find(e.to);
                if (!a || !b) { notes.push(`引けなかった線（${!a ? e.from : e.to} という箱が無い）: ${e.raw}`); continue; }
                if (a === b) { notes.push(`引けなかった線（同じ箱どうし）: ${e.raw}`); continue; }
                if (a.row === b.row && Math.abs(a.col - b.col) === 1) {
                    const [l, r] = a.col < b.col ? [a, b] : [b, a];
                    const k = l.row + ':' + l.col;
                    if (!gapEdges.has(k)) gapEdges.set(k, []);
                    // 左の箱から見た矢じり。書いた向きが右→左なら from/to を入れ替える。
                    const flip = a !== l;
                    gapEdges.get(k).push({ e, left: flip ? e.c.to : e.c.from, right: flip ? e.c.from : e.c.to });
                } else if (Math.abs(a.row - b.row) === 1) {
                    const [u, d] = a.row < b.row ? [a, b] : [b, a];
                    const flip = a !== u;
                    if (!laneEdges.has(u.row)) laneEdges.set(u.row, []);
                    laneEdges.get(u.row).push({ e, u, d, up: flip ? e.c.to : e.c.from, down: flip ? e.c.from : e.c.to });
                } else {
                    notes.push(`引けなかった線（隣どうしでない）: ${e.raw}`);
                }
            }
            const esc = escapeHtml;
            const inline = t => { try { return md.parseInline(t); } catch (err) { return esc(t); } };
            const boxHtml = b => {
                const cls = ['fg-box', 'fg-' + b.shape, flowColorClass(b)];
                // 菱形・三角は枠線を SVG で描く（CSS の枠は斜めに引けない）。viewBox は歪ませて箱いっぱいに広げる。
                const poly = { diamond: '50,1 99,50 50,99 1,50', tri: '50,1 99,99 1,99', flip: '1,1 99,1 50,99' }[b.shape];
                // 外形は伸ばしてよいが、線の太さは伸ばさない（CSS の vector-effect で止める。属性はサニタイズで落ちる）。
                const bg = poly ? `<svg class="fg-shape" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="${poly}"/></svg>` : '';
                // 中身は縦の flow（flowNodeText）と同じ見せ方: 1行目が見出し、続く行は「・」を付けて並べる。
                const items = (b.body || []).length
                    ? `<span class="fg-items">${b.body.map(t => `<span class="fg-item">・${inline(t)}</span>`).join('')}</span>` : '';
                return `<div class="${cls.join(' ')}" style="width:${width(rows[b.row].length)}%">${bg}<span class="fg-label">${inline(b.label)}${items}</span></div>`;
            };
            const head = dir => `<span class="fg-head fg-head-${dir}"></span>`;
            const lineCls = e => 'fg-line' + (e.c.thick ? ' fg-thick' : '') + (e.dashed ? ' fg-dashed' : '');
            let html = '';
            rows.forEach((row, r) => {
                html += '<div class="fg-row">';
                row.forEach((b, c) => {
                    html += boxHtml(b);
                    if (c < row.length - 1) {
                        const list = gapEdges.get(r + ':' + c) || [];
                        let inner = '';
                        if (list.length) {
                            const first = list[0].e;
                            const left = list.some(x => x.left), right = list.some(x => x.right);
                            const labels = list.map(x => x.e.label).filter(Boolean);
                            const color = (list.find(x => x.e.color) || { e: {} }).e.color;
                            const cs = color ? ` style="--fg-line-color:var(${color})"` : '';
                            inner = `<span class="${lineCls(first)}"${cs}>${left ? head('left') : ''}${right ? head('right') : ''}</span>`
                                + (labels.length ? `<span class="fg-gap-label"${color ? ` style="color:var(${color})"` : ''}>${labels.map(inline).join(' / ')}</span>` : '');
                        }
                        html += `<div class="fg-gap" style="width:${G}%">${inner}</div>`;
                    }
                });
                html += '</div>';
                if (r < rows.length - 1) {
                    const list = laneEdges.get(r) || [];
                    // **線の見出しがある通路は、文字の高さを見込んで線を置く**（v0.3.18e・利用者「=> の矢印が無く、太線になっている
                    // （label= 指定時に文字に隠れている）。文字高さを考慮して、接続線を配置可能か？」）。
                    // 見出し（16px）と矢じり（12px）が重ならない高さに横線を並べ、足りなければ通路を高くする。
                    const LH = 16, PAD = 12 + LH / 2 + 2, STEP = LH + 4;
                    const labelled = list.some(x => x.e.label);
                    const L = labelled ? Math.max(FLOW_GRID_LANE, 2 * PAD + (list.length - 1) * STEP) : FLOW_GRID_LANE;
                    // **箱の同じ辺（上か下）に出入りする線は、辺の上に並べて置く**（v0.3.18f・利用者「2 -> 6・4 -> 3 を追加したら、
                    // 3 ↓ 6 が 3 <-> 6 に成ってしまった。同じ方向から入る場合、並べて配置する仕様を検討」）。
                    // どの線も箱の真ん中に出入りしていたので、同じ箱へ上下から来る線の縦の区間が重なり、矢じりが向かい合って両向きに見えた。
                    // 並べる順は**相手の箱の横位置の順**（左の箱へ行く線を左に）。線が交わりにくい。間隔は箱の幅を等分（最大 5%）。
                    // **上の箱の下辺と下の箱の上辺が同じ横位置（同じ列）なら、まとめて1組で並べる。** 別々に並べると、上から来る線と
                    // 下へ行く線が同じ横位置になり、1本の線が途切れたように見える。まっすぐ縦の線は1つの位置を上下で使う
                    const ends = new Map();
                    const addEnd = (cx, w, other, set) => { const k = cx.toFixed(2); if (!ends.has(k)) ends.set(k, { cx, w, ps: [] }); const g = ends.get(k); g.w = Math.min(g.w, w); g.ps.push({ other, set }); };
                    list.forEach(x => {
                        const cu = centerX(x.u), cd = centerX(x.d), wu = width(rows[x.u.row].length), wd = width(rows[x.d.row].length);
                        x.x1 = cu; x.x2 = cd;
                        if (Math.abs(cu - cd) < 0.01) { addEnd(cu, Math.min(wu, wd), cu, v => { x.x1 = x.x2 = v; }); return; }
                        addEnd(cu, wu, cd, v => { x.x1 = v; }); addEnd(cd, wd, cu, v => { x.x2 = v; });
                    });
                    ends.forEach(({ cx, w, ps }) => {
                        if (ps.length < 2) return;
                        const step = Math.min(w / (ps.length + 1), 5);
                        ps.sort((p, q) => p.other - q.other).forEach((p, i) => p.set(cx + (i - (ps.length - 1) / 2) * step));
                    });
                    // 横線の高さの順。A の上の縦線と B の下の縦線が同じ横位置なら、A の横線を B より上へ（縦の区間を重ねない）
                    const near = (a, b) => Math.abs(a - b) < 0.01;
                    const bent = x => !near(x.x1, x.x2);
                    const above = (A, B) => A !== B && bent(A) && bent(B) && near(A.x1, B.x2);
                    const order = [], rest = list.slice();
                    while (rest.length) {
                        const i = Math.max(0, rest.findIndex(A => !rest.some(B => above(B, A))));
                        order.push(rest.splice(i, 1)[0]);
                    }
                    let paths = '', extra = '';
                    list.forEach(x => {
                        const k = order.indexOf(x), x1 = x.x1, x2 = x.x2;
                        // 同じ通路の横線が重ならないよう、高さを線ごとにずらす。
                        const y = !labelled ? Math.round(L * (k + 1) / (list.length + 1))
                            : list.length === 1 ? L / 2 : Math.round(PAD + k * (L - 2 * PAD) / (list.length - 1));
                        const color = x.e.color, hs = color ? `;--fg-line-color:var(${color})` : '';
                        // **viewBox で引き伸ばさない。** 横だけ伸ばすと線の太さと破線の間隔まで横に伸びる
                        // （太さを保つ vector-effect 属性はサニタイズで落ちることを 2026-09-29 に確かめた）。
                        // <line> は座標に % を書けるので、横は %・縦は px で直接置く。
                        const cls = 'fg-path' + (x.e.c.thick ? ' fg-thick' : '') + (x.e.dashed ? ' fg-dashed' : '');
                        const seg = (ax, ay, bx, by) => `<line class="${cls}"${color ? ` style="stroke:var(${color})"` : ''} x1="${ax}%" y1="${ay}" x2="${bx}%" y2="${by}"/>`;
                        paths += Math.abs(x1 - x2) < 0.01 ? seg(x1, 0, x1, L)
                            : seg(x1, 0, x1, y) + seg(x1, y, x2, y) + seg(x2, y, x2, L);
                        if (x.up) extra += `<span class="fg-head fg-head-up${x.e.c.thick ? ' fg-thick' : ''}" style="left:${x1}%;top:0${hs}"></span>`;
                        if (x.down) extra += `<span class="fg-head fg-head-down${x.e.c.thick ? ' fg-thick' : ''}" style="left:${x2}%;top:${L}px${hs}"></span>`;
                        if (x.e.label) {
                            // まっすぐ縦の線は、見出しを線の右に置く（線の上に重ねると、線と矢じりが隠れる）
                            const straight = Math.abs(x1 - x2) < 0.01;
                            const lx = straight ? x1 : (x1 + x2) / 2;
                            extra += `<span class="fg-lane-label${straight ? ' fg-side' : ''}" style="left:${lx}%;top:${y}px${color ? `;color:var(${color})` : ''}">${inline(x.e.label)}</span>`;   // 線のラベルも修飾が効く（v0.3.18w）
                        }
                    });
                    html += `<div class="fg-lane" style="height:${L}px">`
                        + (paths ? `<svg class="fg-lane-svg" width="100%" height="${L}" aria-hidden="true">${paths}</svg>` : '')
                        + extra + '</div>';
                }
            });
            if (notes.length) html += `<div class="fg-note">${notes.map(n => '⚠️ ' + esc(n)).join('<br>')}</div>`;
            return `<div class="flowgrid" data-source-code="${encodeURIComponent(src)}" data-source-lang="flow">${html}</div>`;
        }
        // ---------- 枠つきのフロー図と横並び（cols）（v0.3.18b・2026-10-08 仮仕様） ----------
        // 利用者「decoBk と flow の組合わせで表現可能にするための拡張仕様を検討」→ 書き方は「人間が理解出来て、できるだけ
        // シンプルな記述、自然な表記で」→「矢印は『:』で区切った階層指定で（エクセルのシートまたがる参照の様なイメージ）」
        // →「cols で : を使うのは、階層を乗り越えて接続線を描きたい場合」→「両方に対応した実装を進めて」。
        //
        //   [[名前]]{色, 40%, 枠なし} … 枠（cols では1つの列）。次の枠・仕切り・`---` までが中身。続けて書いた枠は横に並ぶ
        //   ---                        … 次の段へ
        //   - - - 文字 - - -           … 点線の仕切り。`- - - ⇒ 文字 - - -` と矢印を入れると、隣の枠へ向かう太矢印
        //   枠の中は **1行＝1段**。行の中は `→` でつなぐか `|` で並べるだけ。`↓` だけの行で上下の段をつなぐ
        //   箱のすぐ下の行は、その箱の中身。**空行の後の文字だけの行は説明文**（枠に直接書く文）
        //   `元 ⇒ 先` … 箱の名前で引く線。名前は頭の言葉だけでよい。**別の枠の箱は `枠の名前:箱の名前`**（`：` も可）
        //               枠の中に書いた線は、自分の枠の中を先に探す。**仕切りのすぐ下に書いた線は、左を左の枠から・右を右の枠から**探す
        //
        // ここで作るのは HTML（枠・箱・説明文）と、線の一覧（data-gx-edges）まで。
        // **線は描いた後に箱の位置を測って引く**（gxDraw。幅の変化・テーマの切り替えで引き直す）。
        // 印刷・単一HTML書き出し・📋 / ⬇ は、測った配置を「素の SVG」（gxToSvg）にして使う。
        const GX_ALIAS = { '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '⇐': '<=', '⇔': '<=>' };
        const gxConnector = t => flowConnector(GX_ALIAS[t] || t);
        const GX_CONN = '<=>|<->|=>|<=|==|->|<-|[→←↔⇒⇐⇔↓↑↕⇓⇑⇕]';
        const GX_FRAME_RE = /^\[\[([^\[\]]+)\]\]\s*(?:\{([^}]*)\})?\s*$/;
        // `- - -` と、間に文字を挟んだ `- - - 文字 - - -`（`---` は「次の段」なので、空白で区切った形だけ）
        const GX_DIV_RE = /^-\s+-\s+-(?:\s+(.*?))?(?:\s+-\s+-\s+-)?\s*$/;
        const GX_HEAD_CONN_RE = new RegExp('^(' + GX_CONN + ')\\s*');
        const GX_VLINK_RE = new RegExp('^(' + GX_CONN + ')\\s*(?:\\{((?:\"[^\"]*\"|\'[^\']*\'|[^}\"\'])*)\\})?$');   // `{…}` は FLOW_JUMP_RE と同じ読み方
        const GX_EDGE_RE = new RegExp('^(.+?)\\s*(' + GX_CONN + ')\\s*(.+?)\\s*(?:\\{((?:\"[^\"]*\"|\'[^\']*\'|[^}\"\'])*)\\})?\\s*$');
        const GX_INLINE_ARROW_RE = new RegExp('\\]\\s*(?:\\{[^}]*\\})?\\s*(?:' + GX_CONN + ')\\s*\\[');
        const COLS_FENCE_RE = /^\s*cols\s*(?:\{[^\n]*\})?\s*$/i;
        // 名前の照合に使う素の文字（強調の記号と余分な空白を落とす）
        const gxPlain = s => String(s || '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
        // **この書き方を使っている flow だけ**を新しい描き方へ回す（使っていなければ、これまでの flow とグリッドのまま）。
        // cols の中の flow は、いつも新しい描き方（cols は新しい記法なので、これまでの見え方を守る相手がいない）。
        function isGxFlow(src) {
            return String(src || '').split('\n').some(l => {
                const t = l.trim();
                return GX_FRAME_RE.test(t) || GX_DIV_RE.test(t) || (t.startsWith('[') && GX_INLINE_ARROW_RE.test(t));
            });
        }
        api.isGxFlow = isGxFlow;
        // 線の `{…}`: `{"差戻し" 点線}`（鍵なし）と、これまでの `{label="差戻し" bs=dashed}` の両方
        // 線の色（v0.3.18e・利用者「接続線の色指定が可能なら」）。色名ひとつ（濃淡も可）を、本文の文字色と同じ CSS の変数名にする
        function flowLineColorVar(word) {
            const c = decoColorOf(word);
            if (!c) return '';
            return c.tone === 'lt' ? `--gd-raw-lt${c.hue}` : `--gd-c-${/^(dk|dkdk)$/.test(c.tone) ? c.tone : ''}${c.hue}`;
        }
        // 線の `{…}` は flow の3つの描き方（Mermaid・グリッド・枠つき）で共通。色は `{… 赤}` か `color=赤`
        function gxLineAttrs(body) {
            const out = { label: '', dashed: false, color: '' };
            const re = /([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"',、]+))|"([^"]*)"|'([^']*)'|([^\s"',、]+)/g;
            let a;
            while ((a = re.exec(String(body || ''))) !== null) {
                if (a[1] !== undefined) {
                    const k = a[1].toLowerCase(), v = (a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4]).trim();
                    if (k === 'label') out.label = v;
                    else if (k === 'bs' && v.toLowerCase() === 'dashed') out.dashed = true;
                    else if ((k === 'color' || k === 'colour') && flowLineColorVar(v)) out.color = flowLineColorVar(v);
                } else if (a[5] !== undefined || a[6] !== undefined) out.label = (a[5] !== undefined ? a[5] : a[6]).trim();
                else if (/^(点線|破線|dashed)$/i.test(a[7])) out.dashed = true;
                else if (flowLineColorVar(a[7])) out.color = flowLineColorVar(a[7]);
            }
            return out;
        }
        // 枠の `{…}`: 色（装飾枠と同じ読み方・濃淡も可）・幅 `40%`・`枠なし`。順不同・カンマ区切り
        function gxFrameAttrs(body) {
            const out = { hue: '', tone: '', width: 0, bare: false };
            String(body || '').split(/[,、\s]+/).filter(Boolean).forEach(w => {
                const p = /^(\d{1,2})\s*[%％]$/.exec(w);
                if (p) { out.width = Math.min(90, Math.max(5, +p[1])); return; }
                if (w === '枠なし') { out.bare = true; return; }
                const c = decoColorOf(w);
                if (c) { out.hue = c.hue; out.tone = c.tone; }
            });
            return out;
        }
        // 箱の行。`[A] → [B] | [C]`。箱と箱の間は `|`（並べるだけ）か矢印（つなぐ）。読めなければ null
        function gxParseRow(line) {
            const re = /\[([^\]]*)\]\s*(?:\{([^}]*)\})?/g;
            const out = { boxes: [], links: [] };
            let last = 0, m;
            while ((m = re.exec(line)) !== null) {
                const between = line.slice(last, m.index).trim();
                if (out.boxes.length) {
                    if (between && between !== '|') {
                        const c = gxConnector(between);
                        if (!c) return null;
                        out.links.push({ i: out.boxes.length - 1, c });
                    }
                } else if (between) return null;
                const a = parseFlowBoxAttrs(m[2]);
                out.boxes.push({ label: m[1].trim(), hue: a.hue, tone: a.tone, shape: a.shape });
                last = re.lastIndex;
            }
            if (line.slice(last).trim()) return null;
            return out.boxes.length ? out : null;
        }
        // 名前で引く線（`元 ⇒ 先 {…}`）。解決（どの箱か）は描くときに行う（cols の中の図は後から描かれるため）。
        function gxNamedEdge(m, raw) {
            return Object.assign({ k: 'x', na: m[1].trim(), nb: m[3].trim(), c: gxConnector(m[2]), raw }, gxLineAttrs(m[4]));
        }
        // 仕切りの行（`- - - ⇒ 文字 - - -`）を { label, arrow } にする
        function gxParseDivider(text) {
            let t = String(text || '').trim(), arrow = null;
            const am = GX_HEAD_CONN_RE.exec(t);
            if (am) { arrow = gxConnector(am[1]); t = t.slice(am[0].length).trim(); }
            return { div: true, label: t, arrow };
        }
        function gxDivHtml(d) {
            const arrow = d.arrow ? ` data-gx-arrow="${d.arrow.thick ? 'thick' : 'thin'}${d.arrow.from ? ' from' : ''}${d.arrow.to ? ' to' : ''}"` : '';
            return `<div class="gx-div"${arrow}><span class="gx-div-line"></span>`
                // 仕切りの文字も修飾が効く（v0.3.18w）
                + (d.label ? `<span class="gx-div-label">${gxInline(d.label)}</span>` : '') + '</div>';
        }
        // 仕切りの下に書いた線へ、左右の枠の印を付けて渡す（div の参照は JSON にできないので id にする）
        function gxEdgesOut(edges) {
            return edges.map(e => {
                const o = Object.assign({}, e);
                if (o.div) { o.divLeft = o.div.left ? o.div.left.id : ''; o.divRight = o.div.right ? o.div.right.id : ''; delete o.div; }
                if (o.frame) { o.scope = o.frame.id; delete o.frame; }
                // 線のラベルは SVG の文字で描くので、修飾は効かない。記号が出ないよう、修飾を外した文字にする（v0.3.18w）
                if (o.label) o.label = flowPlain(o.label);
                return o;
            });
        }
        function gxWrap(kind, src, lang, html, edges, notes) {
            const note = notes.length ? `<div class="gx-note-err">${notes.map(n => '⚠️ ' + escapeHtml(n)).join('<br>')}</div>` : '';
            return `<div class="gx ${kind}" data-gx-edges="${encodeURIComponent(JSON.stringify(gxEdgesOut(edges)))}"`
                + ` data-source-code="${encodeURIComponent(src)}" data-source-lang="${lang}">${html}<div class="gx-msg"></div>${note}</div>`;
        }
        const gxInline = t => { try { return md.parseInline(t); } catch (err) { return escapeHtml(t); } };
        function gxFrameClass(f, extra) {
            const cls = extra.slice();
            if (f.bare) cls.push('gx-bare');
            else { cls.push('gd-hue', 'gd-hue-' + (f.hue || 'gray')); if (f.tone) cls.push('gd-tone-' + f.tone); }
            return cls.join(' ');
        }
        const gxFlex = f => f.width ? `flex:0 0 ${f.width}%` : 'flex:1 1 0';
        // 段（band）を HTML にする。枠と枠が続くところには溝（gx-gap）を挟む（線の通り道になる）
        function gxBandsHtml(bands, frameHtml) {
            return bands.filter(b => b.length).map(band => '<div class="gx-band">' + band.map((it, k) => {
                if (it.div) return gxDivHtml(it);
                return (k && !band[k - 1].div ? '<div class="gx-gap"></div>' : '') + frameHtml(it);
            }).join('') + '</div>').join('');
        }

        // ---- 枠つきのフロー図 ----
        function parseGxFlow(src) {
            const bands = [[]], frames = [], boxes = [], edges = [], notes = [];
            let frame = null, row = null, content = false, pendingV = null, divZone = null;
            const band = () => bands[bands.length - 1];
            const newFrame = (name, attrs) => {
                frame = Object.assign({ id: 'f' + (frames.length + 1), name: name || '', items: [], boxes: [] }, attrs);
                const last = band()[band().length - 1];
                if (last && last.div && !last.right) last.right = frame;
                frames.push(frame); band().push(frame);
                row = null; content = false; pendingV = null; divZone = null;
                return frame;
            };
            const ensureFrame = () => frame || newFrame('', { hue: '', tone: '', width: 0, bare: true });
            for (const raw of String(src || '').split('\n')) {
                const line = raw.trim();
                if (line.startsWith('#')) continue;
                if (!line) { content = false; continue; }
                let m;
                if ((m = GX_FRAME_RE.exec(line))) { newFrame(m[1].trim(), gxFrameAttrs(m[2])); continue; }
                if (FLOW_GRID_SEP_RE.test(line)) {
                    if (band().length) bands.push([]);
                    frame = null; row = null; content = false; divZone = null; pendingV = null;
                    continue;
                }
                if ((m = GX_DIV_RE.exec(line))) {
                    const d = gxParseDivider(m[1]);
                    d.left = frame || [...band()].reverse().find(x => !x.div) || null;
                    band().push(d);
                    frame = null; row = null; content = false; divZone = d; pendingV = null;
                    continue;
                }
                // 仕切りのすぐ下（次の枠より前）は、仕切りをまたぐ線だけを書く所
                if (divZone && !frame) {
                    if (!line.startsWith('[') && (m = GX_EDGE_RE.exec(line))) {
                        const e = gxNamedEdge(m, line); e.div = divZone; edges.push(e);
                    } else notes.push(`読めなかった行（仕切りのすぐ下には、仕切りをまたぐ線だけを書きます。枠は [[名前]] で始めます）: ${line}`);
                    continue;
                }
                if (line.startsWith('[')) {
                    const f = ensureFrame();
                    const p = gxParseRow(line);
                    if (!p) { notes.push(`読めなかった行: ${line}`); continue; }
                    const r = { row: true, boxes: p.boxes };
                    p.boxes.forEach(b => { b.id = 'b' + (boxes.length + 1); b.body = []; boxes.push(b); f.boxes.push(b); });
                    p.links.forEach(l => edges.push({ k: 'h', a: r.boxes[l.i].id, b: r.boxes[l.i + 1].id, c: l.c }));
                    if (pendingV) {
                        edges.push({ k: 'v', a: pendingV.from.boxes.map(b => b.id), b: r.boxes.map(b => b.id), c: pendingV.c, label: pendingV.label, dashed: pendingV.dashed, color: pendingV.color });
                        r.laneBefore = true; pendingV = null;
                    }
                    f.items.push(r); row = r; content = true;
                    continue;
                }
                const vm = frame ? GX_VLINK_RE.exec(line) : null;
                if (vm) {
                    if (!row) { notes.push(`読めなかった行（上に箱の段がありません）: ${line}`); continue; }
                    pendingV = Object.assign({ from: row, c: gxConnector(vm[1]) }, gxLineAttrs(vm[2]));
                    content = false;
                    continue;
                }
                // 箱のすぐ下の行は、その箱の中身（箱が2つ以上の段は `|` で列に分ける。グリッドと同じ）
                if (content && row) {
                    if (row.boxes.length === 1) {
                        const t = line.replace(FLOW_ITEM_MARK_RE, '').trim();
                        if (t) row.boxes[0].body.push(t);
                    } else splitFlowGridCells(line).forEach((c, i) => {
                        const t = c.replace(FLOW_ITEM_MARK_RE, '').trim();
                        if (!t) return;
                        if (i < row.boxes.length) row.boxes[i].body.push(t);
                        else notes.push(`読めなかった欄（この段の箱は ${row.boxes.length} 個です）: ${t}`);
                    });
                    continue;
                }
                // 空行の後: 名前で引ける線なら線、そうでなければ説明文（「出力① → 遮断要素 A へ」のような文も書けるように）
                const f = ensureFrame();
                const em = !FLOW_ITEM_MARK_RE.test(line) && GX_EDGE_RE.exec(line);
                f.items.push(em ? { note: true, text: line, maybe: Object.assign(gxNamedEdge(em, line), { frame: f }) } : { note: true, text: line });
            }
            if (pendingV) notes.push('読めなかった行（↓ の下に箱の段がありません）');
            if (!boxes.length) return null;
            // 説明文か線かを決める。両端とも、どこかの箱（か枠）の名前の頭に当たれば線
            const names = boxes.map(b => gxPlain(b.label)), fnames = frames.map(f => gxPlain(f.name)).filter(Boolean);
            const hits = key => {
                let k = gxPlain(key);
                const c = /^(.+?)\s*[:：]\s*(.+)$/.exec(k);
                if (c && fnames.some(n => n.startsWith(c[1].trim()))) k = c[2].trim();
                return /^\d+$/.test(k) || names.some(n => n.startsWith(k));
            };
            frames.forEach(f => f.items.forEach(it => {
                if (it.maybe && hits(it.maybe.na) && hits(it.maybe.nb)) { edges.push(it.maybe); it.skip = true; }
                delete it.maybe;
            }));
            return { bands, frames, boxes, edges, notes };
        }
        function renderGxFlow(src) {
            const P = parseGxFlow(src);
            if (!P) return null;
            const boxHtml = (b, w) => {
                const cls = ['gx-box', b.shape === 'rect' ? 'gx-rect' : 'gx-round', b.hue ? flowColorClass(b) : 'gx-plain'];
                const items = b.body.length ? `<span class="gx-items">${b.body.map(t => `<span class="gx-item">${gxInline(t)}</span>`).join('')}</span>` : '';
                return `<div class="${cls.join(' ')}" data-gx-id="${b.id}" data-gx-name="${escapeHtml(gxPlain(b.label))}" style="width:${w}%">`
                    + `<span class="gx-label">${gxInline(b.label)}</span>${items}</div>`;
            };
            const frameHtml = f => {
                let h = (f.name && !f.bare) ? `<div class="gx-title">${gxInline(f.name)}</div>` : '';
                f.items.forEach(it => {
                    if (it.skip) return;
                    if (it.row) {
                        const n = it.boxes.length, w = (100 - (n - 1) * FLOW_GRID_GAP) / n;
                        if (it.laneBefore) h += '<div class="gx-lane"></div>';
                        h += `<div class="gx-row">${it.boxes.map(b => boxHtml(b, w)).join('')}</div>`;
                    } else h += `<div class="gx-note">${gxInline(it.text)}</div>`;
                });
                return `<div class="${gxFrameClass(f, ['gx-frame'])}" data-gx-frame="${f.id}" data-gx-name="${escapeHtml(gxPlain(f.name))}" style="${gxFlex(f)}">${h}</div>`;
            };
            return gxWrap('gx-flow', src, 'flow', gxBandsHtml(P.bands, frameHtml), P.edges, P.notes);
        }

        // ---- cols（列を横に並べる器。列の中身は Markdown） ----
        // 書き方は枠つきのフロー図と同じ（[[名前]]{色} / `---` / `- - - 文字 - - -` / 仕切りの下の線）。
        // 列の中では `---` が「次の段」になるので、区切り線を引きたいときは `***` と書く。
        let colsDepth = 0;
        function renderCols(src) {
            const bands = [[]], cols = [], edges = [], notes = [];
            let col = null, divZone = null, fence = '';
            const band = () => bands[bands.length - 1];
            const newCol = (name, attrs) => {
                col = Object.assign({ id: 'c' + (cols.length + 1), name: name || '', lines: [] }, attrs);
                const last = band()[band().length - 1];
                if (last && last.div && !last.right) last.right = col;
                cols.push(col); band().push(col); divZone = null;
                return col;
            };
            const ensureCol = () => col || newCol('', { hue: '', tone: '', width: 0, bare: true });
            for (const raw of String(src || '').split('\n')) {
                const line = raw.trim();
                // 列の中のコードブロック（flow など）の中身は、構造の行として読まない
                const fm = /^(`{3,}|~{3,})/.exec(line);
                if (fence) {
                    if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length && !line.slice(fm[1].length).trim()) fence = '';
                    ensureCol().lines.push(raw);
                    continue;
                }
                if (fm) { fence = fm[1]; ensureCol().lines.push(raw); continue; }
                let m;
                if ((m = GX_FRAME_RE.exec(line))) { newCol(m[1].trim(), gxFrameAttrs(m[2])); continue; }
                if (FLOW_GRID_SEP_RE.test(line)) { if (band().length) bands.push([]); col = null; divZone = null; continue; }
                if ((m = GX_DIV_RE.exec(line))) {
                    const d = gxParseDivider(m[1]);
                    d.left = col || [...band()].reverse().find(x => !x.div) || null;
                    band().push(d); col = null; divZone = d;
                    continue;
                }
                if (divZone && !col) {
                    if (!line) continue;
                    if (!line.startsWith('[') && (m = GX_EDGE_RE.exec(line))) { const e = gxNamedEdge(m, line); e.div = divZone; edges.push(e); }
                    else notes.push(`読めなかった行（仕切りのすぐ下には、仕切りをまたぐ線だけを書きます。列は [[名前]] で始めます）: ${line}`);
                    continue;
                }
                if (!col && !line) continue;
                ensureCol().lines.push(raw);
            }
            if (!cols.length) return null;
            const colHtml = c => {
                let body;
                if (colsDepth >= 2) body = `<pre>${escapeHtml(c.lines.join('\n'))}</pre>`;
                else {
                    colsDepth++;
                    try { body = md.parse(c.lines.join('\n')); }
                    catch (e) { body = `<pre>${escapeHtml(c.lines.join('\n'))}</pre>`; }
                    finally { colsDepth--; }
                }
                const attrs = `data-gx-frame="${c.id}" data-gx-name="${escapeHtml(gxPlain(c.name))}" style="${gxFlex(c)}"`;
                // 枠のある列は装飾枠と同じ見た目（題は色の帯）
                if (c.bare) return `<div class="gx-col gx-bare" ${attrs}>${body}</div>`;
                const head = c.name ? `<div class="gd-deco-title">${gxInline(c.name)}</div>` : '';
                return `<div class="${gxFrameClass(c, ['gx-col', 'gd-deco'])}" ${attrs}>${head}<div class="gd-deco-body">${body}</div></div>`;
            };
            return gxWrap('gx-cols', src, 'cols', gxBandsHtml(bands, colHtml), edges, notes);
        }

        // ---------- 部品（機能拡張案 X8 timeline・X9 kpi・X12 gantt-lite。2026-10-07） ----------
        // どれも **1行1項目、列は `|` で区切る**。HTML で組む（幅を保証したいので Mermaid に渡さない）。
        // 外側は `gdpart`。グリッドのフロー図と同じく、`</>` と ✏️ には書いた原文を見せる。
        // **書いていない色は付けない。** 色が付くのは、色名か決まった語（↑↓→・里程碑・重要・注意…）を書いた所だけ。
        // 読めない行は捨てずに、図の下へ「読めなかった行」として出す（原文を失わない）。
        // `#` で始まる行は注記（フロー図と同じ）。
        const PART_FENCE_RE = /^\s*(timeline|kpi|gantt-lite|steps|faq|progress|matrix)(?:\{([A-Za-z-]+)\})?\s*$/i;   // {…} は matrix の種類（v0.4.0o。行の強調の {1,3} は数字だけなので重ならない）
        const partSplit = line => line.split('|').map(s => s.trim());
        const partInline = t => { try { return md.parseInline(t); } catch (err) { return escapeHtml(t); } };
        const partLines = src => String(src || '').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
        // 色名を色相にする（装飾枠と同じ読み方。濃淡は捨てて色相だけ使う）。
        const partHueOf = w => { const c = decoColorOf(w); return c ? c.hue : ''; };
        function partWrap(kind, lang, src, html, notes) {
            const note = notes.length
                ? `<div class="gp-note">${notes.map(n => '⚠️ ' + escapeHtml(n)).join('<br>')}</div>` : '';
            return `<div class="gdpart gd-${kind}" data-source-code="${encodeURIComponent(src)}" data-source-lang="${lang}">${html}${note}</div>`;
        }
        // 読める行が1つも無いときは、原文をコードとして見せる。
        const partEmpty = (kind, lang, src, why) =>
            partWrap(kind, lang, src, `<pre class="gp-raw">${escapeHtml(src)}</pre>`, [why]);

        // timeline … `時点 | 出来事 | 修飾`。縦の軸に点を打ち、左に時点、右に出来事。
        // 修飾は語を並べてよい（`重要, 赤`）。決まった語は印と色を持つ。色名はその色、それ以外は札として出す。
        const TIMELINE_KINDS = {
            '里程碑': { kind: 'milestone', hue: 'blue' }, 'マイルストーン': { kind: 'milestone', hue: 'blue' }, milestone: { kind: 'milestone', hue: 'blue' },
            '重要': { kind: 'important', hue: 'red' }, important: { kind: 'important', hue: 'red' },
            '注意': { kind: 'caution', hue: 'orange' }, '警告': { kind: 'caution', hue: 'orange' }, caution: { kind: 'caution', hue: 'orange' }, warning: { kind: 'caution', hue: 'orange' },
            '完了': { kind: 'done', hue: 'green' }, done: { kind: 'done', hue: 'green' },
        };
        function renderTimeline(src) {
            const items = [], notes = [];
            for (const line of partLines(src)) {
                if (!line.includes('|')) { notes.push('読めなかった行（`時点 | 出来事` と書く）: ' + line); continue; }
                const [time, event = '', mod = ''] = partSplit(line);
                const it = { time, event, kind: '', hue: '', tags: [] };
                mod.split(/[,、\s]+/).filter(Boolean).forEach(w => {
                    const k = TIMELINE_KINDS[w] || TIMELINE_KINDS[w.toLowerCase()];
                    if (k) { it.kind = k.kind; if (!it.hue) it.hue = k.hue; it.tags.push(w); return; }
                    const h = partHueOf(w);
                    if (h) { it.hue = h; return; }
                    it.tags.push(w);
                });
                items.push(it);
            }
            if (!items.length) return partEmpty('timeline', 'timeline', src, '読める行がありません。`時点 | 出来事 | 修飾` の形で書きます');
            const html = '<ol class="gt-list">' + items.map(it => {
                const cls = ['gt-item'];
                if (it.kind) cls.push('gt-' + it.kind);
                if (it.hue) cls.push('gd-hue', 'gd-hue-' + it.hue);
                const tags = it.tags.map(t => `<span class="gt-tag">${escapeHtml(t)}</span>`).join('');
                return `<li class="${cls.join(' ')}"><div class="gt-time">${escapeHtml(it.time)}</div>`
                    + `<div class="gt-dot" aria-hidden="true"></div>`
                    + `<div class="gt-body"><span class="gt-event">${partInline(it.event)}</span>${tags}</div></li>`;
            }).join('') + '</ol>';
            return partWrap('timeline', 'timeline', src, html, notes);
        }

        // kpi … `名称 | 値 | トレンド`。カードを横に並べる（入りきらなければ折り返す）。
        // トレンドの先頭の矢印で色が決まる: ↑緑・↓赤・→灰（機能拡張案 X9 の決まり）。
        // **良し悪しは見ない。** 不良率の ↓ も赤になる（矢印は増減の向きを示すだけ）。
        // 矢印の無いトレンドは色を付けずに文字だけ出す。
        const KPI_TRENDS = { '↑': 'up', '↗': 'up', '⬆': 'up', '↓': 'down', '↘': 'down', '⬇': 'down', '→': 'flat', '↔': 'flat', '➡': 'flat' };
        const KPI_HUES = { up: 'green', down: 'red', flat: 'gray' };
        function renderKpi(src) {
            const cards = [], notes = [];
            for (const line of partLines(src)) {
                if (!line.includes('|')) { notes.push('読めなかった行（`名称 | 値 | トレンド` と書く）: ' + line); continue; }
                const [name, value = '', trend = ''] = partSplit(line);
                const dir = KPI_TRENDS[Array.from(trend)[0]] || '';
                cards.push({ name, value, trend, dir });
            }
            if (!cards.length) return partEmpty('kpi', 'kpi', src, '読める行がありません。`名称 | 値 | トレンド` の形で書きます');
            const html = '<div class="gk-cards">' + cards.map(c => {
                const cls = ['gk-card'];
                if (c.dir) cls.push('gk-' + c.dir, 'gd-hue', 'gd-hue-' + KPI_HUES[c.dir]);
                let trend = '';
                if (c.trend) {
                    const rest = c.dir ? Array.from(c.trend).slice(1).join('').trim() : c.trend;
                    trend = '<div class="gk-trend">'
                        + (c.dir ? `<span class="gk-arrow">${escapeHtml(Array.from(c.trend)[0])}</span>` : '')
                        + (rest ? `<span class="gk-trend-text">${partInline(rest)}</span>` : '') + '</div>';
                }
                return `<div class="${cls.join(' ')}"><div class="gk-name">${partInline(c.name)}</div>`
                    + `<div class="gk-value">${partInline(c.value)}</div>${trend}</div>`;
            }).join('') + '</div>';
            return partWrap('kpi', 'kpi', src, html, notes);
        }

        // gantt-lite … `作業 | 開始 | 終了 | 色・進捗`。Mermaid の gantt より書く量を減らした横棒の工程表。
        //   開始・終了 … 日付（2026-10-01・2026/10/1・2026-10）か、どちらも整数（週番号などの通し番号）。
        //                **終了は含む**（10-01 | 10-03 は3日間）。年月だけの終了はその月の末日まで。
        //                終了には期間も書ける: `5d` `5日` `2w` `2週` `3m` `3か月`。
        //                終了が空か `◆` なら里程標（開始の日に菱形）。
        //   4列目以降 … 色名（棒の色。濃淡も効く）と `60%`（進捗。棒の中に濃い帯）。順不同。
        //   `|` の無い行 … 区分の見出し（その下の作業をまとめる）。
        // 色を書かない棒は灰色（書いていない色を付けない）。今日の線も引かない（書いていない線）。
        const GANTT_DATE_RE = /^(\d{4})[-\/.](\d{1,2})(?:[-\/.](\d{1,2}))?$/;
        const GANTT_SPAN_RE = /^(\d+)\s*(d|日|日間|w|週|週間|m|か月|ヶ月|ケ月|カ月|ヵ月)$/i;
        const ganttDay = (y, m, d) => Date.UTC(y, m - 1, d) / 864e5;
        function ganttFmt(day) {
            const t = new Date(day * 864e5);
            return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
        }
        function renderGanttLite(src) {
            const rows = [], notes = [];
            let mode = '';   // 'date' | 'num'。最初に読めた作業で決め、混ぜたらその行を読めない行にする。
            for (const line of partLines(src)) {
                if (!line.includes('|')) { rows.push({ group: line }); continue; }
                const [name, s = '', e = '', ...attrs] = partSplit(line);
                const bad = why => notes.push(`読めなかった行（${why}）: ${line}`);
                let start, end, ms = false, rm;
                const ds = GANTT_DATE_RE.exec(s);
                if (ds && mode !== 'num') {
                    start = ganttDay(+ds[1], +ds[2], ds[3] ? +ds[3] : 1);
                    const de = GANTT_DATE_RE.exec(e), sp = GANTT_SPAN_RE.exec(e);
                    if (!e || e === '◆' || e === '◇') ms = true;
                    else if (de) end = de[3] ? ganttDay(+de[1], +de[2], +de[3]) + 1 : ganttDay(+de[1], +de[2] + 1, 1);
                    else if (sp) {
                        const n = +sp[1], u = sp[2].toLowerCase();
                        if (u === 'd' || u.startsWith('日')) end = start + n;
                        else if (u === 'w' || u.startsWith('週')) end = start + n * 7;
                        else { const t = new Date(start * 864e5); end = ganttDay(t.getUTCFullYear(), t.getUTCMonth() + 1 + n, t.getUTCDate()); }
                    } else { bad('終了が日付でも期間でもない'); continue; }
                    mode = 'date';
                } else if (/^\d+$/.test(s) && mode !== 'date') {
                    start = +s;
                    if (!e || e === '◆' || e === '◇') ms = true;
                    else if ((rm = /^\d+$/.exec(e))) end = +e + 1;
                    else { bad('開始が番号なら終了も番号で書く'); continue; }
                    mode = 'num';
                } else { bad(ds || /^\d+$/.test(s) ? '日付と番号が混ざっている' : '開始が日付でも番号でもない'); continue; }
                if (!ms && end <= start) { bad('終了が開始より前'); continue; }
                const r = { name, start, end: ms ? start : end, ms, hue: '', tone: '', prog: null };
                attrs.join(',').split(/[,、\s]+/).filter(Boolean).forEach(w => {
                    const p = /^(\d{1,3})\s*[%％]$/.exec(w);
                    if (p) { r.prog = Math.min(100, +p[1]); return; }
                    const c = decoColorOf(w);
                    if (c) { r.hue = c.hue; r.tone = c.tone; }
                });
                rows.push(r);
            }
            const tasks = rows.filter(r => !r.group);
            if (!tasks.length) return partEmpty('gantt', 'gantt-lite', src, '読める行がありません。`作業 | 開始 | 終了` の形で書きます');
            let lo = Math.min(...tasks.map(t => t.start)), hi = Math.max(...tasks.map(t => t.ms ? t.start + 1 : t.end));
            // 目盛り。日付は長さで 日・週・月 を選ぶ。月のときは範囲を月の境目まで広げて、棒と月の列をそろえる。
            const ticks = [];
            if (mode === 'num') {
                const step = Math.max(1, Math.ceil((hi - lo) / 20));
                for (let v = lo; v < hi; v += step) ticks.push({ at: v, label: String(v) });
            } else {
                const span = hi - lo;
                if (span > 92) {
                    const a = new Date(lo * 864e5), b = new Date((hi - 1) * 864e5);
                    lo = ganttDay(a.getUTCFullYear(), a.getUTCMonth() + 1, 1);
                    hi = ganttDay(b.getUTCFullYear(), b.getUTCMonth() + 2, 1);
                    const months = Math.round((hi - lo) / 30.44), step = months > 24 ? 3 : 1;
                    for (let y = a.getUTCFullYear(), m = a.getUTCMonth() + 1, i = 0; ganttDay(y, m, 1) < hi; m++, i++) {
                        if (m > 12) { m = 1; y++; }
                        if (i % step) continue;
                        ticks.push({ at: ganttDay(y, m, 1), label: (i === 0 || m === 1) ? `${y}年${m}月` : `${m}月` });
                    }
                } else {
                    const step = span > 21 ? 7 : 1;
                    for (let v = lo; v < hi; v += step) {
                        const t = new Date(v * 864e5);
                        ticks.push({ at: v, label: `${t.getUTCMonth() + 1}/${t.getUTCDate()}` });
                    }
                }
            }
            const X = v => ((v - lo) / (hi - lo) * 100).toFixed(3);
            const lines = ticks.map(t => `<span class="gg-line" style="left:${X(t.at)}%"></span>`).join('');
            const show = (a, b) => mode === 'num' ? (b === undefined ? `${a}` : `${a}〜${b - 1}`)
                : (b === undefined ? ganttFmt(a) : `${ganttFmt(a)} 〜 ${ganttFmt(b - 1)}`);
            let html = '<div class="gg-row gg-head"><div class="gg-name"></div><div class="gg-track">'
                + ticks.map(t => `<span class="gg-tick" style="left:${X(t.at)}%">${escapeHtml(t.label)}</span>`).join('') + '</div></div>';
            rows.forEach(r => {
                if (r.group) { html += `<div class="gg-group">${partInline(r.group)}</div>`; return; }
                const color = 'gdf-' + (r.tone || '') + (r.hue || 'gray');
                let bar;
                if (r.ms) {
                    bar = `<span class="gg-ms ${color}" style="left:${X(r.start)}%" title="${escapeHtml(show(r.start))}"></span>`;
                } else {
                    const prog = r.prog === null ? '' : `<span class="gg-prog" style="width:${r.prog}%"></span><span class="gg-pct">${r.prog}%</span>`;
                    bar = `<span class="gg-bar ${color}" style="left:${X(r.start)}%;width:${(+X(r.end) - +X(r.start)).toFixed(3)}%"`
                        + ` title="${escapeHtml(show(r.start, r.end))}">${prog}</span>`;
                }
                html += `<div class="gg-row"><div class="gg-name">${partInline(r.name)}</div><div class="gg-track">${lines}${bar}</div></div>`;
            });
            return partWrap('gantt', 'gantt-lite', src, html, notes);
        }

        // ---------- 部品の続き（機能拡張案 X7 steps・X11 faq・X12 progress・X6 matrix。v0.4.0o） ----------
        // 2026-10-24 利用者「X6〜X12 は、実装が軽い順に、順次全て実装を進める。」。作りは timeline・kpi・gantt-lite と同じ。

        // steps … 番号付きの手順。`手順 | 注記`。注記の頭が `注意:`・`警告:` なら橙、`完了条件:`・`確認:` なら緑、ほかは色を付けない。
        // 行の頭の `1.` `①` などの番号は書いても書かなくてもよい（番号は並びの順に振り直す）。
        const STEPS_NOTE_KINDS = [[/^(注意|警告|caution|warning)\s*[:：]/i, 'caution', 'orange'], [/^(完了条件|確認|done|check)\s*[:：]/i, 'done', 'green']];
        function renderSteps(src) {
            const items = [];
            for (const line of partLines(src)) {
                const [head, ...rest] = partSplit(line.replace(/^(\d+[.)．]|[①-⑳])\s*/, ''));
                items.push({ text: head, notes: rest.filter(Boolean) });
            }
            if (!items.length) return partEmpty('steps', 'steps', src, '読める行がありません。1行に1つ、`手順 | 注記` の形で書きます');
            const html = '<ol class="gs-list">' + items.map((it, i) => {
                const notes = it.notes.map(n => {
                    const k = STEPS_NOTE_KINDS.find(([re]) => re.test(n));
                    return `<div class="gs-note${k ? ` gs-${k[1]} gd-hue gd-hue-${k[2]}` : ''}">${partInline(n)}</div>`;
                }).join('');
                return `<li class="gs-item"><span class="gs-num" aria-hidden="true">${i + 1}</span><div class="gs-body"><div class="gs-text">${partInline(it.text)}</div>${notes}</div></li>`;
            }).join('') + '</ol>';
            return partWrap('steps', 'steps', src, html, []);
        }

        // faq … `Q:` で問い、`A:` で答え（次の `Q:` までの行は答えの続き。中は Markdown）。既定は閉じる（<details>）。
        // `Q：` `Q.` `問:` `問い:`・`A：` `A.` `答:` `答え:` も読む。印刷では開いて刷る（buildPrintCopy・Ctrl+P の写し）。
        const FAQ_Q_RE = /^\s*(?:Q|問い?)\s*[:：.．]\s*(.*)$/i, FAQ_A_RE = /^\s*(?:A|答え?)\s*[:：.．]\s*(.*)$/i;
        function renderFaq(src) {
            const items = [], notes = [];
            let cur = null, inA = false;
            for (const raw of String(src || '').split('\n')) {
                let m;
                if ((m = FAQ_Q_RE.exec(raw))) { cur = { q: m[1].trim(), a: [] }; items.push(cur); inA = false; continue; }
                if ((m = FAQ_A_RE.exec(raw)) && cur && !inA) { inA = true; cur.a.push(m[1]); continue; }
                if (/^\s*#/.test(raw) && !inA) continue;
                if (!cur) { if (raw.trim()) notes.push('読めなかった行（`Q:` の前に書いた行）: ' + raw.trim()); continue; }
                if (inA) cur.a.push(raw);
                else if (raw.trim()) cur.q += ' ' + raw.trim();   // 問いの続き
            }
            if (!items.length) return partEmpty('faq', 'faq', src, '読める行がありません。`Q: 問い` と `A: 答え` の形で書きます');
            const html = items.map(it => {
                let body;
                try { body = md.parse(it.a.join('\n').trim()); } catch (e) { body = `<p>${escapeHtml(it.a.join('\n'))}</p>`; }
                return `<details class="gq-item"><summary><span class="gq-mark" aria-hidden="true">Q</span>${partInline(it.q)}</summary>`
                    + `<div class="gq-answer"><span class="gq-mark gq-mark-a" aria-hidden="true">A</span><div class="gq-body">${body}</div></div></details>`;
            }).join('');
            return partWrap('faq', 'faq', src, html, notes);
        }

        // progress … `項目 | 0〜100 | 色`。横棒で進み具合を示す。色を書かない棒は灰色（書いていない色を付けない）。
        // 値は `45` でも `45%` でもよい（100 を超えたら 100、負なら 0 で止める）。`|` の無い行は区分の見出し（gantt-lite と同じ）。
        function renderProgress(src) {
            const rows = [], notes = [];
            for (const line of partLines(src)) {
                if (!line.includes('|')) { rows.push({ group: line }); continue; }
                const [name, v = '', ...attrs] = partSplit(line);
                const m = /^([-+]?\d+(?:\.\d+)?)\s*[%％]?$/.exec(v);
                if (!m) { notes.push('読めなかった行（2列目は 0〜100 の数）: ' + line); continue; }
                const r = { name, value: Math.max(0, Math.min(100, +m[1])), hue: '', tone: '', text: '' };
                attrs.join(',').split(/[,、\s]+/).filter(Boolean).forEach(w => { const c = decoColorOf(w); if (c) { r.hue = c.hue; r.tone = c.tone; } else r.text += (r.text ? ' ' : '') + w; });
                rows.push(r);
            }
            if (!rows.some(r => !r.group)) return partEmpty('progress', 'progress', src, '読める行がありません。`項目 | 0〜100` の形で書きます');
            const html = rows.map(r => {
                if (r.group) return `<div class="gpr-group">${partInline(r.group)}</div>`;
                const color = 'gdf-' + (r.tone || '') + (r.hue || 'gray');
                const val = Number.isInteger(r.value) ? r.value : r.value.toFixed(1);
                return `<div class="gpr-row"><div class="gpr-name">${partInline(r.name)}</div>`
                    + `<div class="gpr-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${val}"><span class="gpr-bar ${color}" style="width:${r.value}%"></span></div>`
                    + `<div class="gpr-val">${val}%${r.text ? ` <span class="gpr-text">${escapeHtml(r.text)}</span>` : ''}</div></div>`;
            }).join('');
            return partWrap('progress', 'progress', src, html, notes);
        }

        // matrix … 2×2 の表。**種類を書いて起動する**（`matrix{swot}`・`matrix{priority}`。機能拡張案 §4「第1段は明示必須」）。
        //   キーの行（`S`・`S,ltltGreen`・`S | 項目`・`強み` など）から次のキーまでが、その枠の本文（1行1項目。空行では切れない）。
        //   swot     … S 強み・W 弱み・O 機会・T 脅威。地の既定は S 緑・W 橙・O 青・T 赤（極淡）。`S,色` で変える
        //   priority … 重要度/緊急度 を `高/高` `高/低` `低/高` `低/低` で書く（`すぐやる` `計画する` `任せる` `減らす` でもよい）。
        //              既定の地は 高/高 赤・高/低 青・低/高 橙・低/低 灰
        // 書いていない枠も、2×2 の形を保つために見出しだけは出す（中は空）。狭い所では1列に崩れる。
        const MATRIX_KINDS = {
            swot: { cells: [
                { keys: ['S', '強み', 'strengths'], title: 'S 強み', hue: 'green' }, { keys: ['W', '弱み', 'weaknesses'], title: 'W 弱み', hue: 'orange' },
                { keys: ['O', '機会', 'opportunities'], title: 'O 機会', hue: 'blue' }, { keys: ['T', '脅威', 'threats'], title: 'T 脅威', hue: 'red' }] },
            priority: { cells: [
                { keys: ['高/高', 'すぐやる'], title: '重要・緊急（すぐやる）', hue: 'red' }, { keys: ['高/低', '計画する', '計画'], title: '重要・急がない（計画する）', hue: 'blue' },
                { keys: ['低/高', '任せる'], title: '重要でない・緊急（任せる）', hue: 'orange' }, { keys: ['低/低', '減らす', 'やめる'], title: '重要でない・急がない（減らす）', hue: 'gray' }],
                head: '<div class="gm-axis">縦: 重要度（上が高）・横: 緊急度（左が高）</div>' },
        };
        function renderMatrix(src, variant) {
            const kind = MATRIX_KINDS[String(variant || '').toLowerCase()];
            if (!kind) return partEmpty('matrix', 'matrix', src, '種類を書きます: ```matrix{swot} か ```matrix{priority}');
            const cells = kind.cells.map(c => ({ ...c, items: [], color: '' }));
            const keyOf = line => {
                const m = /^\s*([^,|:：]+?)\s*(?:[,，]\s*([^|:：]+?))?\s*(?:[|:：]\s*(.*))?$/.exec(line);
                if (!m) return null;
                const w = m[1].trim().replace(/\s+/g, '').replace('／', '/');
                const cell = cells.find(c => c.keys.some(k => k.toLowerCase() === w.toLowerCase()));
                return cell ? { cell, color: (m[2] || '').trim(), rest: (m[3] || '').trim() } : null;
            };
            const notes = [];
            let cur = null;
            for (const line of partLines(src)) {
                const k = keyOf(line);
                if (k) {
                    cur = k.cell;
                    if (k.color) { const c = decoColorOf(k.color); if (c) cur.color = (c.tone || '') + c.hue; else notes.push('色として読めません（既定の色にしました）: ' + k.color); }
                    if (k.rest) cur.items.push(k.rest);
                    continue;
                }
                if (!cur) { notes.push('読めなかった行（最初のキーの前）: ' + line); continue; }
                cur.items.push(line.replace(/^[-*・]\s*/, ''));
            }
            if (!cells.some(c => c.items.length)) return partEmpty('matrix', 'matrix', src, '読める行がありません。キーの行（例 `S`）の下に1行1項目で書きます');
            const html = (kind.head || '') + '<div class="gm-grid">' + cells.map(c => {
                const tone = c.color || c.hue;   // gdf-<色相> が極淡の地（decoColorOf は ltlt を濃淡なしで返す）
                return `<div class="gm-cell gdf-${tone}"><div class="gm-title">${escapeHtml(c.title)}</div>`
                    + (c.items.length ? '<ul class="gm-items">' + c.items.map(t => `<li>${partInline(t)}</li>`).join('') + '</ul>' : '') + '</div>';
            }).join('') + '</div>';
            return partWrap('matrix', 'matrix', src, html, notes);
        }

        // ---------- Mermaid へ書き換える部品（機能拡張案 X10 seq・X12 org。v0.4.0o） ----------
        // flow と同じく、Mermaid の書き方に直して描く。`</>` と ✏️ には書いた原文を見せる（data-source-code）。
        // 名前や文の中の記号は全角に直す（そのままだと図ごと落ちる。flowLabel の `"`→`”` と同じ考え方）。
        // Mermaid の文字の参照（#quot; #35;）は、箱の中ではそのまま字として出て、シーケンスの文では後ろが消えた（v0.4.0o で実測）
        const mmEsc = t => String(t).replace(/"/g, '”').replace(/#/g, '＃').replace(/;/g, '；').replace(/</g, '＜').replace(/>/g, '＞');
        // seq … `A → B: 内容`。`→` `->` `⇒` は実線、`⇢` `-->` は破線（返答など）、`←` `<-` は向きが逆。
        //       行の末尾に `| 非同期` と書くと破線（機能拡張案 §6「非同期 で破線」）。登場した順に左から並べる。
        const SEQ_LINE_RE = /^(.+?)\s*(-->|<--|->|<-|=>|<=|→|←|⇒|⇐|⇢|⇠)\s*([^:：|]+?)\s*(?:[:：]\s*([^|]*?))?\s*(?:\|\s*(.*))?$/;
        function seqToMermaid(src, notes) {
            const names = [], msgs = [];
            const idOf = n => { let i = names.indexOf(n); if (i < 0) { names.push(n); i = names.length - 1; } return 'p' + i; };
            for (const line of partLines(src)) {
                const m = SEQ_LINE_RE.exec(line);
                if (!m) { notes.push('読めなかった行（`A → B: 内容` と書く）: ' + line); continue; }
                let [, a, arrow, b, text = '', mod = ''] = m;
                const back = /^(<--|<-|<=|←|⇐|⇠)$/.test(arrow);
                const dashed = /^(-->|<--|⇢|⇠)$/.test(arrow) || /非同期|async|返答|reply/i.test(mod);
                if (back) [a, b] = [b, a];
                msgs.push(`    ${idOf(a.trim())}${dashed ? '-->>' : '->>'}${idOf(b.trim())}: ${mmEsc(text.trim() || ' ')}`);
            }
            if (!msgs.length) return '';
            return ['sequenceDiagram', ...names.map((n, i) => `    participant p${i} as ${mmEsc(n)}`), ...msgs].join('\n');
        }
        // org … 字下げで階層を書く（空白2つ・タブ・`- ` どれでもよい）。上から下の組織図。`名前 | 補足` の補足は箱の2行目。
        function orgToMermaid(src, notes) {
            const out = ['flowchart TD'], stack = [];
            let n = 0;
            for (const raw of String(src || '').split('\n')) {
                if (!raw.trim() || /^\s*#/.test(raw)) continue;
                const indent = raw.replace(/\t/g, '    ').match(/^ */)[0].length;
                const body = raw.trim().replace(/^[-*+・]\s*/, '');
                const [name, ...rest] = partSplit(body);
                if (!name) { notes.push('読めなかった行: ' + raw.trim()); continue; }
                const id = 'o' + n++;
                out.push(`    ${id}["${mmEsc(name)}${rest.filter(Boolean).length ? '<br/>' + rest.filter(Boolean).map(mmEsc).join('<br/>') : ''}"]`);
                while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
                if (stack.length) out.push(`    ${stack[stack.length - 1].id} --> ${id}`);
                stack.push({ indent, id });
            }
            return n ? out.join('\n') : '';
        }
        const MM_PART_RE = /^\s*(seq|org)\s*$/i;
        function renderMmPart(kind, src) {
            const notes = [];
            const mmd = kind === 'seq' ? seqToMermaid(src, notes) : orgToMermaid(src, notes);
            if (!mmd) return partEmpty(kind, kind, src, kind === 'seq' ? '読める行がありません。`A → B: 内容` の形で書きます' : '読める行がありません。字下げで階層を書きます');
            const note = notes.length ? `<div class="gdpart gd-mmnote"><div class="gp-note">${notes.map(t => '⚠️ ' + escapeHtml(t)).join('<br>')}</div></div>` : '';
            return `<div class="mermaid" data-mermaid-code="${encodeURIComponent(mmd)}" data-source-code="${encodeURIComponent(src)}" data-source-lang="${kind}">${escapeHtml(mmd)}</div>${note}`;
        }

        const PART_RENDERERS = { timeline: renderTimeline, kpi: renderKpi, 'gantt-lite': renderGanttLite,
            steps: renderSteps, faq: renderFaq, progress: renderProgress, matrix: renderMatrix };
        const boxExt = {
            name:'mdbox', level:'inline', start(src){ return src.indexOf('[['); },
            tokenizer(src){
                const m = /^\[\[([^\[\]\n]+)\]\]/.exec(src);
                if(!m) return;
                let text = m[1], attrs = { cls:'', style:'' };
                // 先頭の "色名:" は色指定として解釈する。色名として解釈できない場合は
                // 枠囲み自体を捨てずに、コロンごと本文として扱う（`[[注意: 内容]]` のように
                // 日本語ではコロンを含む文が普通にあるため。ここで棄却すると枠が消えて驚く）。
                const cm = /^([^\s:\[\]]{1,16}):([\s\S]+)$/.exec(text);
                if(cm){ const a = mdColorAttrs(cm[1]); if(a){ attrs = a; text = cm[2]; } }
                const token = { type:'mdbox', raw:m[0], text, attrs, tokens:[] };
                this.lexer.inlineTokens(token.text, token.tokens);   // 色と同じ（v0.3.18w）
                return token;
            },
            renderer(t){ return `<span class="gd-box${t.attrs.cls}"${t.attrs.style}>${this.parser.parseInline(t.tokens)}</span>`; }
        };

        // C4-PlantUML のマクロ判定。素のPlantUMLは `component X` のように小文字＋空白で書くため、
        // 「大文字始まりの識別子＋丸括弧」が行頭に来る形だけを C4 とみなす（誤検出で通常の図を
        // 壊さないよう、境界・関連マクロも明示的に列挙する）。
        const C4_MACRO_RE = /(^|\n)\s*(Person|Person_Ext|System|System_Ext|System_Boundary|Enterprise_Boundary|Boundary|Container|ContainerDb|ContainerQueue|Container_Ext|Container_Boundary|Component|ComponentDb|Component_Ext|Node|Deployment_Node|Rel|Rel_U|Rel_D|Rel_L|Rel_R|Rel_Up|Rel_Down|Rel_Left|Rel_Right|BiRel|Lay_U|Lay_D|Lay_L|Lay_R)\s*\(/;

        // 印刷の幅 `{print=60%}` / `{print=auto}`（v0.4.0w）。どの図のフェンスにも書ける。
        // **言語名を読み分ける前に抜く。** 残すと `mermaid{print=60%}` は言語名が壊れて図にならない（parseFenceInfo は `{…}` を強調する行と読む）。
        // 読めない値は捨てる（指定が無いのと同じ = 自動）。幅は 10〜100%
        function takePrintSpec(lang) {
            const s = String(lang || '');
            let raw = null;
            const rest = s.replace(/([{\s,、])print\s*=\s*["']?([^\s"'},、]+)["']?/i, (m, pre, v) => { raw = v; return pre; });
            if (raw === null) return { lang, spec: '' };
            const v = raw.toLowerCase(), m = /^(\d{1,3}(?:\.\d+)?)%$/.exec(v);
            const spec = v === 'auto' || v === '自動' ? 'auto' : m ? Math.max(10, Math.min(100, +m[1])) + '%' : '';
            return { lang: rest.replace(/\{[\s,、]*\}/, '').trim(), spec };
        }
        const PRINT_SPEC_RE = /^<div\b[^>]*\bclass="(?:mermaid|wavedrom|plantuml|dbml|d2|graphviz|chartjs|gx|flowgrid)\b/;
        function addPrintSpec(html, spec) {
            return spec && PRINT_SPEC_RE.test(html) ? html.replace(/^<div\b/, `<div data-gd-print="${spec}"`) : html;
        }
        const renderer = {
            code({ text, lang }) {
                const pr = takePrintSpec(lang);
                lang = pr.lang;
                const html = (() => {
                const codeText = text || '';
                // **装飾枠は parseFenceInfo より前に見る。**
                // あちらの `{…}` は「強調する行」（{2-3}）の意味なので、
                // `{title="…" theme=青}` を通すと言語名が `decoBd{title="…"` のように壊れる。
                const deco = parseDecoFence(lang);
                if (deco) return renderDecoBorder(deco, codeText);
                // フロー図は Mermaid へ書き換えて、**既存の mermaid の枠にそのまま乗せる**。
                // こうすると拡大・全画面・SVG保存・印刷・単一HTML書き出しが全部効く。
                // 列を横に並べる器（cols）。中身は Markdown（列の中の flow は新しい描き方）
                if (COLS_FENCE_RE.test(String(lang || ''))) { const cols = renderCols(codeText); if (cols) return cols; }
                const flow = parseFlowFence(lang);
                if (flow) {
                    // 枠 `[[…]]`・仕切り `- - -`・行の中の `→` を使っていれば、枠つきのフロー図（cols の中ではいつも）
                    if (colsDepth > 0 || isGxFlow(codeText)) {
                        const gx = renderGxFlow(codeText);
                        if (gx) return gx;
                    }
                    // `|` か `---` があればグリッド配置（HTML で組む）。無ければこれまでどおり Mermaid。
                    if (isFlowGrid(codeText)) {
                        const grid = renderFlowGrid(codeText);
                        if (grid) return grid;
                    }
                    const rich = {}, notes = [];
                    const mmd = flowToMermaid(codeText, flow, rich, notes);
                    const richAttr = (Object.keys(rich).length ? ` data-flow-rich="${encodeURIComponent(JSON.stringify(rich))}"` : '')
                        + (notes.length ? ` data-flow-notes="${encodeURIComponent(JSON.stringify(notes))}"` : '');
                    // **`</>` と ✏️ には、書き換えた後の Mermaid ではなく元の `flow` を見せる。**
                    // 見せないと、利用者は自分が書いていない記法を編集させられる
                    // （利用者報告・2026-09-18）。`data-source-code` は
                    // `getDiagramSourceCode` が型ごとの属性より優先して読む。
                    // 書き戻し先はフェンスの中身そのものなので、`flow` のまま往復する。
                    if (mmd) return `<div class="mermaid" data-mermaid-code="${encodeURIComponent(mmd)}"${richAttr}`
                        + ` data-source-code="${encodeURIComponent(codeText)}" data-source-lang="flow">${escapeHtml(mmd)}</div>`;
                }
                const part = PART_FENCE_RE.exec(String(lang || ''));
                if (part) return PART_RENDERERS[part[1].toLowerCase()](codeText, part[2]);
                const mmPart = MM_PART_RE.exec(String(lang || ''));
                if (mmPart) return renderMmPart(mmPart[1].toLowerCase(), codeText);
                // フェンスの情報文字列から、言語名以外の指定（ファイル名・強調行・行番号）を取り出す。
                // 図表の判定は基底の言語名で行うので、```mermaid のような従来の書き方は一切変わらない。
                const fence = parseFenceInfo(lang);
                lang = fence.lang;
                if (lang === 'mermaid') return `<div class="mermaid" data-mermaid-code="${encodeURIComponent(codeText)}">${codeText}</div>`;
                if (lang === 'wavedrom') return `<div id="wavedrom_${Math.random().toString(36).substr(2,9)}" class="wavedrom" data-wavedrom="${encodeURIComponent(codeText)}">WaveDrom読み込み中...</div>`;
                if (lang === 'plantuml') {
                    let pc = codeText;
                    // C4-PlantUML のマクロを使っている図には標準ライブラリの include を自動で足す。
                    // 挿入位置は必ず @startuml の「次の行」。PlantUML は @startuml より前の行を
                    // 読み飛ばすため、先頭へ足すとマクロが未定義のままになり、
                    // 「Error 400: Syntax Error? (Assumed diagram type: sequence)」で落ちる。
                    if (C4_MACRO_RE.test(pc) && !/!include\s*<C4\//.test(pc)) {
                        const inc = '!include <C4/C4_Container>';
                        pc = /@startuml[^\n]*\n/.test(pc)
                            ? pc.replace(/(@startuml[^\n]*\n)/, `$1${inc}\n`)
                            : `${inc}\n${pc}`;
                    }
                    const deflated = deflatePlantUML(pc);
                    if (!deflated) {
                        return `<div class="plantuml" data-plantuml-code="${encodeURIComponent(pc)}"><pre class="mermaid-error">⚠️ PlantUML Error: 圧縮ライブラリ (pako) が利用できません。LibGen.html で gnDocRd-libs.js を作って配置してください</pre></div>`;
                    }
                    // 送り先は configure で受け取る（既定は送らない）。kroki.io は新しい PlantUML の書き方にも通る
                    const ep = api.options.endpoints.plantuml;
                    if (!ep) return `<div class="plantuml" data-plantuml-code="${encodeURIComponent(pc)}"><pre class="mermaid-error">⚠️ PlantUML: 外部サーバーへの送り先が指定されていないので描きません（gnDocRd.configure の endpoints.plantuml）</pre></div>`;
                    const url = `${ep}/svg/${deflated}`;
                    console.log('[marked renderer] PlantUML code length:', pc.length, 'Encoded length:', deflated.length, 'URL length:', url.length);
                    // srcではなくdata-srcにセットし、renderPlantUML側でロードを制御する（Race Condition回避）
                    return `<div class="plantuml" data-plantuml-code="${encodeURIComponent(pc)}"><div class="plantuml-spinner">PlantUML 描画中...</div><img data-src="${url}" alt="PlantUML" style="display:none"></div>`;
                }

                if (lang === 'dbml') {
                    return `<div class="dbml" data-dbml-code="${encodeURIComponent(codeText)}"><div class="dbml-spinner">DBML 描画中...</div></div>`;
                }
                if (lang === 'd2') {
                    return `<div class="d2" data-d2-code="${encodeURIComponent(codeText)}"><div class="d2-spinner">D2 描画中...</div></div>`;
                }
                if (lang === 'graphviz' || lang === 'dot') {
                    return `<div class="graphviz" data-graphviz-code="${encodeURIComponent(codeText)}"><div class="graphviz-spinner">Graphviz 描画中...</div></div>`;
                }
                if (lang === 'markmap') {
                    return `<div class="markmap" data-markmap-code="${encodeURIComponent(codeText)}"><svg class="markmap-svg"></svg></div>`;
                }
                if (lang === 'chartjs') {
                    return `<div class="chartjs" data-chartjs-code="${encodeURIComponent(codeText)}">Chart.js 描画中...</div>`;
                }
                if (lang === 'csv-chart' || lang === 'chart-csv') {
                    try {
                        const config = parseCsvToChartConfig(codeText);
                        if (!config) {
                            // エラー時も data-source-code を必ず載せる。載せないと 📋/</> ボタンが
                            // 生えず、**直すべきコードに辿り着く手段が無いまま**エラーだけが残る。
                            return `<div class="chartjs" data-source-code="${encodeURIComponent(codeText)}" data-source-lang="csv-chart"><pre class="mermaid-error">⚠️ Chart.js Error: CSVデータが不足しています（ヘッダー行 + データ1行以上が必要です）</pre></div>`;
                        }
                        // 📋コピー・</>ソース表示では、変換後のJSONではなく利用者が書いた
                        // csv-chart のコードを見せる（書いたものと違うコードが出ると混乱するため）。
                        // 描画に使う data-chartjs-code は従来どおり変換後のconfigを保持する。
                        return `<div class="chartjs" data-chartjs-code="${encodeURIComponent(JSON.stringify(config))}" data-source-code="${encodeURIComponent(codeText)}" data-source-lang="csv-chart">Chart.js 描画中...</div>`;
                    } catch (e) {
                        return `<div class="chartjs" data-source-code="${encodeURIComponent(codeText)}" data-source-lang="csv-chart"><pre class="mermaid-error">⚠️ Chart.js Error: ${escapeHtml(e.message)}</pre></div>`;
                    }
                }
                if (lang === 'cytoscape') {
                    return `<div class="cytoscape" data-cytoscape-code="${encodeURIComponent(codeText)}">Cytoscape 読み込み中...</div>`;
                }
                const at = [];
                if (fence.file) at.push(` data-code-file="${escapeHtml(fence.file)}"`);
                if (fence.hl.length) at.push(` data-code-hl="${fence.hl.join(',')}"`);
                if (fence.lineNumbers) at.push(' data-code-linenumbers="1"');
                // ここは必ずエスケープする。生のまま流すと ```html / ```xml のコード例が
                // 本物のタグとして解釈され、DOMPurify に刈られて **中身が消える**
                // （`<div class="x">タグ</div>` が `タグ` だけになる実測済みの不具合）。
                return `<pre class="code-block"${at.join('')}><code class="language-${lang||''}">${escapeHtml(codeText)}</code></pre>`;
                })();
                return addPrintSpec(html, pr.spec);
            },
            image({ href, title, text }) {
                // 相対パス画像は画像フォルダ関連付け（File System Access API）による解決対象。
                // 解決前にリンク切れアイコンが一瞬表示されるのを避けるため<span>プレースホルダを使う。
                if (isLocalImageCandidate(href)) {
                    const relPath = normalizeRelPath(href);
                    return `<span class="local-img-pending" data-local-img-path="${escapeHtml(relPath)}" data-local-img-alt="${escapeHtml(text||'')}">🖼️ 画像読込中...</span>`;
                }
                const t = title ? ` title="${escapeHtml(title)}"` : '';
                return `<img class="gd-img" src="${escapeHtml(href)}" alt="${escapeHtml(text||'')}"${t}>`;
            }
        };
        // ---- 日本語文での強調（CommonMark の flanking 規則をCJK向けに緩める） ----
        // CommonMark は「閉じ側の ** は、直前が約物なら直後が空白か約物でなければならない」
        // という規則（right-flanking）を持つ。単語を空白で区切る言語では妥当だが、
        // 日本語では **…ありません。**次の… のように句点で終わる文を囲むのが自然で、
        // この規則に阻まれて強調が効かず「**」がそのまま表示されてしまう。
        // （**…ありません。** 次の… と空白を入れれば効く、という一貫性のない挙動になる。）
        //
        // 対策として、CJKの約物（、。「」（）…）を「約物ではなく文字」として扱うよう、
        // marked が flanking 判定に使う文字クラスだけを差し替える。強調の対応付け
        // （三の倍数規則・入れ子・区切りの走査）は marked の実装をそのまま使うので、
        // 英文の挙動は一切変わらない（`snake_case_name` や `2 * 3 * 4` も従来どおり）。
        // 同じ規則で ~~取り消し線~~ も直らないため delLDelim/delRDelim も対象に含める。
        const CJK_PUNCT_CLASS = '[\\u3001-\\u303F\\u30A0\\u30FB\\uFE10-\\uFE1F\\uFE30-\\uFE6F\\uFF01-\\uFF65\\uFFE0-\\uFFEE]';
        // marked は punct/punctSpace/notPunctSpace を下記の文字クラスへ展開してから
        // 正規表現を組み立てる。組み上がった source の該当箇所だけを置き換えるので、
        // marked を差し替えても（同じ文字クラスを使う限り）追従できる。
        // 長い綴りから順に置換すること（[^\s\p{P}\p{S}] が [\s\p{P}\p{S}] を含まないよう）。
        const CJK_FLANKING_SUBST = [
            ['[^\\s\\p{P}\\p{S}]', '(?:[^\\s\\p{P}\\p{S}]|' + CJK_PUNCT_CLASS + ')'], // notPunctSpace
            ['[\\s\\p{P}\\p{S}]', '(?!' + CJK_PUNCT_CLASS + ')[\\s\\p{P}\\p{S}]'],     // punctSpace
            ['[\\p{P}\\p{S}]', '(?!' + CJK_PUNCT_CLASS + ')[\\p{P}\\p{S}]'],           // punct
        ];
        const CJK_FLANKING_RULES = ['emStrongLDelim', 'emStrongRDelimAst', 'emStrongRDelimUnd', 'delLDelim', 'delRDelim'];
        const cjkFlankingDone = new WeakSet();
        function relaxFlankingForCjk(inlineRules) {
            if (!inlineRules || cjkFlankingDone.has(inlineRules)) return;
            cjkFlankingDone.add(inlineRules);
            CJK_FLANKING_RULES.forEach(name => {
                const re = inlineRules[name];
                if (!(re instanceof RegExp)) return;
                let src = re.source;
                CJK_FLANKING_SUBST.forEach(([from, to]) => { src = src.split(from).join(to); });
                if (src !== re.source) inlineRules[name] = new RegExp(src, re.flags);
            });
        }
        // 規則の実体は Lexer が生成時に tokenizer へ渡す（normal/gfm/breaks で別物）。
        // どれが使われるかは実行時にしか判らないため、最初の呼び出しで差し替える。
        // false を返すと marked は本来の tokenizer へ処理を委ねる。
        const cjkFlankingTokenizer = {
            emStrong() { relaxFlankingForCjk(this.rules && this.rules.inline); return false; },
            del() { relaxFlankingForCjk(this.rules && this.rules.inline); return false; },
        };
        // 表の属性行を、直後の表トークンへ移す。
        // **字句解析のたびに走るので、属性行と表のどちらを編集しても付き直る。**
        // walkTokens はトークンを文書順に訪れるので、直前に見た属性を覚えておけばよい。
        // **md.parse() 経由と、lexer/parser を分けて呼ぶ経路の両方で効かせる。**
        // walkTokens は md.parse() の中でしか走らない。本アプリの描画は
        // 行番号の印を混ぜるために lexer と parser を分けて呼ぶので、そちらでは自分で回す。
        // 何度走らせても結果は同じ（同じ属性を付け直すだけ）。
        // ページ全体（window）には置かない（gnDocRd の持ち物。v0.3.18y まではページ全体に置いていた）
        api.applyTableAttrsToTokens = function (tokens) {
            let pending = null;
            for (const t of tokens) {
                if (!t) continue;
                if (t.type === 'gdTableAttr') { pending = t.attrs; continue; }
                if (t.type === 'space') continue;            // 空行は挟まっても縁を切らない
                if (t.type === 'table' && pending) t.gdAttrs = pending;
                pending = null;
            }
        };
        let pendingTableAttrs = null;
        function gdWalkTokens(token) {
            if (token.type === 'gdTableAttr') { pendingTableAttrs = token.attrs; return; }
            if (token.type === 'space') return;              // 空行は挟まっても縁を切らない
            if (token.type === 'table' && pendingTableAttrs) { token.gdAttrs = pendingTableAttrs; }
            pendingTableAttrs = null;
        }
        // 既定の表の描画はそのまま使い、開始タグにだけ属性を足す。
        // **セルの描画を自前で書き直さない**（寄せ・インライン記法の扱いを取りこぼすため）。
        const baseTableRenderer = marked.Renderer.prototype.table;
        renderer.table = function (token) {
            const html = baseTableRenderer.call(this, token);
            const a = token && token.gdAttrs;
            // 既定の形（v0.4.1v）: `border=` を書いていない表に当てる罫線（'' / 'frame' / 'grid'）。
            // 使う側が api.tableDefault に入れる（gnDoc のアプリは設定の「表の既定の形」から）。文書に書いた指定が勝つ
            const def = TABLE_BORDERS.includes(api.tableDefault) ? api.tableDefault : '';
            if (!a) return def ? html.replace('<table>', `<table class="gd-border-${def}">`) : html;
            const border = a.border || def;
            // 色相は gd-hue-* が持つ（装飾枠と共通の仕掛け。CSS 側の `.gd-hue` を参照）。
            // 色を書かない枠付きの表は地を塗らない（灰の地にせず、枠はアクセント色。v0.4.1v）
            const cls = !a.theme && border === 'frame' ? [] : ['gd-table', 'gd-hue'];
            if (a.theme) cls.push('gd-hue-' + a.theme);
            if (a.tone) cls.push('gd-tone-' + a.tone);
            if (border) cls.push('gd-border-' + border);
            if (a.head && a.head !== 'row') cls.push('gd-head-' + a.head);
            const style = a.line ? ` style="--gdt-frame: var(${a.line})"` : '';
            let cols = '';
            if (a.width && a.width.length) {
                // 列幅は <colgroup> で与える。style を td/th へ配るより、後から数えやすい。
                cols = '<colgroup>' + a.width.map(w => `<col style="width:${w}">`).join('') + '</colgroup>';
            }
            return html.replace('<table>', `<table${cls.length ? ` class="${cls.join(' ')}"` : ''}${style}>${cols}`);
        };
        // ---------- GFM の注記（Alerts）: > [!NOTE] ほか5種 ----------
        // GitHub と同じ書き方で、同じ5種を受ける（機能拡張案 G2）。**GitHub に持っていっても同じに出る**ので、
        // 独自記法（decoBd）より先にこちらを勧められる。
        //
        // **引用の描画の中だけで判定する。** トークンに印を付けて持ち回すと、差分更新で
        // 引用だけが作り直されたときに印が落ちる（表の属性行で踏んだ）。引用の中身から毎回読み直せば、
        // どの経路で描いても同じになる。外側は <blockquote> のまま（行番号の対応表を変えないため）。
        //
        // 判定は GitHub に合わせる: **1行目が印だけ**のときに限る（`> [!NOTE] 本文` と同じ行に書くと、
        // GitHub でもただの引用になる）。大文字小文字は問わない。知らない種類はただの引用のまま。
        // 色は本文の色記法と同じ変数を使うので、テーマに追従する。
        const GD_ALERTS = {
            note:      { icon: 'ℹ️', label: '注記' },
            tip:       { icon: '💡', label: 'ヒント' },
            important: { icon: '❗', label: '重要' },
            warning:   { icon: '⚠️', label: '警告' },
            caution:   { icon: '⛔', label: '注意' },
        };
        const GD_ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i;
        const baseBlockquoteRenderer = marked.Renderer.prototype.blockquote;
        // **details の要約の中も、行内の修飾を効かせる**（v0.3.18w）。HTML の塊の中は Markdown として読まない決まりなので、
        // `<summary>…</summary>` の中が文字だけのときに限り、行内として読み直す（中にタグを書いた要約はそのまま）。
        // 出来た HTML は、ほかの本文と同じく後で DOMPurify を通る。
        const SUMMARY_RE = /(<summary\b[^>]*>)([^<]*)(<\/summary>)/gi;
        renderer.html = function (token) {
            const text = (token && token.text) || '';
            if (!/<summary/i.test(text)) return text;
            return text.replace(SUMMARY_RE, (m, a, b, c) => b.trim() ? a + flowRich(b.trim()) + c : m);
        };
        renderer.blockquote = function (token) {
            const kids = (token && token.tokens) || [];
            const first = kids[0];
            const m = first && first.type === 'paragraph' ? GD_ALERT_RE.exec(first.text || '') : null;
            if (!m) return baseBlockquoteRenderer.call(this, token);
            const a = GD_ALERTS[m[1].toLowerCase()];
            // 1段落目から印の行だけを外す。残りはインラインとして読み直す（強調やリンクを効かせるため）。
            const rest = (first.text || '').slice(m[0].length);
            const body = [];
            if (rest.trim()) {
                body.push({ type: 'paragraph', raw: rest, text: rest,
                            tokens: marked.Lexer.lexInline(rest, this.parser.options) });
            }
            body.push(...kids.slice(1));
            const title = `<p class="gd-alert-title">${a.icon} ${a.label}</p>`;
            // 色は種類ごとの class で渡す（style 属性は使わない。本文の色記法と同じ約束）。
            return `<blockquote class="gd-alert gd-alert-${m[1].toLowerCase()}">\n${title}\n${this.parser.parse(body)}</blockquote>\n`;
        };
        md.use({ extensions: [fnDefExt, fnRefExt, mathExt, emojiExt, boxExt, colorExt, markExt, insExt, subExt, supExt, tableAttrExt], renderer, tokenizer: cjkFlankingTokenizer, walkTokens: gdWalkTokens });
    }
    api.marked = md;
    return api;
    })({ escapeHtml, parseFenceInfo, deflatePlantUML, parseCsvToChartConfig, isLocalImageCandidate, normalizeRelPath });
    // ---------- 描く層（gnDoc.html の @gnDocRd-draw） ----------
    (function (rd, deps) {
    const { escapeHtml, deflatePlantUML } = deps;
    let viewRoot = null;
    const R = () => viewRoot || document.body;
    // ---------- 使う側の差し込み口（段階1-C） ----------
    //   viewport(el, { zoomBy, reset }) … 図に拡大縮小の操作を付ける（gnDoc は Ctrl+ホイール・ダブルクリック）
    //   prewrap(el)                     … Cytoscape を起こす前に、図を入れ物で包む（起こした後に動かすと描かれない）
    //   diagramReady(el, kind)          … 外部サーバーの図が描けた後（gnDoc は PlantUML の段階表示を付ける）
    // どれも省いてよい（省くと何もしない）
    const hooks = { viewport: null, prewrap: null, diagramReady: null };
    const H = {
        viewport: (el, h) => { if (hooks.viewport) hooks.viewport(el, h); },
        prewrap: el => { if (hooks.prewrap) hooks.prewrap(el); },
        ready: (el, kind) => { if (hooks.diagramReady) hooks.diagramReady(el, kind); },
    };
    // 外部サーバーの図のキャッシュ（同じ図を何度も取りに行かない）。送り先を変えたら clearCache で捨てる
    const caches = { plantuml: new Map(), dbml: new Map(), d2: new Map(), graphviz: new Map() };
    const hashOf = str => { let h = 0; for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; } return h.toString(36); };
    const ep = kind => (rd.options && rd.options.endpoints && rd.options.endpoints[kind]) || null;

    // ---------- 枠つきのフロー図・cols の線（測って引く）と、素の SVG（v0.3.18b） ----------
    // 書き方の解析と HTML は renderGxFlow / renderCols（描画の段）。ここは描いた後の仕事。
    //   gxDraw    … 箱の位置を測って、線を SVG で重ねる。幅が変わる・中の図が後から描かれる・テーマが変わると引き直す
    //   gxToSvg   … 画面の配置そのままを「素の SVG」にする。**文字は <text>、枠と箱は <rect>、色は値で書く**
    //               （foreignObject・CSS の変数・外の規則を使わない。Word・PowerPoint など別のアプリで使うため。
    //               2026-10-08 利用者「SVGでコピー・保存する場合は、別のアプリで使う事が主目的」）
    //   印刷・単一HTML書き出しも gxToSvg を使う（「HTML化時は、最小限の内容で問題無い」。どの幅で開いても線がずれない）
    const GX_NS = 'http://www.w3.org/2000/svg';
    let gxCtx = null;
    // どんな CSS の色でも [r, g, b, a] にする（color-mix・color()・var() の結果も、1画素描いて読めば値になる）
    function gxColor(css) {
        if (!css || css === 'transparent' || css === 'none') return null;
        try {
            if (!gxCtx) { const c = document.createElement('canvas'); c.width = c.height = 1; gxCtx = c.getContext('2d', { willReadFrequently: true }); }
            gxCtx.clearRect(0, 0, 1, 1);
            gxCtx.fillStyle = '#010203';
            gxCtx.fillStyle = css;
            if (gxCtx.fillStyle === '#010203' && !/^#010203$/i.test(css)) return null;   // 読めない色
            gxCtx.fillRect(0, 0, 1, 1);
            const d = gxCtx.getImageData(0, 0, 1, 1).data;
            return d[3] ? [d[0], d[1], d[2], d[3] / 255] : null;
        } catch (e) { return null; }
    }
    const gxHex = c => '#' + c.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
    const gxPaint = (attr, c) => c ? ` ${attr}="${gxHex(c)}"${c[3] < 0.999 ? ` ${attr}-opacity="${+c[3].toFixed(3)}"` : ''}` : ` ${attr}="none"`;
    const gxEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const gxN = v => +(+v).toFixed(1);
    const gxPlainText = s => String(s || '').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
    // 枠ごとの線の色（--gx-line。枠の色相の濃い側。枠なしは本文の色を少し薄めた色）
    function gxLineColor(scope) {
        const probe = document.createElement('span');
        probe.style.cssText = 'display:none;color:var(--gx-line)';
        (scope || R()).appendChild(probe);
        const c = gxColor(getComputedStyle(probe).color);
        probe.remove();
        return c || [128, 128, 128, 1];
    }
    // 名前を照合するための箱の名前（新しい箱・グリッドの箱・Mermaid の箱）
    function gxBoxName(n) {
        if (n.dataset && n.dataset.gxName != null) return n.dataset.gxName;
        if (n.classList && n.classList.contains('fg-box')) {
            const lab = n.querySelector('.fg-label'), items = lab && lab.querySelector('.fg-items');
            const t = lab ? lab.textContent : n.textContent;
            return gxPlainText(items ? t.slice(0, t.length - items.textContent.length) : t);
        }
        return gxPlainText(n.textContent);
    }
    const GX_BOX_SEL = '.gx-box, .fg-box, g.node';
    function gxDraw(el) {
        if (!el || !el.isConnected) return;
        let svg = el.querySelector(':scope > svg.gx-lines');
        if (!svg) { svg = document.createElementNS(GX_NS, 'svg'); svg.setAttribute('class', 'gx-lines'); svg.setAttribute('aria-hidden', 'true'); el.appendChild(svg); }
        // 図や外側に CSS の zoom・拡大縮小が掛かっていると、getBoundingClientRect は縮めた後の大きさを返すが、
        // 線の SVG は図の中（縮める前の座標）に置くので、測った値を縮めた分だけ戻す（v0.4.3b。スライドショーで
        // 背の高い図を zoom で縮めると、線だけが二重に縮んで箱からずれていた。zoom 0.47 で見かけ 317px・元 674px を実測）
        const raw = el.getBoundingClientRect();
        if (!raw.width || !raw.height) return;
        const gz = el.offsetWidth > 0 ? raw.width / el.offsetWidth : 1;
        const z = gz > 0.05 && Math.abs(gz - 1) > 0.005 ? gz : 1;
        const base = { left: raw.left, top: raw.top, width: raw.width / z, height: raw.height / z };
        svg.setAttribute('width', gxN(base.width)); svg.setAttribute('height', gxN(base.height));
        let edges = [];
        try { edges = JSON.parse(decodeURIComponent(el.dataset.gxEdges || '%5B%5D')); } catch (e) {}
        const rectOf = n => { const r = n.getBoundingClientRect(); const x = (r.left - base.left) / z, y = (r.top - base.top) / z, w = r.width / z, h = r.height / z; return { x, y, w, h, r: x + w, b: y + h, cx: x + w / 2, cy: y + h / 2 }; };
        const own = sel => [...el.querySelectorAll(sel)].filter(n => n.closest('.gx') === el);
        const byId = id => own(`[data-gx-id="${id}"]`)[0] || null;
        const byFrame = id => own(`[data-gx-frame="${id}"]`)[0] || null;
        // この図の直下の枠（入れ子の図の中の枠ではなく、この図の段に並んでいる枠）
        const ownFrame = n => { let f = n && n.closest('[data-gx-frame]'); while (f && f.closest('.gx') !== el) f = f.parentElement && f.parentElement.closest('[data-gx-frame]'); return f && el.contains(f) ? f : null; };
        const pick = (list, key, what) => {
            key = gxPlainText(key);
            if (/^\d+$/.test(key)) return list[+key - 1] ? { hit: list[+key - 1] } : { err: `${key} 番目の${what}がありません` };
            const exact = list.filter(n => gxBoxName(n) === key);
            if (exact.length === 1) return { hit: exact[0] };
            const pre = exact.length ? exact : list.filter(n => gxBoxName(n).startsWith(key));
            if (pre.length === 1) return { hit: pre[0] };
            return { err: pre.length ? `「${key}」という${what}が ${pre.length} つあります。「枠の名前:」を付けてください` : `「${key}」という${what}がありません` };
        };
        // `枠:箱`（`：` も可。入れ子は重ねる）。**左が枠の名前に当たるときだけ**区切りとして読む（`10:00 開始` は箱の名前のまま）
        const resolve = (name, scopeEl) => {
            let scope = scopeEl, rest = String(name || '').trim(), moved = false;
            for (;;) {
                const m = /^(.+?)\s*[:：]\s*(.+)$/.exec(rest);
                if (!m) break;
                const p = pick([...(moved ? scope : el).querySelectorAll('[data-gx-frame]')], m[1], '枠');
                if (!p.hit) break;
                scope = p.hit; rest = m[2]; moved = true;
            }
            const p = pick([...(scope || el).querySelectorAll(GX_BOX_SEL)], rest, '箱');
            if (p.hit || moved || !scopeEl) return p;
            const q = pick([...el.querySelectorAll(GX_BOX_SEL)], rest, '箱');   // 自分の枠に無ければ図の全体から
            return q.hit ? q : p;
        };
        const colors = new Map();
        const colorOf = n => { const f = ownFrame(n) || el; if (!colors.has(f)) colors.set(f, gxLineColor(f)); return colors.get(f); };
        // 線に色を書いたとき（`{… 赤}`）はその色。CSS の変数を今のテーマで読む
        const edgeColor = (e, n) => { if (!e.color) return colorOf(n); if (!colors.has(e.color)) colors.set(e.color, gxColor(getComputedStyle(R()).getPropertyValue(e.color).trim()) || colorOf(n)); return colors.get(e.color); };
        const out = [], msgs = [];
        const dirOf = (p, q) => Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1]) ? (q[0] >= p[0] ? 'r' : 'l') : (q[1] >= p[1] ? 'd' : 'u');
        const head = (pt, dir, c, thick) => {
            const s = thick ? 9 : 7, w = thick ? 5.5 : 4.2, [x, y] = pt;
            const pts = { r: [[x, y], [x - s, y - w], [x - s, y + w]], l: [[x, y], [x + s, y - w], [x + s, y + w]],
                          d: [[x, y], [x - w, y - s], [x + w, y - s]], u: [[x, y], [x - w, y + s], [x + w, y + s]] }[dir];
            out.push(`<polygon points="${pts.map(p => p.map(gxN).join(',')).join(' ')}"${gxPaint('fill', c)}/>`);
        };
        // 見出しの下地は、その位置にある枠の地（無ければ本文の地）。ビュワーの背景は透明なことがあり、
        // それを白と見なしてダーク系で白い下地になっていた（v0.3.18g）
        const pageBg = gxColor(getComputedStyle(R()).getPropertyValue('--bg-color').trim()) || gxColor(getComputedStyle(R()).backgroundColor) || [255, 255, 255, 1];
        const frameRects = own('[data-gx-frame]').map(f => ({ r: rectOf(f), bg: gxColor(getComputedStyle(f).backgroundColor) }));
        const bgAt = (x, y) => { let hit = null; for (const f of frameRects) if (f.bg && f.bg[3] > 0.5 && x >= f.r.x && x <= f.r.r && y >= f.r.y && y <= f.r.b) hit = f.bg; return hit ? hit.slice(0, 3).concat(1) : pageBg; };
        // 見出しどうしが重なるときは、下へずらす
        const placed = [];
        const labelAt = (x, y, text, c) => {
            if (!text) return;
            const w = text.length * 12 + 8;
            for (let t = 0; t < 4 && placed.some(q => Math.abs(q.x - x) < (q.w + w) / 2 && Math.abs(q.y - y) < 18); t++) y += 18;
            placed.push({ x, y, w });
            const bg = bgAt(x, y);
            out.push(`<rect x="${gxN(x - w / 2)}" y="${gxN(y - 9)}" width="${gxN(w)}" height="18" rx="3"${gxPaint('fill', bg)}/>`);
            out.push(`<text x="${gxN(x)}" y="${gxN(y + 4)}" text-anchor="middle" font-size="12"${gxPaint('fill', c)}>${gxEsc(text)}</text>`);
        };
        const hsegs = [];
        const draw = (pts, e, c) => {
            const thick = !!(e.c && e.c.thick);
            for (let i = 0; i < pts.length - 1; i++) if (Math.abs(pts[i][1] - pts[i + 1][1]) < 1) hsegs.push([Math.min(pts[i][0], pts[i + 1][0]), Math.max(pts[i][0], pts[i + 1][0]), pts[i][1]]);
            out.push(`<path d="M${pts.map(p => gxN(p[0]) + ' ' + gxN(p[1])).join(' L')}" fill="none"${gxPaint('stroke', c)} stroke-width="${thick ? 2.8 : 1.6}"`
                + `${e.dashed ? ' stroke-dasharray="6 4"' : ''} stroke-linejoin="round"/>`);
            const n = pts.length;
            if (e.c && e.c.to) head(pts[n - 1], dirOf(pts[n - 2], pts[n - 1]), c, thick);
            if (e.c && e.c.from) head(pts[0], dirOf(pts[1], pts[0]), c, thick);
            if (e.label) {
                let best = 0, k = 0;
                for (let i = 0; i < n - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); if (l > best) { best = l; k = i; } }
                // 縦の区間なら見出しは線の右へ（線の上に重ねると、線と矢じりが隠れる）
                const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2;
                const vert = Math.abs(pts[k + 1][0] - pts[k][0]) < 1;
                labelAt(vert ? mx + 6 + (e.label.length * 12 + 8) / 2 : mx, my, e.label, c);
            }
        };
        // 溝（枠の外の隙間）を縦に通る線の x。**同じ溝を通る線は、先に本数を数えて溝の幅に等分して並べる**
        // （v0.3.18g・利用者「線 受付窓口 ⇒ 確認 と A班:受付端末 → B班:記録 の間に、隙間を空ける為の仕様を検討」）。
        // 間隔は 6〜14px。仕切りの溝では、真ん中（仕切りの点線）の上に線を置かない
        const slots = new Map(), slotN = new Map(), eid = new Map();
        const chanKey = (frame, side) => { if (!eid.has(frame)) eid.set(frame, eid.size); return eid.get(frame) + ':' + side; };
        const countChan = (frame, side) => { const k = chanKey(frame, side); slotN.set(k, (slotN.get(k) || 0) + 1); };
        const chan = (frame, side) => {
            const f = rectOf(frame);
            let sib = side > 0 ? frame.nextElementSibling : frame.previousElementSibling;
            let x, cw, div = false;
            if (sib && (sib.classList.contains('gx-gap') || sib.classList.contains('gx-div'))) { const s = rectOf(sib); x = s.cx; cw = s.w; div = sib.classList.contains('gx-div'); }
            else if (sib && sib.hasAttribute('data-gx-frame')) { const s = rectOf(sib); x = side > 0 ? (f.r + s.x) / 2 : (s.r + f.x) / 2; cw = side > 0 ? s.x - f.r : f.x - s.r; }
            else { x = side > 0 ? f.r + Math.max(4, (base.width - f.r) / 2) : Math.max(2, f.x / 2); cw = 2 * Math.min(x - (side > 0 ? f.r : 0), (side > 0 ? base.width : f.x) - x); }
            const key = chanKey(frame, side), k = slots.get(key) || 0, n = Math.max(slotN.get(key) || 1, k + 1);
            slots.set(key, k + 1);
            if (n === 1 && !div) return x;
            const step = Math.max(6, Math.min(14, cw / (n + 2)));
            return x + (k - (n - 1) / 2) * step + (div && n % 2 ? step / 2 : 0);
        };
        // 同じ段の、指す側に別の箱があるか（あれば横から出入りせず、上下から回る）
        const blocked = (n, side) => {
            const row = n.parentElement;
            if (!row || !(row.classList.contains('gx-row') || row.classList.contains('fg-row'))) return false;
            const sibs = [...row.children].filter(x => x.classList.contains('gx-box') || x.classList.contains('fg-box'));
            const i = sibs.indexOf(n);
            return side > 0 ? i < sibs.length - 1 : i > 0;
        };
        // 箱の同じ辺に入る線・出る線は、辺を等分した位置に並べる
        const ports = new Map();
        const pid = new Map();
        const portKey = (n, side) => { if (!pid.has(n)) pid.set(n, pid.size); return { n, side, key: pid.get(n) + '|' + side }; };
        const xs = [];
        for (const e of edges) {
            if (e.k === 'h') {
                const A = byId(e.a), B = byId(e.b);
                if (!A || !B) continue;
                const a = rectOf(A), b = rectOf(B), [L, R] = a.x <= b.x ? [a, b] : [b, a];
                const y = (Math.max(L.y, R.y) + Math.min(L.b, R.b)) / 2;
                const flip = a.x > b.x;
                draw([[L.r, y], [R.x, y]], { c: { from: flip ? e.c.to : e.c.from, to: flip ? e.c.from : e.c.to, thick: e.c.thick }, dashed: e.dashed, label: e.label }, colorOf(A));
            } else if (e.k === 'v') {
                const As = e.a.map(byId).filter(Boolean), Bs = e.b.map(byId).filter(Boolean);
                if (!As.length || !Bs.length) continue;
                const ar = As.map(rectOf), br = Bs.map(rectOf), c = edgeColor(e, As[0]);
                const y1 = Math.max(...ar.map(r => r.b)), y2 = Math.min(...br.map(r => r.y)), ym = (y1 + y2) / 2;
                const sub = (from, to) => ({ c: { from, to, thick: e.c.thick }, dashed: e.dashed });   // 見出しは下でまとめて1つ
                if (ar.length === br.length) ar.forEach((a, i) => {
                    const b = br[i];
                    draw(Math.abs(a.cx - b.cx) < 1 ? [[a.cx, a.b], [b.cx, b.y]] : [[a.cx, a.b], [a.cx, ym], [b.cx, ym], [b.cx, b.y]], sub(e.c.from, e.c.to), c);
                });
                else {
                    ar.forEach(a => draw([[a.cx, ym], [a.cx, a.b]], sub(false, e.c.from), c));
                    const all = [...ar, ...br].map(r => r.cx);
                    if (Math.max(...all) - Math.min(...all) > 1) draw([[Math.min(...all), ym], [Math.max(...all), ym]], sub(false, false), c);
                    br.forEach(b => draw([[b.cx, ym], [b.cx, b.y]], sub(false, e.c.to), c));
                }
                if (e.label) labelAt(Math.max(...ar.map(r => r.cx)) + 6 + e.label.length * 6, ym, e.label, c);
            } else if (e.k === 'x') {
                const sa = e.divLeft ? byFrame(e.divLeft) : e.scope ? byFrame(e.scope) : null;
                const sb = e.divRight ? byFrame(e.divRight) : e.scope ? byFrame(e.scope) : null;
                const pa = resolve(e.na, sa), pb = resolve(e.nb, sb);
                if (!pa.hit || !pb.hit) { msgs.push(`引けなかった線（${(pa.err || pb.err)}）: ${e.raw}`); continue; }
                if (pa.hit === pb.hit) { msgs.push(`引けなかった線（同じ箱どうし）: ${e.raw}`); continue; }
                xs.push({ e, A: pa.hit, B: pb.hit });
            }
        }
        // 乗り越える線: 出る辺・入る辺を決めてから、辺ごとに等分して並べる
        const plan = xs.map(({ e, A, B }) => {
            const a = rectOf(A), b = rectOf(B), FA = ownFrame(A), FB = ownFrame(B);
            const side = b.cx >= a.cx ? 1 : -1;
            const same = FA && FA === FB;
            const sameBand = FA && FB && FA.parentElement === FB.parentElement;
            const inSide = same ? side : (sameBand ? -side : (a.cx >= b.cx ? 1 : -1));
            const outKey = blocked(A, same ? 1 : side) ? null : portKey(A, same ? 1 : side);
            const inKey = blocked(B, same ? 1 : inSide) ? null : portKey(B, same ? 1 : inSide);
            return { e, A, B, a, b, FA, FB, side, same, sameBand, inSide, outKey, inKey };
        });
        const count = new Map();
        plan.forEach(p => [p.outKey, p.inKey].forEach(k => { if (k) count.set(k.key, (count.get(k.key) || 0) + 1); }));
        plan.forEach(p => { if (p.same) return; countChan(p.FA || p.A, p.side); if (!p.sameBand && p.FA && p.FB) countChan(p.FB, p.inSide); });
        const used = new Map();
        const portY = (k, r) => { const n = count.get(k.key) || 1, i = used.get(k.key) || 0; used.set(k.key, i + 1); return r.y + r.h * (i + 1) / (n + 1); };
        for (const p of plan) {
            const { e, A, a, b, FA, FB, side, same, sameBand, inSide } = p;
            const c = edgeColor(e, A), pts = [];
            if (same) {
                // 同じ枠の中で隣でない箱どうし: 枠の内側の右の余白を縦に通る
                const fr = rectOf(FA), x = fr.r - 7;
                const ya = p.outKey ? portY(p.outKey, a) : a.b + 6, yb = p.inKey ? portY(p.inKey, b) : b.y - 6;
                if (p.outKey) pts.push([a.r, ya]); else pts.push([a.cx, a.b], [a.cx, ya]);
                pts.push([x, ya], [x, yb]);
                if (p.inKey) pts.push([b.r, yb]); else pts.push([b.cx, yb], [b.cx, b.y]);
                draw(pts, e, c);
                continue;
            }
            const cxA = chan(FA || A, side);
            let ya;
            if (p.outKey) { ya = portY(p.outKey, a); pts.push([side > 0 ? a.r : a.x, ya]); }
            else { ya = a.b + 6; pts.push([a.cx, a.b], [a.cx, ya]); }
            pts.push([cxA, ya]);
            let cxB = cxA;
            if (!sameBand && FA && FB) {
                const ba = rectOf(FA.parentElement), bb = rectOf(FB.parentElement);
                const gy = bb.y > ba.y ? (ba.b + bb.y) / 2 : (bb.b + ba.y) / 2;
                cxB = chan(FB, inSide);
                pts.push([cxA, gy], [cxB, gy]);
            }
            if (p.inKey) { const yb = portY(p.inKey, b); pts.push([cxB, yb], [inSide > 0 ? b.r : b.x, yb]); }
            else { const yb = b.y - 6; pts.push([cxB, yb], [b.cx, yb], [b.cx, b.y]); }
            draw(pts, e, c);
        }
        // 仕切りの矢印（`- - - ⇒ 文字 - - -`）: 左の枠から右の枠へ、仕切りの真ん中の高さで
        own('.gx-div[data-gx-arrow]').forEach(d => {
            const L = d.previousElementSibling, R = d.nextElementSibling;
            if (!L || !R) return;
            const l = rectOf(L), r = rectOf(R), m = rectOf(d), mid = (Math.max(l.y, r.y) + Math.min(l.b, r.b)) / 2;
            // **線の横の区間と重ならない高さ**を選ぶ（v0.3.18g。重なると太矢印が線を覆っていた）。真ん中に近い方を優先
            // 線から 12px 離れていれば足りる（それ以上は真ん中に近い方）。仕切りの文字（下端）には掛けない
            const dl = d.querySelector('.gx-div-label');
            const lo = Math.max(l.y, r.y) + 12, hi = Math.min(Math.min(l.b, r.b) - 12, dl ? rectOf(dl).y - 10 : Infinity);
            const near = hsegs.filter(h => h[1] > l.r && h[0] < r.x).map(h => h[2]);
            let y = mid;
            if (near.length && hi > lo) {
                let best = -1;
                for (let t = lo; t <= hi; t += 2) {
                    const sc = Math.min(12, ...near.map(h => Math.abs(h - t))) - Math.abs(t - mid) * 0.01;
                    if (sc > best) { best = sc; y = t; }
                }
            }
            const kind = d.dataset.gxArrow || '';
            draw([[l.r + 4, y], [r.x - 4, y]], { c: { thick: /thick/.test(kind), from: /from/.test(kind), to: /to/.test(kind) } }, gxLineColor(L));
        });
        svg.innerHTML = out.join('');
        const msg = el.querySelector(':scope > .gx-msg');
        if (msg) msg.innerHTML = msgs.map(t => '⚠️ ' + gxEsc(t)).join('<br>');
    }
    const gxDrawTree = el => [el, ...el.querySelectorAll('.gx')].forEach(gxDraw);
    function gxDrawAll(root) { (root || R()).querySelectorAll('.gx').forEach(el => { gxObserve(el); gxDraw(el); }); }
    // 幅が変わる・中の図（Mermaid など）が後から描かれて高さが変わる、のどちらでも引き直す
    const gxPending = new Set();
    const gxSchedule = el => { if (gxPending.has(el)) return; gxPending.add(el); requestAnimationFrame(() => { gxPending.delete(el); gxDraw(el); }); };
    const gxRO = typeof ResizeObserver === 'function' ? new ResizeObserver(list => list.forEach(en => { const g = en.target.closest('.gx'); if (g) gxSchedule(g); })) : null;
    const gxSeen = new WeakSet();
    function gxObserve(el) {
        if (!gxRO || gxSeen.has(el)) return;
        gxSeen.add(el); gxRO.observe(el);
        el.querySelectorAll('[data-gx-frame]').forEach(n => gxRO.observe(n));
    }
    // テーマを変えたら色を引き直す。**body ができてから見張る**（gnDocRd.js を <head> で読むページでは、読んだ時点で body が無い。v0.4.0a）
    const gxWatchTheme = () => new MutationObserver(() => requestAnimationFrame(() => gxDrawAll())).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme-variant'] });
    if (document.body) gxWatchTheme(); else document.addEventListener('DOMContentLoaded', gxWatchTheme, { once: true });

    // ---- 素の SVG ----
    // 画面の配置そのままを、別のアプリで開ける SVG にする。
    //   背景・枠線のある要素 → <rect>（角の丸みも）／文字 → 1行ずつ <text>（幅は textLength で合わせる。書体が違う環境でもはみ出さない）
    //   中の SVG（線・Mermaid の図）→ 色と線を値で書き込んだ写し（foreignObject と <style> は外し、中の HTML の文字は <text> にする）
    function gxToSvg(el, opts = {}) {
        const base = el.getBoundingClientRect();
        const W = Math.ceil(base.width), H = Math.ceil(base.height);
        const out = [];
        const rel = r => ({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
        const bgc = gxColor(getComputedStyle(R()).backgroundColor) || [255, 255, 255, 1];
        out.push(`<rect x="0" y="0" width="${W}" height="${H}"${gxPaint('fill', bgc)}/>`);
        const dash = (s, w) => s === 'dashed' ? ` stroke-dasharray="${gxN(w * 3)} ${gxN(w * 2)}"` : s === 'dotted' ? ` stroke-dasharray="${gxN(w)} ${gxN(w)}"` : '';
        const SIDES = ['Top', 'Right', 'Bottom', 'Left'];
        function paintBox(node, cs) {
            const r = rel(node.getBoundingClientRect());
            if (r.w < 0.5 && r.h < 0.5) return;
            const fill = gxColor(cs.backgroundColor);
            const bw = SIDES.map(s => parseFloat(cs['border' + s + 'Width']) || 0);
            const bs = SIDES.map(s => cs['border' + s + 'Style']);
            const bc = SIDES.map(s => cs['border' + s + 'Color']);
            const rad = Math.max(0, Math.min(parseFloat(cs.borderTopLeftRadius) || 0, r.w / 2, r.h / 2));
            if (fill) out.push(`<rect x="${gxN(r.x)}" y="${gxN(r.y)}" width="${gxN(r.w)}" height="${gxN(r.h)}" rx="${gxN(rad)}"${gxPaint('fill', fill)}/>`);
            const on = i => bw[i] > 0 && bs[i] !== 'none' && bs[i] !== 'hidden' && gxColor(bc[i]);
            if (SIDES.every((s, i) => on(i)) && bw.every(v => v === bw[0]) && bs.every(v => v === bs[0]) && bc.every(v => v === bc[0])) {
                const w = bw[0];
                out.push(`<rect x="${gxN(r.x + w / 2)}" y="${gxN(r.y + w / 2)}" width="${gxN(r.w - w)}" height="${gxN(r.h - w)}" rx="${gxN(Math.max(0, rad - w / 2))}" fill="none"`
                    + `${gxPaint('stroke', gxColor(bc[0]))} stroke-width="${gxN(w)}"${dash(bs[0], w)}/>`);
                return;
            }
            const seg = [[r.x, r.y, r.x + r.w, r.y, 1], [r.x + r.w, r.y, r.x + r.w, r.y + r.h, -1], [r.x, r.y + r.h, r.x + r.w, r.y + r.h, -1], [r.x, r.y, r.x, r.y + r.h, 1]];
            SIDES.forEach((s, i) => {
                if (!on(i)) return;
                const w = bw[i], [x1, y1, x2, y2, sg] = seg[i], o = sg * w / 2;
                const [ax, ay, bx, by] = i % 2 ? [x1 + o, y1, x2 + o, y2] : [x1, y1 + o, x2, y2 + o];
                out.push(`<line x1="${gxN(ax)}" y1="${gxN(ay)}" x2="${gxN(bx)}" y2="${gxN(by)}"${gxPaint('stroke', gxColor(bc[i]))} stroke-width="${gxN(w)}"${dash(bs[i], w)}/>`);
            });
        }
        // 文字の基線の位置（文字の箱の上端からの割合）を、書体ごとに1回だけ測る
        const baseCache = new Map();
        const baseline = cs => {
            const key = cs.fontFamily + '|' + cs.fontSize + '|' + cs.fontWeight;
            if (baseCache.has(key)) return baseCache.get(key);
            const s = document.createElement('span');
            s.style.cssText = 'position:absolute;left:-9999px;top:0;line-height:normal;white-space:nowrap';
            s.style.fontFamily = cs.fontFamily; s.style.fontSize = cs.fontSize; s.style.fontWeight = cs.fontWeight;
            s.textContent = 'あX';
            const mk = document.createElement('span'); mk.style.cssText = 'display:inline-block;width:1px;height:0;vertical-align:baseline';
            s.appendChild(mk); document.body.appendChild(s);
            const rg = document.createRange(); rg.selectNodeContents(s.firstChild);
            const tr = rg.getBoundingClientRect(), br = mk.getBoundingClientRect();
            const v = tr.height ? (br.bottom - tr.top) / tr.height : 0.8;
            s.remove(); baseCache.set(key, v);
            return v;
        };
        let marker = null;   // 箇条書きの印（::marker は DOM に無いので、その項目の最初の行の頭に描く）
        function paintText(t) {
            const s = t.nodeValue;
            if (!s || !s.trim()) return;
            const p = t.parentElement, cs = getComputedStyle(p);
            if (cs.visibility === 'hidden') return;
            const rg = document.createRange(), runs = [];
            let run = null;
            for (let i = 0; i < s.length; i++) {
                const cp = s.codePointAt(i), j = i + (cp > 0xffff ? 2 : 1), ch = s.slice(i, j);
                rg.setStart(t, i); rg.setEnd(t, j);
                i = j - 1;
                const rs = rg.getClientRects();
                if (!rs.length) continue;
                const r = rs[rs.length - 1];
                if (r.width < 0.01 && /\s/.test(ch)) continue;
                if (run && Math.abs(run.top - r.top) < r.height / 2 && r.left >= run.right - 1.5) { run.text += ch; run.right = Math.max(run.right, r.right); }
                else { run = { text: ch, left: r.left, right: r.right, top: r.top, h: r.height }; runs.push(run); }
            }
            const color = gxColor(cs.color), fs = parseFloat(cs.fontSize) || 14, bl = baseline(cs);
            const font = ` font-family="${gxEsc(cs.fontFamily)}" font-size="${gxN(fs)}" font-weight="${cs.fontWeight}"${cs.fontStyle === 'italic' ? ' font-style="italic"' : ''}`;
            runs.forEach(run => {
                const txt = run.text.replace(/\s+/g, ' ');
                if (!txt.trim()) return;
                const x = run.left - base.left, y = run.top - base.top + run.h * bl;
                if (marker && marker.li.contains(t)) {
                    out.push(`<text x="${gxN(x - fs * 1.1)}" y="${gxN(y)}"${font}${gxPaint('fill', color)}>${gxEsc(marker.ch)}</text>`);
                    marker = null;
                }
                out.push(`<text x="${gxN(x)}" y="${gxN(y)}"${font}${gxPaint('fill', color)} textLength="${gxN(run.right - run.left)}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${gxEsc(txt)}</text>`);
            });
        }
        function paintSvg(node) {
            const r = rel(node.getBoundingClientRect());
            if (r.w < 0.5 || r.h < 0.5) return;
            const c = node.cloneNode(true);
            const src = [node, ...node.querySelectorAll('*')], dst = [c, ...c.querySelectorAll('*')];
            src.forEach((s, i) => {
                const d = dst[i];
                if (!d || !(s instanceof SVGElement)) return;
                const tag = s.tagName.toLowerCase();
                if (tag === 'foreignobject' || tag === 'style' || tag === 'script') return;
                const cs = getComputedStyle(s);
                ['fill', 'stroke'].forEach(pp => {
                    const v = cs[pp];
                    if (!v) return;
                    if (v === 'none') { d.setAttribute(pp, 'none'); return; }
                    if (/^url\(/.test(v)) { d.setAttribute(pp, v.replace(/^url\("?(.*?)"?\)$/, 'url($1)').replace(/^url\(.*#/, 'url(#')); return; }
                    const k = gxColor(v);
                    if (k) { d.setAttribute(pp, gxHex(k)); if (k[3] < 0.999) d.setAttribute(pp + '-opacity', +k[3].toFixed(3)); else d.removeAttribute(pp + '-opacity'); }
                    else d.setAttribute(pp, 'none');
                });
                if (cs.strokeWidth) d.setAttribute('stroke-width', parseFloat(cs.strokeWidth) || 0);
                if (cs.strokeDasharray && cs.strokeDasharray !== 'none') d.setAttribute('stroke-dasharray', cs.strokeDasharray.replace(/px/g, '').replace(/,\s*/g, ' '));
                if (cs.opacity && cs.opacity !== '1') d.setAttribute('opacity', cs.opacity);
                if (cs.display === 'none') d.setAttribute('display', 'none');
                if (tag === 'text' || tag === 'tspan') {
                    d.setAttribute('font-family', cs.fontFamily); d.setAttribute('font-size', parseFloat(cs.fontSize) || 14); d.setAttribute('font-weight', cs.fontWeight);
                }
                d.removeAttribute('style'); d.removeAttribute('class');
            });
            c.querySelectorAll('foreignObject, style, script').forEach(n => n.remove());
            c.removeAttribute('style'); c.removeAttribute('class');
            c.setAttribute('x', gxN(r.x)); c.setAttribute('y', gxN(r.y));
            c.setAttribute('width', gxN(r.w)); c.setAttribute('height', gxN(r.h));
            c.setAttribute('overflow', 'visible');
            out.push(new XMLSerializer().serializeToString(c));
            // foreignObject の中の HTML（Mermaid の箱の文字など）は、ふつうの文字として描く
            node.querySelectorAll('foreignObject').forEach(fo => [...fo.childNodes].forEach(walk));
        }
        function paintImg(node) {
            const r = rel(node.getBoundingClientRect());
            if (r.w < 0.5 || r.h < 0.5) return;
            let href = node.currentSrc || node.src || '';
            if (node.tagName === 'CANVAS') { try { href = node.toDataURL('image/png'); } catch (e) { return; } }
            else try {
                const cv = document.createElement('canvas'); cv.width = node.naturalWidth; cv.height = node.naturalHeight;
                cv.getContext('2d').drawImage(node, 0, 0); href = cv.toDataURL('image/png');
            } catch (e) {}
            out.push(`<image x="${gxN(r.x)}" y="${gxN(r.y)}" width="${gxN(r.w)}" height="${gxN(r.h)}" href="${gxEsc(href)}" preserveAspectRatio="none"/>`);
        }
        function walk(node) {
            if (node.nodeType === 3) { paintText(node); return; }
            if (node.nodeType !== 1) return;
            if (node.classList.contains('gx-tools') || node.classList.contains('zoom-controls')) return;
            if (node instanceof SVGElement) { if (node.tagName.toLowerCase() === 'svg') paintSvg(node); return; }
            const cs = getComputedStyle(node);
            if (cs.display === 'none' || cs.visibility === 'hidden') return;
            if (node.tagName === 'IMG' || node.tagName === 'CANVAS') { paintImg(node); return; }
            paintBox(node, cs);
            if (cs.display === 'list-item' && cs.listStyleType !== 'none') {
                const ol = node.parentElement && node.parentElement.tagName === 'OL';
                marker = { li: node, ch: ol ? ([...node.parentElement.children].indexOf(node) + 1) + '.' : '•' };
            }
            node.childNodes.forEach(walk);
        }
        // 入れ子（cols の中の flow）も含めて、線を今の配置で引き直してから写す
        gxDrawTree(el);
        el.childNodes.forEach(walk);
        const size = opts.embed ? ` width="100%" style="max-width:${W}px;height:auto;display:block"` : ` width="${W}" height="${H}"`;
        return (opts.embed ? '' : '<?xml version="1.0" encoding="UTF-8"?>\n')
            + `<svg xmlns="${GX_NS}" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}"${size}>\n${out.join('\n')}\n</svg>`;
    }
    // 印刷と単一HTML書き出しの写しで、図をまるごと素の SVG に差し替える（どの幅でも線がずれない）
    // src … 写しの元（既定は描く先の根元）。gnDocRd.print.snapshot は根元以外の所からも写しを作る（v0.4.1）
    function gxReplaceInClone(clone, src) {
        const top = root => [...root.querySelectorAll('.gx')].filter(n => !(n.parentElement && n.parentElement.closest('.gx')));
        const orig = top(src || R()), copy = top(clone);
        orig.forEach((g, i) => {
            const t = copy[i];
            if (!t) return;
            try {
                const d = document.createElement('div');
                d.className = 'gx-svg';
                if (g.dataset.gdPrint) d.dataset.gdPrint = g.dataset.gdPrint;   // 印刷の幅の指定（{print=…}）を持ち越す
                d.innerHTML = gxToSvg(g, { embed: true });
                t.replaceWith(d);
            } catch (e) {
                console.warn('[図] SVG にできませんでした。HTML のまま書き出します', e);
                t.querySelectorAll('.gx-tools').forEach(n => n.remove());
            }
        });
    }
    function gxSvgToPng(svg, scale = 2) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const cv = document.createElement('canvas');
                    cv.width = Math.ceil(img.width * scale); cv.height = Math.ceil(img.height * scale);
                    const x = cv.getContext('2d'); x.scale(scale, scale); x.drawImage(img, 0, 0);
                    cv.toBlob(b => b ? resolve(b) : reject(new Error('PNG にできません')), 'image/png');
                } catch (e) { reject(e); }
            };
            img.onerror = () => reject(new Error('SVG を読めません'));
            img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        });
    }

    // ```flow の箱と線のラベルを、修飾つきの HTML へ差し替える（v0.3.18w・flowToMermaid の注記）。
    // 差し替えの HTML は利用者の文字から作るので、入れる前に DOMPurify を通す。
    // 色・地は**値を直接書き込む**（SVG で保存したときと単一HTMLに書き出したときに、gnDoc の CSS が無くても色が残るように）。
    // 字が太くなって箱からはみ出したときだけ、その箱の字を縮めて収める。
    // 縦の簡単な flow の「引けなかった線」を図の下に出す（v0.4.3e。flowToMermaid の注記。書き方の検査も .fg-note を拾う）
    function applyFlowNotes(el) {
        if (!el.dataset.flowNotes || el.querySelector(':scope > .fg-note')) return;
        let notes;
        try { notes = JSON.parse(decodeURIComponent(el.dataset.flowNotes)); } catch (e) { return; }
        if (!Array.isArray(notes) || !notes.length) return;
        const d = document.createElement('div');
        d.className = 'fg-note';
        notes.forEach((n, i) => { if (i) d.appendChild(document.createElement('br')); d.appendChild(document.createTextNode('⚠️ ' + n)); });
        el.appendChild(d);
    }
    function applyFlowRich(el) {
        if (!el.dataset.flowRich) return;
        let map;
        try { map = JSON.parse(decodeURIComponent(el.dataset.flowRich)); } catch (e) { return; }
        const clean = h => (typeof DOMPurify !== 'undefined' ? DOMPurify.sanitize(h) : escapeHtml(h));
        // 本来の見た目は、図の外（本文）に同じ要素を置いて測る。図の中で測ると、Mermaid が SVG に持つ
        // id つきの規則（`#mermaid-… span` など）に負けた色が出る（線のラベルの色が消えていた）。
        const looks = e => {
            const p = document.createElement(e.tagName.toLowerCase());
            p.className = e.className;
            if (e.getAttribute('style')) p.setAttribute('style', e.getAttribute('style'));
            p.style.position = 'absolute'; p.style.visibility = 'hidden';
            p.textContent = 'x';
            R().appendChild(p);
            const cs = getComputedStyle(p);
            const o = { color: cs.color, bg: cs.backgroundColor, bw: cs.borderTopWidth, bs: cs.borderTopStyle, bc: cs.borderTopColor, br: cs.borderTopLeftRadius, pad: cs.padding };
            p.remove();
            return o;
        };
        const put = (span, html) => {
            if (!span) return;
            span.innerHTML = '<p>' + clean(html) + '</p>';
            span.querySelectorAll('.gd-fg, mark, [class*="gd-box"], code').forEach(e => {
                const o = looks(e);
                e.style.setProperty('color', o.color, 'important');
                if (o.bg && o.bg !== 'rgba(0, 0, 0, 0)') e.style.setProperty('background-color', o.bg, 'important');
                if (parseFloat(o.bw) > 0) { e.style.border = `${o.bw} ${o.bs} ${o.bc}`; e.style.borderRadius = o.br; e.style.padding = o.pad; }
            });
            // 数式は箱の文字色に従わせる（Mermaid の規則の色になると、淡い地の上で読めない）
            span.querySelectorAll('.katex, .katex *').forEach(k => k.style.setProperty('color', 'inherit', 'important'));
            // はみ出しは、Mermaid が置いたラベルの入れ物（foreignObject の中の div）で測る
            const fo = span.closest('foreignObject');
            const box = fo && fo.firstElementChild;
            if (!box) return;
            const haveW = parseFloat(fo.getAttribute('width')) || 0, haveH = parseFloat(fo.getAttribute('height')) || 0;
            const needW = box.scrollWidth, needH = box.scrollHeight;
            if (!haveW || !needW) return;
            const k = Math.min(1, haveW / needW, haveH && needH ? haveH / needH : 1);
            if (k < 0.995) span.style.fontSize = (Math.max(0.6, k) * 100).toFixed(1) + '%';
        };
        el.querySelectorAll('g.node').forEach(g => {
            const m = /flowchart-(n\d+)-/.exec(g.id || '');
            if (m && map[m[1]]) put(g.querySelector('.nodeLabel'), map[m[1]].join('<br>'));
        });
        el.querySelectorAll('g.edgeLabel g.label[data-id]').forEach(g => {
            const html = map[g.getAttribute('data-id')];
            if (html) put(g.querySelector('span.edgeLabel'), html);
        });
    }
    // root の中のまだ描いていない ```mermaid（と flow を Mermaid にした物）を描く。mermaid.initialize は使う側が先に済ませておく
    function renderMermaid(root) {
        if (typeof mermaid === 'undefined' || !mermaid.run) return Promise.resolve();
        const scope = root || R();
        const els = Array.from(scope.querySelectorAll('.mermaid:not([data-processed="true"])'));
        if (!els.length) return Promise.resolve();

        // プレースホルダー: Mermaid が確実に通常テキストとして扱う ASCII 安全文字列
        const PH_PRE = 'KTXPH';
        const mathExprs = [];
        // flow の線の色（GDLC_gd_c_red → 今のテーマの --gd-c-red の値）。テーマを切り替えて描き直すときも、ここで取り直す
        const css = getComputedStyle(scope);
        els.forEach(el => {
            if (el.textContent.includes('GDLC_')) el.textContent = el.textContent.replace(/GDLC_([a-z0-9_]+)/g, (m, n) => (css.getPropertyValue('--' + n.replace(/_/g, '-')).trim() || '#888'));
        });
        els.forEach(el => {
            el.textContent = el.textContent.replace(/\$([^\$]+)\$/g, (_, math) => {
                const id = mathExprs.length;
                mathExprs.push(math);
                return PH_PRE + id;
            });
        });

        return els.reduce((chain, el) => chain.then(() =>
            mermaid.run({nodes:[el]}).then(() => {
                el.setAttribute('data-processed', 'true');
                applyFlowRich(el);
                applyFlowNotes(el);
                if (typeof katex === 'undefined' || mathExprs.length === 0) return;

                const phRegex = new RegExp(PH_PRE + '(\\d+)', 'g');

                // Mermaid v10+ は foreignObject 内の HTML にラベルを生成する
                // TreeWalker で全テキストノードを走査しプレースホルダーを KaTeX に置換
                const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
                const hits = [];
                while (walker.nextNode()) {
                    if (phRegex.test(walker.currentNode.textContent)) {
                        hits.push(walker.currentNode);
                    }
                    phRegex.lastIndex = 0;
                }
                hits.forEach(textNode => {
                    const parts = textNode.textContent.split(new RegExp('(' + PH_PRE + '\\d+)', 'g'));
                    if (parts.length < 2) return;
                    const frag = document.createDocumentFragment();
                    parts.forEach(p => {
                        const m = p.match(new RegExp('^' + PH_PRE + '(\\d+)$'));
                        if (m) {
                            const span = document.createElement('span');
                            try { span.innerHTML = katex.renderToString(mathExprs[parseInt(m[1])], {throwOnError:false, displayMode:false}); }
                            catch(e) { span.textContent = p; }
                            frag.appendChild(span);
                        } else {
                            frag.appendChild(document.createTextNode(p));
                        }
                    });
                    textNode.parentNode.replaceChild(frag, textNode);
                });
            }).catch(e => {
                const det = e?.error?.message || e?.message || String(e);
                el.innerHTML = `<pre class="mermaid-error">⚠️ Mermaid Error: ${escapeHtml(det.substring(0,300))}</pre>`;
                el.setAttribute('data-processed', 'true');
            })
        ), Promise.resolve());
    }

    // markmap は自前の読み取り器（markdown-it）で描くので、gnDoc の色 `{Red:…}`・枠 `[[…]]`・絵文字 `:smile:` を知らない（記号のまま出ていた）。
    // 渡す前に、本文と同じ HTML（marked の拡張が出す物）へ置き換える（v0.3.18y）。markdown-it は HTML をそのまま通し、
    // 中の `**太**` などはそのまま markdown-it が読む。開き・閉じのタグは、目印の文字を marked に描かせて切り出す
    // （色名の解釈を二重に持たない）。コード（``` と `…`）と数式 `$…$` の中は触らない。
    function markmapDecorate(code) {
        if (!rd.marked || !/[{\[:]/.test(code)) return code;
        const MARK = 'GDMMX7Q';
        const wrap = md => {
            let h;
            try { h = rd.marked.parseInline(md.replace('\u0000', MARK)); } catch (e) { return null; }
            const i = h.indexOf(MARK);
            return i > 0 && /^<span class="gd-/.test(h) ? [h.slice(0, i), h.slice(i + MARK.length)] : null;
        };
        const inlinePart = s => s
            .replace(/:([A-Za-z0-9_+-]+|[\u3040-\u30ff\u3400-\u9fff]+):/g, (all) => {
                let h; try { h = rd.marked.parseInline(all); } catch (e) { return all; }
                return h && h !== all && !/[<>]/.test(h) ? h : all;
            })
            .replace(/\{([^\s:{}]{1,16}):([^{}\n]+)\}/g, (all, name, body) => {
                const w = wrap(`{${name}:\u0000}`);
                return w ? w[0] + body + w[1] : all;
            })
            .replace(/\[\[([^\[\]\n]+)\]\]/g, (all, body) => {
                const cm = /^([^\s:\[\]]{1,16}):([\s\S]+)$/.exec(body);
                let w = cm ? wrap(`[[${cm[1]}:\u0000]]`) : null;
                // 色名として読めない「注意: …」は、コロンごと本文（marked の枠と同じ扱い）
                if (w && w[0].includes('>' + cm[1] + ':')) w = null;
                if (w) return w[0] + cm[2] + w[1];
                w = wrap('[[\u0000]]');
                return w ? w[0] + body + w[1] : all;
            });
        let fence = null;
        return code.split('\n').map(line => {
            const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
            if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; return line; }
            if (f) { fence = f[1]; return line; }
            // `…` と $…$ を残して、間だけを置き換える
            return line.split(/((`+)[\s\S]*?\2|\$\$[^$]+\$\$|\$(?!\s)[^$\n]*?[^\s\\]\$|\$[^\s$]\$)/)
                .map((part, i, arr) => {
                    // split の捕捉は「全体」と「バッククォートの並び」の2つ。全体は i%3===1、並びは i%3===2（捨てる）
                    if (i % 3 === 2) return '';
                    return i % 3 === 1 ? part : inlinePart(part || '');
                }).join('');
        }).join('\n');
    }

    // ---------- 2〜3個のチャートを横並びグリッドにグループ化 ----------
    // 対象: `_layout: "row"` を持つ .chartjs 要素（```chartjs のJSON内 "_layout" キー、
    // または ```csv-chart の `layout: row` メタが変換されたもの）が、間に他の要素を
    // 挟まず連続している場合のみ .chart-row でラップする（暗黙の隣接自動グループ化はしない）。
    function isAdjacentSibling(a, b) {
        if (!a || !b || a.parentNode !== b.parentNode) return false;
        let n = a.nextSibling;
        while (n && n !== b) {
            if (n.nodeType === 1) return false;
            if (n.nodeType === 3 && n.textContent.trim() !== '') return false;
            n = n.nextSibling;
        }
        return n === b;
    }
    function groupChartRows(root) {
        const scope = root || R();
        scope.querySelectorAll('.chartjs:not([data-row-checked])').forEach(el => {
            el.setAttribute('data-row-checked', 'true');
            try {
                const cfg = JSON.parse(decodeURIComponent(el.dataset.chartjsCode || '{}'));
                if (cfg._layout === 'row') el.setAttribute('data-chart-layout', 'row');
            } catch (e) { /* JSONエラーは描画時のエラー表示に任せる */ }
        });
        const all = Array.from(scope.querySelectorAll('.chartjs'));
        let group = [], prevEl = null;
        const flush = () => {
            if (group.length >= 2) {
                const wrapper = document.createElement('div');
                wrapper.className = 'chart-row';
                group[0].parentNode.insertBefore(wrapper, group[0]);
                group.forEach(g => wrapper.appendChild(g));
            }
            group = [];
        };
        all.forEach(el => {
            const isRow = el.getAttribute('data-chart-layout') === 'row' && !el.closest('.chart-row');
            if (isRow && group.length && isAdjacentSibling(prevEl, el)) {
                group.push(el);
            } else {
                flush();
                if (isRow) group.push(el);
            }
            prevEl = el;
        });
        flush();
    }

    // ---------- Chart.js 描画 ----------
    function renderChartJs(root) {
        if (typeof Chart === 'undefined') return;
        const scope = root || R();
        groupChartRows(scope);
        scope.querySelectorAll('.chartjs:not([data-processed])').forEach(el => {
            try {
                const code = decodeURIComponent(el.dataset.chartjsCode || '');
                const config = JSON.parse(code);
                delete config._layout;
                const canvas = document.createElement('canvas');
                el.innerHTML = ''; el.appendChild(canvas);
                // インスタンスを要素に持たせておく。再描画で差し戻されなかった（＝DOMから
                // 切り離された）ものを後で destroy するために要る。持たせないと参照を失い、
                // Chart.js 内部のレジストリに残ったまま回収されない。
                el._chartInstance = new Chart(canvas, config);
                el.setAttribute('data-processed', 'true');
            } catch(e) {
                el.innerHTML = `<pre class="mermaid-error">⚠️ Chart.js Error: ${escapeHtml(e.message)}</pre>`;
            }
        });
    }

    // ---------- Cytoscape 描画 ----------
    function renderCytoscape(root) {
        if (typeof cytoscape === 'undefined') return;
        const scope = root || R();
        scope.querySelectorAll('.cytoscape:not([data-processed])').forEach(el => {
            try {
                const code = decodeURIComponent(el.dataset.cytoscapeCode || '');
                const config = JSON.parse(code);
                el.innerHTML = '';
                // .diagram-zoom-wrapper への移動は cytoscape() 初期化前に完了させる。
                // 初期化後に要素を移動（attachZoomToAllDiagrams 経由のwrapZoom）すると、
                // ヘッドレスChromiumではcanvasの初回ペイントが永久に走らなくなる不具合を
                // CDPでの再現実験で確認したため（初回ペイント前の reparent が原因。
                // cy.resize()/forceRender() を挟んでも復旧しない）。
                H.prewrap(el);
                // ホイールはビュワーのスクロールを優先し、拡大縮小は Ctrl+ホイールへ割り当てる
                // （Markmap と操作を揃える）。cytoscape.js には「Ctrlのときだけズーム」に相当する
                // 設定が無いため、内蔵のホイールズーム（userZoomingEnabled）を切って自前で実装する。
                // 文書側の設定より後に置いて意図的に上書きしている（ここが有効だとホイールが
                // 図に吸われ、ビュワーがスクロールしないという元の不便さに戻るため）。
                const cy = cytoscape(Object.assign({ container: el }, config, { userZoomingEnabled: false }));
                el._cyInstance = cy;
                H.viewport(el, {
                    zoomBy: (factor, pt) => {
                        const level = Math.max(0.1, Math.min(10, cy.zoom() * factor));
                        cy.zoom({ level, renderedPosition: pt });
                    },
                    reset: () => { cy.fit(undefined, 30); },
                });
                el.setAttribute('data-processed', 'true');
            } catch(e) {
                el.innerHTML = `<pre class="mermaid-error">⚠️ Cytoscape Error: ${escapeHtml(e.message)}</pre>`;
            }
        });
    }

	// ==========================================
	// WaveDrom Rendering Logic
	// ==========================================

    function renderWaveDrom(root) {
       // ==========================================
       // WaveDrom公式エディタ互換パーサー
       // ==========================================
       // 公式エディタは中身を JavaScript として評価するので、JSON より緩い書き方が通る
       // （キーの引用符省略・'…' の文字列・コメント・末尾のカンマ）。以前は JSON として読めないと
       // `new Function` で評価していたため、**文書に書いた JavaScript がそのまま動いた**（課題管理 §1.22 A1）。
       // いまは緩い書き方を自前で読み、値（オブジェクト・配列・文字列・数・true/false/null）しか作らない。
       // 式・関数呼び出し・変数は書けない（読めなければ位置つきのエラーにする）。
       const parseWaveJSON = (text) => {
           const s = String(text);
           let i = 0;
           const fail = (msg) => {
               const before = s.slice(0, i);
               const line = before.split(String.fromCharCode(10)).length;
               throw new Error(`${msg}（${line}行目）`);
           };
           const skip = () => {
               for (;;) {
                   while (i < s.length && /\s/.test(s[i])) i++;
                   if (s.startsWith('//', i)) { while (i < s.length && s[i] !== String.fromCharCode(10)) i++; continue; }
                   if (s.startsWith('/*', i)) {
                       const e = s.indexOf('*/', i + 2);
                       if (e < 0) { i = s.length; fail('コメント /* が閉じていません'); }
                       i = e + 2; continue;
                   }
                   return;
               }
           };
           const ESC = { n: String.fromCharCode(10), r: String.fromCharCode(13), t: String.fromCharCode(9),
                         b: String.fromCharCode(8), f: String.fromCharCode(12), v: String.fromCharCode(11), '0': String.fromCharCode(0) };
           const str = () => {
               const q = s[i++];
               let out = '';
               while (i < s.length && s[i] !== q) {
                   let c = s[i++];
                   if (c === '\\') {
                       c = s[i++];
                       if (c === 'u' && /^[0-9a-fA-F]{4}$/.test(s.substr(i, 4))) { out += String.fromCharCode(parseInt(s.substr(i, 4), 16)); i += 4; }
                       else if (c === 'x' && /^[0-9a-fA-F]{2}$/.test(s.substr(i, 2))) { out += String.fromCharCode(parseInt(s.substr(i, 2), 16)); i += 2; }
                       else if (c === String.fromCharCode(10)) { /* 行の継続 */ }
                       else out += (c in ESC) ? ESC[c] : c;
                   } else if (c === String.fromCharCode(10)) { i--; fail('文字列が閉じていません'); }
                   else out += c;
               }
               if (i >= s.length) fail('文字列が閉じていません');
               i++;
               return out;
           };
           const IDENT = /^[A-Za-z_$][\w$]*/;
           const NUM = /^[+-]?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/;
           const value = (depth) => {
               if (depth > 64) fail('入れ子が深すぎます');
               skip();
               const c = s[i];
               if (c === '{') {
                   i++;
                   const o = {};
                   for (;;) {
                       skip();
                       if (s[i] === '}') { i++; return o; }
                       let k;
                       if (s[i] === '"' || s[i] === "'") k = str();
                       else {
                           const m = IDENT.exec(s.slice(i)) || /^\d+/.exec(s.slice(i));
                           if (!m) fail('キーが読めません');
                           k = m[0]; i += k.length;
                       }
                       skip();
                       if (s[i] !== ':') fail(`「${k}」の後に : がありません`);
                       i++;
                       const v = value(depth + 1);
                       // __proto__ を代入すると原型が差し替わる。素の性質として持たせる。
                       Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
                       skip();
                       if (s[i] === ',') { i++; continue; }
                       if (s[i] === '}') { i++; return o; }
                       fail(', か } がありません');
                   }
               }
               if (c === '[') {
                   i++;
                   const a = [];
                   for (;;) {
                       skip();
                       if (s[i] === ']') { i++; return a; }
                       a.push(value(depth + 1));
                       skip();
                       if (s[i] === ',') { i++; continue; }
                       if (s[i] === ']') { i++; return a; }
                       fail(', か ] がありません');
                   }
               }
               if (c === '"' || c === "'") return str();
               const n = NUM.exec(s.slice(i));
               if (n) { i += n[0].length; return Number(n[0].replace(/^\+/, '')); }
               const w = IDENT.exec(s.slice(i));
               if (w) {
                   const LIT = { true: true, false: false, null: null, undefined: null };
                   if (w[0] in LIT) { i += w[0].length; return LIT[w[0]]; }
                   fail(`「${w[0]}」は値として読めません（式や変数は書けません）`);
               }
               if (i >= s.length) fail('途中で終わっています');
               fail(`「${c}」は読めません`);
           };
           const v = value(0);
           skip();
           if (i < s.length) fail('値の後ろに余計なものがあります');
           return v;
       };

        if (typeof WaveDrom === 'undefined') return;
		 (root || R()).querySelectorAll('.wavedrom[data-wavedrom]:not([data-processed])').forEach(el => {
			try {
				const code = decodeURIComponent(el.getAttribute('data-wavedrom'));
				const json = parseWaveJSON(code);
				el.innerHTML = '';
				el.setAttribute('data-processed', 'true');

				// scriptタグを生成してWaveDromに処理させる
				const script = document.createElement('script');
				script.type = 'WaveDrom';
				script.textContent = JSON.stringify(json);
				el.appendChild(script);

				if (typeof WaveDrom !== 'undefined' && WaveDrom.ProcessAll) {
					WaveDrom.ProcessAll();
				}
			} catch (e) {
				el.innerHTML = `<pre class="mermaid-error">⚠️ WaveDrom Error: ${escapeHtml(e.message)}</pre>`;
				el.setAttribute('data-processed', 'true');
			}
		});
    }

    async function renderPlantUML(root) {
        // まだsrcがセットされていない（未処理の）画像のみを対象にする
        const imgs = (root || R()).querySelectorAll('.plantuml:not([data-processed]) img[data-src]');
        return Promise.all(Array.from(imgs).map(async (img) => {
            const parent = img.closest('.plantuml');
            const code = parent?.dataset?.plantumlCode || '';
            if (!code) return Promise.resolve();
            const key = code.substring(0,50)+'|'+code.length+'|'+hashOf(code);
            // 属性には %符号化して入れてある。失敗の表示には元のソースを出す（課題管理 §1.22 C2・v0.4.0n。%40startuml%0A… のまま出ていた）
            let shown = code; try { shown = decodeURIComponent(code); } catch (e) { /* 壊れた%表記はそのまま */ }
            if (caches.plantuml.has(key)) {
                img.src = caches.plantuml.get(key);
                img.style.display = '';
                const spinner = parent.querySelector('.plantuml-spinner');
                if(spinner) spinner.style.display = 'none';
                H.ready(parent, 'plantuml');
                parent.setAttribute('data-processed', 'true');
                return Promise.resolve();
            }
            return new Promise(async (resolve) => {
                const dataSrc = img.dataset.src;
                console.log('[renderPlantUML] Processing PlantUML code, data-src:', dataSrc?.substring(0, 80) + '...');
                
                // Pre-check with HEAD request for error status
                try {
                    const headResponse = await fetch(dataSrc, { method: 'HEAD', mode: 'no-cors' }).catch(() => null);
                    // CORS により詳細が取得できない場合は、GETで試行する
                    if (!headResponse) {
                        throw new Error('Network error or CORS issue');
                    }
                } catch (preCheckError) {
                    console.warn('[renderPlantUML] Pre-check skipped:', preCheckError.message);
                }
                
                const t = setTimeout(() => {
                    console.error('[renderPlantUML] TIMEOUT: Failed to load after 30s, URL:', dataSrc?.substring(0, 100));
                    parent.innerHTML=`<pre><code>${escapeHtml(shown)}</code></pre><p style="color:#c00;">⚠️ タイムアウト (30秒)</p>`;
                    parent.setAttribute('data-processed', 'true');
                    resolve();
                }, 30000);
                const onLoad = () => {
                    clearTimeout(t);
                    // 画像が正常にロードされたか確認
                    if (img.naturalHeight === 0 || img.naturalWidth === 0) {
                        console.error('[renderPlantUML] Loaded image has invalid dimensions:', img.naturalWidth, 'x', img.naturalHeight);
                        parent.innerHTML=`<pre><code>${escapeHtml(shown)}</code></pre><p style="color:#c00;">⚠️ PlantUML エラー: 無効な出力（文法エラーまたはサーバー問題）</p>`;
                        parent.setAttribute('data-processed', 'true');
                        resolve();
                        return;
                    }
                    console.log('[renderPlantUML] Load success, size:', img.naturalWidth, 'x', img.naturalHeight);
                    const spinner = parent.querySelector('.plantuml-spinner');
                    if(spinner) spinner.style.display = 'none';
                    img.style.display = '';
                    caches.plantuml.set(key, img.src);
                    H.ready(parent, 'plantuml');
                    parent.setAttribute('data-processed', 'true');
                    resolve();
                };
                const onError = (e) => {
                    clearTimeout(t);
                    console.error('[renderPlantUML] Load error:', e, 'URL:', dataSrc?.substring(0, 100));
                    parent.innerHTML=`<pre><code>${escapeHtml(shown)}</code></pre><p style="color:#c00;">⚠️ PlantUML エラー: 読み込み失敗 (ネットワーク/サーバー)</p>`;
                    parent.setAttribute('data-processed', 'true');
                    resolve();
                };
                // イベントリスナーを先に登録
                img.addEventListener('load', onLoad, {once:true});
                img.addEventListener('error', onError, {once:true});
                // キャッシュ済みでイベントが発火しなかった場合のフォールバック
                if (img.complete && img.naturalHeight !== 0) {
                    onLoad();
                    return;
                }
                // リスナー設定後に src をセットしてロード開始
                img.src = dataSrc;
            });
        }));
    }

    // ---------- DBML・D2・Graphviz（外部サーバー） ----------
    // 以前は同じ処理が3つ並んでいた。送り先は configure（既定は送らない）、置き場の名前と data 属性だけが違う
    function renderKrokiImages(root, kind, alt) {
        const divs = (root || R()).querySelectorAll(`.${kind}:not([data-processed])`);
        const dataKey = kind + 'Code';
        return Promise.all(Array.from(divs).map(div => {
            const code = decodeURIComponent(div?.dataset?.[dataKey] || '');
            if (!code) return Promise.resolve();
            const fail = msg => { div.innerHTML = `<pre><code>${escapeHtml(code)}</code></pre><p style="color:#c00;">⚠️ ${msg}</p>`; div.setAttribute('data-processed', 'true'); };
            const endpoint = ep(kind);
            if (!endpoint) { fail(`${alt}: 外部サーバーへの送り先が指定されていないので描きません（configure の endpoints.${kind} で指定）`); return Promise.resolve(); }
            const deflated = deflatePlantUML(code);
            if (!deflated) { fail('圧縮ライブラリ (pako) が利用できません。LibGen.html で gnDocRd-libs.js を作って配置してください'); return Promise.resolve(); }
            const url = `${endpoint}/${deflated}`;
            const key = code.substring(0, 50) + '|' + code.length + '|' + hashOf(code);
            if (caches[kind].has(key)) {
                div.innerHTML = `<img src="${escapeHtml(caches[kind].get(key))}" alt="${alt}">`;
                div.setAttribute('data-processed', 'true');
                return Promise.resolve();
            }
            const img = document.createElement('img');
            img.alt = alt;
            div.innerHTML = '';
            div.appendChild(img);
            return new Promise(resolve => {
                const t = setTimeout(() => { fail('タイムアウト (30秒)'); resolve(); }, 30000);
                const onLoad = () => { clearTimeout(t); caches[kind].set(key, img.src); div.setAttribute('data-processed', 'true'); resolve(); };
                const onError = () => { clearTimeout(t); fail('読み込みエラー (ネットワーク/サーバー)'); resolve(); };
                // イベントリスナーを先に登録
                img.addEventListener('load', onLoad, {once:true});
                img.addEventListener('error', onError, {once:true});
                // キャッシュ済みでイベントが発火しなかった場合のフォールバック
                if (img.complete && img.naturalHeight !== 0) { onLoad(); return; }
                // リスナー設定後に src をセットしてロード開始
                img.src = url;
            });
        }));
    }
    const renderDBML = root => renderKrokiImages(root, 'dbml', 'DBML');
    const renderD2 = root => renderKrokiImages(root, 'd2', 'D2');
    const renderGraphviz = root => renderKrokiImages(root, 'graphviz', 'Graphviz');

    let markmapTransformer = null;
    async function renderMarkmap(root) {
        if (typeof markmap === 'undefined') return;
        const divs = (root || R()).querySelectorAll('.markmap[data-markmap-code]:not([data-processed])');
        if (!divs.length) return;
        if (!markmapTransformer) markmapTransformer = new markmap.Transformer();
        divs.forEach(div => {
            div.setAttribute('data-processed', 'true');
            const code = decodeURIComponent(div.dataset.markmapCode || '');
            const svg = div.querySelector('svg.markmap-svg');
            if (!svg) return;
            try {
                const { root } = markmapTransformer.transform(markmapDecorate(code));
                // ホイール操作はビュワーのスクロールを優先し、拡大縮小は Ctrl+ホイールに割り当てる
                // （他の図表のズーム枠と操作を揃えるため）。markmap-view の内部実装に沿った指定:
                //   scrollForPan:true … d3-zoom のフィルタが wheel に対して ctrlKey を要求するようになる
                //                       （既定は Mac のみ true。明示指定して全プラットフォームで揃える）
                //   pan:false        … 素のホイールに割り当てられる handlePan を外す。handlePan は
                //                       無条件に preventDefault() するため、これを残すとホイールが
                //                       マップのパンに吸われてビュワーがスクロールしない。
                // マウスドラッグによるパンは d3-zoom 側に残るため、この指定でも従来どおり動く。
                const mm = markmap.Markmap.create(svg, { scrollForPan: true, pan: false }, root);
                div._markmapInstance = mm;
                // 拡大縮小は markmap 内蔵の d3-zoom（Ctrl+ホイール）に任せ、
                // ここではダブルクリックでの初期表示復帰だけを足す。
                H.viewport(div, { reset: () => mm.fit() });
            } catch (e) {
                div.innerHTML = `<pre class="mermaid-error">⚠️ Markmap Error: ${escapeHtml(e.message)}</pre>`;
            }
        });
    }

    // ---------- 図キャプション ----------
    // root の直下の図（と直前の「図: …」の段落・![名前](…) の行）を figure にまとめ、「図 N: 名前」を付ける
    function processFigureCaptions(root) {
        const children=Array.from((root || R()).childNodes); let fig=0;
        const capRe=/^!\[(.*?)\](?:\(.*?\))?$/, prefixRe=/^(図|Table|表)\s*[:：]/;
        for(let i=0;i<children.length;i++){
            const n=children[i];
            // cytoscapeはrenderCytoscape()内で初期化前に.diagram-zoom-wrapperへ事前ラップ
            // 済み（reparentによるcanvas初回ペイント不具合対策）のため、この時点で既に
            // ラップ済みの場合はラッパーごとfigure化の対象とする。
            // **描き直しで使い回した図も、枠ごと来る**（v0.4.0q）。gnDoc の描き直しの控え（restoreDiagramCache）は、描き済みの図を
            // 拡大縮小の枠（.diagram-zoom-wrapper）ごと戻す。枠を見落としていたので、🖍 の切り替えなど全体を描き直すと「図 N:」が消えていた
            const isPreWrappedCytoscape = n.nodeType===1 && n.classList.contains('diagram-zoom-wrapper') && n.querySelector(':scope > :is(.cytoscape,.mermaid,.wavedrom,.plantuml,.chartjs,.dbml,.d2,.graphviz,.markmap,.drawio)');
            if(n.nodeType===1 && (n.matches('.mermaid,.wavedrom,.plantuml,.chartjs,.dbml,.d2,.graphviz,.cytoscape,.markmap,.drawio,.flowgrid,.gdpart') || isPreWrappedCytoscape)){
                // draw.io は画像参照なので、キャプションは alt テキストから取れる
                // （`![構成図](zu.drawio.svg)` → 「図 N: 構成図」）。
                let cap=n.dataset.caption||'', capNodes=null;
                // marked出力のブロック要素間には改行由来の空白のみテキストノードが挟まるため、
                // 直前ノード探索時はそれを読み飛ばして実体のあるノードまで遡る。
                // **コメントノードも読み飛ばす。** 行番号の対応表のために埋めている
                // 印（<!--gd:N-->）がちょうどキャプション行と図の間に入るため、
                // 飛ばさないと prev が印になって**キャプションが一切付かなくなる**
                // （実際に cdp-codeblock.mjs が落ちた）。利用者が書いた HTML コメントも
                // 同じ理由で読み飛ばすのが正しい。
                let j=i-1;
                while(j>=0 && ((children[j].nodeType===3 && !children[j].textContent.trim()) || children[j].nodeType===8)) j--;
                const prev=j>=0 ? children[j] : null;
                if(prev && (prev.nodeType===3 || (prev.nodeType===1 && prev.tagName==='P'))){
                    const text=prev.textContent.trim();
                    const m=text.match(capRe);
                    if(m){ cap=m[1]; prev.remove(); }
                    else if(prefixRe.test(text)){
                        cap=text.replace(prefixRe,'').trim();
                        // **段落の中身（修飾つき）をそのまま図の名前へ移す**（v0.3.18w）。以前は文字だけを写していたので、
                        // `図: **重要** {Red:注意}` の太字や色が落ちていた。頭の「図:」だけを最初の文字の所から外す。
                        if(prev.nodeType===1){
                            capNodes=document.createDocumentFragment();
                            while(prev.firstChild) capNodes.appendChild(prev.firstChild);
                            const w=document.createTreeWalker(capNodes, NodeFilter.SHOW_TEXT);
                            let t; while((t=w.nextNode()) && !t.textContent.trim()) {}
                            if(t) t.textContent=t.textContent.replace(/^\s*/,'').replace(prefixRe,'').replace(/^\s+/,'');
                        }
                        prev.remove();
                    }
                }
                if(cap){ fig++; const figure=document.createElement('figure'); figure.id=`fig-${fig}`; n.parentNode.insertBefore(figure,n); figure.appendChild(n); const fc=document.createElement('figcaption'); fc.textContent=`図 ${fig}: `; if(capNodes) fc.appendChild(capNodes); else fc.textContent+=cap; figure.appendChild(fc); n.dataset.figId=`fig-${fig}`; }
            }
        }
    }

    rd.setViewRoot = el => { viewRoot = el || null; };
    rd.setHooks = h => { Object.assign(hooks, h || {}); return hooks; };
    rd.clearCache = kind => { if (kind) { if (caches[kind]) caches[kind].clear(); } else Object.values(caches).forEach(c => c.clear()); };
    Object.assign(rd, { renderWaveDrom, renderPlantUML, renderDBML, renderD2, renderGraphviz, groupChartRows, renderChartJs, renderCytoscape, renderMarkmap, processFigureCaptions });
    rd.gx = { draw: gxDraw, drawAll: gxDrawAll, observe: gxObserve, toSvg: gxToSvg, replaceInClone: gxReplaceInClone, svgToPng: gxSvgToPng };
    rd.applyFlowRich = applyFlowRich;
    rd.renderMermaid = renderMermaid;
    rd.markmapDecorate = markmapDecorate;
    // 描いた HTML を入れた後に呼ぶ（gnDocRd を使う別のページ向けのまとめ）。Mermaid の図と、枠つきのフロー図・cols の線を描く。
    // **見えている要素で呼ぶ**（線は描いた後の配置を測って引く。display:none の中では引けない）。
    // gnDoc 自身は、図ごとのキャッシュや拡大縮小の枠があるので、これを使わず個々の部品を順に呼ぶ。
    rd.hydrate = async function (root) {
        const scope = root || R();
        renderWaveDrom(scope);
        await renderMermaid(scope);
        // 外部サーバーの図は待たずに走らせ、最後に合流する（送り先を指定したときだけ送る）
        const external = Promise.all([renderPlantUML(scope), renderDBML(scope), renderD2(scope), renderGraphviz(scope)].map(p => Promise.resolve(p).catch(() => {})));
        await renderMarkmap(scope);
        renderChartJs(scope);
        renderCytoscape(scope);
        gxDrawAll(scope);
        processFigureCaptions(scope);
        await external;
        return scope;
    };
    })(gnDocRd, { escapeHtml, deflatePlantUML });
    // ---------- コメントの部品（gnDoc.html の @gnDocRd-cm-core・@gnDocRd-cm。統合した Markdown の線・番号・ポップアップ。見せるだけ） ----------
    // コメントの、画面に触らない部品（v0.4.0i で入れ、v0.4.0k に gnDocRd へ移した）。資料.cm.md の書式の読み書き・位置の引き直し・保存の前の合流・
    // 統合（資料.md＋資料.cm.md → 1つの .md）と取り出し。試験 gndoc-comment-anchor がここだけを切り出して回す（画面とアプリの状態に触れない）。
    gnDocRd.cmCore = (() => {
        const MARK_RE = /^[ \t]*<!--\s*gd-(comment|reply)\s*:\s*(.*?)\s*-->[ \t]*$/;
        const END_RE = /^[ \t]*<!--\s*gd-comment-end\s*-->[ \t]*$/;
        const ANY_RE = /^[ \t]*<!--\s*gd-(comments?|reply|comment-end)\b/;
        const FENCE_RE = /^[ \t]*(`{3,}|~{3,})/;
        const CTX = 32;
        const closeRe = f => new RegExp('^[ \\t]*' + f[0] + '{' + f.length + ',}[ \\t]*$');
        const oneLine = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
        // 見せる時刻は 2026-1101_0721 の形（v0.4.1f。2026-10-31 利用者「コメントは、時系列に整理したいのでタイムスタンプを 2026-1101_0721 の形で」）。
        // 記録（目印の JSON）は 2026-11-01T07:21:00 のまま（並べ替え・合流に使う）
        const fmtAt = at => {
            // [T ] と書く（T( と書くと、gndocrd-boundary の試験が「T という関数を呼んでいる」と読む）
            const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)/.exec(String(at || ''));
            return m ? m[1] + '-' + m[2] + m[3] + '_' + m[4] + m[5] : String(at || '').replace('T', ' ').slice(0, 16);
        };
        // 文書の名前 → コメントのファイルの名前（拡張子を外して .cm.md）。コメントのファイル自体には付けない
        function fileName(docName) {
            const n = String(docName || '');
            if (!n || /\.cm\.md$/i.test(n)) return null;
            return n.replace(/\.(md|markdown|txt)$/i, '') + '.cm.md';
        }
        // 実行時だけの値（_ で始まる）・本文・親は JSON に入れない
        function metaOf(r) {
            const o = {};
            for (const k of Object.keys(r)) if (k !== 'body' && k !== 'parent' && k[0] !== '_') o[k] = r[k];
            return o;
        }
        // 読む。コメントと返信を平らな並びで返す（返信は parent に親の id）。正は目印の JSON、見出しは人が読むための物
        function parse(text) {
            const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
            const records = [];
            let cur = null, body = [], fence = null, parentId = null, bad = 0;
            const flush = () => {
                if (!cur) return;
                let i = 0;
                while (i < body.length && !body[i].trim()) i++;
                if (i < body.length && (cur.parent ? /^####\s+↳/ : /^###\s+💬/).test(body[i])) body.splice(0, i + 1);
                cur.body = body.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
                records.push(cur);
                cur = null; body = [];
            };
            for (const line of lines) {
                if (fence) { if (closeRe(fence).test(line)) fence = null; if (cur) body.push(line); continue; }
                const m = MARK_RE.exec(line);
                if (m) {
                    flush();
                    let meta = null;
                    try { meta = JSON.parse(m[2]); } catch (e) {}
                    if (!meta || typeof meta !== 'object' || typeof meta.id !== 'string' || !meta.id) { bad++; if (m[1] === 'comment') parentId = null; continue; }
                    if (m[1] === 'comment') { delete meta.parent; parentId = meta.id; cur = meta; }
                    else if (parentId) { meta.parent = parentId; cur = meta; }
                    else bad++;
                    continue;
                }
                if (END_RE.test(line)) { flush(); parentId = null; continue; }
                const f = FENCE_RE.exec(line);
                if (f) fence = f[1];
                if (cur) body.push(line);
            }
            flush();
            return { records, bad };
        }
        // JSON の中の `--` は崩す（HTML のコメントがそこで終わらないように）。JSON の文字列としては同じ値に戻る
        const json = o => JSON.stringify(o).replace(/--/g, '-\\u002d');
        // 本文の中の、目印に見える行（コードブロックの外）は崩す（読み直したときに目印として拾わないように）
        function bodyOut(s) {
            let fence = null;
            return String(s || '').replace(/\r\n?/g, '\n').split('\n').map(l => {
                if (fence) { if (closeRe(fence).test(l)) fence = null; return l; }
                const f = FENCE_RE.exec(l);
                if (f) { fence = f[1]; return l; }
                return ANY_RE.test(l) ? l.replace('<!--', '&lt;!--') : l;
            }).join('\n');
        }
        const who = r => (r.by || '名前なし') + ' ' + fmtAt(r.at);
        // 末尾の章の見出しに出す形。時刻は <small> で小さく（v0.4.1f。ほかのビュワーでも小さく出る）
        const whoSmall = r => (r.by || '名前なし') + ' <small>' + fmtAt(r.at) + '</small>';
        const byAt = (a, b) => String(a.at || '').localeCompare(String(b.at || '')) || String(a.id).localeCompare(String(b.id));
        // 書く。コメントは渡された順（呼ぶ側が文書の中の順に並べる）、返信は時刻の順
        function serialize(docName, records) {
            const out = ['# 💬 ' + docName + ' のコメント', '', '<!-- gd-comments: 1 -->', '',
                '> gnDoc のビュワーで付けたコメントです（gnDoc が書きます）。`<!-- gd-… -->` の行は消さないでください。', ''];
            for (const c of records.filter(r => !r.parent)) {
                out.push('<!-- gd-comment: ' + json(metaOf(c)) + ' -->');
                const q = oneLine(c.anchor && (c.anchor.text || c.anchor.quote), 40);
                out.push('### 💬 「' + q + '」 — ' + who(c) + (c.state === 'resolved' ? ' ✅ 解決済み' : ''), '');
                if (c.body) out.push(bodyOut(c.body), '');
                for (const r of records.filter(x => x.parent === c.id).sort(byAt)) {
                    out.push('<!-- gd-reply: ' + json(metaOf(r)) + ' -->', '#### ↳ ' + who(r), '');
                    if (r.body) out.push(bodyOut(r.body), '');
                }
                out.push('<!-- gd-comment-end -->', '');
            }
            return out.join('\n');
        }
        // 位置を記録する（from〜to はソースの文字位置）。text は画面に出ていた文字
        function makeAnchor(src, from, to, text) {
            return { kind: 'text', quote: src.slice(from, to), prefix: src.slice(Math.max(0, from - CTX), from), suffix: src.slice(to, to + CTX),
                     from, line: src.slice(0, from).split('\n').length, text: oneLine(text != null ? text : src.slice(from, to), 200) };
        }
        const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        function ctxScore(src, s, e, a) {
            const pre = String(a.prefix || ''), suf = String(a.suffix || '');
            let p = 0;
            while (p < pre.length && s - 1 - p >= 0 && src[s - 1 - p] === pre[pre.length - 1 - p]) p++;
            let q = 0;
            while (q < suf.length && e + q < src.length && src[e + q] === suf[q]) q++;
            return p + q;
        }
        // 位置を引き直す。{ from, to } か、見つからなければ null（迷子）。
        // 選んだ文字を文書の中から全部探し、前後の文字がよく合う物（同点なら記録した位置に近い物）。無ければ空白・改行の違いを無視して探す
        function resolve(src, a) {
            if (!a || typeof a.quote !== 'string' || !a.quote) return null;
            src = String(src || '');
            const q = a.quote, cands = [];
            for (let i = src.indexOf(q); i >= 0 && cands.length < 5000; i = src.indexOf(q, i + 1)) cands.push([i, i + q.length]);
            if (!cands.length) {
                const parts = q.trim().split(/\s+/).filter(Boolean);
                if (!parts.length) return null;
                const re = new RegExp(parts.map(escRe).join('\\s+'), 'g');
                let m;
                while ((m = re.exec(src)) && cands.length < 5000) { cands.push([m.index, m.index + m[0].length]); re.lastIndex = m.index + 1; }
            }
            if (!cands.length) return null;
            const at = Number.isFinite(a.from) ? a.from : 0;
            let best = null, bestScore = -Infinity;
            for (const [s, e] of cands) {
                const sc = ctxScore(src, s, e, a) - Math.abs(s - at) / (src.length + 1);
                if (sc > bestScore) { bestScore = sc; best = { from: s, to: e }; }
            }
            return best;
        }
        // 1件の中身の鍵（直したかどうかを見る）。**位置（anchor）は入れない**（v0.4.1b）: 文書の中に記録すると、読むたびに
        // 印のあった所から位置を作り直す（extract）ので、前後の文字が変わっただけで「直した」ことになり、合流で食い違いの写しができていた
        const key = r => { const m = metaOf(r); delete m.anchor; return json(m) + '\n' + (r.parent || '') + '\n' + (r.body || ''); };
        // 保存の前の合流。disk は書く直前に読み直した物、local は手元、base は前に読んだ（書いた）ときの id → 鍵、deleted は手元で消した id。
        // 両方で直していたら両方を残し、相手の方に conflict の印を付ける（別の id にする）
        function merge(disk, local, base, deleted) {
            const D = new Map(disk.map(r => [r.id, r])), seen = new Set(), out = [];
            let conflicts = 0;
            for (const l of local) {
                seen.add(l.id);
                const d = D.get(l.id), b = base.get(l.id), lk = key(l);
                const lChanged = b === undefined || lk !== b;
                if (d) {
                    const dk = key(d), dChanged = b !== undefined && dk !== b;
                    if (lChanged && dChanged && lk !== dk) {
                        out.push(l);
                        out.push(Object.assign({}, d, { id: d.id + '-x' + Date.now().toString(36), conflict: l.id }));
                        conflicts++;
                    } else out.push(lChanged ? l : d);
                } else if (lChanged) out.push(l);   // 新しく足した物（相手が消したが、こちらで直していた物も残す）
                // 手元で触っておらず、相手が消した物は落とす
            }
            for (const d of disk) {
                if (seen.has(d.id)) continue;
                const b = base.get(d.id);
                if (deleted.has(d.id) && (b === undefined || key(d) === b)) continue;   // 手元で消した
                out.push(d);   // 相手が足した物（手元で消したが、相手が直していた物も残す）
            }
            const tops = new Set(out.filter(r => !r.parent).map(r => r.id));
            return { records: out.filter(r => !r.parent || tops.has(r.parent)), conflicts };
        }
        function newId() {
            const d = new Date(), p = n => String(n).padStart(2, '0');
            return 'c-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
                + '-' + Math.random().toString(36).slice(2, 6);
        }
        function now() {
            const d = new Date(), p = n => String(n).padStart(2, '0');
            return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
        }
        // ---------- コメントの統合（資料.md＋資料.cm.md → 1つの .md）と取り出し（v0.4.0k） ----------
        // 仕様は docs/非公開資料/機能の設計/gnDoc コメントの埋め込みと gnDocRd での表示 仕様（案）.md §4・§5・§8.2。
        // 統合した物は **Markdown として成立する**（ほかのビュワーでは <gd-cm> が落ちて中の文字が残り、番号のリンク・末尾の章・戻りのリンクが働く）。
        // 本文の各コメントの位置を <gd-cm n="番号">…</gd-cm> で包み、後ろに <sup id="gd-cm-ref-番号">[番号](#gd-cm-番号)</sup>。末尾に注釈の章。
        // **タグを入れると記法が壊れる所には入れない**（コード・数式・HTML の塊・表の区切り・属性の行。行の中では、コード・数式・リンク・タグ・{…}・[[…]]・絵文字を割らない。
        // 強調の対 ** __ ~~ == ++ は、片端だけを包まない）。包めない物は末尾の章にだけ入れる。
        const NOTE_MARK = '（本文の位置には印を付けられませんでした）';
        // 行ごとの種類（text・table・code ほか）。code などには入れない
        function lineKinds(src) {
            const lines = src.split('\n'), out = [];
            let off = 0, fence = null, math = false;
            for (let i = 0; i < lines.length; i++) {
                const l = lines[i], t = l.trim();
                let kind = 'text';
                if (fence) { kind = 'code'; if (closeRe(fence).test(l)) fence = null; }
                else if (math) { kind = 'code'; if (t === '$$') math = false; }
                else {
                    const f = FENCE_RE.exec(l);
                    if (f) { fence = f[1]; kind = 'code'; }
                    else if (t === '$$') { math = true; kind = 'code'; }
                    else if (/^\$\$.*\$\$$/.test(t)) kind = 'code';
                    else if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(t) && t.includes('-')) kind = 'sep';
                    else if (/^\{[^{}\n]+\}$/.test(t)) kind = 'attr';
                    else if (/^</.test(t)) kind = 'html';
                    else if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(t)) kind = 'hr';
                    else if (/^( {4}|\t)/.test(l) && i > 0 && !lines[i - 1].trim()) kind = 'code';   // 字下げのコード（前が空行のとき）
                }
                out.push({ start: off, end: off + l.length, kind, text: l });
                off += l.length + 1;
            }
            // 表: 区切りの行の前の行（見出し）と、後ろの空行までの行
            for (let i = 0; i < out.length; i++) {
                if (out[i].kind !== 'sep') continue;
                if (i > 0 && out[i - 1].kind === 'text' && out[i - 1].text.includes('|')) out[i - 1].kind = 'table';
                for (let j = i + 1; j < out.length && out[j].kind === 'text' && out[j].text.trim(); j++) out[j].kind = 'table';
            }
            return out;
        }
        const PREFIX_RE = /^(?:[ \t]*>[ \t]?)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?|#{1,6}[ \t]+)?/;
        // 行の中の、割ってはいけない塊（どちらかの端が中にあれば、塊ごと含める）
        function lockedSpans(t) {
            const out = [];
            const add = re => { let m; re.lastIndex = 0; while ((m = re.exec(t))) { out.push([m.index, m.index + m[0].length]); if (!m[0].length) re.lastIndex++; } };
            add(/(`+)[\s\S]*?\1/g);
            add(/\$[^$\n]+\$/g);
            add(/!?\[[^\]\n]*\]\([^)\n]*\)/g);
            add(/<[^<>\n]*>/g);
            add(/\{[^{}\n]*\}/g);
            add(/\[\[[^\[\]\n]*\]\]/g);
            add(/:[^\s:]{1,24}:/g);
            return out;
        }
        // 強調の対（片端だけが中にあれば、対ごと含める）
        function pairSpans(t) {
            const out = [];
            for (const d of ['**', '__', '~~', '==', '++']) {
                let open = -1;
                for (let i = t.indexOf(d); i >= 0; i = t.indexOf(d, i + d.length)) { if (open < 0) open = i; else { out.push([open, i + d.length]); open = -1; } }
            }
            return out;
        }
        function fitSegment(t, s, e) {
            const locked = lockedSpans(t), pairs = pairSpans(t);
            for (let guard = 0; guard < 20; guard++) {
                let ch = false;
                for (const [a, b] of locked) {
                    if (s > a && s < b) { s = a; ch = true; }
                    if (e > a && e < b) { e = b; ch = true; }
                }
                for (const [a, b] of pairs) {
                    const sIn = s > a && s < b, eIn = e > a && e < b;
                    if (sIn && !eIn) { s = a; ch = true; }
                    else if (eIn && !sIn) { e = b; ch = true; }
                }
                if (!ch) break;
            }
            while (s < e && /\s/.test(t[s])) s++;
            while (e > s && /\s/.test(t[e - 1])) e--;
            return e > s ? [s, e] : null;
        }
        // ある行の中の範囲 [s,e)（行の中の位置）を、包める区切りに分ける（表はセルごと）
        function lineSegments(L, s, e) {
            const t = L.text, pre = PREFIX_RE.exec(t)[0].length;
            s = Math.max(s, pre);
            if (L.kind !== 'table') { const f = fitSegment(t, s, e); return f ? [f] : []; }
            const cuts = [];
            let tick = false;
            for (let i = 0; i < t.length; i++) { if (t[i] === '`') tick = !tick; else if (t[i] === '|' && !tick && t[i - 1] !== '\\') cuts.push(i); }
            const out = [], bounds = [-1].concat(cuts, [t.length]);
            for (let k = 0; k + 1 < bounds.length; k++) {
                const cs = Math.max(s, bounds[k] + 1), ce = Math.min(e, bounds[k + 1]);
                if (ce <= cs) continue;
                const f = fitSegment(t, cs, ce);
                if (f && f[0] > bounds[k] && f[1] <= bounds[k + 1]) out.push(f);
            }
            return out;
        }
        const ref = n => '<sup id="gd-cm-ref-' + n + '">[' + n + '](#gd-cm-' + n + ')</sup>';
        // 統合。src は文書、records は資料.cm.md の中身（parse の records）。opts.resolved: 解決済みも入れる（既定は入れない）
        // opts.place === false: 本文には印を入れず、末尾の章にだけ入れる（v0.4.1b。印を入れると記法が崩れる文書の逃げ道。位置は目印の JSON の anchor に残る）
        // 返り値: { md, numbers: Map(id → 番号), placed: [id], unplaced: [id] }
        function integrate(src, records, opts = {}) {
            src = String(src || '');
            const kinds = lineKinds(src);
            const tops = records.filter(r => !r.parent && (opts.resolved || r.state !== 'resolved'));
            // place: 'notes' は末尾の章だけ（本文は書き換えない。位置は並べる順と迷子の但し書きにだけ使う。v0.4.1e）
            const notesOnly = opts.place === 'notes';
            const items = tops.map(c => ({ c, pos: opts.place === false ? null : resolve(src, c.anchor), segs: [] }));
            for (const it of items) {
                if (!it.pos || notesOnly) continue;
                for (const L of kinds) {
                    if (L.end < it.pos.from || L.start >= it.pos.to) continue;
                    if (L.kind !== 'text' && L.kind !== 'table') continue;
                    for (const [a, b] of lineSegments(L, Math.max(0, it.pos.from - L.start), Math.min(L.text.length, it.pos.to - L.start))) it.segs.push([L.start + a, L.start + b]);
                }
            }
            // 別のコメントの区切りと半端に重なる（入れ子でない）区切りは落とす（タグの入れ子が崩れる）
            const all = [];
            items.forEach((it, i) => it.segs.forEach(sg => all.push({ i, s: sg[0], e: sg[1] })));
            const drop = new Set();
            for (const x of all) for (const y of all) {
                if (x.i >= y.i || drop.has(x) || drop.has(y)) continue;   // 落とした区切りを基準にしない
                const overlap = x.s < y.e && y.s < x.e, nested = (x.s <= y.s && y.e <= x.e) || (y.s <= x.s && x.e <= y.e);
                if (overlap && !nested) drop.add(y);
            }
            items.forEach((it, i) => { it.segs = all.filter(x => x.i === i && !drop.has(x)).map(x => [x.s, x.e]).sort((a, b) => a[0] - b[0]); });
            // 番号は文書の中の順（包めなかった物も、位置が分かればその順。分からなければ後ろ）
            // 末尾の章だけの形（gnDoc が文書に書く形）は**時刻の順**（古い物から。v0.4.1f。利用者「時系列に整理したい」「統合時も時系列に」）。
            // 本文に印を入れる形（🖨・単一HTMLの写し）は、本文の番号を上から振るので本文の順のまま
            const order = items.map(it => [it.segs.length ? it.segs[0][0] : (it.pos ? it.pos.from : Infinity), it])
                .sort(notesOnly ? (a, b) => String(a[1].c.at || '').localeCompare(String(b[1].c.at || '')) || a[0] - b[0]
                                : (a, b) => a[0] - b[0] || String(a[1].c.at).localeCompare(String(b[1].c.at)));
            const numbers = new Map();
            order.forEach(([, it], k) => { it.n = k + 1; numbers.set(it.c.id, it.n); });
            // 差し込む（同じ位置では、閉じ（内側から）→ 開き（外側から））
            const ev = [];
            for (const it of items) it.segs.forEach((sg, k) => {
                ev.push({ at: sg[0], open: true, len: sg[1] - sg[0], text: '<gd-cm n="' + it.n + '"' + (it.c.state === 'resolved' ? ' done' : '') + '>' });   // 解決済みは done（灰色の点線）
                ev.push({ at: sg[1], open: false, len: sg[1] - sg[0], text: '</gd-cm>' + (k === it.segs.length - 1 ? ref(it.n) : '') });
            });
            ev.sort((a, b) => a.at - b.at || (a.open - b.open) || (a.open ? b.len - a.len : a.len - b.len));
            let body = '', p = 0;
            for (const x of ev) { body += src.slice(p, x.at) + x.text; p = x.at; }
            body += src.slice(p);
            const sep = src.endsWith('\n') ? '\n' : '\n\n';
            const notes = ['<a id="gd-comments"></a>', '', '<!-- gd-comments: ' + json({ v: 1, sep: sep.length }) + ' -->', '', '---', '', '## 💬 コメント', ''];
            for (const [, it] of order) {
                const c = it.c, n = it.n, placed = it.segs.length > 0;
                notes.push('<a id="gd-cm-' + n + '"></a>', '');
                notes.push('#### ' + n + '.「' + oneLine(c.anchor && (c.anchor.text || c.anchor.quote), 40) + '」 — ' + whoSmall(c) + (c.state === 'resolved' ? ' ✅ 解決済み' : '') + (placed ? ' [↩](#gd-cm-ref-' + n + ')' : ''), '');
                notes.push('<!-- gd-comment: ' + json(metaOf(c)) + ' -->', '');
                if (!placed && !(notesOnly && it.pos)) notes.push(NOTE_MARK, '');
                if (c.body) notes.push(bodyOut(c.body), '');
                for (const r of records.filter(x => x.parent === c.id).sort(byAt)) {
                    notes.push('##### ↳ ' + whoSmall(r), '', '<!-- gd-reply: ' + json(metaOf(r)) + ' -->', '');
                    if (r.body) notes.push(bodyOut(r.body), '');
                }
            }
            notes.push('<a id="gd-comments-end"></a>', '');
            return { md: body + sep + notes.join('\n'), body, notes: sep + notes.join('\n'), numbers, placed: items.filter(it => it.segs.length).map(it => it.c.id), unplaced: items.filter(it => !it.segs.length).map(it => it.c.id) };
        }
        // 統合した物か（末尾の注釈の章があるか。コードの中の書き方の例は数えない）
        function notesLine(md) {
            const kinds = lineKinds(String(md || ''));
            return kinds.findIndex(L => L.kind !== 'code' && /^<a id="gd-comments"><\/a>\s*$/.test(L.text));
        }
        const isIntegrated = md => notesLine(md) >= 0;
        // 取り出し。統合した .md → { src（元の文書）, records（資料.cm.md の中身） }。統合した物でなければ null
        function extract(md) {
            md = String(md || '').replace(/\r\n?/g, '\n');
            const kinds = lineKinds(md), i0 = notesLine(md);
            if (i0 < 0) return null;
            const lines = md.split('\n');
            let sepLen = 2;
            for (let i = i0 + 1; i < Math.min(lines.length, i0 + 4); i++) {
                const m = /^<!--\s*gd-comments:\s*(\{.*\})\s*-->\s*$/.exec(lines[i]);
                if (m) { try { const o = JSON.parse(m[1]); if (o.sep === 1 || o.sep === 2) sepLen = o.sep; } catch (e) {} break; }
            }
            const withTags = md.slice(0, Math.max(0, kinds[i0].start - sepLen));
            // 本文からタグと番号を外す（コードの行・インラインのコードの中は外さない）。外した後の位置で、番号ごとの範囲を控える
            const TAG_RE = /<gd-cm\s+n\s*=\s*"([\w-]{1,32})"(?:\s+(?:block|done))*\s*>|<\/gd-cm\s*>|<sup id="gd-cm-ref-([\w-]{1,32})">\[[\w-]{1,32}\]\(#gd-cm-[\w-]{1,32}\)<\/sup>/g;
            const bk = lineKinds(withTags), ranges = new Map(), stack = [];
            let out = '';
            for (const L of bk) {
                if (L.kind === 'code') { out += L.text; }
                else {
                    const ticks = [];
                    { let m, re = /(`+)[\s\S]*?\1/g; while ((m = re.exec(L.text))) ticks.push([m.index, m.index + m[0].length]); }
                    let p = 0, m;
                    TAG_RE.lastIndex = 0;
                    while ((m = TAG_RE.exec(L.text))) {
                        if (ticks.some(([a, b]) => m.index >= a && m.index < b)) continue;
                        out += L.text.slice(p, m.index); p = m.index + m[0].length;
                        if (m[1]) stack.push({ n: m[1], at: out.length });
                        else if (m[0].startsWith('</')) {
                            const o = stack.pop();
                            if (o) { const r = ranges.get(o.n); if (r) { r.from = Math.min(r.from, o.at); r.to = Math.max(r.to, out.length); } else ranges.set(o.n, { from: o.at, to: out.length }); }
                        }
                    }
                    out += L.text.slice(p);
                }
                if (L.end < withTags.length) out += '\n';
            }
            const src = out;
            // 末尾の章を読む
            const records = [];
            let cur = null, body = [], fence = null, num = null, top = null;
            const flush = () => {
                if (!cur) return;
                let b = body.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
                if (b.startsWith(NOTE_MARK)) b = b.slice(NOTE_MARK.length).replace(/^\s*\n/, '');
                cur.body = b;
                records.push(cur);
                cur = null; body = [];
            };
            for (let i = i0 + 1; i < lines.length; i++) {
                const l = lines[i];
                if (fence) { if (closeRe(fence).test(l)) fence = null; if (cur) body.push(l); continue; }
                if (/^<a id="gd-comments-end"><\/a>\s*$/.test(l)) break;
                const a = /^<a id="gd-cm-([\w-]{1,32})"><\/a>\s*$/.exec(l);
                if (a) { flush(); num = a[1]; top = null; continue; }
                if (!cur && (/^####\s/.test(l) || /^#####\s+↳/.test(l))) continue;
                if (/^#####\s+↳/.test(l)) { flush(); continue; }
                const m = MARK_RE.exec(l);
                if (m) {
                    flush();
                    let meta = null;
                    try { meta = JSON.parse(m[2]); } catch (e) {}
                    if (!meta || typeof meta.id !== 'string') continue;
                    if (m[1] === 'comment') {
                        delete meta.parent;
                        const r = num !== null ? ranges.get(num) : null;
                        if (r) meta.anchor = makeAnchor(src, r.from, r.to, src.slice(r.from, r.to));
                        top = meta.id; cur = meta;
                    } else if (top) { meta.parent = top; cur = meta; }
                    continue;
                }
                const f = FENCE_RE.exec(l);
                if (f) fence = f[1];
                if (cur) body.push(l);
            }
            flush();
            return { src, records };
        }
        // ---------- 文書の中に記録する（v0.4.1b） ----------
        // 2026-10-30 利用者「コメントは、ファイルマークダウンファイルの末尾に保存されるしよう」→ 記録先は「本文に印＋末尾に章」（統合の形をそのまま文書に）。
        // 読む: split(ファイルの中身) → { src（印と章を外した本文）, records }。コメントが無ければ records は空で、src は元のまま
        function split(md) {
            const x = extract(md);
            return x || { src: String(md || '').replace(/\r\n?/g, '\n'), records: [] };
        }
        // 書く: embed(本文, records, check) → { md, records（書いた物を読み直した形）, placed, unplaced, fallback } か、書けなければ null。
        // 解決済みも入れる（記録なので落とさない）。取り出すと本文に戻ること・check（描いた文字が元と同じか。gnDocRd.cm.verify）を確かめ、
        // 崩れるなら本文には印を入れず末尾の章だけにする（fallback）。コメントが1件も無ければ本文だけ（章も付けない）。
        // opts.place === 'notes' は初めから末尾の章だけ（gnDoc が文書に書く形。v0.4.1e）
        function embed(src, records, check, opts = {}) {
            src = String(src || '');
            if (!records.some(r => !r.parent)) return { md: src, records: [], placed: [], unplaced: [], fallback: false };
            const tryOne = place => {
                const r = integrate(src, records, { resolved: true, place });
                const back = extract(r.md);
                if (!back || back.src !== src) return null;
                if (place === true && check && !check(src, r.body)) return null;
                return { md: r.md, records: back.records, placed: r.placed, unplaced: r.unplaced, fallback: place === false };
            };
            if (opts.place === 'notes') return tryOne('notes');
            return tryOne(true) || tryOne(false);
        }
        // ---------- コメント票（書き出しと取り込み。v0.4.1g） ----------
        // 仕様は docs/非公開資料/機能の設計/gnDoc コメントの書き出しと取り込み 仕様（案）.md。2026-10-31 利用者「該当箇所の章番号と、該当文章のみ引用して、別ファイルに書き出す機能」
        // 「レビュー時の質疑やコメントを連絡する場合に、全文を送る必要がなくなる」「取り込み機能も同時に仕様検討」→ 票は Markdown だけ・引用は「段落、引用元、コメント文」・
        // 書き出すのは全部（解決・未解決の印付き）・相手が新しいコメントを足せる・返信は「名前：」付き
        const SHEET_RE = /^[ \t]*<!--\s*gd-comment-sheet\s*:\s*(.*?)\s*-->[ \t]*$/m;
        const REF_RE = /^[ \t]*<!--\s*gd-(comment|reply)-ref\s*:\s*(.*?)\s*-->[ \t]*$/;
        const NEW_RE = /^[ \t]*<!--\s*gd-comment-new\s*-->[ \t]*$/;
        const SHEET_HINT = '（ここに書いてください）';
        const NAME_RE = /^[ \t]*名前[ \t]*[：:][ \t]*(.*?)[ \t]*$/;
        const QUOTE_RE = /^[ \t]*引用[ \t]*[：:][ \t]*(.*?)[ \t]*$/;
        const isSheet = md => SHEET_RE.test(String(md || '').slice(0, 4000));
        const norm = t => String(t || '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
        // 見出し（ソースの # の行。コード・表の中は数えない）
        function headingsOf(src) {
            const out = [];
            lineKinds(src).forEach((L, i) => {
                if (L.kind !== 'text' || !/^#{1,6}[ \t]+\S/.test(L.text)) return;
                out.push({ line: i, start: L.start, level: /^#+/.exec(L.text)[0].length, text: L.text.replace(/^#{1,6}[ \t]+/, '').replace(/[ \t]+#+[ \t]*$/, '').trim() });
            });
            return out;
        }
        // 章番号。画面の番号（設定の §）が渡されればそれ。無ければ見出しの段から数える（H1 が先頭の1つだけなら文書の題なので H2 から）
        function headingNumbers(hs, given) {
            if (given && given.length === hs.length && given.some(Boolean)) return given.slice();
            if (!hs.length) return [];
            const top = hs.filter(h => h.level === 1).length === 1 && hs[0].level === 1 ? 2 : Math.min(...hs.map(h => h.level));
            const cnt = [0, 0, 0, 0, 0, 0, 0];
            return hs.map(h => {
                if (h.level < top) return '';
                cnt[h.level]++;
                for (let k = h.level + 1; k <= 6; k++) cnt[k] = 0;
                const parts = [];
                for (let k = top; k <= h.level; k++) parts.push(cnt[k]);
                return parts.join('.');
            });
        }
        // 引用（段落ごと）。表は見出しの行・区切り・その行、コードはその行と前後1行。付けた文字は太字（行をまたがず * を含まないとき）。長い段落は付けた所の前後で切る
        function quoteAt(src, from, to) {
            const ks = lineKinds(src);
            const i = ks.findIndex(L => from >= L.start && from <= L.end);
            if (i < 0) return null;
            const K = ks[i].kind, q = l => '> ' + l;
            if (K === 'table' || K === 'sep') {
                let p = i;
                while (p > 0 && ks[p].kind !== 'sep') p--;
                const rows = (p > 0 ? [ks[p - 1].text, ks[p].text] : []).concat(i !== p ? [ks[i].text] : []);
                return { line: i + 1, md: rows.map(q).join('\n') };
            }
            if (K === 'code') {
                let a = i, b = i;
                if (a > 0 && ks[a - 1].kind === 'code' && !FENCE_RE.test(ks[a - 1].text)) a--;
                if (b + 1 < ks.length && ks[b + 1].kind === 'code' && !FENCE_RE.test(ks[b + 1].text)) b++;
                return { line: i + 1, md: ['```'].concat(ks.slice(a, b + 1).map(L => L.text), ['```']).map(q).join('\n') };
            }
            const isPara = L => L.kind === 'text' && L.text.trim() && !/^#{1,6}[ \t]/.test(L.text);
            let a = i, b = i;
            if (isPara(ks[i])) { while (a > 0 && isPara(ks[a - 1])) a--; while (b + 1 < ks.length && isPara(ks[b + 1])) b++; }
            let text = src.slice(ks[a].start, ks[b].end), f = Math.max(0, from - ks[a].start), t = Math.min(text.length, Math.max(f, to - ks[a].start));
            let head = '', tail = '';
            if (text.length > 600) {
                const s0 = Math.max(0, f - 250), s1 = Math.min(text.length, t + 250);
                head = s0 > 0 ? '…' : ''; tail = s1 < text.length ? '…' : '';
                text = text.slice(s0, s1); f -= s0; t -= s0;
            }
            const mark = text.slice(f, t);
            if (t > f && !/[\n*]/.test(mark) && mark.trim() === mark) text = text.slice(0, f) + '**' + mark + '**' + text.slice(t);
            return { line: a + 1, md: (head + text + tail).split('\n').map(q).join('\n') };
        }
        // 票の中の中身。目印に見える行と、項目・返信の見出しに見える行（## ・### ）は崩す（取り込みで区切りと読まないように）
        function sheetBody(t) {
            let fence = null;
            return bodyOut(t).split('\n').map(l => {
                if (fence) { if (closeRe(fence).test(l)) fence = null; return l; }
                const f = FENCE_RE.exec(l);
                if (f) { fence = f[1]; return l; }
                return /^#{2,3}[ \t]/.test(l) ? '\\' + l : l;
            }).join('\n');
        }
        // 票を作る。opts: { doc, by, at, numbers（画面の章番号）, order: 'time'（既定）| 'doc' }
        function sheet(src, records, opts = {}) {
            src = String(src || '').replace(/\r\n?/g, '\n');
            const hs = headingsOf(src), nums = headingNumbers(hs, opts.numbers);
            const secOf = pos => {
                let k = -1;
                for (let j = 0; j < hs.length; j++) if (hs[j].start <= pos) k = j;
                return k < 0 ? '（冒頭）' : (nums[k] ? nums[k] + ' ' : '') + hs[k].text;
            };
            const tops = records.filter(r => !r.parent).map(c => ({ c, pos: resolve(src, c.anchor) }));
            const at0 = x => x.pos ? x.pos.from : Infinity;
            tops.sort(opts.order === 'doc' ? (a, b) => at0(a) - at0(b) || byAt(a.c, b.c) : (a, b) => byAt(a.c, b.c));
            const at = opts.at || now();
            const out = ['# 💬 ' + (opts.doc || '文書') + ' のコメント票（' + fmtAt(at) + ' 書き出し）', '',
                '<!-- gd-comment-sheet: ' + json({ v: 1, doc: opts.doc || '', at, by: opts.by || '', count: tops.length }) + ' -->', '',
                '> この票は、資料の全文ではなく、コメントを付けた箇所（章番号と段落）だけを引用しています。', '>',
                '> **返信**は、各項目の「### ↳ 返信」の下の `名前：` にお名前を書き、その下に書いてください（何人かで書くときは「### ↳ 返信」から下を写して足してください）。', '>',
                '> **解決**にするときは、項目の見出しの「（未解決）」を「（✅ 解決済み）」に書き換えてください。', '>',
                '> **新しいコメント**は、末尾の「＋ 新しいコメント」の書き方で足せます。`<!-- … -->` の行は消さないでください（取り込みに使います）。', ''];
            tops.forEach(({ c, pos }, k) => {
                const sec = pos ? secOf(pos.from) : '位置なし';
                const qt = pos ? quoteAt(src, pos.from, pos.to) : null;
                out.push('---', '', '## ' + (k + 1) + '. ［' + sec + '］— ' + whoSmall(c) + (c.state === 'resolved' ? '（✅ 解決済み）' : '（未解決）'), '',
                    '<!-- gd-comment-ref: ' + json({ id: c.id }) + ' -->', '',
                    '引用元: ［' + sec + '］' + (qt ? ' ' + qt.line + '行目' : '（いまの本文には見つかりません）'), '',
                    qt ? qt.md : '> ' + oneLine(c.anchor && (c.anchor.text || c.anchor.quote), 200), '');
                if (c.body) out.push(sheetBody(c.body), '');
                for (const r of records.filter(x => x.parent === c.id).sort(byAt)) {
                    out.push('### ↳ ' + whoSmall(r), '', '<!-- gd-reply-ref: ' + json({ id: r.id }) + ' -->', '');
                    if (r.body) out.push(sheetBody(r.body), '');
                }
                out.push('### ↳ 返信', '', '名前：', '', SHEET_HINT, '');
            });
            out.push('---', '', '## ＋ 新しいコメント', '', '<!-- gd-comment-new -->', '',
                '> 新しいコメントは、この下に次の形で書いてください（いくつでも）。「引用：」には、コメントを付けたい資料の文をそのまま写してください（その文に付けます）。', '>',
                '> ### ＋ 章番号や見出し（分かれば）', '> 名前：', '> 引用：', '> （コメントの中身）', '');
            return out.join('\n');
        }
        // 「名前：鈴木 2026-1101_0721」の時刻
        function sheetAt(t) {
            // [_] と書く（_( と書くと、gndocrd-boundary の試験が「_ という関数を呼んでいる」と読む）
            const m = /(\d{4})-(\d\d)(\d\d)[_](\d\d)(\d\d)/.exec(String(t || ''));
            return m ? m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':00' : null;
        }
        // 書いた欄の中身（名前・引用の行と「ここに書いてください」を除く）
        function sheetFields(lines) {
            const o = { by: '', at: null, quote: '', body: '' }, rest = [];
            let fence = null;
            for (const l of lines) {
                if (!fence) {
                    const f = FENCE_RE.exec(l);
                    if (f) fence = f[1];
                    else {
                        let m = NAME_RE.exec(l);
                        if (m && !o.by) { o.at = sheetAt(m[1]); o.by = m[1].replace(/\d{4}-\d{4}_\d{4}/, '').trim(); continue; }
                        m = QUOTE_RE.exec(l);
                        if (m && !o.quote) { o.quote = m[1]; continue; }
                        if (l.trim() === SHEET_HINT) continue;
                    }
                } else if (closeRe(fence).test(l)) fence = null;
                rest.push(l);
            }
            // 欄の後ろの、項目の区切り（---）と空行は外す
            while (rest.length && /^[ \t]*(-{3,}|\*{3,}|_{3,})?[ \t]*$/.test(rest[rest.length - 1])) rest.pop();
            o.body = norm(rest.join('\n'));
            return o;
        }
        // 票を読む → { doc, at, by, items: [{ n, id, state, body, replies: [{ by, at, body }] }], added: [{ heading, by, at, quote, body }] }。票でなければ null
        function parseSheet(md) {
            md = String(md || '').replace(/\r\n?/g, '\n');
            const hm = SHEET_RE.exec(md);
            if (!hm) return null;
            let meta = {};
            try { meta = JSON.parse(hm[1]) || {}; } catch (e) {}
            const items = [], added = [];
            let cur = null, sec = null, fence = null, inNew = false;
            for (const l of md.split('\n')) {
                if (fence) { if (closeRe(fence).test(l)) fence = null; if (sec) sec.lines.push(l); continue; }
                const f = FENCE_RE.exec(l);
                if (f) { fence = f[1]; if (sec) sec.lines.push(l); continue; }
                let m;
                if ((m = /^##[ \t]+(\d+)\.[ \t]*(.*)$/.exec(l)) && !inNew) {
                    const title = m[2], tail = title.slice(title.lastIndexOf('—') + 1);
                    cur = { n: Number(m[1]), id: null, state: /未解決/.test(tail) ? 'open' : /解決済み|✅/.test(tail) ? 'resolved' : null, bodyLines: [], secs: [] };
                    items.push(cur);
                    sec = { kind: 'body', lines: cur.bodyLines };
                    continue;
                }
                if (/^##[ \t]/.test(l)) { cur = null; sec = null; continue; }
                if (NEW_RE.test(l)) { inNew = true; cur = null; sec = null; continue; }
                if ((m = /^###[ \t]+(.*)$/.exec(l))) {
                    if (inNew && /^＋|^\+/.test(m[1].trim())) { sec = { kind: 'new', heading: m[1].trim().replace(/^[＋+][ \t]*/, ''), lines: [] }; added.push(sec); continue; }
                    if (cur && /^↳/.test(m[1].trim())) { sec = { kind: 'reply', ref: null, lines: [] }; cur.secs.push(sec); continue; }
                    if (sec) sec.lines.push(l);
                    continue;
                }
                if ((m = REF_RE.exec(l))) {
                    let o = {};
                    try { o = JSON.parse(m[2]) || {}; } catch (e) {}
                    if (m[1] === 'comment' && cur) cur.id = o.id || null;
                    else if (sec && sec.kind === 'reply') sec.ref = o.id || null;
                    continue;
                }
                if (sec) sec.lines.push(l);
            }
            return {
                doc: meta.doc || '', at: meta.at || '', by: meta.by || '',
                items: items.map(it => {
                    // 中身: 頭の「引用元:」の行と引用（> の行）を外した残り
                    const L = it.bodyLines.slice();
                    while (L.length && !L[0].trim()) L.shift();
                    if (L.length && /^引用元[ \t]*[：:]/.test(L[0])) L.shift();
                    while (L.length && !L[0].trim()) L.shift();
                    while (L.length && /^[ \t]*>/.test(L[0])) L.shift();
                    return { n: it.n, id: it.id, state: it.state, body: norm(L.join('\n')),
                        replies: it.secs.filter(x => !x.ref).map(x => sheetFields(x.lines)).filter(x => x.body) };
                }),
                added: added.map(x => Object.assign({ heading: x.heading }, sheetFields(x.lines))).filter(x => x.body || x.quote),
            };
        }
        // 取り込む中身を決める（同じ親・同じ名前・同じ中身の返信はもうある＝取り込み済み）。
        // → { replies: [{ parent, n, by, at, body }], states: [{ id, n, state, by }], added: [...], edited: [n], missing: [n], dup }
        function planSheet(p, records) {
            const byId = new Map(records.map(r => [r.id, r]));
            const plan = { replies: [], states: [], added: [], edited: [], missing: [], dup: 0 };
            for (const it of p.items) {
                const c = it.id ? byId.get(it.id) : null;
                if (!c || c.parent) { if (it.replies.length) plan.missing.push(it.n); continue; }
                if (it.body && norm(it.body) !== norm(sheetBody(c.body || ''))) plan.edited.push(it.n);
                for (const r of it.replies) {
                    if (records.some(x => x.parent === c.id && (x.by || '') === (r.by || '') && norm(x.body) === norm(r.body))) { plan.dup++; continue; }
                    plan.replies.push({ parent: c.id, n: it.n, by: r.by, at: r.at, body: r.body });
                }
                if (it.state && it.state !== (c.state === 'resolved' ? 'resolved' : 'open'))
                    plan.states.push({ id: c.id, n: it.n, state: it.state, by: (it.replies[0] && it.replies[0].by) || '' });
            }
            for (const a of p.added) {
                if (records.some(x => !x.parent && (x.by || '') === (a.by || '') && norm(x.body) === norm(a.body))) { plan.dup++; continue; }
                plan.added.push(a);
            }
            return plan;
        }
        // 新しいコメントの位置。引用の文を本文で探す（見出しが分かればその章から。見つからなければ頭の20字で。それでも無ければ迷子）
        function placeQuote(src, quote, heading) {
            const q = String(quote || '').trim();
            if (!q) return { kind: 'text', quote: '', prefix: '', suffix: '', from: 0, line: 0, text: '' };
            let from = 0;
            const h = heading ? headingsOf(src).find(x => heading.includes(x.text)) : null;
            if (h) from = h.start;
            for (const t of [q, q.slice(0, 20)]) {
                let i = src.indexOf(t, from);
                if (i < 0) i = src.indexOf(t);
                if (i >= 0) return makeAnchor(src, i, i + t.length, t);
            }
            return { kind: 'text', quote: q, prefix: '', suffix: '', from: 0, line: 0, text: oneLine(q, 200) };
        }
        return { CTX, NOTE_MARK, fileName, parse, serialize, makeAnchor, resolve, merge, key, newId, now, fmtAt, oneLine, integrate, extract, isIntegrated, lineKinds, split, embed,
            isSheet, sheet, parseSheet, planSheet, placeQuote, headingsOf, headingNumbers };
    })();
    // コメントを見せる部品（v0.4.0k）。統合した Markdown の <gd-cm n="1">…</gd-cm>・番号のリンク・末尾の注釈の章を、線・番号・ポップアップにする。
    // 仕様は docs/非公開資料/機能の設計/gnDoc コメントの埋め込みと gnDocRd での表示 仕様（案）.md §4〜§6。**見せるだけ**（書く・直す・消すは gnDoc のビュワーの部品）。
    // gnDoc のビュワー・gnDocRd.js・単一HTMLの3つで同じ物を使う。単一HTMLには、この関数の文字列（toString）をそのまま入れるので、
    // **この関数の外の名前には頼らない**（rd に部品を足すだけ）。
    // ポップアップの中身は、末尾の章の項目（もう描いてある）を写す。描き直さないので、図・色・コードもそのまま出る。
    function gnDocRdCmView(rd) {
        const cm = rd.cm = rd.cm || {};
        const OPEN_RE = /<gd-cm\s+n\s*=\s*(?:"([\w-]{1,32})"|'([\w-]{1,32})'|([\w-]{1,32}))((?:\s+(?:block|done))*)\s*>/gi;
        const CLOSE_RE = /<\/gd-cm\s*>/gi;
        // marked の出力（DOMPurify の前）に掛ける（<PB> と同じ流れ）。コードの中は marked が &lt; にしてあるので掛からない
        cm.transformHtml = html => String(html)
            .replace(OPEN_RE, (m, a, b, c, fl) => '<span class="gd-cm' + (/block/i.test(fl) ? ' gd-cm-block' : '') + (/done/i.test(fl) ? ' gd-cm-done' : '') + '" data-gd-cm="' + (a || b || c) + '">')
            .replace(CLOSE_RE, '</span>');
        cm.CSS = [
            '.gd-cm { background-color: rgba(255, 166, 0, 0.13); text-decoration-line: underline overline; text-decoration-color: #f08c00; text-decoration-thickness: 2px;',
            '  text-decoration-skip-ink: none; -webkit-box-decoration-break: clone; box-decoration-break: clone; cursor: pointer; }',
            '.gd-cm .gd-cm { text-decoration-thickness: 3px; }',
            // 解決済み（<gd-cm n="1" done>）は灰色の点線（ビュワーの印と同じ）
            '.gd-cm.gd-cm-done { background-color: transparent; text-decoration-color: #9aa0a6; text-decoration-style: dashed; text-decoration-thickness: 1px; }',
            '.gd-cm-line-under .gd-cm { text-decoration-line: underline; }',
            '.gd-cm-line-over .gd-cm { text-decoration-line: overline; }',
            'sup.gd-cm-ref > a { color: #e8590c; font-weight: 700; text-decoration: none; padding: 0 1px; }',
            'sup.gd-cm-ref > a:hover { text-decoration: underline; }',
            // 末尾の章の行き先の印（<a id> だけの段落）は高さを取らない
            'p:has(> a[id^="gd-cm-"]:only-child:empty), p:has(> a[id="gd-comments"]:only-child:empty), p:has(> a[id="gd-comments-end"]:only-child:empty) { margin: 0; height: 0; overflow: hidden; }',
            '.gd-cm-notes-fold > summary { cursor: pointer; font-weight: 700; margin: 12px 0; }',
            '.gd-cm-view { position: fixed; z-index: 2640; box-sizing: border-box; width: max-content; min-width: 240px; max-width: min(520px, calc(100vw - 16px)); max-height: 60vh;',
            '  overflow: auto; padding: 4px 12px 8px; font-size: 14px; line-height: 1.6; background: var(--bg-color, #fff); color: var(--text-color, #333);',
            '  border: 1px solid rgba(240, 140, 0, 0.5); border-top: 3px solid #f08c00; border-radius: 7px; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.32); }',
            '.gd-cm-view[hidden] { display: none; }',
            '.gd-cm-view.gd-cm-pinned { border-top-color: #e8590c; }',
            '.gd-cm-view h4 { font-size: 12px; margin: 4px 0 2px; opacity: .85; }',
            '.gd-cm-view h5 { font-size: 12px; margin: 8px 0 2px; padding-left: 10px; border-left: 3px solid rgba(240, 140, 0, 0.35); opacity: .85; }',
            '.gd-cm-view p { margin: 4px 0; }',
            '.gd-cm-view img, .gd-cm-view svg { max-width: 100%; height: auto; }',
            '@media print { .gd-cm { background-color: transparent; } .gd-cm-view { display: none !important; } .gd-cm-notes-fold > summary { display: none; } }',
        ].join('\n');
        cm.injectCss = (doc = document) => {
            if (doc.getElementById('gd-cm-view-css')) return;
            const s = doc.createElement('style');
            s.id = 'gd-cm-view-css';
            s.textContent = cm.CSS;
            (doc.head || doc.documentElement).appendChild(s);
        };
        const topOf = (root, el) => { while (el && el.parentElement && el.parentElement !== root) el = el.parentElement; return el && el.parentElement === root ? el : null; };
        const isStop = el => /^gd-cm-(?!ref-)|^gd-comments-end$/.test(el.id || '') || !!(el.querySelector && el.querySelector('a[id^="gd-cm-"], a[id="gd-comments-end"]'));
        // 末尾の項目（番号 n）の要素。<a id="gd-cm-n"> を含む直下の要素の次から、次の項目か章の終わりの手前まで（DOM は動かさない。gnDoc の行番号の対応表を崩さない）
        cm.noteNodes = (root, n) => {
            const a = root.querySelector('a[id="gd-cm-' + n + '"]'), start = a && topOf(root, a), out = [];
            if (!start) return out;
            for (let el = start.nextElementSibling; el && !isStop(el); el = el.nextElementSibling) out.push(el);
            return out;
        };
        function noteContent(root, n) {
            const box = root.ownerDocument.createElement('div');
            box.className = 'gd-cm-body gnDocRd';
            for (const el of cm.noteNodes(root, n)) {
                const c = el.cloneNode(true);
                // canvas（Chart.js ほか）は複製すると白くなる。画像に置き換えて写す
                const from = el.querySelectorAll('canvas'), to = c.querySelectorAll('canvas');
                from.forEach((cv, i) => { try { const img = root.ownerDocument.createElement('img'); img.src = cv.toDataURL('image/png'); img.style.maxWidth = '100%'; to[i].replaceWith(img); } catch (e) {} });
                // 戻りのリンク・ビュワーの操作の部品は外す
                c.querySelectorAll('a[href^="#gd-cm-ref-"], button, .zoom-controls').forEach(x => x.remove());
                box.appendChild(c);
            }
            return box;
        }
        // 描いた後に呼ぶ（何度でもよい）。番号に印を付け、線の引き方を決め、指定があれば末尾の章を畳む
        cm.decorate = (root, opts = {}) => {
            if (!root) return root;
            root.querySelectorAll('sup[id^="gd-cm-ref-"]').forEach(s => s.classList.add('gd-cm-ref'));
            const line = opts.line || 'both';
            root.classList.toggle('gd-cm-line-under', line === 'under');
            root.classList.toggle('gd-cm-line-over', line === 'over');
            if (opts.notes === 'fold' && !root.querySelector('.gd-cm-notes-fold')) {
                const a = root.querySelector('a[id="gd-comments"]'), start = a && topOf(root, a);
                if (start) {
                    const d = root.ownerDocument.createElement('details'), s = root.ownerDocument.createElement('summary');
                    d.className = 'gd-cm-notes-fold';
                    s.textContent = '💬 コメント（' + root.querySelectorAll('a[id^="gd-cm-"]').length + '件）';
                    d.appendChild(s);
                    start.before(d);
                    for (let el = start; el; ) { const next = el.nextElementSibling; d.appendChild(el); if (el.querySelector && el.querySelector('a[id="gd-comments-end"]')) break; el = next; }
                    // 印刷では開く
                    const w = root.ownerDocument.defaultView;
                    if (w) { w.addEventListener('beforeprint', () => { d.open = true; }); }
                }
            }
            return root;
        };
        // 重ねる・押す・焦点で出すポップアップ。合図は root で受ける（gnDoc は描き直すたびに中身が替わるが、付け直さなくてよい）
        cm.attach = (root, opts = {}) => {
            if (!root || root.__gdCmView) return root;
            root.__gdCmView = true;
            const doc = root.ownerDocument, win = doc.defaultView;
            cm.injectCss(doc);
            let pop = null, cur = null, showT = 0, hideT = 0;
            const popEl = () => {
                if (pop) return pop;
                pop = doc.createElement('div');
                pop.className = 'gd-cm-view';
                pop.hidden = true;
                pop.setAttribute('role', 'dialog');
                pop.setAttribute('aria-label', 'コメント');
                doc.body.appendChild(pop);
                pop.addEventListener('mouseenter', () => clearTimeout(hideT));
                pop.addEventListener('mouseleave', () => { if (cur && !cur.pinned) schedHide(); });
                pop.addEventListener('click', () => { if (cur && !cur.pinned) { cur.pinned = true; pop.classList.add('gd-cm-pinned'); } });
                return pop;
            };
            const target = el => {
                const m = el && el.closest ? el.closest('.gd-cm[data-gd-cm], sup.gd-cm-ref, sup[id^="gd-cm-ref-"]') : null;
                if (!m || !root.contains(m)) return null;
                return { el: m, n: m.getAttribute('data-gd-cm') || m.id.slice(10) };
            };
            const place = (p, r) => {
                const vw = win.innerWidth, vh = win.innerHeight;
                p.style.left = '0px'; p.style.top = '0px';
                const w = p.offsetWidth, h = p.offsetHeight;
                let x = Math.min(Math.max(8, r.left), vw - w - 8), y = r.bottom + 6;
                if (y + h > vh - 8 && r.top - 6 - h >= 8) y = r.top - 6 - h;
                p.style.left = Math.max(8, x) + 'px';
                p.style.top = Math.max(8, Math.min(y, vh - h - 8)) + 'px';
            };
            const show = (t, pinned) => {
                clearTimeout(showT); clearTimeout(hideT);
                const box = noteContent(root, t.n);
                if (!box.childNodes.length) return;
                const p = popEl();
                p.replaceChildren(box);
                cur = { n: t.n, pinned: !!pinned, el: t.el };
                p.classList.toggle('gd-cm-pinned', !!pinned);
                p.hidden = false;
                const rs = t.el.getClientRects();
                place(p, rs[0] || t.el.getBoundingClientRect());
                root.dispatchEvent(new CustomEvent('gd-comment-open', { detail: { n: t.n, pinned: !!pinned } }));
            };
            const hide = () => {
                clearTimeout(showT); clearTimeout(hideT);
                if (!cur) return;
                const n = cur.n;
                cur = null;
                if (pop) { pop.hidden = true; pop.classList.remove('gd-cm-pinned'); }
                root.dispatchEvent(new CustomEvent('gd-comment-close', { detail: { n } }));
            };
            const schedHide = () => { clearTimeout(hideT); hideT = setTimeout(hide, 500); };
            cm.hide = hide;
            root.addEventListener('mouseover', e => {
                const t = target(e.target);
                if (!t) return;
                clearTimeout(hideT);
                if (cur && (cur.pinned || (cur.n === t.n && cur.el === t.el))) return;
                clearTimeout(showT);
                showT = setTimeout(() => show(t, false), 300);
            });
            root.addEventListener('mouseout', e => {
                const t = target(e.target);
                if (!t || (e.relatedTarget && t.el.contains(e.relatedTarget))) return;
                clearTimeout(showT);
                if (cur && !cur.pinned) schedHide();
            });
            // 線の文字を押すと留まる。番号はリンクとして末尾へ飛ぶ（押しても留めない）
            root.addEventListener('click', e => {
                const t = target(e.target);
                if (!t || t.el.tagName === 'SUP') return;
                const sel = win.getSelection();
                if (sel && !sel.isCollapsed && sel.toString().trim()) return;
                show(t, true);
            });
            root.addEventListener('focusin', e => { const t = target(e.target); if (t) show(t, false); });
            root.addEventListener('focusout', e => { if (cur && !cur.pinned && !(e.relatedTarget && pop && pop.contains(e.relatedTarget))) schedHide(); });
            doc.addEventListener('mousedown', e => { if (cur && cur.pinned && !(pop && pop.contains(e.target)) && !target(e.target)) hide(); }, true);
            doc.addEventListener('keydown', e => { if (e.key === 'Escape' && cur) hide(); });
            win.addEventListener('scroll', () => { if (cur && !cur.pinned) hide(); }, true);
            return root;
        };
        // 統合した Markdown が描き直しで壊れていないかを確かめる（gnDoc の統合の前に呼ぶ）。
        // 元の文書と、統合した物の本文（番号と末尾の章を外す）を同じ marked で描き、画面に出る文字が同じか
        cm.verify = (src, mdBody) => {
            if (!rd.marked || typeof DOMParser === 'undefined') return { ok: true };
            const text = h => { const d = new DOMParser().parseFromString('<body>' + h + '</body>', 'text/html'); d.querySelectorAll('sup.gd-cm-ref, sup[id^="gd-cm-ref-"]').forEach(x => x.remove()); return d.body.textContent.replace(/\s+/g, ' ').trim(); };
            const a = text(rd.marked.parse(String(src))), b = text(cm.transformHtml(rd.marked.parse(String(mdBody))));
            if (a === b) return { ok: true };
            let i = 0;
            while (i < a.length && a[i] === b[i]) i++;
            return { ok: false, at: i, before: a.slice(Math.max(0, i - 20), i + 20), after: b.slice(Math.max(0, i - 20), i + 20) };
        };
    }
    gnDocRdCmView(gnDocRd);
    // 単一HTMLへ入れる、コメントを見せるスクリプト（線・番号・ポップアップ）。この関数の文字列をそのまま入れ、書き出した先の本文の入れ物（root の選択子）に付ける。
    // gnDoc の単一HTMLと gnDocRd.exportHtml の両方が使う（v0.4.1a）
    gnDocRd.cm.viewScript = (root, line) => '(' + gnDocRdCmView.toString() + ')(window.gnDocRd = window.gnDocRd || {});'
        + '(function(){var v=document.querySelector(' + JSON.stringify(root) + ');if(!v)return;gnDocRd.cm.decorate(v,{line:' + JSON.stringify(line || 'both') + '});gnDocRd.cm.attach(v);})();';
    gnDocRd.cm.hasComments = el => !!el.querySelector('.gd-cm[data-gd-cm], a[id="gd-comments"]');
    // ---------- 印刷の部品（gnDoc.html の @gnDocRd-print。写し・図の大きさ・リンク・紙の上と下・透かし・🖨 の写しの文書） ----------
    // 印刷の部品（v0.4.1。利用者「印刷関係全てを公開範囲に含めて、gnDocRd.js に入れる」）。gnDocRd.print に足す。
    // gnDoc のアプリも同じ物を使う（🖨 の写し・Ctrl+P の #print-ready・単一HTML・🔖 しおり付きの PDF の中身）。
    // **アプリの設定・ファイル名・exe との連携には触れない**（使う側が引数で渡す）。紙面の見た目の CSS は @gnDocRd-css の中（.gd-print-fit・.gd-watermark）。
    //   snapshot(根元, 設定)   … 刷る・書き出す写し（要素）。canvas は画像・枠つきの図は素の SVG・図の大きさの印・faq を開く
    //   fixLinks(写し, 設定)   … 文書の中の `[…](#見出し)` を写しの中の id へ（PDF の中でも効くように）。base で相対のリンクをその場所からの URL に
    //   findAnchor(行き先, 根元) / anchorSlug(文字) … 見出しのアンカー（GitHub と同じ規則）
    //   pageCss(設定) / stamp(日時) … 紙の上と下（文書名・日時・ページ番号）の @page
    //   watermark … 透かし（文書の中の指定 <!-- gd-watermark: … --> の読み取り・SVG・HTML）
    //   collectStyles(根元) / inlineExternalImages(写し) / documentHtml(設定) / open(HTML, 設定) … 🖨 の写しの文書と、刷る窓
    function gnDocRdPrint(rd) {
        const P = rd.print = rd.print || {};
        // ---------- 図の大きさ（v0.4.0w〜y） ----------
        // 利用者「チャートの幅を100％にする」「縦横比で縦が長い場合、紙の縦幅に応じた倍率を自動調整する」「他の図にも適用する」。
        // 以前は図の入れ物を紙の幅の半分にしていたので、刷られる字の大きさが図の形で 6px〜45px まで変わった（2026-10-26 実測。横に5つの箱は読めず、縦の図は紙1枚）。
        // いまは紙の幅いっぱい。ただし高さが刷れる範囲の 85% を超える図は、高さに合わせて縮める（幅 = min(100%, 85vh × 横÷縦, 元の幅)。CSS は .gd-print-fit）。
        // `{print=60%}` を書いた図は、その割合を幅の上限にする（高さの決まりはそのまま）。
        // 縦横比は写しを作る前に**実物で**測り、属性で写しへ持ち出す（写しの img はまだ読み込まれておらず寸法が無い）。
        // HTML で組む図（グリッドの flow・部品）は紙の幅で組み直されるので比が決まらない。幅の指定（{print=…}）だけ効かせる。
        // Cytoscape（canvas が重なる）と Markmap（大きさを CSS で決める）は対象外
        const FIT_SEL = '.mermaid, .wavedrom, .plantuml, .chartjs, .dbml, .d2, .graphviz, .drawio';
        function mediaOf(c) {
            return c.matches('.drawio, .plantuml, .dbml, .d2, .graphviz') ? c.querySelector('img, svg') : c.querySelector('svg, canvas, img');
        }
        // 縦横比（ar）と元の幅（nw。CSS の px）。元の幅は「元の大きさより広げない」の基準（MAX_SCALE）
        function aspectOf(m) {
            let w = 0, h = 0;
            if (m.tagName.toLowerCase() === 'svg') {
                const vb = m.viewBox && m.viewBox.baseVal;
                if (vb && vb.width > 0 && vb.height > 0) { w = vb.width; h = vb.height; }
            } else if (m.tagName === 'IMG') { w = m.naturalWidth; h = m.naturalHeight; }
            // Chart.js（canvas）は入れ物の幅に合わせて描く物で、元の大きさが無い（表示の幅はその時の窓で変わる）。元の大きさの上限は掛けない（nw = 0）
            else if (m.tagName === 'CANVAS') { if (m.width > 0 && m.height > 0) return { ar: m.width / m.height, nw: 0 }; }
            if (!(w > 0 && h > 0)) { const r = m.getBoundingClientRect(); w = r.width; h = r.height; }
            return w > 0 && h > 0 ? { ar: w / h, nw: w } : null;
        }
        // 小さい図を紙の幅まで広げるのは、元の大きさまで（1.0 倍）。{print=NN%} を書いた図は、書いた幅を守る（この上限を掛けない）
        //   v0.4.0x で 1.5 倍まで（利用者「用紙に対して小さい場合でも、最大150％迄とする。（極端に大きすぎると違和感ある）」）。
        //   v0.4.0y で 1.0 倍（利用者「縦書きflow の文字が大きすぎる原因を調査」→「A案で」）。図の字は元々本文と同じ 16px なので、
        //   1.5 倍だと本文の 1.5 倍（24px）で刷られた（縦の flow は紙の幅より先にこの上限で止まる。幅 246 → 369）。基準を図の字の大きさに置く
        const MAX_SCALE = 1.0;
        function setMax(c, nw) {
            if (nw > 0 && !/%$/.test(c.dataset.gdPrint || '')) c.style.setProperty('--gd-max-w', Math.round(nw * MAX_SCALE) + 'px');
        }
        // 写しの図に、縦横比（--gd-ar）と幅の上限（--gd-print-w・--gd-max-w）を書く。画面の見た目は変えない（どれも @media print だけが読む）
        function markSizes(clone, marks) {
            marks.forEach(i => {
                const c = clone.querySelector(`[data-gd-pfit="${i}"]`);
                if (!c) return;
                c.style.setProperty('--gd-ar', c.dataset.gdPar);
                setMax(c, parseFloat(c.dataset.gdPnw));
                c.removeAttribute('data-gd-pfit'); c.removeAttribute('data-gd-par'); c.removeAttribute('data-gd-pnw');
                const m = clone.querySelector(`[data-gd-pmedia="${i}"]`);
                if (m) { m.removeAttribute('data-gd-pmedia'); m.classList.add('gd-print-fit'); }
            });
            clone.querySelectorAll('.gx-svg').forEach(c => {
                const svg = c.querySelector('svg');
                const w = svg && parseFloat(svg.getAttribute('width')), h = svg && parseFloat(svg.getAttribute('height'));
                const vb = svg && (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
                const ar = vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb[2] / vb[3] : w > 0 && h > 0 ? w / h : 0;
                if (!ar) return;
                c.style.setProperty('--gd-ar', String(ar));
                setMax(c, vb && vb.length === 4 && vb[2] > 0 ? vb[2] : w);
                svg.classList.add('gd-print-fit');
            });
            clone.querySelectorAll('[data-gd-print]').forEach(c => {
                // 幅は表示範囲（枠ごと）に掛ける（v0.4.1a）。中の図に掛けると枠が 100% のまま残る
                if (/%$/.test(c.dataset.gdPrint)) c.style.setProperty('--gd-frame-w', c.dataset.gdPrint);
            });
            // 幅だけ持つ svg（WaveDrom など）は、viewBox が無いと幅を変えても中身が縮まない
            clone.querySelectorAll('svg.gd-print-fit:not([viewBox])').forEach(svg => {
                const w = parseFloat(svg.getAttribute('width')), h = parseFloat(svg.getAttribute('height'));
                if (w > 0 && h > 0) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
            });
        }
        // ---------- 写し ----------
        // 刷る・書き出す写し（根元の複製）。根元は描いた後の物（図・線まで描き終えた物）。
        //   prepare(写し) … 写しを作った直後に、使う側の後始末をする（gnDoc はビュワー内検索の印・全画面の印を外す）
        //   faq: false … faq の答えを開かない（既定は紙では開いて刷る。v0.4.0o）
        P.snapshot = function (root, opts = {}) {
            const prepare = opts.prepare, faq = opts.faq !== false;
            // 印刷の大きさのための縦横比を、実物の図で測って印を付ける（写しへ写ったら外す。markSizes）
            const marks = [];
            root.querySelectorAll(FIT_SEL).forEach((c, i) => {
                if (c.closest('.chart-row')) return;   // 横に並べたグラフは並びの幅で決まっている
                const m = mediaOf(c), sz = m && aspectOf(m);
                if (!sz) return;
                c.dataset.gdPfit = String(i); c.dataset.gdPar = String(sz.ar); c.dataset.gdPnw = String(sz.nw); m.dataset.gdPmedia = String(i);
                marks.push(i);
            });
            let clone;
            try { clone = root.cloneNode(true); }
            finally { root.querySelectorAll('[data-gd-pfit], [data-gd-pmedia]').forEach(n => { n.removeAttribute('data-gd-pfit'); n.removeAttribute('data-gd-par'); n.removeAttribute('data-gd-pnw'); n.removeAttribute('data-gd-pmedia'); }); }
            if (prepare) prepare(clone);
            // Chart.js の Canvas は複製されない（中身が白紙になる）ので、写しの側だけ PNG の画像に置き換える
            const origCanvases = root.querySelectorAll('canvas');
            const clonedCanvases = clone.querySelectorAll('canvas');
            origCanvases.forEach((canvas, idx) => {
                const target = clonedCanvases[idx];
                if (!target) return;
                try {
                    const img = document.createElement('img');
                    img.src = canvas.toDataURL('image/png');
                    img.setAttribute('data-canvas-img', 'true');
                    img.width = canvas.width; img.height = canvas.height;
                    img.style.maxWidth = '100%'; img.style.height = 'auto'; img.style.display = 'block';
                    if (target.dataset.gdPmedia) img.dataset.gdPmedia = target.dataset.gdPmedia;   // 印刷の大きさの印を画像へ移す
                    target.parentNode.replaceChild(img, target);
                } catch (e) { console.warn('[gnDocRd.print] canvas を画像にできませんでした', idx, e); }
            });
            // 枠つきのフロー図・cols は、測った配置ごと素の SVG にする（書き出した先・紙の幅でも線がずれない）
            if (rd.gx) rd.gx.replaceInClone(clone, root);
            markSizes(clone, marks);
            if (faq) clone.querySelectorAll('.gd-faq details').forEach(d => { d.open = true; });
            return clone;
        };
        // ---------- 文書の中のリンク（v0.4.0m） ----------
        // Chrome・Edge の PDF は、**行き先の id がある `#…` だけ**を PDF の中のリンクにし、無い物は黙って捨てる（2026-10-20 実測）。
        // ビュワーでは押したときにスクリプトが見出しを引き当てているので、写しの中に行き先が無く、PDF では消えていた。
        // 符号の作り方は GitHub の見出しアンカーに合わせる（小文字化 → 記号を落とす → 空白を `-` へ。空白は1文字ずつ。連続をまとめない）。
        // 同じ見出しが2つ以上あるときは、2つ目から `-1` `-2` を付ける（GitHub と同じ。機能拡張案 G3）
        function anchorSlug(s) {
            return String(s).trim().toLowerCase()
                .replace(/[^\p{L}\p{N}\s_-]/gu, '')
                .replace(/\s/g, '-');
        }
        // **id も根元の中だけで探す**（ページ全体を探すと、見出し「editor」「toc」へのリンクがページ自身の部品に当たる。課題管理 §1.22 C1）
        function findAnchor(raw, scope) {
            let id = raw;
            try { id = decodeURIComponent(raw); } catch (e) { /* 壊れた%表記はそのまま扱う */ }
            const direct = scope.querySelector('#' + CSS.escape(raw)) || scope.querySelector('#' + CSS.escape(id));
            if (direct) return direct;
            const want = anchorSlug(id);
            if (!want) return null;
            const seen = new Map();
            for (const h of scope.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
                const base = anchorSlug(h.textContent);
                const n = seen.get(base) || 0;
                seen.set(base, n + 1);
                if ((n ? `${base}-${n}` : base) === want) return h;
            }
            return null;
        }
        P.anchorSlug = anchorSlug;
        P.findAnchor = findAnchor;
        let anchorSeq = 0;
        //   base … 相対のリンクの基準の URL（文書の場所。gnDoc の exe は文書のフォルダの file:///）。無ければ相対のリンクはそのまま
        P.fixLinks = function (root, { base = '' } = {}) {
            root.querySelectorAll('a[href^="#"]').forEach(a => {
                const raw = a.getAttribute('href').slice(1);
                if (!raw) return;
                const t = findAnchor(raw, root);
                if (!t) return;
                if (!t.id) t.id = `heading-x${anchorSeq++}`;
                a.setAttribute('href', '#' + t.id);
            });
            if (!base) return;
            root.querySelectorAll('a[href]').forEach(a => {
                const h = a.getAttribute('href');
                if (!h || h.startsWith('#') || h.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(h)) return;
                try { a.setAttribute('href', new URL(h, base).href); } catch (e) { /* 読めない物はそのまま */ }
            });
        };
        // ---------- 紙の上と下（ヘッダー・フッター） ----------
        // **紙面の四隅は @page のマージンボックスで描く。**
        // 実測（Chrome 152 / CDP の Page.printToPDF で displayHeaderFooter を切り替えて比較）で分かったことが2つある。
        //  ・マージンボックスを定義した枠は、ブラウザ標準のヘッダー/フッター（日時・タイトル・URL・ページ番号）を置き換える。
        //  ・ただし**置き換わるのは定義した枠だけ**で、書かなかった枠には標準が残る。そのため「付けない」場合も content:"" で6枠すべてを潰す。
        // これで紙面の内容が URL やウィンドウのタイトルから切り離せる（実行の形によって file:///… や http://tauri.localhost/… が刷られていた）。
        const MARGIN_BOXES = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
        const PAGE_COUNTER = 'counter(page) " / " counter(pages)';
        // CSS の文字列リテラルへ落とす。ファイル名には円記号も引用符も入りうる
        const cssQuote = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
        P.stamp = function (d = new Date()) {
            const p = n => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
        };
        //   header … 上に文書名（中央）と日時（右）　footer … 下にページ番号（上が無いときは、下の左に文書名）
        //   name … 文書名　date … 日時（既定は今。刷る直前に作る）
        P.pageCss = function ({ header = false, footer = false, name = 'Untitled', date } = {}) {
            const nm = cssQuote(name || 'Untitled');
            const slot = {};
            if (header) { slot['top-center'] = nm; slot['top-right'] = cssQuote(P.stamp(date || new Date())); }
            if (footer && header) slot['bottom-center'] = PAGE_COUNTER;
            // ヘッダーを出さないときは文書名の居場所が無くなるので、フッターが引き取る
            if (footer && !header) { slot['bottom-left'] = nm; slot['bottom-right'] = PAGE_COUNTER; }
            const boxes = MARGIN_BOXES
                .map(b => `@${b} { content: ${slot[b] || '""'}; font-family: sans-serif; font-size: 9pt; color: #555; }`)
                .join(' ');
            // 用紙サイズは指定しない（印刷の窓での選択をそのまま活かす）。上下の余白は、その端に何か刷るときだけ広げる
            return `@page { margin: ${header ? '18mm' : '12mm'} 14mm ${footer ? '16mm' : '12mm'}; ${boxes} }`;
        };
        // ---------- 透かし（v0.4.0h） ----------
        // 利用者「印刷時にウォーターマーク（透かし風）追加出来る機能」。文書の中の `<!-- gd-watermark: 文字 置き方 重ね方 濃さ% 大きさ% 色 -->`
        // （HTML のコメントなので、ほかの Markdown のビュワーでは見えない）。`なし` でその文書だけ付けない。
        // 紙には、本文の直前に置いた <div class="gd-watermark"> の SVG が、position:fixed で全ページに刷られる（CSS の .gd-watermark）。
        const WM = P.watermark = P.watermark || {};
        WM.DEFAULT_TEXT = '社外秘';
        WM.COLORS = { gray: '#808080', 灰: '#808080', red: '#d93025', 赤: '#d93025', blue: '#1a73e8', 青: '#1a73e8' };
        WM.DEFAULTS = { text: '社外秘', layout: 'center', layer: 'front', opacity: 12, size: 100, color: '#808080' };
        const WM_KEYS = { 中央: ['layout', 'center'], center: ['layout', 'center'], 敷き詰め: ['layout', 'tile'], tile: ['layout', 'tile'],
                          前面: ['layer', 'front'], front: ['layer', 'front'], 背面: ['layer', 'back'], back: ['layer', 'back'] };
        // **行の頭に書いた物だけ・コードブロックの外だけ**を読む（README やチートシートは書き方の例を `…` やコードブロックに書いている。
        // それを拾うと、README を刷っただけで透かしが付く）
        const WM_DIRECTIVE_RE = /^[ \t]*<!--\s*gd-watermark\s*:([\s\S]*?)-->/im;
        const WM_FENCE_RE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[ \t]*$|(?![\s\S]))/gm;
        // 文書の中の指定を読む。無ければ null、`なし` なら { off: true }
        WM.parse = function (md) {
            const m = WM_DIRECTIVE_RE.exec(String(md || '').replace(WM_FENCE_RE, ''));
            if (!m) return null;
            const out = {}, words = [];
            for (const t of m[1].matchAll(/"([^"]*)"|'([^']*)'|「([^」]*)」|(\S+)/g)) {
                const quoted = t[1] ?? t[2] ?? t[3];
                if (quoted !== undefined) { words.push(quoted); continue; }
                const w = t[4];
                if (/^(なし|off|none)$/i.test(w)) return { off: true };
                const k = WM_KEYS[w] || WM_KEYS[w.toLowerCase()];
                if (k) { out[k[0]] = k[1]; continue; }
                // 大きさ（大きさ150% / 大きさ=150% / size=150%）。数字と % だけなら濃さ（濃さ15% とも書ける）
                const sz = /^(?:大きさ|size)=?(\d{1,3})[%％]$/i.exec(w);
                // 25〜400%・5% 刻みにそろえる（利用者「大きさは、25%～400% の範囲で、5％刻みの設定にしたい」）
                if (sz) { out.size = Math.max(25, Math.min(400, Math.round(+sz[1] / 5) * 5)); continue; }
                const pct = /^(?:濃さ|opacity)?=?(\d{1,3})[%％]$/i.exec(w);
                if (pct) { out.opacity = Math.max(1, Math.min(100, +pct[1])); continue; }
                const col = WM.COLORS[w] || WM.COLORS[w.toLowerCase()];
                if (col) { out.color = col; continue; }
                words.push(w);
            }
            if (words.length) out.text = words.join(' ');
            return out;
        };
        // 刷る透かしを決める。base … 既定（使う側の設定。on: false なら文書の指定が無いとき付けない）、md … 文書。付けないなら null
        WM.resolve = function (base, md) {
            const s = Object.assign({}, WM.DEFAULTS, base || {});
            const d = WM.parse(md);
            if (d && d.off) return null;
            if (!d && !s.on) return null;
            return Object.assign(s, d || {});
        };
        // 文字の見た目の幅（全角1・半角0.55）。中央の1つは、この幅で文字の大きさを決める
        const wmTextWidth = t => [...t].reduce((n, ch) => n + (/[\u0000-ÿ｡-ﾟ]/.test(ch) ? 0.55 : 1), 0);
        const wmXml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        WM.svg = function (wm) {
            wm = Object.assign({}, WM.DEFAULTS, wm || {});
            const t = wmXml(wm.text), op = (wm.opacity / 100).toFixed(2), w = Math.max(1, wmTextWidth(wm.text));
            const k = (wm.size || 100) / 100;   // 大きさの倍率（v0.4.0h。利用者「ウォーターマーク　文字サイズの調整機能追加」）
            // **字の大きさ・形・色は style にも書く**（v0.4.1）。属性だけだと、ページの CSS に負ける。WaveDrom は自分の SVG の中に
            // ページ全体の text へ効く規則（text { font-size: … }）を入れるので、WaveDrom の図がある文書では透かしが小さな字で刷られていた
            const font = fs => `font-size="${fs}" font-family="sans-serif" font-weight="700" fill="${wm.color}" fill-opacity="${op}"`
                + ` style="font-size:${fs}px;font-family:sans-serif;font-weight:700;fill:${wm.color};fill-opacity:${op};font-style:normal;letter-spacing:normal"`;
            if (wm.layout === 'tile') {
                // 小さめの文字を斜めに繰り返す（模様の1つ分の大きさは文字の幅から）
                const fs = Math.round(22 * k), pw = Math.round(w * fs + 90 * k), ph = Math.round(110 * k);
                return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><defs><pattern id="gd-wm-pat" width="${pw}" height="${ph}" patternUnits="userSpaceOnUse" patternTransform="rotate(-30)">`
                    + `<text x="${pw / 2}" y="${ph / 2}" text-anchor="middle" dominant-baseline="central" ${font(fs)}>${t}</text>`
                    + `</pattern></defs><rect width="100%" height="100%" fill="url(#gd-wm-pat)"/></svg>`;
            }
            // 中央に斜め1つ。頁の幅に合わせる（viewBox を正方形にして meet。縦長の紙では幅いっぱい）。
            // **斜めにした文字が頁の幅（1000）に収まる最大**（幅 = 長さ×cos35° ＋ 高さ×sin35°）を基準にし、100% はその 75%。
            // 上限は設けない。135% 以上は両端が紙の端で切れる（v0.4.0l。利用者「切れても、400% にする。」）
            const fit = 980 / (w * 0.819 + 0.574);
            const fs = Math.round(fit * 0.75 * k);
            // 斜めにするのは包む g の側（text に掛けると、ページの CSS の text の規則に負けうる）
            return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet">`
                + `<g transform="rotate(-35 500 500)"><text x="500" y="500" text-anchor="middle" dominant-baseline="central" ${font(fs)}>${t}</text></g></svg>`;
        };
        // 本文の直前に入れる HTML。付けないなら ''
        WM.html = function (wm) {
            if (!wm) return '';
            wm = Object.assign({}, WM.DEFAULTS, wm);
            return `<div class="gd-watermark gd-wm-${wm.layer} gd-wm-${wm.layout}" aria-hidden="true">${WM.svg(wm)}</div>`;
        };
        // 決まった要素へ透かしを入れ直す（Ctrl+P 用。刷る直前に作り直す）。wm が null なら空にする
        WM.apply = function (el, wm) {
            if (!el) return;
            wm = wm ? Object.assign({}, WM.DEFAULTS, wm) : null;
            el.className = 'gd-watermark' + (wm ? ` gd-wm-${wm.layer} gd-wm-${wm.layout}` : '');
            el.setAttribute('aria-hidden', 'true');
            el.innerHTML = wm ? WM.svg(wm) : '';
        };
        // ---------- 🖨 の写しの文書 ----------
        // ページの <style> を全部集める（gnDocRd の見た目・頼るライブラリが入れた物・使う側の物）。
        // highlight.js のクラスの色は、外から読み込んだ CSS を読めないことがあるので、根元の中で使っている物だけ色を書き足す
        P.collectStyles = function (root) {
            let styles = '';
            // 切ってある物（disabled）は入れない。コードの色分けは明るい・暗いの2つの配色を入れて片方を切っているので、
            // 両方を写すと書き出した先で両方が効き、字が薄くなる（v0.4.1a）
            document.querySelectorAll('style').forEach(el => { if (!el.disabled) styles += el.textContent + '\n'; });
            const hlClasses = new Set();
            if (root) root.querySelectorAll('[class*="hljs"]').forEach(el => {
                Array.from(el.classList).filter(c => c.startsWith('hljs')).forEach(c => hlClasses.add(c));
            });
            if (hlClasses.size > 0) {
                styles += '/* Highlight.js Styles */\ncode { white-space: pre-wrap; word-break: break-word; }\n';
                const hlColorMap = {
                    'hljs-attr': 'color: #31a3ff;', 'hljs-string': 'color: #00cc00;', 'hljs-number': 'color: #ff6600;',
                    'hljs-literal': 'color: #ff6600;', 'hljs-attr-value': 'color: #00cc00;', 'hljs-tag': 'color: #ff6600;',
                    'hljs-title': 'color: #0099ff;', 'hljs-section': 'color: #0099ff;', 'hljs-doctag': 'color: #0099ff;',
                    'hljs-name': 'color: #0099ff;', 'hljs-strong': 'font-weight: bold;', 'hljs-emphasis': 'font-style: italic;',
                    'hljs-bullet': 'color: #ff6600;', 'hljs-quote': 'color: #00cc00;', 'hljs-code': 'color: #666666;',
                    'hljs-selector-tag': 'color: #ff6600;', 'hljs-selector-id': 'color: #31a3ff;', 'hljs-selector-class': 'color: #31a3ff;',
                    'hljs-selector-attr': 'color: #31a3ff;', 'hljs-symbol': 'color: #ff6600;', 'hljs-built_in': 'color: #0099ff;',
                    'hljs-keyword': 'color: #ff6600;', 'hljs-type': 'color: #0099ff;', 'hljs-meta': 'color: #666666;',
                    'hljs-comment': 'color: #888888;', 'hljs-variable': 'color: #31a3ff;', 'hljs-template-variable': 'color: #31a3ff;',
                    'hljs-link': 'color: #0099ff;', 'hljs-addition': 'color: #00cc00; background-color: #f0fff0;',
                    'hljs-deletion': 'color: #ff0000; background-color: #fff0f0;',
                };
                hlClasses.forEach(cls => { if (hlColorMap[cls]) styles += `.${cls} { ${hlColorMap[cls]} }\n`; });
            }
            return styles;
        };
        function blobToDataUrl(blob) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        }
        P.blobToDataUrl = blobToDataUrl;
        // 外部サーバーで描いた図（PlantUML・DBML・D2・Graphviz の画像）を data: URL にして写しへ埋め込む（書き出した先でも、つながっていなくても出るように）。
        // 取れなければ元の URL のまま
        P.inlineExternalImages = async function (root) {
            const imgs = Array.from(root.querySelectorAll('.plantuml img, .dbml img, .d2 img, .graphviz img'));
            await Promise.all(imgs.map(async img => {
                if (!img.src || !/^https?:/i.test(img.src)) return;
                try {
                    // no-cors で読み込んだ時の opaque な応答を使い回すと CORS の確かめで落ちるので、必ず取り直す
                    const res = await fetch(img.src, { cache: 'reload' });
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    img.src = await blobToDataUrl(await res.blob());
                } catch (e) {
                    console.warn('[gnDocRd.print] 外部の図の画像を埋め込めませんでした（元の URL のまま）', img.src, e);
                }
            }));
        };
        const htmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        // 🖨 の写しの文書（HTML の文字列）。
        //   title … 題名（「PDF に保存」の既定のファイル名になる）　css … collectStyles の物　body … 写し（要素か HTML）
        //   watermark … WM.html の物　autoPrint … 読み終えたら刷って閉じる　rootId・rootClass … 本文の入れ物の id と class
        //   （gnDoc は id="viewer"。gnDocRd は class="gnDocRd gnDocRd-print"）　pageCss … P.pageCss の物
        P.documentHtml = function ({ title = 'Untitled', css = '', body = '', watermark = '', autoPrint = false, rootId = '', rootClass = 'gnDocRd gnDocRd-print', pageCss = '' } = {}) {
            const inner = typeof body === 'string' ? body : body.innerHTML;
            // 入れ物を表に出す規則は、id があれば id で書く（gnDoc の印刷の CSS は画面の部品を id で隠しており〔#viewer も〕、class で書くと負ける）
            const attrs = rootId ? ` id="${htmlEsc(rootId)}"${rootClass ? ` class="${htmlEsc(rootClass)}"` : ''}` : ` class="gd-print-doc${rootClass ? ' ' + htmlEsc(rootClass) : ''}"`;
            const S = rootId ? '#' + CSS.escape(rootId) : '.gd-print-doc';
            const layout = 'html,body{display:block!important;height:auto!important;overflow:visible!important;background:white!important;color:black!important;margin:0!important;}'
                + S + '{display:block!important;padding:0!important;width:100%!important;height:auto!important;overflow:visible!important;}'
                + 'pre{background:#f5f5f5!important;padding:12px!important;border-radius:4px!important;border:1px solid #ddd!important;overflow-x:auto!important;}'
                + '.mermaid svg,.wavedrom svg,.plantuml img,.chartjs img,.dbml img,.d2 img,.graphviz img{max-width:100%!important;height:auto!important;display:block!important;overflow:visible!important;}'
                + 'canvas{max-width:100%!important;height:auto!important;}img[data-canvas-img]{max-width:100%!important;height:auto!important;display:block!important;}'
                + '@media print{' + S + '{display:block!important;}#print-ready{display:none!important;}}';
            const go = autoPrint ? '<script>window.addEventListener("load",function(){window.focus();window.print();window.close();});window.addEventListener("afterprint",function(){window.close();});<\/script>' : '';
            // 本文はコールバックで差し込む（文字列で渡すと、本文の中の `$&` などを置き換えの特別な記号と読んで文字が壊れる）
            return ('<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>' + htmlEsc(title) + '</title><style>' + css + '\n' + layout + (pageCss ? '\n' + pageCss : '')
                + '</style></head><body>' + watermark + '<div' + attrs + '>GD_PRINT_BODY</div>' + go + '</body></html>').replace('GD_PRINT_BODY', () => inner);
        };
        // 写しの文書を刷る。新しい窓で開いて刷る（読み終えたら刷って閉じる。autoPrint を入れた文書）。
        // 窓を開けない（窓を出せない所・iframe: true）ときは、見えない iframe に入れて刷る。onDone … 刷り終えた（iframe を片付けた）とき
        P.open = function (html, opts = {}) {
            const onDone = opts.onDone;
            const pw = opts.iframe ? null : window.open('', '_blank');
            if (pw && !pw.closed) { pw.document.open(); pw.document.write(html); pw.document.close(); return pw; }
            const f = document.createElement('iframe');
            f.style.display = 'none';
            document.body.appendChild(f);
            const doc = f.contentWindow.document;
            doc.open(); doc.write(html); doc.close();
            f.contentWindow.addEventListener('afterprint', () => { f.remove(); if (onDone) onDone(); }, { once: true });
            // **ここでは print() を呼ばない。** 写しの中の load の合図（画像を読み終えた後）で1回だけ刷る（ここでも呼ぶと2度刷る。v0.3.18k）
            f.contentWindow.focus();
            return f;
        };
        // ---------- 単一HTMLの書き出し（v0.4.1a。利用者「html書出し機能も含められるか？　検討」→「進めて」） ----------
        // 1つのファイルで開ける HTML（図は描いた物・外部サーバーの図は埋め込む・スクリプトのライブラリは要らない）の文字列を返す。
        // MHTML はブラウザが開き直したときにスクリプトを止めるので、目次で飛ぶ・折りたたみの全部開くが動かなくなる。素の .html にする。
        //   title … 題名　css … collectStyles の物　rootId・rootClass … 本文の入れ物（gnDoc は id="viewer"）
        //   toc … 右に見出しの一覧（h1〜h3）　tocWidth … その幅　bodyClass・bodyAttrs … body に足す class と属性（テーマ）
        //   headCss … 足す CSS（淡い色の濃さなど）　head … <head> に足す HTML（タブのアイコン）　watermark … WM.html の物（紙に刷る透かし）
        //   script … 足すスクリプト（コメントのポップアップ。写しを受け取る関数でもよい）　prepare(写し) … 写しから画面だけの物を外す　decorate(写し) … 埋め込みなど（async 可）
        //   base … 相対のリンクの基準（無ければそのまま。書き出した HTML を文書の隣に置けば効く）
        P.exportHtml = async function (root, opts = {}) {
            const rootId = opts.rootId || '', rootClass = opts.rootClass === undefined ? 'gnDocRd' : opts.rootClass;
            const clone = P.snapshot(root, { faq: false, prepare: opts.prepare });
            // 書き出した先では動かない部品（拡大縮小のボタン・PlantUML の手順の再生）は外す
            clone.querySelectorAll('.zoom-controls, .plantuml-step-panel, .plantuml-step-overlay').forEach(el => el.remove());
            if (opts.decorate) await opts.decorate(clone);
            await P.inlineExternalImages(clone);
            // 見出しの id は位置から振る（heading-N）。文書の中の `[…](#見出し)` は、書き出す時に行き先の id へ書き換える
            // （書き出したファイルには、押したときに見出しを引き当てるスクリプトが無い。h4〜h6 は fixLinks が振る）
            const headings = Array.from(clone.querySelectorAll('h1,h2,h3'));
            headings.forEach((h, i) => h.setAttribute('id', `heading-${i}`));
            P.fixLinks(clone, { base: opts.base || '' });
            const S = rootId ? '#' + CSS.escape(rootId) : '.gd-export-doc';
            const attrs = rootId ? ` id="${htmlEsc(rootId)}"${rootClass ? ` class="${htmlEsc(rootClass)}"` : ''}` : ` class="gd-export-doc${rootClass ? ' ' + htmlEsc(rootClass) : ''}"`;
            let tocHTML = '', tocCSS = '';
            if (opts.toc && headings.length) {
                const items = headings.map((h, i) => {
                    const hn = h.dataset.hnum ? ` data-hnum="${htmlEsc(h.dataset.hnum)}"` : '';
                    return `<a href="#heading-${i}" class="toc-item toc-${h.tagName}"${hn}>${htmlEsc(h.textContent)}</a>`;
                }).join('');
                tocHTML = `<div id="toc"><h3>見出し一覧</h3><div id="toc-list">${items}</div></div>`;
                tocCSS = `body.export-doc{display:flex!important;}:root{--toc-width:${opts.tocWidth || '260px'};}#toc{width:var(--toc-width);flex-shrink:0;border-left:1px solid var(--border-color);box-sizing:border-box;padding:20px;overflow-y:auto;height:100vh;position:sticky;top:0;}`
                    // 項目の見た目の既定（gnDoc は自分の CSS に目次の規則を持っているので、そちらが勝つよう :where で弱くする）
                    + ':where(#toc) h3{margin:0 0 10px;font-size:14px;}:where(#toc) .toc-item{display:block;padding:3px 0;color:inherit;text-decoration:none;font-size:13px;}:where(#toc) .toc-H2{padding-left:12px;}:where(#toc) .toc-H3{padding-left:24px;}';
            }
            // 本文の幅は窓の幅の8割ほどに留めて中央に寄せる（図が画面の端まで広がらないように）。図と画像は幅に収める。
            // **flow のグリッドの箱の形（.fg-shape）は外す**（箱いっぱいに伸ばす SVG で、height:auto を当てると元の正方形に戻って崩れる。v0.4.0f）
            const layoutCSS = `html,body.export-doc{display:block;overflow:visible;height:auto;margin:0;scroll-behavior:smooth;}body.export-doc{display:block;}`
                + `${S}{padding:30px 40px;box-sizing:border-box;overflow-x:auto;overflow-y:visible;height:auto;flex:1;max-width:80vw;margin:0 auto;}`
                + `${S} svg:not(.fg-shape),${S} img,${S} canvas{max-width:100%!important;height:auto!important;}`;
            // 紙に刷るときは、目次を隠して本文を紙の幅に（図の大きさは .gd-print-fit の決まり）
            const printCSS = `@media print{html,body.export-doc{overflow:visible!important;height:auto!important;}body.export-doc{display:block!important;}#toc{display:none!important;}`
                + `${S}{display:block!important;overflow:visible!important;max-width:100%!important;width:100%!important;margin:0!important;padding:0!important;}`
                + '.mermaid svg,.wavedrom svg,.plantuml img,.chartjs img,.dbml img,.d2 img,.graphviz img{max-width:100%!important;height:auto!important;display:block!important;overflow:visible!important;}}';
            const jumpScript = "document.addEventListener('click',function(e){var a=e.target.closest('#toc a[href^=\"#\"]');if(!a)return;e.preventDefault();var t=document.getElementById(a.getAttribute('href').slice(1));if(t)t.scrollIntoView({behavior:'smooth'});});";
            // 折りたたみ（details）があるときだけ、全部開く・全部閉じるのボタンを入れる
            const hasDetails = clone.querySelectorAll('details').length > 0;
            const btn = 'padding:6px 10px;border-radius:4px;border:1px solid var(--border-color);background:var(--bg-color);color:var(--text-color);cursor:pointer;';
            const detailsHTML = hasDetails ? `<div id="details-controls" style="position:fixed;bottom:16px;right:16px;z-index:500;display:flex;gap:6px;">`
                + `<button id="details-expand-all" style="${btn}">全展開</button><button id="details-collapse-all" style="${btn}">全折りたたみ</button></div>` : '';
            const sel = JSON.stringify(S + ' details');
            const detailsScript = hasDetails ? `document.getElementById('details-expand-all').addEventListener('click',function(){document.querySelectorAll(${sel}).forEach(function(d){d.open=true;});});`
                + `document.getElementById('details-collapse-all').addEventListener('click',function(){document.querySelectorAll(${sel}).forEach(function(d){d.open=false;});});` : '';
            const bodyClass = 'export-doc' + (opts.bodyClass ? ' ' + opts.bodyClass : '');
            return ('<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>' + htmlEsc(opts.title || 'Untitled') + '</title>' + (opts.head || '') + '<style>'
                + (opts.css || '') + '\n' + layoutCSS + '\n' + tocCSS + '\n' + printCSS + (opts.headCss ? '\n' + opts.headCss : '')
                + '</style></head><body class="' + htmlEsc(bodyClass) + '"' + (opts.bodyAttrs || '') + '>' + (opts.watermark || '') + '<div' + attrs + '>GD_EXPORT_BODY</div>' + detailsHTML
                + tocHTML + '<script>' + jumpScript + detailsScript + ((typeof opts.script === 'function' ? opts.script(clone) : opts.script) || '') + '<\/script></body></html>').replace('GD_EXPORT_BODY', () => clone.innerHTML);
        };
        return P;
    }
    gnDocRdPrint(gnDocRd);
    // ---------- 記法の見た目（gnDoc.html の @gnDocRd-css。#viewer → .gnDocRd） ----------
    gnDocRd.CSS = "/* ---------- 色相ひとつを4色へ展開する（表と装飾枠が共有する） ----------\n   `{theme=Blue}` `{theme=青}` のように**書くのは色名ひとつ**で、\n   地・罫線・見出しの地・文字の4色はここが決める。仕様は\n   `docs/gnDoc 表示機能拡張仕様案（枠と表とカラー）_改訂版.md` §2・§5。\n\n   **色は本文の色記法（{blue:…}）と同じ語彙・同じ変数を使い、テーマに追従する。**\n   利用者決定・2026-09-18。2026-09-17 の「仕様書の16進値を固定で使う」を差し替えた。\n   固定値のままだと、**同じ「青」が本文と表とで違う色になる**うえ、\n   ダーク系で表だけが地から浮く。どちらも語彙をひとつに畳めば同時に消える。\n   **色の値そのものは --gd-c-* / --gd-bg-* にしか無い。** ここが決めるのは\n   「色相ひとつを、4つの役へどう割り当てるか」だけ。\n\n   見出しの帯（表の見出し行・装飾枠の題）は地より1つ濃い段（色相だけなら淡）。帯の文字は帯の明るさから\n   白黒を自動で決める（2026-10-08 から。以前は標準色の帯に白文字で、帯が濃すぎた）。\n\n   **表と装飾枠で規則を2組持たない。** 持つと同じ「青」が両者でずれる。\n   使う側（table.gd-table / div.gd-deco）は gd-hue を一緒に付けるだけでよい。 */\n.gnDocRd .gd-hue {\n    /* 色相ごとの4色。色名を書かない既定は灰。 */\n    --gdh-tint: var(--gd-bg-gray);    /* 超淡: 地 */\n    --gdh-lt:   var(--gd-c-ltgray);   /* 淡 */\n    --gdh-base: var(--gd-c-gray);     /* 標準: 見出し帯の地 */\n    --gdh-dk:   var(--gd-c-dkgray);   /* 濃 */\n    /* 役割への割り当て（ライト系・セピア系）。\n       **見出しの帯（表の見出し行・装飾枠の題）は、地より1つ濃い段**（2026-10-08 利用者「タイトルの背景色が濃すぎる。\n       淡い色合いの指定に修正」）。色相だけ・極淡の地なら帯は淡と極淡の間（以前は標準色で、濃すぎた）。 */\n    --gdh-bg:   var(--gdh-tint);\n    --gdh-ink:  var(--gdh-dk);\n    --gdh-line: var(--gdh-lt);\n    /* 色相だけ・極淡の帯は「淡」を地（極淡）へ6割寄せた色。ライト系の淡は文字に使える中くらいの濃さなので、\n       そのままでは帯がまだ濃い（2026-10-08 実測。青・ピンクの帯が目立ちすぎた）。 */\n    --gdh-head-bg: color-mix(in srgb, var(--gdh-lt) 40%, var(--gdh-tint));\n    /* 帯の文字は帯の明るさから白黒を自動で決める（相対輝度 0.179 未満なら白。フロー図の箱と同じ規則）。\n       淡い帯には黒、濃い帯には白が来る。テーマと濃淡のどの組でも読める側になる。 */\n    --gdh-head-ink: rgb(from var(--gdh-head-bg) clamp(0, (0.179 - (0.2126 * pow(r / 255, 2.2) + 0.7152 * pow(g / 255, 2.2) + 0.0722 * pow(b / 255, 2.2))) * 100000, 255) clamp(0, (0.179 - (0.2126 * pow(r / 255, 2.2) + 0.7152 * pow(g / 255, 2.2) + 0.0722 * pow(b / 255, 2.2))) * 100000, 255) clamp(0, (0.179 - (0.2126 * pow(r / 255, 2.2) + 0.7152 * pow(g / 255, 2.2) + 0.0722 * pow(b / 255, 2.2))) * 100000, 255));\n    /* 濃淡付きの地の上の本文の文字（同じ規則） */\n    --gdh-auto-ink: rgb(from var(--gdh-bg) clamp(0, (0.179 - (0.2126 * pow(r / 255, 2.2) + 0.7152 * pow(g / 255, 2.2) + 0.0722 * pow(b / 255, 2.2))) * 100000, 255) clamp(0, (0.179 - (0.2126 * pow(r / 255, 2.2) + 0.7152 * pow(g / 255, 2.2) + 0.0722 * pow(b / 255, 2.2))) * 100000, 255) clamp(0, (0.179 - (0.2126 * pow(r / 255, 2.2) + 0.7152 * pow(g / 255, 2.2) + 0.0722 * pow(b / 255, 2.2))) * 100000, 255));\n}\n/* ダーク系は明暗が入れ替わる。文字は淡色、罫線は濃色にする。 */\nbody.theme-dark .gnDocRd .gd-hue {\n    --gdh-ink:  var(--gdh-lt);\n    --gdh-line: var(--gdh-dk);\n}\n/* 色相の割り当て。基底規則と**詳細度が同じ**なので、必ず後ろに置く。 */\n.gnDocRd .gd-hue-red    { --gdh-tint: var(--gd-bg-red);    --gdh-lt: var(--gd-c-ltred);    --gdh-base: var(--gd-c-red);    --gdh-dk: var(--gd-c-dkred); --gdh-ltdk: var(--gd-c-ltdkred); --gdh-dklt: var(--gd-c-dkltred); --gdh-dkdk: var(--gd-c-dkdkred); }\n.gnDocRd .gd-hue-orange { --gdh-tint: var(--gd-bg-orange); --gdh-lt: var(--gd-c-ltorange); --gdh-base: var(--gd-c-orange); --gdh-dk: var(--gd-c-dkorange); --gdh-ltdk: var(--gd-c-ltdkorange); --gdh-dklt: var(--gd-c-dkltorange); --gdh-dkdk: var(--gd-c-dkdkorange); }\n.gnDocRd .gd-hue-yellow { --gdh-tint: var(--gd-bg-yellow); --gdh-lt: var(--gd-c-ltyellow); --gdh-base: var(--gd-c-yellow); --gdh-dk: var(--gd-c-dkyellow); --gdh-ltdk: var(--gd-c-ltdkyellow); --gdh-dklt: var(--gd-c-dkltyellow); --gdh-dkdk: var(--gd-c-dkdkyellow); }\n.gnDocRd .gd-hue-green  { --gdh-tint: var(--gd-bg-green);  --gdh-lt: var(--gd-c-ltgreen);  --gdh-base: var(--gd-c-green);  --gdh-dk: var(--gd-c-dkgreen); --gdh-ltdk: var(--gd-c-ltdkgreen); --gdh-dklt: var(--gd-c-dkltgreen); --gdh-dkdk: var(--gd-c-dkdkgreen); }\n.gnDocRd .gd-hue-teal   { --gdh-tint: var(--gd-bg-teal);   --gdh-lt: var(--gd-c-ltteal);   --gdh-base: var(--gd-c-teal);   --gdh-dk: var(--gd-c-dkteal); --gdh-ltdk: var(--gd-c-ltdkteal); --gdh-dklt: var(--gd-c-dkltteal); --gdh-dkdk: var(--gd-c-dkdkteal); }\n.gnDocRd .gd-hue-blue   { --gdh-tint: var(--gd-bg-blue);   --gdh-lt: var(--gd-c-ltblue);   --gdh-base: var(--gd-c-blue);   --gdh-dk: var(--gd-c-dkblue); --gdh-ltdk: var(--gd-c-ltdkblue); --gdh-dklt: var(--gd-c-dkltblue); --gdh-dkdk: var(--gd-c-dkdkblue); }\n.gnDocRd .gd-hue-purple { --gdh-tint: var(--gd-bg-purple); --gdh-lt: var(--gd-c-ltpurple); --gdh-base: var(--gd-c-purple); --gdh-dk: var(--gd-c-dkpurple); --gdh-ltdk: var(--gd-c-ltdkpurple); --gdh-dklt: var(--gd-c-dkltpurple); --gdh-dkdk: var(--gd-c-dkdkpurple); }\n.gnDocRd .gd-hue-pink   { --gdh-tint: var(--gd-bg-pink);   --gdh-lt: var(--gd-c-ltpink);   --gdh-base: var(--gd-c-pink);   --gdh-dk: var(--gd-c-dkpink); --gdh-ltdk: var(--gd-c-ltdkpink); --gdh-dklt: var(--gd-c-dkltpink); --gdh-dkdk: var(--gd-c-dkdkpink); }\n.gnDocRd .gd-hue-gray   { --gdh-tint: var(--gd-bg-gray);   --gdh-lt: var(--gd-c-ltgray);   --gdh-base: var(--gd-c-gray);   --gdh-dk: var(--gd-c-dkgray); --gdh-ltdk: var(--gd-c-ltdkgray); --gdh-dklt: var(--gd-c-dkltgray); --gdh-dkdk: var(--gd-c-dkdkgray); }\n/* ---------- 表の属性行による配色（表示機能拡張 第1段） ---------- */\n.gnDocRd table.gd-table th { background: var(--gdh-head-bg); color: var(--gdh-head-ink); border-bottom-color: var(--gdh-line); }\n.gnDocRd table.gd-table td { background: var(--gdh-bg); color: var(--gdh-ink); border-bottom-color: var(--gdh-line); }\n/* 濃淡付き（{theme=ltBlue} など。装飾枠と同じ7段）。地が濃くなるので、本文の文字も地から白黒を決める。 */\n.gnDocRd table.gd-table[class*=\"gd-tone-\"] td { color: var(--gdh-auto-ink); }\n.gnDocRd table.gd-table[class*=\"gd-tone-\"] td a { color: inherit; text-decoration: underline; }\n/* ---------- GFM の注記（> [!NOTE] ほか） ----------\n   色相は種類ごとの class が --gd-alert-hue / --gd-alert-tint に入れる（本文の色記法と同じ変数）。\n   GitHub と同じく**左の太線と題の色**で種類を示す。地は極淡で薄く敷く（印刷でも種類が分かるように）。 */\n/* 脚注（v0.4.3e）。本文の [^1] は上付きの番号、定義は小さめの字で「番号 本文 ↩」。続く定義の頭にだけ区切りの線 */\n.gnDocRd sup.gd-fn-ref a { text-decoration: none; padding: 0 1px; }\n.gnDocRd .gd-fn-def { font-size: 0.9em; margin: 0.2em 0; padding-left: 2em; text-indent: -2em; }\n.gnDocRd :not(.gd-fn-def) + .gd-fn-def { margin-top: 1.4em; padding-top: 0.6em; border-top: 1px solid var(--border-color); }\n.gnDocRd .gd-fn-label { display: inline-block; min-width: 1.6em; text-indent: 0; font-weight: bold; color: var(--accent-color); }\n.gnDocRd .gd-fn-back { text-decoration: none; font-size: 0.9em; }\n.gnDocRd .gd-fn-def:target, .gnDocRd sup.gd-fn-ref:has(a:target) { background: color-mix(in srgb, var(--accent-color) 18%, transparent); }\n.gnDocRd blockquote.gd-alert {\n    margin: 16px 0; padding: 8px 14px;\n    border-left: 4px solid var(--gd-alert-hue);\n    background: var(--gd-alert-tint);\n    border-radius: 0 4px 4px 0;\n}\n.gnDocRd blockquote.gd-alert-note      { --gd-alert-hue: var(--gd-c-blue);   --gd-alert-tint: var(--gd-bg-blue); }\n.gnDocRd blockquote.gd-alert-tip       { --gd-alert-hue: var(--gd-c-green);  --gd-alert-tint: var(--gd-bg-green); }\n.gnDocRd blockquote.gd-alert-important { --gd-alert-hue: var(--gd-c-purple); --gd-alert-tint: var(--gd-bg-purple); }\n.gnDocRd blockquote.gd-alert-warning   { --gd-alert-hue: var(--gd-c-orange); --gd-alert-tint: var(--gd-bg-orange); }\n.gnDocRd blockquote.gd-alert-caution   { --gd-alert-hue: var(--gd-c-red);    --gd-alert-tint: var(--gd-bg-red); }\n.gnDocRd blockquote.gd-alert .gd-alert-title {\n    margin: 0 0 4px; font-weight: bold; color: var(--gd-alert-hue);\n}\n.gnDocRd blockquote.gd-alert > :last-child { margin-bottom: 0; }\n/* ---------- 装飾枠・カード（表示機能拡張 第2段） ----------\n   ```decoBd{title=\"…\" theme=青} のフェンスで作る。中身は Markdown として描く。\n   **本文の文字色は変えない。** 色相は「帯・枠線・地」で示す。\n   本文まで色相の濃色にすると、数行を超えた時点で読みにくくなる\n   （仕様案の例は短い箇条書きだけだったが、実文書ではそうとは限らない）。 */\n.gnDocRd .gd-deco {\n    margin: 20px 0;\n    border: 1px solid var(--gdh-line);\n    border-radius: 6px;\n    background: var(--gdh-bg);\n    overflow: hidden;\n}\n.gnDocRd .gd-deco-title {\n    background: var(--gdh-head-bg); color: var(--gdh-head-ink);\n    font-weight: bold; padding: 8px 14px; line-height: 1.5;\n}\n.gnDocRd .gd-deco-body { padding: 12px 14px; }\n/* 濃淡付き（```decoBd{ltdkRed}・{theme=ltBlue} など。7段）。**表と装飾枠で同じ規則**。\n   地がその濃さになり、**帯と枠線は地より1つ濃い段**（淡い順に ltlt < lt < ltdk < 標準 < dklt < dk < dkdk）。\n   極濃の地だけは、それより濃い段が無いので帯を濃（1つ淡い段）にする。\n   **地が濃くなるので、本文と帯の文字は地の明るさから白黒を自動で決める**（--gdh-auto-ink / --gdh-head-ink）。\n   色相だけと極淡（ltlt）は、地は極淡・帯は淡と極淡の間（.gd-hue の既定）。本文の文字色は変えない。 */\n.gnDocRd :is(.gd-deco, table.gd-table).gd-tone-lt   { --gdh-bg: var(--gdh-lt);   --gdh-head-bg: var(--gdh-ltdk); --gdh-line: var(--gdh-ltdk); }\n.gnDocRd :is(.gd-deco, table.gd-table).gd-tone-ltdk { --gdh-bg: var(--gdh-ltdk); --gdh-head-bg: var(--gdh-base); --gdh-line: var(--gdh-base); }\n.gnDocRd :is(.gd-deco, table.gd-table).gd-tone-dklt { --gdh-bg: var(--gdh-dklt); --gdh-head-bg: var(--gdh-dk);   --gdh-line: var(--gdh-dk); }\n.gnDocRd :is(.gd-deco, table.gd-table).gd-tone-dk   { --gdh-bg: var(--gdh-dk);   --gdh-head-bg: var(--gdh-dkdk); --gdh-line: var(--gdh-dkdk); }\n.gnDocRd :is(.gd-deco, table.gd-table).gd-tone-dkdk { --gdh-bg: var(--gdh-dkdk); --gdh-head-bg: var(--gdh-dk);   --gdh-line: var(--gdh-dk); }\n.gnDocRd .gd-deco[class*=\"gd-tone-\"] .gd-deco-body { color: var(--gdh-auto-ink); }\n/* 濃い地の上の青いリンクは読めないので、地の文字色に合わせて下線で示す。 */\n.gnDocRd .gd-deco[class*=\"gd-tone-\"] .gd-deco-body a { color: inherit; text-decoration: underline; }\n/* 枠の内側の上下端に、段落の余白がそのまま出ると間延びする。 */\n.gnDocRd .gd-deco-body > :first-child { margin-top: 0; }\n.gnDocRd .gd-deco-body > :last-child { margin-bottom: 0; }\n/* ---------- フロー図の箱の色（表示機能拡張 第3段） ----------\n   ```flow は Mermaid へ書き換えて描かせる（決定9）。色だけはこちらで持つ。\n\n   **Mermaid の色指定は使えない。** 実測で分かったこと:\n     - `style n1 fill:var(--gd-bg-blue)` … パーサが `(` を受け付けず、図ごと落ちる\n     - `classDef gdf-blue fill:#eef`    … Mermaid が SVG の中へ **ID 付きの\n       `!important` 規則**を書くので、こちらの CSS が負ける（固定色になる）\n   そこで **色を持たない classDef でクラス名だけ付けさせ**、色はここで与える。\n   こうすると箱の色も本文・表・装飾枠と同じ変数から来る＝テーマに追従する。 */\n/* 箱の色は変数で渡す（Mermaid の箱とグリッドの箱で同じ規則を使う）。\n   --gf-fill 地／--gf-stroke 枠／--gf-ink 文字（濃淡付きのときだけ）。\n   色相だけ（{青}）と極淡（{ltltBlue}）… 極淡の地・淡の枠。文字は本文色（これまでの {青} と同じ）\n   淡 lt … 淡の地に黒文字（ライト系 4.96:1 以上・ダーク系 8.5:1 以上）\n   濃 dk … 濃の地に白文字（ライト系 7.7:1 以上）。**ダーク系は黒文字**（白 3.2:1／黒 4.9:1）\n   極濃 dkdk … 極濃の地に白文字（ライト系 12.9:1・ダーク系 4.67:1 以上）\n   値はどれも 2026-09-29 に9色相×2系統で計算した最小値。 */\n.gdf-red { --gf-fill: var(--gd-bg-red); --gf-stroke: var(--gd-c-ltred); }\n.gdf-orange { --gf-fill: var(--gd-bg-orange); --gf-stroke: var(--gd-c-ltorange); }\n.gdf-yellow { --gf-fill: var(--gd-bg-yellow); --gf-stroke: var(--gd-c-ltyellow); }\n.gdf-green { --gf-fill: var(--gd-bg-green); --gf-stroke: var(--gd-c-ltgreen); }\n.gdf-teal { --gf-fill: var(--gd-bg-teal); --gf-stroke: var(--gd-c-ltteal); }\n.gdf-blue { --gf-fill: var(--gd-bg-blue); --gf-stroke: var(--gd-c-ltblue); }\n.gdf-purple { --gf-fill: var(--gd-bg-purple); --gf-stroke: var(--gd-c-ltpurple); }\n.gdf-pink { --gf-fill: var(--gd-bg-pink); --gf-stroke: var(--gd-c-ltpink); }\n.gdf-gray { --gf-fill: var(--gd-bg-gray); --gf-stroke: var(--gd-c-ltgray); }\n.gdf-ltred { --gf-fill: var(--gd-c-ltred); --gf-stroke: var(--gd-c-red); --gf-ink: #1a1a1a; }\n.gdf-ltorange { --gf-fill: var(--gd-c-ltorange); --gf-stroke: var(--gd-c-orange); --gf-ink: #1a1a1a; }\n.gdf-ltyellow { --gf-fill: var(--gd-c-ltyellow); --gf-stroke: var(--gd-c-yellow); --gf-ink: #1a1a1a; }\n.gdf-ltgreen { --gf-fill: var(--gd-c-ltgreen); --gf-stroke: var(--gd-c-green); --gf-ink: #1a1a1a; }\n.gdf-ltteal { --gf-fill: var(--gd-c-ltteal); --gf-stroke: var(--gd-c-teal); --gf-ink: #1a1a1a; }\n.gdf-ltblue { --gf-fill: var(--gd-c-ltblue); --gf-stroke: var(--gd-c-blue); --gf-ink: #1a1a1a; }\n.gdf-ltpurple { --gf-fill: var(--gd-c-ltpurple); --gf-stroke: var(--gd-c-purple); --gf-ink: #1a1a1a; }\n.gdf-ltpink { --gf-fill: var(--gd-c-ltpink); --gf-stroke: var(--gd-c-pink); --gf-ink: #1a1a1a; }\n.gdf-ltgray { --gf-fill: var(--gd-c-ltgray); --gf-stroke: var(--gd-c-gray); --gf-ink: #1a1a1a; }\n.gdf-dkred { --gf-fill: var(--gd-c-dkred); --gf-stroke: var(--gd-c-dkdkred); --gf-ink: #fff; }\n.gdf-dkorange { --gf-fill: var(--gd-c-dkorange); --gf-stroke: var(--gd-c-dkdkorange); --gf-ink: #fff; }\n.gdf-dkyellow { --gf-fill: var(--gd-c-dkyellow); --gf-stroke: var(--gd-c-dkdkyellow); --gf-ink: #fff; }\n.gdf-dkgreen { --gf-fill: var(--gd-c-dkgreen); --gf-stroke: var(--gd-c-dkdkgreen); --gf-ink: #fff; }\n.gdf-dkteal { --gf-fill: var(--gd-c-dkteal); --gf-stroke: var(--gd-c-dkdkteal); --gf-ink: #fff; }\n.gdf-dkblue { --gf-fill: var(--gd-c-dkblue); --gf-stroke: var(--gd-c-dkdkblue); --gf-ink: #fff; }\n.gdf-dkpurple { --gf-fill: var(--gd-c-dkpurple); --gf-stroke: var(--gd-c-dkdkpurple); --gf-ink: #fff; }\n.gdf-dkpink { --gf-fill: var(--gd-c-dkpink); --gf-stroke: var(--gd-c-dkdkpink); --gf-ink: #fff; }\n.gdf-dkgray { --gf-fill: var(--gd-c-dkgray); --gf-stroke: var(--gd-c-dkdkgray); --gf-ink: #fff; }\n.gdf-dkdkred { --gf-fill: var(--gd-c-dkdkred); --gf-stroke: var(--gd-c-dkdkred); --gf-ink: #fff; }\n.gdf-dkdkorange { --gf-fill: var(--gd-c-dkdkorange); --gf-stroke: var(--gd-c-dkdkorange); --gf-ink: #fff; }\n.gdf-dkdkyellow { --gf-fill: var(--gd-c-dkdkyellow); --gf-stroke: var(--gd-c-dkdkyellow); --gf-ink: #fff; }\n.gdf-dkdkgreen { --gf-fill: var(--gd-c-dkdkgreen); --gf-stroke: var(--gd-c-dkdkgreen); --gf-ink: #fff; }\n.gdf-dkdkteal { --gf-fill: var(--gd-c-dkdkteal); --gf-stroke: var(--gd-c-dkdkteal); --gf-ink: #fff; }\n.gdf-dkdkblue { --gf-fill: var(--gd-c-dkdkblue); --gf-stroke: var(--gd-c-dkdkblue); --gf-ink: #fff; }\n.gdf-dkdkpurple { --gf-fill: var(--gd-c-dkdkpurple); --gf-stroke: var(--gd-c-dkdkpurple); --gf-ink: #fff; }\n.gdf-dkdkpink { --gf-fill: var(--gd-c-dkdkpink); --gf-stroke: var(--gd-c-dkdkpink); --gf-ink: #fff; }\n.gdf-dkdkgray { --gf-fill: var(--gd-c-dkdkgray); --gf-stroke: var(--gd-c-dkdkgray); --gf-ink: #fff; }\nbody.theme-dark [class*=\"gdf-dk\"]:not([class*=\"gdf-dkdk\"]):not([class*=\"gdf-dklt\"]) { --gf-ink: #1a1a1a; }\n/* やや淡 ltdk・やや濃 dklt（2026-10-07）。地は中間の濃さ、枠は1つ濃い段。\n   **文字は地の明るさから自動で決める**（相対輝度が 0.179 未満なら白、以上なら黒＝白と黒のうちコントラストが高い方）。\n   中間の段は色相とテーマで白黒どちらが読めるかが入れ替わるため、固定にすると必ずどこかで読めなくなる。 */\n.gdf-ltdkred { --gf-fill: var(--gd-c-ltdkred); --gf-stroke: var(--gd-c-dkred); }\n.gdf-dkltred { --gf-fill: var(--gd-c-dkltred); --gf-stroke: var(--gd-c-dkdkred); }\n.gdf-ltdkorange { --gf-fill: var(--gd-c-ltdkorange); --gf-stroke: var(--gd-c-dkorange); }\n.gdf-dkltorange { --gf-fill: var(--gd-c-dkltorange); --gf-stroke: var(--gd-c-dkdkorange); }\n.gdf-ltdkyellow { --gf-fill: var(--gd-c-ltdkyellow); --gf-stroke: var(--gd-c-dkyellow); }\n.gdf-dkltyellow { --gf-fill: var(--gd-c-dkltyellow); --gf-stroke: var(--gd-c-dkdkyellow); }\n.gdf-ltdkgreen { --gf-fill: var(--gd-c-ltdkgreen); --gf-stroke: var(--gd-c-dkgreen); }\n.gdf-dkltgreen { --gf-fill: var(--gd-c-dkltgreen); --gf-stroke: var(--gd-c-dkdkgreen); }\n.gdf-ltdkteal { --gf-fill: var(--gd-c-ltdkteal); --gf-stroke: var(--gd-c-dkteal); }\n.gdf-dkltteal { --gf-fill: var(--gd-c-dkltteal); --gf-stroke: var(--gd-c-dkdkteal); }\n.gdf-ltdkblue { --gf-fill: var(--gd-c-ltdkblue); --gf-stroke: var(--gd-c-dkblue); }\n.gdf-dkltblue { --gf-fill: var(--gd-c-dkltblue); --gf-stroke: var(--gd-c-dkdkblue); }\n.gdf-ltdkpurple { --gf-fill: var(--gd-c-ltdkpurple); --gf-stroke: var(--gd-c-dkpurple); }\n.gdf-dkltpurple { --gf-fill: var(--gd-c-dkltpurple); --gf-stroke: var(--gd-c-dkdkpurple); }\n.gdf-ltdkpink { --gf-fill: var(--gd-c-ltdkpink); --gf-stroke: var(--gd-c-dkpink); }\n.gdf-dkltpink { --gf-fill: var(--gd-c-dkltpink); --gf-stroke: var(--gd-c-dkdkpink); }\n.gdf-ltdkgray { --gf-fill: var(--gd-c-ltdkgray); --gf-stroke: var(--gd-c-dkgray); }\n.gdf-dkltgray { --gf-fill: var(--gd-c-dkltgray); --gf-stroke: var(--gd-c-dkdkgray); }\n[class*=\"gdf-ltdk\"], [class*=\"gdf-dklt\"] { --gf-ink: rgb(from var(--gf-fill) clamp(0, (0.179 - (0.2126 * pow(r / 255, 2.2) + 0.7152 * pow(g / 255, 2.2) + 0.0722 * pow(b / 255, 2.2))) * 100000, 255) clamp(0, (0.179 - (0.2126 * pow(r / 255, 2.2) + 0.7152 * pow(g / 255, 2.2) + 0.0722 * pow(b / 255, 2.2))) * 100000, 255) clamp(0, (0.179 - (0.2126 * pow(r / 255, 2.2) + 0.7152 * pow(g / 255, 2.2) + 0.0722 * pow(b / 255, 2.2))) * 100000, 255)); }\n/* 三角（新しい書き方 @{ shape: tri }）は path で描かれるので path も塗る。\n   ラベルの下敷きの rect も同じ色で塗られるが、地と同色なので見た目は変わらない。 */\n/* .gnDocRd-print（Ctrl+P の写し）にも効かせる。.gnDocRd だけだと Ctrl+P で箱の色が消え、Mermaid の既定の薄紫で刷られていた（v0.4.0z） */\n:is(.gnDocRd, .gnDocRd-print) .mermaid .node[class*=\"gdf-\"] :is(rect, polygon, circle, path) {\n    fill: var(--gf-fill) !important; stroke: var(--gf-stroke) !important;\n}\n/* 文字。色相だけ（{青}）と極淡は**本文の字の色**（地が本文と同じ変数から来るので、本文の字なら必ず読める）。\n   以前は Mermaid が描いた字の色のまま（v0.4.0z で Mermaid をいつも明るい色で描くようにしたので、暗いテーマで暗い地に濃い字になる） */\n:is(.gnDocRd, .gnDocRd-print) .mermaid .node[class*=\"gdf-\"] .nodeLabel { color: var(--gf-ink, var(--text-color)) !important; }\n:is(.gnDocRd, .gnDocRd-print) .mermaid .node[class*=\"gdf-\"] text { fill: var(--gf-ink, var(--text-color)) !important; }\n/* ---------- フロー図のグリッド配置（HTML で組む） ----------\n   寸法は描画側が % で決める（箱の幅・隙間）。ここは見た目だけ。\n   線と矢じりの色は本文色を少し弱めたもの。 */\n.gnDocRd .flowgrid { margin: 16px 0; --fg-line-color: color-mix(in srgb, var(--text-color) 72%, transparent); }\n.gnDocRd .flowgrid .fg-row { display: flex; align-items: stretch; }\n.gnDocRd .flowgrid .fg-box {\n    position: relative; box-sizing: border-box; flex: 0 0 auto;\n    display: flex; align-items: center; justify-content: center; text-align: center;\n    min-height: 48px; padding: 8px 10px; line-height: 1.4;\n    background: var(--gf-fill); border: 1px solid var(--gf-stroke); border-radius: 10px;\n    color: var(--gf-ink, var(--text-color));\n}\n.gnDocRd .flowgrid .fg-rect { border-radius: 0; }\n.gnDocRd .flowgrid .fg-circle { border-radius: 50%; min-height: 64px; }\n.gnDocRd .flowgrid .fg-circle .fg-label { max-width: 76%; }\n/* 菱形・三角は枠を SVG の多角形で描く（CSS の枠は斜めに引けない）。文字が斜辺に掛からないよう内側へ寄せる。\n   **余白を % で書かない。** padding の % は箱ではなく親（行）の幅が基準になり、箱が行からはみ出す\n   （2026-09-29 に実際にはみ出した）。文字の幅の上限を、箱に対する % で与える。 */\n.gnDocRd .flowgrid :is(.fg-diamond, .fg-tri, .fg-flip) { background: none; border: 0; min-height: 76px; }\n.gnDocRd .flowgrid .fg-diamond { padding: 16px 0; }\n.gnDocRd .flowgrid .fg-diamond .fg-label { max-width: 52%; }\n.gnDocRd .flowgrid .fg-tri { padding: 30px 0 8px; }\n.gnDocRd .flowgrid .fg-flip { padding: 8px 0 30px; }\n.gnDocRd .flowgrid :is(.fg-tri, .fg-flip) .fg-label { max-width: 56%; }\n.gnDocRd .flowgrid .fg-shape { position: absolute; inset: 0; width: 100%; height: 100%; }\n.gnDocRd .flowgrid .fg-shape polygon { fill: var(--gf-fill); stroke: var(--gf-stroke); stroke-width: 1px; vector-effect: non-scaling-stroke; }\n.gnDocRd .flowgrid .fg-label { position: relative; }\n.gnDocRd .flowgrid .fg-label p { margin: 0; }\n/* 箱の中身（見出しの下に「・」付きで並ぶ行）。縦の flow（Mermaid）と同じく中央揃え。 */\n.gnDocRd .flowgrid .fg-items { display: block; margin-top: 2px; }\n.gnDocRd .flowgrid .fg-item { display: block; }\n.gnDocRd .flowgrid .fg-gap { position: relative; flex: 0 0 auto; }\n.gnDocRd .flowgrid .fg-line { position: absolute; left: 3px; right: 3px; top: 50%; border-top: 1.5px solid var(--fg-line-color); }\n.gnDocRd .flowgrid .fg-line.fg-thick { border-top-width: 3.5px; }\n.gnDocRd .flowgrid .fg-line.fg-dashed { border-top-style: dashed; }\n.gnDocRd .flowgrid .fg-head { position: absolute; width: 0; height: 0; border: 5px solid transparent; }\n.gnDocRd .flowgrid .fg-head.fg-thick { border-width: 7px; }\n.gnDocRd .flowgrid .fg-line .fg-head-left  { left: -3px;  top: -1px; transform: translateY(-50%); border-left: 0;  border-right: 9px solid var(--fg-line-color); }\n.gnDocRd .flowgrid .fg-line .fg-head-right { right: -3px; top: -1px; transform: translateY(-50%); border-right: 0; border-left: 9px solid var(--fg-line-color); }\n.gnDocRd .flowgrid .fg-line.fg-thick .fg-head { border-top-width: 7px; border-bottom-width: 7px; }\n.gnDocRd .flowgrid .fg-gap-label {\n    position: absolute; left: 50%; bottom: calc(50% + 5px); transform: translateX(-50%);\n    font-size: 12px; white-space: nowrap; color: var(--text-color);\n}\n.gnDocRd .flowgrid .fg-lane { position: relative; }\n.gnDocRd .flowgrid .fg-lane-svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }\n.gnDocRd .flowgrid .fg-path { fill: none; stroke: var(--fg-line-color); stroke-width: 1.5; stroke-linecap: square; }\n.gnDocRd .flowgrid .fg-path.fg-thick { stroke-width: 3.5; }\n.gnDocRd .flowgrid .fg-path.fg-dashed { stroke-dasharray: 5 4; }\n/* 通路の矢じりは常に真上か真下を向く（縦→横→縦で引くため）。 */\n.gnDocRd .flowgrid .fg-head-down { transform: translate(-50%, -100%); border-bottom: 0; border-top: 9px solid var(--fg-line-color); }\n.gnDocRd .flowgrid .fg-head-up   { transform: translate(-50%, 0);     border-top: 0;    border-bottom: 9px solid var(--fg-line-color); }\n.gnDocRd .flowgrid .fg-head-down.fg-thick { border-top-width: 12px; }\n.gnDocRd .flowgrid .fg-head-up.fg-thick   { border-bottom-width: 12px; }\n.gnDocRd .flowgrid .fg-lane-label {\n    position: absolute; transform: translate(-50%, -50%); font-size: 12px; line-height: 16px; white-space: nowrap;\n    background: var(--bg-color); padding: 0 4px; color: var(--text-color);\n}\n/* まっすぐ縦の線の見出しは、線の右へ（線と矢じりを隠さない） */\n.gnDocRd .flowgrid .fg-lane-label.fg-side { transform: translate(5px, -50%); }\n.gnDocRd .flowgrid .fg-note, .gnDocRd .mermaid > .fg-note { margin-top: 8px; font-size: 12px; color: var(--gd-c-orange); text-align: left; }\n/* ---------- 枠つきのフロー図・cols（v0.3.18b・2026-10-08 仮仕様） ----------\n   枠・箱・説明文は HTML で組み、線は描いた後に測って .gx-lines（SVG）に引く（gxDraw）。\n   左右に 14px の余白を取るのは、端の枠から出る線の通り道（溝）にするため。 */\n.gnDocRd .gx { position: relative; margin: 16px 0; padding: 0 14px; --gx-line: color-mix(in srgb, var(--text-color) 72%, transparent); }\n/* 入れ子の図（cols の中の flow）は、線の色を列から引き継ぐ */\n.gnDocRd .gx .gx { margin: 6px 0; padding: 0; --gx-line: inherit; }\n.gnDocRd .gx-band { display: flex; align-items: stretch; }\n.gnDocRd .gx-band + .gx-band { margin-top: 26px; }\n.gnDocRd .gx-gap { flex: 0 0 28px; }\n.gnDocRd .gx-cols .gx-gap { flex-basis: 18px; }\n.gnDocRd .gx-frame {\n    box-sizing: border-box; min-width: 0; padding: 10px 14px 14px; border-radius: 8px;\n    border: 1.5px solid color-mix(in srgb, var(--gdh-ink) 70%, var(--bg-color)); background: var(--gdh-bg);\n    --gx-line: var(--gdh-ink);\n}\n.gnDocRd .gx-frame.gx-bare { border: 0; background: none; padding: 0; --gx-line: inherit; }\n.gnDocRd .gx-title { font-weight: bold; color: var(--gdh-ink); margin-bottom: 8px; line-height: 1.4; }\n.gnDocRd .gx-row { display: flex; justify-content: space-between; align-items: stretch; }\n.gnDocRd :is(.gx-row, .gx-note) + :is(.gx-row, .gx-note) { margin-top: 10px; }\n.gnDocRd .gx-lane { height: 26px; }\n.gnDocRd .gx-box {\n    box-sizing: border-box; flex: 0 0 auto; display: flex; flex-direction: column; justify-content: center; align-items: center;\n    text-align: center; min-height: 40px; padding: 6px 10px; line-height: 1.4; border-radius: 8px;\n    background: var(--gf-fill); border: 1px solid var(--gf-stroke); color: var(--gf-ink, var(--text-color));\n}\n/* 色を書かない箱は地の色（色の付いた枠の中で浮いて見える。元の図の書き方） */\n/* border は一度に書く（--gf-stroke の無い箱で、上の border が変数ごと無効になり太さ 0 になるため） */\n.gnDocRd .gx-box.gx-plain { background: var(--bg-color); border: 1px solid color-mix(in srgb, var(--gx-line) 55%, var(--bg-color)); }\n.gnDocRd .gx-box.gx-rect { border-radius: 0; }\n.gnDocRd .gx-label :is(p) { margin: 0; }\n.gnDocRd .gx-items { display: block; margin-top: 2px; }\n.gnDocRd .gx-item { display: block; font-size: 0.88em; color: color-mix(in srgb, currentColor 78%, transparent); }\n.gnDocRd .gx-note { font-size: 0.92em; line-height: 1.5; color: color-mix(in srgb, var(--text-color) 82%, transparent); }\n/* 仕切り: 点線と、下に文字。矢印（data-gx-arrow）は線と一緒に SVG で描く */\n.gnDocRd .gx-div { flex: 0 0 104px; position: relative; min-height: 40px; }\n.gnDocRd .gx-div-line { position: absolute; top: -8px; bottom: 20px; left: calc(50% - 1px); border-left: 2px dashed color-mix(in srgb, var(--text-color) 45%, var(--bg-color)); }\n.gnDocRd .gx-div-label {\n    position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); white-space: nowrap;\n    font-size: 12px; font-weight: bold; color: color-mix(in srgb, var(--text-color) 65%, var(--bg-color));\n}\n.gnDocRd .gx-lines { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; }\n.gnDocRd .gx-msg:empty { display: none; }\n.gnDocRd :is(.gx-msg, .gx-note-err) { margin-top: 8px; font-size: 12px; color: var(--gd-c-orange); }\n/* cols の列は装飾枠の見た目のまま（上下の余白だけ外して、段の中で高さをそろえる） */\n.gnDocRd .gx-cols .gx-col { min-width: 0; box-sizing: border-box; }\n.gnDocRd .gx-cols .gx-col.gd-deco { margin: 0; --gx-line: var(--gdh-ink); }\n/* 印刷・単一HTML書き出しでは素の SVG に差し替わる */\n.gnDocRd .gx-svg { margin: 16px 0; }\n.gnDocRd .gx-svg > svg { max-width: 100%; height: auto; }\n/* ---------- 部品（```timeline / ```kpi / ```gantt-lite。2026-10-07） ----------\n   色は .gd-hue-X の変数（--gdh-tint 極淡・--gdh-lt 淡・--gdh-base 標準）と、棒は .gdf-X（--gf-fill/stroke/ink）から取る。\n   色の付かない所は本文色と灰の変数だけで描く＝テーマに追従する。 */\n.gnDocRd .gdpart { margin: 16px 0; --gp-line: color-mix(in srgb, var(--text-color) 30%, transparent); }\n.gnDocRd .gdpart .gp-note { margin-top: 8px; font-size: 12px; color: var(--gd-c-orange); }\n.gnDocRd .gdpart .gp-raw { margin: 0; padding: 8px 10px; font-size: 13px; white-space: pre-wrap; background: var(--gd-bg-gray); }\n/* timeline … 左に時点、縦の軸に点、右に出来事 */\n.gnDocRd .gd-timeline .gt-list { list-style: none; margin: 0; padding: 0; }\n.gnDocRd .gd-timeline .gt-item { display: grid; grid-template-columns: minmax(5em, max-content) 22px 1fr; align-items: start; position: relative; }\n/* 縦の線。絶対配置でも grid-column を書くと、その列が基準になる（列2の中央＝22px の半分）*/\n.gnDocRd .gd-timeline .gt-item::before { content: ''; position: absolute; top: 0; bottom: 0; grid-column: 2; left: 10px; width: 2px; background: var(--gp-line); }\n.gnDocRd .gd-timeline .gt-item:first-child::before { top: 0.8em; }\n.gnDocRd .gd-timeline .gt-item:last-child::before { bottom: calc(100% - 0.8em); }\n.gnDocRd .gd-timeline .gt-time { grid-column: 1; padding: 4px 10px 12px 0; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; color: color-mix(in srgb, var(--text-color) 75%, transparent); }\n.gnDocRd .gd-timeline .gt-dot { grid-column: 2; justify-self: center; position: relative; z-index: 1; width: 10px; height: 10px; margin-top: 0.55em; border-radius: 50%;\n    background: var(--gdh-base, var(--gd-c-gray)); border: 2px solid var(--bg-color); box-sizing: content-box; }\n.gnDocRd .gd-timeline .gt-body { grid-column: 3; padding: 4px 0 12px 6px; }\n.gnDocRd .gd-timeline .gt-tag { display: inline-block; margin-left: 8px; padding: 0 7px; border-radius: 9px; font-size: 12px; line-height: 1.6;\n    background: var(--gdh-tint, var(--gd-bg-gray)); border: 1px solid var(--gdh-lt, var(--gd-c-ltgray)); }\n.gnDocRd .gd-timeline .gt-milestone .gt-dot { border-radius: 1px; transform: rotate(45deg); }\n.gnDocRd .gd-timeline .gt-important .gt-event { font-weight: bold; }\n.gnDocRd .gd-timeline .gt-important .gt-dot { width: 12px; height: 12px; margin-top: 0.45em; }\n/* kpi … 指標カード。地は極淡、左に標準の帯。値は大きく */\n.gnDocRd .gd-kpi .gk-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }\n.gnDocRd .gd-kpi .gk-card { padding: 10px 12px; border-radius: 8px; border: 1px solid var(--gdh-lt, var(--gd-c-ltgray));\n    border-left: 4px solid var(--gdh-base, var(--gd-c-ltgray)); background: var(--gdh-tint, var(--gd-bg-gray)); }\n.gnDocRd .gd-kpi .gk-name { font-size: 13px; color: color-mix(in srgb, var(--text-color) 75%, transparent); }\n.gnDocRd .gd-kpi .gk-value { font-size: 1.7em; font-weight: bold; line-height: 1.3; font-variant-numeric: tabular-nums; }\n.gnDocRd .gd-kpi .gk-trend { font-size: 13px; }\n.gnDocRd .gd-kpi .gk-arrow { font-weight: bold; margin-right: 4px; color: var(--gdh-dk, inherit); }\n.gnDocRd .gd-kpi :is(.gk-name, .gk-value, .gk-trend) p { margin: 0; }\n/* gantt-lite … 左に作業名、右に横棒。目盛りの縦線は各行に引く */\n.gnDocRd .gd-gantt { font-size: 13px; }\n.gnDocRd .gd-gantt .gg-row { display: flex; align-items: stretch; min-height: 26px; }\n.gnDocRd .gd-gantt .gg-name { flex: 0 0 9em; padding: 3px 8px 3px 0; overflow-wrap: anywhere; }\n.gnDocRd .gd-gantt .gg-track { position: relative; flex: 1 1 auto; border-left: 1px solid var(--gp-line); }\n.gnDocRd .gd-gantt .gg-head .gg-track { height: 22px; border-bottom: 1px solid var(--gp-line); }\n.gnDocRd .gd-gantt .gg-tick { position: absolute; bottom: 3px; padding-left: 3px; white-space: nowrap; font-size: 11px; color: color-mix(in srgb, var(--text-color) 70%, transparent); }\n.gnDocRd .gd-gantt .gg-line { position: absolute; top: 0; bottom: 0; border-left: 1px dotted var(--gp-line); }\n.gnDocRd .gd-gantt .gg-group { margin-top: 6px; padding: 2px 0; font-weight: bold; border-bottom: 1px solid var(--gp-line); }\n.gnDocRd .gd-gantt .gg-bar { position: absolute; top: 5px; bottom: 5px; min-width: 2px; box-sizing: border-box; overflow: hidden;\n    border-radius: 4px; background: var(--gf-fill); border: 1px solid var(--gf-stroke); }\n.gnDocRd .gd-gantt .gg-prog { position: absolute; left: 0; top: 0; bottom: 0; background: var(--gf-stroke); opacity: 0.55; }\n.gnDocRd .gd-gantt .gg-pct { position: relative; display: block; padding: 0 4px; font-size: 11px; line-height: 14px; color: var(--gf-ink, var(--text-color)); }\n.gnDocRd .gd-gantt .gg-ms { position: absolute; top: 50%; width: 12px; height: 12px; transform: translate(-50%, -50%) rotate(45deg);\n    background: var(--gf-stroke); border: 1px solid var(--gf-stroke); }\n/* steps … 番号の丸と手順。注記は手順の下に小さく（v0.4.0o） */\n.gnDocRd .gd-steps .gs-list { list-style: none; margin: 0; padding: 0; counter-reset: none; }\n.gnDocRd .gd-steps .gs-item { display: flex; gap: 10px; align-items: flex-start; padding: 6px 0; border-bottom: 1px dotted var(--gp-line); }\n.gnDocRd .gd-steps .gs-item:last-child { border-bottom: none; }\n.gnDocRd .gd-steps .gs-num { flex: 0 0 auto; width: 1.7em; height: 1.7em; line-height: 1.7em; border-radius: 50%; text-align: center; font-weight: bold; font-size: 0.9em;\n    border: 1px solid var(--gp-line); font-variant-numeric: tabular-nums; }\n.gnDocRd .gd-steps .gs-body { flex: 1 1 auto; min-width: 0; padding-top: 0.15em; }\n.gnDocRd .gd-steps .gs-note { margin-top: 3px; padding: 1px 8px; font-size: 0.88em; border-left: 3px solid var(--gdh-base, var(--gp-line));\n    background: var(--gdh-tint, transparent); color: color-mix(in srgb, var(--text-color) 85%, transparent); }\n.gnDocRd .gd-steps :is(.gs-text, .gs-note) p { margin: 0; }\n/* faq … 問いを押すと答えが開く（既定は閉じる） */\n.gnDocRd .gd-faq .gq-item { border: 1px solid var(--gp-line); border-radius: 6px; margin: 6px 0; }\n.gnDocRd .gd-faq .gq-item > summary { cursor: pointer; padding: 7px 10px; font-weight: bold; list-style-position: inside; }\n.gnDocRd .gd-faq .gq-item[open] > summary { border-bottom: 1px dotted var(--gp-line); }\n.gnDocRd .gd-faq .gq-answer { display: flex; gap: 8px; padding: 8px 10px; }\n.gnDocRd .gd-faq .gq-body { flex: 1 1 auto; min-width: 0; }\n.gnDocRd .gd-faq .gq-body > :first-child { margin-top: 0; }\n.gnDocRd .gd-faq .gq-body > :last-child { margin-bottom: 0; }\n.gnDocRd .gd-faq .gq-mark { display: inline-block; min-width: 1.4em; margin-right: 4px; font-weight: bold; color: var(--gd-c-blue); }\n.gnDocRd .gd-faq .gq-mark-a { color: var(--gd-c-green); }\n/* progress … 項目・横棒・値。色を書かない棒は灰 */\n.gnDocRd .gd-progress { font-size: 13px; }\n.gnDocRd .gd-progress .gpr-row { display: flex; align-items: center; gap: 8px; min-height: 24px; }\n.gnDocRd .gd-progress .gpr-name { flex: 0 0 9em; overflow-wrap: anywhere; }\n.gnDocRd .gd-progress .gpr-track { position: relative; flex: 1 1 auto; height: 12px; border-radius: 6px; border: 1px solid var(--gp-line); overflow: hidden; }\n.gnDocRd .gd-progress .gpr-bar { position: absolute; left: 0; top: 0; bottom: 0; background: var(--gf-stroke); }\n.gnDocRd .gd-progress .gpr-val { flex: 0 0 auto; min-width: 3.5em; text-align: right; font-variant-numeric: tabular-nums; }\n.gnDocRd .gd-progress .gpr-text { color: color-mix(in srgb, var(--text-color) 70%, transparent); }\n.gnDocRd .gd-progress .gpr-group { margin-top: 6px; padding: 2px 0; font-weight: bold; border-bottom: 1px solid var(--gp-line); }\n.gnDocRd .gd-progress :is(.gpr-name, .gpr-group) p { margin: 0; }\n/* matrix … 2×2。狭い所では1列に崩れる。地は .gdf-X（極淡が既定） */\n.gnDocRd .gd-matrix .gm-axis { font-size: 12px; margin-bottom: 4px; color: color-mix(in srgb, var(--text-color) 70%, transparent); }\n.gnDocRd .gd-matrix .gm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }\n.gnDocRd .gd-matrix .gm-cell { padding: 8px 12px; border-radius: 8px; background: var(--gf-fill); border: 1px solid var(--gf-stroke); color: var(--gf-ink, inherit); min-height: 4em; }\n.gnDocRd .gd-matrix .gm-title { font-weight: bold; margin-bottom: 4px; }\n.gnDocRd .gd-matrix .gm-items { margin: 0; padding-left: 1.2em; }\n.gnDocRd .gd-matrix .gm-items p { margin: 0; }\n@media print { .gnDocRd .gd-matrix .gm-grid { grid-template-columns: 1fr 1fr; } .gnDocRd :is(.gd-matrix, .gd-steps, .gd-progress, .gd-faq .gq-item) { break-inside: avoid; } }\n/* 罫線の3通り。既定（指定なし）は行間だけ薄い実線。 */\n.gnDocRd table.gd-border-dashed-row td { border-bottom: 1px dashed var(--gdh-line); }\n.gnDocRd table.gd-border-dashed-row { border: 1px solid var(--gdh-line); }\n.gnDocRd table.gd-border-grid th, .gnDocRd table.gd-border-grid td { border: 1px solid var(--gdh-line); }\n.gnDocRd table.gd-border-clean th, .gnDocRd table.gd-border-clean td { border-left: none; border-right: none; }\n/* 枠付き（border=frame。v0.4.1v）: 外枠は角丸 6px、中は縦横の細線。角を丸めるため collapse をやめ、線はセルの右と下に引く。\n   外枠の色は line=（--gdt-frame）→ theme の標準の段 → アクセント色。中の線は theme の線の色、無ければ文字色を薄めた物 */\n/* 色を書かない表の外枠の色（--gdt-accent）は、使う側が差し替えられる（gnDoc のアプリはアクセント色。この区切りの外で） */\n.gnDocRd table.gd-border-frame {\n    --gdt-accent: #3b82f6;\n    --gdt-frame: var(--gdh-base, var(--gdt-accent));\n    border-collapse: separate; border-spacing: 0; border-radius: 6px; overflow: hidden;\n    border: 1px solid var(--gdt-frame);\n    --gdt-in: var(--gdh-line, color-mix(in srgb, currentColor 18%, transparent));\n}\n.gnDocRd table.gd-border-frame th, .gnDocRd table.gd-border-frame td { border: 0; border-right: 1px solid var(--gdt-in); border-bottom: 1px solid var(--gdt-in); }\n.gnDocRd table.gd-border-frame tr > :last-child { border-right: 0; }\n.gnDocRd table.gd-border-frame tbody tr:last-child > * { border-bottom: 0; }\n.gnDocRd table.gd-border-frame:not(:has(tbody tr)) thead tr:last-child > * { border-bottom: 0; }\n/* 見出しの列（head=col / both。v0.4.1v）。col は見出し行を出さない（「項目・内容」の行は書くが見せない） */\n.gnDocRd table.gd-head-col thead { display: none; }\n.gnDocRd table:is(.gd-head-col, .gd-head-both) tbody td:first-child {\n    font-weight: bold; background: var(--gdh-head-bg, color-mix(in srgb, currentColor 7%, transparent)); color: var(--gdh-head-ink, inherit);\n}\n/* 印刷でも配色を残す。淡い塗りの上の文字色を明示しないと、\n   紙でもダークテーマでも読めなくなる（v0.3.7 で実際に踏んだ）。 */\n@media print {\n    .gnDocRd table.gd-table th { background: var(--gdh-head-bg) !important; color: var(--gdh-head-ink) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n    .gnDocRd table.gd-table td { background: var(--gdh-bg) !important; color: var(--gdh-ink) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n    .gnDocRd table:is(.gd-head-col, .gd-head-both) tbody td:first-child { background: var(--gdh-head-bg, color-mix(in srgb, currentColor 7%, transparent)) !important; color: var(--gdh-head-ink, inherit) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n    .gnDocRd table.gd-border-frame { -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n    .gnDocRd .gd-deco { background: var(--gdh-bg) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n    .gnDocRd .gd-deco-title { background: var(--gdh-head-bg) !important; color: var(--gdh-head-ink) !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n    /* 枠が紙の境目で割れると、帯だけが前のページに残る。 */\n    .gnDocRd .gd-deco { break-inside: avoid; page-break-inside: avoid; }\n    /* **地の色は、印刷の窓の「背景のグラフィック」に頼らず刷る**（v0.3.18t）。\n       exe（WebView2）の印刷の窓はこれが既定で切れていて、色を残す指定の無いもの（フロー図のグリッドの箱・\n       ガントの棒・コードの地など）だけが白くなった（表と装飾枠は上の指定で色が残るので、紙面がちぐはぐになる）。\n       この指定は子へ受け継がれるので、本文の根元に1つ置けば全部に効く。 */\n    .gnDocRd, .gnDocRd-print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n    /* **図は1頁に収める**（v0.3.18t・利用者「フローについて 1ページに収まるサイズに調整した上で、印刷する」）。\n       縦に長い図（```flow{dir=縦} など）は、幅の上限（以前の 🖨 では頁の半分。v0.4.0w から紙の幅いっぱい・.gd-print-fit）だけでは頁の高さを越えて2頁に割れた。\n       高さの上限を頁の高さ（印刷では vh が用紙の刷れる範囲の高さになる）の85%に置き（残りは前の見出しと下の「図 N:」の分）、図は縦横の比を保って縮む。\n       それでも収まらない残りの頁に掛からないよう、途中で割らずに次の頁の頭から刷る。 */\n    :is(.gnDocRd, .gnDocRd-print) :is(.mermaid, .flowgrid, .wavedrom, .plantuml, .graphviz, .d2, .dbml) { break-inside: avoid; page-break-inside: avoid; }\n    :is(.gnDocRd, .gnDocRd-print) :is(.mermaid, .wavedrom, .graphviz) svg,\n    :is(.gnDocRd, .gnDocRd-print) :is(.plantuml, .graphviz, .d2, .dbml) img { max-height: 85vh !important; }\n    /* 図が次の頁へ送られると、その前の見出しだけが頁の下に取り残される。見出しは次の物と同じ頁へ付ける。 */\n    :is(.gnDocRd, .gnDocRd-print) :is(h1, h2, h3, h4, h5, h6) { break-after: avoid; page-break-after: avoid; }\n}\n/* div. で修飾するのは、markmap-view が生成する<svg>自体に（内部CSS変数スコープ用に）\n   \"markmap\"クラスを付与しており、素の.markmapセレクタだとdivコンテナだけでなく\n   そのsvgにも二重にmargin/padding/border等が適用され、右下に大きくはみ出す不具合の\n   原因になっていたため（詳細はdiv.markmap規則側のコメント参照）。他タイプは実害未確認\n   だが同種の衝突を予防するため一律でdiv.修飾する。 */\ndiv.mermaid, div.wavedrom, div.plantuml, div.chartjs, div.dbml, div.d2, div.graphviz, div.markmap, div.cytoscape {\n    margin: 24px 0; background: #fff; padding: 12px; border: 1px solid var(--border-color); border-radius: 6px;\n}\ndiv.cytoscape { height: 420px; position: relative; }\n.chart-row {\n    display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin: 24px 0;\n}\n.chart-row > .chartjs { margin: 0; }\npre.mermaid-error { color: #c00; background: #fff0f0; border: 1px solid #c00; border-radius: 4px; padding: 8px 12px; font-size: 12px; white-space: pre-wrap; word-break: break-all; margin: 0; }\n/* ツールバー（右上）とエラー本文が重ならないよう、エラー表示だけ右側を空ける。 */\nfigure { margin: 1.5em 0; }\nfigcaption { text-align: center; font-size: 0.9em; color: #666; margin-top: 6px; }\nbody.theme-dark figcaption { color: #aaa; }\n/* ---- 印刷の透かし（v0.4.0h） ----\n   利用者「印刷時にウォーターマーク（透かし風）追加出来る機能」。**画面には出さず、刷るときだけ出す。**\n   position:fixed の要素は印刷で全ページに繰り返し刷られる（Chromium。下の @media print の注記と同じ性質）ので、それで各ページに置く。\n   前面（gd-wm-front）は本文の上に淡く重ねる（表や枠の地に隠れない）。背面（gd-wm-back）は本文の下に敷く:\n   透かしを z-index:0、すぐ後ろの本文（.gnDocRd・.gnDocRd-print）を z-index:1 にする（地の色を持つ表や枠の所では隠れる）。\n   🖨 の写し・Ctrl+P・単一HTML の3つともこの規則（collectExportStyles で写る）と、本文の直前に置いた <div class=\"gd-watermark\"> で刷る。\n   中身は gnDocRd.print.watermark が作る（v0.4.1 で gnDocRd の CSS へ移した） */\n.gd-watermark { display: none; }\n@media print {\n    .gd-watermark { display: block !important; position: fixed; inset: 0; pointer-events: none;\n        -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n    .gd-watermark > svg { display: block; width: 100%; height: 100%; }\n    .gd-watermark.gd-wm-front { z-index: 2147483000; }\n    .gd-watermark.gd-wm-back { z-index: 0; }\n    .gd-watermark.gd-wm-back ~ .gnDocRd, .gd-watermark.gd-wm-back ~ .gnDocRd-print { position: relative; z-index: 1; background: transparent !important; }\n}\n@media print {\n    :is(.gnDocRd, .gnDocRd-print) { --gd-print-w: 100%; --gd-max-w: 100%; --gd-ar: 1000; --gd-frame-w: auto; }\n    /* **図は紙の幅いっぱい。縦に長い図は、刷れる高さの 85% に収まるよう縮める**（v0.4.0w。gnDocRd.print の「図の大きさ」の注記）。\n       --gd-ar・--gd-print-w・--gd-max-w は gnDocRd.print.snapshot が写しの図に書く（既定値は本文の入れ物に持たせる。v0.4.1 で gnDocRd の CSS へ戻した）。\n       幅 = min(上限, 85vh × 横÷縦, 元の幅)。上限は {print=60%} の指定、無ければ 100%。--gd-ar・--gd-max-w は写しを作るときに入れる\n       （小さい図は元の大きさより広げない。v0.4.0y。{print=…} を書いた図には --gd-max-w を入れない） */\n    :is(.gnDocRd, .gnDocRd-print) .gd-print-fit {\n        width: min(var(--gd-print-w, 100%), calc(85vh * var(--gd-ar, 1000)), var(--gd-max-w, 100%)) !important;\n        max-width: 100% !important; height: auto !important; display: block !important; margin-left: auto !important; margin-right: auto !important;\n    }\n    /* **{print=60%} は図の表示範囲（枠・地・余白ごと）の幅**（v0.4.1a。利用者「該当チャートの表示範囲全体のサイズを調整する機能のはず」）。\n       以前は中の図（svg）だけを 60% にしていたので、枠は 100% のまま残り、紙では効いていないように見えた。\n       枠の幅は --gd-frame-w（snapshot が書く）。中の図は枠いっぱい（--gd-print-w は 100% のまま）で、縦に長い図は今までどおり高さで縮む。\n       HTML で組む図（グリッドの flow）も同じ決まりで、幅の指定だけが効く */\n    :is(.gnDocRd, .gnDocRd-print) [data-gd-print] { width: var(--gd-frame-w, auto) !important; max-width: 100% !important; box-sizing: border-box !important; margin-left: auto !important; margin-right: auto !important; }\n}\n\n/* ---------- 拡張記法: 文字色 {red:…} と枠囲み [[…]] ---------- */\n/* 色はテーマ変数にしておき、ダーク系では明度を上げて可読性を確保する。\n   任意色（#rrggbb）だけは style 属性で出すため、書式を厳密に検証してから使う。\n   DOMPurify の既定設定は style を素通しする（url(javascript:) すら残ることを実測）ので、\n   利用者が書いた文字列をそのまま style へ流さないこと。 */\n/* 濃(dk)/淡(lt)は「そのテーマにおける濃い/淡い」であって、CSSの darkred(#8B0000) 等の\n   固定色ではない。固定値を入れると系統をまたいだ瞬間に破綻する（#8B0000 は Tokyo Night の\n   背景に対して約1.7:1 で読めない）。値は全テーマ背景に対するコントラスト比を計算で詰めてある。\n     ライト系: 濃 6.7〜9.0:1（AA以上）／淡 3.0:1（AA Large の下限を死守）\n     ダーク系: 濃 4.0:1（既存のライト系標準色と同水準）／淡 7.0〜10.0:1\n   セピア系は :root を継承する。セピア専用に解き直しても最も濃い dark-sepia 背景で\n   2.13:1 対 2.09:1 とほぼ変わらず、変数を1系統増やすだけの価値が無いため。\n   **淡色はセピア系（特に dark-sepia）で約2.1:1まで落ちる。装飾用であり、\n   それだけで意味を担う情報には使わないこと。** */\n/* --gd-bg-* は「塗り」専用の超淡色。表の地・装飾枠の地・フローの箱の地に使う。\n   **2026-09-29 から `{ltltBlue:…}`（極淡）として手でも書ける**（利用者決定。\n   2026-09-18 の「書ける名前にしない」を差し替えた）。ただし**文字色にはしない**。\n   超淡色の文字は白地で 1.1:1 前後になり読めないため、極淡は**地（ハイライト）**として描く。\n   極濃（--gd-c-dkdk*）は計算で詰めた値:\n     ライト系: 全ライト系の地に対して 11:1 以上（白抜きにすると 12.9:1 以上）\n     ダーク系: 全ダーク系の地に対して 3.0:1 以上（AA Large の下限。ライト系の淡と同じ扱い）、\n               かつ白抜きで 4.6:1 以上。**地との比と白抜きの比が両立する明度（L≈0.175）に置いた。**\n               これより暗くすると地に沈み、明るくすると白抜きが読めなくなる */\n:root {\n    --gd-c-red: #d93025;  --gd-c-blue: #1a73e8; --gd-c-green: #188038; --gd-c-orange: #c25e00;\n    --gd-c-purple: #8430ce; --gd-c-gray: #5f6368; --gd-c-teal: #00796b; --gd-c-pink: #c2185b;\n    --gd-c-yellow: #8a6d00;\n    --gd-c-dkred: #942119; --gd-raw-ltred: #e26057; --gd-c-dkblue: #124e9e; --gd-raw-ltblue: #3f89ec;\n    --gd-c-dkgreen: #105726; --gd-raw-ltgreen: #469960; --gd-c-dkorange: #844000; --gd-raw-ltorange: #ca7321;\n    --gd-c-dkpurple: #5a218c; --gd-raw-ltpurple: #aa70dd; --gd-c-dkgray: #414347; --gd-raw-ltgray: #878a8e;\n    --gd-c-dkteal: #005249; --gd-raw-ltteal: #3b988d; --gd-c-dkpink: #84103e; --gd-raw-ltpink: #d6628f;\n    --gd-c-dkyellow: #5c4800; --gd-raw-ltyellow: #b79200;\n    --gd-c-dkdkred: #601510; --gd-c-dkdkblue: #0b3062; --gd-c-dkdkgreen: #0b3919; --gd-c-dkdkorange: #4f2600;\n    --gd-c-dkdkpurple: #45196c; --gd-c-dkdkgray: #2f3134; --gd-c-dkdkteal: #003832; --gd-c-dkdkpink: #620c2e;\n    --gd-c-dkdkyellow: #3d3000;\n    --gd-raw-bg-red: #fff5f5; --gd-raw-bg-blue: #ebf8ff; --gd-raw-bg-green: #f0fff4; --gd-raw-bg-orange: #fffaf0;\n    --gd-raw-bg-purple: #faf5ff; --gd-raw-bg-gray: #f7fafc; --gd-raw-bg-teal: #effcf9; --gd-raw-bg-pink: #fff5f8;\n    --gd-raw-bg-yellow: #fffbeb;\n}\nbody.theme-dark {\n    --gd-c-red: #ff6b5e;  --gd-c-blue: #7cb0ff; --gd-c-green: #6ddf8f; --gd-c-orange: #ffab5e;\n    --gd-c-purple: #d0a2ff; --gd-c-gray: #a8adb3; --gd-c-teal: #5fd4c4; --gd-c-pink: #ff8fb1;\n    --gd-c-yellow: #d4ad3f;\n    --gd-c-dkred: #e05e53; --gd-raw-ltred: #ff9a92; --gd-c-dkblue: #6189c7; --gd-raw-ltblue: #a6c9ff;\n    --gd-c-dkgreen: #4a9861; --gd-raw-ltgreen: #9ce9b3; --gd-c-dkorange: #b87b44; --gd-raw-ltorange: #ffc692;\n    --gd-c-dkpurple: #9c7abf; --gd-raw-ltpurple: #dfc0ff; --gd-c-dkgray: #85898d; --gd-raw-ltgray: #c4c7cb;\n    --gd-c-dkteal: #43978b; --gd-raw-ltteal: #92e2d7; --gd-c-dkpink: #c46e88; --gd-raw-ltpink: #ffb3ca;\n    --gd-c-dkyellow: #a98c30; --gd-raw-ltyellow: #e5cf8d;\n    --gd-c-dkdkred: #c05047; --gd-c-dkdkblue: #5375aa; --gd-c-dkdkgreen: #3f8152; --gd-c-dkdkorange: #9c693a;\n    --gd-c-dkdkpurple: #8568a2; --gd-c-dkdkgray: #717478; --gd-c-dkdkteal: #397f75; --gd-c-dkdkpink: #a75e74;\n    --gd-c-dkdkyellow: #897227;\n    /* ダーク系の塗りは「地よりわずかに明るい色相付き」。明るくしすぎると\n       ページの地から浮いて、ライト系の紙を貼ったように見える。 */\n    --gd-raw-bg-red: #2c1d1d; --gd-raw-bg-blue: #1b2430; --gd-raw-bg-green: #1b2a20; --gd-raw-bg-orange: #2c231a;\n    --gd-raw-bg-purple: #26203a; --gd-raw-bg-gray: #262626; --gd-raw-bg-teal: #172a28; --gd-raw-bg-pink: #2d1e26;\n    --gd-raw-bg-yellow: #2b2718;\n}\n/* 塗りだけはセピア系にも専用値を置く。文字色（--gd-c-*）は :root を継ぐままでよいが、\n   塗りは面積が大きく、白に近い値を敷くと地（#f4ecd8 前後）の上で「紙を貼った」ように浮く。 */\nbody.theme-sepia {\n    --gd-raw-bg-red: #f7e3dc; --gd-raw-bg-blue: #e4eaef; --gd-raw-bg-green: #e8eedb; --gd-raw-bg-orange: #f7e8d2;\n    --gd-raw-bg-purple: #ece4ee; --gd-raw-bg-gray: #ebe5d8; --gd-raw-bg-teal: #e3eee9; --gd-raw-bg-pink: #f6e2e6;\n    --gd-raw-bg-yellow: #f6eece;\n}\n/* ---------- 淡い3段（極淡 ltlt・淡 lt・やや淡 ltdk）は計算で作る（v0.3.17j） ----------\n   テーマごとの固定値は --gd-raw-* に置き、ここで設定パネルのスライダ（淡い色の濃さ）の比率を掛ける。\n   100%（--gd-tone-up / --gd-tone-down が両方 0%）のときは --gd-raw-* そのもの＝これまでと同じ色。\n   下げると3段そろって地の色（--bg-color）へ寄り、上げると3段そろって1つ濃い段へ寄る\n   （極淡→淡、淡→やや淡、やや淡→標準）。3段の並び順は崩れない。\n   **body に置くこと。** :root に置くと、ダーク系（body.theme-dark が --gd-raw-* を上書きする）でも\n   :root で解決したライト系の値が受け継がれてしまう。\n   やや淡（ltdk）は淡と標準の中間、やや濃（dklt）は標準と濃の中間。dklt はスライダの対象外。 */\n:root { --gd-tone-up: 0%; --gd-tone-down: 0%; }\nbody {\n    --gd-raw-ltdkred: color-mix(in srgb, var(--gd-c-red) 50%, var(--gd-raw-ltred));\n    --gd-bg-red: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltred) var(--gd-tone-up), var(--gd-raw-bg-red)));\n    --gd-c-ltred: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltdkred) var(--gd-tone-up), var(--gd-raw-ltred)));\n    --gd-c-ltdkred: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-c-red) var(--gd-tone-up), var(--gd-raw-ltdkred)));\n    --gd-c-dkltred: color-mix(in srgb, var(--gd-c-red) 50%, var(--gd-c-dkred));\n    --gd-raw-ltdkblue: color-mix(in srgb, var(--gd-c-blue) 50%, var(--gd-raw-ltblue));\n    --gd-bg-blue: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltblue) var(--gd-tone-up), var(--gd-raw-bg-blue)));\n    --gd-c-ltblue: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltdkblue) var(--gd-tone-up), var(--gd-raw-ltblue)));\n    --gd-c-ltdkblue: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-c-blue) var(--gd-tone-up), var(--gd-raw-ltdkblue)));\n    --gd-c-dkltblue: color-mix(in srgb, var(--gd-c-blue) 50%, var(--gd-c-dkblue));\n    --gd-raw-ltdkgreen: color-mix(in srgb, var(--gd-c-green) 50%, var(--gd-raw-ltgreen));\n    --gd-bg-green: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltgreen) var(--gd-tone-up), var(--gd-raw-bg-green)));\n    --gd-c-ltgreen: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltdkgreen) var(--gd-tone-up), var(--gd-raw-ltgreen)));\n    --gd-c-ltdkgreen: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-c-green) var(--gd-tone-up), var(--gd-raw-ltdkgreen)));\n    --gd-c-dkltgreen: color-mix(in srgb, var(--gd-c-green) 50%, var(--gd-c-dkgreen));\n    --gd-raw-ltdkorange: color-mix(in srgb, var(--gd-c-orange) 50%, var(--gd-raw-ltorange));\n    --gd-bg-orange: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltorange) var(--gd-tone-up), var(--gd-raw-bg-orange)));\n    --gd-c-ltorange: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltdkorange) var(--gd-tone-up), var(--gd-raw-ltorange)));\n    --gd-c-ltdkorange: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-c-orange) var(--gd-tone-up), var(--gd-raw-ltdkorange)));\n    --gd-c-dkltorange: color-mix(in srgb, var(--gd-c-orange) 50%, var(--gd-c-dkorange));\n    --gd-raw-ltdkpurple: color-mix(in srgb, var(--gd-c-purple) 50%, var(--gd-raw-ltpurple));\n    --gd-bg-purple: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltpurple) var(--gd-tone-up), var(--gd-raw-bg-purple)));\n    --gd-c-ltpurple: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltdkpurple) var(--gd-tone-up), var(--gd-raw-ltpurple)));\n    --gd-c-ltdkpurple: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-c-purple) var(--gd-tone-up), var(--gd-raw-ltdkpurple)));\n    --gd-c-dkltpurple: color-mix(in srgb, var(--gd-c-purple) 50%, var(--gd-c-dkpurple));\n    --gd-raw-ltdkgray: color-mix(in srgb, var(--gd-c-gray) 50%, var(--gd-raw-ltgray));\n    --gd-bg-gray: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltgray) var(--gd-tone-up), var(--gd-raw-bg-gray)));\n    --gd-c-ltgray: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltdkgray) var(--gd-tone-up), var(--gd-raw-ltgray)));\n    --gd-c-ltdkgray: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-c-gray) var(--gd-tone-up), var(--gd-raw-ltdkgray)));\n    --gd-c-dkltgray: color-mix(in srgb, var(--gd-c-gray) 50%, var(--gd-c-dkgray));\n    --gd-raw-ltdkteal: color-mix(in srgb, var(--gd-c-teal) 50%, var(--gd-raw-ltteal));\n    --gd-bg-teal: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltteal) var(--gd-tone-up), var(--gd-raw-bg-teal)));\n    --gd-c-ltteal: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltdkteal) var(--gd-tone-up), var(--gd-raw-ltteal)));\n    --gd-c-ltdkteal: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-c-teal) var(--gd-tone-up), var(--gd-raw-ltdkteal)));\n    --gd-c-dkltteal: color-mix(in srgb, var(--gd-c-teal) 50%, var(--gd-c-dkteal));\n    --gd-raw-ltdkpink: color-mix(in srgb, var(--gd-c-pink) 50%, var(--gd-raw-ltpink));\n    --gd-bg-pink: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltpink) var(--gd-tone-up), var(--gd-raw-bg-pink)));\n    --gd-c-ltpink: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltdkpink) var(--gd-tone-up), var(--gd-raw-ltpink)));\n    --gd-c-ltdkpink: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-c-pink) var(--gd-tone-up), var(--gd-raw-ltdkpink)));\n    --gd-c-dkltpink: color-mix(in srgb, var(--gd-c-pink) 50%, var(--gd-c-dkpink));\n    --gd-raw-ltdkyellow: color-mix(in srgb, var(--gd-c-yellow) 50%, var(--gd-raw-ltyellow));\n    --gd-bg-yellow: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltyellow) var(--gd-tone-up), var(--gd-raw-bg-yellow)));\n    --gd-c-ltyellow: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-raw-ltdkyellow) var(--gd-tone-up), var(--gd-raw-ltyellow)));\n    --gd-c-ltdkyellow: color-mix(in srgb, var(--bg-color) var(--gd-tone-down), color-mix(in srgb, var(--gd-c-yellow) var(--gd-tone-up), var(--gd-raw-ltdkyellow)));\n    --gd-c-dkltyellow: color-mix(in srgb, var(--gd-c-yellow) 50%, var(--gd-c-dkyellow));\n}\n/* やや淡（ltdk）・やや濃（dklt）の文字色。 */\n.gd-c-ltdkred { color: var(--gd-c-ltdkred); } .gd-c-dkltred { color: var(--gd-c-dkltred); }\n.gd-c-ltdkblue { color: var(--gd-c-ltdkblue); } .gd-c-dkltblue { color: var(--gd-c-dkltblue); }\n.gd-c-ltdkgreen { color: var(--gd-c-ltdkgreen); } .gd-c-dkltgreen { color: var(--gd-c-dkltgreen); }\n.gd-c-ltdkorange { color: var(--gd-c-ltdkorange); } .gd-c-dkltorange { color: var(--gd-c-dkltorange); }\n.gd-c-ltdkpurple { color: var(--gd-c-ltdkpurple); } .gd-c-dkltpurple { color: var(--gd-c-dkltpurple); }\n.gd-c-ltdkgray { color: var(--gd-c-ltdkgray); } .gd-c-dkltgray { color: var(--gd-c-dkltgray); }\n.gd-c-ltdkteal { color: var(--gd-c-ltdkteal); } .gd-c-dkltteal { color: var(--gd-c-dkltteal); }\n.gd-c-ltdkpink { color: var(--gd-c-ltdkpink); } .gd-c-dkltpink { color: var(--gd-c-dkltpink); }\n.gd-c-ltdkyellow { color: var(--gd-c-ltdkyellow); } .gd-c-dkltyellow { color: var(--gd-c-dkltyellow); }\n.gd-c-red { color: var(--gd-c-red); }\n.gd-c-blue { color: var(--gd-c-blue); }\n.gd-c-green { color: var(--gd-c-green); }\n.gd-c-orange { color: var(--gd-c-orange); }\n.gd-c-purple { color: var(--gd-c-purple); }\n.gd-c-gray { color: var(--gd-c-gray); }\n.gd-c-teal { color: var(--gd-c-teal); }\n.gd-c-pink { color: var(--gd-c-pink); }\n.gd-c-yellow { color: var(--gd-c-yellow); }\n.gd-c-dkred { color: var(--gd-c-dkred); }     .gd-c-ltred { color: var(--gd-c-ltred); }\n.gd-c-dkblue { color: var(--gd-c-dkblue); }   .gd-c-ltblue { color: var(--gd-c-ltblue); }\n.gd-c-dkgreen { color: var(--gd-c-dkgreen); } .gd-c-ltgreen { color: var(--gd-c-ltgreen); }\n.gd-c-dkorange { color: var(--gd-c-dkorange); } .gd-c-ltorange { color: var(--gd-c-ltorange); }\n.gd-c-dkpurple { color: var(--gd-c-dkpurple); } .gd-c-ltpurple { color: var(--gd-c-ltpurple); }\n.gd-c-dkgray { color: var(--gd-c-dkgray); }   .gd-c-ltgray { color: var(--gd-c-ltgray); }\n.gd-c-dkteal { color: var(--gd-c-dkteal); }   .gd-c-ltteal { color: var(--gd-c-ltteal); }\n.gd-c-dkpink { color: var(--gd-c-dkpink); }   .gd-c-ltpink { color: var(--gd-c-ltpink); }\n.gd-c-dkyellow { color: var(--gd-c-dkyellow); } .gd-c-ltyellow { color: var(--gd-c-ltyellow); }\n/* 極濃（dkdk）は文字色。 */\n.gd-c-dkdkred { color: var(--gd-c-dkdkred); }\n.gd-c-dkdkblue { color: var(--gd-c-dkdkblue); }\n.gd-c-dkdkgreen { color: var(--gd-c-dkdkgreen); }\n.gd-c-dkdkorange { color: var(--gd-c-dkdkorange); }\n.gd-c-dkdkpurple { color: var(--gd-c-dkdkpurple); }\n.gd-c-dkdkgray { color: var(--gd-c-dkdkgray); }\n.gd-c-dkdkteal { color: var(--gd-c-dkdkteal); }\n.gd-c-dkdkpink { color: var(--gd-c-dkdkpink); }\n.gd-c-dkdkyellow { color: var(--gd-c-dkdkyellow); }\n/* 極淡（ltlt）は**文字色ではなく地**（ハイライト）。文字は本文色のまま。\n   枠囲み [[ltltBlue:…]] では、地に加えて罫線を淡色にする（currentColor だと本文色の枠になる）。\n   padding は .gd-box より前に置くので、枠囲みでは .gd-box の余白が勝つ。 */\n.gd-c-ltltred, .gd-c-ltltblue, .gd-c-ltltgreen, .gd-c-ltltorange, .gd-c-ltltpurple, .gd-c-ltltgray, .gd-c-ltltteal, .gd-c-ltltpink, .gd-c-ltltyellow {\n    border-radius: 3px; padding: 0 0.15em;\n    box-decoration-break: clone; -webkit-box-decoration-break: clone;\n}\n.gd-c-ltltred { background-color: var(--gd-bg-red); }  .gd-box.gd-c-ltltred { border-color: var(--gd-c-ltred); }\n.gd-c-ltltblue { background-color: var(--gd-bg-blue); }  .gd-box.gd-c-ltltblue { border-color: var(--gd-c-ltblue); }\n.gd-c-ltltgreen { background-color: var(--gd-bg-green); }  .gd-box.gd-c-ltltgreen { border-color: var(--gd-c-ltgreen); }\n.gd-c-ltltorange { background-color: var(--gd-bg-orange); }  .gd-box.gd-c-ltltorange { border-color: var(--gd-c-ltorange); }\n.gd-c-ltltpurple { background-color: var(--gd-bg-purple); }  .gd-box.gd-c-ltltpurple { border-color: var(--gd-c-ltpurple); }\n.gd-c-ltltgray { background-color: var(--gd-bg-gray); }  .gd-box.gd-c-ltltgray { border-color: var(--gd-c-ltgray); }\n.gd-c-ltltteal { background-color: var(--gd-bg-teal); }  .gd-box.gd-c-ltltteal { border-color: var(--gd-c-ltteal); }\n.gd-c-ltltpink { background-color: var(--gd-bg-pink); }  .gd-box.gd-c-ltltpink { border-color: var(--gd-c-ltpink); }\n.gd-c-ltltyellow { background-color: var(--gd-bg-yellow); }  .gd-box.gd-c-ltltyellow { border-color: var(--gd-c-ltyellow); }\n/* 枠線は currentColor。色指定が無ければ本文色、あれば gd-c-* が設定した色に自動追従する */\n.gd-box {\n    border: 1px solid currentColor; border-radius: 4px;\n    padding: 0 0.35em; margin: 0 0.1em; display: inline;\n    box-decoration-break: clone; -webkit-box-decoration-break: clone;\n}\n@media print { .gd-box { border-color: #666 !important; } }\nmark { background-color: #ff0; color: #000; padding: 0 2px; }\nu { text-decoration: underline; }\nsub, sup { font-size: 0.8em; }\n/* 取消線（~~文字~~ と HTML の <s>）。ブラウザ既定の太さはフォントの下線メトリクス由来で\n   16px 本文なら約1px しかなく、表の中では「消したのかゴミなのか」が判別しづらい。\n   太さは em 指定にして本文・見出し・表（13px）のどこでも同じ比率で太る。\n   ただし太くしただけだと下の文字が潰れるため、線側を透過させて可読性を戻している。\n   調整はこの3つの変数だけで完結する。\n     --gd-strike-thickness 線の太さ（auto でブラウザ既定＝従来の見た目に戻る）\n     --gd-strike-ink       線の不透明度（75% = 透過率25%）\n     --gd-strike-fade      消した文字自体の不透明度。既定は 100%（＝文字は薄くしない）。\n                           「済んだ項目は後ろへ下がってほしい」なら 75% などにする。\n                           意味を担う情報を薄くすると読めなくなるため、既定では効かせない。 */\n:root { --gd-strike-thickness: 0.125em; --gd-strike-ink: 75%; --gd-strike-fade: 100%; }\ndel, s {\n    text-decoration-line: line-through;\n    text-decoration-thickness: var(--gd-strike-thickness);\n    text-decoration-color: color-mix(in srgb, currentColor var(--gd-strike-ink), transparent);\n    opacity: var(--gd-strike-fade);\n}\n";
    gnDocRd.BUILT_FROM = "gnDoc.html v0.4.3f";
    gnDocRd.version = "v0.4.3f";
    gnDocRd.checkUpdate = async function (opts) {
        opts = opts || {};
        const LATEST = 'https://raw.githubusercontent.com/take4-commits/gnDoc/main/latest.json';
        const KEY = 'gnDocRd_update_v1';
        const maxAge = (typeof opts.maxAgeHours === 'number' ? opts.maxAgeHours : 24) * 3600 * 1000;
        const current = gnDocRd.version;
        const parts = v => { const m = /^v?(\d{1,3})\.(\d{1,3})\.(\d{1,3})([a-z]?)$/.exec(String(v || '').trim()); return m ? [+m[1], +m[2], +m[3], m[4] || ''] : null; };
        const cmp = (a, b) => { const x = parts(a), y = parts(b); if (!x || !y) return NaN; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return x[3] === y[3] ? 0 : (x[3] < y[3] ? -1 : 1); };
        const done = (latest, url) => ({ current, latest, url, newer: !!latest && cmp(latest, current) > 0 });
        if (!opts.force) {
            try {
                const c = JSON.parse(localStorage.getItem(KEY) || 'null');
                if (c && Date.now() - c.at < maxAge && parts(c.latest)) return done(c.latest, c.url);
            } catch (e) {}
        }
        try {
            const r = await fetch(LATEST, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
            if (!r.ok) throw new Error('応答の番号 ' + r.status);
            const j = await r.json();
            const g = j && j.gnDocRd;
            const latest = g && parts(g.version) ? String(g.version) : null;
            const url = g && /^https:\/\/raw\.githubusercontent\.com\/take4-commits\/gnDoc\//.test(String(g.url || '')) ? String(g.url) : null;
            if (!latest) throw new Error('版の情報の形が違います');
            try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), latest, url })); } catch (e) {}
            return done(latest, url);
        } catch (e) {
            return Object.assign(done(null, null), { error: String((e && e.message) || e) });
        }
    };
    root.gnDocRd = gnDocRd;
})(typeof window !== 'undefined' ? window : globalThis);
// @gnDocRd-core:end
// @gnDocRd-api:begin
// 簡単に使う入口（ここは gnDocRd.js を正として直接直す）。
//   await gnDocRd.render(描く先, Markdown, 設定)   … 描く先（要素か CSS の選択子）へ Markdown を描く。図・線まで描き終えてから戻る
//   await gnDocRd.renderScripts(選択子, 設定)      … <script type="text/markdown"> の中身を、その直後（または data-target の先）へ描く
//   gnDocRd.toHtml(Markdown)                         … HTML の文字列だけ（DOMPurify を通した物。図はまだ描かれていない）
//   gnDocRd.injectCss() / gnDocRd.initMermaid(設定)  … render が最初に自動で呼ぶ。自分で先に呼んでもよい
//   gnDocRd.print.enable / openCopy / copyHtml       … 印刷（v0.4.1。Ctrl+P で gnDoc と同じ紙面・🖨 と同じ写しの窓・写しの文書。下の「印刷」の注記）
//   gnDocRd.exportHtml / downloadHtml                … 単一HTMLの書き出し（v0.4.1a。gnDoc の 💾🌐 と同じ物。下の「単一HTMLの書き出し」の注記）
// 設定: { css: false（見た目を入れない）, base: false（基本の見た目を入れない）, dark: true（コードの色分けを暗い地の配色に）,
//         mermaid: false（Mermaid を初期化しない）,
//         mermaidConfig: {…}, endpoints: { plantuml, dbml, d2, graphviz }（外部サーバーの図。既定は送らない） }
// **gnDocRd-libs.js（marked・DOMPurify・Mermaid ほか）を先に読み込む。** 描く先は見えている要素にする（線は配置を測って引く）。
;(function (root) {
    const rd = root.gnDocRd;
    if (!rd || typeof document === 'undefined') return;
    // 基本の見た目。gnDoc のビュワーの CSS のうち、記法の区切り（gnDocRd.CSS）の外にあってライブラリに要る物（表・コード・図の大きさ・数式）
    const BASE_CSS = [
        // 既定値は gnDoc の明るいテーマと同じ（cdp-gndocrd-conformance が色を突き合わせる）
        ':where(:root) { --bg-color: #ffffff; --border-color: #dee2e6; --text-color: #333333; }',
        '.gnDocRd { color: var(--text-color); background: var(--bg-color); line-height: 1.7; overflow-wrap: break-word; }',
        '.gnDocRd table { border-collapse: collapse; width: 100%; margin: 20px 0; }',
        '.gnDocRd th, .gnDocRd td { padding: 10px 16px; text-align: left; border-bottom: 1px solid var(--border-color); vertical-align: top; }',
        '.gnDocRd thead th { border-bottom: 2px solid var(--border-color); }',
        '.gnDocRd th[align="center"], .gnDocRd td[align="center"] { text-align: center; }',
        '.gnDocRd th[align="right"], .gnDocRd td[align="right"] { text-align: right; }',
        '.gnDocRd pre { position: relative; padding: 15px; overflow: auto; border: 1px solid var(--border-color); border-radius: 6px; background: color-mix(in srgb, var(--text-color) 4%, var(--bg-color)); }',
        '.gnDocRd code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: .92em; }',
        '.gnDocRd :not(pre) > code { padding: .1em .35em; border-radius: 4px; background: color-mix(in srgb, var(--text-color) 8%, transparent); }',
        '.gnDocRd pre code.hljs { padding: 0; background: transparent; }',
        '.gnDocRd blockquote { margin: 1em 0; padding: 0 1em; border-left: 4px solid var(--border-color); }',
        '.gnDocRd img { max-width: 100%; }',
        // KaTeX の CSS（フォント）は束ねていないので、MathML の方を見せる（gnDoc と同じ）
        '.gnDocRd .katex-html { display: none; }',
        '.gnDocRd .mermaid svg, .gnDocRd .wavedrom svg, .gnDocRd .plantuml img, .gnDocRd .dbml img, .gnDocRd .d2 img, .gnDocRd .graphviz img { max-width: 100%; height: auto; }',
        '.gnDocRd .chartjs canvas, .gnDocRd .cytoscape canvas { max-width: 100%; }',
        '.gnDocRd div.markmap { height: 420px; position: relative; overflow: hidden; }',
        '.gnDocRd .markmap-svg { display: block; position: absolute; inset: 0; width: 100%; height: 100%; }',
        '.gnDocRd .page-break { display: block; height: 0; margin: 18px 0; border-top: 1px dashed var(--border-color); clear: both; }',
        '@media print { .gnDocRd .page-break { break-after: page; height: 0; margin: 0; border: none; }'
            + ' .gnDocRd .mermaid, .gnDocRd .wavedrom, .gnDocRd .chartjs, .gnDocRd .cytoscape, .gnDocRd .gx { break-inside: avoid; } }',
    ].join('\n');
    // Ctrl+P の写し（gnDocRd.print.enable）。画面には出さず、紙では描いた先の代わりに写しを刷る（基本の見た目を入れないときも要る）
    const PRINT_CSS = '.gnDocRd-print { display: none; }\n@media print { .gnDocRd.gd-print-src { display: none !important; } .gnDocRd-print { display: block !important; } }';
    // コードの色分けの配色。gnDocRd-libs.js は明るい・暗いの2つを <style> で入れる（読み込んだ時点の効き方は当てにならない）。
    // gnDoc と同じく、使う方だけを効かせる
    rd.setCodeTheme = function (dark = false) {
        const light = document.getElementById('hljs-theme-light'), dk = document.getElementById('hljs-theme-dark');
        if (light) light.disabled = !!dark;
        if (dk) dk.disabled = !dark;
    };
    rd.injectCss = function ({ base = true, dark = false } = {}) {
        rd.setCodeTheme(dark);
        if (document.getElementById('gnDocRd-css')) return;
        const s = document.createElement('style');
        s.id = 'gnDocRd-css';
        s.textContent = (base ? BASE_CSS + '\n' : '') + PRINT_CSS + '\n' + (rd.CSS || '');
        // 使う側の CSS が後から勝つように、head の先頭へ入れる
        document.head.insertBefore(s, document.head.firstChild);
    };
    // Mermaid の設定（gnDoc と同じ既定値。Mermaid 11 の見た目に留める）
    rd.MERMAID_CONFIG = { startOnLoad: false, securityLevel: 'antiscript', fontFamily: 'inherit', suppressErrorRendering: true,
        theme: 'default', look: 'classic', flowchart: { wrappingWidth: 200 } };
    let mermaidReady = false;
    rd.initMermaid = function (config) {
        if (typeof mermaid === 'undefined') return;
        mermaid.initialize(Object.assign({}, rd.MERMAID_CONFIG, config || {}));
        mermaidReady = true;
    };
    // 改ページの印 <PB>（DOMPurify は知らない札を落とすので、その前に置き換える。gnDoc と同じ）
    const PB_TAG_RE = /<pb\s*\/?>(?:\s*<\/pb>)?/gi;
    // opts.comments === false で、コメントの印 <gd-cm>（統合した Markdown）を置き換えない（DOMPurify が札を落とし、中の文字だけが残る）
    rd.toHtml = function (md, opts = {}) {
        if (!rd.marked) throw new Error('gnDocRd: marked がありません。gnDocRd-libs.js を gnDocRd.js より先に読み込んでください');
        if (typeof DOMPurify === 'undefined') throw new Error('gnDocRd: DOMPurify がありません。gnDocRd-libs.js を gnDocRd.js より先に読み込んでください');
        let html = rd.marked.parse(String(md)).replace(PB_TAG_RE, '<div class="page-break"></div>');
        if (opts.comments !== false && rd.cm) html = rd.cm.transformHtml(html);
        return DOMPurify.sanitize(html);
    };
    // コメント（v0.4.0k・見せるだけ）: 統合した Markdown（<gd-cm n="1">…</gd-cm>・番号のリンク・末尾の注釈の章）は、そのまま描けば線・番号・ポップアップまで出る。
    //   comments: false … 置き換えない・ポップアップを付けない ／ comments: '資料.cm.md の中身' … 描く前に統合してから描く（解決済みは入れない。commentsResolved: true で入れる）
    //   commentLine: 'both'（上下線・既定）| 'under' | 'over' ／ commentNotes: 'show'（既定）| 'fold'（末尾の章を画面では畳む。印刷では開く）
    rd.render = async function (target, md, opts = {}) {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!el) throw new Error('gnDocRd.render: 描く先が見つかりません: ' + target);
        if (opts.css !== false) rd.injectCss({ base: opts.base !== false, dark: !!opts.dark });
        if (opts.mermaid !== false && !mermaidReady) rd.initMermaid(opts.mermaidConfig);
        if (opts.endpoints) rd.configure({ endpoints: opts.endpoints });
        if (typeof opts.comments === 'string' && rd.cmCore && !rd.cmCore.isIntegrated(md)) {
            md = rd.cmCore.integrate(String(md), rd.cmCore.parse(opts.comments).records, { resolved: !!opts.commentsResolved }).md;
        }
        el.classList.add('gnDocRd');
        sources.set(el, String(md));   // 透かしの文書の指定（<!-- gd-watermark: … -->）を刷るときに読む
        el.innerHTML = rd.toHtml(md, opts);
        if (typeof hljs !== 'undefined') {
            el.querySelectorAll('pre code[class*="language-"]').forEach(b => {
                if (!b.dataset.highlighted) { try { hljs.highlightElement(b); } catch (e) {} b.dataset.highlighted = 'true'; }
            });
        }
        rd.setViewRoot(el);
        await rd.hydrate(el);
        if (opts.comments !== false && rd.cm && el.querySelector('.gd-cm[data-gd-cm], sup[id^="gd-cm-ref-"], a[id="gd-comments"]')) {
            rd.cm.decorate(el, { line: opts.commentLine, notes: opts.commentNotes });
            rd.cm.attach(el);
        }
        // Ctrl+P（ブラウザの印刷）で gnDoc と同じ紙面にする（v0.4.1）。print: false で付けない。print: { header, footer, name, watermark … } で設定
        if (opts.print !== false && rd.print) rd.print.enable(el, typeof opts.print === 'object' ? opts.print : {});
        return el;
    };
    // ---------- 印刷（v0.4.1。部品の本体は gnDocRd.print〔gnDoc.html の @gnDocRd-print〕。ここは描いた先へ結び付ける口） ----------
    //   gnDocRd.print.enable(描く先, 設定)          … Ctrl+P で gnDoc と同じ紙面にする（render が自動で呼ぶ）。刷る直前に写しを作り、描く先の代わりに刷る
    //   await gnDocRd.print.openCopy(描く先, 設定)  … 🖨 と同じく、写しを新しい窓で開いて刷る（窓を開けなければ見えない iframe で）
    //   await gnDocRd.print.copyHtml(描く先, 設定)  … 🖨 の写しの文書（HTML の文字列）。PDF を作る道具へ渡すときなど
    // 設定: { header: true（上に文書名と日時）, footer: true（下にページ番号）, name: '文書名'（上と下・「PDF に保存」の既定のファイル名）,
    //         watermark: true | '文字' | { text, layout: 'center'|'tile', layer: 'front'|'back', opacity: 12, size: 100, color }（透かし。
    //         書かなければ、文書の中の <!-- gd-watermark: … --> があるときだけ付く。false で文書の指定があっても付けない）,
    //         base: 'https://…/'（相対のリンクの基準）, faq: false（faq の答えを開かずに刷る）, off: true（enable を一時的に止める） }
    // header・footer をどちらも書かなければ、紙の上と下はブラウザの既定のまま（URL・日時が刷られることがある。印刷の窓の「ヘッダーとフッター」で切る）
    const sources = new WeakMap();
    const printOpts = new WeakMap();
    const elOf = target => {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (!el) throw new Error('gnDocRd.print: 描く先が見つかりません: ' + target);
        return el;
    };
    const wmOf = (o, el) => {
        if (o.watermark === false) return null;
        const w = o.watermark;
        const base = w === true ? { on: true } : typeof w === 'string' ? { on: true, text: w } : w && typeof w === 'object' ? Object.assign({ on: true }, w) : { on: false };
        return rd.print.watermark.resolve(base, sources.get(el) || '');
    };
    const pageCssOf = o => (o.header !== undefined || o.footer !== undefined)
        ? rd.print.pageCss({ header: !!o.header, footer: !!o.footer, name: o.name || document.title || 'Untitled' }) : '';
    const baseName = n => String(n || 'Untitled').replace(/\.[^./\\]+$/, '') || 'Untitled';
    rd.print.enable = function (target, opts = {}) {
        const el = elOf(target);
        const had = printOpts.has(el);
        printOpts.set(el, Object.assign(printOpts.get(el) || {}, opts));
        if (had) return el;
        let box = null, wm = null, page = null, oldTitle = null;
        window.addEventListener('beforeprint', () => {
            const o = printOpts.get(el);
            if (!el.isConnected || o.off || box) return;
            // 写しを描く先のすぐ後ろへ置き、紙では描く先の代わりに刷る（CSS の .gd-print-src・.gnDocRd-print）
            box = document.createElement('div');
            box.className = 'gnDocRd gnDocRd-print';
            box.append(...rd.print.snapshot(el, { faq: o.faq !== false }).childNodes);
            rd.print.fixLinks(box, { base: o.base || '' });
            const w = wmOf(o, el);
            if (w) { wm = document.createElement('div'); rd.print.watermark.apply(wm, w); el.after(wm); wm.after(box); }
            else el.after(box);
            el.classList.add('gd-print-src');
            const css = pageCssOf(o);
            if (css) { page = document.createElement('style'); page.textContent = css; document.head.appendChild(page); }
            if (o.name) { oldTitle = document.title; document.title = baseName(o.name); }
        });
        window.addEventListener('afterprint', () => {
            if (!box) return;
            box.remove(); box = null;
            if (wm) { wm.remove(); wm = null; }
            if (page) { page.remove(); page = null; }
            el.classList.remove('gd-print-src');
            if (oldTitle !== null) { document.title = oldTitle; oldTitle = null; }
        });
        return el;
    };
    rd.print.copyHtml = async function (target, opts = {}) {
        const el = elOf(target);
        const o = Object.assign({}, printOpts.get(el) || {}, opts);
        const snap = rd.print.snapshot(el, { faq: o.faq !== false });
        rd.print.fixLinks(snap, { base: o.base || '' });
        await rd.print.inlineExternalImages(snap);
        return rd.print.documentHtml({ title: baseName(o.name || document.title), css: rd.print.collectStyles(el), body: snap,
            watermark: rd.print.watermark.html(wmOf(o, el)), autoPrint: !!o.autoPrint, rootClass: 'gnDocRd', pageCss: pageCssOf(o) });
    };
    rd.print.openCopy = async function (target, opts = {}) {
        const html = await rd.print.copyHtml(target, Object.assign({}, opts, { autoPrint: true }));
        return rd.print.open(html, { iframe: !!opts.iframe });
    };
    // ---------- 単一HTMLの書き出し（v0.4.1a。部品の本体は gnDocRd.print.exportHtml。gnDoc の 💾🌐 と同じ物） ----------
    //   await gnDocRd.exportHtml(描く先, 設定)              … 1つのファイルで開ける HTML の文字列（図は描いた物・外部サーバーの図は埋め込む・ライブラリは要らない）
    //   await gnDocRd.downloadHtml(描く先, 'ファイル名', 設定) … それをダウンロードする（ファイル名を省くと 設定の name か題名.html）
    // 設定: { name: '文書名'（題名）, toc: false（右の見出しの一覧を付けない。既定は付ける）, theme: 'light'|'dark'|'sepia'（地の色。既定は light）,
    //         watermark（紙に刷る透かし。印刷の設定と同じ）, commentLine: 'both'|'under'|'over'（コメントの線）, base（相対のリンクの基準） }
    // コードの色分けの配色は、描いたときの物（render の dark）をそのまま写す。暗い地で書き出すときは render も dark: true で描く
    // 文書の隣の画像は、ページと同じ場所（http）から読めれば埋め込む。file:// で開いたページでは、ブラウザがページの隣のファイルを読ませないので、相対のまま残る
    const THEME_VARS = {
        light: '',
        dark: ':root{--bg-color:#1e1e1e;--text-color:#d4d4d4;--border-color:#444;}',
        sepia: ':root{--bg-color:#f4ecd8;--text-color:#5b4636;--border-color:#dad0c6;}',
    };
    const inlineSameOriginImages = async root => {
        await Promise.all([...root.querySelectorAll('img[src]')].map(async img => {
            const src = img.getAttribute('src') || '';
            if (/^(data|blob):/i.test(src) || !/^https?:/i.test(location.protocol)) return;
            try {
                const u = new URL(src, location.href);
                if (u.origin !== location.origin) return;   // よその場所の画像は読めない（CORS）。そのまま
                const res = await fetch(u.href);
                if (res.ok) img.src = await rd.print.blobToDataUrl(await res.blob());
            } catch (e) { /* 読めなければ元の参照のまま */ }
        }));
    };
    rd.exportHtml = async function (target, opts = {}) {
        const el = elOf(target);
        const o = Object.assign({}, printOpts.get(el) || {}, opts);
        const theme = THEME_VARS[o.theme] !== undefined ? o.theme : 'light';
        return rd.print.exportHtml(el, {
            title: o.name || document.title || 'Untitled', css: rd.print.collectStyles(el), rootId: 'gnDocRd-doc', rootClass: 'gnDocRd',
            toc: o.toc !== false, bodyClass: 'theme-' + theme,
            headCss: THEME_VARS[theme] + 'body.export-doc{background:var(--bg-color);color:var(--text-color);}',
            watermark: rd.print.watermark.html(wmOf(o, el)), base: o.base || '',
            decorate: inlineSameOriginImages,
            script: clone => rd.cm && rd.cm.hasComments && rd.cm.hasComments(clone) ? rd.cm.viewScript('#gnDocRd-doc', o.commentLine) : '',
        });
    };
    rd.downloadHtml = async function (target, fileName, opts = {}) {
        const html = await rd.exportHtml(target, opts);
        const el = elOf(target);
        const name = fileName || (baseName((Object.assign({}, printOpts.get(el) || {}, opts)).name || document.title) + '.html');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        a.download = /\.html?$/i.test(name) ? name : name + '.html';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        return html;
    };
    // <script type="text/markdown"> の中身は、行頭の共通の字下げを外してから描く（HTML の中で字下げして書けるように）。
    // 中に </script> は書けない（そこで札が終わる）ので <\/script> と書き、ここで戻す（JavaScript の文字列と同じ約束）
    const dedent = s => {
        const lines = String(s).replace(/<\\\/script>/gi, '</script>').replace(/^\n+|\s+$/g, '').split('\n');
        const ind = Math.min(...lines.filter(l => l.trim()).map(l => /^[ \t]*/.exec(l)[0].length));
        return lines.map(l => l.slice(Number.isFinite(ind) ? ind : 0)).join('\n');
    };
    rd.renderScripts = async function (selector = 'script[type="text/markdown"]', opts = {}) {
        const out = [];
        for (const sc of document.querySelectorAll(selector)) {
            let el = sc.dataset.target ? document.querySelector(sc.dataset.target) : null;
            if (!el) { el = document.createElement('div'); sc.after(el); }
            out.push(await rd.render(el, dedent(sc.textContent), opts));
        }
        return out;
    };
})(typeof window !== 'undefined' ? window : globalThis);
// @gnDocRd-api:end
// @gnDocRd-libgen:begin
(function (root) {
    'use strict';

    const VERSION = '0.1.0';
    // 作る物の名前。gnDoc（exe・HTML 版）もこの名前で読む
    const FILE_NAME = 'gnDocRd-libs.js';

    // ------------------------------------------------------------
    // 描画に要るライブラリ（読み込み順。順番に意味がある物は注記）
    // ------------------------------------------------------------
    // version … 試験済みの版（固定）。source … npm（jsDelivr）／cdnjs。paths … 候補のパス（先頭から試す）
    const LIBS = [
        {
            // PlantUML・Kroki へ渡す図の中身の圧縮。pako 3.x で dist 直下の pako.min.js が無くなり dist/browser/ へ移ったので両方を候補にする
            name: 'pako', source: 'npm', pkg: 'pako', version: '3.0.1', license: 'MIT AND Zlib',
            paths: ['dist/pako.min.js', 'dist/browser/pako.umd.min.js'],
        },
        { name: 'cytoscape', source: 'npm', pkg: 'cytoscape', version: '3.34.0', license: 'MIT', paths: ['dist/cytoscape.min.js'] },
        {
            // 記法の拡張は marked 18 の書き方（inlineTokens など）に合わせてある。主版を上げるときは記法の試験を全部回す
            name: 'marked', source: 'npm', pkg: 'marked', version: '18.0.9', license: 'MIT',
            paths: ['lib/marked.umd.min.js', 'lib/marked.umd.js', 'marked.min.js'],
        },
        { name: 'KaTeX', source: 'npm', pkg: 'katex', version: '0.18.4', license: 'MIT', paths: ['dist/katex.min.js'] },
        { name: 'DOMPurify', source: 'npm', pkg: 'dompurify', version: '3.4.13', license: 'MPL-2.0 OR Apache-2.0', paths: ['dist/purify.min.js'] },
        {
            // 12 は既定値が大きく変わり図の形が変わる（v0.3.18o）。flow の装飾の差し替えは Mermaid の内部の名前（flowchart-nN-・線の data-id）に頼る
            name: 'Mermaid', source: 'npm', pkg: 'mermaid', version: '11.16.1', license: 'MIT', paths: ['dist/mermaid.min.js'],
        },
        { name: 'WaveDrom', source: 'npm', pkg: 'wavedrom', version: '3.6.2', license: 'MIT', paths: ['wavedrom.min.js'] },
        { name: 'WaveDrom Skin', source: 'npm', pkg: 'wavedrom', version: '3.6.2', license: 'MIT', paths: ['skins/default.js'] },
        { name: 'KaTeX mhchem', source: 'npm', pkg: 'katex', version: '0.18.4', license: 'MIT', paths: ['dist/contrib/mhchem.min.js'] },
        {
            // npm の highlight.js は CommonJS（require）しか配っていないので、ブラウザでそのまま読める cdnjs の物を取る
            name: 'highlight.js', source: 'cdnjs', pkg: 'highlight.js', version: '11.9.0', license: 'BSD-3-Clause', paths: ['highlight.min.js'],
        },
        { name: 'Chart.js', source: 'npm', pkg: 'chart.js', version: '4.5.1', license: 'MIT', paths: ['dist/chart.umd.min.js'] },
        // markmap の並びは厳守: KaTeX（上で読み込み済み）→ D3 → markmap-view（グローバルの D3 に頼る）→ markmap-lib（グローバルの katex に頼る）
        { name: 'D3', source: 'npm', pkg: 'd3', version: '7.9.0', license: 'ISC', paths: ['dist/d3.min.js'] },
        { name: 'markmap-view', source: 'npm', pkg: 'markmap-view', version: '0.18.12', license: 'MIT', paths: ['dist/browser/index.js'] },
        { name: 'markmap-lib', source: 'npm', pkg: 'markmap-lib', version: '0.18.12', license: 'MIT', paths: ['dist/browser/index.iife.min.js'] },
    ];

    // highlight.js のテーマ CSS（明るい／暗い）。外の CDN の <link> に頼らず <style> として埋め、切り替えは disabled で行う
    const THEMES = [
        { name: 'highlight.js theme (github)', source: 'cdnjs', pkg: 'highlight.js', version: '11.9.0', license: 'BSD-3-Clause',
          paths: ['styles/github.min.css'], styleId: 'hljs-theme-light', disabled: false },
        { name: 'highlight.js theme (github-dark)', source: 'cdnjs', pkg: 'highlight.js', version: '11.9.0', license: 'BSD-3-Clause',
          paths: ['styles/github-dark.min.css'], styleId: 'hljs-theme-dark', disabled: true },
    ];

    const noop = () => {};
    const RULE = '// ============================================================\n';

    function resolveVersion(lib) {
        if (lib.version) return lib.version;
        if (lib.source === 'github') return lib.branch;
        throw new Error(`版を固定していません: ${lib.name}（黙って最新を取らない）`);
    }

    function buildBaseUrl(lib, version) {
        if (lib.source === 'npm') return `https://cdn.jsdelivr.net/npm/${lib.pkg}@${version}`;
        if (lib.source === 'cdnjs') return `https://cdnjs.cloudflare.com/ajax/libs/${lib.pkg}/${version}`;
        if (lib.source === 'github') return `https://raw.githubusercontent.com/${lib.repo}/${version}`;
        if (lib.source === 'local') return lib.baseUrl || '.';
        throw new Error(`Unknown source: ${lib.source}`);
    }

    function joinUrl(baseUrl, path) {
        if (!baseUrl) return path;
        return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
    }

    // paths を先頭から試し、最初に 200 で空でない物を使う（CDN 側のフォルダの並びの変更を吸収する）
    async function fetchWithFallback(baseUrl, paths, libName, log = noop) {
        const tried = [];
        for (const path of paths) {
            const url = joinUrl(baseUrl, path);
            tried.push(url);
            try {
                const res = await fetch(url);
                if (res.ok) {
                    const text = await res.text();
                    if (!text || !text.trim()) { log(`警告: ${libName} のファイルが空です: ${url}`, 'warn'); continue; }
                    return { url, text };
                }
                log(`候補パス失敗: ${libName} / ${res.status} ${res.statusText} / ${url}`, 'warn');
            } catch (e) {
                log(`候補パス例外: ${libName} / ${e.message} / ${url}`, 'warn');
            }
        }
        throw new Error(`利用可能なファイルが見つかりませんでした。試行URL: ${tried.join(' , ')}`);
    }

    // 1つのライブラリのブロック。embedAs の物は実行するスクリプトではなく文字列として埋める（PDF.js のワーカーなど）
    function libraryBlock(lib, version, result) {
        let c = '\n' + RULE;
        c += `// START: ${lib.name}${lib.embedAs ? ' (文字列として埋め込み)' : ''}\n`;
        c += `// Source Type: ${lib.source}\n`;
        if (lib.pkg) c += `// Package: ${lib.pkg}\n`;
        if (lib.repo) c += `// Repo: ${lib.repo}\n`;
        c += `// Version/Branch: ${version}\n`;
        if (lib.license) c += `// License: ${lib.license}\n`;
        c += `// URL: ${result.url}\n` + RULE;
        if (lib.embedAs) {
            c += `;(function(){ if (typeof window === 'undefined') return;\n`;
            c += `  window[${JSON.stringify(lib.embedAs)}] = ${JSON.stringify(result.text)};\n`;
            c += `})();\n`;
        } else {
            c += `;\n` + result.text + `\n`;
        }
        return c + RULE + `// END: ${lib.name}\n` + RULE + '\n';
    }

    function failureBlock(lib, err) {
        return '\n' + RULE + `// FAILED: ${lib.name}\n// Reason: ${err.message}\n` + RULE + '\n';
    }

    // highlight.js のテーマを <style> として足すブロック
    async function themeBlock(themes, log) {
        const styles = [];
        for (const lib of themes) {
            try {
                const version = resolveVersion(lib);
                const result = await fetchWithFallback(buildBaseUrl(lib, version), lib.paths, lib.name, log);
                styles.push({ id: lib.styleId, disabled: lib.disabled, css: result.text });
                log(`成功: ${lib.name} をロードしました (${result.url})`, 'success');
            } catch (err) {
                log(`失敗: ${lib.name} の取得に失敗しました - ${err.message}`, 'error');
            }
        }
        if (!styles.length) return '';
        let c = '\n' + RULE + `// START: highlight.js CSS themes (github / github-dark)\n// Source Type: cdnjs\n// Package: highlight.js\n` + RULE;
        c += `;(function(){\n  if (typeof document === 'undefined') return;\n`;
        c += `  function addStyle(id, css, disabled){\n    var s = document.createElement('style');\n`;
        c += `    s.id = id; s.textContent = css; s.disabled = !!disabled;\n    document.head.appendChild(s);\n  }\n`;
        for (const s of styles) c += `  addStyle(${JSON.stringify(s.id)}, ${JSON.stringify(s.css)}, ${JSON.stringify(!!s.disabled)});\n`;
        return c + `})();\n` + RULE + `// END: highlight.js CSS themes\n` + RULE + '\n';
    }

    // 入れた物の一覧（名前・版・ライセンス）。配る人が守るべき表示をそろえるため、生成物の先頭に書く
    function noticeBlock(entries) {
        let c = '/*!\n * 第三者のソフトウェア（THIRD-PARTY SOFTWARE）\n'
            + ' * このファイルは次のオープンソースソフトウェアを結合した物です。各ライブラリの著作権はそれぞれの権利者にあり、\n'
            + ' * 利用条件は各ライセンスに従います（著作権表示は各ブロックの中に残っています）。配るときは各ライセンスの条件を守ってください。\n *\n';
        for (const e of entries) c += ` *   ${e.name} ${e.version}  (${e.license || 'ライセンスは各配布元を参照'})\n`;
        return c + ' */\n';
    }

    // 読み込んだ側から版を確かめられるようにする（gnDocRd が表と主版を比べる）。
    // 名前は既定で __GNDOCRD_LIBS__。gnDoc のアプリの物（gnDoc-app-libs.js）は __GNDOC_APP_LIBS__ を使う
    function manifestBlock(entries, generatedAt, globalName = '__GNDOCRD_LIBS__') {
        const libs = {};
        for (const e of entries) libs[e.name] = e.version;
        return `;(function(){ if (typeof window === 'undefined') return;\n`
            + `  window[${JSON.stringify(globalName)}] = ${JSON.stringify({ generator: 'gnDocRd.libgen ' + VERSION, generatedAt, libs })};\n`
            + `})();\n`;
    }

    // 1本のファイルに組み立てる（先頭の一覧＋見出し＋版の表＋本体）。build() の結果をそのまま渡せる
    function fileText({ file, source, loaded, code, globalName = '__GNDOCRD_LIBS__', generatedAt = new Date().toISOString() }) {
        return noticeBlock(loaded)
            + `// ${file}\n// Generated: ${generatedAt}\n// Source: ${source || 'gnDocRd.js（libgen ' + VERSION + '）'}\n\n`
            + manifestBlock(loaded, generatedAt, globalName) + code;
    }

    // 本体: 各ライブラリのブロック＋テーマ。失敗した物は FAILED のブロックを残して続ける
    async function build({ log = noop, libs = LIBS, themes = THEMES } = {}) {
        let code = '';
        const loaded = [], failed = [];
        for (const lib of libs) {
            log(`取得中: ${lib.name}...`, 'info');
            try {
                const version = resolveVersion(lib);
                log(`バージョン: ${lib.name} => ${version}`, 'info');
                const result = await fetchWithFallback(buildBaseUrl(lib, version), lib.paths, lib.name, log);
                code += libraryBlock(lib, version, result);
                loaded.push({ name: lib.name, version, license: lib.license });
                log(`成功: ${lib.name} をロードしました (${result.url})`, 'success');
            } catch (err) {
                failed.push({ name: lib.name, error: err.message });
                log(`失敗: ${lib.name} の取得に失敗しました - ${err.message}`, 'error');
                code += failureBlock(lib, err);
            }
        }
        if (themes && themes.length) {
            log('highlight.js テーマCSSを取得しています...', 'info');
            code += await themeBlock(themes, log);
        }
        return { code, loaded, failed };
    }

    // 単独で使う gnDocRd-libs.js の全体（先頭の一覧＋版の表＋本体）
    async function generate({ log = noop } = {}) {
        const r = await build({ log });
        if (!r.loaded.length) throw new Error('取得に成功したライブラリがありません。ネットワークを確認してください。');
        return fileText({ file: FILE_NAME, loaded: r.loaded, code: r.code });
    }

    // 表より新しい版が出ているかを知らせるだけ（取り込まない。上げるのは試験の後）
    async function checkUpdates({ log = noop, libs = LIBS } = {}) {
        const out = [];
        const seen = new Set();
        for (const lib of libs) {
            if (lib.source !== 'npm' || seen.has(lib.pkg)) continue;
            seen.add(lib.pkg);
            try {
                const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(lib.pkg)}/latest`);
                if (!res.ok) continue;
                const latest = (await res.json()).version;
                if (latest && latest !== lib.version) {
                    out.push({ name: lib.name, pinned: lib.version, latest });
                    log(`新しい版があります: ${lib.name} ${lib.version} → ${latest}（取り込むのは試験の後。表を直してから作り直す）`, 'warn');
                }
            } catch (e) { /* 調べられなくても生成には関係ない */ }
        }
        return out;
    }

    // 名前は gnDocRd.libgen（描画の本体と同じ gnDocRd の下。先に gnDocRd があれば、そこへ足す）
    const ns = root.gnDocRd = root.gnDocRd || {};
    ns.libgen = {
        VERSION, FILE_NAME, LIBS, THEMES,
        build, generate, checkUpdates, fileText,
        resolveVersion, buildBaseUrl, fetchWithFallback, libraryBlock, failureBlock, noticeBlock, manifestBlock,
    };
})(typeof window !== 'undefined' ? window : globalThis);
// @gnDocRd-libgen:end
