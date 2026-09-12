<script setup>
import { ref } from 'vue'
import Kiosk from './views/Kiosk.vue'
import Admin from './views/Admin.vue'

const view = ref('kiosk')
</script>

<template>
  <div class="app">
    <header class="topbar">
      <span class="brand">城市酒店 · 点评</span>
      <nav>
        <button :class="{active: view==='kiosk'}" @click="view='kiosk'">点评台</button>
        <button :class="{active: view==='admin'}" @click="view='admin'">后台</button>
      </nav>
    </header>
    <main>
      <Kiosk v-if="view==='kiosk'" />
      <Admin v-else />
    </main>
  </div>
</template>

<style>
:root { --gold:#c9a84c; --green:#2e9e5b; --red:#d9534f; }
* { box-sizing: border-box; }
body { margin:0; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; background:#f5f3ee; color:#333; }
.app { max-width: 720px; margin: 0 auto; min-height: 100vh; }
.topbar { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; background:#fff; border-bottom:1px solid #eee; }
.brand { font-weight:700; color:var(--gold); }
.topbar nav button { border:none; background:none; margin-left:12px; padding:6px 10px; cursor:pointer; color:#666; border-radius:6px; }
.topbar nav button.active { background:var(--gold); color:#fff; }
main { padding:16px; }
</style>
