import { derive } from "./derive"
import { render } from "./render"
import fs from "fs"
import path from "path"

/**
 * 构建入口：指标计算 → 站点渲染（dist/index.html + dist/data/*.json + dist 静态资源）
 *
 * 本地：npm run build
 * CI：.github/workflows/build.yml（采集完成后自动执行）
 */
async function main() {
  const data = await derive()
  await render(data)
  // 复制静态资源（二维码 / robots.txt / sitemap.xml）到 dist
  const assetsDir = path.join(process.cwd(), "src", "assets")
  for (const file of ["qrcode-official-account.jpg", "wechat-junze.jpg", "robots.txt", "sitemap.xml"]) {
    fs.copyFileSync(path.join(assetsDir, file), path.join(process.cwd(), "dist", file))
  }
  console.log(`build done — dist/index.html, latest ${data.latestDate}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e)
  process.exit(1)
})
