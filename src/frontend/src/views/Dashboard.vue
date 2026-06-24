<template>
  <div class="dashboard">

    <!-- ── Overtemp alarm ────────────────────────────────────────── -->
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

    <!-- ── State header ─────────────────────────────────────────── -->
    <div class="state-header card" :style="{ '--state-colour': store.displayColour }">
      <div class="state-indicator">
        <div class="state-dot"></div>
        <span class="state-label">{{ store.displayLabel.toUpperCase() }}</span>
      </div>
      <div class="stage-summary">{{ store.stageSummary || 'No profile running' }}</div>
    </div>

    <!-- ── Zone readouts — arranged by type ─────────────────────── -->

    <!-- Top row: combined target+upper, or individual wide cards -->
    <div class="zones-row zones-row--centered" v-if="topZones.length > 0">

      <!-- Combined cell when both target and upper are present -->
      <div v-if="targetZone && upperZone" class="zone-card zone-card--combined card">
        <!-- Upper zone — compact single line -->
        <div class="combined-upper">
          <span class="cu-name">{{ zoneLabel(upperZone) }}</span>
          <span class="cu-temp" :class="tempClass(upperZone.temp)">
            {{ upperZone.temp.toFixed(1) }}°C
          </span>
          <span class="cu-sp" v-if="zoneSP(upperZone)">SP {{ zoneSP(upperZone) }}</span>
          <span class="cu-pwr">{{ (upperZone.power * 100).toFixed(0) }}%</span>
        </div>
        <div class="combined-divider"></div>
        <!-- Target zone — full display -->
        <div class="zone-name">{{ zoneLabel(targetZone) }}</div>
        <div class="zone-temp" :class="tempClass(targetZone.temp)">
          {{ targetZone.temp.toFixed(1) }}<span class="unit">°C</span>
        </div>
        <div :class="zoneSP(targetZone) ? 'zone-setpoint' : 'zone-setpoint zone-setpoint--dim'">
          {{ zoneSP(targetZone) || 'Idle' }}
        </div>
        <div class="power-row">
          <div class="power-bar-track">
            <div class="power-bar-fill" :style="{ width: (targetZone.power*100).toFixed(0)+'%' }"></div>
          </div>
          <span class="power-pct">{{ (targetZone.power*100).toFixed(0) }}%</span>
        </div>
      </div>

      <!-- Target only (no upper) -->
      <div v-else-if="targetZone && !upperZone" class="zone-card zone-card--wide card">
        <div class="zone-name">{{ zoneLabel(targetZone) }}</div>
        <div class="zone-temp" :class="tempClass(targetZone.temp)">
          {{ targetZone.temp.toFixed(1) }}<span class="unit">°C</span>
        </div>
        <div :class="zoneSP(targetZone) ? 'zone-setpoint' : 'zone-setpoint zone-setpoint--dim'">
          {{ zoneSP(targetZone) || 'Idle' }}
        </div>
        <div class="power-row">
          <div class="power-bar-track">
            <div class="power-bar-fill" :style="{ width: (targetZone.power*100).toFixed(0)+'%' }"></div>
          </div>
          <span class="power-pct">{{ (targetZone.power*100).toFixed(0) }}%</span>
        </div>
      </div>

      <!-- Upper only (no target) -->
      <div v-else-if="upperZone && !targetZone" class="zone-card zone-card--wide card">
        <div class="zone-name">{{ zoneLabel(upperZone) }}</div>
        <div class="zone-temp" :class="tempClass(upperZone.temp)">
          {{ upperZone.temp.toFixed(1) }}<span class="unit">°C</span>
        </div>
        <div :class="zoneSP(upperZone) ? 'zone-setpoint' : 'zone-setpoint zone-setpoint--dim'">
          {{ zoneSP(upperZone) || 'Idle' }}
        </div>
        <div class="power-row">
          <div class="power-bar-track">
            <div class="power-bar-fill" :style="{ width: (upperZone.power*100).toFixed(0)+'%' }"></div>
          </div>
          <span class="power-pct">{{ (upperZone.power*100).toFixed(0) }}%</span>
        </div>
      </div>

      <!-- Extra top zones (e.g. multiple target or multiple upper) -->
      <div v-for="zone in extraTopZones" :key="zone.index" class="zone-card zone-card--wide card">
        <div class="zone-name">{{ zoneLabel(zone) }}</div>
        <div class="zone-temp" :class="tempClass(zone.temp)">
          {{ zone.temp.toFixed(1) }}<span class="unit">°C</span>
        </div>
        <div :class="zoneSP(zone) ? 'zone-setpoint' : 'zone-setpoint zone-setpoint--dim'">
          {{ zoneSP(zone) || 'Idle' }}
        </div>
        <div class="power-row">
          <div class="power-bar-track">
            <div class="power-bar-fill" :style="{ width: (zone.power*100).toFixed(0)+'%' }"></div>
          </div>
          <span class="power-pct">{{ (zone.power*100).toFixed(0) }}%</span>
        </div>
      </div>
    </div>

    <!-- Middle row -->
    <div class="zones-row zones-row--centered" v-if="middleZones.length > 0">
      <div v-for="zone in middleZones" :key="zone.index" class="zone-card card">
        <div class="zone-name">{{ zoneLabel(zone) }}</div>
        <div class="zone-temp" :class="tempClass(zone.temp)">
          {{ zone.temp.toFixed(1) }}<span class="unit">°C</span>
        </div>
        <div :class="zoneSP(zone) ? 'zone-setpoint' : 'zone-setpoint zone-setpoint--dim'">
          {{ zoneSP(zone) || 'Idle' }}
        </div>
        <div class="power-row">
          <div class="power-bar-track">
            <div class="power-bar-fill" :style="{ width: (zone.power*100).toFixed(0)+'%' }"></div>
          </div>
          <span class="power-pct">{{ (zone.power*100).toFixed(0) }}%</span>
        </div>
      </div>
    </div>

    <!-- Bottom row: lower variants in fixed 3-column grid -->
    <div class="zones-row zones-row--lower" v-if="bottomZones.length > 0">
      <div class="lower-slot lower-slot--left">
        <div v-for="zone in bottomZones.filter(z=>z.type==='lower_left')" :key="zone.index"
             class="zone-card card">
          <div class="zone-name">{{ zoneLabel(zone) }}</div>
          <div class="zone-temp" :class="tempClass(zone.temp)">
            {{ zone.temp.toFixed(1) }}<span class="unit">°C</span>
          </div>
          <div :class="zoneSP(zone) ? 'zone-setpoint' : 'zone-setpoint zone-setpoint--dim'">
            {{ zoneSP(zone) || 'Idle' }}
          </div>
          <div class="power-row">
            <div class="power-bar-track">
              <div class="power-bar-fill" :style="{ width: (zone.power*100).toFixed(0)+'%' }"></div>
            </div>
            <span class="power-pct">{{ (zone.power*100).toFixed(0) }}%</span>
          </div>
        </div>
      </div>
      <div class="lower-slot lower-slot--center">
        <div v-for="zone in bottomZones.filter(z=>z.type==='lower')" :key="zone.index"
             class="zone-card card">
          <div class="zone-name">{{ zoneLabel(zone) }}</div>
          <div class="zone-temp" :class="tempClass(zone.temp)">
            {{ zone.temp.toFixed(1) }}<span class="unit">°C</span>
          </div>
          <div :class="zoneSP(zone) ? 'zone-setpoint' : 'zone-setpoint zone-setpoint--dim'">
            {{ zoneSP(zone) || 'Idle' }}
          </div>
          <div class="power-row">
            <div class="power-bar-track">
              <div class="power-bar-fill" :style="{ width: (zone.power*100).toFixed(0)+'%' }"></div>
            </div>
            <span class="power-pct">{{ (zone.power*100).toFixed(0) }}%</span>
          </div>
        </div>
      </div>
      <div class="lower-slot lower-slot--right">
        <div v-for="zone in bottomZones.filter(z=>z.type==='lower_right')" :key="zone.index"
             class="zone-card card">
          <div class="zone-name">{{ zoneLabel(zone) }}</div>
          <div class="zone-temp" :class="tempClass(zone.temp)">
            {{ zone.temp.toFixed(1) }}<span class="unit">°C</span>
          </div>
          <div :class="zoneSP(zone) ? 'zone-setpoint' : 'zone-setpoint zone-setpoint--dim'">
            {{ zoneSP(zone) || 'Idle' }}
          </div>
          <div class="power-row">
            <div class="power-bar-track">
              <div class="power-bar-fill" :style="{ width: (zone.power*100).toFixed(0)+'%' }"></div>
            </div>
            <span class="power-pct">{{ (zone.power*100).toFixed(0) }}%</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div class="zones-row zones-row--centered" v-if="store.zones.length === 0">
      <div class="zone-card card zone-card--empty">
        <div class="zone-name">Zone 1</div>
        <div class="zone-temp zone-temp--dim">—.—<span class="unit">°C</span></div>
        <div class="zone-setpoint zone-setpoint--dim">Waiting</div>
        <div class="power-row">
          <div class="power-bar-track"><div class="power-bar-fill" style="width:0%"></div></div>
          <span class="power-pct">0%</span>
        </div>
      </div>
    </div>

    <!-- Auxiliary bubble: plate / pot / ambient -->
    <div class="aux-bubble card" v-if="auxZones.length > 0">
      <div class="aux-label">Auxiliary</div>
      <div class="zones-row zones-row--centered aux-zones">
        <div v-for="zone in auxZones" :key="zone.index" class="zone-card zone-card--compact card">
          <div class="aux-zone-line1">
            <span class="zone-name">{{ zoneLabel(zone) }}</span>
            <span class="aux-temp" :class="tempClass(zone.temp)">{{ zone.temp.toFixed(1) }}°C</span>
          </div>
          <div class="aux-zone-line2">
            <span v-if="zoneSP(zone)" class="zone-setpoint">SP {{ zoneSP(zone) }}</span>
            <span v-else class="zone-setpoint zone-setpoint--dim">Idle</span>
            <span class="power-pct">{{ (zone.power*100).toFixed(0) }}%</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Temperature chart ─────────────────────────────────────── -->
    <div class="chart-card card">
      <div class="chart-label">Temperature history (5 min)</div>
      <svg class="temp-chart" :viewBox="`0 0 ${CHART_W} ${CHART_H}`" preserveAspectRatio="none">
        <!-- Grid lines -->
        <line v-for="t in chartGridTemps" :key="t"
          :x1="CHART_PAD_L" :y1="chartTempToY(t)"
          :x2="CHART_W - CHART_PAD_R" :y2="chartTempToY(t)"
          class="chart-grid"
        />
        <text v-for="t in chartGridTemps" :key="'l'+t"
          :x="CHART_PAD_L - 4" :y="chartTempToY(t) + 4"
          class="chart-axis-label" text-anchor="end"
        >{{ t }}</text>

        <!-- Setpoint line (when running ramp) -->
        <line v-if="store.isRunning && store.stage.setpoint"
          :x1="CHART_PAD_L" :y1="chartTempToY(store.stage.setpoint)"
          :x2="CHART_W - CHART_PAD_R" :y2="chartTempToY(store.stage.setpoint)"
          class="chart-setpoint"
        />

        <!-- Overtemp threshold line -->
        <line v-if="store.overtempThreshold"
          :x1="CHART_PAD_L" :y1="chartTempToY(store.overtempThreshold)"
          :x2="CHART_W - CHART_PAD_R" :y2="chartTempToY(store.overtempThreshold)"
          class="chart-overtemp"
        />

        <!-- Zone temp lines -->
        <polyline
          v-for="(zone, i) in store.zones"
          :key="zone.index"
          :points="chartPoints(zone.index)"
          :class="`chart-line chart-line--${i}`"
          fill="none"
        />
      </svg>

      <!-- Legend -->
      <div class="chart-legend">
        <div v-for="(zone, i) in store.zones" :key="zone.index" class="legend-item">
          <span :class="`legend-dot legend-dot--${i}`"></span>
          <span>{{ zone.heater.split(' ').slice(-1)[0] }}</span>
        </div>
        <div class="legend-item" v-if="store.isRunning && store.stage.setpoint">
          <span class="legend-dot legend-dot--sp"></span>
          <span>Setpoint</span>
        </div>
        <div class="legend-item" v-if="store.overtempThreshold">
          <span class="legend-dot legend-dot--ot"></span>
          <span>Overtemp {{ store.overtempThreshold }}°C</span>
        </div>
      </div>
    </div>

    <!-- ── Fans ──────────────────────────────────────────────────── -->
    <div v-if="store.fans.length > 0" class="fans-card card">
      <div class="fans-label">Fans</div>
      <div class="fans-row">
        <div v-for="fan in store.fans" :key="fan.name" class="fan-item">
          <span class="fan-name">{{ fan.name }}</span>
          <div class="power-bar-track fan-bar">
            <div class="power-bar-fill fan-bar-fill" :style="{ width: (fan.speed * 100).toFixed(0) + '%' }"></div>
          </div>
          <span class="fan-pct">{{ (fan.speed * 100).toFixed(0) }}%</span>
        </div>
      </div>
    </div>

    <!-- ── Dwell timer ───────────────────────────────────────────── -->
    <div v-if="store.substate === 'dwelling' && store.stage.remaining != null"
         class="dwell-card card">
      <div class="dwell-label">Dwell remaining</div>
      <div class="dwell-timer">{{ dwellFormatted }}</div>
      <div class="dwell-bar-track">
        <div class="dwell-bar-fill" :style="{ width: dwellProgress + '%' }"></div>
      </div>
    </div>

    <!-- ── Controls ──────────────────────────────────────────────── -->
    <div class="controls-card card">
      <!-- Profile + run/pause/stop row -->
      <!-- Stage progress — shown above buttons when running -->
      <div v-if="store.isRunning || store.isPaused" class="stage-progress stage-progress--top">
        <div class="stage-bar-track">
          <div class="stage-bar-fill" :style="{ width: stageProgress + '%' }"></div>
        </div>
        <span class="stage-frac">Stage {{ store.stage.number ?? 0 }}/{{ store.stage.count ?? 0 }}</span>
      </div>

      <div class="controls-main">
        <div class="profile-info">
          <span class="profile-loaded" v-if="store.isRunning || store.isPaused">
            {{ store.profile }}
          </span>
          <span class="profile-loaded" v-else-if="selectedProfile">
            {{ selectedProfile }}
          </span>
          <span class="profile-none" v-else>No profile selected</span>
        </div>

        <div class="controls-btns">
          <button class="btn btn-ghost" @click="showRunModal = true" :disabled="store.isRunning || store.isPaused">
            ⊞ Load
          </button>
          <button class="btn btn-primary" :disabled="!store.canRun || !selectedProfile" @click="runProfile">
            ▶ Run
          </button>
          <button class="btn btn-ghost"
            :disabled="!store.canPause && !store.canResume"
            :class="{ 'btn-active': store.canResume }"
            @click="store.canResume ? resumeProfile() : pauseProfile()"
          >
            {{ store.canResume ? '▶ Resume' : '⏸ Pause' }}
          </button>
          <button class="btn btn-danger" :disabled="!store.canAbort" @click="abortProfile">
            ✕ Stop
          </button>
        </div>
      </div>

      <!-- Operation buttons row -->
      <div class="controls-ops">
        <!-- Pickup -->
        <button class="ops-btn ops-btn--pickup" @click="pickup">
          <span class="ops-icon">↑</span>
          <span>Pickup</span>
        </button>

        <!-- Place -->
        <button class="ops-btn ops-btn--place" @click="place">
          <span class="ops-icon">↓</span>
          <span>Place</span>
        </button>

        <!-- Vacuum pen toggle -->
        <button
          v-if="store.hasVacuumPen"
          class="ops-btn"
          :class="store.vacuumPenOn ? 'ops-btn--on' : 'ops-btn--off'"
          @click="toggleVacuumPen"
        >
          <span class="ops-icon">◎</span>
          <span>Vacuum {{ store.vacuumPenOn ? 'ON' : 'OFF' }}</span>
        </button>

        <!-- Nozzle vacuum (auto/semi-auto only) -->
        <button
          v-if="store.hasNozzleVacuum"
          class="ops-btn"
          :class="store.nozzleVacuumOn ? 'ops-btn--on' : 'ops-btn--off'"
          @click="toggleNozzleVacuum"
        >
          <span class="ops-icon">⊙</span>
          <span>Nozzle {{ store.nozzleVacuumOn ? 'ON' : 'OFF' }}</span>
        </button>

        <!-- Overtemp threshold -->
        <div class="overtemp-ctrl">
          <span class="overtemp-ctrl-label">⚠ Overtemp</span>
          <input
            class="overtemp-input"
            type="number"
            v-model.number="store.overtempThreshold"
            min="50" max="400"
          />
          <span class="overtemp-ctrl-unit">°C</span>
        </div>
      </div>
    </div>

    <!-- ── Error ─────────────────────────────────────────────────── -->
    <div v-if="store.bsState === 'error'" class="error-card card">
      <div class="error-label">⚠ Fault</div>
      <div class="error-msg">{{ store.error || 'Unknown error' }}</div>
      <button class="btn btn-ghost" style="margin-top:12px" @click="abortProfile">Reset</button>
    </div>

    <!-- ── Run modal ─────────────────────────────────────────────── -->
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
        <button class="btn btn-ghost" style="margin-top:16px;width:100%" @click="showRunModal = false">
          Cancel
        </button>
      </div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useDeviceStore } from '../stores/device.js'
import { useSettingsStore } from '../stores/settings.js'
import { useMoonraker } from '../composables/useMoonraker.js'

const store    = useDeviceStore()
const settings = useSettingsStore()
const { send, runGcode, connected } = useMoonraker()

const showRunModal    = ref(false)
const profiles        = ref([])
const selectedProfile = ref(localStorage.getItem('bakesail-last-profile') || '')

// ── Zone helpers ─────────────────────────────────────────────────
function zoneLabel(z)  { return z.label || `Zone ${z.index}` }
function tempClass(t)  {
  if (t <= 0)  return 'zone-temp--dim'
  if (t > 220) return 'zone-temp--hot'
  if (t > 100) return 'zone-temp--warm'
  return ''
}
function zoneSP(z) {
  if (!store.isRunning || !store.stage.setpoint) return null
  return (store.stage.setpoint + (z.offset || 0)).toFixed(1) + '°C'
}

// ── Zone groups by type ───────────────────────────────────────────
const TOP_TYPES    = ['target', 'upper']
const MIDDLE_TYPES = ['middle']
const BOTTOM_TYPES = ['lower', 'lower_left', 'lower_right']
const AUX_TYPES    = ['plate', 'pot', 'ambient']

const topZones    = computed(() => store.zones.filter(z => TOP_TYPES.includes(z.type)))
const targetZone  = computed(() => store.zones.find(z => z.type === 'target') || null)
const upperZone   = computed(() => store.zones.find(z => z.type === 'upper')  || null)
const extraTopZones = computed(() =>
  store.zones.filter(z => TOP_TYPES.includes(z.type) && z !== targetZone.value && z !== upperZone.value)
)
const middleZones = computed(() => store.zones.filter(z => MIDDLE_TYPES.includes(z.type)))
const bottomZones = computed(() => store.zones.filter(z => BOTTOM_TYPES.includes(z.type)))
const auxZones    = computed(() => store.zones.filter(z => AUX_TYPES.includes(z.type)))

// ── Chart constants ───────────────────────────────────────────────

const CHART_W     = 600
const CHART_H     = 120
const CHART_PAD_L = 32
const CHART_PAD_R = 8
const CHART_PAD_T = 8
const CHART_PAD_B = 8
const CHART_MAX_T = 300000  // 5 min in ms
const CHART_TEMP_MIN = 20
const CHART_TEMP_MAX = 300

const chartGridTemps = [50, 100, 150, 200, 250, 300]

function chartTempToY(temp) {
  const frac = (temp - CHART_TEMP_MIN) / (CHART_TEMP_MAX - CHART_TEMP_MIN)
  return CHART_H - CHART_PAD_B - frac * (CHART_H - CHART_PAD_T - CHART_PAD_B)
}

function chartPoints(zoneIndex) {
  const history = store.tempHistory[zoneIndex]
  if (!history || history.length < 2) return ''
  const now   = Date.now()
  const start = now - CHART_MAX_T
  return history
    .filter(p => p.t >= start)
    .map(p => {
      const x = CHART_PAD_L + ((p.t - start) / CHART_MAX_T) * (CHART_W - CHART_PAD_L - CHART_PAD_R)
      const y = chartTempToY(p.temp)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

// ── Computed ──────────────────────────────────────────────────────

function tempClass(temp) {
  if (temp <= 0)  return 'zone-temp--dim'
  if (temp > 220) return 'zone-temp--hot'
  if (temp > 100) return 'zone-temp--warm'
  return ''
}

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
  const m = Math.floor(rem / 60).toString().padStart(2, '0')
  const s = Math.floor(rem % 60).toString().padStart(2, '0')
  return `${m}:${s}`
})

// ── Profile actions ───────────────────────────────────────────────

async function loadProfiles() {
  try {
    const res = await send('server.files.list', { root: 'config' })
    profiles.value = res
      .filter(f => f.path?.startsWith('bakesail_profiles/') && f.path.endsWith('.json'))
      .map(f => f.path.replace('bakesail_profiles/', '').replace('.json', ''))

    // Auto-select: restore last used, or pick first if none saved
    if (!selectedProfile.value && profiles.value.length > 0) {
      selectProfile(profiles.value[0])
    } else if (selectedProfile.value && !profiles.value.includes(selectedProfile.value)) {
      // Saved profile no longer exists — fall back to first
      selectProfile(profiles.value[0] || '')
    }
  } catch (e) {
    console.warn('[bakesail] could not load profiles:', e)
  }
}

function selectProfile(name) {
  selectedProfile.value = name
  if (name) localStorage.setItem('bakesail-last-profile', name)
}

function chooseProfile(name) {
  selectProfile(name)
  showRunModal.value = false
}

async function runProfile() {
  if (!selectedProfile.value) { showRunModal.value = true; return }
  try { await runGcode(`BGA_PROFILE_RUN PROFILE="${selectedProfile.value}"`) }
  catch (e) { console.error(e) }
}

async function pauseProfile()  { try { await runGcode('BGA_PROFILE_PAUSE')  } catch (e) { console.error(e) } }
async function resumeProfile() { try { await runGcode('BGA_PROFILE_RESUME') } catch (e) { console.error(e) } }
async function abortProfile()  { try { await runGcode('BGA_PROFILE_ABORT')  } catch (e) { console.error(e) } }

// ── Operation actions ─────────────────────────────────────────────

async function pickup() {
  // Manual: vacuum on. Semi/auto: vacuum on + Z up (future)
  try { await runGcode('SET_PIN PIN=vacuum_pen VALUE=1') }
  catch (e) { console.error(e) }
}

async function place() {
  // Manual: vacuum off. Semi/auto: Z down + vacuum off (future)
  try { await runGcode('SET_PIN PIN=vacuum_pen VALUE=0') }
  catch (e) { console.error(e) }
}

async function toggleVacuumPen() {
  const val = store.vacuumPenOn ? 0 : 1
  try {
    await runGcode(`SET_PIN PIN=vacuum_pen VALUE=${val}`)
    store.vacuumPenOn = !!val
  } catch (e) { console.error(e) }
}

async function toggleNozzleVacuum() {
  const val = store.nozzleVacuumOn ? 0 : 1
  try {
    await runGcode(`SET_PIN PIN=nozzle_vacuum VALUE=${val}`)
    store.nozzleVacuumOn = !!val
  } catch (e) { console.error(e) }
}

async function emergencyStop() {
  try { await runGcode('BAKESAIL_ESTOP') }
  catch (e) { console.error(e) }
}

onMounted(() => {
  settings.load()
  // Wait for websocket to be open before querying profiles
  if (connected.value) {
    loadProfiles()
  } else {
    const stop = watch(connected, (val) => {
      if (val) { loadProfiles(); stop() }
    })
  }
})
</script>

<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 960px;
}

/* ── Overtemp banner ────────────────────────────────────────────── */
.overtemp-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 18px;
  background: var(--red-glow);
  border: 1px solid var(--red);
  border-radius: var(--radius-lg);
  animation: pulse-border 1.5s ease-in-out infinite;
}
@keyframes pulse-border {
  0%, 100% { border-color: var(--red); }
  50%       { border-color: transparent; }
}
.overtemp-icon { font-size: 18px; color: var(--red); flex-shrink: 0; }
.overtemp-text { flex: 1; font-size: 13px; color: var(--red); font-family: var(--font-mono); }
.overtemp-actions { display: flex; gap: 8px; }

/* ── State header ───────────────────────────────────────────────── */
.state-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-color: color-mix(in srgb, var(--state-colour) 40%, transparent);
}
.state-indicator { display: flex; align-items: center; gap: 10px; }
.state-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--state-colour);
  box-shadow: 0 0 8px var(--state-colour);
  flex-shrink: 0;
}
.state-label {
  font-family: var(--font-mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: var(--state-colour);
}
.stage-summary {
  font-size: 12px;
  color: var(--text-dim);
  font-family: var(--font-mono);
}

/* ── Zone layout ────────────────────────────────────────────────── */
.zones-row--centered {
  justify-content: center;
  flex-wrap: wrap;
}

.zones-row--lower {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 14px;
}

.lower-slot {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 20px;
}

/* Standard zone card */
.zone-card {
  flex: 0 0 150px !important;
  width: 150px;
}

/* Wide (target/upper individual) */
.zone-card--wide {
  flex: 0 0 200px !important;
  width: 200px;
}

/* Combined target+upper cell */
.zone-card--combined {
  flex: 0 0 250px !important;
  width: 250px;
  min-width: 250px;
}

.combined-upper {
  display: flex;
  align-items: baseline;
  gap: 7px;
  padding-bottom: 8px;
  flex-wrap: wrap;
}
.combined-divider {
  height: 1px;
  background: var(--border);
  margin-bottom: 8px;
}
.cu-name { font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
.cu-temp { font-family: var(--font-mono); font-size: 14px; font-weight: 600; color: var(--text); }
.cu-sp   { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); }
.cu-pwr  { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-left: auto; }

/* Compact auxiliary zone */
.zone-card--compact {
  flex: 0 0 150px !important;
  width: 150px;
  padding: 10px 12px !important;
}
.aux-zone-line1 {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 3px;
}
.aux-temp {
  font-family: var(--font-mono);
  font-size: 16px;
  font-weight: 700;
}
.aux-zone-line2 {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* Auxiliary bubble */
.aux-bubble {
  padding: 12px 16px;
  border-color: var(--border-2);
}
.aux-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 10px;
}

/* ── Zone cards ─────────────────────────────────────────────────── */
.zones-row { display: flex; gap: 14px; }
.zone-card { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.zone-card--empty { opacity: 0.4; }
.zone-name {
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-muted);
}
.zone-temp {
  font-family: var(--font-mono);
  font-size: 44px; font-weight: 700;
  line-height: 1; color: var(--text);
  margin: 4px 0 2px;
}
.zone-temp--dim  { color: var(--text-muted); }
.zone-temp--warm { color: var(--amber); }
.zone-temp--hot  { color: var(--red); }
.unit { font-size: 18px; font-weight: 400; color: var(--text-dim); margin-left: 2px; }
.zone-setpoint { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); }
.zone-setpoint--dim { color: var(--text-muted); }

.power-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.power-bar-track {
  flex: 1; height: 3px;
  background: var(--border-2); border-radius: 2px; overflow: hidden;
}
.power-bar-fill {
  height: 100%;
  background: var(--amber);
  border-radius: 2px;
  transition: width 0.5s ease;
}
.power-pct { font-family: var(--font-mono); font-size: 10px; color: var(--text-muted); width: 28px; text-align: right; }

/* ── Temp chart ─────────────────────────────────────────────────── */
.chart-card { padding: 14px 16px; }
.chart-label {
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-muted); margin-bottom: 8px;
}
.temp-chart { width: 100%; height: 120px; display: block; }
.chart-grid { stroke: var(--border); stroke-width: 1; }
.chart-axis-label { font-family: var(--font-mono); font-size: 8px; fill: var(--text-muted); }
.chart-setpoint { stroke: var(--amber-dim); stroke-width: 1; stroke-dasharray: 3,3; }
.chart-overtemp { stroke: rgba(224,69,69,0.4); stroke-width: 1; stroke-dasharray: 2,2; }

.chart-line        { stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
.chart-line--0     { stroke: var(--amber); }
.chart-line--1     { stroke: var(--teal); }
.chart-line--2     { stroke: #9B7FE8; }
.chart-line--3     { stroke: #4CAF7D; }

.chart-legend { display: flex; gap: 16px; margin-top: 8px; }
.legend-item { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-dim); }
.legend-dot { width: 8px; height: 2px; border-radius: 1px; flex-shrink: 0; }
.legend-dot--0  { background: var(--amber); }
.legend-dot--1  { background: var(--teal); }
.legend-dot--2  { background: #9B7FE8; }
.legend-dot--3  { background: #4CAF7D; }
.legend-dot--sp { background: var(--amber-dim); }
.legend-dot--ot { background: rgba(224,69,69,0.5); }

/* ── Fans ───────────────────────────────────────────────────────── */
.fans-card { padding: 12px 16px; }
.fans-label {
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-muted); margin-bottom: 10px;
}
.fans-row { display: flex; gap: 20px; flex-wrap: wrap; }
.fan-item { display: flex; align-items: center; gap: 8px; min-width: 160px; }
.fan-name { font-size: 12px; color: var(--text-dim); width: 60px; flex-shrink: 0; }
.fan-bar { flex: 1; height: 4px; }
.fan-bar-fill { background: var(--teal); height: 100%; border-radius: 2px; transition: width 0.5s; }
.fan-pct { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); width: 32px; text-align: right; }

/* ── Dwell timer ────────────────────────────────────────────────── */
.dwell-card { border-color: rgba(45,191,184,0.25); }
.dwell-label {
  font-size: 11px; font-weight: 600;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--teal); margin-bottom: 6px;
}
.dwell-timer { font-family: var(--font-mono); font-size: 32px; font-weight: 700; color: var(--teal); margin-bottom: 10px; }
.dwell-bar-track { height: 3px; background: var(--border-2); border-radius: 2px; overflow: hidden; }
.dwell-bar-fill { height: 100%; background: var(--teal); border-radius: 2px; transition: width 0.5s ease; }

/* ── Controls ───────────────────────────────────────────────────── */
.controls-card { display: flex; flex-direction: column; gap: 14px; }

.controls-main { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }

.profile-info { min-width: 0; }
.profile-loaded {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--amber);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.profile-none { font-size: 12px; color: var(--text-muted); font-style: italic; }

.controls-btns { display: flex; gap: 8px; flex-shrink: 0; }

.stage-progress { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 120px; }
.stage-progress--top { flex: none; width: 100%; margin-bottom: 10px; }
.stage-bar-track { flex: 1; height: 4px; background: var(--border-2); border-radius: 2px; overflow: hidden; }
.stage-bar-fill { height: 100%; background: var(--amber); border-radius: 2px; transition: width 0.5s ease; }
.stage-frac { font-family: var(--font-mono); font-size: 11px; color: var(--text-dim); white-space: nowrap; }

/* ── Operation buttons ──────────────────────────────────────────── */
.controls-ops {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.ops-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 16px;
  border-radius: var(--radius);
  border: 1px solid var(--border-2);
  background: var(--surface-2);
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
  min-width: 64px;
}
.ops-btn:hover { background: var(--surface); color: var(--text); }
.ops-icon { font-size: 16px; }

.ops-btn--pickup:hover { border-color: var(--teal); color: var(--teal); background: var(--teal-glow); }
.ops-btn--place:hover  { border-color: var(--amber); color: var(--amber); background: var(--amber-glow); }
.ops-btn--on  { border-color: var(--teal); color: var(--teal); background: var(--teal-glow); }
.ops-btn--off { color: var(--text-muted); }

/* Overtemp threshold control */
.overtemp-ctrl {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
}
.overtemp-ctrl-label { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.overtemp-input {
  width: 54px;
  background: transparent;
  border: none;
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 13px;
  text-align: right;
  outline: none;
}
.overtemp-ctrl-unit { font-size: 11px; color: var(--text-muted); }

/* ── Error ──────────────────────────────────────────────────────── */
.error-card { border-color: rgba(224,69,69,0.4); background: var(--red-glow); }
.error-label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--red); margin-bottom: 6px; }
.error-msg { font-family: var(--font-mono); font-size: 13px; color: var(--text-dim); }

/* ── Modal ──────────────────────────────────────────────────────── */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: 360px; max-height: 80vh; overflow-y: auto; }
.modal-title { font-size: 12px; font-weight: 600; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 14px; }
.modal-empty { font-size: 13px; color: var(--text-muted); text-align: center; padding: 24px 0; }
.profile-list { display: flex; flex-direction: column; gap: 5px; }
.profile-item {
  width: 100%; text-align: left; padding: 9px 12px;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text);
  font-family: var(--font-mono); font-size: 13px; cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.profile-item:hover { background: var(--amber-glow); border-color: var(--amber-dim); color: var(--amber); }
.profile-item--selected { border-color: var(--amber-dim); color: var(--amber); background: var(--amber-glow); }

/* ── Utility ────────────────────────────────────────────────────── */
.btn-sm { padding: 6px 12px; font-size: 12px; }
.btn-active { color: var(--amber); border-color: var(--amber); }
</style>
