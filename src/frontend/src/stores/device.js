/**
 * device.js — Pinia store for Bakesail device state.
 * Fed by Moonraker status updates via useMoonraker.js.
 */

import { defineStore } from 'pinia'

const STATE_META = {
  idle:     { label: 'Idle',     colour: 'var(--text-muted)' },
  ready:    { label: 'Ready',    colour: 'var(--amber)'      },
  running:  { label: 'Running',  colour: 'var(--amber)'      },
  paused:   { label: 'Paused',   colour: 'var(--amber-dim)'  },
  complete: { label: 'Complete', colour: 'var(--green)'      },
  error:    { label: 'Error',    colour: 'var(--red)'        },
}

const SUBSTATE_META = {
  heating:  { label: 'Heating',  colour: 'var(--amber)' },
  dwelling: { label: 'Dwelling', colour: 'var(--teal)'  },
  cooling:  { label: 'Cooling',  colour: 'var(--teal)'  },
}

// Rolling history length (seconds at ~1 sample/sec)
const HISTORY_LEN = 300

export const useDeviceStore = defineStore('device', {
  state: () => ({
    // ── Bakesail state ─────────────────────────────────────────────
    bsState:   'idle',
    substate:  '',
    error:     '',
    profile:   '',
    stage:     {},
    zones:     [],

    // ── Rolling temperature history ────────────────────────────────
    // { [zoneIndex]: [{ t: Date.now(), temp: number }] }
    tempHistory: {},

    // ── Fan state ──────────────────────────────────────────────────
    // [{ name, speed }]  speed 0.0–1.0
    fans: [],

    // ── Vacuum state ──────────────────────────────────────────────
    vacuumPenOn:    false,
    nozzleVacuumOn: false,

    // ── 3D printer state (fed by PrinterDashboard via updatePrinter) ──
    printerState:   'standby',  // print_stats.state
    idleState:      'Idle',     // idle_timeout.state
    homedAxes:      '',         // toolhead.homed_axes

    // ── Machine capabilities (set by settings store) ───────────────
    hasVacuumPen:    false,
    hasNozzleVacuum: false,
    hasLaser:        false,
    hasNeopixel:     false,
    isSemiAuto:      false,
    isAutomatic:     false,

    // ── Overtemp ──────────────────────────────────────────────────
    overtempThreshold: 280,   // °C — configurable from dashboard
    overtempAck:       false, // user acknowledged the alarm
  }),

  getters: {
    displayState(state) {
      if (state.bsState === 'running' && state.substate) return state.substate
      return state.bsState
    },
    displayLabel(state) {
      const ds = this.displayState
      return SUBSTATE_META[ds]?.label ?? STATE_META[ds]?.label ?? ds
    },
    displayColour(state) {
      const ds = this.displayState
      return SUBSTATE_META[ds]?.colour ?? STATE_META[ds]?.colour ?? '#555555'
    },
    isRunning: s => s.bsState === 'running',
    isPaused:  s => s.bsState === 'paused',
    isIdle:    s => s.bsState === 'idle' || s.bsState === 'complete',
    canRun:    s => s.bsState === 'idle' || s.bsState === 'complete',
    canPause:  s => s.bsState === 'running',
    canResume: s => s.bsState === 'paused',
    canAbort:  s => ['running', 'paused', 'complete', 'error'].includes(s.bsState),

    stageSummary(state) {
      if (!state.profile) return ''
      const s = state.stage
      if (!s?.type) return state.profile
      const prefix = `${state.profile} — Stage ${s.number ?? '?'}/${s.count ?? '?'}`
      if (s.type === 'dwell') {
        const rem  = s.remaining ?? 0
        const mins = Math.floor(rem / 60).toString().padStart(2, '0')
        const secs = Math.floor(rem % 60).toString().padStart(2, '0')
        return `${prefix} · Dwell ${mins}:${secs} remaining`
      }
      if (s.type === 'ramp')  return `${prefix} · Ramp → ${s.target}°C`
      if (s.type === 'cool')  return `${prefix} · Cooling`
      return prefix
    },

    // True if any zone is above the overtemp threshold
    isOvertemp(state) {
      if (!state.overtempThreshold) return false
      return state.zones.some(z => z.temp >= state.overtempThreshold)
    },

    overtempZones(state) {
      return state.zones.filter(z => z.temp >= state.overtempThreshold)
    },
  },

  actions: {
    updateBakesail(data) {
      if (data.state    !== undefined) this.bsState  = data.state
      if (data.substate !== undefined) this.substate = data.substate
      if (data.error    !== undefined) this.error    = data.error
      if (data.profile  !== undefined) this.profile  = data.profile
      if (data.stage    !== undefined) this.stage    = data.stage
      if (data.fans     !== undefined) this.fans = data.fans
      if (data.zones    !== undefined) {
        this.zones = data.zones
        this._appendHistory(data.zones)
        // Reset overtemp ack if temps came back down
        if (!this.isOvertemp) this.overtempAck = false
      }
    },

    _appendHistory(zones) {
      const t = Date.now()
      for (const zone of zones) {
        const key = zone.index
        if (!this.tempHistory[key]) this.tempHistory[key] = []
        this.tempHistory[key].push({ t, temp: zone.temp })
        // Trim to HISTORY_LEN
        if (this.tempHistory[key].length > HISTORY_LEN) {
          this.tempHistory[key].shift()
        }
      }
    },

    updateFans(fans) {
      this.fans = fans
    },

    updateVacuum(pen, nozzle) {
      if (pen    !== undefined) this.vacuumPenOn    = pen
      if (nozzle !== undefined) this.nozzleVacuumOn = nozzle
    },

    setKlippyOffline() {
      this.bsState  = 'idle'
      this.substate = ''
      this.profile  = ''
      this.stage    = {}
      this.zones    = this.zones.map(z => ({ ...z, temp: 0, power: 0 }))
      this.fans     = this.fans.map(f => ({ ...f, speed: 0 }))
    },

    acknowledgeOvertemp() {
      this.overtempAck = true
    },

    updatePrinter({ printerState, idleState, homedAxes }) {
      if (printerState !== undefined) this.printerState = printerState
      if (idleState    !== undefined) this.idleState    = idleState
      if (homedAxes    !== undefined) this.homedAxes    = homedAxes
    },
  },
})
