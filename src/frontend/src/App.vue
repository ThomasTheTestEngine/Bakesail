<template>
  <div class="app-shell">

    <!-- ── Sidebar ────────────────────────────────────────────────── -->
    <aside class="sidebar">
      <div class="sidebar-logo">
        <img
          :src="isDark ? '/bakesail_logo_dark.png' : '/bakesail_logo_light.png'"
          alt="Bakesail"
          class="logo-img"
          :class="isDark ? 'logo-img--dark' : 'logo-img--light'"
        />
      </div>

      <nav class="sidebar-nav">
        <RouterLink
          v-for="tab in visibleTabs"
          :key="tab.name"
          :to="tab.path"
          class="nav-item"
          :class="{ active: route.name === tab.name }"
        >
          <span class="nav-icon">{{ tab.icon }}</span>
          <span class="nav-label">{{ tab.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <!-- Mainsail link -->
        <a class="mainsail-btn" :href="`http://${host}:8888`" target="_blank" rel="noopener">
          ⊞ Mainsail ↗
        </a>
        <!-- Connection status + theme toggle -->
        <div class="conn-row">
          <div style="display:flex;align-items:center;gap:7px">
            <div class="conn-dot" :class="connClass"></div>
            <span class="conn-label">{{ connLabel }}</span>
          </div>
          <button class="theme-toggle" @click="toggleTheme" :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'">
            {{ isDark ? '☀' : '☾' }}
          </button>
        </div>
      </div>
    </aside>

    <!-- ── Content ────────────────────────────────────────────────── -->
    <main class="content">
      <RouterView />
    </main>

  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { tabsForDevice } from './router/index.js'
import { useMoonraker } from './composables/useMoonraker.js'
import { useDeviceStore } from './stores/device.js'
import { useSettingsStore } from './stores/settings.js'

const route    = useRoute()
const router   = useRouter()
const store    = useDeviceStore()
const settings = useSettingsStore()
const { connected, klippyState, connect } = useMoonraker()
const host = window.location.hostname

const visibleTabs = computed(() => tabsForDevice(settings.deviceType || 'oven'))

// ── Theme ─────────────────────────────────────────────────────────
const isDark = ref(true)

function applyTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
  localStorage.setItem('bakesail-theme', dark ? 'dark' : 'light')
}

function toggleTheme() {
  isDark.value = !isDark.value
  applyTheme(isDark.value)
}

// ── Connection ────────────────────────────────────────────────────
const connClass = computed(() => {
  if (!connected.value)                 return 'dot-off'
  if (klippyState.value === 'ready')    return 'dot-ready'
  return 'dot-connecting'
})

const connLabel = computed(() => {
  if (!connected.value)                     return 'Disconnected'
  if (klippyState.value === 'ready')        return 'Connected'
  if (klippyState.value === 'shutdown')     return 'Klipper shutdown'
  return 'Connecting…'
})

// ── First run detection ───────────────────────────────────────────
async function checkFirstRun() {
  try {
    const res = await fetch('/server/files/config/bakesail.cfg')
    if (!res.ok) router.push('/wizard')
  } catch {
    router.push('/wizard')
  }
}

onMounted(() => {
  // Restore theme preference
  const saved = localStorage.getItem('bakesail-theme')
  isDark.value = saved !== 'light'
  applyTheme(isDark.value)

  connect()
  checkFirstRun()
})
</script>

<style>
/* ============================================================
   Reset + CSS custom properties
   Two themes: [data-theme="dark"] (default) and [data-theme="light"]
   Logo palette: pink #F07FAA · yellow #F0D87A · blue #80B4E0
   ============================================================ */

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

/* ── Dark theme (default) ──────────────────────────────────── */
:root, [data-theme="dark"] {
  --bg:          #0A0A0A;
  --surface:     #141414;
  --surface-2:   #1C1C1C;
  --border:      #272727;
  --border-2:    #333;

  --text:        #E8E8E8;
  --text-dim:    #888;
  --text-muted:  #444;

  /* Logo palette as UI accents */
  --amber:       #F07FAA;   /* pink — active / running / primary */
  --amber-dim:   #7A3558;
  --amber-glow:  rgba(240, 127, 170, 0.12);

  --teal:        #80B4E0;   /* blue — dwelling / info */
  --teal-glow:   rgba(128, 180, 224, 0.12);

  --yellow:      #F0D87A;   /* yellow — highlights */
  --yellow-glow: rgba(240, 216, 122, 0.12);

  --red:         #E05555;
  --red-glow:    rgba(224, 85, 85, 0.12);

  --green:       #4CAF7D;

  --font-ui:   'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Courier New', monospace;

  --sidebar-w:  220px;
  --radius:     6px;
  --radius-lg:  10px;
}

/* ── Light theme ───────────────────────────────────────────── */
[data-theme="light"] {
  --bg:          #F5F2F7;   /* very slight lavender tint */
  --surface:     #FFFFFF;
  --surface-2:   #EDE8F2;
  --border:      #DDD8E4;
  --border-2:    #C8C0D4;

  --text:        #1A1520;
  --text-dim:    #5A5266;
  --text-muted:  #A099B0;

  --amber:       #C8507A;   /* deeper pink for light mode readability */
  --amber-dim:   #8B2850;
  --amber-glow:  rgba(200, 80, 122, 0.10);

  --teal:        #4A88C0;   /* deeper blue */
  --teal-glow:   rgba(74, 136, 192, 0.10);

  --yellow:      #C8A020;   /* deeper yellow/gold */
  --yellow-glow: rgba(200, 160, 32, 0.10);

  --red:         #C83030;
  --red-glow:    rgba(200, 48, 48, 0.08);

  --green:       #2A8A50;
}

html, body {
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  transition: background 0.2s, color 0.2s;
}

a { color: inherit; text-decoration: none; }

/* ── App shell ──────────────────────────────────────────────── */
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ── Sidebar ────────────────────────────────────────────────── */
.sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

/* ── Logo ───────────────────────────────────────────────────── */
.sidebar-logo {
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-img {
  width: 148px;
  height: auto;
  display: block;
}

/* Blend out solid backgrounds so only the logo art shows */
.logo-img--dark  { mix-blend-mode: screen;   }
.logo-img--light { mix-blend-mode: multiply; }

/* ── Nav ────────────────────────────────────────────────────── */
.sidebar-nav {
  flex: 1;
  padding: 10px 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 18px;
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 500;
  transition: color 0.12s, background 0.12s;
  border-left: 2px solid transparent;
  cursor: pointer;
}

.nav-item:hover {
  color: var(--text);
  background: var(--surface-2);
}

.nav-item.active {
  color: var(--amber);
  background: var(--amber-glow);
  border-left-color: var(--amber);
}

.nav-icon {
  font-size: 14px;
  width: 18px;
  text-align: center;
  flex-shrink: 0;
  line-height: 1;
}

.nav-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ── Sidebar footer ─────────────────────────────────────────── */
.sidebar-footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

.mainsail-btn {
  display: block;
  padding: 6px 10px;
  border-radius: var(--radius);
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
  text-decoration: none;
}
.mainsail-btn:hover {
  color: var(--text);
  border-color: var(--border-2);
  background: var(--surface-2);
}

.conn-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 7px;
}

.conn-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot-off         { background: var(--text-muted); }
.dot-connecting  { background: var(--amber); opacity: 0.6; }
.dot-ready       { background: var(--green); box-shadow: 0 0 5px var(--green); }

.conn-label {
  font-size: 11px;
  color: var(--text-dim);
  font-family: var(--font-mono);
}

.theme-toggle {
  width: 28px; height: 28px;
  border-radius: var(--radius);
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--text-dim);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s, color 0.12s;
  flex-shrink: 0;
}
.theme-toggle:hover { background: var(--surface-2); color: var(--text); }

/* ── Content ────────────────────────────────────────────────── */
.content {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
}

/* ── Shared utilities ───────────────────────────────────────── */
.page-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 20px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 18px 20px;
}

.stub-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 48px 32px;
  text-align: center;
  color: var(--text-muted);
}
.stub-card h2 { font-size: 15px; font-weight: 500; color: var(--text-dim); margin-bottom: 8px; }
.stub-card p  { font-size: 13px; }

/* ── Buttons ────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--radius);
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 0.12s, background 0.12s, color 0.12s, border-color 0.12s;
}
.btn:disabled { opacity: 0.35; cursor: not-allowed; }

.btn-primary {
  background: var(--amber);
  color: #fff;
  border-color: var(--amber);
}
.btn-primary:not(:disabled):hover { opacity: 0.85; }

.btn-ghost {
  background: transparent;
  color: var(--text-dim);
  border-color: var(--border-2);
}
.btn-ghost:not(:disabled):hover { background: var(--surface-2); color: var(--text); }

.btn-danger {
  background: transparent;
  color: var(--red);
  border-color: var(--red);
}
.btn-danger:not(:disabled):hover { background: var(--red-glow); }
</style>
