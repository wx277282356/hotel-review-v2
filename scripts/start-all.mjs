#!/usr/bin/env node
// ============================================================
//  一键启动：后端 + Cloudflare 隧道 + 自动写入前端配置 + 自动发布
//
//  做了什么：
//   1) 若后端没跑，就启动它（并等它就绪）
//   2) 启动 Cloudflare 隧道，从输出里自动抓取公网地址
//   3) 把该地址写进 frontend/public/config.js 的 apiBase
//   4) 自动 npm run deploy 发布到 GitHub Pages
//   5) 两个进程保持运行，日志实时打到本窗口；Ctrl+C 一起停
//
//  用法：
//   node scripts/start-all.mjs               正常一键启动
//   node scripts/start-all.mjs --no-tunnel   只启后端（本地调试）
//   node scripts/start-all.mjs --no-deploy   起隧道但不自动发布
// ============================================================
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKEND_DIR = path.join(ROOT, 'backend')
const FRONTEND_DIR = path.join(ROOT, 'frontend')
const CONFIG_FILE = path.join(FRONTEND_DIR, 'public', 'config.js')
const PORT = Number(process.env.PORT || 5188)
const LOCAL_API = `http://localhost:${PORT}`
const LOCAL_HEALTH = `${LOCAL_API}/api/stats` // 无令牌会返回 401，能拿到状态码就说明服务活着

const isWin = process.platform === 'win32'
const args = process.argv.slice(2)
const noTunnel = args.includes('--no-tunnel')
const noDeploy = args.includes('--no-deploy')

const children = []
function log(msg) {
  console.log(`\x1b[36m[启动器]\x1b[0m ${msg}`)
}
function logOk(msg) {
  console.log(`\x1b[32m[启动器]\x1b[0m ${msg}`)
}
function logWarn(msg) {
  console.log(`\x1b[33m[启动器]\x1b[0m ${msg}`)
}
function logErr(msg) {
  console.log(`\x1b[31m[启动器]\x1b[0m ${msg}`)
}

// 探测服务是否存活：拿到任何 HTTP 状态码（含 401/404）都算活
async function probe(url, timeoutMs = 2500) {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal })
    clearTimeout(timer)
    return res.status
  } catch {
    return 0
  }
}

async function waitFor(fn, timeoutMs, label, intervalMs = 1200) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const v = await fn()
    if (v) return v
    await new Promise(r => setTimeout(r, intervalMs))
  }
  throw new Error(`${label} 超时（${Math.round(timeoutMs / 1000)}秒）`)
}

function findCloudflared() {
  const candidates = isWin
    ? [path.join(ROOT, 'cloudflared.exe'), path.join(ROOT, 'bin', 'cloudflared.exe')]
    : [path.join(ROOT, 'cloudflared'), '/usr/local/bin/cloudflared', '/opt/homebrew/bin/cloudflared']
  return candidates.find(p => fs.existsSync(p)) || null
}

function findDotnet() {
  if (!isWin) return 'dotnet'
  const local = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'dotnet', 'dotnet.exe')
  if (fs.existsSync(local)) return local
  const pf = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'dotnet', 'dotnet.exe')
  return fs.existsSync(pf) ? pf : 'dotnet'
}

function pipe(proc, tag, onLine) {
  const handle = (stream) => {
    let buf = ''
    stream.on('data', (chunk) => {
      const text = chunk.toString()
      buf += text
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const line of lines) {
        if (line.trim()) console.log(`${tag} ${line}`)
        if (onLine) onLine(line)
      }
    })
  }
  handle(proc.stdout)
  handle(proc.stderr)
}

function spawnChild(cmd, argv, opts = {}) {
  const proc = spawn(cmd, argv, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(proc)
  return proc
}

function shutdown() {
  console.log('')
  log('正在停止全部子进程…')
  for (const c of children) {
    try { c.kill() } catch { /* ignore */ }
  }
  setTimeout(() => process.exit(0), 400)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// ---------------------------------------------------------------
async function main() {
  console.log('======================================================')
  console.log('  城市酒店点评系统 · 一键启动')
  console.log('======================================================')

  // ---------- 1) 后端 ----------
  const already = await probe(LOCAL_HEALTH)
  if (already) {
    logOk(`后端已在运行（HTTP ${already}），跳过启动`)
  } else {
    log('正在启动后端（首次编译可能要 20-60 秒）…')
    const dotnet = findDotnet()
    const proc = spawnChild(dotnet, ['run'], { cwd: BACKEND_DIR })
    pipe(proc, '\x1b[90m[后端]\x1b[0m')
    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) logErr(`后端进程退出（code ${code}），请检查上面的报错`)
    })
    try {
      await waitFor(() => probe(LOCAL_HEALTH), 180000, '后端启动')
      logOk('后端已就绪 ✅')
    } catch (e) {
      logErr(e.message)
      logErr('后端没起来，常见原因：PostgreSQL 服务没开 / appsettings.Local.json 密码不对')
      shutdown()
      return
    }
  }

  if (noTunnel) {
    logOk(`已跳过隧道。本地调试地址：${LOCAL_API}`)
    log('（前端开发模式：cd frontend && npm run dev，访问 http://localhost:5173）')
    console.log('按 Ctrl+C 退出（会一并停掉后端）')
    await new Promise(() => {})
    return
  }

  // ---------- 2) 隧道 ----------
  const cf = findCloudflared()
  if (!cf) {
    logErr('没找到 cloudflared 可执行文件。')
    logErr('下载：curl -sL --noproxy "*" -o cloudflared.exe \\')
    logErr('  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe')
    logErr('放到项目根目录后重试。')
    shutdown()
    return
  }

  log('正在启动 Cloudflare 隧道…')
  let publicUrl = ''
  const tProc = spawnChild(cf, ['tunnel', '--url', LOCAL_API, '--no-autoupdate'], { cwd: ROOT })
  pipe(tProc, '\x1b[90m[隧道]\x1b[0m', (line) => {
    if (!publicUrl) {
      const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (m) publicUrl = m[0]
    }
  })

  try {
    publicUrl = await waitFor(() => publicUrl || null, 90000, '获取隧道地址')
    logOk(`公网地址：${publicUrl} ✅`)
  } catch (e) {
    logErr(e.message)
    logErr('隧道没建起来。常见原因：本机代理拦了 Cloudflare（启动前需清掉 HTTP_PROXY/HTTPS_PROXY）')
    shutdown()
    return
  }

  const apiBase = `${publicUrl}/api`

  // ---------- 3) 写入前端配置 ----------
  let changed = false
  try {
    const cur = fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE, 'utf-8') : ''
    const m = cur.match(/apiBase:\s*'([^']*)'/)
    if (!m || m[1] !== apiBase) {
      const next = cur.replace(/apiBase:\s*'[^']*'/, `apiBase: '${apiBase}'`)
      fs.writeFileSync(CONFIG_FILE, next, 'utf-8')
      changed = true
      logOk(`已把 config.js 的 apiBase 更新为 ${apiBase}`)
    } else {
      log('apiBase 没变，跳过写入')
    }
  } catch (e) {
    logErr('写入 config.js 失败：' + e.message)
  }

  // ---------- 4) 发布前端 ----------
  let deployState = 'skipped' // ok | failed | skipped
  if (noDeploy) {
    logWarn('已跳过自动发布（--no-deploy）。请手动执行：cd frontend && npm run deploy')
  } else if (!changed) {
    log('配置没变，无需重新发布')
    deployState = 'ok'
  } else {
    log('正在发布前端到 GitHub Pages…')
    const proc = spawnChild(process.execPath, [path.join(ROOT, 'scripts', 'deploy.mjs')], { cwd: FRONTEND_DIR })
    pipe(proc, '\x1b[90m[发布]\x1b[0m')
    const code = await new Promise((resolve) => proc.on('exit', (c) => resolve(c === null ? 1 : c)))
    if (code === 0) {
      deployState = 'ok'
      logOk('前端已发布到 GitHub Pages ✅')
    } else {
      deployState = 'failed'
      logErr('前端发布失败 ❌')
      logErr('线上前端仍指向旧地址，客人提交会失败。请手动执行：')
      logErr('  cd frontend && npm run deploy')
    }
  }

  // ---------- 汇总 ----------
  console.log('')
  console.log('======================================================')
  if (deployState === 'failed') {
    logErr('后端与隧道已就绪，但前端发布失败 ⚠️')
  } else if (noDeploy) {
    logWarn('后端与隧道已就绪（未自动发布前端）')
  } else {
    logOk('全部就绪 🎉')
  }
  console.log(`  前端（客人扫码 / 后台）：https://wx277282356.github.io/hotel-review-v2/`)
  console.log(`  后台登录页            ：https://wx277282356.github.io/hotel-review-v2/?admin=1`)
  console.log(`  后端公网地址          ：${apiBase}`)
  console.log('')
  console.log('  ⚠️ 这个地址是本机专属、重启会变，本脚本会自动换掉并重新发布。')
  console.log('  ⚠️ GitHub Pages 有约 10 分钟 CDN 缓存，刚发布完可能要等一会才生效。')
  console.log('  ⚠️ 让本窗口保持开着；关掉窗口服务就停了。按 Ctrl+C 可一并停止。')
  console.log('======================================================')

  await new Promise(() => {})
}

main().catch((e) => {
  logErr('启动失败：' + (e?.message || e))
  shutdown()
})
