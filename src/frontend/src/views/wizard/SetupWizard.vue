<template>
  <div class="wizard">

    <!-- ── Progress bar ──────────────────────────────────────────── -->
    <div class="wizard-progress">
      <div
        v-for="(step, i) in steps"
        :key="i"
        class="progress-step"
        :class="{
          'progress-step--done':    i < currentStep,
          'progress-step--active':  i === currentStep,
        }"
      >
        <div class="progress-dot">{{ i < currentStep ? '✓' : i + 1 }}</div>
        <div class="progress-label">{{ step.label }}</div>
      </div>
    </div>

    <!-- ── Step content ───────────────────────────────────────────── -->
    <div class="wizard-body card">

      <!-- Step 0: Welcome -->
      <template v-if="currentStep === 0">
        <div class="step-title">Welcome to Bakesail</div>
        <p class="step-desc">
          This wizard will guide you through configuring your rework station.
          At the end, Bakesail will write a <code>bakesail.cfg</code> for Klipper
          based on your hardware.
        </p>
        <p class="step-desc">
          You'll need to know your MCU's pin names (e.g. <code>PA2</code>, <code>PB12</code>).
          Refer to your board's pinout diagram. Each hardware step has a
          <strong>Test Pin</strong> button so you can confirm correct wiring before saving.
        </p>
        <p class="step-desc">
          Make sure Klipper is connected to your MCU before proceeding.
        </p>
      </template>

      <!-- Step 1: Device type -->
      <template v-else-if="currentStep === 1">
        <div class="step-title">Device Type</div>
        <p class="step-desc">What kind of thermal processing equipment is this?</p>
        <div class="option-grid">
          <button
            v-for="opt in deviceTypeOptions"
            :key="opt.value"
            class="option-card"
            :class="{ active: settings.deviceType === opt.value }"
            @click="settings.deviceType = opt.value"
          >
            <div class="option-icon">{{ opt.icon }}</div>
            <div class="option-label">{{ opt.label }}</div>
            <div class="option-desc">{{ opt.desc }}</div>
          </button>
        </div>
      </template>

      <!-- Step 2: Machine class -->
      <template v-else-if="currentStep === 2">
        <div class="step-title">Machine Class</div>
        <p class="step-desc">How much automation does this machine have?</p>
        <div class="option-grid">
          <button
            v-for="opt in machineClassOptions"
            :key="opt.value"
            class="option-card"
            :class="{ active: settings.machineClass === opt.value }"
            @click="settings.machineClass = opt.value"
          >
            <div class="option-icon">{{ opt.icon }}</div>
            <div class="option-label">{{ opt.label }}</div>
            <div class="option-desc">{{ opt.desc }}</div>
          </button>
        </div>
      </template>

      <!-- Step 3: Heater zones -->
      <template v-else-if="currentStep === 3">
        <div class="step-title">Heater Zones</div>
        <p class="step-desc">
          Configure one heater zone per independently controlled heating element.
          Assign a dedicated heater pin, or defer to a stepper slot in step 9.
        </p>

        <div class="item-list">
          <div v-for="zone in settings.zones" :key="zone.id" class="item-row">
            <div class="item-num">{{ zone.id }}</div>
            <input class="field-input" v-model="zone.label" placeholder="Zone label" style="width:130px;flex:none" />

            <label class="field-label-inline">
              <input type="checkbox" v-model="zone.deferred" />
              Via stepper slot
            </label>

            <template v-if="!zone.deferred">
              <input class="field-input field-input--pin" v-model="zone.pin"
                     placeholder="e.g. PA2" />
              <TestPinButton :pin="zone.pin" />
            </template>
            <span v-else class="defer-note">Assign in step 9</span>

            <button class="item-remove" @click="settings.removeZone(zone.id)"
                    :disabled="settings.zones.length <= 1">×</button>
          </div>
        </div>

        <button class="btn btn-ghost btn-sm" @click="settings.addZone()" style="margin-top:12px">
          + Add Zone
        </button>
      </template>

      <!-- Step 4: Thermocouples -->
      <template v-else-if="currentStep === 4">
        <div class="step-title">Thermocouples</div>
        <p class="step-desc">
          Configure MAX31855 SPI thermocouple amplifiers.
          Each TC needs a CS pin plus shared SPI clock and MISO pins.
        </p>

        <div class="item-list">
          <div v-for="tc in settings.thermocouples" :key="tc.id" class="item-row item-row--wrap">
            <div class="item-num">{{ tc.id }}</div>
            <input class="field-input" v-model="tc.label" placeholder="TC label" style="width:100px;flex:none" />

            <span class="field-label-inline">CS</span>
            <input class="field-input field-input--pin" v-model="tc.csPin" placeholder="PB12" />

            <span class="field-label-inline">SCK</span>
            <input class="field-input field-input--pin" v-model="tc.sckPin" placeholder="PB13" />

            <span class="field-label-inline">MISO</span>
            <input class="field-input field-input--pin" v-model="tc.misoPin" placeholder="PB14" />

            <TestPinButton :pin="tc.csPin" label="Test CS" />

            <button class="item-remove" @click="settings.removeTc(tc.id)"
                    :disabled="settings.thermocouples.length <= 1">×</button>
          </div>
        </div>

        <button class="btn btn-ghost btn-sm" @click="settings.addTc()" style="margin-top:12px">
          + Add Thermocouple
        </button>

        <!-- Zone → TC mapping -->
        <div class="step-subtitle" style="margin-top:20px">Zone → Thermocouple mapping</div>
        <div class="item-list" style="margin-top:8px">
          <div v-for="zone in settings.zones" :key="zone.id" class="item-row">
            <span class="field-label-inline" style="width:80px">{{ zone.label }}</span>
            <select class="field-select" v-model="settings.zoneTcMap[zone.id]">
              <option v-for="tc in settings.thermocouples" :key="tc.id" :value="tc.id">
                {{ tc.label }}
              </option>
            </select>
          </div>
        </div>
      </template>

      <!-- Step 5: Fans -->
      <template v-else-if="currentStep === 5">
        <div class="step-title">Fans</div>
        <p class="step-desc">Configure cooling or airflow fans.</p>

        <div class="item-list">
          <div v-for="fan in settings.fans" :key="fan.id" class="item-row">
            <div class="item-num">{{ fan.id }}</div>
            <input class="field-input" v-model="fan.label" placeholder="Fan label" style="width:110px;flex:none" />
            <input class="field-input field-input--pin" v-model="fan.pin" placeholder="e.g. PC6" />

            <label class="field-label-inline">
              <input type="checkbox" v-model="fan.pwm" />
              PWM
            </label>

            <TestPinButton :pin="fan.pin" />

            <button class="item-remove" @click="settings.removeFan(fan.id)"
                    :disabled="settings.fans.length === 0">×</button>
          </div>
        </div>

        <button class="btn btn-ghost btn-sm" @click="settings.addFan()" style="margin-top:12px">
          + Add Fan
        </button>
        <p class="step-note" style="margin-top:8px">No fans? That's fine — skip this step.</p>
      </template>

      <!-- Step 6: Vacuum -->
      <template v-else-if="currentStep === 6">
        <div class="step-title">Vacuum</div>
        <p class="step-desc">Configure GPIO-controlled vacuum tools.</p>

        <div class="item-list">
          <div class="item-row">
            <label class="field-label-inline" style="width:180px">
              <input type="checkbox" v-model="settings.vacuum.pen" />
              Manual vacuum pen
            </label>
            <template v-if="settings.vacuum.pen">
              <input class="field-input field-input--pin" v-model="settings.vacuum.penPin" placeholder="e.g. PA1" />
              <TestPinButton :pin="settings.vacuum.penPin" />
            </template>
          </div>

          <div class="item-row" v-if="settings.nozzleVacuumAvailable">
            <label class="field-label-inline" style="width:180px">
              <input type="checkbox" v-model="settings.vacuum.nozzle" />
              Nozzle vacuum
            </label>
            <template v-if="settings.vacuum.nozzle">
              <input class="field-input field-input--pin" v-model="settings.vacuum.nozzlePin" placeholder="e.g. PA0" />
              <TestPinButton :pin="settings.vacuum.nozzlePin" />
            </template>
          </div>
        </div>

        <p class="step-note">No vacuum? Skip this step.</p>
      </template>

      <!-- Step 7: Illumination -->
      <template v-else-if="currentStep === 7">
        <div class="step-title">Illumination</div>
        <p class="step-desc">Configure laser pointers, spot lights, or LED bars.</p>

        <div class="item-list">
          <div class="item-row">
            <label class="field-label-inline" style="width:180px">
              <input type="checkbox" v-model="settings.illumination.laser" />
              Laser / spot light
            </label>
            <template v-if="settings.illumination.laser">
              <input class="field-input field-input--pin" v-model="settings.illumination.laserPin" placeholder="e.g. PB0" />
              <TestPinButton :pin="settings.illumination.laserPin" />
            </template>
          </div>

          <div class="item-row item-row--wrap">
            <label class="field-label-inline" style="width:180px">
              <input type="checkbox" v-model="settings.illumination.neopixel" />
              NeoPixel LED bar
            </label>
            <template v-if="settings.illumination.neopixel">
              <span class="field-label-inline">Pin</span>
              <input class="field-input field-input--pin" v-model="settings.illumination.neopixelPin" placeholder="e.g. PB1" />
              <span class="field-label-inline">LEDs</span>
              <input class="field-input" type="number" v-model.number="settings.illumination.neopixelCount"
                     min="1" max="300" style="width:70px;flex:none" />
              <span class="field-label-inline">Colour</span>
              <input type="color" v-model="settings.illumination.neopixelColor"
                     style="width:40px;height:32px;border:none;background:none;cursor:pointer;padding:0" />
              <TestPinButton :pin="settings.illumination.neopixelPin" />
            </template>
          </div>
        </div>

        <p class="step-note">No illumination? Skip this step.</p>
      </template>

      <!-- Step 8: Cameras -->
      <template v-else-if="currentStep === 8">
        <div class="step-title">Cameras</div>
        <p class="step-desc">
          Add each USB camera. You can skip this step and configure cameras later in Settings → Cameras.
        </p>

        <div class="item-list" style="margin-top:10px">
          <div v-for="cam in settings.cameras" :key="cam.id" class="item-row" style="gap:8px;flex-wrap:wrap">
            <span v-if="cam.test" class="wiz-cam-test-badge" style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:4px;border:1px solid var(--teal);background:var(--teal-glow);color:var(--teal);font-size:10px;font-weight:700;letter-spacing:0.1em;width:150px;justify-content:center;flex-shrink:0">TEST</span>
            <select v-else class="field-select" style="width:150px;flex:none" v-model="cam.device">
              <option value="">— select —</option>
              <option value="/dev/video0">/dev/video0</option>
              <option value="/dev/video1">/dev/video1</option>
              <option value="/dev/video2">/dev/video2</option>
              <option value="/dev/video3">/dev/video3</option>
            </select>
            <select class="field-select" style="width:160px;flex:none" v-model="cam.type">
              <option value="bga_grid">BGA Grid</option>
              <option value="alignment_chip">Alignment - Chip</option>
              <option value="alignment_board">Alignment - Board</option>
              <option value="custom">Custom</option>
            </select>
            <input class="field-input" style="width:130px;flex:none" v-model="cam.name"
                   :placeholder="{ bga_grid:'BGA Grid', alignment_chip:'Alignment Chip', alignment_board:'Alignment Board', custom:'Camera name' }[cam.type]" />
            <button class="item-remove" @click="settings.removeCamera(cam.id)">×</button>
          </div>
          <div v-if="settings.cameras.length === 0" class="step-note" style="margin:0">No cameras added yet.</div>
        </div>

        <div style="display:flex;gap:10px;margin-top:12px">
          <button class="btn btn-ghost btn-sm" @click="settings.addCamera(false)">+ Add Camera</button>
          <button class="btn btn-ghost btn-sm" @click="settings.addCamera(true)">+ TEST Camera</button>
        </div>

        <p class="step-note" style="margin-top:12px">
          Run <code>ls /dev/video*</code> over SSH to list connected video devices.
        </p>
      </template>

      <!-- Step 9: Stepper slots -->
      <template v-else-if="currentStep === 9">
        <div class="step-title">Stepper Slots</div>
        <p class="step-desc">
          Assign a function to each stepper driver slot on your MCU.
          Slots assigned as heaters here will provide the output pin for deferred
          heater zones from step 3.
        </p>

        <div class="item-list">
          <div v-for="slot in settings.stepperSlots" :key="slot.slot" class="item-row item-row--wrap">
            <span class="slot-label">{{ slot.slot }}</span>

            <select class="field-select" v-model="slot.function">
              <option value="unused">Unused</option>
              <optgroup label="Heater zones">
                <option
                  v-for="zone in settings.deferredZones"
                  :key="zone.id"
                  :value="`heater_zone${zone.id}`"
                >Heater — {{ zone.label }}</option>
              </optgroup>
              <optgroup label="Motion" v-if="settings.hasMotion">
                <option
                  v-for="axis in settings.availableMotionAxes"
                  :key="axis"
                  :value="`motion_${axis}`"
                >Motion {{ axis.toUpperCase() }}</option>
              </optgroup>
              <option value="gpio">Generic GPIO</option>
            </select>

            <template v-if="slot.function.startsWith('heater_zone')">
              <span class="field-label-inline">Heater pin</span>
              <input class="field-input field-input--pin" v-model="slot.heaterPin" placeholder="e.g. PC8" />
              <TestPinButton :pin="slot.heaterPin" />
            </template>
          </div>
        </div>

        <div class="slot-add-row">
          <button class="btn btn-ghost btn-sm" @click="addStepperSlot">+ Add Slot</button>
          <span class="step-note">Add one row per stepper driver on your board.</span>
        </div>
      </template>

      <!-- Step 10: Review + write -->
      <template v-else-if="currentStep === 10">
        <div class="step-title">Review & Write Config</div>
        <p class="step-desc">
          Review the configuration below. Click <strong>Write Config</strong> to save
          <code>bakesail.cfg</code> and restart Klipper.
        </p>

        <div v-if="skippedItems.length > 0" class="skip-warning">
          <strong>⚠ Skipped (missing pins):</strong>
          <ul style="margin:6px 0 0 16px">
            <li v-for="item in skippedItems" :key="item" style="font-size:12px">{{ item }}</li>
          </ul>
          <span style="font-size:11px;color:var(--text-muted)">Assign pins in Settings after setup.</span>
        </div>

        <pre class="config-preview">{{ configPreview }}</pre>

        <div v-if="writeError" class="write-error">{{ writeError }}</div>
      </template>

    </div>

    <!-- ── Navigation ─────────────────────────────────────────────── -->
    <div class="wizard-nav">
      <button class="btn btn-ghost" :disabled="currentStep === 0" @click="currentStep--">
        ← Back
      </button>

      <div style="flex:1"></div>

      <template v-if="currentStep < steps.length - 1">
        <button class="btn btn-primary" @click="nextStep">
          Next →
        </button>
      </template>

      <template v-else>
        <button class="btn btn-primary" :disabled="writing" @click="writeConfig">
          {{ writing ? 'Writing…' : 'Write Config & Restart' }}
        </button>
      </template>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '../../stores/settings.js'
import { saveBakesailCfg, ensurePrinterCfgInclude } from '../../utils/configWriter.js'
import { useMoonraker } from '../../composables/useMoonraker.js'
import TestPinButton from './TestPinButton.vue'
import { generateBakesailCfg } from '../../utils/configWriter.js'

const router   = useRouter()
const settings = useSettingsStore()
const { sendGcode } = useMoonraker()

// ── Steps ──────────────────────────────────────────────────────────

const steps = [
  { label: 'Welcome' },
  { label: 'Device' },
  { label: 'Class' },
  { label: 'Heaters' },
  { label: 'TCs' },
  { label: 'Fans' },
  { label: 'Vacuum' },
  { label: 'Lights' },
  { label: 'Cameras' },
  { label: 'Steppers' },
  { label: 'Review' },
]

const currentStep = ref(0)
const writing     = ref(false)
const writeError  = ref('')

// ── Options ────────────────────────────────────────────────────────

const deviceTypeOptions = [
  { value: 'oven',       icon: '□', label: 'Reflow Oven',        desc: 'Enclosed oven with bottom heat' },
  { value: 'ir_rework',  icon: '◉', label: 'IR Rework Station',  desc: 'Infrared top and/or bottom heaters' },
  { value: 'hot_air',    icon: '⊗', label: 'Hot Air Station',    desc: 'Hot air nozzle rework' },
  { value: 'hot_plate',  icon: '▦', label: 'Hot Plate',          desc: 'Conductive bottom heat only' },
]

const machineClassOptions = [
  { value: 'manual',    icon: '◈', label: 'Manual',     desc: 'Operator positions everything by hand. No stepper motion.' },
  { value: 'semi_auto', icon: '⊞', label: 'Semi-Auto',  desc: 'Z axis only. Operator positions XY manually.' },
  { value: 'automatic', icon: '⊕', label: 'Automatic',  desc: 'Full XYZ motion. Pick and place capable.' },
]

// ── Stepper slot management ────────────────────────────────────────

function addStepperSlot() {
  const slotNames = ['X', 'Y', 'Z', 'E0', 'E1', 'E2', 'E3']
  const used = settings.stepperSlots.map(s => s.slot)
  const next = slotNames.find(n => !used.includes(n)) || `E${settings.stepperSlots.length - 2}`
  settings.stepperSlots.push({
    slot: next, stepPin: '', dirPin: '', enablePin: '',
    endstopPin: '', heaterPin: '', function: 'unused',
  })
}

// ── Navigation ─────────────────────────────────────────────────────

function nextStep() {
  if (currentStep.value < steps.length - 1) currentStep.value++
}

// ── Skipped items warning ────────────────────────────────────────────────

const skippedItems = computed(() => {
  const items = []
  for (const tc of settings.thermocouples) {
    if (!tc.csPin || !tc.sckPin || !tc.misoPin)
      items.push(`${tc.label}: missing SPI pins`)
  }
  for (const zone of settings.zones) {
    if (!zone.deferred && !zone.pin)
      items.push(`${zone.label}: missing heater pin`)
  }
  for (const fan of settings.fans) {
    if (!fan.pin) items.push(`${fan.label}: missing pin`)
  }
  return items
})

// ── Config preview ─────────────────────────────────────────────────

const configPreview = computed(() => generateBakesailCfg(settings.$state))

// ── Write config ───────────────────────────────────────────────────

async function writeConfig() {
  writing.value    = true
  writeError.value = ''
  try {
    await saveBakesailCfg(settings.$state)
    await settings.save()
    await ensurePrinterCfgInclude(settings.deviceType)
    settings.wizardComplete = true
    await settings.save()
    await sendGcode('FIRMWARE_RESTART')
    // Navigate to dashboard — Klipper will reconnect via useMoonraker's reconnect loop
    router.push('/')
  } catch (e) {
    writeError.value = e.message
  } finally {
    writing.value = false
  }
}

onMounted(() => settings.load())
</script>

<style scoped>
.wizard {
  max-width: 860px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ── Progress ───────────────────────────────────────────────────── */
.wizard-progress {
  display: flex;
  gap: 0;
  overflow-x: auto;
}

.progress-step {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  position: relative;
  padding: 0 4px;
}

.progress-step::after {
  content: '';
  position: absolute;
  top: 12px;
  left: 50%;
  right: -50%;
  height: 1px;
  background: var(--border);
  z-index: 0;
}
.progress-step:last-child::after { display: none; }

.progress-dot {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  position: relative;
  flex-shrink: 0;
  font-family: var(--font-mono);
}

.progress-step--active .progress-dot {
  border-color: var(--amber);
  color: var(--amber);
  background: var(--amber-glow);
}

.progress-step--done .progress-dot {
  border-color: var(--green);
  color: var(--green);
  background: transparent;
}

.progress-label {
  font-size: 10px;
  color: var(--text-muted);
  text-align: center;
  white-space: nowrap;
}

.progress-step--active .progress-label { color: var(--amber); }
.progress-step--done .progress-label   { color: var(--text-dim); }

/* ── Body ───────────────────────────────────────────────────────── */
.wizard-body {
  min-height: 320px;
}

.step-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 12px;
}

.step-subtitle {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.step-desc {
  font-size: 13px;
  color: var(--text-dim);
  line-height: 1.6;
  margin-bottom: 10px;
}

.step-desc code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--amber);
}

.step-note {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
}

.step-note code {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 3px;
}

/* ── Option cards (device type, machine class) ──────────────────── */
.option-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-top: 8px;
}

.option-card {
  padding: 16px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  text-align: center;
  transition: border-color 0.15s, background 0.15s;
}

.option-card:hover { border-color: var(--border-2); }
.option-card.active {
  border-color: var(--amber);
  background: var(--amber-glow);
}

.option-icon {
  font-size: 24px;
  margin-bottom: 8px;
  color: var(--text-dim);
}
.option-card.active .option-icon { color: var(--amber); }

.option-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
}

.option-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

/* ── Item rows (zones, TCs, fans etc.) ──────────────────────────── */
.item-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
}

.item-row--wrap { flex-wrap: wrap; }

.item-num {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}

.field-input {
  flex: 1;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 7px 10px;
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 13px;
  outline: none;
  min-width: 0;
  transition: border-color 0.12s;
}
.field-input:focus { border-color: var(--amber-dim); }
.field-input--pin { flex: 0 0 90px; font-family: var(--font-mono); font-size: 12px; }

.field-select {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 7px 8px;
  color: var(--text);
  font-size: 13px;
  outline: none;
  cursor: pointer;
}

.field-label-inline {
  font-size: 12px;
  color: var(--text-dim);
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.defer-note {
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
}

.item-remove {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.1s, border-color 0.1s;
}
.item-remove:hover:not(:disabled) { color: var(--red); border-color: var(--red); }
.item-remove:disabled { opacity: 0.3; cursor: not-allowed; }

/* ── Stepper slots ──────────────────────────────────────────────── */
.slot-label {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--amber);
  width: 32px;
  flex-shrink: 0;
}

.slot-add-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
}

/* ── Config preview ─────────────────────────────────────────────── */
.config-preview {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dim);
  line-height: 1.6;
  overflow-x: auto;
  max-height: 380px;
  overflow-y: auto;
  white-space: pre;
}

.write-error {
  margin-top: 12px;
  font-size: 12px;
  color: var(--red);
  font-family: var(--font-mono);
}

.skip-warning {
  padding: 12px 14px;
  background: rgba(232, 130, 12, 0.08);
  border: 1px solid var(--amber-dim);
  border-radius: var(--radius);
  color: var(--amber);
  font-size: 13px;
  margin-bottom: 12px;
}

/* ── Navigation ─────────────────────────────────────────────────── */
.wizard-nav {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
