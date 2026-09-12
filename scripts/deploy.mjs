// 跨平台部署脚本：构建前端并推送到 gh-pages 分支（GitHub Pages 源）
// 用法：node scripts/deploy.mjs   （或在 frontend 目录 npm run deploy）
// 采用 git worktree 方式，避免 gh-pages CLI 在 node_modules 被 gitignore 时失败的问题。
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const FRONTEND = path.join(ROOT, 'frontend')
const DIST = path.join(FRONTEND, 'dist')
const TMP = path.join(os.tmpdir(), 'hr-v2-ghpages')
const TMP_BRANCH = 'ghp-deploy'

function run(cmd, cwd = ROOT, quiet = false) {
  if (!quiet) console.log(`$ ${cmd}`)
  execSync(cmd, { cwd, stdio: quiet ? 'ignore' : 'inherit' })
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

try {
  // 1) 构建
  run('npm run build', FRONTEND)
  if (!fs.existsSync(DIST)) throw new Error('dist 目录不存在，构建可能失败')

  // 2) 准备临时 worktree（orphan 分支，初始为空，直接覆盖即可）
  // 先清理上次异常中断可能残留的 worktree 元数据/分支，否则 add 会报 "is not a working tree"
  try { run(`git worktree remove "${TMP}" --force`, ROOT, true) } catch {}
  try { run(`git branch -D ${TMP_BRANCH}`, ROOT, true) } catch {}
  try { run('git worktree prune', ROOT, true) } catch {}
  fs.rmSync(TMP, { recursive: true, force: true })

  run(`git worktree add --orphan -b ${TMP_BRANCH} "${TMP}"`)
  run(`git -C "${TMP}" clean -fd`)

  // 3) 拷贝 dist 内容到 worktree 根
  copyDir(DIST, TMP)

  // 4) 提交并强推到 gh-pages
  const stamp = new Date().toISOString()
  run(`git -C "${TMP}" add -A`)
  run(`git -C "${TMP}" commit -m "deploy: ${stamp}"`)
  // 推送偶发失败（网络抖动）时重试 3 次
  let pushed = false
  for (let i = 1; i <= 3 && !pushed; i++) {
    try {
      run(`git -C "${TMP}" push origin HEAD:refs/heads/gh-pages --force`)
      pushed = true
    } catch (e) {
      console.log(`⚠️ 第 ${i} 次推送失败，${i < 3 ? '重试中…' : '已放弃'}`)
    }
  }
  if (!pushed) throw new Error('推送 gh-pages 失败（已重试 3 次）')

  console.log('\n✅ 部署完成 -> https://wx277282356.github.io/hotel-review-v2/')
} finally {
  // 5) 清理 worktree 与临时分支
  try { run(`git worktree remove "${TMP}" --force`, ROOT, true) } catch {}
  try { run(`git branch -D ${TMP_BRANCH}`, ROOT, true) } catch {}
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
}
