// ============================================================
//  旧系统评价 → 新 PostgreSQL 迁移脚本（保留原始提交时间）
//
//  ⚠️ 已弃用（2026-09-13）：客户决定不迁移旧数据，新系统从零开始累积统计。
//     本脚本保留仅作技术存档，不再执行。上线前清测试数据请用：
//       node scripts/reset-reviews.mjs --commit
//
//  用法：
//    node scripts/migrate-from-old.mjs <导出的文件>            ← 预演，不写库
//    node scripts/migrate-from-old.mjs <导出的文件> --commit    ← 正式导入
//
//  支持的文件（按扩展名自动识别）：
//    .json —— 浏览器控制台导出（字段最全，时间精确到毫秒）
//    .xlsx —— 旧系统后台「导出 Excel」的明细（任何平板都能导，时间到秒）
//    .csv  —— 上面两种另存为 csv 也能读
//
//  连接串来源（按优先级）：
//    1) 环境变量 PG_CONNECTION=postgresql://用户:密码@主机:5432/库
//    2) backend/appsettings.Local.json 的 ConnectionStrings:DefaultConnection
//  （本文件不含任何密码，可安全提交到公开仓库）
//
//  安全设计：
//   - **默认只预演**，一条数据都不写；必须显式加 --commit 才真正入库
//   - **自动去重**：按 (房间号 | 类型 | 提交时间到秒 | 差评原因) 指纹比对，
//     库里已有的直接跳过 —— 所以同一个文件可以放心重复跑，
//     先导了一部分再补导全量也不会产生重复
//   - **只 INSERT，绝不 UPDATE / DELETE** —— 符合「评价任何人都不可删除」的硬约束
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

// ── 命令行参数 ───────────────────────────────────────────────
const argv = process.argv.slice(2)
const COMMIT = argv.includes('--commit')
const file = argv.find(a => !a.startsWith('--'))

if (!file) {
  console.error('用法：node scripts/migrate-from-old.mjs <导出的文件> [--commit]')
  console.error('      不加 --commit 时只预演，不会写入任何数据。')
  process.exit(1)
}
if (!fs.existsSync(file)) {
  console.error(`找不到文件：${file}`)
  process.exit(1)
}

// ── 连接串 ──────────────────────────────────────────────────
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
  if (process.env.PG_CONNECTION) return { connectionString: process.env.PG_CONNECTION }
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

// ── 归一化 ──────────────────────────────────────────────────
function normalizeType(t) {
  const s = String(t ?? '').trim().toLowerCase()
  if (s === 'positive' || s === 'good' || s === '好评' || s === '好') return 'positive'
  if (s === 'negative' || s === 'bad' || s === '差评' || s === '差') return 'negative'
  return null
}

function normalizeReasons(v) {
  let arr = []
  if (Array.isArray(v)) arr = v.map(String)
  else if (typeof v === 'string') arr = v.split(/[、,，;；|]/)
  const seen = new Set()
  const out = []
  for (const raw of arr) {
    const s = raw.trim()
    if (!s || s === '无' || s === '-') continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

// 「2026-09-01 14:23:05」这种按【本地时间】解析
// （旧系统后台导出用的就是本地时间；ISO 带 Z 的仍按 UTC 解析）
function parseDate(v) {
  if (v instanceof Date) return v
  const s = String(v ?? '').trim()
  if (!s) return null
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (m && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)) {
    return new Date(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      Number(m[4]), Number(m[5]), Number(m[6] || 0)
    )
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

// 统一成内部结构
function toRecord(r) {
  const createdAt = parseDate(r.createdAt ?? r.time ?? r['时间'])
  const type = normalizeType(r.type ?? r['评价类型'])
  return {
    type,
    room: String(r.room ?? r['房间号'] ?? '').trim() || null,
    // 「操作工号」与「员工姓名」是两个字段，别混在一起：
    // 工号是登录账号（按工号统计的分组键），姓名是当时那个人叫什么（明细第二行显示）。
    // 早前版本把姓名当工号兜底，会把姓名显示成工号 —— 现在分开存。
    staffUsername: String(r.staffUsername ?? r['操作工号'] ?? '').trim() || null,
    staffName: String(r.staffName ?? r['员工姓名'] ?? '').trim() || null,
    reasons: normalizeReasons(r.reasons ?? r['差评原因']),
    createdAt,
  }
}

// 去重指纹：房间号 | 类型 | 时间到秒 | 原因（排序后）
// 时间截断到秒是刻意的 —— 让「毫秒精度的 json」与「秒精度的 Excel」能对上
function fingerprint(r) {
  return [
    (r.room || '').toUpperCase(),
    r.type || '',
    r.createdAt ? Math.floor(r.createdAt.getTime() / 1000) : 'x',
    [...r.reasons].sort().join('|'),
  ].join('#')
}

// ── 三种格式的读取 ──────────────────────────────────────────
function loadJson(p) {
  const raw = JSON.parse(fs.readFileSync(p, 'utf-8'))
  let arr
  if (Array.isArray(raw)) arr = raw
  else if (raw && Array.isArray(raw.reviews)) arr = raw.reviews
  else throw new Error('JSON 结构无法识别：既不是数组也不是 {reviews:[...]}')
  return arr.map(toRecord)
}

async function loadXlsx(p) {
  let XLSX
  try {
    // xlsx 是 CommonJS 包，在 ESM 里命名导出取不到，真正的导出挂在 default 上
    const mod = await import('xlsx')
    XLSX = mod.default ?? mod
  } catch {
    console.error('缺少 xlsx 解析库。请在 hotel-review-v2/frontend 目录下执行：')
    console.error('   npm install xlsx --save-dev')
    process.exit(1)
  }
  const wb = XLSX.readFile(p)
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })

  // 不硬编码行号：找那行同时含「时间」和「房间号」的当表头
  // （旧系统导出的前 3 行是标题/导出时间/空行）
  const hIdx = rows.findIndex(r =>
    r.some(c => String(c).includes('时间')) && r.some(c => String(c).includes('房间号'))
  )
  if (hIdx < 0) throw new Error('在 Excel 里找不到表头行（应含「时间」「房间号」列）')

  const header = rows[hIdx].map(c => String(c).trim())
  const idx = {
    time: header.findIndex(h => h.includes('时间')),
    room: header.findIndex(h => h.includes('房间号')),
    type: header.findIndex(h => h.includes('类型') || h.includes('评价')),
    reasons: header.findIndex(h => h.includes('原因')),
    staff: header.findIndex(h => h.includes('工号')),
    name: header.findIndex(h => h.includes('姓名')),
  }
  const out = []
  for (const row of rows.slice(hIdx + 1)) {
    if (!row || row.every(c => String(c).trim() === '')) continue
    const get = (i) => (i >= 0 ? row[i] : '')
    out.push(toRecord({
      _time: get(idx.time),
      createdAt: get(idx.time),
      room: get(idx.room),
      type: get(idx.type),
      reasons: get(idx.reasons),
      staffUsername: get(idx.staff),
      staffName: get(idx.name),
    }))
  }
  return out
}

function loadCsv(p) {
  // 极简 CSV 解析（支持双引号包裹与 "" 转义），够读导出的表
  const text = fs.readFileSync(p, 'utf-8').replace(/^\uFEFF/, '')
  const rows = []
  let row = [], cell = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') inQ = false
      else cell += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c === '\r') { /* skip */ }
    else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }

  const hIdx = rows.findIndex(r =>
    r.some(c => c.includes('时间')) && r.some(c => c.includes('房间号'))
  )
  const header = (hIdx >= 0 ? rows[hIdx] : rows[0]).map(c => c.trim())
  const body = hIdx >= 0 ? rows.slice(hIdx + 1) : rows.slice(1)
  const idx = {
    time: header.findIndex(h => h.includes('时间')),
    room: header.findIndex(h => h.includes('房间号')),
    type: header.findIndex(h => h.includes('类型') || h.includes('评价')),
    reasons: header.findIndex(h => h.includes('原因')),
    staff: header.findIndex(h => h.includes('工号')),
    name: header.findIndex(h => h.includes('姓名')),
  }
  return body
    .filter(r => r.some(c => String(c).trim() !== ''))
    .map(r => {
      const get = (i) => (i >= 0 ? r[i] : '')
      return toRecord({
        createdAt: get(idx.time), room: get(idx.room), type: get(idx.type),
        reasons: get(idx.reasons), staffUsername: get(idx.staff), staffName: get(idx.name),
      })
    })
}

async function loadRecords(p) {
  const ext = path.extname(p).toLowerCase()
  if (ext === '.json') return loadJson(p)
  if (ext === '.xlsx' || ext === '.xls') return await loadXlsx(p)
  if (ext === '.csv') return loadCsv(p)
  throw new Error(`不认识的文件类型：${ext}（支持 .json / .xlsx / .csv）`)
}

// ── 主流程 ──────────────────────────────────────────────────
async function main() {
  console.log(`读取文件：${file}`)
  const raw = await loadRecords(file)
  console.log(`解析出 ${raw.length} 条记录`)

  // 逐条质检
  const records = []
  const bad = []
  for (const r of raw) {
    if (!r.createdAt) { bad.push({ r, why: '提交时间无法识别' }); continue }
    if (!r.type) { bad.push({ r, why: '评价类型无法识别（应为 好评/差评）' }); continue }
    records.push(r)
  }
  if (bad.length) {
    console.log(`⚠️ 有 ${bad.length} 条无法识别，将被跳过：`)
    for (const b of bad.slice(0, 5)) console.log(`   ${b.why} → ${JSON.stringify(b.r)}`)
    if (bad.length > 5) console.log(`   …另有 ${bad.length - 5} 条`)
  }
  if (!records.length) {
    console.log('没有可导入的记录，结束。')
    return
  }

  const client = new pg.Client(resolveConnection())
  await client.connect()

  // 读库里已有的，建指纹集合
  const existing = await client.query('SELECT "Id","Type","Reasons","Room","StaffUsername","CreatedAt" FROM "Reviews"')
  const have = new Set(existing.rows.map(r => fingerprint({
    room: r.Room, type: r.Type, reasons: r.Reasons || [], createdAt: new Date(r.CreatedAt),
  })))

  // 文件内部也可能重复（多设备导两遍）
  const seenInFile = new Set()
  const fresh = []
  let dupDb = 0, dupFile = 0
  for (const r of records) {
    const fp = fingerprint(r)
    if (have.has(fp)) { dupDb++; continue }
    if (seenInFile.has(fp)) { dupFile++; continue }
    seenInFile.add(fp)
    fresh.push(r)
  }

  // 统计
  const pos = records.filter(r => r.type === 'positive').length
  const neg = records.length - pos
  const times = records.map(r => r.createdAt.getTime()).sort((a, b) => a - b)
  const fmt = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false })
  const rooms = new Set(records.map(r => r.room).filter(Boolean))

  console.log('')
  console.log('──────────── 预演结果 ────────────')
  console.log(`  文件内记录      ${records.length} 条（好评 ${pos} / 差评 ${neg}）`)
  console.log(`  时间范围        ${fmt(times[0])}  ~  ${fmt(times[times.length - 1])}`)
  console.log(`  覆盖房间号      ${rooms.size} 个`)
  console.log(`  库里已存在      ${dupDb} 条（跳过）`)
  if (dupFile) console.log(`  文件内重复      ${dupFile} 条（跳过）`)
  console.log(`  本次将新增      ${fresh.length} 条`)
  console.log(`  当前库内总数    ${existing.rowCount} 条`)
  console.log(`  导入后库内总数  ${existing.rowCount + fresh.length} 条`)
  console.log('──────────────────────────────────')

  if (!COMMIT) {
    console.log('')
    console.log('以上为【预演】，未写入任何数据。')
    console.log('确认无误后，在同样命令后加 --commit 正式导入。')
    await client.end()
    return
  }

  // 真正写库
  const sql = `INSERT INTO "Reviews" ("Id", "Type", "Reasons", "Room", "StaffUsername", "StaffName", "CreatedAt")
               VALUES ($1, $2, $3, $4, $5, $6, $7)`
  let ok = 0
  for (const r of fresh) {
    await client.query(sql, [randomUUID(), r.type, r.reasons, r.room, r.staffUsername, r.staffName, r.createdAt])
    ok++
  }
  const after = await client.query('SELECT count(*)::int AS n FROM "Reviews"')
  await client.end()

  console.log('')
  console.log(`✅ 导入完成：新增 ${ok} 条，跳过重复 ${dupDb + dupFile} 条`)
  console.log(`   库内现共 ${after.rows[0].n} 条`)
  console.log('   可在后台页 ?admin=1 登录核对，或 GET /api/stats?token=<令牌> 查看。')
}

main().catch(e => { console.error('迁移失败：', e.message); process.exit(1) })
