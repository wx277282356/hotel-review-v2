<script setup>
import { ref } from 'vue'
import Kiosk from './views/Kiosk.vue'
import Admin from './views/Admin.vue'

// 路由由 URL 参数决定（未引入 vue-router，保持轻量）：
//   ?room=601   → 客房扫码进入的客人点评页（隐藏导航）
//   ?admin=1    → 后台管理页（隐藏导航）
//   无参数      → 开发/前台模式，显示导航可切换
const params = new URLSearchParams(window.location.search)
const roomParam = params.get('room')
const adminParam = params.get('admin')
const guestMode = !!roomParam
const view = ref(adminParam === '1' ? 'admin' : 'kiosk')
// LOGO 路径（默认随 GitHub Pages 子路径适配；若后台已上传自定义 LOGO，会在启动后自动替换）
import { logoUrl } from './utils/logo.js'
// 酒店名称等文案取自"站点设置"，不写死在界面里（后台改名后这里自动跟着变）
import { settings } from './utils/settings.js'
</script>

<template>
  <div class="app">
    <header v-if="!guestMode" class="topbar">
      <span class="brand"><img class="brand-logo" :src="logoUrl" alt="" />{{ settings.hotelName }} · 点评</span>
      <nav>
        <button :class="{active: view==='kiosk'}" @click="view='kiosk'">点评台</button>
        <button :class="{active: view==='admin'}" @click="view='admin'">后台</button>
      </nav>
    </header>
    <main :class="{flush: guestMode}">
      <Kiosk v-if="view==='kiosk'" />
      <Admin v-else />
    </main>
  </div>
</template>

<style>
:root { --gold:#c9a84c; --green:#2d7a4a; --red:#8c3333; }
* { box-sizing: border-box; }
body { margin:0; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background:#f5f3ee; color:#333; }
.app { max-width: 720px; margin: 0 auto; min-height: 100vh; }
.topbar { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; background:#fff; border-bottom:1px solid #eee; }
.brand { font-weight:700; color:var(--gold); display:flex; align-items:center; }
.brand-logo { width:24px; height:24px; border-radius:6px; margin-right:6px; }
.topbar nav button { border:none; background:none; margin-left:12px; padding:6px 10px; cursor:pointer; color:#666; border-radius:6px; }
.topbar nav button.active { background:var(--gold); color:#fff; }
main { padding:16px; }
main.flush { padding:0; }
</style>
