<!--
  ConsoleWidget.vue
  Two-mode console:
  - Klipper mode (default): gcode console via Moonraker websocket, same data
    as Fluidd/Mainsail console. Colour-coded output, command history, filters.
  - Terminal mode: real PTY via Moonraker's /machine/terminal WebSocket.
    Behaves like an SSH session — full shell access to the Pi.
-->
<template>
  <div class="cw-root" :class="{ 'cw-terminal': terminalMode }">

    <!-- Header bar -->
    <div class="cw-header">
      <span class="cw-title">
        <i :class="terminalMode ? 'mdi mdi-console' : 'mdi mdi-code-greater-than'" class="cw-title-icon"></i>
        {{ terminalMode ? 'Terminal' : 'Console' }}
      </span>
      <div class="cw-header-actions">
        <!-- Filter toggle (Klipper mode only) -->
        <button v-if="!terminalMode" class="cw-hbtn"
                :class="{ 'cw-hbtn--active': showFilters }"
                @click="showFilters = !showFilters" title="Filters">
          <i class="mdi mdi-filter-variant"></i>
        </button>
        <!-- Clear -->
        <button class="cw-hbtn" @click="clearOutput" title="Clear">
          <i class="mdi mdi-delete-sweep-outline"></i>
        </button>
        <!-- Mode toggle -->
        <div class="cw-mode-toggle" title="Switch between Klipper console and terminal">
          <button :class="['cw-mode-btn', !terminalMode ? 'cw-mode-btn--active' : '']"
                  @click="setMode(false)">
            <i class="mdi mdi-code-greater-than"></i> Klipper
          </button>
          <button :class="['cw-mode-btn', terminalMode ? 'cw-mode-btn--active' : '']"
                  @click="setMode(true)">
            <i class="mdi mdi-console"></i> Terminal
          </button>
        </div>
      </div>
    </div>

    <!-- Klipper mode filters -->
    <div v-if="!terminalMode && showFilters" class="cw-filters">
      <label v-for="f in FILTERS" :key="f.key" class="cw-filter-label">
        <input type="checkbox" v-model="activeFilters" :value="f.key" />
        {{ f.label }}
      </label>
    </div>

    <!-- Output area -->
    <div class="cw-output" ref="outputEl" @scroll="onScroll">
      <!-- Klipper console lines -->
      <template v-if="!terminalMode">
        <div v-for="(line, i) in filteredLines" :key="i"
             class="cw-line" :class="lineClass(line)">
          <span class="cw-line-time" v-if="line.time">{{ line.time }}</span>
          <span class="cw-line-text" v-html="colourize(line.text)"></span>
        </div>
        <div v-if="!filteredLines.length" class="cw-empty">No output yet…</div>
      </template>

      <!-- Terminal output -->
      <template v-else>
        <div class="cw-term-output" ref="termOutputEl">
          <span v-for="(chunk, i) in termChunks" :key="i"
                class="cw-term-chunk" v-html="ansiToHtml(chunk)"></span>
        </div>
      </template>
    </div>

    <!-- Scroll-to-bottom button -->
    <button v-if="!autoScroll" class="cw-scroll-btn" @click="scrollToBottom" title="Scroll to bottom">
      <i class="mdi mdi-chevron-double-down"></i>
    </button>

    <!-- Input bar -->
    <div class="cw-input-bar">
      <span class="cw-prompt">
        <i :class="terminalMode ? 'mdi mdi-bash' : 'mdi mdi-chevron-right'" class="cw-prompt-icon"></i>
      </span>
      <input
        ref="inputEl"
        class="cw-input"
        v-model="inputText"
        :placeholder="terminalMode ? 'Shell command…' : 'Klipper command (e.g. G28)…'"
        @keydown.enter="submit"
        @keydown.up.prevent="historyUp"
        @keydown.down.prevent="historyDown"
        @keydown.tab.prevent="tabComplete"
        spellcheck="false"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
      />
      <button class="cw-send-btn" @click="submit" title="Send">
        <i class="mdi mdi-send"></i>
      </button>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useMoonraker } from '../composables/useMoonraker.js'

const { sendGcode, subscribeToConsole, fetchConsoleHistory, klippyState } = useMoonraker()

// ── State ──────────────────────────────────────────────────────
const terminalMode = ref(false)
const showFilters  = ref(false)
const inputText    = ref('')
const outputEl     = ref(null)
const inputEl      = ref(null)
const termOutputEl = ref(null)
const autoScroll   = ref(true)

// Klipper console
const lines = ref([])   // { text, type, time }
const MAX_LINES = 1000

// Terminal
const termChunks  = ref([])
const termWs      = ref(null)
const MAX_CHUNKS  = 2000

// Command history (shared across modes)
const history     = ref([])
const historyIdx  = ref(-1)
const MAX_HISTORY = 100

// ── Filters ────────────────────────────────────────────────────
const FILTERS = [
  { key: 'temp',     label: 'Temperature updates' },
  { key: 'stats',    label: 'MCU stats' },
  { key: 'sdcard',   label: 'SD card' },
  { key: 'probe',    label: 'Probe messages' },
]
const activeFilters = ref([])   // keys of filters currently active = lines to hide

const FILTER_PATTERNS = {
  temp:   /^(?:ok\s+)?(?:B|T\d?|C):\d/i,
  stats:  /mcu '.*' \(|send_count|receive_count/i,
  sdcard: /sd_print/i,
  probe:  /probe:/i,
}

const filteredLines = computed(() => {
  if (!activeFilters.value.length) return lines.value
  return lines.value.filter(l => {
    for (const key of activeFilters.value) {
      if (FILTER_PATTERNS[key]?.test(l.text)) return false
    }
    return true
  })
})

// ── Klipper console helpers ────────────────────────────────────
function lineClass(line) {
  if (line.type === 'cmd')   return 'cw-line--cmd'
  if (line.type === 'error') return 'cw-line--error'
  if (line.type === 'warn')  return 'cw-line--warn'
  return 'cw-line--response'
}

function colourize(text) {
  // Escape HTML
  text = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  // Highlight temperatures inline
  text = text.replace(/([BTC]\d*):(\s*)([\d.]+)\s*\/\s*([\d.]+)/g,
    (_, label, sp, cur, tgt) =>
      `<span class="cw-temp-label">${label}:</span>${sp}<span class="cw-temp-cur">${cur}</span>/<span class="cw-temp-tgt">${tgt}</span>`)
  return text
}

function parseLine(raw) {
  const text = raw.trim()
  let type = 'response'
  if (text.startsWith('//'))   type = 'info'
  if (text.startsWith('!!'))   type = 'error'
  if (/^(?:echo:\s*)?warn/i.test(text)) type = 'warn'
  if (text.startsWith('> ') || text.startsWith('Send:')) type = 'cmd'
  const now = new Date()
  const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`
  return { text, type, time }
}

function addLine(raw) {
  lines.value.push(parseLine(raw))
  if (lines.value.length > MAX_LINES) lines.value.splice(0, lines.value.length - MAX_LINES)
  if (autoScroll.value) nextTick(scrollToBottom)
}

// ── ANSI terminal helpers ──────────────────────────────────────
const ANSI_COLOURS = {
  30:'#555',31:'#e05555',32:'#4caf7d',33:'#f0d87a',
  34:'#80b4e0',35:'#c678dd',36:'#56b6c2',37:'#e8e8e8',
  90:'#888',91:'#e06c75',92:'#98c379',93:'#e5c07b',
  94:'#61afef',95:'#c678dd',96:'#56b6c2',97:'#fff',
}
function ansiToHtml(text) {
  text = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  // Very minimal ANSI escape parser — handles colour codes and reset
  let out = '', bold = false
  text = text.replace(/\x1b\[([0-9;]*)m/g, (_, codes) => {
    const parts = codes.split(';').map(Number)
    let span = ''
    for (const code of parts) {
      if (code === 0)  { span += '</span>'; bold = false }
      else if (code === 1) { bold = true }
      else if (ANSI_COLOURS[code]) {
        const w = bold ? 'font-weight:700;' : ''
        span += `<span style="${w}color:${ANSI_COLOURS[code]}">`
      }
    }
    return span
  })
  return text
}

// ── Terminal WebSocket (Moonraker PTY bridge) ──────────────────
function connectTerminal() {
  if (termWs.value) { termWs.value.close(); termWs.value = null }
  termChunks.value = []
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}/machine/terminal`)
  ws.onopen = () => {
    addTermChunk('\r\n\x1b[32m[Terminal connected — type normally]\x1b[0m\r\n')
  }
  ws.onmessage = (e) => {
    addTermChunk(e.data)
  }
  ws.onclose = () => {
    addTermChunk('\r\n\x1b[33m[Terminal disconnected]\x1b[0m\r\n')
  }
  ws.onerror = () => {
    addTermChunk('\r\n\x1b[31m[Terminal error — is [machine] configured in moonraker.conf?]\x1b[0m\r\n')
  }
  termWs.value = ws
}

function disconnectTerminal() {
  if (termWs.value) { termWs.value.close(); termWs.value = null }
}

function addTermChunk(text) {
  termChunks.value.push(text)
  if (termChunks.value.length > MAX_CHUNKS)
    termChunks.value.splice(0, termChunks.value.length - MAX_CHUNKS)
  if (autoScroll.value) nextTick(scrollToBottom)
}

// ── Mode switching ─────────────────────────────────────────────
function setMode(terminal) {
  terminalMode.value = terminal
  if (terminal) {
    connectTerminal()
  } else {
    disconnectTerminal()
  }
  nextTick(() => inputEl.value?.focus())
}

// ── Input submission ───────────────────────────────────────────
async function submit() {
  const text = inputText.value.trim()
  if (!text) return

  // Add to history
  history.value.unshift(text)
  if (history.value.length > MAX_HISTORY) history.value.pop()
  historyIdx.value = -1
  inputText.value = ''

  if (terminalMode.value) {
    // Send raw to PTY
    if (termWs.value?.readyState === WebSocket.OPEN) {
      termWs.value.send(text + '\n')
    }
  } else {
    // Show command in console
    addLine(`> ${text}`)
    try {
      await sendGcode(text)
    } catch (e) {
      addLine(`!! Error: ${e.message ?? e}`)
    }
  }
}

// ── Command history navigation ─────────────────────────────────
function historyUp() {
  if (!history.value.length) return
  historyIdx.value = Math.min(historyIdx.value + 1, history.value.length - 1)
  inputText.value = history.value[historyIdx.value]
}
function historyDown() {
  if (historyIdx.value <= 0) { historyIdx.value = -1; inputText.value = ''; return }
  historyIdx.value--
  inputText.value = history.value[historyIdx.value]
}

// Basic Klipper command tab completion
const KLIPPER_COMMANDS = ['G28', 'G29', 'G0', 'G1', 'G92', 'M104', 'M109', 'M140',
  'M190', 'M106', 'M107', 'M112', 'M220', 'M221', 'FIRMWARE_RESTART', 'RESTART',
  'SAVE_CONFIG', 'QUAD_GANTRY_LEVEL', 'BED_MESH_CALIBRATE', 'PROBE_CALIBRATE',
  'Z_OFFSET_APPLY_PROBE', 'SET_GCODE_OFFSET', 'PAUSE', 'RESUME', 'CANCEL_PRINT']

function tabComplete() {
  if (terminalMode.value) return
  const t = inputText.value.toUpperCase()
  const match = KLIPPER_COMMANDS.find(c => c.startsWith(t) && c !== t)
  if (match) inputText.value = match
}

// ── Scroll management ──────────────────────────────────────────
function scrollToBottom() {
  const el = outputEl.value
  if (el) el.scrollTop = el.scrollHeight
}

function onScroll() {
  const el = outputEl.value
  if (!el) return
  autoScroll.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
}

// ── Clear ──────────────────────────────────────────────────────
function clearOutput() {
  if (terminalMode.value) termChunks.value = []
  else lines.value = []
}

// ── Lifecycle ──────────────────────────────────────────────────
let unsubConsole = null

onMounted(async () => {
  // Subscribe to live gcode responses
  unsubConsole = subscribeToConsole(addLine)
  // Fetch history on mount if klippy is ready
  if (klippyState.value === 'ready') {
    await fetchConsoleHistory()
    scrollToBottom()
  }
  nextTick(() => inputEl.value?.focus())
})

onUnmounted(() => {
  if (unsubConsole) unsubConsole()
  disconnectTerminal()
})

// Also fetch history when klippy becomes ready mid-session
watch(klippyState, async (val) => {
  if (val === 'ready') {
    await fetchConsoleHistory()
    scrollToBottom()
  }
})
</script>

<style scoped>
.cw-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  border-radius: var(--radius);
  overflow: hidden;
  font-family: var(--font-mono);
  font-size: 12px;
}

/* Header */
.cw-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  gap: 8px;
}
.cw-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-dim);
  display: flex;
  align-items: center;
  gap: 5px;
}
.cw-title-icon { font-size: 14px; }
.cw-header-actions { display: flex; align-items: center; gap: 6px; }

.cw-hbtn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  padding: 2px 5px;
  border-radius: var(--radius);
  transition: color 0.12s;
  line-height: 1;
}
.cw-hbtn:hover { color: var(--text); }
.cw-hbtn--active { color: var(--teal); }

/* Mode toggle */
.cw-mode-toggle {
  display: flex;
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  overflow: hidden;
}
.cw-mode-btn {
  background: none;
  border: none;
  padding: 3px 9px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.cw-mode-btn--active {
  background: var(--surface-2);
  color: var(--text);
}

/* Filters */
.cw-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 10px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.cw-filter-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-dim);
  cursor: pointer;
  user-select: none;
}

/* Output */
.cw-output {
  flex: 1;
  overflow-y: auto;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-height: 0;
}

.cw-line {
  display: flex;
  gap: 8px;
  line-height: 1.55;
  word-break: break-all;
}
.cw-line-time { color: var(--text-muted); flex-shrink: 0; font-size: 10px; padding-top: 2px; }
.cw-line-text { flex: 1; min-width: 0; }

.cw-line--response .cw-line-text { color: var(--text-dim); }
.cw-line--cmd     .cw-line-text { color: var(--teal); }
.cw-line--error   .cw-line-text { color: var(--red); }
.cw-line--warn    .cw-line-text { color: var(--yellow); }
.cw-line--info    .cw-line-text { color: var(--text-muted); }

.cw-temp-label { color: var(--text-muted); }
.cw-temp-cur   { color: var(--amber); }
.cw-temp-tgt   { color: var(--text-muted); }

.cw-empty { color: var(--text-muted); padding: 20px 0; text-align: center; font-size: 12px; }

/* Terminal mode */
.cw-terminal .cw-output { background: #0a0a0a; }
.cw-term-output {
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--text);
  line-height: 1.5;
}

/* Scroll-to-bottom button */
.cw-scroll-btn {
  position: absolute;
  bottom: 52px;
  right: 12px;
  background: var(--surface-2);
  border: 1px solid var(--border-2);
  color: var(--text-dim);
  border-radius: 50%;
  width: 28px;
  height: 28px;
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.1s;
  z-index: 10;
}
.cw-scroll-btn:hover { color: var(--text); }

/* Input bar */
.cw-input-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--surface);
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.cw-prompt-icon { font-size: 14px; color: var(--teal); }
.cw-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 12px;
  min-width: 0;
}
.cw-input::placeholder { color: var(--text-muted); }
.cw-send-btn {
  background: none;
  border: none;
  color: var(--teal);
  font-size: 16px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: var(--radius);
  transition: color 0.12s;
  line-height: 1;
}
.cw-send-btn:hover { color: var(--text); }
</style>
