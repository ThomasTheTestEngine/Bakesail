<template>
  <div class="ld-root" @click="closeAllPopouts">

    <!-- ── Interlock banner ────────────────────────────────── -->
    <div v-if="!interlockOk" class="interlock-banner">
      <span>⚠</span>
      <span>INTERLOCK OPEN — Lid or safety circuit not closed. Laser disabled.</span>
    </div>

    <!-- ── Toolbar ─────────────────────────────────────────── -->
    <div class="dash-toolbar">
      <div class="dash-toolbar-left"></div>
      <div class="dash-toolbar-right">
        <!-- Add widget (customize mode only) -->
        <div v-if="layout.customizeMode.value" class="add-widget-wrap" @click.stop>
          <button class="btn btn-ghost btn-sm" @click="layout.addWidgetOpen.value = !layout.addWidgetOpen.value">
            + Add Widget
          </button>
          <div v-if="layout.addWidgetOpen.value" class="add-widget-dropdown">
            <div class="add-widget-title">Add Widget</div>
            <button v-for="def in availableToAdd" :key="def.type"
                    class="add-widget-item" @click="layout.addWidget(def.type, WIDGET_DEFS)">
              {{ def.label }}
            </button>
            <div v-if="availableToAdd.length === 0" class="add-widget-empty">All widgets on dashboard.</div>
          </div>
        </div>

        <button class="customize-btn"
                :class="{ 'customize-btn--active': layout.customizeMode.value }"
                @click.stop="layout.customizeMode.value ? exitCustomize() : layout.enterCustomize()">
          <span v-if="!layout.customizeMode.value && layout.firstTimeSeen.value" class="customize-label">CUSTOMIZE DASHBOARD</span>
          <span v-else-if="layout.customizeMode.value" class="customize-label">EXIT CUSTOMIZE</span>
          ⚙
        </button>
      </div>
    </div>

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
          <div class="w-state" :style="{ '--sc': stateColour }">
            <div class="ws-indicator">
              <div class="ws-dot"></div>
              <span class="ws-label" :style="{ color: w.config.valueColor || null }">{{ stateLabel }}</span>
            </div>
            <div v-if="!w.config.hiddenFields?.includes('job')" class="ws-job">{{ jobName || 'No job loaded' }}</div>
          </div>
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
          <div class="w-camera">
            <div class="wc-cam-title" v-if="cameraForWidget(w)">{{ camDisplayName(cameraForWidget(w)) }}</div>
            <div class="wc-cam-feed">
              <CameraFeed :cam="cameraForWidget(w)" :showLabel="!w.config.hiddenFields?.includes('label')" />
            </div>
            <div v-if="!cameraForWidget(w)" class="wc-cam-empty">No camera assigned — use widget settings ⚙ to select one.</div>
          </div>
        </template>

      </WidgetShell>
    </div>

    <!-- ── Customize footer ────────────────────────────────── -->
    <div v-if="layout.customizeMode.value" class="customize-footer">
      <button class="btn btn-danger btn-sm" @click="layout.revertToDefault()">↺ Revert to Default Dashboard</button>
      <div class="cf-right">
        <span v-if="layout.saveMsg.value" class="cf-msg">{{ layout.saveMsg.value }}</span>
        <div class="load-wrap" @click.stop>
          <button class="btn btn-ghost btn-sm" @click="toggleLoadMenu">⬆ Load Custom Dashboard</button>
          <div v-if="showLoadMenu" class="load-dropdown">
            <div v-if="layout.loadingLayouts.value" class="load-empty">Loading…</div>
            <div v-else-if="layout.availableLayouts.value.length === 0" class="load-empty">No saved layouts found.</div>
            <button v-else v-for="f in layout.availableLayouts.value" :key="f"
                    class="load-item" @click="doLoadLayout(f)">
              {{ f.replace('bakesail_dashboard_laser_', '').replace('.json','') }}
            </button>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" @click="promptSaveAs">⬇ Save as Custom Dashboard</button>
        <button class="btn btn-primary btn-sm" @click="layout.applyLayout()">✓ Apply</button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '../stores/settings.js'
import { useMoonraker } from '../composables/useMoonraker.js'
import { useDashboardLayout } from '../composables/useDashboardLayout.js'
import WidgetShell from '../components/WidgetShell.vue'
import CameraFeed from '../components/CameraFeed.vue'

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
  { type: 'camera',   label: 'Camera Feed',     defaultW: 320, defaultH: 260, defaultConfig: { cameraId: null }, fields: [{ key: 'label', label: 'Show camera name label' }] },
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

const availableToAdd = computed(() => {
  const onCanvas = new Set(layout.widgets.value.map(w => w.type))
  return WIDGET_DEFS.filter(d => d.type === 'camera' || !onCanvas.has(d.type))
})

// ── Actions ────────────────────────────────────────────────────
// ── Camera helpers ─────────────────────────────────────────────
const CAM_TYPE_LABELS = { bga_grid: 'BGA Grid', alignment_chip: 'Alignment - Chip', alignment_board: 'Alignment - Board', custom: 'Custom' }
function cameraForWidget(w) {
  const cams = settings.cameras
  if (!Array.isArray(cams) || cams.length === 0) return null
  if (w.config.cameraId) return cams.find(c => c.id === w.config.cameraId) || cams[0]
  return cams[0]
}
function camDisplayName(cam) { return cam.name || CAM_TYPE_LABELS[cam.type] || 'Camera' }

async function homeAxes()     { await sendGcode('G28') }
async function goOrigin()     { await sendGcode('G0 X0 Y0 F3000') }
async function startJob()     { if (jobName.value) await sendGcode(`SDCARD_PRINT_FILE FILENAME="${jobName.value}"`) }
async function pauseJob()     { await sendGcode('PAUSE') }
async function resumeJob()    { await sendGcode('RESUME') }
async function cancelJob()    { await sendGcode('CANCEL_PRINT') }
async function emergencyStop(){ await sendGcode('M112') }

// ── Customize helpers ──────────────────────────────────────────
function exitCustomize() { layout.exitCustomize(); showLoadMenu.value = false }
function closeAllPopouts() { layout.closeWidgetSettings(); layout.addWidgetOpen.value = false; showLoadMenu.value = false }

const showLoadMenu = ref(false)
async function toggleLoadMenu() { showLoadMenu.value = !showLoadMenu.value; if (showLoadMenu.value) await layout.fetchAvailableLayouts() }
async function doLoadLayout(f)  { await layout.loadLayout(f.replace(/^.*\//, '')); showLoadMenu.value = false }
function promptSaveAs() { const name = prompt('Save layout as:', 'my_laser_layout'); if (name) layout.saveLayout(name) }

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

/* Toolbar */
.dash-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; height: 36px; flex-shrink: 0; }
.dash-toolbar-right { display: flex; align-items: center; gap: 10px; }
.customize-btn { display: flex; align-items: center; gap: 7px; padding: 6px 12px; border-radius: var(--radius); border: 1px solid var(--border-2); background: transparent; color: var(--text-muted); font-size: 13px; cursor: pointer; transition: color 0.12s, border-color 0.12s, background 0.12s; }
.customize-btn:hover   { color: var(--text); border-color: var(--amber-dim); background: var(--amber-glow); }
.customize-btn--active { color: var(--amber); border-color: var(--amber); background: var(--amber-glow); }
.customize-label { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; white-space: nowrap; }

.add-widget-wrap { position: relative; }
.add-widget-dropdown { position: absolute; top: calc(100% + 6px); right: 0; min-width: 200px; background: var(--surface); border: 1px solid var(--border-2); border-radius: var(--radius-lg); padding: 8px; z-index: 200; box-shadow: 0 8px 24px rgba(0,0,0,0.4); display: flex; flex-direction: column; gap: 2px; }
.add-widget-title { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-muted); padding: 4px 8px; margin-bottom: 4px; }
.add-widget-item { text-align: left; padding: 7px 10px; background: transparent; border: none; border-radius: var(--radius); color: var(--text-dim); font-size: 13px; cursor: pointer; transition: background 0.1s, color 0.1s; }
.add-widget-item:hover { background: var(--surface-2); color: var(--text); }
.add-widget-empty { font-size: 12px; color: var(--text-muted); padding: 8px 10px; }

/* Canvas */
.dash-canvas { position: relative; flex: 1; min-height: 400px; }
.grid-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 0; }

/* Footer */
.customize-footer { position: sticky; bottom: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 16px; background: var(--surface); border: 1px solid var(--amber-dim); border-radius: var(--radius-lg); margin-top: 16px; z-index: 10; }
.cf-right { display: flex; align-items: center; gap: 10px; }
.cf-msg { font-size: 12px; color: var(--green); font-family: var(--font-mono); }
.load-wrap { position: relative; }
.load-dropdown { position: absolute; bottom: calc(100% + 6px); right: 0; min-width: 220px; background: var(--surface); border: 1px solid var(--border-2); border-radius: var(--radius-lg); padding: 8px; z-index: 200; box-shadow: 0 -8px 24px rgba(0,0,0,0.4); display: flex; flex-direction: column; gap: 2px; }
.load-item { text-align: left; padding: 7px 10px; background: transparent; border: none; border-radius: var(--radius); color: var(--text-dim); font-size: 13px; cursor: pointer; font-family: var(--font-mono); transition: background 0.1s, color 0.1s; }
.load-item:hover { background: var(--surface-2); color: var(--text); }
.load-empty { font-size: 12px; color: var(--text-muted); padding: 8px 10px; }

/* Widget content */
.w-state { display: flex; flex-direction: column; gap: 6px; height: 100%; justify-content: center; }
.ws-indicator { display: flex; align-items: center; gap: 10px; }
.ws-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--sc, var(--text-muted)); box-shadow: 0 0 8px var(--sc, transparent); flex-shrink: 0; }
.ws-label { font-family: var(--font-mono); font-size: 13px; font-weight: 700; letter-spacing: 0.12em; color: var(--sc, var(--text-muted)); }
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
.w-camera { display: flex; flex-direction: column; gap: 6px; height: 100%; }
.wc-cam-title { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); flex-shrink: 0; }
.wc-cam-feed { flex: 1; border-radius: var(--radius); overflow: hidden; min-height: 0; }
.wc-cam-empty { font-size: 11px; color: var(--text-muted); font-style: italic; }

.btn-sm { padding: 6px 12px; font-size: 12px; }
</style>
