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
              <label class="test-pin-label" :class="{ active: isTestPin(zone.pin) }">
                <input type="checkbox" :checked="isTestPin(zone.pin)"
                  @change="zone.pin = toggleTestPin(zone.pin)" />
                Test
              </label>
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
              <label class="test-pin-label" :class="{ active: isTestPin(tc.csPin) }">
                <input type="checkbox" :checked="isTestPin(tc.csPin)"
                  @change="tc.csPin = toggleTestPin(tc.csPin)" />
                Test
              </label>
              <span class="field-label-inline">SCK</span>
              <input class="field-input field-input--pin" v-model="tc.sckPin" placeholder="PB13" />
              <label class="test-pin-label" :class="{ active: isTestPin(tc.sckPin) }">
                <input type="checkbox" :checked="isTestPin(tc.sckPin)"
                  @change="tc.sckPin = toggleTestPin(tc.sckPin)" />
                Test
              </label>
              <span class="field-label-inline">MISO</span>
              <input class="field-input field-input--pin" v-model="tc.misoPin" placeholder="PB14" />
              <label class="test-pin-label" :class="{ active: isTestPin(tc.misoPin) }">
                <input type="checkbox" :checked="isTestPin(tc.misoPin)"
                  @change="tc.misoPin = toggleTestPin(tc.misoPin)" />
                Test
              </label>
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
              <label class="test-pin-label" :class="{ active: isTestPin(fan.pin) }">
                <input type="checkbox" :checked="isTestPin(fan.pin)"
                  @change="fan.pin = toggleTestPin(fan.pin)" />
                Test
              </label>
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
              <label v-if="settings.vacuum.pen" class="test-pin-label" :class="{ active: isTestPin(settings.vacuum.penPin) }">
                <input type="checkbox" :checked="isTestPin(settings.vacuum.penPin)"
                  @change="settings.vacuum.penPin = toggleTestPin(settings.vacuum.penPin)" />
                Test
              </label>
            </div>
            <div class="item-row" v-if="settings.nozzleVacuumAvailable">
              <label class="field-label-inline" style="width:180px">
                <input type="checkbox" v-model="settings.vacuum.nozzle" /> Nozzle vacuum
              </label>
              <input v-if="settings.vacuum.nozzle" class="field-input field-input--pin"
                     v-model="settings.vacuum.nozzlePin" placeholder="e.g. PA0" />
              <label v-if="settings.vacuum.nozzle" class="test-pin-label" :class="{ active: isTestPin(settings.vacuum.nozzlePin) }">
                <input type="checkbox" :checked="isTestPin(settings.vacuum.nozzlePin)"
                  @change="settings.vacuum.nozzlePin = toggleTestPin(settings.vacuum.nozzlePin)" />
                Test
              </label>
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
              <label v-if="settings.illumination.laser" class="test-pin-label" :class="{ active: isTestPin(settings.illumination.laserPin) }">
                <input type="checkbox" :checked="isTestPin(settings.illumination.laserPin)"
                  @change="settings.illumination.laserPin = toggleTestPin(settings.illumination.laserPin)" />
                Test
              </label>
            </div>
            <div class="item-row item-row--wrap">
              <label class="field-label-inline" style="width:180px">
                <input type="checkbox" v-model="settings.illumination.neopixel" /> NeoPixel LED bar
              </label>
              <template v-if="settings.illumination.neopixel">
                <span class="field-label-inline">Pin</span>
                <input class="field-input field-input--pin" v-model="settings.illumination.neopixelPin" placeholder="PB1" />
                <label class="test-pin-label" :class="{ active: isTestPin(settings.illumination.neopixelPin) }">
                  <input type="checkbox" :checked="isTestPin(settings.illumination.neopixelPin)"
                    @change="settings.illumination.neopixelPin = toggleTestPin(settings.illumination.neopixelPin)" />
                  Test
                </label>
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
              <label class="test-pin-label" :class="{ active: isTestPin(slot.heaterPin) }">
                <input type="checkbox" :checked="isTestPin(slot.heaterPin)"
                  @change="slot.heaterPin = toggleTestPin(slot.heaterPin)" />
                Test
              </label>
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

        <!-- View current config -->
        <template v-else-if="activeSection === 'current'">
          <div class="section-title">View Current Config</div>
          <p class="section-note">
            The config currently loaded by Klipper. Does not include changes
            made in the settings tabs since the last reboot.
          </p>

          <div class="config-toolbar">
            <button class="btn btn-ghost btn-sm" @click="loadCurrentCfg" :disabled="currentCfgLoading">
              ↻ Refresh
            </button>
            <button
              class="btn btn-sm"
              :class="markedGood ? 'btn-primary' : 'btn-ghost'"
              @click="markAsGood"
              :disabled="markingGood"
            >
              {{ markingGood ? 'Saving…' : markedGood ? '✓ Marked as Good' : '★ Mark as Good Config' }}
            </button>
          </div>

          <div v-if="markGoodMsg" class="apply-success">{{ markGoodMsg }}</div>
          <pre v-if="currentCfg" class="config-preview">{{ currentCfg }}</pre>
          <div v-else class="section-note">{{ currentCfgLoading ? 'Loading…' : 'Could not load config.' }}</div>
        </template>

        <!-- Write config -->
        <template v-else-if="activeSection === 'config'">
          <div class="section-title">Write Config</div>
          <p class="section-note">
            Preview the config that will be generated from your current settings.
            Edit before applying, backup the current config, or revert to a known good one.
          </p>

          <div class="config-toolbar">
            <button class="btn btn-ghost btn-sm" @click="editMode = !editMode">
              {{ editMode ? '✕ Cancel Edit' : '✎ Edit' }}
            </button>
            <button class="btn btn-ghost btn-sm" @click="backupConfig" :disabled="backingUp">
              {{ backingUp ? 'Saving…' : '⬇ Backup Current' }}
            </button>
            <button class="btn btn-ghost btn-sm" @click="loadDefaultSettings">
              ↺ Load Defaults
            </button>
            <button class="btn btn-ghost btn-sm" @click="showRevertDialog = true" :disabled="goodConfigs.length === 0"
                    :title="goodConfigs.length === 0 ? 'No good configs saved yet' : ''">
              ⟲ Revert to Good
            </button>
            <button class="btn btn-ghost btn-sm" @click="router.push('/wizard')">
              ⊞ Re-run Wizard
            </button>
          </div>

          <div v-if="saveError" class="save-error">{{ saveError }}</div>

          <textarea v-if="editMode"
            class="config-preview config-edit"
            v-model="editedConfig"
          ></textarea>
          <pre v-else class="config-preview">{{ configPreview }}</pre>

          <!-- Revert dialog -->
          <div v-if="showRevertDialog" class="modal-overlay" @click.self="showRevertDialog = false">
            <div class="revert-dialog card">
              <div class="section-title">Revert to Good Config</div>
              <div class="revert-list">
                <button
                  v-for="cfg in goodConfigs"
                  :key="cfg.name"
                  class="revert-item"
                  @click="confirmRevert(cfg)"
                >
                  <span class="revert-name">{{ cfg.label }}</span>
                  <span class="revert-date">{{ cfg.date }}</span>
                </button>
              </div>
              <button class="btn btn-ghost btn-sm" style="margin-top:12px;width:100%"
                      @click="showRevertDialog = false">Cancel</button>
            </div>
          </div>

          <!-- Revert confirm dialog -->
          <div v-if="revertTarget" class="modal-overlay" @click.self="revertTarget = null">
            <div class="revert-dialog card">
              <div class="section-title">Confirm Revert</div>
              <p class="section-note">
                Revert to <strong>{{ revertTarget.label }}</strong>?<br>
                Current config will be replaced and Klipper will restart.
              </p>
              <div class="config-toolbar" style="margin-top:16px">
                <button class="btn btn-danger" :disabled="reverting" @click="doRevert">
                  {{ reverting ? 'Reverting…' : 'Yes, Revert' }}
                </button>
                <button class="btn btn-ghost" @click="revertTarget = null">Cancel</button>
              </div>
            </div>
          </div>
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
import { useSettingsStore, defaultSettings } from '../stores/settings.js'
import { useTestPins } from '../composables/useTestPins.js'
import { saveBakesailCfg, ensurePrinterCfgInclude, generateBakesailCfg } from '../utils/configWriter.js'
import { useMoonraker } from '../composables/useMoonraker.js'

const router   = useRouter()
const settings = useSettingsStore()
const { isTestPin, toggleTestPin } = useTestPins(settings)
const { runGcode } = useMoonraker()

const activeSection = ref('device')
const saving        = ref(false)
const saveError     = ref('')
const applying      = ref(false)
const applyError    = ref('')
const applySuccess  = ref(false)

// ── View Current Config ──────────────────────────────────────────────
const currentCfg        = ref('')
const currentCfgLoading = ref(false)
const markedGood        = ref(false)
const markingGood       = ref(false)
const markGoodMsg       = ref('')

async function loadCurrentCfg() {
  currentCfgLoading.value = true
  try {
    const res = await fetch('/server/files/config/bakesail.cfg')
    if (res.ok) currentCfg.value = await res.text()
  } catch (e) { console.warn('Could not load bakesail.cfg:', e) }
  finally { currentCfgLoading.value = false }
}

async function markAsGood() {
  markingGood.value = true
  markGoodMsg.value = ''
  try {
    const now      = new Date()
    const pad      = n => String(n).padStart(2, '0')
    const stamp    = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`
    const filename = `bakesail_${stamp}_good.cfg`
    const blob     = new Blob([currentCfg.value], { type: 'text/plain' })
    const form     = new FormData()
    form.append('file', blob, filename)
    form.append('root', 'config')
    const res = await fetch('/server/files/upload', { method: 'POST', body: form })
    if (!res.ok) throw new Error('Upload failed')
    markedGood.value  = true
    markGoodMsg.value = `Saved as ${filename}`
    await loadGoodConfigs()
  } catch (e) {
    markGoodMsg.value = 'Error: ' + e.message
  } finally { markingGood.value = false }
}

// ── Write Config ─────────────────────────────────────────────────────
const editMode     = ref(false)
const editedConfig = ref('')
const backingUp    = ref(false)

// Watch configPreview and seed editedConfig when edit mode opens
function startEdit() {
  editedConfig.value = configPreview.value
  editMode.value = true
}

async function backupConfig() {
  backingUp.value = true
  try {
    const res = await fetch('/server/files/config/bakesail.cfg')
    if (!res.ok) throw new Error('Could not read config')
    const text  = await res.text()
    const now   = new Date()
    const pad   = n => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`
    const fname = `bakesail_${stamp}_backup.cfg`
    const blob  = new Blob([text], { type: 'text/plain' })
    const form  = new FormData()
    form.append('file', blob, fname)
    form.append('root', 'config')
    const up = await fetch('/server/files/upload', { method: 'POST', body: form })
    if (!up.ok) throw new Error('Upload failed')
    saveError.value = ''
    applySuccess.value = true
    setTimeout(() => applySuccess.value = false, 3000)
  } catch (e) { saveError.value = e.message }
  finally { backingUp.value = false }
}

function loadDefaultSettings() {
  if (!confirm('Reset all settings to defaults? This does not restart Klipper until you Apply.')) return
  Object.assign(settings.$state, defaultSettings())
}

// ── Good configs / revert ────────────────────────────────────────────
const goodConfigs      = ref([])
const showRevertDialog = ref(false)
const revertTarget     = ref(null)
const reverting        = ref(false)

async function loadGoodConfigs() {
  try {
    const res   = await send('server.files.list', { root: 'config' })
    goodConfigs.value = res
      .filter(f => f.path?.endsWith('_good.cfg'))
      .map(f => {
        const name  = f.path.replace('.cfg', '')
        // Extract timestamp from bakesail_YYYY-MM-DD_HH-MM_good
        const match = name.match(/(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2})/)
        const date  = match ? `${match[1]} ${match[2].replace('-', ':')}` : name
        return { name: f.path, label: name, date }
      })
      .sort((a, b) => b.name.localeCompare(a.name))  // newest first
  } catch (e) { console.warn('Could not load good configs:', e) }
}

function confirmRevert(cfg) {
  revertTarget.value = cfg
  showRevertDialog.value = false
}

async function doRevert() {
  if (!revertTarget.value) return
  reverting.value = true
  try {
    // Read the good config file
    const res = await fetch(`/server/files/config/${revertTarget.value.name}`)
    if (!res.ok) throw new Error('Could not read config file')
    const text = await res.text()

    // Write it as bakesail.cfg
    const blob = new Blob([text], { type: 'text/plain' })
    const form = new FormData()
    form.append('file', blob, 'bakesail.cfg')
    form.append('root', 'config')
    const up = await fetch('/server/files/upload', { method: 'POST', body: form })
    if (!up.ok) throw new Error('Could not write config')

    revertTarget.value = null
    await runGcode('FIRMWARE_RESTART')
  } catch (e) {
    saveError.value = e.message
  } finally { reverting.value = false }
}

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
  { id: 'current',      label: 'View Current Config' },
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
  applying.value     = true
  applyError.value   = ''
  applySuccess.value = false
  try {
    if (editMode.value && editedConfig.value) {
      // User edited manually — write exactly what's in the editor
      const blob = new Blob([editedConfig.value], { type: 'text/plain' })
      const form = new FormData()
      form.append('file', blob, 'bakesail.cfg')
      form.append('root', 'config')
      const res = await fetch('/server/files/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error('Config upload failed')
    } else {
      await saveBakesailCfg(settings.$state)
    }
    await settings.save()
    await ensurePrinterCfgInclude()
    await runGcode('FIRMWARE_RESTART')
    editMode.value     = false
    applySuccess.value = true
    setTimeout(() => { applySuccess.value = false }, 4000)
  } catch (e) {
    applyError.value = e.message
  } finally {
    applying.value = false
  }
}

onMounted(() => {
  settings.load()
  loadCurrentCfg()
  loadGoodConfigs()
})
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

.config-toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.config-edit {
  width: 100%;
  resize: vertical;
  min-height: 320px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-dim);
  background: var(--surface-2);
  border: 1px solid var(--amber-dim);
  border-radius: var(--radius);
  padding: 14px;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.revert-dialog {
  width: 420px;
  max-height: 70vh;
  overflow-y: auto;
}

.revert-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
}

.revert-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
  text-align: left;
  width: 100%;
}
.revert-item:hover { border-color: var(--amber); background: var(--amber-glow); }
.revert-name { font-family: var(--font-mono); font-size: 12px; color: var(--text); }
.revert-date { font-size: 11px; color: var(--text-muted); }

.test-pin-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
  padding: 4px 8px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-2);
  transition: color 0.12s, border-color 0.12s, background 0.12s;
  flex-shrink: 0;
  user-select: none;
}
.test-pin-label input[type="checkbox"] { margin: 0; accent-color: var(--teal); }
.test-pin-label:hover { color: var(--teal); border-color: var(--teal); }
.test-pin-label.active { color: var(--teal); border-color: var(--teal); background: var(--teal-glow); }
</style>
