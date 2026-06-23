<template>
  <div class="settings">
    <div class="page-title">SETTINGS</div>

    <!-- ── Sidebar nav ──────────────────────────────────────────── -->
    <div class="settings-layout">
      <aside class="settings-nav">
        <button
          v-for="sec in sections"
          :key="sec.id"
          class="settings-nav-item"
          :class="{ active: activeSection === sec.id }"
          @click="activeSection = sec.id"
        >{{ sec.label }}</button>
      </aside>

      <div class="settings-content">

        <!-- Device -->
        <template v-if="activeSection === 'device'">
          <div class="section-title">Device</div>
          <div class="field-row">
            <label class="field-label">Type</label>
            <select class="field-select" v-model="settings.deviceType">
              <option value="oven">Reflow Oven</option>
              <option value="ir_rework">IR Rework Station</option>
              <option value="hot_air">Hot Air Station</option>
              <option value="hot_plate">Hot Plate</option>
            </select>
          </div>
          <div class="field-row">
            <label class="field-label">Class</label>
            <select class="field-select" v-model="settings.machineClass">
              <option value="manual">Manual</option>
              <option value="semi_auto">Semi-Automatic</option>
              <option value="automatic">Automatic</option>
            </select>
          </div>
        </template>

        <!-- Zones -->
        <template v-else-if="activeSection === 'zones'">
          <div class="section-title">Heater Zones</div>
          <div class="item-list">
            <div v-for="zone in settings.zones" :key="zone.id" class="item-row">
              <div class="item-num">{{ zone.id }}</div>
              <input class="field-input" v-model="zone.label" style="width:130px;flex:none" />
              <label class="field-label-inline">
                <input type="checkbox" v-model="zone.deferred" /> Via stepper slot
              </label>
              <template v-if="!zone.deferred">
                <input class="field-input field-input--pin" v-model="zone.pin" placeholder="e.g. PA2" />
              </template>
              <span v-else class="defer-note">Assigned in Stepper Slots</span>
              <button class="item-remove" @click="settings.removeZone(zone.id)"
                      :disabled="settings.zones.length <= 1">×</button>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" @click="settings.addZone()" style="margin-top:10px">
            + Add Zone
          </button>
        </template>

        <!-- Thermocouples -->
        <template v-else-if="activeSection === 'tc'">
          <div class="section-title">Thermocouples</div>
          <div class="item-list">
            <div v-for="tc in settings.thermocouples" :key="tc.id" class="item-row item-row--wrap">
              <div class="item-num">{{ tc.id }}</div>
              <input class="field-input" v-model="tc.label" style="width:100px;flex:none" />
              <span class="field-label-inline">CS</span>
              <input class="field-input field-input--pin" v-model="tc.csPin" placeholder="PB12" />
              <span class="field-label-inline">SCK</span>
              <input class="field-input field-input--pin" v-model="tc.sckPin" placeholder="PB13" />
              <span class="field-label-inline">MISO</span>
              <input class="field-input field-input--pin" v-model="tc.misoPin" placeholder="PB14" />
              <button class="item-remove" @click="settings.removeTc(tc.id)"
                      :disabled="settings.thermocouples.length <= 1">×</button>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" @click="settings.addTc()" style="margin-top:10px">
            + Add TC
          </button>
          <div class="section-title" style="margin-top:20px">Zone → TC Mapping</div>
          <div class="item-list" style="margin-top:8px">
            <div v-for="zone in settings.zones" :key="zone.id" class="item-row">
              <span class="field-label-inline" style="width:100px">{{ zone.label }}</span>
              <select class="field-select" v-model="settings.zoneTcMap[zone.id]">
                <option v-for="tc in settings.thermocouples" :key="tc.id" :value="tc.id">
                  {{ tc.label }}
                </option>
              </select>
            </div>
          </div>
        </template>

        <!-- Fans -->
        <template v-else-if="activeSection === 'fans'">
          <div class="section-title">Fans</div>
          <div class="item-list">
            <div v-for="fan in settings.fans" :key="fan.id" class="item-row">
              <div class="item-num">{{ fan.id }}</div>
              <input class="field-input" v-model="fan.label" style="width:110px;flex:none" />
              <input class="field-input field-input--pin" v-model="fan.pin" placeholder="e.g. PC6" />
              <label class="field-label-inline">
                <input type="checkbox" v-model="fan.pwm" /> PWM
              </label>
              <button class="item-remove" @click="settings.removeFan(fan.id)">×</button>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" @click="settings.addFan()" style="margin-top:10px">
            + Add Fan
          </button>
        </template>

        <!-- Vacuum -->
        <template v-else-if="activeSection === 'vacuum'">
          <div class="section-title">Vacuum</div>
          <div class="item-list">
            <div class="item-row">
              <label class="field-label-inline" style="width:180px">
                <input type="checkbox" v-model="settings.vacuum.pen" /> Manual vacuum pen
              </label>
              <input v-if="settings.vacuum.pen" class="field-input field-input--pin"
                     v-model="settings.vacuum.penPin" placeholder="e.g. PA1" />
            </div>
            <div class="item-row" v-if="settings.nozzleVacuumAvailable">
              <label class="field-label-inline" style="width:180px">
                <input type="checkbox" v-model="settings.vacuum.nozzle" /> Nozzle vacuum
              </label>
              <input v-if="settings.vacuum.nozzle" class="field-input field-input--pin"
                     v-model="settings.vacuum.nozzlePin" placeholder="e.g. PA0" />
            </div>
          </div>
        </template>

        <!-- Illumination -->
        <template v-else-if="activeSection === 'illumination'">
          <div class="section-title">Illumination</div>
          <div class="item-list">
            <div class="item-row">
              <label class="field-label-inline" style="width:180px">
                <input type="checkbox" v-model="settings.illumination.laser" /> Laser / spot light
              </label>
              <input v-if="settings.illumination.laser" class="field-input field-input--pin"
                     v-model="settings.illumination.laserPin" placeholder="e.g. PB0" />
            </div>
            <div class="item-row item-row--wrap">
              <label class="field-label-inline" style="width:180px">
                <input type="checkbox" v-model="settings.illumination.neopixel" /> NeoPixel LED bar
              </label>
              <template v-if="settings.illumination.neopixel">
                <span class="field-label-inline">Pin</span>
                <input class="field-input field-input--pin" v-model="settings.illumination.neopixelPin" placeholder="PB1" />
                <span class="field-label-inline">LEDs</span>
                <input class="field-input" type="number" v-model.number="settings.illumination.neopixelCount"
                       min="1" max="300" style="width:70px;flex:none" />
                <span class="field-label-inline">Colour</span>
                <input type="color" v-model="settings.illumination.neopixelColor"
                       style="width:40px;height:32px;border:none;background:none;cursor:pointer;padding:0" />
              </template>
            </div>
          </div>
        </template>

        <!-- Cameras -->
        <template v-else-if="activeSection === 'cameras'">
          <div class="section-title">Cameras</div>
          <div class="item-list">
            <div class="item-row">
              <span class="field-label-inline" style="width:160px">BGA edge camera</span>
              <input class="field-input" v-model="settings.cameras.bga" placeholder="/dev/video0" />
            </div>
            <div class="item-row">
              <span class="field-label-inline" style="width:160px">Alignment camera 1</span>
              <input class="field-input" v-model="settings.cameras.alignment" placeholder="/dev/video1" />
            </div>
            <div class="item-row">
              <span class="field-label-inline" style="width:160px">Alignment camera 2</span>
              <input class="field-input" v-model="settings.cameras.alignment2" placeholder="/dev/video2" />
            </div>
          </div>
        </template>

        <!-- Stepper slots -->
        <template v-else-if="activeSection === 'steppers'">
          <div class="section-title">Stepper Slots</div>
          <div class="item-list">
            <div v-for="slot in settings.stepperSlots" :key="slot.slot" class="item-row item-row--wrap">
              <span class="slot-label">{{ slot.slot }}</span>
              <select class="field-select" v-model="slot.function">
                <option value="unused">Unused</option>
                <optgroup label="Heater zones">
                  <option v-for="zone in settings.deferredZones" :key="zone.id"
                          :value="`heater_zone${zone.id}`">Heater — {{ zone.label }}</option>
                </optgroup>
                <optgroup label="Motion" v-if="settings.hasMotion">
                  <option v-for="axis in settings.availableMotionAxes" :key="axis"
                          :value="`motion_${axis}`">Motion {{ axis.toUpperCase() }}</option>
                </optgroup>
                <option value="gpio">Generic GPIO</option>
              </select>
              <template v-if="slot.function.startsWith('heater_zone')">
                <span class="field-label-inline">Heater pin</span>
                <input class="field-input field-input--pin" v-model="slot.heaterPin" placeholder="PC8" />
              </template>
            </div>
          </div>
        </template>

        <!-- Movement -->
        <template v-else-if="activeSection === 'movement'">
          <div class="section-title">Movement</div>
          <p class="section-note">
            Configure motion axes for semi-automatic and automatic machines.
            Axis pins are assigned via Stepper Slots — set a slot to Motion X/Y/Z there first.
          </p>
          <template v-if="!settings.hasMotion">
            <p class="section-note">No motion axes available for <strong>Manual</strong> class machines.
            Change machine class in Device settings to enable motion.</p>
          </template>
          <template v-else>
            <div class="field-row">
              <label class="field-label">Max speed</label>
              <input class="field-input" type="number" v-model.number="settings.motion.maxSpeed"
                     min="1" max="500" style="width:80px;flex:none" />
              <span class="field-label-inline">mm/s</span>
            </div>
            <div class="field-row">
              <label class="field-label">Max accel</label>
              <input class="field-input" type="number" v-model.number="settings.motion.maxAccel"
                     min="1" max="5000" style="width:80px;flex:none" />
              <span class="field-label-inline">mm/s²</span>
            </div>
            <div class="field-row" v-if="settings.availableMotionAxes.includes('z')">
              <label class="field-label">Z travel</label>
              <input class="field-input" type="number" v-model.number="settings.motion.zMax"
                     min="1" max="200" style="width:80px;flex:none" />
              <span class="field-label-inline">mm</span>
            </div>
            <div class="field-row" v-if="settings.availableMotionAxes.includes('x')">
              <label class="field-label">X travel</label>
              <input class="field-input" type="number" v-model.number="settings.motion.xMax"
                     min="1" max="500" style="width:80px;flex:none" />
              <span class="field-label-inline">mm</span>
            </div>
            <div class="field-row" v-if="settings.availableMotionAxes.includes('y')">
              <label class="field-label">Y travel</label>
              <input class="field-input" type="number" v-model.number="settings.motion.yMax"
                     min="1" max="500" style="width:80px;flex:none" />
              <span class="field-label-inline">mm</span>
            </div>
            <div class="field-row">
              <label class="field-label">Microsteps</label>
              <select class="field-select" v-model.number="settings.motion.microsteps">
                <option :value="8">8</option>
                <option :value="16">16</option>
                <option :value="32">32</option>
              </select>
            </div>
            <div class="field-row">
              <label class="field-label">Rot distance</label>
              <input class="field-input" type="number" v-model.number="settings.motion.rotationDistance"
                     min="1" max="200" step="0.1" style="width:80px;flex:none" />
              <span class="field-label-inline">mm (lead screw or belt pitch × teeth)</span>
            </div>
          </template>
        </template>

        <!-- Write config -->
        <template v-else-if="activeSection === 'config'">
          <div class="section-title">Configuration</div>
          <p class="section-note">
            Saves current settings and regenerates <code>bakesail.cfg</code>.
            Klipper will restart to load the new config.
          </p>
          <div class="config-actions">
            <button class="btn btn-primary" :disabled="saving" @click="writeConfig">
              {{ saving ? 'Writing…' : 'Write Config & Restart' }}
            </button>
            <button class="btn btn-ghost" @click="router.push('/wizard')">
              Re-run Setup Wizard
            </button>
          </div>
          <div v-if="saveError" class="save-error">{{ saveError }}</div>
          <pre class="config-preview">{{ configPreview }}</pre>
        </template>

      </div>
    </div>

    <!-- ── Apply bar — always visible ───────────────────────────────── -->
    <div class="settings-apply-bar">
      <span class="apply-note">
        Changes take effect when you apply. Klipper will restart.
      </span>
      <div class="apply-actions">
        <button class="btn btn-ghost btn-sm" @click="activeSection = 'config'">
          Preview config
        </button>
        <button class="btn btn-primary" :disabled="applying" @click="applyConfig">
          {{ applying ? 'Applying…' : 'Apply & Restart' }}
        </button>
      </div>
      <div v-if="applyError" class="apply-error">{{ applyError }}</div>
      <div v-if="applySuccess" class="apply-success">✓ Config written — Klipper restarting</div>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '../stores/settings.js'
import { saveBakesailCfg, ensurePrinterCfgInclude, generateBakesailCfg } from '../utils/configWriter.js'
import { useMoonraker } from '../composables/useMoonraker.js'

const router   = useRouter()
const settings = useSettingsStore()
const { runGcode } = useMoonraker()

const activeSection = ref('device')
const saving        = ref(false)
const saveError     = ref('')
const applying      = ref(false)
const applyError    = ref('')
const applySuccess  = ref(false)

const sections = [
  { id: 'device',       label: 'Device' },
  { id: 'zones',        label: 'Heater Zones' },
  { id: 'tc',           label: 'Thermocouples' },
  { id: 'fans',         label: 'Fans' },
  { id: 'vacuum',       label: 'Vacuum' },
  { id: 'illumination', label: 'Illumination' },
  { id: 'cameras',      label: 'Cameras' },
  { id: 'steppers',     label: 'Stepper Slots' },
  { id: 'movement',     label: 'Movement' },
  { id: 'config',       label: 'Write Config' },
]

const configPreview = computed(() => generateBakesailCfg(settings.$state))

async function writeConfig() {
  saving.value    = true
  saveError.value = ''
  try {
    await saveBakesailCfg(settings.$state)
    await settings.save()
    await ensurePrinterCfgInclude()
    await runGcode('FIRMWARE_RESTART')
  } catch (e) {
    saveError.value = e.message
  } finally {
    saving.value = false
  }
}

async function applyConfig() {
  applying.value    = true
  applyError.value  = ''
  applySuccess.value = false
  try {
    await saveBakesailCfg(settings.$state)
    await settings.save()
    await ensurePrinterCfgInclude()
    await runGcode('FIRMWARE_RESTART')
    applySuccess.value = true
    setTimeout(() => { applySuccess.value = false }, 4000)
  } catch (e) {
    applyError.value = e.message
  } finally {
    applying.value = false
  }
}

onMounted(() => settings.load())
</script>

<style scoped>
.settings { display: flex; flex-direction: column; gap: 16px; }

.settings-layout {
  display: flex;
  gap: 20px;
  min-height: 480px;
}

.settings-nav {
  width: 160px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.settings-nav-item {
  text-align: left;
  padding: 8px 12px;
  background: transparent;
  border: none;
  border-radius: var(--radius);
  color: var(--text-dim);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.settings-nav-item:hover { background: var(--surface-2); color: var(--text); }
.settings-nav-item.active { background: var(--amber-glow); color: var(--amber); }

.settings-content {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px;
  min-width: 0;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 16px;
}

.section-note {
  font-size: 13px;
  color: var(--text-dim);
  margin-bottom: 16px;
  line-height: 1.6;
}
.section-note code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--surface-2);
  padding: 1px 5px;
  border-radius: 3px;
  color: var(--amber);
}

.field-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.field-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-muted);
  width: 80px;
  flex-shrink: 0;
}
.field-input {
  flex: 1;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 7px 10px;
  color: var(--text);
  font-size: 13px;
  outline: none;
  min-width: 0;
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
.item-list { display: flex; flex-direction: column; gap: 8px; }
.item-row { display: flex; align-items: center; gap: 8px; }
.item-row--wrap { flex-wrap: wrap; }
.item-num {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}
.item-remove {
  width: 24px; height: 24px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
}
.item-remove:hover:not(:disabled) { color: var(--red); border-color: var(--red); }
.item-remove:disabled { opacity: 0.3; cursor: not-allowed; }
.defer-note { font-size: 11px; color: var(--text-muted); font-style: italic; }
.slot-label {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--amber);
  width: 32px;
  flex-shrink: 0;
}
.config-actions { display: flex; gap: 10px; margin-bottom: 16px; }
.save-error { font-size: 12px; color: var(--red); font-family: var(--font-mono); margin-bottom: 12px; }
.config-preview {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-dim);
  line-height: 1.6;
  overflow: auto;
  max-height: 340px;
  white-space: pre;
}
.settings-apply-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  position: sticky;
  bottom: 0;
}
.apply-note { font-size: 12px; color: var(--text-muted); flex: 1; }
.apply-actions { display: flex; gap: 8px; align-items: center; }
.apply-error   { font-size: 12px; color: var(--red); font-family: var(--font-mono); width: 100%; }
.apply-success { font-size: 12px; color: var(--green); width: 100%; }
.btn-sm { padding: 6px 12px; font-size: 12px; }
</style>
