<template>
  <div class="ld-root" @click="closeAllPopouts">

    <!-- ── Interlock banner ────────────────────────────────── -->
    <div v-if="!interlockOk" class="interlock-banner">
      <span>⚠</span>
      <span>INTERLOCK OPEN — Lid or safety circuit not closed. Laser disabled.</span>
    </div>

    <!-- ── Customize shell (gear + toolbar) ──────────────────── -->
    <DashboardCustomizeBar :layout="layout" :widget-defs="WIDGET_DEFS" dashboard-id="laser" />

    <!-- ── Widget canvas ───────────────────────────────────── -->
    <div class="dash-canvas" :style="canvasStyle" @click.self="layout.closeWidgetSettings()">

      <!-- Grid overlay -->
      <svg v-if="layout.customizeMode.value && settings.dashboardGridSnap"
           class="grid-overlay" aria-hidden="true">
        <defs>
          <pattern :id="`lgrid-${_uid}`"
                   :width="settings.dashboardGridSize" :height="settings.dashboardGridSize"
                   patternUnits="userSpaceOnUse">
            <path :d="`M ${settings.dashboardGridSize} 0 L 0 0 0 ${settings.dashboardGridSize}`"
                  fill="none" stroke="rgba(240,127,170,0.08)" stroke-width="0.5"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" :fill="`url(#lgrid-${_uid})`"/>
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

        <!-- ── STATE widget ──────────────────────────────── -->
        <template v-if="w.type === 'state'">
          <StatusHeaderWidget
            :color="stateColour"
            :label="stateLabel"
            :value-color="w.config.valueColor"
          >
            <div v-if="!w.config.hiddenFields?.includes('job')" class="ws-job">{{ jobName || 'No job loaded' }}</div>
          </StatusHeaderWidget>
        </template>

        <!-- ── POSITION widget ───────────────────────────── -->
        <template v-else-if="w.type === 'position'">
          <div class="w-pos">
            <div class="wp-title">POSITION</div>
            <div class="wp-axes">
              <div v-for="ax in ['X','Y']" :key="ax" class="wp-axis-row">
                <span class="wp-axis-label">{{ ax }}</span>
                <span class="wp-axis-value"
                      :style="{ fontSize: (w.config.fontSize||22)+'px', color: w.config.valueColor||null }">
                  {{ pos[ax.toLowerCase()].toFixed(3) }}
                </span>
                <span class="wp-axis-unit">mm</span>
              </div>
            </div>
            <div v-if="!w.config.hiddenFields?.includes('buttons')" class="wp-actions">
              <button class="btn btn-ghost btn-sm" @click="homeAxes" :disabled="!klippyReady">⌂ Home</button>
              <button class="btn btn-ghost btn-sm" @click="goOrigin" :disabled="!klippyReady">◎ Origin</button>
            </div>
          </div>
        </template>

        <!-- ── LASER STATUS widget ───────────────────────── -->
        <template v-else-if="w.type === 'laser'">
          <div class="w-laser">
            <div class="wl-title">LASER</div>
            <div class="wl-power" :class="laserOn ? 'wl--on' : 'wl--off'">
              <span class="wl-val"
                    :style="{ fontSize: (w.config.fontSize||36)+'px', color: w.config.valueColor||null }">
                {{ laserOn ? (laserPower * 100).toFixed(0) : '—' }}
              </span>
              <span class="wl-unit">{{ laserOn ? '%' : 'OFF' }}</span>
            </div>
            <div v-if="!w.config.hiddenFields?.includes('speed')" class="wl-meta">
              <span class="wl-meta-label">Speed</span>
              <span class="wl-meta-val">{{ feedRate }} mm/min</span>
            </div>
            <div v-if="!w.config.hiddenFields?.includes('interlock')" class="wl-meta">
              <span class="wl-meta-label">Interlock</span>
              <span class="wl-meta-val" :class="interlockOk ? 'ok' : 'err'">
                {{ interlockOk ? 'CLOSED' : 'OPEN' }}
              </span>
            </div>
          </div>
        </template>

        <!-- ── JOB PROGRESS widget ───────────────────────── -->
        <template v-else-if="w.type === 'job'">
          <div class="w-job">
            <div class="wj-title">JOB</div>
            <template v-if="jobName">
              <div class="wj-name">{{ jobName }}</div>
              <div class="wj-bar-track"><div class="wj-bar-fill" :style="{ width: jobProgress+'%' }"></div></div>
              <div class="wj-pct"
                   :style="{ color: w.config.valueColor||null }">
                {{ jobProgress.toFixed(1) }}%
              </div>
              <div v-if="!w.config.hiddenFields?.includes('eta') && jobEta" class="wj-eta">ETA {{ jobEta }}</div>
            </template>
            <div v-else class="wj-empty">No job loaded — use Job Queue.</div>
          </div>
        </template>

        <!-- ── CONTROLS widget ───────────────────────────── -->
        <template v-else-if="w.type === 'controls'">
          <div class="w-controls">
            <button class="btn btn-primary btn-sm" @click="startJob"
                    :disabled="!klippyReady || !jobName || !interlockOk || jobRunning">▶ Start</button>
            <button class="btn btn-ghost btn-sm" @click="pauseJob"  :disabled="!jobRunning">⏸ Pause</button>
            <button class="btn btn-ghost btn-sm" @click="resumeJob" :disabled="!jobPaused">▶ Resume</button>
            <button class="btn btn-danger btn-sm" @click="cancelJob" :disabled="!jobRunning && !jobPaused">✕ Cancel</button>
            <div class="wctl-sep"></div>
            <button class="btn btn-danger btn-sm" @click="emergencyStop">⬛ E-Stop</button>
          </div>
        </template>

        <!-- ── CAMERA widget ─────────────────────────────── -->
        <template v-else-if="w.type === 'camera'">
          <CameraWidget :widget="w" />
        </template>

        <!-- ── SYSTEM MONITOR widget ─────────────────────── -->
        <template v-else-if="w.type === 'sysloads'">
          <SystemMonitorWidget />
        </template>

      </WidgetShell>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '../stores/settings.js'
import { useMoonraker } from '../composables/useMoonraker.js'
import { useDashboardLayout } from '../composables/useDashboardLayout.js'
import WidgetShell from '../components/WidgetShell.vue'
import CameraWidget from '../components/CameraWidget.vue'
import SystemMonitorWidget from '../components/SystemMonitorWidget.vue'
import StatusHeaderWidget from '../components/StatusHeaderWidget.vue'
import DashboardCustomizeBar from '../components/DashboardCustomizeBar.vue'

const settings = useSettingsStore()
const { klippyState, sendGcode, subscribeToStatus, connect } = useMoonraker()
const _uid = Math.random().toString(36).slice(2, 7)

const klippyReady = computed(() => klippyState.value === 'ready')

// ── Live state from Moonraker ──────────────────────────────────
const pos         = ref({ x: 0, y: 0 })
const laserOn     = ref(false)
const laserPower  = ref(0)
const feedRate    = ref(0)
const interlockOk = ref(true)
const jobName     = ref('')
const jobProgress = ref(0)
const jobEta      = ref('')
const jobRunning  = ref(false)
const jobPaused   = ref(false)

const stateColour = computed(() => {
  if (!interlockOk.value) return 'var(--red)'
  if (jobRunning.value)   return 'var(--amber)'
  if (jobPaused.value)    return 'var(--yellow)'
  return 'var(--text-muted)'
})
const stateLabel = computed(() => {
  if (!interlockOk.value) return 'INTERLOCK OPEN'
  if (jobRunning.value)   return 'RUNNING'
  if (jobPaused.value)    return 'PAUSED'
  if (jobName.value)      return 'READY'
  return 'IDLE'
})

let unsubscribe = null
function handleStatus(data) {
  if (data.toolhead?.position) { const p = data.toolhead.position; pos.value = { x: p[0]??0, y: p[1]??0 } }
  if (data.toolhead?.speed != null) feedRate.value = Math.round(data.toolhead.speed * 60)
  if (data.print_stats) {
    const ps = data.print_stats
    jobRunning.value = ps.state === 'printing'
    jobPaused.value  = ps.state === 'paused'
    jobName.value = (ps.state === 'printing' || ps.state === 'paused') ? (ps.filename ?? jobName.value) : ''
  }
  if (data.display_status?.progress != null) jobProgress.value = data.display_status.progress * 100
  if (data['output_pin laser_pwm'] != null) { laserPower.value = data['output_pin laser_pwm'].value; laserOn.value = laserPower.value > 0 }
}

// ── Widget definitions ─────────────────────────────────────────
const WIDGET_DEFS = [
  { type: 'state',    label: 'State Header',    defaultW: 500, defaultH: 80,  defaultConfig: {}, fields: [{ key: 'job', label: 'Job filename' }] },
  { type: 'position', label: 'Position',        defaultW: 240, defaultH: 180, defaultConfig: {}, fields: [{ key: 'buttons', label: 'Home / Origin buttons' }] },
  { type: 'laser',    label: 'Laser Status',    defaultW: 220, defaultH: 180, defaultConfig: {}, fields: [{ key: 'speed', label: 'Speed readout' }, { key: 'interlock', label: 'Interlock status' }] },
  { type: 'job',      label: 'Job Progress',    defaultW: 280, defaultH: 160, defaultConfig: {}, fields: [{ key: 'eta', label: 'ETA' }] },
  { type: 'controls', label: 'Job Controls',    defaultW: 480, defaultH: 80,  defaultConfig: {}, fields: [] },
  { type: 'camera',   label: 'Camera Feed',     defaultW: 320, defaultH: 260, defaultConfig: { cameraId: null }, multiple: true, fields: [{ key: 'label', label: 'Show camera name label' }] },
  { type: 'sysloads', label: 'System Monitor',  defaultW: 420, defaultH: 260, defaultConfig: {}, fields: [] },
]

function widgetFields(type)  { return WIDGET_DEFS.find(d => d.type === type)?.fields || [] }
function defaultConfig(type) { return WIDGET_DEFS.find(d => d.type === type)?.defaultConfig || {} }

// ── Default layout ─────────────────────────────────────────────
const DEFAULT_LAYOUT = [
  { id: 'state',    type: 'state',    x: 0,   y: 0,   w: 700, h: 80,  config: {} },
  { id: 'position', type: 'position', x: 0,   y: 100, w: 240, h: 180, config: {} },
  { id: 'laser',    type: 'laser',    x: 260, y: 100, w: 220, h: 180, config: {} },
  { id: 'job',      type: 'job',      x: 500, y: 100, w: 280, h: 180, config: {} },
  { id: 'controls', type: 'controls', x: 0,   y: 300, w: 700, h: 80,  config: {} },
]

const layout = useDashboardLayout('laser', DEFAULT_LAYOUT)

const canvasStyle = computed(() => {
  const minH = layout.widgets.value.reduce((m, w) => Math.max(m, w.y + w.h), 400)
  return { height: (minH + 80) + 'px' }
})

// ── Actions ────────────────────────────────────────────────────
// ── Camera helpers ─────────────────────────────────────────────
async function homeAxes()     { await sendGcode('G28') }
async function goOrigin()     { await sendGcode('G0 X0 Y0 F3000') }
async function startJob()     { if (jobName.value) await sendGcode(`SDCARD_PRINT_FILE FILENAME="${jobName.value}"`) }
async function pauseJob()     { await sendGcode('PAUSE') }
async function resumeJob()    { await sendGcode('RESUME') }
async function cancelJob()    { await sendGcode('CANCEL_PRINT') }
async function emergencyStop(){ await sendGcode('M112') }

// ── Customize helpers ──────────────────────────────────────────
function closeAllPopouts() { layout.closeWidgetSettings(); layout.addWidgetOpen.value = false }

onMounted(async () => {
  connect()
  await layout.tryAutoLoad()
  if (typeof subscribeToStatus === 'function') unsubscribe = subscribeToStatus(handleStatus)
})
onUnmounted(() => { if (unsubscribe) unsubscribe() })
</script>

<style scoped>
.ld-root { display: flex; flex-direction: column; gap: 0; min-height: 100%; position: relative; }

.interlock-banner {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 18px; margin-bottom: 8px;
  background: var(--red-glow); border: 1px solid var(--red);
  border-radius: var(--radius-lg); color: var(--red); font-weight: 600; font-size: 13px;
}

/* Canvas */
.dash-canvas { position: relative; flex: 1; min-height: 400px; }
.grid-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; }

/* Widget content */
.ws-job { font-size: 12px; color: var(--text-dim); font-family: var(--font-mono); }

.w-pos { display: flex; flex-direction: column; gap: 8px; height: 100%; }
.wp-title { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-muted); }
.wp-axes { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.wp-axis-row { display: flex; align-items: baseline; gap: 8px; }
.wp-axis-label { font-size: 11px; font-weight: 700; color: var(--text-muted); width: 14px; }
.wp-axis-value { font-family: var(--font-mono); font-size: var(--widget-font-size, 22px); color: var(--widget-value-color, var(--text)); }
.wp-axis-unit { font-size: 12px; color: var(--text-dim); }
.wp-actions { display: flex; gap: 8px; }

.w-laser { display: flex; flex-direction: column; gap: 6px; height: 100%; }
.wl-title { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-muted); }
.wl-power { flex: 1; display: flex; align-items: center; }
.wl-val { font-family: var(--font-mono); font-size: var(--widget-font-size, 36px); font-weight: 700; }
.wl-unit { font-size: 14px; color: var(--text-dim); margin-left: 4px; }
.wl--on .wl-val { color: var(--widget-value-color, var(--amber)); text-shadow: 0 0 12px var(--amber); }
.wl--off .wl-val { color: var(--widget-value-color, var(--text-muted)); }
.wl-meta { display: flex; justify-content: space-between; font-size: 12px; }
.wl-meta-label { color: var(--text-muted); }
.wl-meta-val { font-family: var(--font-mono); color: var(--text); }
.wl-meta-val.ok { color: var(--green); } .wl-meta-val.err { color: var(--red); }

.w-job { display: flex; flex-direction: column; gap: 8px; height: 100%; }
.wj-title { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-muted); }
.wj-name { font-family: var(--font-mono); font-size: 12px; color: var(--text); word-break: break-all; }
.wj-bar-track { height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
.wj-bar-fill  { height: 100%; background: var(--amber); border-radius: 3px; transition: width 0.5s; }
.wj-pct { font-family: var(--font-mono); font-size: 12px; color: var(--text-dim); }
.wj-eta { font-size: 11px; color: var(--text-muted); }
.wj-empty { font-size: 12px; color: var(--text-muted); font-style: italic; }

.w-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; height: 100%; }
.wctl-sep { flex: 1; }

/* Camera */

.btn-sm { padding: 6px 12px; font-size: 12px; }
</style>
