// ============================================================
//  旧系统评价 → 新 PostgreSQL 迁移脚本（保留原始提交时间）
//  用法：node scripts/migrate-from-old.mjs <导出的json文件>
//  连接串来源（按优先级）：
//    1) 环境变量 PG_CONNECTION=postgresql://用户:密码@主机:5432/库
//    2) backend/appsettings.Local.json 的 ConnectionStrings:DefaultConnection
//  （本文件不含任何密码，可安全提交到公开仓库）
//  说明：
//   - 直接写库（不走 /api/review），以便保留每条评价真实的 createdAt
//   - 旧 type 取值 positive/negative 与新库一致；good/bad 会自动归一化
//   - 同一设备导出的 json 只需导入一次；多台设备各自导、各自导一次
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

const file = process.argv[2]
if (!file) {
  console.error('用法：node scripts/migrate-from-old.mjs <导出的json文件>')
  process.exit(1)
}

// 把 .NET 风格的连接串（Host=..;Port=..;Database=..;Username=..;Password=..）
// 转成 node-postgres 需要的格式
function toPgConnection(str) {
  const kv = {}
  for (const part of str.split(';')) {
    const i = part.indexOf('=')
    if (i > 0) kv[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim()
  }
  return {
    host: kv.host || 'localhost',
    port: Number(kv.port || 5432),
    database: kv.database || 'hotel_review',
    user: kv.username || kv.user || 'postgres',
    password: kv.password || ''
  }
}

function resolveConnection() {
  if (process.env.PG_CONNECTION) {
    return { connectionString: process.env.PG_CONNECTION }
  }
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const localCfg = path.resolve(__dirname, '../../backend/appsettings.Local.json')
  if (!fs.existsSync(localCfg)) {
    console.error('未找到 backend/appsettings.Local.json，也没有 PG_CONNECTION 环境变量。')
    console.error('请先按《部署与运维说明》配置后端本地密钥文件。')
    process.exit(1)
  }
  const cfg = JSON.parse(fs.readFileSync(localCfg, 'utf-8'))
  const cs = cfg?.ConnectionStrings?.DefaultConnection
  if (!cs || cs.includes('CHANGE_ME')) {
    console.error('backend/appsettings.Local.json 里的连接串未配置好。')
    process.exit(1)
  }
  return toPgConnection(cs)
}

const conn = resolveConnection()

function normalizeType(t) {
  if (t === 'positive' || t === 'good') return 'positive'
  if (t === 'negative' || t === 'bad') return 'negative'
  return 'positive'
}

function loadReviews(path) {
  const raw = JSON.parse(fs.readFileSync(path, 'utf-8'))
  if (Array.isArray(raw)) return raw
  if (raw && Array.isArray(raw.reviews)) return raw.reviews
  throw new Error('JSON 结构无法识别：既不是数组也不是 {reviews:[...]}')
}

async function main() {
  const reviews = loadReviews(file)
  console.log(`读取旧评价 ${reviews.length} 条，开始导入...`)

  const client = new pg.Client(conn)
  await client.connect()

  const sql = `INSERT INTO "Reviews" ("Id", "Type", "Reasons", "Room", "StaffUsername", "CreatedAt")
               VALUES ($1, $2, $3, $4, $5, $6)`
  let ok = 0, skip = 0
  for (const r of reviews) {
    const reasons = Array.isArray(r.reasons) ? r.reasons.map(String) : []
    const room = (r.room === undefined || r.room === null || r.room === '')
      ? null : String(r.room)
    const staff = r.staffUsername || r.staffName || null
    const createdAt = r.createdAt ? new Date(r.createdAt) : new Date()
    if (isNaN(createdAt.getTime())) {
      console.warn(`  跳过一条无效时间：${JSON.stringify(r)}`)
      skip++; continue
    }
    await client.query(sql, [
      randomUUID(),
      normalizeType(r.type),
      reasons,            // pg 会自动把 JS string[] 写成 text[]
      room,
      staff,
      createdAt,
    ])
    ok++
  }
  await client.end()
  console.log(`✅ 导入完成：成功 ${ok} 条，跳过 ${skip} 条`)
  console.log('   可在后台页 ?admin=1 登录查看汇总，或 GET /api/reviews?token=<你的登录令牌> 校验。')
}

main().catch(e => { console.error('迁移失败：', e.message); process.exit(1) })
