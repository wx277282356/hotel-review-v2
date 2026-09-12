// 会话键隔离 / 迁移 的回归测试（纯逻辑，无需后端、无需浏览器）
// 用法：cd frontend && node scripts/test-auth-session.mjs
//
// 为什么要有这个测试：新系统与旧系统**同域**（wx277282356.github.io），
// localStorage 只按域名隔离、不按路径 → 两边共用同一份存储。
// 旧系统把登录态存在 hr_session、靠它重新登录，并靠 role==='manager' 决定「导出 Excel」等按钮是否显示；
// 新系统若也用 hr_session 就会互相覆盖（旧系统被踢回登录页 / 新系统丢失"当班工号"归属）。
// 所以新系统必须用自己的键 hrv2_session —— 这个测试就是防止有人把它改回去。
//
// 覆盖：新键读写、旧键自动迁移、绝不误删旧系统的登录态、admin_token 的"退出后复活"bug、脏数据健壮性
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
}

const A = await import('../src/utils/auth.js')
const { auth, loadSession, saveSession, clearSession, isLoggedIn, isAdmin } = A

let pass = 0, fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')) }
}
function reset(entries = {}) {
  store.clear()
  for (const [k, v] of Object.entries(entries)) store.set(k, v)
  auth.value = { token: '', role: '', username: '', displayName: '' }
}

const OLD_SYS = JSON.stringify({ id: 1, username: 'admin', password: 'admin123', role: 'manager', name: '店总', nameEn: 'Manager' })
const OUR_SESSION = JSON.stringify({ token: 'tok-abc', role: 'admin', username: 'admin', displayName: '管理员' })

console.log('\n【1】全新设备：无任何会话')
reset()
loadSession()
check('未登录', !isLoggedIn())
check('localStorage 不被写入', store.size === 0, `size=${store.size}`)

console.log('\n【2】设备上只有旧系统的登录态（旧格式）')
reset({ hr_session: OLD_SYS })
loadSession()
check('不会被误判为已登录', !isLoggedIn())
check('不会被误判为管理员', !isAdmin())
check('旧系统的 hr_session 原样保留（没被删）', store.get('hr_session') === OLD_SYS)

console.log('\n【3】早期版本把本系统会话写在了 hr_session 里 → 应自动迁移')
reset({ hr_session: OUR_SESSION })
loadSession()
check('恢复为已登录', isLoggedIn())
check('恢复出正确角色', isAdmin())
check('已写入新键 hrv2_session', !!store.get('hrv2_session'))
check('旧键 hr_session 已被清掉（不再与旧系统抢键）', !store.has('hr_session'), `hr_session=${store.get('hr_session')}`)

console.log('\n【4】保存会话只写新键，不动旧系统的键')
reset({ hr_session: OLD_SYS })
saveSession({ token: 'tok-new', role: 'viewer', username: 'xiaoli', displayName: '小李' })
check('写入 hrv2_session', JSON.parse(store.get('hrv2_session')).token === 'tok-new')
check('旧系统 hr_session 未被触碰', store.get('hr_session') === OLD_SYS)
loadSession()
check('重新加载仍为已登录（viewer）', isLoggedIn() && !isAdmin())

console.log('\n【5】退出登录：清自己的键，绝不误删旧系统登录态')
reset({ hr_session: OLD_SYS, hrv2_session: OUR_SESSION, admin_token: 'tok-abc' })
loadSession()
clearSession()
check('未登录', !isLoggedIn())
check('hrv2_session 已删', !store.has('hrv2_session'))
check('admin_token 已删', !store.has('admin_token'))
check('旧系统 hr_session 保留', store.get('hr_session') === OLD_SYS)

console.log('\n【6】admin_token 复活 bug：退出后刷新不应又变已登录')
reset({ admin_token: 'tok-legacy' })
loadSession()
check('仅凭 admin_token 可恢复令牌', isLoggedIn())
saveSession({ token: 'tok-legacy', role: 'admin', username: 'admin', displayName: '管理员' })
check('保存完整会话后 admin_token 被清理', !store.has('admin_token'))
clearSession()
loadSession()
check('退出后重新加载 → 仍未登录（修复了"复活"）', !isLoggedIn(), `token=${auth.value.token}`)

console.log('\n【7】脏数据健壮性')
for (const bad of ['not-json', '{}', 'null', '[]', JSON.stringify({ token: '' }), JSON.stringify({ token: 123 })]) {
  reset({ hrv2_session: bad, hr_session: bad })
  loadSession()
  const ok = !isLoggedIn()
  check(`坏数据 [${bad}] 不崩溃、视为未登录`, ok)
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail ? 1 : 0)
