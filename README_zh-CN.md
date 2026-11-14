<div align="center">

# 📊 GitHub Trending 周榜 · 年榜

**GitHub Trending 的周排行 / 年度排行 · 不做历史快照，只看变化量。**

[English](README.md)

</div>

## 简介

每天自动采集 [GitHub Trending](https://github.com/trending)，只按「增量」排名——Star / Fork 在 1 日 / 7 日 / 30 日窗口内的增长量决定一切，历史总量再大也不占优。

整个项目零运维：**数据**是 git 仓库里的 JSON 快照（版本化、可完整重算）；**站点**由 GitHub Actions 每天构建并部署到 GitHub Pages；同时开放 **JSON API** 供 Bot / 其他页面消费。

---

> 🚧 首版进行中：采集与指标管线已上线，站点可访问（当前为数据积累期，先展示 1 日增量；周榜将于 2026-11-14 前后自动上线）。

**站点**：<https://junze-xu.github.io/github-trending-rank/>（JSON API 入口见站点页脚）

## 定位

| | |
|---|---|
| 📅 **周排行** | 本周新增 Star / Fork / 提交最多的项目 |
| 📆 **年度排行** | 全年累计增长、在榜次数最多的项目 |
| 🧭 **维度筛选** | 语言、分类、新老项目 |
| 🤖 **JSON API** | 公开数据出口，供 Bot / 其他页面消费 |

## 核心指标（只看"变化量"，不看历史总量）

- **Star / Fork 差分**：日前值、7 日 / 30 日增量与增速（增量 ÷ 当前总量）
- **在榜连续性**：连续在榜天数、首次上榜、回归
- **聚合视图**：语言榜、分类榜（AI / Agent、前端、DevOps…）
- 老项目**历史总量再大也不占优**——榜单由增量决定，语言是维度之一

## 数据流

```
每日快照（src/scraper 采集器，GitHub Actions 定时）
     ↓ 跨天差分（src/derive.ts）
周 / 月 / 年指标（dist/data/*.json）
     ↓ 渲染（src/render.ts）
站点页面 + JSON API → GitHub Pages（junze-xu.github.io/github-trending-rank）
```

## 目录

| 路径 | 用途 |
|------|------|
| `src/scraper/` | GitHub Trending 采集器（TypeScript + Puppeteer + Bottleneck） |
| `src/derive.ts` | 指标计算层：跨天差分、在榜连续性、榜单 |
| `src/render.ts` | 站点渲染层：静态 HTML（深色、零依赖）+ JSON API |
| `src/build.ts` | 构建入口（derive → render） |
| `archive/` | 每日快照（原始数据，从 2026-11-07 起累计） |
| `dist/` | 构建产物（不入库；由 CI 生成并部署到 Pages） |
| `.github/workflows/` | Actions：scrape（每小时）+ build（采集完成后） |

## 路线图

- [x] 旧产物清理与项目命名（github-trending-rank，2026-11-07 起）
- [x] 指标计算层 + JSON API（`src/derive.ts`，2026-11-08）
- [x] 站点初版 + Pages 部署管线（2026-11-08，数据积累期先展示 1 日增量）
- [ ] 首版周榜（数据满 7 天后自动就绪，预计 2026-11-14）
- [ ] 语言榜 / 分类榜与维度筛选
- [ ] 提交趋势接入（GitHub API）

## 说明

周 / 年排行需要从头积累数据：2026-11-08 起可算"1 日增量"；11-13 数据满 7 天，11-14 前后自动产出首版周榜；年度榜在数据积累满一年后启用。
