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
const TMP = path.join(os.tmpdir(), `hr-v2-ghpages-${process.pid}`)
const TMP_BRANCH = `ghp-deploy-${process.pid}`

function run(cmd, cwd = ROOT) {
  console.log(`$ ${cmd}`)
  execSync(cmd, { cwd, stdio: 'inherit' })
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
  fs.rmSync(TMP, { recursive: true, force: true })
  run(`git worktree add --orphan -b ${TMP_BRANCH} "${TMP}"`)
  run(`git -C "${TMP}" clean -fd`)

  // 3) 拷贝 dist 内容到 worktree 根
  copyDir(DIST, TMP)

  // 4) 提交并强推到 gh-pages
  run(`git -C "${TMP}" add -A`)
  run(`git -C "${TMP}" commit -m "deploy: $(new Date().toISOString())"`, TMP)
  run(`git -C "${TMP}" push origin HEAD:refs/heads/gh-pages --force`, TMP)

  console.log('\n✅ 部署完成 -> https://wx277282356.github.io/hotel-review-v2/')
} finally {
  // 5) 清理 worktree 与临时分支
  try { run(`git worktree remove "${TMP}" --force`) } catch {}
  try { run(`git branch -D ${TMP_BRANCH}`) } catch {}
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
}
