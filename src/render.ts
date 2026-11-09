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
    .map(
      (entry) => `<div class="newcomer">
  <a class="repo" href="${REPO_URL}${escapeHtml(entry.fullName)}" target="_blank" rel="noopener">${escapeHtml(entry.fullName)}</a>
  <div class="m">首次上榜 ${escapeHtml(entry.firstSeen)} · ${fmt.format(entry.stars)} ★</div>
</div>`,
    )
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
    <h1>📊 GitHub Trending 周榜 · 年榜</h1>
    <p class="sub">GitHub Trending 的周排行 / 年度排行 · 只看变化量，不做历史快照</p>
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
