<template>
  <!-- Delegate to laser dashboard for laser_plotter device type -->
  <LaserDashboard v-if="settings.deviceType === 'laser_plotter'" />

  <div v-else class="dashboard-root" @click="closeAllPopouts">

    <!-- ── Overtemp alarm ────────────────────────────────────── -->
    <div v-if="store.isOvertemp && !store.overtempAck" class="overtemp-banner">
      <span class="overtemp-icon">⚠</span>
      <span class="overtemp-text">
        OVERTEMP — {{ store.overtempZones.map(z => `Zone ${z.index}: ${z.temp}°C`).join(', ') }}
        exceeds {{ store.overtempThreshold }}°C threshold
      </span>
      <div class="overtemp-actions">
        <button class="btn btn-danger btn-sm" @click="emergencyStop">E-Stop</button>
        <button class="btn btn-ghost btn-sm" @click="store.acknowledgeOvertemp">Dismiss</button>
      </div>
    </div>

    <!-- ── Top toolbar ─────────────────────────────────────── -->
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
            <button
              v-for="def in availableToAdd"
              :key="def.type"
              class="add-widget-item"
              @click="layout.addWidget(def.type, WIDGET_DEFS)"
            >
              {{ def.label }}
            </button>
            <div v-if="availableToAdd.length === 0" class="add-widget-empty">All widgets are on the dashboard.</div>
          </div>
        </div>

        <!-- Customize toggle -->
        <button
          class="customize-btn"
          :class="{ 'customize-btn--active': layout.customizeMode.value }"
          @click.stop="layout.customizeMode.value ? exitCustomize() : layout.enterCustomize()"
        >
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
          <pattern :id="`grid-${_uid}`"
                   :width="settings.dashboardGridSize" :height="settings.dashboardGridSize"
                   patternUnits="userSpaceOnUse">
            <path :d="`M ${settings.dashboardGridSize} 0 L 0 0 0 ${settings.dashboardGridSize}`"
                  fill="none" stroke="rgba(240,127,170,0.08)" stroke-width="0.5"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" :fill="`url(#grid-${_uid})`"/>
      </svg>

      <!-- Widgets -->
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
        <!-- ── ZONE widget ───────────────────────────────── -->
        <template v-if="w.type === 'zone'">
          <div class="w-zone">
            <div class="wz-name">{{ zoneLabel(zoneForWidget(w)) }}</div>
            <div class="wz-temp"
                 :class="tempClass(zoneForWidget(w)?.temp)"
                 :style="{ fontSize: (w.config.fontSize || 44) + 'px', color: w.config.valueColor || null }">
              {{ zoneForWidget(w)?.temp?.toFixed(1) ?? '—.—' }}<span class="wz-unit">°C</span>
            </div>
            <div v-if="!w.config.hiddenFields?.includes('setpoint')" class="wz-sp">
              {{ zoneForWidget(w) ? (zoneSP(zoneForWidget(w)) || 'Idle') : '—' }}
            </div>
            <div v-if="!w.config.hiddenFields?.includes('power')" class="wz-power-row">
              <div class="wz-bar-track">
                <div class="wz-bar-fill" :style="{ width: ((zoneForWidget(w)?.power ?? 0)*100).toFixed(0)+'%' }"></div>
              </div>
              <span class="wz-pct">{{ ((zoneForWidget(w)?.power ?? 0)*100).toFixed(0) }}%</span>
            </div>
          </div>
        </template>

        <!-- ── STATE HEADER widget ──────────────────────── -->
        <template v-else-if="w.type === 'state'">
          <div class="w-state" :style="{ '--sc': store.displayColour }">
            <div class="ws-indicator">
              <div class="ws-dot"></div>
              <span class="ws-label"
                    :style="{ color: w.config.valueColor || null }">
                {{ store.displayLabel.toUpperCase() }}
              </span>
            </div>
            <div v-if="!w.config.hiddenFields?.includes('summary')" class="ws-summary">
              {{ store.stageSummary || 'No profile running' }}
            </div>
            <div v-if="!w.config.hiddenFields?.includes('profile')" class="ws-profile">
              {{ selectedProfile || 'No profile selected' }}
            </div>
          </div>
        </template>

        <!-- ── CHART widget ──────────────────────────────── -->
        <template v-else-if="w.type === 'chart'">
          <div class="w-chart">
            <div class="wc-label">Temperature history (5 min)</div>
            <svg class="wc-svg" viewBox="0 0 600 120" preserveAspectRatio="none">
              <line v-for="t in chartGridTemps" :key="t"
                :x1="32" :y1="chartTempToY(t)" :x2="592" :y2="chartTempToY(t)"
                class="wc-grid" />
              <text v-for="t in chartGridTemps" :key="'l'+t"
                :x="28" :y="chartTempToY(t)+4"
                class="wc-axis" text-anchor="end">{{ t }}</text>
              <line v-if="store.isRunning && store.stage.setpoint"
                :x1="32" :y1="chartTempToY(store.stage.setpoint)"
                :x2="592" :y2="chartTempToY(store.stage.setpoint)"
                class="wc-sp" />
              <line v-if="store.overtempThreshold"
                :x1="32" :y1="chartTempToY(store.overtempThreshold)"
                :x2="592" :y2="chartTempToY(store.overtempThreshold)"
                class="wc-ot" />
              <polyline v-for="(zone, i) in store.zones" :key="zone.index"
                :points="chartPoints(zone.index)"
                :class="`wc-line wc-line--${i}`" fill="none" />
            </svg>
            <div class="wc-legend">
              <div v-for="(zone, i) in store.zones" :key="zone.index" class="wc-legend-item">
                <span :class="`wc-dot wc-dot--${i}`"></span>
                <span>{{ zone.heater.split(' ').slice(-1)[0] }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- ── CONTROLS widget ───────────────────────────── -->
        <template v-else-if="w.type === 'controls'">
          <div class="w-controls">
            <div v-if="store.isRunning || store.isPaused" class="wctl-stage">
              <div class="wctl-bar-track"><div class="wctl-bar-fill" :style="{ width: stageProgress + '%' }"></div></div>
              <span class="wctl-frac">Stage {{ store.stage.number ?? 0 }}/{{ store.stage.count ?? 0 }}</span>
            </div>
            <div class="wctl-profile">
              <span class="wctl-name" v-if="selectedProfile">{{ selectedProfile }}</span>
              <span class="wctl-none" v-else>No profile selected</span>
            </div>
            <div class="wctl-btns">
              <button class="btn btn-ghost btn-sm" @click="showRunModal = true" :disabled="store.isRunning || store.isPaused">⊞ Load</button>
              <button class="btn btn-primary btn-sm" :disabled="!store.canRun || !selectedProfile" @click="runProfile">▶ Run</button>
              <button class="btn btn-ghost btn-sm"
                :disabled="!store.canPause && !store.canResume"
                @click="store.canResume ? resumeProfile() : pauseProfile()">
                {{ store.canResume ? '▶ Resume' : '⏸ Pause' }}
              </button>
              <button class="btn btn-danger btn-sm" :disabled="!store.canAbort" @click="abortProfile">✕ Stop</button>
            </div>
            <div v-if="!w.config.hiddenFields?.includes('ops')" class="wctl-ops">
              <button class="ops-btn ops-btn--pickup" @click="pickup">
                <span class="ops-icon">↑</span><span>Pickup</span>
              </button>
              <button class="ops-btn ops-btn--place" @click="place">
                <span class="ops-icon">↓</span><span>Place</span>
              </button>
              <button v-if="store.hasVacuumPen" class="ops-btn"
                :class="store.vacuumPenOn ? 'ops-btn--on' : 'ops-btn--off'"
                @click="toggleVacuumPen">
                <span class="ops-icon">◎</span><span>Vacuum {{ store.vacuumPenOn ? 'ON' : 'OFF' }}</span>
              </button>
              <button v-if="store.hasNozzleVacuum" class="ops-btn"
                :class="store.nozzleVacuumOn ? 'ops-btn--on' : 'ops-btn--off'"
                @click="toggleNozzleVacuum">
                <span class="ops-icon">⊙</span><span>Nozzle {{ store.nozzleVacuumOn ? 'ON' : 'OFF' }}</span>
              </button>
            </div>
            <div v-if="!w.config.hiddenFields?.includes('overtemp')" class="wctl-ot">
              <span class="wctl-ot-label">⚠ Overtemp</span>
              <input class="wctl-ot-input" type="number" v-model.number="store.overtempThreshold" min="50" max="400" />
              <span class="wctl-ot-unit">°C</span>
            </div>
          </div>
        </template>

        <!-- ── FANS widget ────────────────────────────────── -->
        <template v-else-if="w.type === 'fans'">
          <div class="w-fans">
            <div class="wf-label">Fans</div>
            <div class="wf-list">
              <div v-for="fan in store.fans" :key="fan.name" class="wf-item">
                <span class="wf-name">{{ fan.name }}</span>
                <div class="wf-bar-track"><div class="wf-bar-fill" :style="{ width: (fan.speed*100).toFixed(0)+'%' }"></div></div>
                <span class="wf-pct">{{ (fan.speed*100).toFixed(0) }}%</span>
              </div>
              <div v-if="store.fans.length === 0" class="wf-empty">No fans configured.</div>
            </div>
          </div>
        </template>

        <!-- ── DWELL widget ───────────────────────────────── -->
        <template v-else-if="w.type === 'dwell'">
          <div class="w-dwell" v-if="store.substate === 'dwelling' && store.stage.remaining != null">
            <div class="wd-label">Dwell remaining</div>
            <div class="wd-timer"
                 :style="{ fontSize: (w.config.fontSize || 32)+'px', color: w.config.valueColor || null }">
              {{ dwellFormatted }}
            </div>
            <div class="wd-bar-track"><div class="wd-bar-fill" :style="{ width: dwellProgress+'%' }"></div></div>
          </div>
          <div v-else class="w-dwell-idle">No dwell active.</div>
        </template>

        <!-- ── ERROR widget ───────────────────────────────── -->
        <template v-else-if="w.type === 'error'">
          <div class="w-error" v-if="store.bsState === 'error'">
            <div class="we-label">⚠ Fault</div>
            <div class="we-msg">{{ store.error || 'Unknown error' }}</div>
            <button class="btn btn-ghost btn-sm" style="margin-top:10px" @click="abortProfile">Reset</button>
          </div>
          <div v-else class="w-error-idle">No active faults.</div>
        </template>

      </WidgetShell>
    </div>

    <!-- ── Customize mode footer bar ─────────────────────── -->
    <div v-if="layout.customizeMode.value" class="customize-footer">
      <button class="btn btn-danger btn-sm" @click="layout.revertToDefault(buildDefaultLayout(store.zones))">↺ Revert to Default Dashboard</button>
      <div class="cf-right">
        <span v-if="layout.saveMsg.value" class="cf-msg">{{ layout.saveMsg.value }}</span>
        <div class="load-wrap" @click.stop>
          <button class="btn btn-ghost btn-sm" @click="toggleLoadMenu">⬆ Load Custom Dashboard</button>
          <div v-if="showLoadMenu" class="load-dropdown">
            <div v-if="layout.loadingLayouts.value" class="load-empty">Loading…</div>
            <div v-else-if="layout.availableLayouts.value.length === 0" class="load-empty">No saved layouts found.</div>
            <button v-else v-for="f in layout.availableLayouts.value" :key="f"
                    class="load-item" @click="loadLayout(f)">
              {{ f.replace('bakesail_dashboard_thermal_', '').replace('.json','') }}
            </button>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" @click="promptSaveAs">⬇ Save as Custom Dashboard</button>
        <button class="btn btn-primary btn-sm" @click="layout.applyLayout()">✓ Apply</button>
      </div>
    </div>

    <!-- ── Run profile modal ──────────────────────────────── -->
    <div v-if="showRunModal" class="modal-backdrop" @click.self="showRunModal = false">
      <div class="modal card">
        <div class="modal-title">Load Profile</div>
        <div v-if="profiles.length === 0" class="modal-empty">
          No profiles found. Add .json files to ~/printer_data/config/bakesail_profiles/
        </div>
        <div v-else class="profile-list">
          <button v-for="p in profiles" :key="p" class="profile-item"
                  :class="{ 'profile-item--selected': p === selectedProfile }"
                  @click="chooseProfile(p)">
            {{ p }}
          </button>
        </div>
        <button class="btn btn-ghost" style="margin-top:16px;width:100%" @click="showRunModal = false">Cancel</button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useDeviceStore } from '../stores/device.js'
import { useSettingsStore } from '../stores/settings.js'
import { useMoonraker } from '../composables/useMoonraker.js'
import { useDashboardLayout } from '../composables/useDashboardLayout.js'
import WidgetShell from '../components/WidgetShell.vue'
import LaserDashboard from './LaserDashboard.vue'

const store    = useDeviceStore()
const settings = useSettingsStore()
const { send, runGcode, connected } = useMoonraker()
const _uid = Math.random().toString(36).slice(2, 7)

// ── Widget definitions ─────────────────────────────────────────
// Each entry describes a widget type: its label, default size, default config,
// and the toggleable display fields available in its settings popout.
const WIDGET_DEFS = [
  {
    type: 'state', label: 'State Header',
    defaultW: 500, defaultH: 80,
    defaultConfig: {},
    fields: [
      { key: 'summary', label: 'Stage summary' },
      { key: 'profile', label: 'Active profile name' },
    ],
  },
  {
    type: 'zone', label: 'Zone Temperature',
    defaultW: 200, defaultH: 160,
    defaultConfig: { zoneIndex: 1 },
    fields: [
      { key: 'setpoint', label: 'Setpoint' },
      { key: 'power',    label: 'Heater power bar' },
    ],
  },
  {
    type: 'chart', label: 'Temperature Chart',
    defaultW: 560, defaultH: 180,
    defaultConfig: {},
    fields: [],
  },
  {
    type: 'controls', label: 'Profile Controls',
    defaultW: 480, defaultH: 200,
    defaultConfig: {},
    fields: [
      { key: 'ops',      label: 'Operation buttons (pickup/place/vacuum)' },
      { key: 'overtemp', label: 'Overtemp threshold control' },
    ],
  },
  {
    type: 'fans', label: 'Fan Status',
    defaultW: 300, defaultH: 120,
    defaultConfig: {},
    fields: [],
  },
  {
    type: 'dwell', label: 'Dwell Timer',
    defaultW: 240, defaultH: 120,
    defaultConfig: {},
    fields: [],
  },
  {
    type: 'error', label: 'Error / Fault',
    defaultW: 300, defaultH: 120,
    defaultConfig: {},
    fields: [],
  },
]

function widgetFields(type)   { return WIDGET_DEFS.find(d => d.type === type)?.fields || [] }
function defaultConfig(type)  { return WIDGET_DEFS.find(d => d.type === type)?.defaultConfig || {} }

// ── Default layout — mirrors the old static layout ─────────────
// Each zone gets its own widget. State, chart, controls are fixed.
function buildDefaultLayout(zones) {
  const zoneList = (zones && zones.length > 0) ? zones : [{ index: 1, label: 'Zone 1', type: 'target' }]
  const result = [
    { id: 'state',    type: 'state',    x: 0,   y: 0,   w: 700, h: 80,  config: {} },
    { id: 'controls', type: 'controls', x: 0,   y: 360, w: 700, h: 220, config: {} },
    { id: 'chart',    type: 'chart',    x: 0,   y: 600, w: 700, h: 200, config: {} },
    { id: 'fans',     type: 'fans',     x: 720, y: 360, w: 280, h: 120, config: {} },
    { id: 'dwell',    type: 'dwell',    x: 720, y: 500, w: 280, h: 100, config: {} },
  ]
  let zx = 0
  zoneList.forEach(z => {
    result.push({
      id:     `zone_${z.index}`,
      type:   'zone',
      x: zx, y: 100,
      w: 180, h: 200,
      config: { zoneIndex: z.index },
    })
    zx += 190
  })
  return result
}

// Seed with placeholder — rebuilt once zones are known in onMounted
const layout = useDashboardLayout('thermal', buildDefaultLayout([]))

// Canvas size — tracks bounding box of all widgets + padding
const canvasStyle = computed(() => {
  const minH = layout.widgets.value.reduce((m, w) => Math.max(m, w.y + w.h), 600)
  return { height: (minH + 80) + 'px' }
})

// Available widget types not already on canvas
const availableToAdd = computed(() => {
  const onCanvas = new Set(layout.widgets.value.map(w => w.type))
  // Zone can be multi, others singular
  return WIDGET_DEFS.filter(d => d.type === 'zone' || !onCanvas.has(d.type))
})

// ── Zone helpers ───────────────────────────────────────────────
function zoneLabel(z)    { return z?.label || `Zone ${z?.index ?? '?'}` }
function zoneForWidget(w){ return store.zones.find(z => z.index === (w.config.zoneIndex || 1)) || store.zones[0] }
function tempClass(t) {
  if (!t || t <= 0) return 'wz-temp--dim'
  if (t > 220) return 'wz-temp--hot'
  if (t > 100) return 'wz-temp--warm'
  return ''
}
function zoneSP(z) {
  if (!store.isRunning || !store.stage.setpoint) return null
  return (store.stage.setpoint + (z.offset || 0)).toFixed(1) + '°C'
}

// ── Chart ──────────────────────────────────────────────────────
const chartGridTemps = [50, 100, 150, 200, 250, 300]
const CHART_T_MIN = 20, CHART_T_MAX = 300
const CHART_MAX_T = 300000
function chartTempToY(temp) {
  const frac = (temp - CHART_T_MIN) / (CHART_T_MAX - CHART_T_MIN)
  return 120 - 8 - frac * (120 - 8 - 8)
}
function chartPoints(zoneIndex) {
  const history = store.tempHistory?.[zoneIndex]
  if (!history || history.length < 2) return ''
  const now = Date.now(), start = now - CHART_MAX_T
  return history.filter(p => p.t >= start).map(p => {
    const x = 32 + ((p.t - start) / CHART_MAX_T) * (600 - 32 - 8)
    const y = chartTempToY(p.temp)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

// ── Stage / dwell ──────────────────────────────────────────────
const stageProgress = computed(() => {
  const s = store.stage
  if (!s.number || !s.count) return 0
  return Math.round(((s.number - 1) / s.count) * 100)
})
const dwellProgress = computed(() => {
  const s = store.stage
  if (!s.duration || s.remaining == null) return 0
  return Math.round(((s.duration - s.remaining) / s.duration) * 100)
})
const dwellFormatted = computed(() => {
  const rem = store.stage.remaining ?? 0
  const m = Math.floor(rem / 60).toString().padStart(2,'0')
  const s = Math.floor(rem % 60).toString().padStart(2,'0')
  return `${m}:${s}`
})

// ── Profiles ───────────────────────────────────────────────────
const showRunModal    = ref(false)
const profiles        = ref([])
const selectedProfile = ref(localStorage.getItem('bakesail-last-profile') || '')

async function loadProfiles() {
  try {
    const res = await send('server.files.list', { root: 'config' })
    profiles.value = res
      .filter(f => f.path?.startsWith('bakesail_profiles/') && f.path.endsWith('.json'))
      .map(f => f.path.replace('bakesail_profiles/', '').replace('.json', ''))
    if (!selectedProfile.value && profiles.value.length > 0) selectProfile(profiles.value[0])
    else if (selectedProfile.value && !profiles.value.includes(selectedProfile.value)) selectProfile(profiles.value[0] || '')
  } catch (e) { console.warn('[bakesail] could not load profiles:', e) }
}
function selectProfile(name) { selectedProfile.value = name; if (name) localStorage.setItem('bakesail-last-profile', name) }
function chooseProfile(name) { selectProfile(name); showRunModal.value = false }
async function runProfile()    { if (!selectedProfile.value) { showRunModal.value = true; return } try { await runGcode(`BGA_PROFILE_RUN PROFILE="${selectedProfile.value}"`) } catch (e) { console.error(e) } }
async function pauseProfile()  { try { await runGcode('BGA_PROFILE_PAUSE')  } catch (e) { console.error(e) } }
async function resumeProfile() { try { await runGcode('BGA_PROFILE_RESUME') } catch (e) { console.error(e) } }
async function abortProfile()  { try { await runGcode('BGA_PROFILE_ABORT')  } catch (e) { console.error(e) } }

// ── Ops ────────────────────────────────────────────────────────
async function pickup()           { try { await runGcode('SET_PIN PIN=vacuum_pen VALUE=1') } catch (e) { console.error(e) } }
async function place()            { try { await runGcode('SET_PIN PIN=vacuum_pen VALUE=0') } catch (e) { console.error(e) } }
async function toggleVacuumPen()  { const v = store.vacuumPenOn ? 0 : 1; try { await runGcode(`SET_PIN PIN=vacuum_pen VALUE=${v}`); store.vacuumPenOn = !!v } catch (e) { console.error(e) } }
async function toggleNozzleVacuum(){ const v = store.nozzleVacuumOn ? 0 : 1; try { await runGcode(`SET_PIN PIN=nozzle_vacuum VALUE=${v}`); store.nozzleVacuumOn = !!v } catch (e) { console.error(e) } }
async function emergencyStop()    { try { await runGcode('BAKESAIL_ESTOP') } catch (e) { console.error(e) } }

// ── Customize mode helpers ─────────────────────────────────────
function exitCustomize() { layout.exitCustomize(); showLoadMenu.value = false }
function closeAllPopouts() { layout.closeWidgetSettings(); layout.addWidgetOpen.value = false; showLoadMenu.value = false }

// Load / save menu
const showLoadMenu = ref(false)
async function toggleLoadMenu() {
  showLoadMenu.value = !showLoadMenu.value
  if (showLoadMenu.value) await layout.fetchAvailableLayouts()
}
async function loadLayout(f) {
  await layout.loadLayout(f.replace(/^.*\//, ''))
  showLoadMenu.value = false
}
function promptSaveAs() {
  const name = prompt('Save layout as:', 'my_layout')
  if (name) layout.saveLayout(name)
}

onMounted(async () => {
  settings.load()

  // Wait for websocket before querying
  const init = async () => {
    await loadProfiles()

    // Try to load a user-saved layout from disk.
    // If none exists, build the default layout using the real zone list from
    // the device store (which is populated once Moonraker is connected).
    const loaded = await layout.tryAutoLoad()
    if (!loaded) {
      // No saved layout — use real zones from store
      layout.widgets.value = buildDefaultLayout(store.zones)
    }
  }

  if (connected.value) { init() }
  else { const stop = watch(connected, v => { if (v) { init(); stop() } }) }
})
</script>

<style scoped>
.dashboard-root {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 100%;
  position: relative;
}

/* ── Overtemp banner ─────────────────────────────────────────── */
.overtemp-banner {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 18px; margin-bottom: 8px;
  background: var(--red-glow); border: 1px solid var(--red);
  border-radius: var(--radius-lg);
  animation: pulse-border 1.5s ease-in-out infinite;
}
@keyframes pulse-border { 0%,100% { border-color: var(--red); } 50% { border-color: transparent; } }
.overtemp-icon { font-size: 18px; color: var(--red); flex-shrink: 0; }
.overtemp-text { flex: 1; font-size: 13px; color: var(--red); font-family: var(--font-mono); }
.overtemp-actions { display: flex; gap: 8px; }

/* ── Toolbar ─────────────────────────────────────────────────── */
.dash-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  height: 36px;
  flex-shrink: 0;
}
.dash-toolbar-right { display: flex; align-items: center; gap: 10px; }

.customize-btn {
  display: flex; align-items: center; gap: 7px;
  padding: 6px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--text-muted);
  font-size: 13px;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}
.customize-btn:hover    { color: var(--text); border-color: var(--amber-dim); background: var(--amber-glow); }
.customize-btn--active  { color: var(--amber); border-color: var(--amber); background: var(--amber-glow); }
.customize-label { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; white-space: nowrap; }

/* Add widget */
.add-widget-wrap { position: relative; }
.add-widget-dropdown {
  position: absolute;
  top: calc(100% + 6px); right: 0;
  min-width: 200px;
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-lg);
  padding: 8px;
  z-index: 200;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  display: flex; flex-direction: column; gap: 2px;
}
.add-widget-title {
  font-size: 10px; font-weight: 700; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--text-muted);
  padding: 4px 8px; margin-bottom: 4px;
}
.add-widget-item {
  text-align: left; padding: 7px 10px;
  background: transparent; border: none;
  border-radius: var(--radius); color: var(--text-dim);
  font-size: 13px; cursor: pointer;
  transition: background 0.1s, color 0.1s;
}
.add-widget-item:hover { background: var(--surface-2); color: var(--text); }
.add-widget-empty { font-size: 12px; color: var(--text-muted); padding: 8px 10px; }

/* ── Canvas ──────────────────────────────────────────────────── */
.dash-canvas {
  position: relative;
  flex: 1;
  min-height: 600px;
}
.grid-overlay {
  position: absolute; inset: 0; width: 100%; height: 100%;
  pointer-events: none; z-index: 0;
}

/* ── Customize footer ────────────────────────────────────────── */
.customize-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 16px;
  background: var(--surface);
  border: 1px solid var(--amber-dim);
  border-radius: var(--radius-lg);
  margin-top: 16px;
  z-index: 10;
}
.cf-right { display: flex; align-items: center; gap: 10px; }
.cf-msg { font-size: 12px; color: var(--green); font-family: var(--font-mono); }

.load-wrap { position: relative; }
.load-dropdown {
  position: absolute;
  bottom: calc(100% + 6px); right: 0;
  min-width: 220px;
  background: var(--surface);
  border: 1px solid var(--border-2);
  border-radius: var(--radius-lg);
  padding: 8px; z-index: 200;
  box-shadow: 0 -8px 24px rgba(0,0,0,0.4);
  display: flex; flex-direction: column; gap: 2px;
}
.load-item {
  text-align: left; padding: 7px 10px;
  background: transparent; border: none; border-radius: var(--radius);
  color: var(--text-dim); font-size: 13px; cursor: pointer;
  font-family: var(--font-mono);
  transition: background 0.1s, color 0.1s;
}
.load-item:hover { background: var(--surface-2); color: var(--text); }
.load-empty { font-size: 12px; color: var(--text-muted); padding: 8px 10px; }

/* ── Widget content styles ───────────────────────────────────── */

/* Zone */
.w-zone { display: flex; flex-direction: column; gap: 3px; height: 100%; }
.wz-name { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); }
.wz-temp { font-family: var(--font-mono); font-size: var(--widget-font-size, 44px); font-weight: 700; line-height: 1; color: var(--widget-value-color, var(--text)); margin: 4px 0 2px; }
.wz-temp--dim  { color: var(--text-muted) !important; }
.wz-temp--warm { color: var(--amber) !important; }
.wz-temp--hot  { color: var(--red) !important; }
.wz-unit { font-size: 18px; font-weight: 400; color: var(--text-dim); margin-left: 2px; }
.wz-sp { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); }
.wz-power-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.wz-bar-track { flex: 1; height: 3px; background: var(--border-2); border-radius: 2px; overflow: hidden; }
.wz-bar-fill { height: 100%; background: var(--amber); border-radius: 2px; transition: width 0.5s; }
.wz-pct { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); width: 28px; text-align: right; }

/* State */
.w-state { display: flex; flex-direction: column; gap: 6px; height: 100%; justify-content: center; }
.ws-indicator { display: flex; align-items: center; gap: 10px; }
.ws-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--sc, var(--text-muted)); box-shadow: 0 0 8px var(--sc, transparent); flex-shrink: 0; }
.ws-label { font-family: var(--font-mono); font-size: 13px; font-weight: 700; letter-spacing: 0.12em; color: var(--sc, var(--text-muted)); }
.ws-summary { font-size: 12px; color: var(--text-dim); font-family: var(--font-mono); }
.ws-profile { font-size: 12px; color: var(--amber); font-family: var(--font-mono); }

/* Chart */
.w-chart { display: flex; flex-direction: column; height: 100%; }
.wc-label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px; flex-shrink: 0; }
.wc-svg { flex: 1; width: 100%; display: block; }
.wc-grid { stroke: var(--border); stroke-width: 1; }
.wc-axis { font-family: var(--font-mono); font-size: 8px; fill: var(--text-muted); }
.wc-sp { stroke: var(--amber-dim); stroke-width: 1; stroke-dasharray: 3,3; }
.wc-ot { stroke: rgba(224,69,69,0.4); stroke-width: 1; stroke-dasharray: 2,2; }
.wc-line { stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
.wc-line--0 { stroke: var(--amber); } .wc-line--1 { stroke: var(--teal); }
.wc-line--2 { stroke: #9B7FE8; }      .wc-line--3 { stroke: #4CAF7D; }
.wc-legend { display: flex; gap: 16px; margin-top: 6px; flex-shrink: 0; }
.wc-legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-dim); }
.wc-dot { width: 8px; height: 2px; border-radius: 1px; flex-shrink: 0; }
.wc-dot--0 { background: var(--amber); } .wc-dot--1 { background: var(--teal); }
.wc-dot--2 { background: #9B7FE8; }      .wc-dot--3 { background: #4CAF7D; }

/* Controls */
.w-controls { display: flex; flex-direction: column; gap: 10px; height: 100%; overflow: auto; }
.wctl-stage { display: flex; align-items: center; gap: 10px; }
.wctl-bar-track { flex: 1; height: 4px; background: var(--border-2); border-radius: 2px; overflow: hidden; }
.wctl-bar-fill  { height: 100%; background: var(--amber); border-radius: 2px; transition: width 0.5s; }
.wctl-frac { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); white-space: nowrap; }
.wctl-profile { min-width: 0; }
.wctl-name { font-family: var(--font-mono); font-size: 13px; color: var(--amber); }
.wctl-none { font-size: 12px; color: var(--text-muted); font-style: italic; }
.wctl-btns { display: flex; gap: 6px; flex-wrap: wrap; }
.wctl-ops { display: flex; gap: 8px; flex-wrap: wrap; padding-top: 8px; border-top: 1px solid var(--border); }
.ops-btn { display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 8px 12px; border-radius: var(--radius); border: 1px solid var(--border-2); background: var(--surface-2); color: var(--text-dim); font-size: 11px; font-weight: 500; cursor: pointer; transition: background 0.12s, color 0.12s, border-color 0.12s; min-width: 56px; }
.ops-btn:hover { background: var(--surface); color: var(--text); }
.ops-icon { font-size: 15px; }
.ops-btn--pickup:hover { border-color: var(--teal); color: var(--teal); background: var(--teal-glow); }
.ops-btn--place:hover  { border-color: var(--amber); color: var(--amber); background: var(--amber-glow); }
.ops-btn--on  { border-color: var(--teal); color: var(--teal); background: var(--teal-glow); }
.ops-btn--off { color: var(--text-muted); }
.wctl-ot { display: flex; align-items: center; gap: 6px; padding: 5px 10px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-2); }
.wctl-ot-label { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.wctl-ot-input { width: 52px; background: transparent; border: none; color: var(--text); font-family: var(--font-mono); font-size: 13px; text-align: right; outline: none; }
.wctl-ot-unit { font-size: 11px; color: var(--text-muted); }

/* Fans */
.w-fans { display: flex; flex-direction: column; height: 100%; }
.wf-label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 10px; }
.wf-list { display: flex; flex-direction: column; gap: 8px; flex: 1; }
.wf-item { display: flex; align-items: center; gap: 8px; }
.wf-name { font-size: 12px; color: var(--text-dim); width: 60px; flex-shrink: 0; }
.wf-bar-track { flex: 1; height: 4px; background: var(--border-2); border-radius: 2px; overflow: hidden; }
.wf-bar-fill { background: var(--teal); height: 100%; border-radius: 2px; transition: width 0.5s; }
.wf-pct { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); width: 32px; text-align: right; }
.wf-empty { font-size: 12px; color: var(--text-muted); }

/* Dwell */
.w-dwell { display: flex; flex-direction: column; gap: 8px; height: 100%; justify-content: center; }
.w-dwell-idle { font-size: 12px; color: var(--text-muted); }
.wd-label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--teal); }
.wd-timer { font-family: var(--font-mono); font-size: var(--widget-font-size, 32px); font-weight: 700; color: var(--widget-value-color, var(--teal)); }
.wd-bar-track { height: 3px; background: var(--border-2); border-radius: 2px; overflow: hidden; }
.wd-bar-fill  { height: 100%; background: var(--teal); border-radius: 2px; transition: width 0.5s; }

/* Error */
.w-error { display: flex; flex-direction: column; gap: 6px; height: 100%; }
.w-error-idle { font-size: 12px; color: var(--text-muted); }
.we-label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--red); }
.we-msg { font-family: var(--font-mono); font-size: 13px; color: var(--text-dim); }

/* ── Modals ───────────────────────────────────────────────────── */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 300; }
.modal { width: 360px; max-height: 80vh; overflow-y: auto; }
.modal-title { font-size: 12px; font-weight: 600; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 14px; }
.modal-empty { font-size: 13px; color: var(--text-muted); text-align: center; padding: 24px 0; }
.profile-list { display: flex; flex-direction: column; gap: 5px; }
.profile-item { width: 100%; text-align: left; padding: 9px 12px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-family: var(--font-mono); font-size: 13px; cursor: pointer; transition: background 0.12s, border-color 0.12s, color 0.12s; }
.profile-item:hover, .profile-item--selected { background: var(--amber-glow); border-color: var(--amber-dim); color: var(--amber); }

.btn-sm { padding: 6px 12px; font-size: 12px; }
</style>
