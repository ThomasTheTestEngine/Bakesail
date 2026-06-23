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
    deviceType:   'oven',
    machineClass: 'manual',

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

    // Cameras
    cameras: {
      bga:        '',
      alignment:  '',
      alignment2: '',
    },

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

    // When a TC is selected on a zone, auto-fill its pin
    onZoneTcChange(zone) {
      const tc = this.thermocouples.find(t => t.id === zone.tcId)
      if (tc) zone.sensorPin = tc.pin
    },
  },
})
