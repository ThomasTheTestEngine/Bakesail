/**
 * device.js — Pinia store for Bakesail device state.
 * Fed by Moonraker status updates via useMoonraker.js.
 */

import { defineStore } from 'pinia'

// State display labels and colours
const STATE_META = {
  idle:     { label: 'Idle',     colour: '#555555' },
  ready:    { label: 'Ready',    colour: '#E8820C' },
  running:  { label: 'Running',  colour: '#E8820C' },
  paused:   { label: 'Paused',   colour: '#9B5E00' },
  complete: { label: 'Complete', colour: '#4CAF7D' },
  error:    { label: 'Error',    colour: '#E04545' },
}

const SUBSTATE_META = {
  heating:  { label: 'Heating',  colour: '#E8820C' },
  dwelling: { label: 'Dwelling', colour: '#2DBFB8' },
  cooling:  { label: 'Cooling',  colour: '#2DBFB8' },
}

export const useDeviceStore = defineStore('device', {
  state: () => ({
    // ── Bakesail state (mirrored from klippy extra's get_status) ──
    bsState:   'idle',    // idle | ready | running | paused | complete | error
    substate:  '',        // heating | dwelling | cooling | ''
    error:     '',
    profile:   '',        // active profile name
    stage:     {},        // stage detail object (varies by type)
    zones:     [],        // array of zone status objects

    // ── Machine capabilities (written by setup wizard) ──
    hasVacuum:  false,
    hasLaser:   false,
    isSemiAuto: false,
  }),

  getters: {
    // Effective display state: substate when running, state otherwise
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

    isRunning(state) {
      return state.bsState === 'running'
    },

    isPaused(state) {
      return state.bsState === 'paused'
    },

    canRun(state) {
      return state.bsState === 'idle' || state.bsState === 'complete'
    },

    canPause(state) {
      return state.bsState === 'running'
    },

    canResume(state) {
      return state.bsState === 'paused'
    },

    canAbort(state) {
      return ['running', 'paused', 'complete', 'error'].includes(state.bsState)
    },

    // Stage summary string for the Dashboard header
    stageSummary(state) {
      if (!state.profile) return ''
      const s = state.stage
      if (!s || !s.type) return state.profile

      const prefix = `${state.profile} — Stage ${s.number ?? '?'}/${s.count ?? '?'}`

      if (s.type === 'dwell') {
        const rem = s.remaining ?? 0
        const mins = Math.floor(rem / 60).toString().padStart(2, '0')
        const secs = Math.floor(rem % 60).toString().padStart(2, '0')
        return `${prefix} · Dwell ${mins}:${secs} remaining`
      }
      if (s.type === 'ramp') {
        return `${prefix} · Ramp → ${s.target}°C`
      }
      if (s.type === 'cool') {
        return `${prefix} · Cooling`
      }
      return prefix
    },
  },

  actions: {
    updateBakesail(data) {
      // Partial updates — only overwrite keys present in the payload
      if (data.state    !== undefined) this.bsState  = data.state
      if (data.substate !== undefined) this.substate = data.substate
      if (data.error    !== undefined) this.error    = data.error
      if (data.profile  !== undefined) this.profile  = data.profile
      if (data.stage    !== undefined) this.stage    = data.stage
      if (data.zones    !== undefined) this.zones    = data.zones
    },

    setKlippyOffline() {
      this.bsState  = 'idle'
      this.substate = ''
      this.profile  = ''
      this.stage    = {}
      // Keep zones array but zero the temps so we don't show stale readings
      this.zones = this.zones.map(z => ({ ...z, temp: 0 }))
    },
  },
})
