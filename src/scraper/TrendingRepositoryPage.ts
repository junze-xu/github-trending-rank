import type { Page } from "puppeteer"
import fs from "fs/promises"

export type RepositoryLanguage = {
  label: string
  slug: string
  url: string
}

export type Repository = {
  /** Position in the trending list (starts from 1). */
  rank: number
  /** Full name of the repository, e.g. "zed-industries/zed". */
  fullName: string
  /** Repository description (empty string if not provided). */
  description: string
  /** Primary programming language (empty string if not detected). */
  language: string
  /** GitHub language color, e.g. "#dea584" (empty string if not detected). */
  languageColor: string
  /** Total number of stars. */
  stars: number
  /** Total number of forks. */
  forks: number
  /** Number of stars gained today. */
  starsToday: number
}

const PageUrl = "https://github.com/trending?since=daily"

export class TrendingRepositoryPage {
  private constructor(
      private page: Page,
  ) {}

  static async from(
    page: Page,
    url = PageUrl,
    retry = 0,
  ): Promise<TrendingRepositoryPage> {
    await page.goto(url, { waitUntil: "networkidle2" })
    try {
      await page.waitForSelector("article", { timeout: 5_000 })
    } catch {
      /**
       * There are no trending repositories for this language today.
       */
      if (await page.$(".blankslate")) {
        return new TrendingRepositoryPage(page)
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
      return TrendingRepositoryPage.from(page, url, retry + 1)
    }
    return new TrendingRepositoryPage(page)
  }

  async getRepositoryLanguageList(): Promise<RepositoryLanguage[]> {
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

  async getRepositoryList(): Promise<Repository[]> {
    return this.page.$$eval("article", (elements) => {
      /**
       * `$$eval` serializes the callback and runs it inside the browser,
       * so any helper must be declared within the callback body.
       */
      const toNumber = (value: string | undefined): number => {
        const match = value?.match(/(\d[\d,]*)/)
        if (!match) {
          return 0
        }
        return Number.parseInt(match[1].replace(/,/g, ""), 10)
      }

      return elements.map((element, index) => {
        const link = element.querySelector<HTMLAnchorElement>("h2 a")
        const href = link?.getAttribute("href") ?? null

        if (href === null) {
          throw Error("Cannot find URL of the repository")
        }

        const fullName = href.startsWith('/') ? href.slice(1) : href

        /**
         * The first <p> of the card is the description.
         * Cards of forked repositories may contain additional <p>,
         * but they always come after the description.
         */
        const description = element.querySelector("p")?.textContent?.trim() ?? ""

        const language = element
          .querySelector('[itemprop="programmingLanguage"]')
          ?.textContent?.trim() ?? ""

        const languageColor = element
          .querySelector(".repo-language-color")
          ?.getAttribute("style")
          ?.match(/background-color:\s*(#[0-9a-fA-F]{3,8})/)?.[1] ?? ""

        const stars = toNumber(
          element.querySelector('a[href$="/stargazers"]')?.textContent ?? undefined,
        )

        const forks = toNumber(
          element.querySelector('a[href$="/forks"]')?.textContent ?? undefined,
        )

        const starsToday = toNumber(
          element.textContent?.match(/([\d,]+)\s*stars?\s*today/i)?.[1],
        )

        return {
          rank: index + 1,
          fullName,
          description,
          language,
          languageColor,
          stars,
          forks,
          starsToday,
        }
      })
    })
  }

  close() {
    return this.page.close()
  }
}
