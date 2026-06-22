<template>
  <div class="app-shell">

    <!-- ── Sidebar nav ─────────────────────────────────────────── -->
    <aside class="sidebar">
      <div class="sidebar-logo">
        <span class="logo-mark">⬡</span>
        <span class="logo-text">Bakesail</span>
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

      <!-- Connection status at sidebar bottom -->
      <div class="sidebar-status">
        <div class="conn-dot" :class="connClass"></div>
        <span class="conn-label">{{ connLabel }}</span>
      </div>
    </aside>

    <!-- ── Main content ────────────────────────────────────────── -->
    <main class="content">
      <RouterView />
    </main>

  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { tabs } from './router/index.js'
import { useMoonraker } from './composables/useMoonraker.js'
import { useDeviceStore } from './stores/device.js'

const route      = useRoute()
const router     = useRouter()
const store      = useDeviceStore()
const { connected, klippyState, connect } = useMoonraker()

// Hide Alignment tab unless semi-auto machine type is configured
const visibleTabs = computed(() =>
  tabs.filter(t => !t.meta?.requiresSemiAuto || store.isSemiAuto)
)

const connClass = computed(() => {
  if (!connected.value) return 'dot-off'
  if (klippyState.value === 'ready') return 'dot-ready'
  return 'dot-connecting'
})

const connLabel = computed(() => {
  if (!connected.value)               return 'Disconnected'
  if (klippyState.value === 'ready')  return 'Connected'
  if (klippyState.value === 'shutdown') return 'Klipper shutdown'
  return 'Connecting…'
})

onMounted(async () => {
  connect()
  await checkFirstRun()
})

async function checkFirstRun() {
  try {
    const res = await fetch('/server/files/config/bakesail.cfg')
    if (!res.ok) {
      // bakesail.cfg doesn't exist — run the wizard
      router.push('/wizard')
    }
  } catch {
    router.push('/wizard')
  }
}
</script>

<style>
/* ── Reset + global tokens ─────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg:          #0A0A0A;
  --surface:     #141414;
  --surface-2:   #1C1C1C;
  --border:      #272727;
  --border-2:    #333;

  --text:        #E8E8E8;
  --text-dim:    #888;
  --text-muted:  #444;

  --amber:       #E8820C;
  --amber-dim:   #7A4406;
  --amber-glow:  rgba(232, 130, 12, 0.12);
  --teal:        #2DBFB8;
  --teal-glow:   rgba(45, 191, 184, 0.12);
  --red:         #E04545;
  --red-glow:    rgba(224, 69, 69, 0.12);
  --green:       #4CAF7D;

  --font-ui:     'Inter', system-ui, sans-serif;
  --font-mono:   'JetBrains Mono', 'Courier New', monospace;

  --sidebar-w:   220px;
  --radius:      6px;
  --radius-lg:   10px;
}

html, body {
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

a { color: inherit; text-decoration: none; }

/* ── App shell ─────────────────────────────────────────────────── */
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ── Sidebar ───────────────────────────────────────────────────── */
.sidebar {
  width: var(--sidebar-w);
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 0;
}

.sidebar-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 24px 20px 20px;
  border-bottom: 1px solid var(--border);
}

.logo-mark {
  font-size: 22px;
  color: var(--amber);
  line-height: 1;
}

.logo-text {
  font-family: var(--font-mono);
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--text);
}

/* ── Nav items ─────────────────────────────────────────────────── */
.sidebar-nav {
  flex: 1;
  padding: 12px 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  color: var(--text-dim);
  font-size: 13px;
  font-weight: 500;
  transition: color 0.15s, background 0.15s;
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
  font-size: 15px;
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

/* ── Connection status ─────────────────────────────────────────── */
.sidebar-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  border-top: 1px solid var(--border);
}

.conn-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-off         { background: var(--text-muted); }
.dot-connecting  { background: var(--amber); opacity: 0.6; }
.dot-ready       { background: var(--green); box-shadow: 0 0 6px var(--green); }

.conn-label {
  font-size: 12px;
  color: var(--text-dim);
  font-family: var(--font-mono);
}

/* ── Content area ──────────────────────────────────────────────── */
.content {
  flex: 1;
  overflow-y: auto;
  padding: 28px;
}

/* ── Shared component utilities ────────────────────────────────── */
.page-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 24px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
}

.stub-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 48px 32px;
  text-align: center;
  color: var(--text-muted);
}

.stub-card h2 {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-dim);
  margin-bottom: 8px;
}

.stub-card p {
  font-size: 13px;
}

/* ── Buttons ───────────────────────────────────────────────────── */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 9px 18px;
  border-radius: var(--radius);
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: opacity 0.15s, background 0.15s;
}

.btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--amber);
  color: #000;
  border-color: var(--amber);
}

.btn-primary:not(:disabled):hover {
  opacity: 0.85;
}

.btn-ghost {
  background: transparent;
  color: var(--text-dim);
  border-color: var(--border-2);
}

.btn-ghost:not(:disabled):hover {
  background: var(--surface-2);
  color: var(--text);
}

.btn-danger {
  background: transparent;
  color: var(--red);
  border-color: var(--red);
}

.btn-danger:not(:disabled):hover {
  background: var(--red-glow);
}
</style>
