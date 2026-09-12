#!/usr/bin/env node
// ============================================================
//  数据备份：把 PostgreSQL 里的评价数据 + 后台上传的 LOGO 打包存到本地
//
//  为什么需要它：
//    本系统的硬承诺是「评价任何人都不可删除」，所以评价数据是最不能丢的东西。
//    但"不能删"只防住了程序层面的误删，防不住硬盘坏、系统重装、数据库损坏。
//    定期备份是唯一的保险。
//
//  备份了什么：
//    1) 整个 hotel_review 库（评价 / 账号 / 会话）→ backups/hotel_review_<时间>.sql
//    2) 后台上传的品牌 LOGO（backend/branding/，它**不在 Git 里**，丢了就得重传）
//
//  用法：
//    node scripts/backup-db.mjs              备份一次
//    node scripts/backup-db.mjs --keep 60    保留最近 60 份（默认 30）
//    node scripts/backup-db.mjs --out D:\备份  换保存目录
// ============================================================
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LOCAL_CFG = path.join(ROOT, 'backend', 'appsettings.Local.json')
const BRANDING_DIR = path.join(ROOT, 'backend', 'branding')

const argv = process.argv.slice(2)
function argOf(name, dflt) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt
}
const KEEP = Number(argOf('--keep', '30'))
const OUT_DIR = path.resolve(argOf('--out', path.join(ROOT, 'backups')))

const log = (m) => console.log(`\x1b[36m[备份]\x1b[0m ${m}`)
const ok = (m) => console.log(`\x1b[32m[备份]\x1b[0m ${m}`)
const warn = (m) => console.log(`\x1b[33m[备份]\x1b[0m ${m}`)
const die = (m) => {
  console.error(`\x1b[31m[备份]\x1b[0m ${m}`)
  process.exit(1)
}

// ---------- 1) 解析数据库连接串 ----------
function loadConn() {
  if (process.env.PG_CONNECTION) {
    log('使用环境变量 PG_CONNECTION 里的连接串')
    return parse(process.env.PG_CONNECTION)
  }
  if (!fs.existsSync(LOCAL_CFG)) {
    die(
      `找不到 ${LOCAL_CFG}\n` +
        '      请先把 backend/appsettings.json 复制为 appsettings.Local.json 并填好密码。'
    )
  }
  const cfg = JSON.parse(fs.readFileSync(LOCAL_CFG, 'utf-8'))
  const cs = cfg?.ConnectionStrings?.DefaultConnection
  if (!cs || cs.includes('CHANGE_ME')) die('appsettings.Local.json 里的数据库连接串还没填好。')
  log('读取 backend/appsettings.Local.json 的连接信息')
  return parse(cs)
}

// .NET 连接串 "Key=Value;Key=Value" -> 对象（已踩坑：键要转小写再匹配）
function parse(cs) {
  const o = {}
  for (const part of cs.split(';')) {
    if (!part.trim()) continue
    const i = part.indexOf('=')
    if (i < 0) continue
    o[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim()
  }
  if (!o.host || !o.database || !o.username) {
    die('连接串里缺少 Host / Database / Username，无法备份。')
  }
  return {
    host: o.host,
    port: o.port || '5432',
    db: o.database,
    user: o.username,
    password: o.password || ''
  }
}

// ---------- 2) 找 pg_dump / psql ----------
function findPgTool(tool) {
  const exe = process.platform === 'win32' ? `${tool}.exe` : tool

  // ① 环境变量指定
  const envKey = tool === 'pg_dump' ? 'PG_DUMP' : 'PSQL'
  if (process.env[envKey] && fs.existsSync(process.env[envKey])) return process.env[envKey]

  // ② PATH 里有（用 where/which 探测，避免直接 spawn 报 ENOENT 不好看）
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(finder, [exe], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] })
    const first = out.split(/\r?\n/).find(Boolean)
    if (first && fs.existsSync(first.trim())) return first.trim()
  } catch {
    /* PATH 里没有，继续找 */
  }

  // ③ PostgreSQL 的默认安装目录（Windows 上装完通常不会自动进 PATH，这是最常见的情况）
  if (process.platform === 'win32') {
    const bases = [
      process.env.ProgramFiles || 'C:\\Program Files',
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
    ]
    for (const base of bases) {
      const pgDir = path.join(base, 'PostgreSQL')
      if (!fs.existsSync(pgDir)) continue
      // 版本号从高到低找，优先用新版
      const versions = fs
        .readdirSync(pgDir)
        .filter((d) => /^\d+/.test(d))
        .sort((a, b) => parseInt(b) - parseInt(a))
      for (const v of versions) {
        const p = path.join(pgDir, v, 'bin', exe)
        if (fs.existsSync(p)) return p
      }
    }
  }
  return null
}

// ---------- 3) 主流程 ----------
const conn = loadConn()
const dumpBin = findPgTool('pg_dump')
if (!dumpBin) {
  die(
    '没找到 pg_dump（PostgreSQL 自带的备份工具）。\n' +
      '      它通常在这里：C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe\n' +
      '      如果 PostgreSQL 装在别处，可以设环境变量 PG_DUMP 指向它的完整路径后重试。'
  )
}
log(`使用 ${dumpBin}`)

fs.mkdirSync(OUT_DIR, { recursive: true })

const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const stamp =
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
  `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
const sqlFile = path.join(OUT_DIR, `hotel_review_${stamp}.sql`)

log('正在导出数据库…')
const args = [
  '-h', conn.host,
  '-p', String(conn.port),
  '-U', conn.user,
  '-d', conn.db,
  '--no-owner',        // 恢复时不受"原用户名"限制，换机器也能恢复
  '--no-privileges',
  '--clean',           // 恢复时先删同名对象，可重复恢复
  '--if-exists',
  '-f', sqlFile
]
try {
  execFileSync(dumpBin, args, {
    stdio: ['ignore', 'inherit', 'pipe'],
    env: { ...process.env, PGPASSWORD: conn.password }
  })
} catch (e) {
  const err = (e.stderr || '').toString().trim()
  die(`导出失败。\n      ${err || e.message}\n      常见原因：PostgreSQL 服务没启动 / 连接串密码不对`)
}

const sqlSize = fs.statSync(sqlFile).size
if (sqlSize === 0) die('导出的文件是空的，备份未成功。')

// ---------- 4) 品牌 LOGO（不在 Git 里，必须一起备） ----------
let brandingNote = '（后台上传的 LOGO 目录不存在，说明用的是内置默认 LOGO，无需备份）'
if (fs.existsSync(BRANDING_DIR)) {
  const files = fs.readdirSync(BRANDING_DIR).filter((f) => fs.statSync(path.join(BRANDING_DIR, f)).isFile())
  if (files.length) {
    const dest = path.join(OUT_DIR, `branding_${stamp}`)
    fs.mkdirSync(dest, { recursive: true })
    for (const f of files) fs.copyFileSync(path.join(BRANDING_DIR, f), path.join(dest, f))
    brandingNote = `已一并备份后台上传的 LOGO（${files.join(', ')}）`
  } else {
    brandingNote = '（branding 目录是空的，用的是内置默认 LOGO）'
  }
}

// ---------- 5) 只保留最近 N 份 ----------
let removed = 0
try {
  const entries = fs
    .readdirSync(OUT_DIR)
    .filter((f) => /^hotel_review_.*\.sql$/.test(f))
    .sort()
  for (const old of entries.slice(0, Math.max(0, entries.length - KEEP))) {
    try {
      fs.unlinkSync(path.join(OUT_DIR, old))
      removed++
    } catch {
      /* 删不掉就算了，不影响本次备份 */
    }
  }
} catch {
  warn('清理旧备份时出错，已跳过（不影响本次备份）')
}

// ---------- 6) 汇报 ----------
console.log('')
console.log('======================================================')
ok('备份完成 ✅')
console.log(`  数据库    ：${conn.db}（${conn.host}:${conn.port}）`)
console.log(`  备份文件  ：${sqlFile}`)
console.log(`  文件大小  ：${(sqlSize / 1024).toFixed(1)} KB`)
console.log(`  ${brandingNote}`)
console.log(`  保存目录  ：${OUT_DIR}`)
if (removed > 0) console.log(`  已清理    ：${removed} 份超出保留数量（保留最近 ${KEEP} 份）的旧备份`)
console.log('')
console.log('  恢复方法见《部署与运维说明.md》「数据备份与恢复」一节，或：')
console.log(`    "${dumpBin.replace(/pg_dump\.exe$/i, 'psql.exe')}" -h ${conn.host} -p ${conn.port} -U ${conn.user} -d ${conn.db} -f "<上面那个 .sql 文件>"`)
console.log('  ⚠️ 建议把 backups 目录定期拷贝一份到 U 盘或网盘，本机硬盘坏了才不至于一起丢。')
console.log('======================================================')
