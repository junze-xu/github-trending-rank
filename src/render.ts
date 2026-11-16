import fs from "fs/promises"
import path from "path"

import { TOP_N, type DerivedData, type RankingEntry, type WindowKey } from "./derive"

const WINDOW_LABEL: Record<WindowKey, string> = {
  "1d": "近 1 日",
  "7d": "近 7 日",
  "30d": "近 30 日",
}

const fmt = new Intl.NumberFormat("en-US")

const REPO_URL = "https://github.com/"
const SITE_REPO = "https://github.com/junze-xu/github-trending-rank"

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso))
}

function renderLanguage(language: string, color: string): string {
  if (!language) return ""
  const style = color ? ` style="background:${escapeHtml(color)}"` : ""
  return `<span class="lang"><i${style}></i>${escapeHtml(language)}</span>`
}

function renderTags(tags: string[]): string {
  if (tags.length === 0) return ""
  const escaped = tags
    .map((tag) => `<span class="tag${tag === "回归" ? " returning" : ""}">${escapeHtml(tag)}</span>`)
    .join("")
  return `<span class="tags">${escaped}</span>`
}

function renderMetaLine(entry: RankingEntry, showStreak: boolean): string {
  const parts: string[] = []
  if (entry.language) parts.push(renderLanguage(entry.language, entry.languageColor))
  parts.push(`<span title="Star 总量">${fmt.format(entry.stars)} ★</span>`)
  if (entry.forks > 0) parts.push(`<span title="Fork 总量">${fmt.format(entry.forks)} forks</span>`)
  if (showStreak && entry.consecutiveDays > 1) {
    parts.push(`<span class="streak">连续在榜 ${entry.consecutiveDays} 天</span>`)
  }
  return `<div class="meta-line">${parts.join('<span class="sep">·</span>')}</div>`
}

function renderRow(entry: RankingEntry, windowLabel: string): string {
  const delta = entry.starsDelta
  let deltaHtml: string
  if (delta === null) {
    deltaHtml = `<div class="v">—</div><div class="l">首次上榜</div>`
  } else {
    const sign = delta >= 0 ? "+" : "−"
    const cls = delta >= 0 ? "" : " down"
    deltaHtml = `<div class="v${cls}">${sign}${fmt.format(Math.abs(delta))}</div><div class="l">${windowLabel}新增</div>`
  }

  const desc = entry.description
    ? `<div class="desc">${escapeHtml(entry.description)}</div>`
    : ""

  return `<div class="row">
  <div class="rank">${entry.rank ?? "·"}</div>
  <div class="main">
    <div class="repo-line">
      <a class="repo" href="${REPO_URL}${escapeHtml(entry.fullName)}" target="_blank" rel="noopener">${escapeHtml(entry.fullName)}</a>
      ${renderTags(entry.tags)}
    </div>
    ${desc}
    ${renderMetaLine(entry, true)}
  </div>
  <div class="delta">${deltaHtml}</div>
</div>`
}

function renderNewcomers(entries: RankingEntry[]): string {
  if (entries.length === 0) return ""
  const items = entries
    .map((entry) => {
      const desc = entry.description
        ? `<div class="desc">${escapeHtml(entry.description)}</div>`
        : ""
      return `<div class="newcomer">
  <a class="repo" href="${REPO_URL}${escapeHtml(entry.fullName)}" target="_blank" rel="noopener">${escapeHtml(entry.fullName)}</a>
  ${desc}
  <div class="m">首次上榜 ${escapeHtml(entry.firstSeen)} · ${fmt.format(entry.stars)} ★</div>
</div>`
    })
    .join("\n")
  return `<div class="list-head">
  <h2>新上榜（${entries.length}）</h2>
  <span class="meta">本窗口内首次进入榜单</span>
</div>
<div class="newcomers">${items}</div>`
}

function renderList(items: RankingEntry[], windowLabel: string): string {
  const rows = items.slice(0, TOP_N).map((entry) => renderRow(entry, windowLabel)).join("\n")
  return `<div class="list">${rows}</div>`
}

function buildPage(data: DerivedData): string {
  const weekly = data.rankings["7d"]
  const daily = data.rankings["1d"]
  const primaryKey: WindowKey = weekly.available ? "7d" : "1d"
  const primary = data.rankings[primaryKey]
  const windowLabel = WINDOW_LABEL[primaryKey]

  const weeklyReady = weekly.available
  const expectedDate = data.dates.length > 0 ? addDaysSafe(data.dates[0], 7) : null

  const statusBadge = weeklyReady
    ? `<span class="badge ready"><span class="dot"></span>周榜已就绪</span>`
    : `<span class="badge"><span class="dot"></span>数据积累期 · 第 ${data.daysAvailable} 天</span>`

  const notice = weeklyReady
    ? ""
    : `<div class="notice">周榜（7 日差分）预计 <strong>${expectedDate ?? "数据满 7 天后"}</strong> 上线${daily.available ? "，当前先展示近 1 日增量" : ""}。年榜需积累满一年后启用。</div>`

  const listTitle =
    primaryKey === "7d"
      ? `本周新增 Star Top ${Math.min(TOP_N, primary.items.length)}`
      : `近 1 日新增 Star Top ${Math.min(TOP_N, primary.items.length)}`

  const listMeta = primary.available
    ? `${primary.baselineDate} → ${primary.latestDate} · 候选 ${primary.candidateCount} 个项目`
    : `基线不足 · 候选 ${primary.candidateCount} 个项目`

  const hasContent = primary.items.length > 0 || primary.newcomers.length > 0

  const main = !primary.available
    ? `<div class="panel empty">基线数据不足，暂无榜单。数据每天自动采集，满 7 天后周榜自动上线。</div>`
    : hasContent
      ? `<div class="list-head">
  <h2>${listTitle}</h2>
  <span class="meta">${listMeta}</span>
</div>
${renderList(primary.items, windowLabel)}
${primary.newcomers.length > 0 ? renderNewcomers(primary.newcomers.slice(0, 12)) : ""}`
      : `<div class="panel empty">暂无符合条件的条目。</div>`

  const rateNote = `<div class="note">口径：增量 = 最新快照 − 基线快照（本窗口起点）；增速 = 增量 ÷ 当前 Star 总量；榜单完全由增量决定，历史总量不参与排序；「新上榜」= 最近 7 天内首次出现；「回归」= 中断 ≥7 天再次出现。</div>`

  const apiLinks = [
    `./data/rank-${primaryKey}.json`,
    `./data/repositories.json`,
    `./data/developers.json`,
    `./data/meta.json`,
  ]
    .map((href) => `<a href="${href}">${href.replace("./", "")}</a>`)
    .join(" · ")

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GitHub Trending 周榜 · 年榜</title>
<meta name="description" content="GitHub Trending 的周排行 / 年度排行 · 只看变化量，不做历史快照">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ctext y=%22.9em%22 font-size=%2290%22%3E%F0%9F%93%8A%3C/text%3E%3C/svg%3E">
<style>${STYLE}</style>
</head>
<body>
<div class="container">
  <header class="site">
    <div class="site-head">
      <div class="site-title">
        <h1>📊 GitHub Trending 周榜 · 年榜</h1>
        <p class="sub">GitHub Trending 的周排行 / 年度排行 · 只看变化量，不做历史快照</p>
      </div>
      <div class="translate">
        <button id="translateBtn" class="translate-btn" type="button" aria-haspopup="true" aria-expanded="false">🌐 翻译</button>
        <div id="translateMenu" class="translate-menu">
          <a data-tl="en" href="#">English</a>
          <a data-tl="zh-CN" href="#">简体中文</a>
          <a data-tl="zh-TW" href="#">繁體中文</a>
          <a data-tl="ja" href="#">日本語</a>
          <a data-tl="ko" href="#">한국어</a>
          <a data-tl="" href="#">↩ 显示原文</a>
        </div>
      </div>
    </div>
    <div class="badges">
      ${statusBadge}
      <span class="badge">数据截至 ${data.latestDate}</span>
      <span class="badge">生成于 ${formatTime(data.generatedAt)}</span>
    </div>
    ${notice}
  </header>

  ${main}

  ${rateNote}

  <footer class="site">
    <div>数据来源 <a href="https://github.com/trending" target="_blank" rel="noopener">github.com/trending</a> · 每天自动采集 · 全站共 ${data.daysAvailable} 天数据</div>
    <div>JSON API：${apiLinks}</div>
    <div>仓库：<a href="${SITE_REPO}" target="_blank" rel="noopener">junze-xu/github-trending-rank</a></div>
  </footer>
</div>
<div id="translateToast" role="status"></div>
<script>
(function () {
  var btn = document.getElementById("translateBtn")
  var menu = document.getElementById("translateMenu")
  var toast = document.getElementById("translateToast")
  if (!btn || !menu) return
  // 浏览器内置翻译没有对网页开放的 JS 接口：优先原地调用 MyMemory 公开翻译 API，
  // 失败（额度/网络）时在 toast 中降级引导到 Google 整页翻译。
  var CACHE_KEY = "gtr-translate-cache-v1"
  var cache = {}
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") } catch (e) { cache = {} }
  var originals = []
  var translatedLang = null
  var busy = false
  var LABELS = { en: "English", "zh-CN": "简体中文", "zh-TW": "繁體中文", ja: "日本語", ko: "한국어" }
  var PAIRS = { en: "en-US", "zh-CN": "zh-CN", "zh-TW": "zh-TW", ja: "ja-JP", ko: "ko-KR" }

  function hasCJK(s) { return /[\u3400-\u9fff]/.test(s) }
  function pageUrl() {
    return location.protocol === "file:"
      ? "https://junze-xu.github.io/github-trending-rank/"
      : location.href
  }
  function showToast(html) {
    if (!toast) return
    toast.innerHTML = html
    toast.className = "show"
  }
  function hideToast() {
    if (toast) toast.className = ""
  }
  function restorePage() {
    originals.forEach(function (o) { o.node.nodeValue = o.text })
    originals = []
    translatedLang = null
    btn.textContent = "🌐 翻译"
  }

  function collectNodes() {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var text = node.nodeValue
        if (!text || !text.trim()) return NodeFilter.FILTER_REJECT
        var p = node.parentElement
        if (!p) return NodeFilter.FILTER_REJECT
        var tag = p.tagName
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "CODE" || tag === "PRE") return NodeFilter.FILTER_REJECT
        if (p.closest("a") || p.closest(".translate") || p.closest("#translateToast")) return NodeFilter.FILTER_REJECT
        return NodeFilter.FILTER_ACCEPT
      }
    })
    var nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    return nodes
  }

  function needsTranslate(text, tl) {
    return tl === "en" ? hasCJK(text) : !hasCJK(text)
  }

  function translateChunk(texts, src, dst) {
    var joined = texts.join("\\n")
    var key = dst + "|" + joined
    if (cache[key]) return Promise.resolve(cache[key].split("\\n"))
    var url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(joined) + "&langpair=" + encodeURIComponent(src + "|" + dst)
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status)
      return r.json()
    }).then(function (j) {
      var text = j && j.responseData && j.responseData.translatedText
      if (!text || String(j.responseStatus) !== "200") throw new Error("bad response")
      cache[key] = text
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)) } catch (e) {}
      return text.split("\\n")
    })
  }

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms) }) }

  function translatePage(tl) {
    if (translatedLang) restorePage()
    var dst = PAIRS[tl] || tl
    var jobs = []
    collectNodes().forEach(function (node) {
      var text = node.nodeValue
      if (!needsTranslate(text, tl)) return
      jobs.push(node)
    })
    jobs.forEach(function (node) { originals.push({ node: node, text: node.nodeValue }) })
    if (jobs.length === 0) return Promise.resolve({ applied: 0 })

    var groups = {}
    jobs.forEach(function (node) {
      var src = hasCJK(node.nodeValue) ? "zh-CN" : "en-US"
      ;(groups[src] = groups[src] || []).push(node)
    })
    var chunks = []
    Object.keys(groups).forEach(function (src) {
      var chunk = []
      var chunkLen = 0
      groups[src].forEach(function (node) {
        var text = node.nodeValue
        if (chunkLen > 0 && chunkLen + text.length + 1 > 450) {
          chunks.push({ src: src, nodes: chunk })
          chunk = []
          chunkLen = 0
        }
        chunk.push(node)
        chunkLen += text.length + 1
      })
      if (chunk.length) chunks.push({ src: src, nodes: chunk })
    })

    var index = 0
    function next() {
      if (index >= chunks.length) return Promise.resolve()
      var c = chunks[index++]
      return translateChunk(c.nodes.map(function (n) { return n.nodeValue }), c.src, dst)
        .then(function (lines) {
          if (lines.length !== c.nodes.length) throw new Error("segment mismatch")
          c.nodes.forEach(function (n, i) { n.nodeValue = lines[i] })
          return sleep(120).then(next)
        })
    }
    return next().then(function () { return { applied: jobs.length } })
  }

  function googleFallback(tl) {
    return "https://translate.google.com/translate?sl=auto&tl=" + tl + "&u=" + encodeURIComponent(pageUrl())
  }

  menu.querySelectorAll("a[data-tl]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      e.preventDefault()
      menu.classList.remove("open")
      btn.setAttribute("aria-expanded", "false")
      if (busy) return
      var tl = a.getAttribute("data-tl")
      if (!tl) {
        restorePage()
        hideToast()
        return
      }
      busy = true
      hideToast()
      btn.disabled = true
      btn.textContent = "翻译中…"
      translatePage(tl).then(function (r) {
        busy = false
        btn.disabled = false
        translatedLang = tl
        btn.textContent = "✓ " + (LABELS[tl] || tl)
        if (r.applied === 0) showToast("当前页面上没有需要翻译的内容")
      }).catch(function () {
        busy = false
        btn.disabled = false
        btn.textContent = "🌐 翻译"
        showToast("免费翻译额度不足或网络受限，可在浏览器中换个时间重试。<br><a href=\\\"" + googleFallback(tl) + "\\\" target=\\\"_blank\\\" rel=\\\"noopener\\\">在 Google 翻译中打开 ↗</a>")
      })
    })
  })

  btn.addEventListener("click", function (e) {
    e.stopPropagation()
    var open = menu.classList.toggle("open")
    btn.setAttribute("aria-expanded", open ? "true" : "false")
  })
  document.addEventListener("click", function () {
    menu.classList.remove("open")
    btn.setAttribute("aria-expanded", "false")
  })
})()
</script>
</body>
</html>
`
}

function addDaysSafe(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number)
  const ms = Date.UTC(y, m - 1, d) + delta * 86_400_000
  const date = new Date(ms)
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-")
}

export async function render(data: DerivedData): Promise<void> {
  const html = buildPage(data)
  const outDir = path.join(process.cwd(), "dist")
  await fs.mkdir(outDir, { recursive: true })
  await fs.writeFile(path.join(outDir, "index.html"), html, "utf-8")
  console.log(`render ok — dist/index.html (${html.length} bytes)`)
}

const STYLE = `
:root{--bg:#0d1117;--panel:#161b22;--border:#30363d;--border-soft:#21262d;--text:#e6edf3;--dim:#8b949e;--accent:#58a6ff;--up:#3fb950;--down:#f85149;--warn:#d29922}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.5}
.container{max-width:880px;margin:0 auto;padding:36px 20px 64px}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
h1{font-size:22px;font-weight:600;letter-spacing:.2px}
.sub{color:var(--dim);font-size:13px;margin-top:4px}
.site-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.site-title{min-width:0}
.translate{position:relative;flex:none}
.translate-btn{cursor:pointer;font-family:inherit;font-size:12px;color:var(--dim);background:var(--panel);border:1px solid var(--border);border-radius:999px;padding:4px 12px;transition:color .15s,border-color .15s}
.translate-btn:hover{color:var(--text);border-color:var(--dim)}
.translate-btn[disabled]{opacity:.65;cursor:default}
#translateToast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(8px);max-width:min(90vw,430px);background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:10px 14px;font-size:12.5px;line-height:1.7;color:var(--text);box-shadow:0 8px 24px rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:99}
#translateToast.show{opacity:1;transform:translateX(-50%);pointer-events:auto}
#translateToast a{color:var(--accent);white-space:nowrap}
.translate-menu{position:absolute;right:0;top:calc(100% + 6px);background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:4px;display:none;min-width:132px;box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:10}
.translate-menu.open{display:block}
.translate-menu a{display:block;padding:6px 10px;border-radius:6px;color:var(--text);font-size:12.5px}
.translate-menu a:hover{background:var(--bg);text-decoration:none}
@media(max-width:640px){.site-head{flex-direction:column;align-items:stretch}.translate{align-self:flex-end}}
.badges{margin-top:14px;display:flex;flex-wrap:wrap;gap:8px}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid var(--border);color:var(--dim)}
.badge .dot{width:7px;height:7px;border-radius:50%;background:var(--warn)}
.badge.ready{color:var(--up);border-color:rgba(63,185,80,.45)}
.badge.ready .dot{background:var(--up)}
.notice{margin-top:14px;font-size:12.5px;color:var(--dim);border:1px dashed var(--border);border-radius:8px;padding:10px 12px;line-height:1.7}
.notice strong{color:var(--warn);font-weight:600}
.list-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin:30px 0 8px;flex-wrap:wrap}
.list-head h2{font-size:15px;font-weight:600}
.list-head .meta{color:var(--dim);font-size:12px}
.list{border:1px solid var(--border-soft);border-radius:12px;background:var(--panel);padding:4px 14px}
.row{display:grid;grid-template-columns:36px minmax(0,1fr) 110px;gap:12px;padding:15px 6px;border-bottom:1px solid var(--border-soft);align-items:start}
.row:last-child{border-bottom:none}
.rank{color:var(--dim);font-variant-numeric:tabular-nums;font-size:15px;font-weight:600;text-align:right;padding-top:1px}
.repo-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.repo{font-weight:600;font-size:15px}
.tags{display:inline-flex;gap:5px}
.tag{font-size:11px;color:var(--warn);border:1px solid rgba(210,153,34,.45);border-radius:999px;padding:1px 8px;white-space:nowrap}
.tag.returning{color:var(--accent);border-color:rgba(88,166,255,.45)}
.desc{color:var(--dim);font-size:13px;margin-top:4px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.meta-line{color:var(--dim);font-size:12px;margin-top:7px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.meta-line .sep{opacity:.6}
.lang{display:inline-flex;align-items:center;gap:5px}
.lang i{width:10px;height:10px;border-radius:50%;display:inline-block;background:#8b949e;flex:none}
.streak{color:#d29922}
.delta{text-align:right;padding-top:1px}
.delta .v{font-size:17px;font-weight:700;color:var(--up);font-variant-numeric:tabular-nums}
.delta .v.down{color:var(--down)}
.delta .l{font-size:11px;color:var(--dim);margin-top:3px}
.newcomers{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin-top:4px}
.newcomer{border:1px solid var(--border-soft);border-radius:8px;padding:10px 12px;background:rgba(13,17,23,.55)}
.newcomer .repo{font-size:13px}
.newcomer .desc{font-size:12px}
.newcomer .m{color:var(--dim);font-size:11px;margin-top:3px}
.panel{border:1px solid var(--border-soft);border-radius:12px;background:var(--panel);padding:22px}
.panel.empty{color:var(--dim);font-size:13px;text-align:center}
.note{color:var(--dim);font-size:12px;margin-top:16px;line-height:1.8}
footer.site{margin-top:38px;padding-top:18px;border-top:1px solid var(--border-soft);color:var(--dim);font-size:12px;line-height:2.1}
@media (max-width:640px){
  .row{grid-template-columns:28px minmax(0,1fr);grid-template-areas:"rank main" "rank delta";row-gap:2px}
  .rank{grid-area:rank}
  .row .main{grid-area:main}
  .delta{grid-area:delta;text-align:left}
  .desc{-webkit-line-clamp:3}
}
`
