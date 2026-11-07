import type { Page } from "puppeteer"
import fs from "fs/promises"

export type DeveloperLanguage = {
  label: string
  slug: string
  url: string
}

export type Developer = {
  /** Position in the trending list (starts from 1). */
  rank: number
  /** Developer username, e.g. "torvalds". */
  username: string
  /** Display name, e.g. "Linus Torvalds" (empty string if not provided). */
  name: string
  /** Avatar URL. */
  avatar: string
  /** Full name of the highlighted repository, e.g. "torvalds/linux" (empty string if not provided). */
  repoName: string
  /** Description of the highlighted repository (empty string if not provided). */
  repoDescription: string
}

const PageUrl = "https://github.com/trending/developers?since=daily"

const DEVELOPER_ROW_SELECTOR = 'article.Box-row'

export class TrendingDeveloperPage {
  private constructor(
      private page: Page,
  ) {}

  static async from(
    page: Page,
    url = PageUrl,
    retry = 0,
  ): Promise<TrendingDeveloperPage> {
    await page.goto(url, { waitUntil: "networkidle2" })
    try {
      await page.waitForSelector(DEVELOPER_ROW_SELECTOR, { timeout: 5_000 })
    } catch {
      /**
       * There are no trending developers for this language today.
       */
      if (await page.$(".blankslate")) {
        return new TrendingDeveloperPage(page)
      }
      /**
       * To slip pass the abuse detection.
       */
      await new Promise((resolve) => setTimeout(resolve, 10_000))
      await fs.mkdir('./debug', { recursive: true })
      const language = `${new URL(url).pathname.split("/").at(-1)}`
      await page.screenshot({
        path: `./debug/${language}-retry-${retry}.png`,
      })
      if (retry > 2) {
        throw new Error(`Retry limit exceeded for language ${language}`)
      }
      return TrendingDeveloperPage.from(page, url, retry + 1)
    }
    return new TrendingDeveloperPage(page)
  }

  async getDeveloperLanguageList(): Promise<DeveloperLanguage[]> {
    return this.page
      .$$eval('#languages-menuitems [role="menuitemradio"]', (elements) =>
        elements.map((element) => {
          const url = (element as HTMLAnchorElement).href
          const [slug] = new URL(url).pathname.split("/").slice(-1)
          return {
            label: element.textContent!.trim(),
            slug,
            url,
          }
        })
      )
      .then((result) => [{ url: PageUrl, label: "", slug: "" }].concat(result))
  }

  async getDeveloperList(): Promise<Developer[]> {
    return this.page.$$eval(DEVELOPER_ROW_SELECTOR, (elements) => {
      /**
       * `$$eval` serializes the callback and runs it inside the browser,
       * so any helper must be declared within the callback body.
       */
      const cleanFullName = (href: string): string =>
        href.startsWith("/") ? href.slice(1) : href

      return elements.map((element, index) => {
        /**
         * Each card contains a nested "Popular repo" sub-card with its own
         * `<h1>`. Always pick the first `<h1>` in the document order,
         * which belongs to the developer.
         */
        const nameLink = element.querySelector<HTMLAnchorElement>("h1 a")
        const href = nameLink?.getAttribute("href") ?? null

        if (href === null) {
          throw Error("Cannot find URL of the developer")
        }

        const username = cleanFullName(href)
        const name = nameLink?.textContent?.trim() ?? ""

        const avatar = element.querySelector<HTMLImageElement>("img.avatar-user")?.src ?? ""

        const repoArticle = element.querySelector<HTMLElement>("article")
        const repoLink = repoArticle?.querySelector<HTMLAnchorElement>("h1 a")
        const repoHref = repoLink?.getAttribute("href") ?? null
        const repoName = repoHref === null ? "" : cleanFullName(repoHref)

        /**
         * The nested sub-card contains a "Popular repo" caption <div>
         * followed by the repository description <div> — it is always
         * the last one.
         */
        const repoDivs = Array.from(repoArticle?.querySelectorAll("div") ?? [])
        const repoDescription = (repoDivs[repoDivs.length - 1]?.textContent ?? "").trim()

        return {
          rank: index + 1,
          username,
          name,
          avatar,
          repoName,
          repoDescription,
        }
      })
    })
  }

  close() {
    return this.page.close()
  }
}
