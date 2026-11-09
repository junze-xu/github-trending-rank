import { derive } from "./derive"
import { render } from "./render"

/**
 * 构建入口：指标计算 → 站点渲染（dist/index.html + dist/data/*.json）
 *
 * 本地：npm run build
 * CI：.github/workflows/build.yml（采集完成后自动执行）
 */
async function main() {
  const data = await derive()
  await render(data)
  console.log(`build done — dist/index.html, latest ${data.latestDate}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e)
  process.exit(1)
})
