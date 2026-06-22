/**
 * settings.js — Pinia store for Bakesail device configuration.
 *
 * Persisted to ~/printer_data/config/bakesail_settings.json via Moonraker.
 * bakesail.cfg is generated FROM this store by configWriter.js.
 *
 * Deletion of bakesail.cfg triggers the setup wizard on next visit.
 * Deletion of bakesail_settings.json resets all settings to defaults.
 */

import { defineStore } from 'pinia'

// ── Default settings object ───────────────────────────────────────────────────

export function defaultSettings() {
  return {
    // ── Device identity ───────────────────────────────────────────
    deviceType:   'oven',    // oven | ir_rework | hot_air | hot_plate
    machineClass: 'manual',  // manual | semi_auto | automatic

    // ── Heater zones ──────────────────────────────────────────────
    // pin: Klipper pin name (e.g. 'PA2') OR null if deferred to stepper slot
    zones: [
      { id: 1, label: 'Zone 1', pin: null, deferred: false },
    ],

    // ── Thermocouples (MAX31855 SPI) ──────────────────────────────
    thermocouples: [
      { id: 1, label: 'TC 1', csPin: '', sckPin: '', misoPin: '', mosiPin: 'PA7' },
    ],

    // ── Zone → TC mapping ─────────────────────────────────────────
    // zoneTcMap[zoneId] = tcId
    zoneTcMap: { 1: 1 },

    // ── Fans ──────────────────────────────────────────────────────
    fans: [
      { id: 1, label: 'Fan 1', pin: '', pwm: true },
    ],

    // ── Vacuum ────────────────────────────────────────────────────
    vacuum: {
      pen:        false,
      penPin:     '',
      nozzle:     false,
      nozzlePin:  '',
    },

    // ── Illumination ──────────────────────────────────────────────
    illumination: {
      laser:          false,
      laserPin:       '',
      neopixel:       false,
      neopixelPin:    '',
      neopixelCount:  8,
      neopixelColor:  '#ffffff',
    },

    // ── Cameras ───────────────────────────────────────────────────
    cameras: {
      bga:       '',   // e.g. /dev/video0
      alignment: '',   // e.g. /dev/video1
    },

    // ── Stepper slots ─────────────────────────────────────────────
    // function: 'unused' | 'heater_zoneN' | 'motion_x' | 'motion_y' | 'motion_z' | 'gpio'
    // heaterPin: the high-side output pin for this slot (board-specific)
    stepperSlots: [],

    // ── Wizard state ──────────────────────────────────────────────
    wizardComplete: false,
  }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    ...defaultSettings(),
    _loaded: false,
    _saving: false,
  }),

  getters: {
    // Zones whose heater pin is deferred to a stepper slot
    deferredZones(state) {
      return state.zones.filter(z => z.deferred)
    },

    // Is nozzle vacuum available given machine class?
    nozzleVacuumAvailable(state) {
      return state.machineClass === 'semi_auto' || state.machineClass === 'automatic'
    },

    // Does this machine have any motion axes?
    hasMotion(state) {
      return state.machineClass === 'semi_auto' || state.machineClass === 'automatic'
    },

    // Motion axes available by class
    availableMotionAxes(state) {
      if (state.machineClass === 'automatic') return ['x', 'y', 'z']
      if (state.machineClass === 'semi_auto') return ['z']
      return []
    },

    // All stepper slot functions in use (to show in dropdowns)
    usedSlotFunctions(state) {
      return state.stepperSlots.map(s => s.function).filter(f => f !== 'unused')
    },
  },

  actions: {
    // ── Persistence ─────────────────────────────────────────────────

    async load() {
      try {
        const res = await fetch('/server/files/config/bakesail_settings.json')
        if (!res.ok) {
          // File doesn't exist yet — use defaults
          this._loaded = true
          return false
        }
        const data = await res.json()
        // Merge loaded data over defaults (so new fields get defaults)
        const defaults = defaultSettings()
        Object.assign(this.$state, defaults, data)
        this._loaded = true
        return true
      } catch (e) {
        console.warn('[bakesail] settings load failed:', e)
        this._loaded = true
        return false
      }
    },

    async save() {
      this._saving = true
      try {
        const data = { ...this.$state }
        delete data._loaded
        delete data._saving

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const form = new FormData()
        form.append('file', blob, 'bakesail_settings.json')
        form.append('root', 'config')

        const res = await fetch('/server/files/upload', { method: 'POST', body: form })
        if (!res.ok) throw new Error(`Settings save failed: ${res.status}`)
        return true
      } catch (e) {
        console.error('[bakesail] settings save failed:', e)
        return false
      } finally {
        this._saving = false
      }
    },

    // ── Zone management ──────────────────────────────────────────────

    addZone() {
      const id = Math.max(0, ...this.zones.map(z => z.id)) + 1
      this.zones.push({ id, label: `Zone ${id}`, pin: null, deferred: false })
      // Default to mapping to TC 1 if available
      if (this.thermocouples.length > 0) {
        this.zoneTcMap[id] = this.thermocouples[0].id
      }
    },

    removeZone(id) {
      this.zones = this.zones.filter(z => z.id !== id)
      delete this.zoneTcMap[id]
    },

    // ── TC management ────────────────────────────────────────────────

    addTc() {
      const id = Math.max(0, ...this.thermocouples.map(t => t.id)) + 1
      this.thermocouples.push({ id, label: `TC ${id}`, csPin: '', sckPin: '', misoPin: '', mosiPin: 'PA7' })
    },

    removeTc(id) {
      this.thermocouples = this.thermocouples.filter(t => t.id !== id)
      // Remap any zones that were using this TC to TC 1
      for (const zoneId in this.zoneTcMap) {
        if (this.zoneTcMap[zoneId] === id) {
          this.zoneTcMap[zoneId] = this.thermocouples[0]?.id ?? null
        }
      }
    },

    // ── Fan management ───────────────────────────────────────────────

    addFan() {
      const id = Math.max(0, ...this.fans.map(f => f.id)) + 1
      this.fans.push({ id, label: `Fan ${id}`, pin: '', pwm: true })
    },

    removeFan(id) {
      this.fans = this.fans.filter(f => f.id !== id)
    },

    // ── Stepper slots ────────────────────────────────────────────────

    setStepperSlots(slots) {
      this.stepperSlots = slots
    },
  },
})
