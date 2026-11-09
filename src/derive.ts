import fs from "fs/promises"
import path from "path"

/**
 * 指标计算层（derived layer）
 *
 * 输入：archive/repository|developer/YYYY/YYYY-MM-DD/*.json 每日快照
 * 输出：dist/data/*.json 指标与榜单（供站点渲染 + JSON API 消费）
 *
 * 口径：
 * - 实体按 fullName 去重合并（全语言视图优先，语言视图补充）
 * - 增量 = 最新快照 − N 天前基线快照
 * - 增速 = 增量 ÷ 当前 Star 总量
 * - 在榜连续性：连续在榜天数 / 首次出现 / 回归（中断 ≥7 天再出现）
 */

export type WindowKey = "1d" | "7d" | "30d"

export const WINDOW_DAYS: Record<WindowKey, number> = { "1d": 1, "7d": 7, "30d": 30 }
const WINDOW_KEYS: WindowKey[] = ["1d", "7d", "30d"]

/** 最近 7 天内首次出现 → 新上榜 */
const NEWCOMER_WITHIN_DAYS = 6
/** 中断 ≥7 天再出现 → 回归 */
const RETURNING_AFTER_DAYS = 7
/** 榜单展示条数 */
export const TOP_N = 20

// ---------- 类型 ----------

type RawRepositoryItem = {
  rank: number
  fullName: string
  description: string
  language: string
  languageColor: string
  stars: number
  forks: number
  starsToday: number
}

type RawDeveloperItem = {
  rank: number
  username: string
  name: string
  avatar: string
  repoName: string
  repoDescription: string
}

/** 单日某仓库的卡片数据 */
type DayEntry = { rank: number; stars: number; forks: number }

type RepoRecord = {
  fullName: string
  description: string
  language: string
  languageColor: string
  days: Record<string, DayEntry>
}

/** 单日某仓库的卡片 + 展示元数据 */
type RepositoryDaySlice = {
  entry: DayEntry
  description: string
  language: string
  languageColor: string
}

type DeveloperRecord = {
  username: string
  name: string
  avatar: string
  repoName: string
  repoDescription: string
  days: Record<string, number> // date -> rank
}

// ---------- 日期工具（全部按 UTC 计算，避免时区污染数据口径） ----------

function parseDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number)
  return Date.UTC(y, m - 1, d)
}

function formatDay(ms: number): string {
  const d = new Date(ms)
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-")
}

export function addDays(day: string, delta: number): string {
  return formatDay(parseDay(day) + delta * 86_400_000)
}

// ---------- 归档读取 ----------

async function findDays(type: "repository" | "developer"): Promise<string[]> {
  const root = path.join(process.cwd(), "archive", type)
  const days: string[] = []
  const yearDirs = await fs.readdir(root, { withFileTypes: true })
  for (const yearDir of yearDirs) {
    if (!yearDir.isDirectory()) continue
    const dayDirs = await fs.readdir(path.join(root, yearDir.name), { withFileTypes: true })
    for (const dayDir of dayDirs) {
      if (dayDir.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(dayDir.name)) {
        days.push(dayDir.name)
      }
    }
  }
  return days.sort()
}

/**
 * 读取某一天的仓库榜（并集）：
 * 全语言视图（(null).json）的 rank 更权威，最先并入；其余语言视图补充。
 */
async function loadRepositoryDay(typeRoot: string, day: string): Promise<Map<string, RepositoryDaySlice>> {
  const dayDir = path.join(typeRoot, day.slice(0, 4), day)
  const files = (await fs.readdir(dayDir)).filter((f) => f.endsWith(".json"))
  const ordered = files.sort((a, b) => {
    if (a === "(null).json") return -1
    if (b === "(null).json") return 1
    return a.localeCompare(b)
  })
  const result = new Map<string, RepositoryDaySlice>()
  for (const file of ordered) {
    const payload = JSON.parse(
      await fs.readFile(path.join(dayDir, file), "utf-8"),
    ) as { list?: RawRepositoryItem[] }
    for (const item of payload.list ?? []) {
      if (!item.fullName) continue
      if (result.has(item.fullName)) continue
      result.set(item.fullName, {
        entry: { rank: item.rank, stars: item.stars, forks: item.forks },
        description: item.description ?? "",
        language: item.language ?? "",
        languageColor: item.languageColor ?? "",
      })
    }
  }
  return result
}

async function loadDeveloperDay(
  typeRoot: string,
  day: string,
): Promise<Map<string, { rank: number; name: string; avatar: string; repoName: string; repoDescription: string }>> {
  const dayDir = path.join(typeRoot, day.slice(0, 4), day)
  const files = (await fs.readdir(dayDir)).filter((f) => f.endsWith(".json"))
  const ordered = files.sort((a, b) => {
    if (a === "(null).json") return -1
    if (b === "(null).json") return 1
    return a.localeCompare(b)
  })
  const result = new Map<string, { rank: number; name: string; avatar: string; repoName: string; repoDescription: string }>()
  for (const file of ordered) {
    const payload = JSON.parse(
      await fs.readFile(path.join(dayDir, file), "utf-8"),
    ) as { list?: RawDeveloperItem[] }
    for (const item of payload.list ?? []) {
      if (!item.username) continue
      if (result.has(item.username)) continue
      result.set(item.username, {
        rank: item.rank,
        name: item.name ?? "",
        avatar: item.avatar ?? "",
        repoName: item.repoName ?? "",
        repoDescription: item.repoDescription ?? "",
      })
    }
  }
  return result
}

// ---------- 指标计算 ----------

export type DeltaInfo = {
  baselineDate: string
  baseline: number
  forksBaseline: number
  delta: number
  forksDelta: number
  rate: number
}

export type RepoMetrics = {
  fullName: string
  description: string
  language: string
  languageColor: string
  rank: number | null
  stars: number
  forks: number
  firstSeen: string
  presenceDays: number
  consecutiveDays: number
  lastGapDays: number | null
  isNew: boolean
  isReturning: boolean
  deltas: Record<WindowKey, DeltaInfo | null>
}

export type RankingEntry = {
  rank: number | null
  fullName: string
  description: string
  language: string
  languageColor: string
  stars: number
  forks: number
  starsDelta: number | null
  forksDelta: number | null
  growthRate: number | null
  baselineDate: string | null
  firstSeen: string
  presenceDays: number
  consecutiveDays: number
  lastGapDays: number | null
  tags: string[]
}

export type RankingWindow = {
  window: WindowKey
  windowDays: number
  available: boolean
  latestDate: string
  baselineDate: string | null
  generatedAt: string
  candidateCount: number
  items: RankingEntry[]
  newcomers: RankingEntry[]
}

export type DeveloperEntry = {
  rank: number
  username: string
  name: string
  avatar: string
  repoName: string
  repoDescription: string
  firstSeen: string
  presenceDays: number
  consecutiveDays: number
  lastGapDays: number | null
  isNew: boolean
  isReturning: boolean
}

export type DerivedData = {
  generatedAt: string
  latestDate: string
  /** 仓库维度已采集的天数 */
  daysAvailable: number
  /** 全部可用日期（仓库 ∪ 开发者） */
  dates: string[]
  repos: RepoMetrics[]
  rankings: Record<WindowKey, RankingWindow>
  developers: DeveloperEntry[]
}

// ---------- 内部构建 ----------

async function buildRepositoryTimeline(): Promise<{ dates: string[]; records: Map<string, RepoRecord> }> {
  const root = path.join(process.cwd(), "archive", "repository")
  const dates = await findDays("repository")
  const records = new Map<string, RepoRecord>()
  for (const day of dates) {
    const slice = await loadRepositoryDay(root, day)
    for (const [fullName, value] of slice) {
      let record = records.get(fullName)
      if (!record) {
        record = {
          fullName,
          description: value.description,
          language: value.language,
          languageColor: value.languageColor,
          days: {},
        }
        records.set(fullName, record)
      }
      record.days[day] = value.entry
    }
  }
  return { dates, records }
}

async function buildDeveloperTimeline(): Promise<{ dates: string[]; records: Map<string, DeveloperRecord> }> {
  const root = path.join(process.cwd(), "archive", "developer")
  const dates = await findDays("developer")
  const records = new Map<string, DeveloperRecord>()
  for (const day of dates) {
    const slice = await loadDeveloperDay(root, day)
    for (const [username, value] of slice) {
      let record = records.get(username)
      if (!record) {
        record = {
          username,
          name: value.name,
          avatar: value.avatar,
          repoName: value.repoName,
          repoDescription: value.repoDescription,
          days: {},
        }
        records.set(username, record)
      }
      // 展示信息以最新一天为准
      record.name = value.name
      record.avatar = value.avatar
      record.repoName = value.repoName
      record.repoDescription = value.repoDescription
      record.days[day] = value.rank
    }
  }
  return { dates, records }
}

/** 在档天数、连续在榜、中断天数、新老标签 */
function presenceStats<V>(
  days: Record<string, V>,
  dates: string[],
  latestDate: string,
): {
  firstSeen: string
  presenceDays: number
  consecutiveDays: number
  lastGapDays: number | null
  isNew: boolean
  isReturning: boolean
} {
  const presentDates = dates.filter((d) => days[d] !== undefined)
  const firstSeen = presentDates[0] ?? latestDate
  const presenceDays = presentDates.length

  let consecutiveDays = 0
  let cursor = latestDate
  while (days[cursor] !== undefined) {
    consecutiveDays++
    cursor = addDays(cursor, -1)
  }

  let lastGapDays: number | null = null
  if (consecutiveDays > 0) {
    const streakStart = addDays(latestDate, -(consecutiveDays - 1))
    const before = presentDates.filter((d) => d < streakStart)
    if (before.length > 0) {
      const lastBefore = before[before.length - 1]
      lastGapDays = Math.round((parseDay(streakStart) - parseDay(lastBefore)) / 86_400_000)
    }
  }

  return {
    firstSeen,
    presenceDays,
    consecutiveDays,
    lastGapDays,
    isNew: firstSeen >= addDays(latestDate, -NEWCOMER_WITHIN_DAYS),
    isReturning: lastGapDays !== null && lastGapDays >= RETURNING_AFTER_DAYS,
  }
}

function computeRepoMetrics(record: RepoRecord, dates: string[], latestDate: string): RepoMetrics {
  const presence = presenceStats(record.days, dates, latestDate)
  const latest = record.days[latestDate]

  const deltas = {} as Record<WindowKey, DeltaInfo | null>
  for (const window of WINDOW_KEYS) {
    const baselineDate = addDays(latestDate, -WINDOW_DAYS[window])
    const baseline = record.days[baselineDate]
    deltas[window] =
      latest && baseline
        ? {
            baselineDate,
            baseline: baseline.stars,
            forksBaseline: baseline.forks,
            delta: latest.stars - baseline.stars,
            forksDelta: latest.forks - baseline.forks,
            rate: (latest.stars - baseline.stars) / latest.stars,
          }
        : null
  }

  return {
    fullName: record.fullName,
    description: record.description,
    language: record.language,
    languageColor: record.languageColor,
    rank: latest ? latest.rank : null,
    stars: latest ? latest.stars : 0,
    forks: latest ? latest.forks : 0,
    firstSeen: presence.firstSeen,
    presenceDays: presence.presenceDays,
    consecutiveDays: presence.consecutiveDays,
    lastGapDays: presence.lastGapDays,
    isNew: presence.isNew,
    isReturning: presence.isReturning,
    deltas,
  }
}

function tagsOf(m: { isNew: boolean; isReturning: boolean }): string[] {
  const tags: string[] = []
  if (m.isNew) tags.push("新上榜")
  if (m.isReturning) tags.push("回归")
  return tags
}

function toEntry(m: RepoMetrics, window: WindowKey, rank: number | null): RankingEntry {
  const delta = m.deltas[window]
  return {
    rank,
    fullName: m.fullName,
    description: m.description,
    language: m.language,
    languageColor: m.languageColor,
    stars: m.stars,
    forks: m.forks,
    starsDelta: delta ? delta.delta : null,
    forksDelta: delta ? delta.forksDelta : null,
    growthRate: delta ? delta.rate : null,
    baselineDate: delta ? delta.baselineDate : null,
    firstSeen: m.firstSeen,
    presenceDays: m.presenceDays,
    consecutiveDays: m.consecutiveDays,
    lastGapDays: m.lastGapDays,
    tags: tagsOf(m),
  }
}

function buildRankingWindow(
  window: WindowKey,
  dates: string[],
  latestDate: string,
  repos: RepoMetrics[],
): RankingWindow {
  const daySet = new Set(dates)
  const baselineDate = addDays(latestDate, -WINDOW_DAYS[window])
  const available = daySet.has(baselineDate)

  const withBaseline = repos.filter((m) => m.deltas[window] !== null)
  const newcomers = repos.filter(
    (m) =>
      m.deltas[window] === null && m.firstSeen >= addDays(latestDate, -(WINDOW_DAYS[window] - 1)),
  )

  withBaseline.sort((a, b) => {
    const da = a.deltas[window] as DeltaInfo
    const db = b.deltas[window] as DeltaInfo
    return db.delta - da.delta || b.stars - a.stars
  })
  const items = withBaseline.map((m, i) => toEntry(m, window, i + 1))

  newcomers.sort((a, b) =>
    a.firstSeen < b.firstSeen ? -1 : a.firstSeen > b.firstSeen ? 1 : b.stars - a.stars,
  )
  const newcomerEntries = newcomers.map((m) => toEntry(m, window, null))

  return {
    window,
    windowDays: WINDOW_DAYS[window],
    available,
    latestDate,
    baselineDate: available ? baselineDate : null,
    generatedAt: new Date().toISOString(),
    candidateCount: repos.length,
    items,
    newcomers: newcomerEntries,
  }
}

function buildDeveloperEntries(
  dates: string[],
  latestDate: string,
  records: Map<string, DeveloperRecord>,
): DeveloperEntry[] {
  const entries: DeveloperEntry[] = []
  for (const record of records.values()) {
    const rank = record.days[latestDate]
    if (rank === undefined) continue
    const presence = presenceStats(record.days, dates, latestDate)
    entries.push({
      rank,
      username: record.username,
      name: record.name,
      avatar: record.avatar,
      repoName: record.repoName,
      repoDescription: record.repoDescription,
      firstSeen: presence.firstSeen,
      presenceDays: presence.presenceDays,
      consecutiveDays: presence.consecutiveDays,
      lastGapDays: presence.lastGapDays,
      isNew: presence.isNew,
      isReturning: presence.isReturning,
    })
  }
  entries.sort((a, b) => a.rank - b.rank)
  return entries
}

// ---------- 写出 ----------

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(payload), "utf-8")
}

/**
 * 计算全部指标并写出 dist/data/*.json，返回内存副本供渲染层使用。
 */
export async function derive(): Promise<DerivedData> {
  const generatedAt = new Date().toISOString()

  const { dates: repositoryDates, records } = await buildRepositoryTimeline()
  if (repositoryDates.length === 0) {
    throw new Error("仓库归档为空，无法生成指标")
  }
  const latestDate = repositoryDates[repositoryDates.length - 1]

  // 候选 = 最新一天榜单上的全部仓库（并集）
  const latestSlice = await loadRepositoryDay(path.join(process.cwd(), "archive", "repository"), latestDate)
  const sliceNames = [...latestSlice.keys()]
  const repos: RepoMetrics[] = sliceNames.map((fullName) => {
    const record = records.get(fullName)
    if (!record) throw new Error(`缺少仓库时间线记录: ${fullName}`)
    return computeRepoMetrics(record, repositoryDates, latestDate)
  })

  const rankings = {} as Record<WindowKey, RankingWindow>
  for (const window of WINDOW_KEYS) {
    rankings[window] = buildRankingWindow(window, repositoryDates, latestDate, repos)
  }

  const { dates: developerDates, records: developerRecords } = await buildDeveloperTimeline()
  const developers = buildDeveloperEntries(developerDates, latestDate, developerRecords)

  const data: DerivedData = {
    generatedAt,
    latestDate,
    daysAvailable: repositoryDates.length,
    dates: [...new Set([...repositoryDates, ...developerDates])].sort(),
    repos,
    rankings,
    developers,
  }

  const dataDir = path.join(process.cwd(), "dist", "data")
  await writeJson(path.join(dataDir, "meta.json"), {
    generatedAt: data.generatedAt,
    latestDate: data.latestDate,
    daysAvailable: data.daysAvailable,
    dates: data.dates,
    windows: {
      "1d": { available: rankings["1d"].available, baselineDate: rankings["1d"].baselineDate },
      "7d": { available: rankings["7d"].available, baselineDate: rankings["7d"].baselineDate },
      "30d": { available: rankings["30d"].available, baselineDate: rankings["30d"].baselineDate },
    },
    repoCount: data.repos.length,
    developerCount: data.developers.length,
  })
  await writeJson(path.join(dataDir, "repositories.json"), {
    generatedAt: data.generatedAt,
    latestDate: data.latestDate,
    count: data.repos.length,
    items: data.repos,
  })
  for (const window of WINDOW_KEYS) {
    await writeJson(path.join(dataDir, `rank-${window}.json`), rankings[window])
  }
  await writeJson(path.join(dataDir, "developers.json"), {
    generatedAt: data.generatedAt,
    latestDate: data.latestDate,
    count: data.developers.length,
    items: data.developers,
  })

  const summary = Object.entries(rankings)
    .map(([key, r]) => `${key}:${r.available ? "on" : "off"}(${r.items.length})`)
    .join(" ")
  console.log(`derive ok — ${latestDate}, ${data.daysAvailable} 天, ${repos.length} 个候选; ${summary}`)

  return data
}
