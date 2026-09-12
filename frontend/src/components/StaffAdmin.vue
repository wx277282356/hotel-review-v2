<script setup>
// 账号管理（仅管理员可见）：新增账号、改角色、停用/启用、重置密码、删除
import { ref, onMounted } from 'vue'
import { api } from '../api/http.js'
import { auth } from '../utils/auth.js'

const list = ref([])
const msg = ref('')
const busy = ref(false)

const form = ref({ username: '', password: '', displayName: '', role: 'viewer' })

function token() {
  return encodeURIComponent(auth.value.token)
}

async function load() {
  msg.value = ''
  try {
    const res = await api.get('/staff?token=' + token())
    list.value = res.data
  } catch (e) {
    msg.value = '❌ 加载失败：' + (e.response?.status === 403 ? '需要管理员权限' : (e.response?.data?.error || e.message))
  }
}

async function create() {
  msg.value = ''
  if (!form.value.username || !form.value.password) {
    msg.value = '请填写用户名和密码'
    return
  }
  busy.value = true
  try {
    await api.post('/staff?token=' + token(), { ...form.value })
    msg.value = `✅ 已创建账号 ${form.value.username}`
    form.value = { username: '', password: '', displayName: '', role: 'viewer' }
    await load()
  } catch (e) {
    msg.value = '❌ ' + (e.response?.data?.error || e.message)
  } finally {
    busy.value = false
  }
}

async function patch(row, body, okText) {
  msg.value = ''
  busy.value = true
  try {
    await api.patch(`/staff/${row.id}?token=` + token(), body)
    msg.value = '✅ ' + okText
    await load()
  } catch (e) {
    msg.value = '❌ ' + (e.response?.data?.error || e.message)
  } finally {
    busy.value = false
  }
}

async function toggleActive(row) {
  await patch(row, { isActive: !row.isActive }, row.isActive ? '已停用 ' + row.username : '已启用 ' + row.username)
}

async function changeRole(row) {
  const next = row.role === 'admin' ? 'viewer' : 'admin'
  await patch(row, { role: next }, `${row.username} 角色改为 ${next === 'admin' ? '管理员' : '查看者'}`)
}

async function resetPwd(row) {
  const pwd = window.prompt(`给「${row.displayName || row.username}」设置新密码（至少 6 位）：`)
  if (!pwd) return
  await patch(row, { password: pwd }, '已重置密码，该账号需重新登录')
}

async function remove(row) {
  if (!window.confirm(`确定删除账号「${row.displayName || row.username}」？\n\n注意：只删登录账号，他名下的评价数据不受影响。`)) return
  msg.value = ''
  busy.value = true
  try {
    await api.delete(`/staff/${row.id}?token=` + token())
    msg.value = '✅ 已删除账号 ' + row.username
    await load()
  } catch (e) {
    msg.value = '❌ ' + (e.response?.data?.error || e.message)
  } finally {
    busy.value = false
  }
}

onMounted(load)
defineExpose({ load })
</script>

<template>
  <div class="staff">
    <h3>👤 账号管理</h3>
    <p class="hint">
      <b>管理员</b>：可看全部统计、导出、改 LOGO、管理账号；
      <b>查看者</b>：只能看统计与明细、导出，不能改配置。
    </p>

    <div class="new-row">
      <input v-model="form.username" placeholder="登录名（如 front01）" />
      <input v-model="form.displayName" placeholder="姓名（如 前台小李）" />
      <input v-model="form.password" type="password" placeholder="初始密码（≥6 位）" />
      <select v-model="form.role">
        <option value="viewer">查看者</option>
        <option value="admin">管理员</option>
      </select>
      <button :disabled="busy" @click="create">新增账号</button>
    </div>

    <p v-if="msg" class="msg">{{ msg }}</p>

    <table v-if="list.length">
      <thead>
        <tr><th>姓名</th><th>登录名</th><th>角色</th><th>状态</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="s in list" :key="s.id">
          <td>{{ s.displayName || '-' }}</td>
          <td>{{ s.username }}</td>
          <td><span class="badge" :class="s.role">{{ s.role === 'admin' ? '管理员' : '查看者' }}</span></td>
          <td><span class="badge" :class="s.isActive ? 'on' : 'off'">{{ s.isActive ? '启用' : '已停用' }}</span></td>
          <td class="ops">
            <button class="mini" :disabled="busy" @click="changeRole(s)">改角色</button>
            <button class="mini" :disabled="busy" @click="toggleActive(s)">{{ s.isActive ? '停用' : '启用' }}</button>
            <button class="mini" :disabled="busy" @click="resetPwd(s)">重置密码</button>
            <button class="mini danger" :disabled="busy" @click="remove(s)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">暂无账号</p>

    <p class="foot">
      ⚠️ 评价数据任何人都不可删除；删除账号只影响登录，不影响历史评价。
    </p>
  </div>
</template>

<style scoped>
.staff { background:#fff; border:1px solid #eee; border-radius:10px; padding:12px; margin-top:16px; }
h3 { font-size:.95rem; color:#444; margin:0 0 6px; }
.hint { font-size:.75rem; color:#888; margin:0 0 10px; line-height:1.6; }
.new-row { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:10px; }
.new-row input, .new-row select { padding:8px; border:1px solid #ddd; border-radius:8px; font-size:.85rem; flex:1 1 130px; }
.new-row button { padding:8px 16px; border:none; border-radius:8px; background:var(--gold); color:#fff; font-size:.85rem; cursor:pointer; }
.msg { font-size:.8rem; color:#444; margin:6px 0; }
table { width:100%; border-collapse:collapse; }
th, td { padding:8px; border-bottom:1px solid #eee; font-size:.82rem; text-align:left; }
th { color:#888; font-weight:500; }
.badge { padding:2px 8px; border-radius:10px; font-size:.72rem; }
.badge.admin { background:#fdf6e3; color:#a8801a; }
.badge.viewer { background:#eef4fd; color:#3a6ea5; }
.badge.on { background:#eafaf0; color:var(--green); }
.badge.off { background:#f0f0f0; color:#999; }
.ops { display:flex; gap:6px; flex-wrap:wrap; }
.mini { padding:4px 10px; border:1px solid #ddd; background:#fff; border-radius:6px; font-size:.75rem; color:#666; cursor:pointer; }
.mini.danger { color:var(--red); border-color:#f0c8c8; }
.empty { color:#999; text-align:center; font-size:.85rem; }
.foot { font-size:.72rem; color:#aaa; margin:10px 0 0; }
</style>
