// ============================================================
//  清空测试评价（运维工具 —— 只在【正式对客前】或恢复备份后使用）
//
//  用法：
//    node scripts/reset-reviews.mjs            ← 预演：只显示会删掉什么，不动数据
//    node scripts/reset-reviews.mjs --commit    ← 确认后真的清空
//
//  为什么需要它：系统本身**刻意没有**删除评价的接口
//  （客人、前台、管理员都删不了），这是「评价不可篡改」的硬约束。
//  但调试期间用界面点出来的测试数据不能带进正式统计，
//  所以额外提供一个"只在你本机手动执行"的运维脚本。
//
//  影响范围：**只清空 Reviews 表**。账号、站点设置、LOGO 均不受影响。
//  建议：执行前先跑一次 备份数据.bat，万一清错了还能恢复。
// ============================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const COMMIT = process.argv.includes('--commit')

function resolveConnection() {
  if (process.env.PG_CONNECTION) return { connectionString: process.env.PG_CONNECTION }
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const localCfg = path.resolve(__dirname, '../../backend/appsettings.Local.json')
  if (!fs.existsSync(localCfg)) {
    console.error('未找到 backend/appsettings.Local.json，也没有 PG_CONNECTION 环境变量。')
    process.exit(1)
  }
  const cfg = JSON.parse(fs.readFileSync(localCfg, 'utf-8'))
  const cs = cfg?.ConnectionStrings?.DefaultConnection
  if (!cs || cs.includes('CHANGE_ME')) {
    console.error('backend/appsettings.Local.json 里的连接串未配置好。')
    process.exit(1)
  }
  const kv = {}
  for (const part of cs.split(';')) {
    const i = part.indexOf('=')
    if (i > 0) kv[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim()
  }
  return {
    host: kv.host || 'localhost',
    port: Number(kv.port || 5432),
    database: kv.database || 'hotel_review',
    user: kv.username || kv.user || 'postgres',
    password: kv.password || '',
  }
}

const c = new pg.Client(resolveConnection())
await c.connect()

const total = (await c.query('SELECT count(*)::int AS n FROM "Reviews"')).rows[0].n

if (total === 0) {
  console.log('评价表已经是空的，无需清理。')
  await c.end()
  process.exit(0)
}

const stat = await c.query(`
  SELECT
    count(*)::int AS n,
    count(*) FILTER (WHERE "Type" = 'positive')::int AS pos,
    count(*) FILTER (WHERE "Type" = 'negative')::int AS neg,
    min("CreatedAt") AS first_at,
    max("CreatedAt") AS last_at,
    count(DISTINCT "Room")::int AS rooms
  FROM "Reviews"`)
const r = stat.rows[0]
const fmt = (t) => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '-')

console.log('即将清空的评价：')
console.log(`  共 ${r.n} 条（好评 ${r.pos} / 差评 ${r.neg}）`)
console.log(`  时间范围  ${fmt(r.first_at)}  ~  ${fmt(r.last_at)}`)
console.log(`  涉及房间  ${r.rooms} 个`)

console.log('')
console.log('  最近 5 条（确认一下是不是都是测试数据）：')
const sample = await c.query('SELECT "Type","Room","Reasons","CreatedAt" FROM "Reviews" ORDER BY "CreatedAt" DESC LIMIT 5')
for (const x of sample.rows) {
  console.log('    ' + fmt(x.CreatedAt) + ' | ' + x.Type + ' | 房间=' + JSON.stringify(x.Room) + ' | ' + JSON.stringify(x.Reasons))
}

if (!COMMIT) {
  console.log('')
  console.log('以上为【预演】，没有删除任何数据。')
  console.log('确认这些都是测试数据后，在同样命令后加 --commit 正式清空。')
  console.log('（建议先双击「备份数据.bat」留一份，万一清错可恢复）')
  await c.end()
  process.exit(0)
}

const del = await c.query('DELETE FROM "Reviews" RETURNING "Id"')
console.log('')
console.log(`✅ 已清空 ${del.rowCount} 条评价`)

for (const t of ['Reviews', 'Staffs', 'Sessions', 'AppSettings']) {
  const n = (await c.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n
  console.log('  ' + t + ' = ' + n)
}
console.log('   账号、站点设置、LOGO 均未受影响。')
await c.end()
