/**
 * settings.js — Pinia store for Bakesail device configuration.
 *
 * Persisted to ~/printer_data/config/bakesail_settings.json via Moonraker.
 * bakesail.cfg is generated FROM this store by configWriter.js.
 */

import { defineStore } from 'pinia'

// Zone types — controls position on dashboard
export const ZONE_TYPES = [
  { value: 'target',      label: 'Target'      },
  { value: 'upper',       label: 'Upper'       },
  { value: 'middle',      label: 'Middle'      },
  { value: 'lower',       label: 'Lower'       },
  { value: 'lower_left',  label: 'Lower Left'  },
  { value: 'lower_right', label: 'Lower Right' },
  { value: 'plate',       label: 'Plate'       },
  { value: 'pot',         label: 'Pot'         },
  { value: 'ambient',     label: 'Ambient'     },
]

export function defaultSettings() {
  return {
    // Device identity
    // deviceType: 'oven' | 'ir_rework' | 'hot_air' | 'hot_plate' | 'laser_plotter' | '3d_printer'
    deviceType:   'oven',
    machineClass: 'manual',

    // Laser plotter config (only used when deviceType === 'laser_plotter')
    laser: {
      pwmPin:          '',       // output_pin laser_pwm
      enablePin:       '',       // output_pin laser_enable (interlock/TH line)
      pwmFrequency:    1000,     // Hz — typical CO2 LPS accepts 1–5 kHz
      maxPower:        100,      // % ceiling enforced in macros
      bedWidth:        400,      // mm
      bedHeight:       400,      // mm
      originCorner:    'bottom-left', // how SVG Y is flipped
      airAssistPin:    '',       // optional relay for air assist compressor
    },

    // Heater zones (up to 8)
    // type: see ZONE_TYPES above
    // tcId: id of TC in thermocouples array (or null for no TC)
    // sensorPin: the TC CS/sensor pin — auto-filled from TC or manual
    zones: [
      { id: 1, label: 'Zone 1', type: 'target', pin: null, deferred: false, tcId: null, sensorPin: '' },
    ],

    // K-type thermocouples (MAX31855)
    // Each TC has only its unique CS/sensor pin.
    // SCK/MISO/MOSI are shared across all TCs via spiSettings.
    thermocouples: [
      { id: 1, label: 'TC 1', pin: '' },
    ],

    // Shared SPI bus for all MAX31855 TCs
    spiSettings: {
      sckPin:  '',
      misoPin: '',
      mosiPin: 'PA7',  // MAX31855 is read-only but Klipper requires MOSI
    },

    // Fans
    fans: [
      { id: 1, label: 'Fan 1', pin: '', pwm: true },
    ],

    // Vacuum
    vacuum: {
      pen:       false,
      penPin:    '',
      nozzle:    false,
      nozzlePin: '',
    },

    // Illumination
    illumination: {
      laser:         false,
      laserPin:      '',
      neopixel:      false,
      neopixelPin:   '',
      neopixelCount: 8,
      neopixelColor: '#ffffff',
    },

    // Cameras — array of { id, device, type, name, test }
    // device: '/dev/video0' etc, or '' for test
    // type: 'bga_grid' | 'alignment_chip' | 'alignment_board' | 'custom'
    // name: display name (defaults to type label)
    // test: true = dummy camera (shows placeholder, no real device needed)
    cameras: [],

    // Macro buttons pinned to the topbar.
    // { id, name, gcode? }  gcode is set for custom macros only.
    pinnedMacros: [],

    // Motion
    motion: {
      maxSpeed:         50,
      maxAccel:         500,
      microsteps:       16,
      rotationDistance: 8,
      xMax:             200,
      yMax:             200,
      zMax:             50,
    },

    // Stepper slots
    stepperSlots: [],

    // Overtemp threshold (°C)
    overtempThreshold: 280,

    // Dashboard customization
    dashboardGridSnap: true,   // snap widgets to 20px grid
    dashboardGridSize: 20,     // px — exposed in settings for the freaks

    wizardComplete: false,
  }
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    ...defaultSettings(),
    _loaded: false,
    _saving: false,
  }),

  getters: {
    deferredZones(state) {
      return state.zones.filter(z => z.deferred)
    },
    nozzleVacuumAvailable(state) {
      return state.machineClass === 'semi_auto' || state.machineClass === 'automatic'
    },
    hasMotion(state) {
      return state.machineClass === 'semi_auto' || state.machineClass === 'automatic'
    },
    availableMotionAxes(state) {
      if (state.machineClass === 'automatic') return ['x', 'y', 'z']
      if (state.machineClass === 'semi_auto') return ['z']
      return []
    },
  },

  actions: {
    async load() {
      try {
        const res = await fetch('/server/files/config/bakesail_settings.json')
        if (!res.ok) { this._loaded = true; return false }
        const data = await res.json()
        Object.assign(this.$state, defaultSettings(), data)

        // ── Migration: old cameras was { bga, alignment, alignment2 } ──
        // If it loaded as a plain object (not an array), convert it.
        if (!Array.isArray(this.cameras)) {
          const old = this.cameras || {}
          const migrated = []
          if (old.bga)        migrated.push({ id: 'cam_migrated_0', device: old.bga,        type: 'bga_grid',       name: '', test: false })
          if (old.alignment)  migrated.push({ id: 'cam_migrated_1', device: old.alignment,  type: 'alignment_chip', name: '', test: false })
          if (old.alignment2) migrated.push({ id: 'cam_migrated_2', device: old.alignment2, type: 'alignment_chip', name: '', test: false })
          this.cameras = migrated
        }

        // ── Migration: ensure pinnedMacros array exists ────────────
        if (!Array.isArray(this.pinnedMacros)) this.pinnedMacros = []

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

    addZone() {
      if (this.zones.length >= 8) return
      const id = Math.max(0, ...this.zones.map(z => z.id)) + 1
      this.zones.push({ id, label: `Zone ${id}`, type: 'lower', pin: null, deferred: false, tcId: null, sensorPin: '' })
    },

    removeZone(id) {
      this.zones = this.zones.filter(z => z.id !== id)
    },

    addTc() {
      const id = Math.max(0, ...this.thermocouples.map(t => t.id)) + 1
      this.thermocouples.push({ id, label: `TC ${id}`, pin: '' })
    },

    removeTc(id) {
      this.thermocouples = this.thermocouples.filter(t => t.id !== id)
      for (const zone of this.zones) {
        if (zone.tcId === id) { zone.tcId = null; zone.sensorPin = '' }
      }
    },

    addFan() {
      const id = Math.max(0, ...this.fans.map(f => f.id)) + 1
      this.fans.push({ id, label: `Fan ${id}`, pin: '', pwm: true })
    },

    removeFan(id) {
      this.fans = this.fans.filter(f => f.id !== id)
    },

    setStepperSlots(slots) {
      this.stepperSlots = slots
    },

    addCamera(test = false) {
      if (!Array.isArray(this.cameras)) this.cameras = []
      const id = 'cam_' + Date.now().toString(36)
      this.cameras.push({
        id,
        device: '',
        type:   'bga_grid',
        name:   '',
        test:   !!test,
      })
    },

    removeCamera(id) {
      if (!Array.isArray(this.cameras)) { this.cameras = []; return }
      this.cameras = this.cameras.filter(c => c.id !== id)
    },

    // When a TC is selected on a zone, auto-fill its pin
    onZoneTcChange(zone) {
      const tc = this.thermocouples.find(t => t.id === zone.tcId)
      if (tc) zone.sensorPin = tc.pin
    },
  },
})
