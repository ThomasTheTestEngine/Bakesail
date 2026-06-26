<template>
  <div class="pd-root">

    <!-- ── Klippy not ready ──────────────────────────────────── -->
    <div v-if="klippyState !== 'ready'" class="pd-offline">
      <div class="pd-offline-dot"></div>
      <span>{{ klippyState === 'disconnected' ? 'Connecting to Klipper…' : 'Klipper ' + klippyState }}</span>
    </div>

    <!-- ── Toolbar ────────────────────────────────────────────── -->
    <div class="dash-toolbar">
      <div class="dt-left">
        <template v-if="layout.customizeMode.value">
          <span class="dt-mode-label">CUSTOMIZE DASHBOARD</span>
          <div class="add-widget-wrap" @click.stop>
            <button class="btn btn-ghost btn-sm" @click="layout.addWidgetOpen.value = !layout.addWidgetOpen.value">
              + Add Widget
            </button>
            <div v-if="layout.addWidgetOpen.value" class="add-widget-dropdown">
              <button
                v-for="def in availableToAdd" :key="def.type"
                class="add-widget-item"
                @click="layout.addWidget(def.type, WIDGET_DEFS)"
              >{{ def.label }}</button>
              <div v-if="!availableToAdd.length" class="add-widget-item" style="opacity:0.5;cursor:default">Nothing to add</div>
            </div>
          </div>
        </template>
        <template v-else>
          <span class="pd-state-label" :style="{ color: stateColour }">{{ stateLabel }}</span>
          <span v-if="printer.filename" class="pd-filename">{{ printer.filename }}</span>
        </template>
      </div>
      <div class="dt-right">
        <template v-if="layout.customizeMode.value">
          <button class="btn btn-ghost btn-sm" @click="toggleLoadMenu">{{ showLoadMenu ? '✕' : 'Load Saved' }}</button>
          <div v-if="showLoadMenu" class="load-menu" @click.stop>
            <div v-if="layout.loadingLayouts.value" class="load-menu-item" style="opacity:0.5">Loading…</div>
            <div v-else-if="!layout.availableLayouts.value.length" class="load-menu-item" style="opacity:0.5">No saved layouts</div>
            <button v-else v-for="f in layout.availableLayouts.value" :key="f" class="load-menu-item" @click="doLoadLayout(f)">
              {{ f.replace('bakesail_dashboard_printer_','').replace('.json','') }}
            </button>
          </div>
          <button class="btn btn-ghost btn-sm" @click="promptSaveAs">Save As…</button>
          <button class="btn btn-ghost btn-sm" @click="layout.revertToDefault()">↺ Reset</button>
          <button class="btn btn-primary btn-sm" @click="layout.applyLayout()">✓ Apply</button>
          <span v-if="layout.saveMsg.value" class="dt-save-msg">{{ layout.saveMsg.value }}</span>
        </template>
        <button
          class="btn btn-ghost btn-sm customize-btn"
          :class="{ 'customize-btn--active': layout.customizeMode.value }"
          @click.stop="layout.customizeMode.value ? exitCustomize() : layout.enterCustomize()"
        >
          <span v-if="layout.customizeMode.value">✕ Exit</span>
          <span v-else>⚙ Customize</span>
        </button>
      </div>
    </div>

    <!-- ── Widget canvas ─────────────────────────────────────── -->
    <div class="dash-canvas" :style="canvasStyle" @click.self="layout.closeWidgetSettings()">

      <!-- Grid overlay -->
      <svg v-if="layout.customizeMode.value && settings.dashboardGridSnap"
           class="grid-overlay" aria-hidden="true">
        <defs>
          <pattern :id="`pgrid-${_uid}`"
                   :width="settings.dashboardGridSize" :height="settings.dashboardGridSize"
                   patternUnits="userSpaceOnUse">
            <path :d="`M ${settings.dashboardGridSize} 0 L 0 0 0 ${settings.dashboardGridSize}`"
                  fill="none" stroke="rgba(240,127,170,0.08)" stroke-width="0.5"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" :fill="`url(#pgrid-${_uid})`"/>
      </svg>

      <WidgetShell
        v-for="w in layout.widgets.value"
        :key="w.id"
        :widget="w"
        :customizeMode="layout.customizeMode.value"
        :settingsOpen="layout.openWidgetSettings.value === w.id"
        :allFields="widgetFields(w.type)"
        :defaultConfig="defaultConfig(w.type)"
        @startDrag="layout.startDrag"
        @startResize="layout.startResize"
        @remove="layout.removeWidget"
        @toggleSettings="layout.toggleWidgetSettings"
        @closeSettings="layout.closeWidgetSettings"
      >

        <!-- ── State Header ───────────────────────────────────── -->
        <template v-if="w.type === 'state'">
          <div class="w-state">
            <div class="ws-status" :style="{ color: stateColour }">{{ stateLabel }}</div>
            <div class="ws-filename" v-if="printer.filename && !isFieldHidden(w,'filename')">{{ printer.filename }}</div>
            <div class="ws-layer" v-if="printer.currentLayer && !isFieldHidden(w,'layer')">
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
            <div class="wt-power-bar" v-if="!isFieldHidden(w,'power')">
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
            <div class="wt-power-bar" v-if="!isFieldHidden(w,'power')">
              <div class="wt-power-fill" :style="{ width: (printer.bedPower * 100).toFixed(0) + '%' }"></div>
            </div>
            <div class="wt-off" v-if="printer.bedTarget === 0">OFF</div>
          </div>
        </template>

        <!-- ── Temperature Chart ──────────────────────────────── -->
        <template v-else-if="w.type === 'chart'">
          <div class="w-chart">
            <div class="wch-label">Temperature History</div>
            <canvas :ref="el => { if (el) chartCanvases[w.id] = el }" class="wch-canvas"></canvas>
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
              <span class="wp-time" v-if="!isFieldHidden(w,'time') && printer.printDuration > 0">{{ formatDuration(printer.printDuration) }}</span>
              <span class="wp-eta"  v-if="!isFieldHidden(w,'eta') && printer.progress > 0 && printer.progress < 1">ETA {{ formatEta(printer.printDuration, printer.progress) }}</span>
            </div>
            <div class="wp-filament" v-if="!isFieldHidden(w,'filament') && printer.filamentUsed > 0">
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
            <div class="wth-btns" v-if="!isFieldHidden(w,'buttons')">
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
            <button class="btn btn-danger" @click="sendGcode('M112')" title="Emergency stop">⚡ E-Stop</button>
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
            <div v-if="!isFieldHidden(w,'label')" class="wc-cam-title">{{ cameraLabel(w.config?.cameraId) }}</div>
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
 * Widget types: state, hotend, bed, chart, progress, fan, speedflow,
 *               toolhead, controls, macros, camera
 *
 * To add a widget:
 *   1. Add an entry to WIDGET_DEFS
 *   2. Add a <template v-else-if="w.type === 'yourtype'"> block above
 *   3. Wire reactive data from handleStatus() into the `printer` object
 */

import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useSettingsStore }   from '../stores/settings.js'
import { useMoonraker }       from '../composables/useMoonraker.js'
import { useDashboardLayout } from '../composables/useDashboardLayout.js'
import WidgetShell from '../components/WidgetShell.vue'
import CameraFeed  from '../components/CameraFeed.vue'

const settings = useSettingsStore()
const { klippyState, sendGcode, subscribeToStatus } = useMoonraker()
const _uid = Math.random().toString(36).slice(2, 7)

// ── Printer state ──────────────────────────────────────────────
const printer = reactive({
  hotendTemp:    null,
  hotendTarget:  0,
  hotendPower:   0,
  bedTemp:       null,
  bedTarget:     0,
  bedPower:      0,
  fanSpeed:      0,
  filename:      '',
  state:         'standby',
  isPrinting:    false,
  isPaused:      false,
  printDuration: 0,
  filamentUsed:  0,
  currentLayer:  null,
  totalLayers:   null,
  progress:      0,
  speedFactor:   1.0,
  extrudeFactor: 1.0,
  posX: null, posY: null, posZ: null,
  homedAxes: '',
})

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
  if (data.fan?.speed          != null) printer.fanSpeed      = data.fan.speed
  if (data.display_status?.progress != null) printer.progress = data.display_status.progress
  if (data.print_stats) {
    const ps = data.print_stats
    if (ps.state          != null) { printer.state = ps.state; printer.isPrinting = ps.state === 'printing'; printer.isPaused = ps.state === 'paused' }
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
    if (data.toolhead.position   != null) { printer.posX = data.toolhead.position[0]; printer.posY = data.toolhead.position[1]; printer.posZ = data.toolhead.position[2] }
    if (data.toolhead.homed_axes != null) printer.homedAxes = data.toolhead.homed_axes
  }
  if (data.extruder?.temperature != null || data.heater_bed?.temperature != null) {
    const t = Date.now()
    if (printer.hotendTemp != null) { tempHistory.hotend.push({ t, v: printer.hotendTemp }); if (tempHistory.hotend.length > HISTORY_LEN) tempHistory.hotend.shift() }
    if (printer.bedTemp    != null) { tempHistory.bed.push({ t, v: printer.bedTemp });        if (tempHistory.bed.length    > HISTORY_LEN) tempHistory.bed.shift() }
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
  { type: 'state',     label: 'State Header',       defaultW: 700, defaultH: 80,  defaultConfig: {}, fields: [{ key: 'filename', label: 'Filename' }, { key: 'layer', label: 'Layer counter' }] },
  { type: 'hotend',    label: 'Hotend Temp',         defaultW: 180, defaultH: 160, defaultConfig: { label: 'Hotend' }, fields: [{ key: 'power', label: 'Heater power bar' }] },
  { type: 'bed',       label: 'Bed Temp',            defaultW: 180, defaultH: 160, defaultConfig: { label: 'Bed' },    fields: [{ key: 'power', label: 'Heater power bar' }] },
  { type: 'chart',     label: 'Temperature Chart',   defaultW: 560, defaultH: 200, defaultConfig: {}, fields: [] },
  { type: 'progress',  label: 'Print Progress',      defaultW: 520, defaultH: 120, defaultConfig: {}, fields: [{ key: 'time', label: 'Print time' }, { key: 'eta', label: 'ETA' }, { key: 'filament', label: 'Filament used' }] },
  { type: 'fan',       label: 'Part Fan',            defaultW: 180, defaultH: 140, defaultConfig: { label: 'Part Fan' }, fields: [] },
  { type: 'speedflow', label: 'Speed / Flow',        defaultW: 220, defaultH: 140, defaultConfig: {}, fields: [] },
  { type: 'toolhead',  label: 'Toolhead Position',   defaultW: 260, defaultH: 160, defaultConfig: {}, fields: [{ key: 'buttons', label: 'Home buttons' }] },
  { type: 'controls',  label: 'Print Controls',      defaultW: 600, defaultH: 60,  defaultConfig: {}, fields: [] },
  { type: 'macros',    label: 'Macro Buttons',       defaultW: 400, defaultH: 100, defaultConfig: { macros: ['BED_MESH_CALIBRATE', 'LOAD_FILAMENT', 'UNLOAD_FILAMENT'] }, fields: [] },
  { type: 'camera',    label: 'Camera Feed',         defaultW: 320, defaultH: 260, defaultConfig: { cameraId: null }, fields: [{ key: 'label', label: 'Show camera name' }] },
]

function widgetFields(type)  { return WIDGET_DEFS.find(d => d.type === type)?.fields || [] }
function defaultConfig(type) { return WIDGET_DEFS.find(d => d.type === type)?.defaultConfig || {} }
function isFieldHidden(w, key) { return w.config?.hiddenFields?.includes(key) }

// ── Default layout ─────────────────────────────────────────────
function buildDefaultLayout() {
  return [
    { id: 'state',     type: 'state',     x: 0,   y: 0,   w: 740, h: 80,  config: {} },
    { id: 'hotend',    type: 'hotend',    x: 0,   y: 100, w: 180, h: 160, config: {} },
    { id: 'bed',       type: 'bed',       x: 190, y: 100, w: 180, h: 160, config: {} },
    { id: 'fan',       type: 'fan',       x: 380, y: 100, w: 180, h: 160, config: {} },
    { id: 'speedflow', type: 'speedflow', x: 570, y: 100, w: 220, h: 160, config: {} },
    { id: 'progress',  type: 'progress',  x: 0,   y: 280, w: 560, h: 120, config: {} },
    { id: 'toolhead',  type: 'toolhead',  x: 570, y: 280, w: 220, h: 160, config: {} },
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
function tempClass(temp, target) {
  if (temp == null || target === 0) return ''
  const diff = Math.abs(temp - target)
  if (diff < 3)       return 'temp-at-target'
  if (temp < target)  return 'temp-heating'
  return 'temp-over'
}

function formatDuration(s) {
  if (!s) return '0:00:00'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60)
  return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
}

function formatEta(elapsed, progress) {
  if (!progress || progress <= 0) return '—'
  const remaining = (elapsed / progress) - elapsed
  return new Date(Date.now() + remaining * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function cameraLabel(id) {
  if (!id) return 'Camera'
  return settings.cameras?.find(c => c.id === id)?.name || id
}

const defaultMacros = ['BED_MESH_CALIBRATE', 'LOAD_FILAMENT', 'UNLOAD_FILAMENT']

// ── Cancel confirm ─────────────────────────────────────────────
const showCancelConfirm = ref(false)
function confirmCancel() { showCancelConfirm.value = true }
async function doCancel() { showCancelConfirm.value = false; await sendGcode('CANCEL_PRINT') }

// ── Temperature chart ──────────────────────────────────────────
const chartCanvases = ref({})
let chartTimer = null

function drawCharts() {
  for (const [id, canvas] of Object.entries(chartCanvases.value)) {
    if (!canvas) continue
    const w = canvas.offsetWidth, h = canvas.offsetHeight
    if (!w || !h) continue
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    const cs  = getComputedStyle(document.documentElement)
    const colH = cs.getPropertyValue('--amber').trim()
    const colB = cs.getPropertyValue('--teal').trim()
    const colG = cs.getPropertyValue('--border').trim()
    const colT = cs.getPropertyValue('--text-muted').trim()

    ctx.clearRect(0, 0, w, h)

    const all = [...tempHistory.hotend.map(p => p.v), ...tempHistory.bed.map(p => p.v)].filter(Boolean)
    if (all.length < 2) {
      ctx.fillStyle = colT; ctx.font = '12px system-ui'; ctx.textAlign = 'center'
      ctx.fillText('Temperature data will appear here', w / 2, h / 2)
      continue
    }

    const pad = { t: 8, r: 8, b: 28, l: 40 }
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b
    const minT = Math.min(...all) - 5, maxT = Math.max(...all) + 5
    const allTs = [...tempHistory.hotend, ...tempHistory.bed].map(p => p.t)
    const tMin = Math.min(...allTs), tRange = Math.max(...allTs) - tMin || 1

    ctx.strokeStyle = colG; ctx.lineWidth = 0.5
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (ph / 4) * i
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke()
      ctx.fillStyle = colT; ctx.font = '10px system-ui'; ctx.textAlign = 'right'
      ctx.fillText((maxT - ((maxT - minT) / 4) * i).toFixed(0) + '°', pad.l - 3, y + 4)
    }

    for (const [data, colour, label, li] of [[tempHistory.hotend, colH, 'Hotend', 0],[tempHistory.bed, colB, 'Bed', 1]]) {
      if (data.length < 2) continue
      ctx.strokeStyle = colour; ctx.lineWidth = 1.5; ctx.beginPath()
      data.forEach((p, i) => {
        const x = pad.l + ((p.t - tMin) / tRange) * pw
        const y = pad.t + ph - ((p.v - minT) / (maxT - minT)) * ph
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.stroke()
      ctx.fillStyle = colour; ctx.beginPath(); ctx.arc(pad.l + 8 + li * 68, h - 10, 4, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = colT; ctx.font = '10px system-ui'; ctx.textAlign = 'left'
      ctx.fillText(label, pad.l + 16 + li * 68, h - 6)
    }
  }
}

// ── Customize helpers ──────────────────────────────────────────
const showLoadMenu = ref(false)
function exitCustomize() { layout.exitCustomize(); showLoadMenu.value = false }
async function toggleLoadMenu() { showLoadMenu.value = !showLoadMenu.value; if (showLoadMenu.value) await layout.fetchAvailableLayouts() }
async function doLoadLayout(f) { await layout.loadLayout(f.replace(/^.*\//, '')); showLoadMenu.value = false }
function promptSaveAs() { const name = prompt('Save layout as:', 'my_printer_layout'); if (name) layout.saveLayout(name) }

// ── Lifecycle ──────────────────────────────────────────────────
let unsubscribe = null

onMounted(async () => {
  await layout.tryAutoLoad()
  unsubscribe = subscribeToStatus(handleStatus)
  chartTimer = setInterval(drawCharts, 1000)
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
  if (chartTimer) clearInterval(chartTimer)
})
</script>

<style scoped>
.pd-root { position: relative; min-height: 100%; padding-bottom: 40px; }

.pd-offline { display: flex; align-items: center; gap: 10px; padding: 10px 14px; margin-bottom: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); font-size: 13px; color: var(--text-dim); }
.pd-offline-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--amber); opacity: 0.5; animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:1} }

.dash-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; min-height: 36px; flex-shrink: 0; gap: 10px; position: relative; flex-wrap: wrap; }
.dt-left  { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.dt-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.dt-mode-label { font-size: 11px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--amber); white-space: nowrap; }
.dt-save-msg { font-size: 11px; color: var(--green); font-family: var(--font-mono); }
.pd-state-label { font-size: 15px; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; }
.pd-filename { font-size: 12px; color: var(--text-dim); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.customize-btn { transition: color 0.12s, border-color 0.12s; }
.customize-btn--active { color: var(--amber); border-color: var(--amber); }

.add-widget-wrap { position: relative; }
.add-widget-dropdown { position: absolute; top: 32px; left: 0; z-index: 200; background: var(--surface); border: 1px solid var(--border-2); border-radius: var(--radius); padding: 6px; display: flex; flex-direction: column; gap: 2px; min-width: 180px; }
.add-widget-item { text-align: left; padding: 6px 10px; background: transparent; border: none; color: var(--text-dim); font-size: 12px; cursor: pointer; border-radius: var(--radius); transition: background 0.1s; }
.add-widget-item:hover { background: var(--surface-2); color: var(--text); }

.load-menu { position: absolute; top: 40px; right: 80px; z-index: 200; background: var(--surface); border: 1px solid var(--border-2); border-radius: var(--radius); padding: 6px; display: flex; flex-direction: column; gap: 2px; min-width: 180px; }
.load-menu-item { text-align: left; padding: 6px 10px; background: transparent; border: none; color: var(--text-dim); font-size: 12px; cursor: pointer; border-radius: var(--radius); transition: background 0.1s; }
.load-menu-item:hover { background: var(--surface-2); color: var(--text); }

.dash-canvas { position: relative; width: 100%; }
.grid-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }

/* State */
.w-state { display: flex; flex-direction: column; gap: 5px; height: 100%; justify-content: center; }
.ws-status   { font-size: 22px; font-weight: 700; letter-spacing: 0.04em; }
.ws-filename { font-size: 12px; color: var(--text-dim); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ws-layer    { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }

/* Temp */
.w-temp { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 4px; }
.wt-label { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); }
.wt-value { font-size: 34px; font-weight: 700; font-family: var(--font-mono); color: var(--text); transition: color 0.4s; }
.wt-value.temp-at-target { color: var(--green); }
.wt-value.temp-heating   { color: var(--amber); }
.wt-value.temp-over      { color: var(--red);   }
.wt-target { font-size: 13px; color: var(--text-dim); font-family: var(--font-mono); }
.wt-arrow  { color: var(--amber); }
.wt-power-bar  { width: 80%; height: 4px; background: var(--surface-2); border-radius: 2px; overflow: hidden; margin-top: 2px; }
.wt-power-fill { height: 100%; background: var(--amber); border-radius: 2px; transition: width 0.5s ease; }
.wt-off { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); letter-spacing: 0.08em; }

/* Chart */
.w-chart { display: flex; flex-direction: column; height: 100%; gap: 4px; }
.wch-label  { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); flex-shrink: 0; }
.wch-canvas { flex: 1; width: 100%; min-height: 0; }

/* Progress */
.w-progress { display: flex; flex-direction: column; gap: 8px; justify-content: center; height: 100%; }
.wp-filename  { font-size: 12px; color: var(--text-dim); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-bar-track { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
.wp-bar-fill  { height: 100%; background: var(--amber); border-radius: 4px; transition: width 0.8s ease; }
.wp-stats { display: flex; align-items: baseline; gap: 14px; }
.wp-pct  { font-size: 22px; font-weight: 700; font-family: var(--font-mono); }
.wp-time { font-size: 12px; color: var(--text-dim);  font-family: var(--font-mono); }
.wp-eta  { font-size: 12px; color: var(--teal);      font-family: var(--font-mono); }
.wp-filament { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }

/* Fan */
.w-fan { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 6px; }
.wf-label { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); }
.wf-value { font-size: 28px; font-weight: 700; font-family: var(--font-mono); color: var(--teal); }
.wf-value.wf-off { color: var(--text-muted); }
.wf-bar-track { width: 80%; height: 4px; background: var(--surface-2); border-radius: 2px; overflow: hidden; }
.wf-bar-fill  { height: 100%; background: var(--teal); border-radius: 2px; transition: width 0.5s ease; }

/* Speed/Flow */
.w-speedflow { display: flex; flex-direction: column; gap: 10px; justify-content: center; height: 100%; }
.wsf-row   { display: flex; align-items: baseline; justify-content: space-between; }
.wsf-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }
.wsf-value { font-size: 20px; font-weight: 700; font-family: var(--font-mono); }
.wsf-btns  { display: flex; gap: 6px; flex-wrap: wrap; }

/* Toolhead */
.w-toolhead { display: flex; flex-direction: column; gap: 10px; justify-content: center; height: 100%; }
.wth-axes { display: flex; flex-direction: column; gap: 4px; }
.wth-axis { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.wth-axis-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); width: 16px; }
.wth-axis-val { font-size: 18px; font-weight: 700; font-family: var(--font-mono); }
.wth-axis-val.wth-unhomed { color: var(--red); }
.wth-btns { display: flex; gap: 6px; }

/* Controls */
.w-controls { display: flex; align-items: center; gap: 8px; height: 100%; flex-wrap: wrap; }

/* Macros */
.w-macros { display: flex; flex-direction: column; gap: 8px; height: 100%; justify-content: center; }
.wm-label { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); }
.wm-btns  { display: flex; gap: 6px; flex-wrap: wrap; }

/* Camera */
.w-camera { display: flex; flex-direction: column; gap: 6px; height: 100%; }
.wc-cam-title { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); flex-shrink: 0; }
.wc-cam-feed  { flex: 1; border-radius: var(--radius); overflow: hidden; min-height: 0; }

/* Modal */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 300; }
.modal { width: 360px; }
.modal-title { font-size: 12px; font-weight: 600; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 14px; }

.btn-sm { padding: 6px 12px; font-size: 12px; }
.btn-xs { padding: 4px 8px; font-size: 11px; }
</style>
