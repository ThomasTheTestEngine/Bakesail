/**
 * useTestPins.js
 * Manages a pool of host GPIO pins for testing without real hardware.
 * Tracks which pins are in use across all settings fields so the same
 * pin is never assigned twice.
 *
 * Usage:
 *   const { isTestPin, toggleTestPin } = useTestPins(settingsStore)
 *
 *   // In template, beside each pin input:
 *   <input v-model="zone.pin" class="field-input--pin" />
 *   <TestPinCheck :pin="zone.pin" @toggle="zone.pin = $event" />
 */

import { computed } from 'vue'

// Available host GPIO pins for testing — safe unused pins on Pi 4
export const TEST_PIN_POOL = [
  'gpio17', 'gpio18', 'gpio19', 'gpio20', 'gpio21',
  'gpio22', 'gpio23', 'gpio24', 'gpio25', 'gpio26', 'gpio27',
]

export function useTestPins(settings) {
  // Collect every gpio pin currently assigned anywhere in settings
  const usedPins = computed(() => {
    const pins = new Set()

    for (const zone of (settings.zones ?? [])) {
      if (isTestPin(zone.pin)) pins.add(zone.pin)
    }
    for (const tc of (settings.thermocouples ?? [])) {
      if (isTestPin(tc.csPin))   pins.add(tc.csPin)
      if (isTestPin(tc.sckPin))  pins.add(tc.sckPin)
      if (isTestPin(tc.misoPin)) pins.add(tc.misoPin)
    }
    for (const fan of (settings.fans ?? [])) {
      if (isTestPin(fan.pin)) pins.add(fan.pin)
    }
    if (isTestPin(settings.vacuum?.penPin))            pins.add(settings.vacuum.penPin)
    if (isTestPin(settings.vacuum?.nozzlePin))         pins.add(settings.vacuum.nozzlePin)
    if (isTestPin(settings.illumination?.laserPin))    pins.add(settings.illumination.laserPin)
    if (isTestPin(settings.illumination?.neopixelPin)) pins.add(settings.illumination.neopixelPin)
    for (const slot of (settings.stepperSlots ?? [])) {
      if (isTestPin(slot.heaterPin)) pins.add(slot.heaterPin)
    }

    return pins
  })

  function isTestPin(pin) {
    return TEST_PIN_POOL.includes(pin)
  }

  function nextPin() {
    return TEST_PIN_POOL.find(p => !usedPins.value.has(p)) ?? 'gpio27'
  }

  /**
   * Toggle a test pin for a given current value.
   * Returns the new pin value (assign it to your reactive field).
   * If currentPin is already a test pin, clears it.
   * If not, assigns the next free test pin.
   */
  function toggleTestPin(currentPin) {
    if (isTestPin(currentPin)) return ''
    return nextPin()
  }

  return { isTestPin, toggleTestPin, nextPin, usedPins }
}
