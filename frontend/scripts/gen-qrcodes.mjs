// 批量生成每间客房的点评二维码 + 下载页
// 用法：node scripts/gen-qrcodes.mjs
// 换域名 / 换酒店名时不必改代码，用环境变量覆盖后重跑即可：
//   SITE_BASE=https://review.xxx.com HOTEL_NAME=某某酒店 node scripts/gen-qrcodes.mjs
// 生成完记得 npm run deploy 推上线。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const PUBLIC = path.join(ROOT, 'public')
const OUT_DIR = path.join(PUBLIC, 'qrcodes')
const ROOMS_FILE = path.join(__dirname, 'rooms.txt')

// ★ 部署后的前端地址（GitHub Pages 测试期）。换客户自有域名时用 SITE_BASE 环境变量覆盖。
const SITE_BASE = (process.env.SITE_BASE || 'https://wx277282356.github.io/hotel-review-v2').replace(/\/+$/, '')
// ★ 酒店名称，仅影响下载页的标题文字（二维码本身只含房间号，与名称无关）。
//   应与后台「站点设置」里的酒店名称保持一致。
const HOTEL_NAME = process.env.HOTEL_NAME || '城市酒店'

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function readRooms() {
  const raw = fs.readFileSync(ROOMS_FILE, 'utf-8')
  return raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
}

function buildDownloadPage(rooms) {
  const name = escapeHtml(HOTEL_NAME)
  const cards = rooms.map(r => `
    <div class="card">
      <div class="room">${escapeHtml(r)}</div>
      <img src="./${r}.png" alt="房间 ${escapeHtml(r)} 点评二维码" />
      <a class="dl" href="./${r}.png" download>⬇ 下载</a>
    </div>`).join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${name} · 客房评价二维码下载</title>
<style>
  body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:0;background:#f5f3ee;color:#333;}
  header{padding:18px 20px;background:#fff;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;}
  h1{font-size:1.1rem;margin:0;color:#a07d1f;}
  .tip{font-size:.82rem;color:#888;}
  button{padding:8px 16px;border:1px solid #c9a84c;background:#fff;color:#a07d1f;border-radius:8px;cursor:pointer;font-size:.85rem;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;padding:18px;}
  .card{background:#fff;border:1px solid #eee;border-radius:12px;padding:12px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.05);}
  .room{font-weight:700;font-size:1.05rem;margin-bottom:8px;color:#444;}
  .card img{width:130px;height:130px;object-fit:contain;}
  .dl{display:inline-block;margin-top:8px;font-size:.8rem;color:#a07d1f;text-decoration:none;}
  @media print{
    header button{display:none;}
    body{background:#fff;}
    .card{box-shadow:none;border:1px solid #ccc;break-inside:avoid;}
  }
</style>
</head>
<body>
  <header>
    <div>
      <h1>${name} · 客房评价二维码</h1>
      <div class="tip">共 ${rooms.length} 间 · 扫码即进入该房间点评页 · 可批量打印后裁剪贴于客房</div>
    </div>
    <button onclick="window.print()">🖨 打印全部</button>
  </header>
  <div class="grid">${cards}</div>
</body>
</html>`
}

async function main() {
  const rooms = readRooms()
  fs.mkdirSync(OUT_DIR, { recursive: true })

  for (const r of rooms) {
    const url = `${SITE_BASE}/?room=${encodeURIComponent(r)}`
    await QRCode.toFile(path.join(OUT_DIR, `${r}.png`), url, {
      width: 420,
      margin: 2,
      color: { dark: '#1a1a1a', light: '#ffffff' }
    })
  }

  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), buildDownloadPage(rooms), 'utf-8')
  console.log(`✅ 已生成 ${rooms.length} 个房间二维码 + 下载页 -> public/qrcodes/`)
}

main().catch(e => { console.error(e); process.exit(1) })
