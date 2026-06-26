<template>
  <div class="pd-root" @click="closeAllPopouts">

    <!-- ── Klippy not ready ──────────────────────────────────── -->
    <div v-if="klippyState !== 'ready'" class="pd-offline">
      <div class="pd-offline-dot"></div>
      <span>{{ klippyState === 'disconnected' ? 'Connecting to Klipper…' : 'Klipper ' + klippyState }}</span>
    </div>

    <!-- ── Customize toolbar ─────────────────────────────────── -->
    <div v-if="layout.customizing.value" class="dash-toolbar">
      <div class="dt-left">
        <span class="dt-mode-label">CUSTOMIZE</span>
        <select class="dt-add-select" @change="e => { layout.addWidget(e.target.value, WIDGET_DEFS); e.target.value = '' }">
          <option value="">+ Add Widget</option>
          <option v-for="def in availableToAdd" :key="def.type" :value="def.type">{{ def.label }}</option>
        </select>
      </div>
      <div class="dt-right">
        <button class="btn btn-ghost btn-sm" @click="toggleLoadMenu">{{ showLoadMenu ? '✕' : 'Load Saved' }}</button>
        <div v-if="showLoadMenu" class="load-menu" @click.stop>
          <div v-if="!layout.availableLayouts.value.length" class="load-menu-empty">No saved layouts</div>
          <button v-for="f in layout.availableLayouts.value" :key="f" class="load-menu-item" @click="doLoadLayout(f)">
            {{ f.replace('bakesail_dashboard_printer_', '').replace('.json','') }}
          </button>
        </div>
        <button class="btn btn-ghost btn-sm" @click="promptSaveAs">Save As…</button>
        <button class="btn btn-ghost btn-sm" @click="layout.revertToDefault(buildDefaultLayout)">Reset</button>
        <button class="btn btn-primary btn-sm" @click="layout.applyLayout()">Apply</button>
        <button class="btn btn-ghost btn-sm" @click="exitCustomize">✕ Exit</button>
      </div>
    </div>

    <!-- ── Normal mode toolbar ───────────────────────────────── -->
    <div v-else class="dash-toolbar">
      <div class="dt-left">
        <span class="pd-state-label" :style="{ color: stateColour }">{{ stateLabel }}</span>
        <span v-if="printer.filename" class="pd-filename">{{ printer.filename }}</span>
      </div>
      <div class="dt-right">
        <button class="btn btn-ghost btn-sm" title="Customize Dashboard" @click.stop="layout.startCustomizing()">⚙ Customize</button>
      </div>
    </div>

    <!-- ── Widget canvas ─────────────────────────────────────── -->
    <div class="widget-canvas" :style="canvasStyle">
      <WidgetShell
        v-for="w in layout.widgets.value"
        :key="w.id"
        :widget="w"
        :customizing="layout.customizing.value"
        :widget-defs="WIDGET_DEFS"
        @update="layout.updateWidget"
        @remove="layout.removeWidget(w.id)"
        @drag-start="layout.onDragStart"
        @resize-start="layout.onResizeStart"
      >

        <!-- ── State Header ───────────────────────────────────── -->
        <template v-if="w.type === 'state'">
          <div class="w-state">
            <div class="ws-status" :style="{ color: stateColour }">{{ stateLabel }}</div>
            <div class="ws-filename" v-if="printer.filename">{{ printer.filename }}</div>
            <div class="ws-layer" v-if="printer.currentLayer">
              Layer {{ printer.currentLayer }}<span v-if="printer.totalLayers"> / {{ printer.totalLayers }}</span>
            </div>
          </div>
        </template>

        <!-- ── Hotend Temperature ─────────────────────────────── -->
        <template v-else-if="w.type === 'hotend'">
          <div class="w-temp">
            <div class="wt-label">{{ w.config?.label || 'Hotend' }}</div>
            <div class="wt-value" :class="tempClass(printer.hotendTemp, printer.hotendTarget)">
              {{ printer.hotendTemp != null ? printer.hotendTemp.toFixed(1) : '—' }}°
            </div>
            <div class="wt-target" v-if="printer.hotendTarget > 0">
              <span class="wt-arrow">→</span> {{ printer.hotendTarget.toFixed(0) }}°
            </div>
            <div class="wt-power-bar" v-if="w.config?.power !== false">
              <div class="wt-power-fill" :style="{ width: (printer.hotendPower * 100).toFixed(0) + '%' }"></div>
            </div>
            <div class="wt-off" v-if="printer.hotendTarget === 0">OFF</div>
          </div>
        </template>

        <!-- ── Bed Temperature ────────────────────────────────── -->
        <template v-else-if="w.type === 'bed'">
          <div class="w-temp">
            <div class="wt-label">{{ w.config?.label || 'Bed' }}</div>
            <div class="wt-value" :class="tempClass(printer.bedTemp, printer.bedTarget)">
              {{ printer.bedTemp != null ? printer.bedTemp.toFixed(1) : '—' }}°
            </div>
            <div class="wt-target" v-if="printer.bedTarget > 0">
              <span class="wt-arrow">→</span> {{ printer.bedTarget.toFixed(0) }}°
            </div>
            <div class="wt-power-bar" v-if="w.config?.power !== false">
              <div class="wt-power-fill" :style="{ width: (printer.bedPower * 100).toFixed(0) + '%' }"></div>
            </div>
            <div class="wt-off" v-if="printer.bedTarget === 0">OFF</div>
          </div>
        </template>

        <!-- ── Temperature Chart ──────────────────────────────── -->
        <template v-else-if="w.type === 'chart'">
          <div class="w-chart">
            <div class="wch-label">Temperature History</div>
            <canvas :ref="el => chartCanvases[w.id] = el" class="wch-canvas"></canvas>
          </div>
        </template>

        <!-- ── Print Progress ─────────────────────────────────── -->
        <template v-else-if="w.type === 'progress'">
          <div class="w-progress">
            <div class="wp-filename">{{ printer.filename || 'No file loaded' }}</div>
            <div class="wp-bar-track">
              <div class="wp-bar-fill" :style="{ width: (printer.progress * 100).toFixed(1) + '%' }"></div>
            </div>
            <div class="wp-stats">
              <span class="wp-pct">{{ (printer.progress * 100).toFixed(1) }}%</span>
              <span class="wp-time" v-if="printer.printDuration > 0">{{ formatDuration(printer.printDuration) }}</span>
              <span class="wp-eta"  v-if="printer.progress > 0 && printer.progress < 1">ETA {{ formatEta(printer.printDuration, printer.progress) }}</span>
            </div>
            <div class="wp-filament" v-if="printer.filamentUsed > 0">
              {{ (printer.filamentUsed / 1000).toFixed(2) }}m used
            </div>
          </div>
        </template>

        <!-- ── Fan Speed ──────────────────────────────────────── -->
        <template v-else-if="w.type === 'fan'">
          <div class="w-fan">
            <div class="wf-label">{{ w.config?.label || 'Part Fan' }}</div>
            <div class="wf-value" :class="{ 'wf-off': printer.fanSpeed === 0 }">
              {{ printer.fanSpeed != null ? (printer.fanSpeed * 100).toFixed(0) + '%' : '—' }}
            </div>
            <div class="wf-bar-track">
              <div class="wf-bar-fill" :style="{ width: (printer.fanSpeed * 100).toFixed(0) + '%' }"></div>
            </div>
          </div>
        </template>

        <!-- ── Speed / Flow ───────────────────────────────────── -->
        <template v-else-if="w.type === 'speedflow'">
          <div class="w-speedflow">
            <div class="wsf-row">
              <span class="wsf-label">Speed</span>
              <span class="wsf-value">{{ (printer.speedFactor * 100).toFixed(0) }}%</span>
            </div>
            <div class="wsf-row">
              <span class="wsf-label">Flow</span>
              <span class="wsf-value">{{ (printer.extrudeFactor * 100).toFixed(0) }}%</span>
            </div>
            <div class="wsf-btns">
              <button class="btn btn-ghost btn-xs" @click="sendGcode('M220 S100')">Reset Speed</button>
              <button class="btn btn-ghost btn-xs" @click="sendGcode('M221 S100')">Reset Flow</button>
            </div>
          </div>
        </template>

        <!-- ── Toolhead Position ──────────────────────────────── -->
        <template v-else-if="w.type === 'toolhead'">
          <div class="w-toolhead">
            <div class="wth-axes">
              <div class="wth-axis" v-for="(val, axis) in { X: printer.posX, Y: printer.posY, Z: printer.posZ }" :key="axis">
                <span class="wth-axis-label">{{ axis }}</span>
                <span class="wth-axis-val" :class="{ 'wth-unhomed': !printer.homedAxes.includes(axis.toLowerCase()) }">
                  {{ val != null ? val.toFixed(2) : '?' }}
                </span>
              </div>
            </div>
            <div class="wth-btns">
              <button class="btn btn-ghost btn-xs" @click="sendGcode('G28')">Home All</button>
              <button class="btn btn-ghost btn-xs" @click="sendGcode('G28 Z')">Home Z</button>
            </div>
          </div>
        </template>

        <!-- ── Print Controls ─────────────────────────────────── -->
        <template v-else-if="w.type === 'controls'">
          <div class="w-controls">
            <button class="btn btn-ghost" @click="sendGcode('PAUSE')"        :disabled="!printer.isPrinting">Pause</button>
            <button class="btn btn-ghost" @click="sendGcode('RESUME')"       :disabled="!printer.isPaused">Resume</button>
            <button class="btn btn-danger" @click="confirmCancel"            :disabled="!printer.isPrinting && !printer.isPaused">Cancel</button>
            <button class="btn btn-ghost" @click="sendGcode('FIRMWARE_RESTART')" style="margin-left:auto">Restart FW</button>
            <button class="btn btn-danger" @click="sendGcode('M112')"        title="Emergency stop">⚡ E-Stop</button>
          </div>
        </template>

        <!-- ── Macros ─────────────────────────────────────────── -->
        <template v-else-if="w.type === 'macros'">
          <div class="w-macros">
            <div class="wm-label">Macros</div>
            <div class="wm-btns">
              <button
                v-for="m in (w.config?.macros || defaultMacros)"
                :key="m"
                class="btn btn-ghost btn-sm"
                @click="sendGcode(m)"
              >{{ m }}</button>
            </div>
          </div>
        </template>

        <!-- ── Camera Feed ────────────────────────────────────── -->
        <template v-else-if="w.type === 'camera'">
          <div class="w-camera">
            <div v-if="w.config?.label" class="wc-cam-title">{{ cameraLabel(w.config.cameraId) }}</div>
            <div class="wc-cam-feed"><CameraFeed :camera-id="w.config?.cameraId" /></div>
          </div>
        </template>

      </WidgetShell>
    </div>

    <!-- ── Cancel confirm dialog ─────────────────────────────── -->
    <div v-if="showCancelConfirm" class="modal-backdrop" @click.self="showCancelConfirm = false">
      <div class="card modal">
        <div class="modal-title">Cancel Print?</div>
        <p style="font-size:13px;color:var(--text-dim);margin-bottom:16px">
          This will cancel <strong>{{ printer.filename }}</strong> and cannot be undone.
        </p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost" @click="showCancelConfirm = false">Keep Printing</button>
          <button class="btn btn-danger" @click="doCancel">Cancel Print</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
/**
 * PrinterDashboard.vue — Widgetized 3D printer dashboard for Bakesail.
 *
 * Data source: Moonraker websocket via useMoonraker's subscribeToStatus().
 * All printer state lives in the local `printer` reactive object; nothing
 * goes through the bakesail device store (which is for rework state).
 *
 * Widget types:
 *   state      — print status header (state, filename, layer)
 *   hotend     — hotend temp + target + power bar
 *   bed        — bed temp + target + power bar
 *   chart      — temperature history chart (hotend + bed)
 *   progress   — progress bar, print time, ETA, filament used
 *   fan        — part cooling fan %
 *   speedflow  — speed % / flow % with reset buttons
 *   toolhead   — X/Y/Z position + home buttons
 *   controls   — pause / resume / cancel / e-stop / fw-restart
 *   macros     — configurable macro buttons
 *   camera     — camera feed (multi-instance)
 *
 * To add a widget:
 *   1. Add an entry to WIDGET_DEFS
 *   2. Add a <template v-else-if="w.type === 'yourtype'"> block in the template
 *   3. Wire reactive data from the `printer` object (extend handleStatus if needed)
 */

import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useSettingsStore }   from '../stores/settings.js'
import { useMoonraker }       from '../composables/useMoonraker.js'
import { useDashboardLayout } from '../composables/useDashboardLayout.js'
import WidgetShell  from '../components/WidgetShell.vue'
import CameraFeed   from '../components/CameraFeed.vue'

const settings = useSettingsStore()
const { klippyState, sendGcode, subscribeToStatus } = useMoonraker()

// ── Printer state ──────────────────────────────────────────────
// All fields default to safe "not yet known" values.
const printer = reactive({
  // Temps
  hotendTemp:    null,
  hotendTarget:  0,
  hotendPower:   0,
  bedTemp:       null,
  bedTarget:     0,
  bedPower:      0,

  // Fan
  fanSpeed:      0,

  // Print stats
  filename:      '',
  state:         'standby',  // standby | printing | paused | complete | error | cancelled
  isPrinting:    false,
  isPaused:      false,
  printDuration: 0,
  filamentUsed:  0,
  currentLayer:  null,
  totalLayers:   null,

  // Progress (from display_status; more accurate than virtual_sdcard during print)
  progress: 0,

  // Speed / flow
  speedFactor:   1.0,
  extrudeFactor: 1.0,

  // Toolhead position
  posX: null,
  posY: null,
  posZ: null,
  homedAxes: '',
})

// Temperature history for the chart widget (last 5 min @ ~1Hz)
const HISTORY_LEN = 300
const tempHistory = reactive({ hotend: [], bed: [] })

function handleStatus(data) {
  if (data.extruder) {
    if (data.extruder.temperature != null) printer.hotendTemp   = data.extruder.temperature
    if (data.extruder.target      != null) printer.hotendTarget = data.extruder.target
    if (data.extruder.power       != null) printer.hotendPower  = data.extruder.power
  }
  if (data.heater_bed) {
    if (data.heater_bed.temperature != null) printer.bedTemp   = data.heater_bed.temperature
    if (data.heater_bed.target      != null) printer.bedTarget = data.heater_bed.target
    if (data.heater_bed.power       != null) printer.bedPower  = data.heater_bed.power
  }
  if (data.fan?.speed != null) printer.fanSpeed = data.fan.speed
  if (data.display_status?.progress != null) printer.progress = data.display_status.progress
  if (data.print_stats) {
    const ps = data.print_stats
    if (ps.state       != null) {
      printer.state      = ps.state
      printer.isPrinting = ps.state === 'printing'
      printer.isPaused   = ps.state === 'paused'
    }
    if (ps.filename       != null) printer.filename      = ps.filename
    if (ps.print_duration != null) printer.printDuration = ps.print_duration
    if (ps.filament_used  != null) printer.filamentUsed  = ps.filament_used
    if (ps.info?.current_layer != null) printer.currentLayer = ps.info.current_layer
    if (ps.info?.total_layer   != null) printer.totalLayers  = ps.info.total_layer
  }
  if (data.gcode_move) {
    if (data.gcode_move.speed_factor   != null) printer.speedFactor   = data.gcode_move.speed_factor
    if (data.gcode_move.extrude_factor != null) printer.extrudeFactor = data.gcode_move.extrude_factor
  }
  if (data.toolhead) {
    if (data.toolhead.position    != null) {
      printer.posX = data.toolhead.position[0]
      printer.posY = data.toolhead.position[1]
      printer.posZ = data.toolhead.position[2]
    }
    if (data.toolhead.homed_axes  != null) printer.homedAxes = data.toolhead.homed_axes
  }

  // Append to temp history for chart
  if (data.extruder?.temperature != null || data.heater_bed?.temperature != null) {
    const t = Date.now()
    if (printer.hotendTemp != null) {
      tempHistory.hotend.push({ t, v: printer.hotendTemp })
      if (tempHistory.hotend.length > HISTORY_LEN) tempHistory.hotend.shift()
    }
    if (printer.bedTemp != null) {
      tempHistory.bed.push({ t, v: printer.bedTemp })
      if (tempHistory.bed.length > HISTORY_LEN) tempHistory.bed.shift()
    }
  }
}

// ── State label / colour ───────────────────────────────────────
const STATE_META = {
  standby:   { label: 'Standby',   colour: 'var(--text-muted)' },
  printing:  { label: 'Printing',  colour: 'var(--amber)'      },
  paused:    { label: 'Paused',    colour: 'var(--yellow)'     },
  complete:  { label: 'Complete',  colour: 'var(--green)'      },
  error:     { label: 'Error',     colour: 'var(--red)'        },
  cancelled: { label: 'Cancelled', colour: 'var(--text-dim)'   },
}

const stateLabel  = computed(() => STATE_META[printer.state]?.label  ?? printer.state)
const stateColour = computed(() => STATE_META[printer.state]?.colour ?? 'var(--text-muted)')

// ── Widget definitions ─────────────────────────────────────────
const WIDGET_DEFS = [
  {
    type: 'state', label: 'State Header',
    defaultW: 700, defaultH: 80,
    defaultConfig: {},
    fields: [
      { key: 'filename', label: 'Filename' },
      { key: 'layer',    label: 'Layer counter' },
    ],
  },
  {
    type: 'hotend', label: 'Hotend Temp',
    defaultW: 180, defaultH: 160,
    defaultConfig: { label: 'Hotend', power: true },
    fields: [
      { key: 'power', label: 'Heater power bar' },
    ],
  },
  {
    type: 'bed', label: 'Bed Temp',
    defaultW: 180, defaultH: 160,
    defaultConfig: { label: 'Bed', power: true },
    fields: [
      { key: 'power', label: 'Heater power bar' },
    ],
  },
  {
    type: 'chart', label: 'Temperature Chart',
    defaultW: 560, defaultH: 200,
    defaultConfig: {},
    fields: [],
  },
  {
    type: 'progress', label: 'Print Progress',
    defaultW: 520, defaultH: 120,
    defaultConfig: {},
    fields: [
      { key: 'time',     label: 'Print time' },
      { key: 'eta',      label: 'ETA' },
      { key: 'filament', label: 'Filament used' },
    ],
  },
  {
    type: 'fan', label: 'Part Fan',
    defaultW: 180, defaultH: 140,
    defaultConfig: { label: 'Part Fan' },
    fields: [],
  },
  {
    type: 'speedflow', label: 'Speed / Flow',
    defaultW: 220, defaultH: 140,
    defaultConfig: {},
    fields: [],
  },
  {
    type: 'toolhead', label: 'Toolhead Position',
    defaultW: 260, defaultH: 160,
    defaultConfig: {},
    fields: [{ key: 'buttons', label: 'Home buttons' }],
  },
  {
    type: 'controls', label: 'Print Controls',
    defaultW: 600, defaultH: 60,
    defaultConfig: {},
    fields: [],
  },
  {
    type: 'macros', label: 'Macro Buttons',
    defaultW: 400, defaultH: 100,
    defaultConfig: { macros: ['BED_MESH_CALIBRATE', 'LOAD_FILAMENT', 'UNLOAD_FILAMENT'] },
    fields: [{ key: 'macros', label: 'Macro list' }],
  },
  {
    type: 'camera', label: 'Camera Feed',
    defaultW: 320, defaultH: 260,
    defaultConfig: { cameraId: null },
    fields: [{ key: 'label', label: 'Show camera name' }],
  },
]

// ── Default layout ─────────────────────────────────────────────
function buildDefaultLayout() {
  return [
    { id: 'state',     type: 'state',     x: 0,   y: 0,   w: 740, h: 80,  config: {} },
    { id: 'hotend',    type: 'hotend',    x: 0,   y: 100, w: 180, h: 160, config: {} },
    { id: 'bed',       type: 'bed',       x: 190, y: 100, w: 180, h: 160, config: {} },
    { id: 'fan',       type: 'fan',       x: 380, y: 100, w: 180, h: 160, config: {} },
    { id: 'speedflow', type: 'speedflow', x: 570, y: 100, w: 220, h: 160, config: {} },
    { id: 'progress',  type: 'progress',  x: 0,   y: 280, w: 560, h: 120, config: {} },
    { id: 'toolhead',  type: 'toolhead',  x: 570, y: 280, w: 260, h: 160, config: {} },
    { id: 'controls',  type: 'controls',  x: 0,   y: 420, w: 740, h: 60,  config: {} },
    { id: 'chart',     type: 'chart',     x: 0,   y: 500, w: 740, h: 200, config: {} },
  ]
}

const layout = useDashboardLayout('printer', buildDefaultLayout())

const canvasStyle = computed(() => {
  const minH = layout.widgets.value.reduce((m, w) => Math.max(m, w.y + w.h), 600)
  return { height: (minH + 80) + 'px' }
})

const availableToAdd = computed(() => {
  const onCanvas = new Set(layout.widgets.value.map(w => w.type))
  return WIDGET_DEFS.filter(d => d.type === 'camera' || d.type === 'macros' || !onCanvas.has(d.type))
})

// ── Helpers ────────────────────────────────────────────────────

// Colour temp reading based on proximity to target
function tempClass(temp, target) {
  if (temp == null) return ''
  if (target === 0) return ''
  const diff = Math.abs(temp - target)
  if (diff < 3) return 'temp-at-target'
  if (temp < target) return 'temp-heating'
  return 'temp-over'
}

function formatDuration(seconds) {
  if (!seconds) return '0:00:00'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
}

function formatEta(elapsed, progress) {
  if (!progress || progress <= 0) return '—'
  const totalEstimate = elapsed / progress
  const remaining = totalEstimate - elapsed
  const end = new Date(Date.now() + remaining * 1000)
  return end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function cameraLabel(id) {
  if (!id) return 'Camera'
  const cam = settings.cameras?.find(c => c.id === id)
  return cam?.name || id
}

const defaultMacros = ['BED_MESH_CALIBRATE', 'LOAD_FILAMENT', 'UNLOAD_FILAMENT']

// ── Cancel confirm ─────────────────────────────────────────────
const showCancelConfirm = ref(false)
function confirmCancel() { showCancelConfirm.value = true }
async function doCancel() {
  showCancelConfirm.value = false
  await sendGcode('CANCEL_PRINT')
}

// ── Chart (simple canvas sparkline) ───────────────────────────
// Keyed by widget id so multiple chart widgets coexist
const chartCanvases = ref({})
let chartTimer = null

function drawCharts() {
  for (const [id, canvas] of Object.entries(chartCanvases.value)) {
    if (!canvas) continue
    const ctx = canvas.getContext('2d')
    const w = canvas.offsetWidth
    const h = canvas.offsetHeight
    canvas.width  = w
    canvas.height = h

    const style = getComputedStyle(document.documentElement)
    const colHotend = style.getPropertyValue('--amber').trim()
    const colBed    = style.getPropertyValue('--teal').trim()
    const colGrid   = style.getPropertyValue('--border').trim()
    const colText   = style.getPropertyValue('--text-muted').trim()
    const bg        = style.getPropertyValue('--surface').trim()

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, w, h)

    const series = [
      { data: tempHistory.hotend, colour: colHotend, label: 'Hotend' },
      { data: tempHistory.bed,    colour: colBed,    label: 'Bed'    },
    ]

    const allTemps = [...tempHistory.hotend.map(p => p.v), ...tempHistory.bed.map(p => p.v)].filter(Boolean)
    if (allTemps.length < 2) {
      ctx.fillStyle = colText
      ctx.font = '12px system-ui'
      ctx.textAlign = 'center'
      ctx.fillText('Heating data will appear here', w / 2, h / 2)
      continue
    }

    const pad = { t: 10, r: 10, b: 30, l: 44 }
    const plotW = w - pad.l - pad.r
    const plotH = h - pad.t - pad.b

    const minT = Math.min(...allTemps) - 5
    const maxT = Math.max(...allTemps) + 5

    const allTimes = [...tempHistory.hotend.map(p => p.t), ...tempHistory.bed.map(p => p.t)]
    const tMin = Math.min(...allTimes)
    const tMax = Math.max(...allTimes)
    const tRange = tMax - tMin || 1

    // Grid lines
    ctx.strokeStyle = colGrid
    ctx.lineWidth = 0.5
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (plotH / 4) * i
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + plotW, y); ctx.stroke()
      const temp = maxT - ((maxT - minT) / 4) * i
      ctx.fillStyle = colText; ctx.font = '10px system-ui'; ctx.textAlign = 'right'
      ctx.fillText(temp.toFixed(0) + '°', pad.l - 4, y + 4)
    }

    // Series
    for (const s of series) {
      if (s.data.length < 2) continue
      ctx.strokeStyle = s.colour
      ctx.lineWidth = 1.5
      ctx.beginPath()
      s.data.forEach((p, i) => {
        const x = pad.l + ((p.t - tMin) / tRange) * plotW
        const y = pad.t + plotH - ((p.v - minT) / (maxT - minT)) * plotH
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.stroke()

      // Legend dot
      const li = series.indexOf(s)
      ctx.fillStyle = s.colour
      ctx.beginPath(); ctx.arc(pad.l + 8 + li * 70, h - 10, 4, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = colText; ctx.font = '10px system-ui'; ctx.textAlign = 'left'
      ctx.fillText(s.label, pad.l + 16 + li * 70, h - 6)
    }
  }
}

// ── Customize helpers ──────────────────────────────────────────
const showLoadMenu = ref(false)

function exitCustomize() { layout.exitCustomize?.(); showLoadMenu.value = false }
function closeAllPopouts() { showLoadMenu.value = false }
async function toggleLoadMenu() {
  showLoadMenu.value = !showLoadMenu.value
  if (showLoadMenu.value) await layout.fetchAvailableLayouts?.()
}
async function doLoadLayout(f) { await layout.loadLayout?.(f.replace(/^.*\//, '')); showLoadMenu.value = false }
function promptSaveAs() {
  const name = prompt('Save layout as:', 'my_printer_layout')
  if (name) layout.saveLayout?.(name)
}

// ── Lifecycle ──────────────────────────────────────────────────
let unsubscribe = null

onMounted(async () => {
  await layout.tryAutoLoad(buildDefaultLayout)
  unsubscribe = subscribeToStatus(handleStatus)
  // Redraw charts at 1fps
  chartTimer = setInterval(drawCharts, 1000)
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
  if (chartTimer) clearInterval(chartTimer)
})
</script>

<style scoped>
.pd-root { position: relative; min-height: 100%; padding-bottom: 60px; }

/* Offline banner */
.pd-offline {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; margin-bottom: 12px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); font-size: 13px; color: var(--text-dim);
}
.pd-offline-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--amber); opacity: 0.5; animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:1} }

/* Toolbar */
.dash-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 12px; height: 36px; flex-shrink: 0; gap: 10px; position: relative;
}
.dt-left  { display: flex; align-items: center; gap: 12px; }
.dt-right { display: flex; align-items: center; gap: 6px; }
.dt-mode-label { font-size: 11px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--amber); }
.dt-add-select { background: var(--surface); border: 1px solid var(--border-2); color: var(--text); border-radius: var(--radius); padding: 4px 8px; font-size: 12px; cursor: pointer; }
.pd-state-label { font-size: 15px; font-weight: 700; letter-spacing: 0.04em; }
.pd-filename    { font-size: 12px; color: var(--text-dim); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 340px; }

/* Load menu */
.load-menu { position: absolute; top: 40px; right: 100px; z-index: 200; background: var(--surface); border: 1px solid var(--border-2); border-radius: var(--radius); padding: 6px; display: flex; flex-direction: column; gap: 3px; min-width: 180px; }
.load-menu-item { text-align: left; padding: 6px 10px; background: transparent; border: none; color: var(--text-dim); font-size: 12px; cursor: pointer; border-radius: var(--radius); transition: background 0.1s; }
.load-menu-item:hover { background: var(--surface-2); color: var(--text); }
.load-menu-empty { font-size: 12px; color: var(--text-muted); padding: 6px 10px; }

/* Canvas */
.widget-canvas { position: relative; width: 100%; }

/* ── State widget ─────────────────────────────── */
.w-state { display: flex; flex-direction: column; gap: 5px; height: 100%; justify-content: center; }
.ws-status   { font-size: 22px; font-weight: 700; letter-spacing: 0.04em; }
.ws-filename { font-size: 12px; color: var(--text-dim); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ws-layer    { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }

/* ── Temp widget (hotend + bed) ──────────────── */
.w-temp { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 4px; }
.wt-label { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); }
.wt-value { font-size: 34px; font-weight: 700; font-family: var(--font-mono); transition: color 0.4s; }
.wt-value.temp-at-target { color: var(--green); }
.wt-value.temp-heating   { color: var(--amber); }
.wt-value.temp-over      { color: var(--red); }
.wt-target { font-size: 13px; color: var(--text-dim); font-family: var(--font-mono); }
.wt-arrow  { color: var(--amber); }
.wt-power-bar { width: 80%; height: 4px; background: var(--surface-2); border-radius: 2px; overflow: hidden; margin-top: 2px; }
.wt-power-fill { height: 100%; background: var(--amber); border-radius: 2px; transition: width 0.5s ease; }
.wt-off { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); letter-spacing: 0.08em; }

/* ── Chart widget ────────────────────────────── */
.w-chart { display: flex; flex-direction: column; height: 100%; gap: 4px; }
.wch-label { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); flex-shrink: 0; }
.wch-canvas { flex: 1; width: 100%; min-height: 0; border-radius: var(--radius); }

/* ── Progress widget ─────────────────────────── */
.w-progress { display: flex; flex-direction: column; gap: 8px; justify-content: center; height: 100%; }
.wp-filename { font-size: 12px; color: var(--text-dim); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-bar-track { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
.wp-bar-fill { height: 100%; background: var(--amber); border-radius: 4px; transition: width 0.8s ease; }
.wp-stats { display: flex; align-items: baseline; gap: 14px; }
.wp-pct  { font-size: 22px; font-weight: 700; font-family: var(--font-mono); }
.wp-time { font-size: 12px; color: var(--text-dim); font-family: var(--font-mono); }
.wp-eta  { font-size: 12px; color: var(--teal);     font-family: var(--font-mono); }
.wp-filament { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }

/* ── Fan widget ──────────────────────────────── */
.w-fan { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 6px; }
.wf-label { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); }
.wf-value { font-size: 28px; font-weight: 700; font-family: var(--font-mono); color: var(--teal); }
.wf-value.wf-off { color: var(--text-muted); }
.wf-bar-track { width: 80%; height: 4px; background: var(--surface-2); border-radius: 2px; overflow: hidden; }
.wf-bar-fill { height: 100%; background: var(--teal); border-radius: 2px; transition: width 0.5s ease; }

/* ── Speed/Flow widget ───────────────────────── */
.w-speedflow { display: flex; flex-direction: column; gap: 10px; justify-content: center; height: 100%; }
.wsf-row   { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.wsf-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
.wsf-value { font-size: 20px; font-weight: 700; font-family: var(--font-mono); color: var(--text); }
.wsf-btns  { display: flex; gap: 6px; flex-wrap: wrap; }

/* ── Toolhead widget ─────────────────────────── */
.w-toolhead { display: flex; flex-direction: column; gap: 10px; justify-content: center; height: 100%; }
.wth-axes { display: flex; flex-direction: column; gap: 4px; }
.wth-axis { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.wth-axis-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); width: 16px; }
.wth-axis-val { font-size: 18px; font-weight: 700; font-family: var(--font-mono); color: var(--text); }
.wth-axis-val.wth-unhomed { color: var(--red); }
.wth-btns { display: flex; gap: 6px; }

/* ── Controls widget ─────────────────────────── */
.w-controls { display: flex; align-items: center; gap: 8px; height: 100%; flex-wrap: wrap; }

/* ── Macros widget ───────────────────────────── */
.w-macros { display: flex; flex-direction: column; gap: 8px; height: 100%; justify-content: center; }
.wm-label { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); }
.wm-btns  { display: flex; gap: 6px; flex-wrap: wrap; }

/* ── Camera widget ───────────────────────────── */
.w-camera { display: flex; flex-direction: column; gap: 6px; height: 100%; }
.wc-cam-title { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); flex-shrink: 0; }
.wc-cam-feed  { flex: 1; border-radius: var(--radius); overflow: hidden; min-height: 0; }

/* ── Modal ───────────────────────────────────── */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 300; }
.modal { width: 360px; }
.modal-title { font-size: 12px; font-weight: 600; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 14px; }

/* ── Customize footer ────────────────────────── */
.customize-footer {
  position: fixed; bottom: 0; left: var(--sidebar-w); right: 0;
  background: var(--surface); border-top: 1px solid var(--border);
  display: flex; align-items: center; justify-content: flex-end;
  gap: 8px; padding: 10px 24px; z-index: 100;
}

.btn-sm { padding: 6px 12px; font-size: 12px; }
.btn-xs { padding: 4px 8px; font-size: 11px; }
</style>
