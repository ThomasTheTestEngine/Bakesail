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

    <!-- ── Content column (topbar + page) ───────────────────────── -->
    <div class="content-col">

      <!-- Topbar — visible on all tabs -->
      <header class="topbar">
        <!-- Left: printer / klippy status + action buttons -->
        <div class="topbar-left">
          <span class="topbar-status-dot" :style="{ background: topbarColour }"></span>
          <span class="topbar-status-label">{{ topbarLabel }}</span>

          <!-- Quick actions: only meaningful when klippy is ready -->
          <template v-if="klippyState === 'ready'">
            <div class="topbar-divider"></div>
            <!-- Home: blue when homed, dim blue when not -->
            <button class="topbar-btn topbar-btn--action"
                    :class="isHomed ? 'topbar-btn--home-set' : 'topbar-btn--home-unset'"
                    @click="topbarGcode('G28')" title="Home All">
<i class="mdi mdi-home" style="font-size:15px;margin-right:3px;vertical-align:-2px"></i>Home
            </button>
            <!-- QGL: pink when leveled, dim pink when not -->
            <button class="topbar-btn topbar-btn--action"
                    :class="deviceStore.qglApplied ? 'topbar-btn--qgl-set' : 'topbar-btn--qgl-unset'"
                    @click="topbarGcode('QUAD_GANTRY_LEVEL')" title="Quad Gantry Level">
<i class="mdi mdi-arrow-collapse-vertical" style="font-size:15px;margin-right:3px;vertical-align:-2px"></i>QGL
            </button>
            <!-- Motors: yellow when on, dim yellow when off -->
            <button class="topbar-btn topbar-btn--action"
                    :class="deviceStore.motorsEnabled ? 'topbar-btn--motors-on' : 'topbar-btn--motors-off'"
                    @click="topbarToggleMotors"
                    :title="deviceStore.motorsEnabled ? 'Disable motors' : 'Enable motors'">
<i class="mdi mdi-engine-off" style="font-size:16px;vertical-align:-2px"></i>
            </button>
          </template>
        </div>

        <!-- ── Pinned macro chips (outside topbar-left so overflow:hidden doesn't clip dropdown) -->
        <template v-if="klippyState === 'ready'">
          <div class="topbar-divider" v-if="(settings.pinnedMacros?.length > 0) || editMode.editing.value"></div>
          <div class="topbar-macros" ref="macroBarEl">
            <div v-for="(m, i) in (settings.pinnedMacros ?? [])" :key="m.id"
                 class="topbar-macro-chip"
                 :class="{ 'topbar-macro-chip--edit': editMode.editing.value }"
                 :draggable="editMode.editing.value"
                 @dragstart="macroDragStart(i)"
                 @dragover.prevent="macroDragOver(i)"
                 @dragend="macroDragEnd"
                 @click="!editMode.editing.value && runMacro(m)">
              <button v-if="editMode.editing.value" class="topbar-macro-remove" @click.stop="removeMacro(i)" title="Remove">−</button>
              <span class="topbar-macro-name">{{ m.name }}</span>
            </div>

            <!-- Add macro button (edit mode only) -->
            <div v-if="editMode.editing.value" class="topbar-macro-add-wrap" ref="macroAddEl">
              <button class="topbar-macro-add-btn" @click.stop="toggleMacroMenu" title="Add macro">+</button>
            </div>
          </div>

          <!-- Macro dropdown — Teleported to body so topbar overflow can't clip it -->
          <Teleport to="body">
            <div v-if="macroMenuOpen" class="topbar-macro-backdrop" @click="macroMenuOpen = false" />
            <div v-if="macroMenuOpen" class="topbar-macro-menu" :style="macroMenuStyle">
              <div class="topbar-macro-menu-section">Klipper Macros</div>
              <div v-if="availableKlipperMacros.length === 0" class="topbar-macro-menu-item" style="opacity:0.5;cursor:default">No macros found</div>
              <button v-for="name in availableKlipperMacros" :key="name"
                      class="topbar-macro-menu-item"
                      :disabled="isPinned(name)"
                      @click="addMacro(name)">
                {{ name }}<span v-if="isPinned(name)" style="opacity:0.4;font-size:10px"> ✓</span>
              </button>
              <div class="topbar-macro-menu-section" style="margin-top:6px">Custom</div>
              <button class="topbar-macro-menu-item" @click="addCustomMacro">+ New custom…</button>
            </div>
          </Teleport>
        </template>

        <!-- Center: file + progress (shown when printing/paused/complete) -->
        <div class="topbar-center" v-if="klippyState === 'ready' && deviceStore.printerState !== 'standby'">
          <div class="topbar-file">
            <span class="topbar-filename">{{ deviceStore.filename || 'No file' }}</span>
            <span class="topbar-pct" v-if="deviceStore.progress > 0">{{ (deviceStore.progress * 100).toFixed(1) }}%</span>
          </div>
          <div class="topbar-progress-track" v-if="deviceStore.progress > 0">
            <div class="topbar-progress-fill" :style="{ width: (deviceStore.progress * 100).toFixed(1) + '%' }"></div>
          </div>
          <span class="topbar-eta" v-if="deviceStore.progress > 0 && deviceStore.progress < 1 && deviceStore.printDuration > 0">
            ETA {{ topbarEta }}
          </span>
        </div>

        <!-- Right: print controls + system buttons -->
        <div class="topbar-actions">
          <!-- Load file button — always visible when klippy ready and not printing -->
          <button v-if="klippyState === 'ready' && deviceStore.printerState === 'standby'"
                  class="topbar-btn topbar-btn--lit" @click="openFileDialog" title="Load file">
<i class="mdi mdi-file-upload-outline" style="font-size:14px;margin-right:3px;vertical-align:-2px"></i>Load
          </button>
          <!-- Pause/Resume + Cancel — shown when printing or paused -->
          <template v-if="deviceStore.printerState === 'printing' || deviceStore.printerState === 'paused'">
            <button class="topbar-btn"
                    @click="topbarGcode(deviceStore.printerState === 'printing' ? 'PAUSE' : 'RESUME')">
              {{ deviceStore.printerState === 'printing' ? '⏸ Pause' : '▶ Resume' }}
            </button>
            <button class="topbar-btn topbar-btn--danger" @click="topbarGcode('CANCEL_PRINT')">✕ Cancel</button>
          </template>
          <!-- FW/Power dropdown -->
          <div class="topbar-dropdown-wrap" @click.stop>
            <button class="topbar-btn" @click="powerMenuOpen = !powerMenuOpen" title="System Controls">
              <i class="mdi mdi-power" style="font-size:16px"></i>
            </button>
            <div v-if="powerMenuOpen" class="topbar-dropdown" @click="powerMenuOpen = false">
              <div class="topbar-dropdown-section">Klipper Control</div>
              <button class="topbar-dropdown-item" @click="klipperRestart">↺ Restart</button>
              <button class="topbar-dropdown-item" @click="firmwareRestart">↺ Firmware Restart</button>
              <div class="topbar-dropdown-section">Host Control</div>
              <button class="topbar-dropdown-item topbar-dropdown-item--danger" @click="hostReboot">⏻ Reboot</button>
              <button class="topbar-dropdown-item topbar-dropdown-item--danger" @click="hostShutdown">⏻ Shutdown</button>
            </div>
          </div>

          <button class="topbar-btn topbar-btn--estop" @click="emergencyStop" title="Emergency Stop">
            <i class="mdi mdi-octagon" style="font-size:14px;margin-right:4px;vertical-align:-2px"></i>E-Stop
          </button>

          <!-- Slot for page-specific topbar content (e.g. customize gear) -->
          <div id="topbar-page-slot"></div>
        </div>
      </header>

      <!-- ── Console bar ─────────────────────────────────────────── -->
      <div class="cbar" :style="cbarOpen ? { height: cbarHeight + 'px' } : {}" ref="cbarEl">

        <!-- COLLAPSED: show last line + expand button -->
        <div v-if="!cbarOpen" class="cbar-collapsed" @click="cbarExpand()">
          <i class="mdi mdi-code-greater-than cbar-prompt-icon"></i>
          <span class="cbar-last-line">{{ cbarLastLine || 'Console…' }}</span>
          <button class="cbar-btn" @click.stop="cbarExpand()" title="Expand console">
            <i class="mdi mdi-chevron-down"></i>
          </button>
        </div>

        <!-- EXPANDED -->
        <template v-else>

          <!-- Console mode: scrollable line list -->
          <div v-if="!cbarTerminal" class="cbar-output" ref="cbarOutputEl" @scroll="cbarOnScroll">
            <div v-for="(line, i) in cbarLines" :key="i" class="cbar-line" :class="cbarLineClass(line)">
              <span class="cbar-line-time">{{ line.time }}</span>
              <span class="cbar-line-text" v-html="cbarColourize(line.text)"></span>
            </div>
          </div>

          <!-- Terminal mode: xterm.js fills the space -->
          <div v-else ref="xtermEl" class="cbar-xterm"></div>

          <!-- Input row — always at bottom -->
          <div class="cbar-input-row">
            <i :class="cbarTerminal ? 'mdi mdi-bash' : 'mdi mdi-chevron-right'" class="cbar-prompt-icon"></i>
            <!-- Terminal mode: xterm captures keyboard directly when focused -->
            <span v-if="cbarTerminal" class="cbar-xterm-hint" @click="xtermFocus()" title="Click terminal to focus">
              <i class="mdi mdi-keyboard" style="font-size:14px;opacity:0.4"></i>
            </span>
            <input v-else ref="cbarInputEl" class="cbar-input" v-model="cbarInput"
                   placeholder="Klipper command…"
                   @keydown.enter="cbarSubmit"
                   @keydown.up.prevent="cbarHistoryUp"
                   @keydown.down.prevent="cbarHistoryDown"
                   spellcheck="false" autocomplete="off" autocapitalize="off" autocorrect="off" />
            <div class="cbar-mode-toggle">
              <button :class="['cbar-mode-btn', !cbarTerminal ? 'cbar-mode-btn--active' : '']"
                      @click="cbarTerminal && (cbarTerminal=false, cbarScrollBottom())">Console</button>
              <button :class="['cbar-mode-btn', cbarTerminal ? 'cbar-mode-btn--active' : '']"
                      @click="!cbarTerminal && cbarSetTerminal(true)">Terminal</button>
            </div>
            <button class="cbar-btn" @click="cbarClear" title="Clear"><i class="mdi mdi-delete-sweep-outline"></i></button>
            <button v-if="!cbarTerminal" class="cbar-btn cbar-send" @click="cbarSubmit" title="Send"><i class="mdi mdi-send"></i></button>
            <div class="cbar-divider-v"></div>
            <button class="cbar-btn" @click.stop="cbarCollapse()" title="Minimize console">
              <i class="mdi mdi-arrow-collapse-up"></i>
            </button>
          </div>

          <!-- Drag-resize handle at very bottom -->
          <div class="cbar-resize-handle" @mousedown="cbarDragStart">
            <i class="mdi mdi-drag-horizontal cbar-drag-icon"></i>
          </div>

        </template>

      </div>

      <main class="content">
        <RouterView />
      </main>

    </div>

    <!-- File load dialog -->
    <div v-if="showFileDialog" class="file-dialog-backdrop" @click.self="showFileDialog = false">
      <div class="file-dialog">
        <div class="file-dialog-header">
          <span class="file-dialog-title">Load File</span>
          <button class="file-dialog-close" @click="showFileDialog = false">✕</button>
        </div>
        <div class="file-dialog-body">
          <div v-if="fileLoading" class="file-dialog-empty">Loading…</div>
          <div v-else-if="!fileList.length" class="file-dialog-empty">No files found</div>
          <button v-else v-for="f in fileList" :key="f.path ?? f.filename"
                  class="file-dialog-item"
                  @click="loadFile(f.path ?? f.filename)">
            <span class="file-dialog-name">{{ (f.path ?? f.filename).split('/').pop() }}</span>
            <span class="file-dialog-meta">{{ f.size ? (f.size / 1024).toFixed(0) + ' KB' : '' }}</span>
          </button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, watch, provide } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import { tabsForDevice } from './router/index.js'
import { useEditMode } from './composables/useEditMode.js'
import { useMoonraker } from './composables/useMoonraker.js'
import { useDeviceStore } from './stores/device.js'
import { useSettingsStore } from './stores/settings.js'

const route    = useRoute()
const router   = useRouter()
const store    = useDeviceStore()
const settings = useSettingsStore()
const editMode = useEditMode()
const { connected, klippyState, connect, sendGcode, subscribeToConsole, fetchConsoleHistory } = useMoonraker()

// ── Macro bar ──────────────────────────────────────────────────────────────────
const macroMenuOpen = ref(false)
const macroBarEl    = ref(null)
const macroAddEl    = ref(null)
const macroMenuStyle = ref({})
let   macroDragIdx  = null

function toggleMacroMenu() {
  macroMenuOpen.value = !macroMenuOpen.value
  if (macroMenuOpen.value && macroAddEl.value) {
    const r = macroAddEl.value.getBoundingClientRect()
    macroMenuStyle.value = {
      position: 'fixed',
      top:  `${r.bottom + 4}px`,
      left: `${r.left}px`,
      zIndex: 9999,
    }
  }
}

const availableKlipperMacros = computed(() => {
  return Object.keys(deviceStore.dynamicObjects)
    .filter(k => k.startsWith('gcode_macro '))
    .map(k => k.replace('gcode_macro ', '').toUpperCase())
    .sort()
})

function isPinned(name) { return settings.pinnedMacros.some(m => m.name === name) }

function addMacro(name) {
  if (isPinned(name)) return
  settings.pinnedMacros.push({ id: Date.now().toString(36), name })
  settings.save()
  macroMenuOpen.value = false
}

async function addCustomMacro() {
  const name = prompt('Macro name (the gcode command to send):')
  if (!name?.trim()) return
  settings.pinnedMacros.push({ id: Date.now().toString(36), name: name.trim().toUpperCase() })
  settings.save()
  macroMenuOpen.value = false
}

function removeMacro(i) {
  settings.pinnedMacros.splice(i, 1)
  settings.save()
}

function runMacro(m) {
  sendGcode(m.name)
}

function macroDragStart(i) { macroDragIdx = i }
function macroDragOver(i) {
  if (macroDragIdx === null || macroDragIdx === i) return
  const arr = settings.pinnedMacros
  const item = arr.splice(macroDragIdx, 1)[0]
  arr.splice(i, 0, item)
  macroDragIdx = i
}
function macroDragEnd() { macroDragIdx = null; settings.save() }

// Close macro menu on outside click
if (typeof window !== 'undefined') {
  window.addEventListener('click', () => { macroMenuOpen.value = false })
}

// ── Console bar ────────────────────────────────────────────────
const cbarOpen       = ref(false)
const cbarHeight     = ref(240)       // px when open
const cbarLines      = ref([])
const cbarLastLine   = ref('')
const cbarInput      = ref('')
const cbarTerminal   = ref(false)
const cbarOutputEl   = ref(null)
const cbarInputEl    = ref(null)
const cbarTermEl     = ref(null)
const cbarEl         = ref(null)
const cbarAutoScroll = ref(true)
const cbarTermOutput = ref('')
const cbarPromptLine  = ref('')
const xtermEl         = ref(null)
let   xterm           = null
let   xtermFitAddon   = null
const cbarHistory    = ref([])
const cbarHistIdx    = ref(-1)
let   cbarTermWs     = null
let   cbarDragY      = null
const CBAR_MAX       = 500

const CBAR_COLOURS = {
  30:'#555',31:'#e05555',32:'#4caf7d',33:'#f0d87a',
  34:'#80b4e0',35:'#c678dd',36:'#56b6c2',37:'#e8e8e8',
  90:'#888',91:'#e06c75',92:'#98c379',93:'#e5c07b',
  94:'#61afef',95:'#c678dd',96:'#56b6c2',97:'#fff',
}

function cbarLineClass(line) {
  if (line.type === 'cmd')   return 'cbar-line--cmd'
  if (line.type === 'error') return 'cbar-line--error'
  if (line.type === 'warn')  return 'cbar-line--warn'
  return 'cbar-line--response'
}

function cbarColourize(text) {
  text = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  return text
}

function cbarParseLine(raw) {
  const text = raw.trim()
  if (!text) return null
  let type = 'response'
  if (text.startsWith('//') || text.startsWith('echo:'))  type = 'info'
  if (text.startsWith('!!'))   type = 'error'
  if (/^(?:echo:\s*)?warn/i.test(text)) type = 'warn'
  if (text.startsWith('> '))   type = 'cmd'
  const now = new Date()
  const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`
  return { text, type, time }
}

function cbarAddLine(raw) {
  const line = cbarParseLine(raw)
  if (!line) return
  cbarLastLine.value = line.text
  cbarLines.value.push(line)
  if (cbarLines.value.length > CBAR_MAX) cbarLines.value.splice(0, cbarLines.value.length - CBAR_MAX)
  if (cbarAutoScroll.value) nextTick(cbarScrollBottom)
}

function cbarScrollBottom() {
  const el = cbarOutputEl.value
  if (el) el.scrollTop = el.scrollHeight
}

function cbarOnScroll() {
  const el = cbarOutputEl.value
  if (!el) return
  cbarAutoScroll.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
}

function cbarExpand() {
  cbarOpen.value = true
  nextTick(() => { cbarScrollBottom(); cbarInputEl.value?.focus() })
}

// Focus input when clicking anywhere in the cbar
function cbarFocusInput() { cbarInputEl.value?.focus() }

function cbarCollapse() {
  cbarOpen.value = false
  // Destroy xterm — xtermEl will be removed from DOM, recreate on next open
  if (xterm) { xterm.dispose(); xterm = null; xtermFitAddon = null }
  if (cbarTermWs) { cbarTermWs.close(); cbarTermWs = null }
}

// Drag-to-resize the console (bottom footer bar)
function cbarDragStart(e) {
  e.preventDefault()
  const startY = e.clientY
  const startH = cbarHeight.value
  function onMove(ev) {
    // drag DOWN = smaller (handle is at bottom, pulling down shrinks from top perspective)
    // drag UP = larger
    const delta = ev.clientY - startY
    cbarHeight.value = Math.max(80, Math.min(window.innerHeight * 0.85, startH + delta))
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function cbarClear() {
  if (cbarTerminal.value) cbarTermOutput.value = ''
  else cbarLines.value = []
}

function cbarAnsiToHtml(text) {
  text = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  text = text.replace(/\[([0-9;]*)m/g, (_, codes) => {
    const parts = codes.split(';').map(Number)
    let span = ''
    for (const code of parts) {
      if (code === 0) span += '</span>'
      else if (CBAR_COLOURS[code]) span += `<span style="color:${CBAR_COLOURS[code]}">`
    }
    return span
  })
  return text
}

function xtermFocus() { xterm?.focus() }

function cbarSetTerminal(val) {
  if (cbarTermWs) { cbarTermWs.close(); cbarTermWs = null }
  if (xterm) { xterm.dispose(); xterm = null; xtermFitAddon = null }
  cbarTerminal.value = val
  if (!val) { nextTick(cbarScrollBottom); return }

  nextTick(() => {
    if (!xtermEl.value) return
    const cs = getComputedStyle(document.documentElement)
    xterm = new Terminal({
      theme: {
        background: '#0d0d0d',
        foreground: cs.getPropertyValue('--text').trim() || '#e8e8e8',
        cursor:     cs.getPropertyValue('--teal').trim() || '#4ec9b0',
        green: '#98c379', yellow: '#e5c07b', blue: '#61afef',
        magenta: '#c678dd', cyan: '#56b6c2', red: '#e06c75',
      },
      fontFamily: cs.getPropertyValue('--font-mono').trim() || 'monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 1000,
      convertEol: true,
    })
    xtermFitAddon = new FitAddon()
    xterm.loadAddon(xtermFitAddon)
    xterm.open(xtermEl.value)
    xtermFitAddon.fit()
    xterm.focus()

    xterm.onData(data => {
      if (cbarTermWs?.readyState === WebSocket.OPEN) cbarTermWs.send('0' + data)
    })

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/terminal/ws`, ['tty'])
    ws.binaryType = 'arraybuffer'
    ws.onopen = () => { ws.send(JSON.stringify({ AuthToken: '', columns: xterm.cols, rows: xterm.rows })) }
    ws.onmessage = e => {
      let text = null
      if (e.data instanceof ArrayBuffer) {
        const buf = new Uint8Array(e.data)
        if (buf[0] === 48) text = new TextDecoder().decode(buf.slice(1))
      } else if (typeof e.data === 'string' && e.data[0] === '0') {
        text = e.data.slice(1)
      }
      if (text !== null) xterm?.write(text)
    }
    ws.onclose = () => xterm?.write('\r\n\x1b[33m[disconnected — session ended]\x1b[0m\r\n')
    ws.onerror = () => xterm?.write('\r\n\x1b[31m[connection failed]\x1b[0m\r\n')
    cbarTermWs = ws
  })
}


async function cbarSubmit() {
  const text = cbarInput.value
  if (!text.trim()) return
  cbarHistory.value.unshift(text.trim())
  if (cbarHistory.value.length > 100) cbarHistory.value.pop()
  cbarHistIdx.value = -1
  cbarInput.value = ''
  if (cbarTerminal.value) {
    if (cbarTermWs?.readyState === WebSocket.OPEN) {
      // ttyd input: binary frame with '0' prefix + text
      const inputStr = '0' + text + '\n'
      cbarTermWs.send(new TextEncoder().encode(inputStr).buffer)
    } else {
      cbarTermOutput.value += `<span style="color:#e05555">[not connected — click Console/Shell to connect]</span>\n`
    }
  } else {
    cbarAddLine('> ' + text.trim())
    sendGcode(text.trim()).catch(e => cbarAddLine('!! ' + (e.message ?? e)))
  }
}

function cbarHistoryUp() {
  if (!cbarHistory.value.length) return
  cbarHistIdx.value = Math.min(cbarHistIdx.value + 1, cbarHistory.value.length - 1)
  cbarInput.value = cbarHistory.value[cbarHistIdx.value]
}
function cbarHistoryDown() {
  if (cbarHistIdx.value <= 0) { cbarHistIdx.value = -1; cbarInput.value = ''; return }
  cbarHistIdx.value--
  cbarInput.value = cbarHistory.value[cbarHistIdx.value]
}

// Subscribe to console feed
let cbarUnsub = null
onMounted(async () => {
  cbarUnsub = subscribeToConsole(cbarAddLine)
  if (klippyState.value === 'ready') {
    await fetchConsoleHistory()
    cbarScrollBottom()
  }
})
onUnmounted(() => { if (cbarUnsub) cbarUnsub(); if (cbarTermWs) cbarTermWs.close() })
watch(klippyState, async val => {
  if (val === 'ready') { await fetchConsoleHistory(); cbarScrollBottom() }
})

// Re-init xterm when console bar reopens while in terminal mode
watch(cbarOpen, async (isOpen) => {
  if (isOpen && cbarTerminal.value) {
    await nextTick()
    cbarSetTerminal(true)  // always reinit — xterm was destroyed on collapse
  }
})
const host = window.location.hostname

const deviceStore = useDeviceStore()
const visibleTabs = computed(() => {
  if (!settings._loaded) return []
  return tabsForDevice(settings.deviceType || 'oven')
})

// ── Topbar status ──────────────────────────────────────────────
// Priority: klippy offline > klippy state > printer state > idle_timeout
const PRINTER_STATE_META = {
  standby:   { label: 'Standby',   colour: 'var(--text-muted)' },
  printing:  { label: 'Printing',  colour: 'var(--amber)'      },
  paused:    { label: 'Paused',    colour: 'var(--yellow)'     },
  complete:  { label: 'Complete',  colour: 'var(--green)'      },
  error:     { label: 'Error',     colour: 'var(--red)'        },
  cancelled: { label: 'Cancelled', colour: 'var(--text-dim)'   },
}

const topbarLabel = computed(() => {
  if (!connected.value)                    return 'Disconnected'
  if (klippyState.value === 'shutdown')    return 'Klipper Shutdown'
  if (klippyState.value === 'startup')     return 'Klipper Starting…'
  if (klippyState.value !== 'ready')       return 'Connecting…'
  const ps = deviceStore.printerState
  const meta = PRINTER_STATE_META[ps]
  // If standby but Klipper is executing gcode (homing, QGL, etc.) → Busy
  if (ps === 'standby' && deviceStore.idleState === 'Printing') return 'Busy'
  return meta?.label ?? ps
})

const topbarColour = computed(() => {
  if (!connected.value)                    return 'var(--text-muted)'
  if (klippyState.value === 'shutdown')    return 'var(--red)'
  if (klippyState.value !== 'ready')       return 'var(--yellow)'
  const ps = deviceStore.printerState
  if (ps === 'standby' && deviceStore.idleState === 'Printing') return 'var(--teal)'
  return PRINTER_STATE_META[ps]?.colour ?? 'var(--text-muted)'
})

// ── Topbar actions ─────────────────────────────────────────────
// Whether the dashboard is in customize mode (used to show drag handle)
const isCustomizing = ref(false)
// PrinterDashboard teleports a signal when customize mode is active
// We expose a global setter via provide
provide('setCustomizing', (val) => { isCustomizing.value = val })

function topbarGcode(script) {
  sendGcode(script).catch(() => {})
}

function topbarToggleMotors() {
  if (deviceStore.motorsEnabled) {
    topbarGcode('M18')
    deviceStore.updatePrinter({ motorsEnabled: false })
  } else {
    topbarGcode('M17')
    deviceStore.updatePrinter({ motorsEnabled: true })
  }
}

function emergencyStop() {
  sendGcode('FIRMWARE_RESTART').catch(() => {})
  // M112 is the real e-stop — send via raw moonraker endpoint
  fetch('/printer/emergency_stop', { method: 'POST' }).catch(() => {})
}

const powerMenuOpen = ref(false)
const showFileDialog = ref(false)
const fileList       = ref([])
const fileLoading    = ref(false)

async function openFileDialog() {
  showFileDialog.value = true
  fileLoading.value = true
  try {
    const r = await fetch('/server/files/list?root=gcodes')
    const d = await r.json()
    fileList.value = (d.result ?? []).sort((a, b) => b.modified - a.modified)
  } catch { fileList.value = [] }
  fileLoading.value = false
}

async function loadFile(path) {
  await fetch(`/printer/print/start?filename=${encodeURIComponent(path)}`, { method: 'POST' }).catch(() => {})
  showFileDialog.value = false
}

function topbarFormatDuration(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// Home button lit when all XYZ homed
const isHomed = computed(() => {
  const h = deviceStore.homedAxes
  return h.includes('x') && h.includes('y') && h.includes('z')
})

const topbarEta = computed(() => {
  const { progress, printDuration } = deviceStore
  if (!progress || progress <= 0) return '—'
  const remaining = (printDuration / progress) - printDuration
  return topbarFormatDuration(remaining)
})

function klipperRestart() {
  fetch('/printer/restart', { method: 'POST' }).catch(() => {})
}

function firmwareRestart() {
  fetch('/printer/firmware_restart', { method: 'POST' }).catch(() => {})
}

function hostReboot() {
  fetch('/machine/reboot', { method: 'POST' }).catch(() => {})
}

function hostShutdown() {
  fetch('/machine/shutdown', { method: 'POST' }).catch(() => {})
}

// Close power menu on outside click
if (typeof window !== 'undefined') {
  window.addEventListener('click', () => { powerMenuOpen.value = false })
}

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

/* ── Scrollbars: hidden until hover ─────────────────────────── */
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
*:hover {
  scrollbar-color: var(--border-2) transparent;
}
::-webkit-scrollbar { width: 5px; height: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
*:hover::-webkit-scrollbar-thumb { background: var(--border-2); }

/* ── App shell ──────────────────────────────────────────────── */
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

/* ── Content column (topbar + scrollable page) ───────────────── */
.content-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── Topbar ─────────────────────────────────────────────────── */
.topbar {
  flex-shrink: 0;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  gap: 8px;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.topbar-divider {
  width: 1px;
  height: 18px;
  background: var(--border-2);
  flex-shrink: 0;
}

.topbar-btn--action {
  font-size: 11px;
  padding: 3px 10px;
}

/* ── Macro bar ──────────────────────────────────────────── */
.topbar-macros {
  display: flex; align-items: center; gap: 4px; flex-wrap: nowrap;
}

.topbar-macro-chip {
  display: flex; align-items: center; gap: 3px;
  padding: 2px 8px;
  border-radius: var(--radius);
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--text-dim);
  font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
  cursor: pointer; white-space: nowrap;
  transition: background 0.1s, color 0.1s;
  user-select: none;
}
.topbar-macro-chip:hover:not(.topbar-macro-chip--edit) {
  background: var(--surface-2); color: var(--text);
}
.topbar-macro-chip--edit {
  cursor: grab; border-color: var(--amber); color: var(--amber);
  opacity: 0.85;
}
.topbar-macro-chip--edit:active { cursor: grabbing; }

.topbar-macro-remove {
  width: 14px; height: 14px; border-radius: 50%;
  border: 1px solid currentColor; background: transparent;
  color: inherit; font-size: 12px; line-height: 1;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  padding: 0; flex-shrink: 0;
}
.topbar-macro-remove:hover { background: var(--red); border-color: var(--red); color: #fff; }

.topbar-macro-name { pointer-events: none; }

.topbar-macro-add-wrap { position: relative; }
.topbar-macro-add-btn {
  width: 22px; height: 22px; border-radius: var(--radius);
  border: 1px dashed var(--border-2); background: transparent;
  color: var(--text-muted); font-size: 16px; line-height: 1;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: border-color 0.1s, color 0.1s;
}
.topbar-macro-add-btn:hover { border-color: var(--green); color: var(--green); }

.topbar-macro-backdrop {
  position: fixed; inset: 0; z-index: 9998;
}
.topbar-macro-menu {
  min-width: 220px; max-height: 320px; overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  box-shadow: 0 8px 20px rgba(0,0,0,0.4);
  display: flex; flex-direction: column;
}
.topbar-macro-menu-section {
  font-size: 10px; font-weight: 700; letter-spacing: 0.10em;
  color: var(--text-muted); padding: 6px 10px 3px;
  border-bottom: 1px solid var(--border);
}
.topbar-macro-menu-item {
  text-align: left; padding: 6px 12px;
  font-size: 12px; color: var(--text-dim);
  background: transparent; border: none; cursor: pointer;
  width: 100%;
}
.topbar-macro-menu-item:hover:not(:disabled) { background: var(--surface-2); color: var(--text); }
.topbar-macro-menu-item:disabled { opacity: 0.45; cursor: default; }
.topbar-btn.topbar-btn--home-set   { color: var(--teal); border-color: var(--teal); }
.topbar-btn.topbar-btn--home-set:hover { background: var(--teal-glow); }

.topbar-btn.topbar-btn--qgl-unset  { color: var(--amber); border-color: var(--amber); opacity: 0.35; }
.topbar-btn.topbar-btn--qgl-set    { color: var(--amber); border-color: var(--amber); }
.topbar-btn.topbar-btn--qgl-set:hover  { background: var(--amber-glow); }

.topbar-btn.topbar-btn--motors-on  { color: var(--yellow); border-color: var(--yellow); }
.topbar-btn.topbar-btn--motors-on:hover  { background: var(--yellow-glow); }
.topbar-btn.topbar-btn--motors-off { color: var(--yellow); border-color: var(--yellow); opacity: 0.35; }

.topbar-btn--danger {
  border-color: var(--red);
  color: var(--red);
}
.topbar-btn--danger:hover {
  background: var(--red-glow);
}

/* topbar-status merged into topbar-left */

.topbar-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background 0.3s;
}

.topbar-status-label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-dim);
  white-space: nowrap;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.topbar-btn {
  padding: 4px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
  white-space: nowrap;
}

.topbar-btn:hover {
  color: var(--text);
  background: var(--surface-2);
}

.topbar-btn--estop {
  border-color: var(--red);
  color: var(--red);
}

.topbar-dropdown-wrap {
  position: relative;
}

.topbar-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  min-width: 180px;
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  z-index: 200;
  padding: 4px 0;
}

.topbar-dropdown-section {
  padding: 6px 12px 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.topbar-dropdown-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 14px;
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}

.topbar-dropdown-item:hover {
  background: var(--surface-2);
  color: var(--text);
}

.topbar-dropdown-item--danger:hover {
  color: var(--red);
  background: var(--red-glow);
}

.topbar-btn--estop:hover {
  background: var(--red-glow);
  border-color: var(--red);
  color: var(--red);
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
  padding: 12px 16px;
}
/* Dashboard views need zero padding so widgets reach all edges */
.content:has(.pd-root),
.content:has(.ld-root),
.content:has(.td-root),
.content:has(.dashboard-root),
.content:has(.cam-page) {
  padding: 0;
}

/* ── Console bar ────────────────────────────────────────────── */
.cbar {
  flex-shrink: 0;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  font-family: var(--font-mono);
  font-size: 13px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Collapsed state */
.cbar-collapsed {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  height: 38px;
  cursor: pointer;
  user-select: none;
}
.cbar-collapsed:hover .cbar-last-line { color: var(--text); }

.cbar-prompt-icon {
  color: var(--teal);
  font-size: 16px;
  flex-shrink: 0;
}

.cbar-last-line {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-dim);
  font-size: 13px;
  transition: color 0.1s;
}

/* Expanded: input row at top */
.cbar-input-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  height: 38px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}

.cbar-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  min-width: 0;
}
.cbar-input::placeholder { color: var(--text-muted); }

.cbar-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
  padding: 3px 5px;
  border-radius: var(--radius);
  line-height: 1;
  transition: color 0.1s;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.cbar-btn:hover { color: var(--text); }
.cbar-send { color: var(--teal); }
.cbar-send:hover { color: var(--text); }

/* Log output */
.cbar-output {
  flex: 1;
  overflow-y: auto;
  padding: 4px 12px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 1px;
}

.cbar-mode-toggle {
  display: flex;
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  overflow: hidden;
  flex-shrink: 0;
}

.cbar-mode-btn {
  background: none;
  border: none;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.cbar-mode-btn--active { background: var(--surface-2); color: var(--text); }
.cbar-mode-btn:not(.cbar-mode-btn--active):hover { color: var(--text-dim); }

.cbar-mode-text-btn {
  background: var(--surface-2);
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  color: var(--text-dim);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.05em;
  padding: 3px 10px;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.1s, border-color 0.1s;
  white-space: nowrap;
}
.cbar-mode-text-btn:hover { color: var(--text); border-color: var(--teal); }

.cbar-resize-handle {
  height: 8px;
  flex-shrink: 0;
  cursor: ns-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  border-top: 1px solid var(--border);
  color: var(--border-2);
  font-size: 14px;
  transition: color 0.1s, background 0.1s;
  user-select: none;
}
.cbar-resize-handle:hover {
  background: var(--surface-2);
  color: var(--text-muted);
}

.cbar-drag-icon { pointer-events: none; }

.cbar-divider-v {
  width: 1px;
  height: 18px;
  background: var(--border-2);
  flex-shrink: 0;
  margin: 0 2px;
}

.cbar-line {
  display: flex;
  gap: 10px;
  line-height: 1.6;
  word-break: break-all;
  font-size: 13px;
}
.cbar-line-time { color: var(--text-muted); flex-shrink: 0; font-size: 11px; padding-top: 2px; }
.cbar-line-text { flex: 1; }
.cbar-line--response .cbar-line-text { color: var(--text-dim); }
.cbar-line--cmd     .cbar-line-text { color: var(--teal); }
.cbar-line--error   .cbar-line-text { color: var(--red); }
.cbar-line--warn    .cbar-line-text { color: var(--yellow); }
.cbar-line--info    .cbar-line-text { color: var(--text-muted); }

.cbar-xterm {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.cbar-xterm .xterm {
  height: 100%;
  padding: 4px 8px;
}

.cbar-xterm-hint {
  flex: 1;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
}

/* ── Topbar center: file + progress ─────────────────────────── */
.topbar-center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 0 12px;
}

.topbar-file {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.topbar-filename {
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.topbar-pct {
  font-size: 12px;
  font-weight: 700;
  font-family: var(--font-mono);
  color: var(--amber);
  flex-shrink: 0;
}

.topbar-eta {
  font-size: 10px;
  color: var(--teal);
  font-family: var(--font-mono);
}

.topbar-progress-track {
  height: 3px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
}

.topbar-progress-fill {
  height: 100%;
  background: var(--amber);
  border-radius: 2px;
  transition: width 1s ease;
}

/* ── File dialog ─────────────────────────────────────────────── */
.file-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 80px;
  z-index: 500;
}

.file-dialog {
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-lg);
  width: 480px;
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 48px rgba(0,0,0,0.5);
}

.file-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.file-dialog-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.file-dialog-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--radius);
  transition: color 0.1s;
}
.file-dialog-close:hover { color: var(--text); }

.file-dialog-body {
  overflow-y: auto;
  flex: 1;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.file-dialog-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.file-dialog-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  background: none;
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
  width: 100%;
}
.file-dialog-item:hover { background: var(--surface-2); }

.file-dialog-name {
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-dialog-meta {
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
}

/* ── Topbar customize gear (teleported from PrinterDashboard) ── */
.topbar-customize-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius);
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: 21px;        /* ~3x the 7px effective icon size */
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
  line-height: 1;
}

.topbar-customize-btn:hover {
  color: var(--text);
  background: var(--surface-2);
  border-color: var(--border-2);
}

.topbar-customize-btn--active {
  color: var(--amber);
  border-color: var(--amber);
  background: var(--amber-glow);
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
