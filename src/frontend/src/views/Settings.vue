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
              <option value="laser_plotter">Laser Plotter / Cutter</option>
              <option value="3d_printer">3D Printer</option>
            </select>
          </div>
          <template v-if="settings.deviceType === '3d_printer'">
            <div class="field-row">
              <label class="field-label">Kinematics</label>
              <span class="field-readonly">{{ detectedKinematics || '—' }}</span>
              <span class="section-note" style="margin:0 0 0 8px">detected from Klipper config</span>
            </div>
          </template>
        </template>

        <!-- Zones -->
        <template v-else-if="activeSection === 'zones'">
          <div class="section-title">Heater Zones</div>
          <p class="section-note">Up to 8 zones. Zone type controls position on the dashboard.</p>
          <div class="item-list">
            <div v-for="zone in settings.zones" :key="zone.id" class="item-row item-row--wrap zone-row">
              <!-- Label + type -->
              <div class="item-num">{{ zone.id }}</div>
              <input class="field-input" v-model="zone.label" style="width:100px;flex:none" placeholder="Zone label" />
              <select class="field-select" v-model="zone.type" style="width:120px;flex:none">
                <option v-for="zt in zoneTypes" :key="zt.value" :value="zt.value">{{ zt.label }}</option>
              </select>

              <!-- Heater pin -->
              <label class="field-label-inline" style="margin-left:4px">Heater</label>
              <template v-if="!zone.deferred">
                <input class="field-input field-input--pin" v-model="zone.pin" placeholder="e.g. PA2" />
                <label class="test-pin-label" :class="{ active: isTestPin(zone.pin) }">
                  <input type="checkbox" :checked="isTestPin(zone.pin)"
                    @change="zone.pin = toggleTestPin(zone.pin)" />
                  Test
                </label>
              </template>
              <label class="field-label-inline">
                <input type="checkbox" v-model="zone.deferred" /> Stepper slot
              </label>

              <!-- TC selection -->
              <label class="field-label-inline" style="margin-left:4px">TC</label>
              <select class="field-select tc-select"
                v-model="zone.tcId"
                @change="settings.onZoneTcChange(zone)">
                <option :value="null">None</option>
                <option v-for="tc in settings.thermocouples" :key="tc.id" :value="tc.id">
                  {{ tc.label }}
                </option>
              </select>
              <input class="field-input field-input--pin" v-model="zone.sensorPin"
                     :placeholder="zone.tcId ? 'auto' : 'manual pin'" />

              <button class="item-remove" @click="settings.removeZone(zone.id)"
                      :disabled="settings.zones.length <= 1">×</button>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" @click="settings.addZone()"
                  style="margin-top:12px" :disabled="settings.zones.length >= 8">
            + Add Zone {{ settings.zones.length >= 8 ? '(max 8)' : '' }}
          </button>
        </template>

        <!-- Thermocouples -->
        <template v-else-if="activeSection === 'tc'">
          <div class="section-title">K-type Thermocouples (MAX31855)</div>
          <p class="section-note">
            Each TC needs only its unique CS/sensor pin. SCK, MISO and MOSI
            are shared across all TCs on the same SPI bus — configure them below.
          </p>

          <div class="item-list">
            <div v-for="tc in settings.thermocouples" :key="tc.id" class="item-row">
              <div class="item-num">{{ tc.id }}</div>
              <input class="field-input" v-model="tc.label" style="width:90px;flex:none"
                     placeholder="TC label" />
              <span class="field-label-inline">CS/Pin</span>
              <input class="field-input field-input--pin" v-model="tc.pin" placeholder="e.g. PF3" />
              <label class="test-pin-label" :class="{ active: isTestPin(tc.pin) }">
                <input type="checkbox" :checked="isTestPin(tc.pin)"
                  @change="tc.pin = toggleTestPin(tc.pin)" />
                Test
              </label>
              <button class="item-remove" @click="settings.removeTc(tc.id)"
                      :disabled="settings.thermocouples.length <= 1">×</button>
            </div>
          </div>

          <button class="btn btn-ghost btn-sm" @click="settings.addTc()" style="margin-top:12px">
            + Add K-type TC
          </button>

          <div class="section-title" style="margin-top:24px">SPI Bus (shared by all TCs)</div>
          <p class="section-note">
            Octopus Pro: SCK = PF0, MISO = PF1 · SKR Mini E3: SCK = PB13, MISO = PB14
          </p>
          <div class="item-list" style="margin-top:8px">
            <div class="item-row">
              <span class="field-label-inline" style="width:50px">SCK</span>
              <input class="field-input field-input--pin" v-model="settings.spiSettings.sckPin" placeholder="PF0" />
              <label class="test-pin-label" :class="{ active: isTestPin(settings.spiSettings.sckPin) }">
                <input type="checkbox" :checked="isTestPin(settings.spiSettings.sckPin)"
                  @change="settings.spiSettings.sckPin = toggleTestPin(settings.spiSettings.sckPin)" />
                Test
              </label>
            </div>
            <div class="item-row">
              <span class="field-label-inline" style="width:50px">MISO</span>
              <input class="field-input field-input--pin" v-model="settings.spiSettings.misoPin" placeholder="PF1" />
              <label class="test-pin-label" :class="{ active: isTestPin(settings.spiSettings.misoPin) }">
                <input type="checkbox" :checked="isTestPin(settings.spiSettings.misoPin)"
                  @change="settings.spiSettings.misoPin = toggleTestPin(settings.spiSettings.misoPin)" />
                Test
              </label>
            </div>
            <div class="item-row">
              <span class="field-label-inline" style="width:50px">MOSI</span>
              <input class="field-input field-input--pin" v-model="settings.spiSettings.mosiPin" placeholder="PA7" />
              <span class="section-note" style="margin:0">(MAX31855 unused — any spare pin)</span>
            </div>
          </div>
        </template>

        <!-- Fans -->
        <template v-else-if="activeSection === 'fans'">
          <div class="section-title">Fans</div>
          <!-- 3D printer: read-only info from Klipper -->
          <template v-if="is3dPrinter">
            <p class="section-note">Fans detected from Klipper. Edit definitions in <strong>Edit Config</strong>.</p>
            <div v-if="printerFanInfo.length === 0" class="section-note" style="margin-top:12px">
              No fans found. Ensure Klipper is connected.
            </div>
            <div v-else class="info-card-list">
              <div v-for="f in printerFanInfo" :key="f.key" class="info-card">
                <div class="info-card-header">
                  <span class="info-card-name">{{ f.name }}</span>
                  <span class="info-card-badge">{{ f.type }}</span>
                  <span class="info-card-live">{{ f.speed }}<span v-if="f.rpm"> · {{ f.rpm }}</span></span>
                </div>
                <div class="info-card-body">
                  <div class="info-row"><span class="info-label">Pin</span><code>{{ f.pin }}</code></div>
                  <div v-if="f.heater"    class="info-row"><span class="info-label">Heater</span><code>{{ f.heater }}</code></div>
                  <div v-if="f.sensor"    class="info-row"><span class="info-label">Sensor</span><span class="info-val">{{ f.sensor }}</span></div>
                  <div v-if="f.maxPower"  class="info-row"><span class="info-label">Max Power</span><span class="info-val">{{ Math.round(f.maxPower * 100) }}%</span></div>
                  <div v-if="f.kickStart" class="info-row"><span class="info-label">Kick Start</span><span class="info-val">{{ f.kickStart }}s</span></div>
                  <div v-if="f.offBelow"  class="info-row"><span class="info-label">Off Below</span><span class="info-val">{{ Math.round(f.offBelow * 100) }}%</span></div>
                  <div class="info-row"><span class="info-label">Config</span><span class="info-val info-val--file">{{ f.configFile }}</span></div>
                </div>
              </div>
            </div>
          </template>
          <!-- Other device types: original editable UI -->
          <template v-else>
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

        <!-- Illumination / Lights -->
        <template v-else-if="activeSection === 'illumination'">
          <div class="section-title">{{ is3dPrinter ? 'Lights' : 'Illumination' }}</div>
          <!-- 3D printer: read-only info from Klipper -->
          <template v-if="is3dPrinter">
            <p class="section-note">LEDs detected from Klipper. Edit definitions in <strong>Edit Config</strong>.</p>
            <div v-if="printerLedInfo.length === 0" class="section-note" style="margin-top:12px">
              No LEDs found. Ensure Klipper is connected.
            </div>
            <div v-else class="info-card-list">
              <div v-for="l in printerLedInfo" :key="l.key" class="info-card">
                <div class="info-card-header">
                  <span class="info-card-name">{{ l.name }}</span>
                  <span class="info-card-badge">{{ l.type }}</span>
                </div>
                <div class="info-card-body">
                  <div class="info-row"><span class="info-label">Pin</span><code>{{ l.pin }}</code></div>
                  <div v-if="l.chainCount" class="info-row"><span class="info-label">LED Count</span><span class="info-val">{{ l.chainCount }}</span></div>
                  <div v-if="l.colorOrder" class="info-row"><span class="info-label">Color Order</span><span class="info-val">{{ l.colorOrder }}</span></div>
                  <div v-if="l.initialRed != null" class="info-row">
                    <span class="info-label">Initial Color</span>
                    <span class="info-val">
                      R:{{ l.initialRed }} G:{{ l.initialGreen }} B:{{ l.initialBlue }}
                      <span v-if="l.initialWhite != null"> W:{{ l.initialWhite }}</span>
                    </span>
                  </div>
                  <div class="info-row"><span class="info-label">Config</span><span class="info-val info-val--file">{{ l.configFile }}</span></div>
                </div>
              </div>
            </div>
          </template>
          <!-- Other device types: original editable UI -->
          <template v-else>
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
        </template>

        <!-- Cameras -->
        <!-- Laser -->
        <template v-else-if="activeSection === 'laser'">
          <div class="section-title">Laser Plotter / Cutter</div>
          <p class="section-note">
            Pin configuration for a CO2 or diode laser controlled via PWM. The
            <code>laser_pwm</code> output pin name is used by Bakesail macros and
            the Job Queue — keep it as-is unless you edit the macros manually.
          </p>

          <div class="item-list" style="margin-top:14px">

            <div class="item-row">
              <span class="field-label" style="width:130px">PWM Pin</span>
              <input class="field-input field-input--pin" v-model="settings.laser.pwmPin" placeholder="e.g. PA8" />
              <label class="test-pin-label" :class="{ active: isTestPin(settings.laser.pwmPin) }">
                <input type="checkbox" :checked="isTestPin(settings.laser.pwmPin)"
                  @change="settings.laser.pwmPin = toggleTestPin(settings.laser.pwmPin)" />
                Test
              </label>
              <span class="section-note" style="margin:0">→ Moonraker output_pin <code>laser_pwm</code></span>
            </div>

            <div class="item-row">
              <span class="field-label" style="width:130px">Enable / Interlock Pin</span>
              <input class="field-input field-input--pin" v-model="settings.laser.enablePin" placeholder="e.g. PB0" />
              <label class="test-pin-label" :class="{ active: isTestPin(settings.laser.enablePin) }">
                <input type="checkbox" :checked="isTestPin(settings.laser.enablePin)"
                  @change="settings.laser.enablePin = toggleTestPin(settings.laser.enablePin)" />
                Test
              </label>
              <span class="section-note" style="margin:0">TH / WP line on LPS — optional</span>
            </div>

            <div class="item-row">
              <span class="field-label" style="width:130px">Air Assist Pin</span>
              <input class="field-input field-input--pin" v-model="settings.laser.airAssistPin" placeholder="e.g. PC5" />
              <label class="test-pin-label" :class="{ active: isTestPin(settings.laser.airAssistPin) }">
                <input type="checkbox" :checked="isTestPin(settings.laser.airAssistPin)"
                  @change="settings.laser.airAssistPin = toggleTestPin(settings.laser.airAssistPin)" />
                Test
              </label>
              <span class="section-note" style="margin:0">Relay to compressor — optional</span>
            </div>

          </div>

          <div class="item-list" style="margin-top:20px">
            <div class="section-title" style="margin-bottom:10px">PWM & Bed</div>

            <div class="field-row">
              <label class="field-label">PWM Freq (Hz)</label>
              <input class="field-input" type="number" v-model.number="settings.laser.pwmFrequency"
                     min="100" max="5000" style="width:100px;flex:none" />
              <span class="section-note" style="margin:0">Typical CO2 LPS: 1 000–5 000 Hz</span>
            </div>

            <div class="field-row">
              <label class="field-label">Max Power (%)</label>
              <input class="field-input" type="number" v-model.number="settings.laser.maxPower"
                     min="1" max="100" style="width:80px;flex:none" />
              <span class="section-note" style="margin:0">Hard ceiling applied in macros</span>
            </div>

            <div class="field-row">
              <label class="field-label">Bed Width (mm)</label>
              <input class="field-input" type="number" v-model.number="settings.laser.bedWidth"
                     min="1" style="width:100px;flex:none" />
            </div>

            <div class="field-row">
              <label class="field-label">Bed Height (mm)</label>
              <input class="field-input" type="number" v-model.number="settings.laser.bedHeight"
                     min="1" style="width:100px;flex:none" />
            </div>

            <div class="field-row">
              <label class="field-label">SVG Origin</label>
              <select class="field-select" v-model="settings.laser.originCorner" style="width:160px;flex:none">
                <option value="bottom-left">Bottom-left (machine home)</option>
                <option value="top-left">Top-left (SVG default)</option>
                <option value="center">Center of bed</option>
              </select>
            </div>
          </div>
        </template>

        <!-- Cameras -->
        <template v-else-if="activeSection === 'cameras'">
          <div class="section-title">Cameras</div>
          <p class="section-note">
            Add each USB camera individually. Run <code>ls /dev/video*</code> over SSH to list connected video devices.
            <template v-if="!is3dPrinter">Use the TEST button to add a placeholder camera with no real device — useful for dashboard layout without hardware.</template>
          </p>

          <div class="item-list" style="margin-top:14px">
            <div v-for="cam in settings.cameras" :key="cam.id" class="item-row item-row--wrap cam-row">
              <!-- Device dropdown -->
              <select class="field-select cam-device-select" v-model="cam.device" v-if="!cam.test">
                <option value="">— select device —</option>
                <option v-for="d in availableVideoDevices" :key="d" :value="d">{{ d }}</option>
                <option value="__manual__">Enter manually…</option>
              </select>
              <input v-if="!cam.test && cam.device === '__manual__'"
                     class="field-input field-input--pin" v-model="cam.deviceManual"
                     placeholder="/dev/video0" style="width:120px;flex:none" />
              <span v-if="cam.test" class="cam-test-badge">TEST</span>

              <!-- Type dropdown — 3d_printer has its own set -->
              <select class="field-select cam-type-select" v-model="cam.type"
                      @change="onCamTypeChange(cam)">
                <template v-if="is3dPrinter">
                  <option value="printer">Printer</option>
                  <option value="nozzle">Nozzle</option>
                  <option value="bed">Bed</option>
                  <option value="filament">Filament</option>
                  <option value="door">Door</option>
                  <option value="custom">Custom</option>
                </template>
                <template v-else>
                  <option value="bga_grid">BGA Grid</option>
                  <option value="alignment_chip">Alignment - Chip</option>
                  <option value="alignment_board">Alignment - Board</option>
                  <option value="custom">Custom</option>
                </template>
              </select>

              <!-- Name input — only for 'custom' type -->
              <input v-if="cam.type === 'custom'" class="field-input cam-name-input" v-model="cam.name"
                     placeholder="Custom name…" />

              <!-- Crowsnest gear (3d_printer only, non-test cameras) -->
              <CrowsnestSettingsPopover v-if="!cam.test" :cam="cam" />

              <button class="item-remove" @click="settings.removeCamera(cam.id)">×</button>
            </div>

            <div v-if="settings.cameras.length === 0" class="section-note" style="margin-top:4px">
              No cameras added yet.
            </div>
          </div>

          <div style="display:flex;gap:10px;margin-top:14px">
            <button class="btn btn-ghost btn-sm" @click="settings.addCamera(false)">+ Add Camera</button>
            <button v-if="!is3dPrinter" class="btn btn-ghost btn-sm" @click="settings.addCamera(true)">+ TEST Camera</button>
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

        <!-- Dashboard -->
        <template v-else-if="activeSection === 'dashboard_prefs'">
          <div class="section-title">Dashboard Preferences</div>
          <p class="section-note">Controls behaviour when customizing dashboard layouts.</p>
          <div class="field-row" style="margin-top:14px">
            <label class="field-label">Grid Snap</label>
            <label class="field-label-inline">
              <input type="checkbox" v-model="settings.dashboardGridSnap" />
              Snap widgets to grid while dragging/resizing
            </label>
          </div>
          <div class="field-row">
            <label class="field-label">Grid Size (px)</label>
            <input class="field-input" type="number" v-model.number="settings.dashboardGridSize"
                   min="4" max="80" style="width:80px;flex:none"
                   :disabled="!settings.dashboardGridSnap" />
            <span class="section-note" style="margin:0">Default 20px — smaller = finer control</span>
          </div>
        </template>

        <!-- Edit Config -->
        <template v-else-if="activeSection === 'config'">
          <ConfigEditor class="ce-settings-embed" />
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
import { useSettingsStore, defaultSettings, ZONE_TYPES } from '../stores/settings.js'
import { useTestPins } from '../composables/useTestPins.js'
import { saveBakesailCfg, ensurePrinterCfgInclude, generateBakesailCfg } from '../utils/configWriter.js'
import { useMoonraker } from '../composables/useMoonraker.js'
import { useDeviceStore } from '../stores/device.js'
import { cameraTypeLabel } from '../utils/cameraTypes.js'
import CrowsnestSettingsPopover from '../components/CrowsnestSettingsPopover.vue'
import ConfigEditor from '../components/ConfigEditor.vue'

const router   = useRouter()
const settings = useSettingsStore()
const { isTestPin, toggleTestPin } = useTestPins(settings)
const deviceStore = useDeviceStore()

// Klipper configfile sections — fetched on mount for 3d_printer info panels
const klipperCfg = ref({})
const zoneTypes = ZONE_TYPES

// ── Camera helpers ─────────────────────────────────────────────
function camTypeLabel(type) { return cameraTypeLabel(type) }
function onCamTypeChange(cam) { if (cam.type !== 'custom') cam.name = '' }

// Probe /dev/video* devices via a simple fetch to Moonraker's system info,
// falling back to a static list of common paths if unavailable.
const availableVideoDevices = ref(['/dev/video0', '/dev/video1', '/dev/video2', '/dev/video3'])
onMounted(async () => {
  // Detect printer kinematics + fetch full configfile for info panels
  try {
    const r = await send('printer.objects.query', { objects: { configfile: ['config'] } })
    const cfg = r?.status?.configfile?.config ?? {}
    klipperCfg.value = cfg
    const kin = cfg?.printer?.kinematics
    if (kin) detectedKinematics.value = kin.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  } catch { /* not critical */ }
  try {
    const res = await fetch('/server/system_info')
    if (res.ok) {
      const data = await res.json()
      // Moonraker may expose available_services or similar — best effort
      // For now, static list is the safe fallback
    }
  } catch { /* stay with defaults */ }
})
const { send, sendGcode } = useMoonraker()

const activeSection      = ref('device')
const saving             = ref(false)
const saveError          = ref('')
const applying           = ref(false)
const detectedKinematics = ref('')

// ── 3D Printer fan/LED info panels ────────────────────────────────────────────
// Enumerate live objects from dynamicObjects, enrich with configfile pin data
const printerFanInfo = computed(() => {
  return Object.entries(deviceStore.dynamicObjects)
    .filter(([k]) => k.startsWith('heater_fan ') || k.startsWith('fan_generic ') || k.startsWith('temperature_fan '))
    .map(([key, val]) => {
      const cfgSection = klipperCfg.value[key] ?? {}
      return {
        key,
        type: key.startsWith('heater_fan ') ? 'Heater Fan'
            : key.startsWith('temperature_fan ') ? 'Temperature Fan'
            : 'Generic Fan',
        name: key.replace(/^(heater_fan |fan_generic |temperature_fan )/, ''),
        speed: val.speed != null ? Math.round(val.speed * 100) + '%' : '—',
        rpm:   val.rpm  != null ? val.rpm + ' RPM' : null,
        pin:        cfgSection.pin        ?? cfgSection.fan_pin   ?? '—',
        heater:     cfgSection.heater     ?? null,
        sensor:     cfgSection.sensor_type ?? cfgSection.sensor    ?? null,
        maxPower:   cfgSection.max_power   ?? null,
        kickStart:  cfgSection.kick_start_time ?? null,
        offBelow:   cfgSection.off_below   ?? null,
        configFile: cfgSection.__source__  ?? findCfgSource(key),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
})

const printerLedInfo = computed(() => {
  return Object.entries(deviceStore.dynamicObjects)
    .filter(([k]) => k.startsWith('neopixel ') || k.startsWith('led '))
    .map(([key, val]) => {
      const cfgSection = klipperCfg.value[key] ?? {}
      const isNeo = key.startsWith('neopixel ')
      return {
        key,
        type: isNeo ? 'NeoPixel' : 'LED',
        name: key.replace(/^(neopixel |led )/, ''),
        pin:        cfgSection.pin         ?? cfgSection.data_pin  ?? '—',
        chainCount: cfgSection.chain_count  ?? null,
        colorOrder: cfgSection.color_order  ?? null,
        initialRed:   cfgSection.initial_red   ?? null,
        initialGreen: cfgSection.initial_green ?? null,
        initialBlue:  cfgSection.initial_blue  ?? null,
        initialWhite: cfgSection.initial_white ?? null,
        configFile: findCfgSource(key),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
})

// Moonraker configfile doesn't expose __source__ by default.
// We can infer by checking if the section exists in known include files.
// For now fall back to 'printer.cfg' as most likely source.
function findCfgSource(key) {
  // A future enhancement could cross-reference with file list.
  return 'printer.cfg'
}
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
    await sendGcode('FIRMWARE_RESTART')
  } catch (e) {
    saveError.value = e.message
  } finally { reverting.value = false }
}

const isLaser     = computed(() => settings.deviceType === 'laser_plotter')
const is3dPrinter = computed(() => settings.deviceType === '3d_printer')

const sections = computed(() => {
  const base = [
    { id: 'device',       label: 'Device' },
    ...(!isLaser.value && !is3dPrinter.value ? [
      { id: 'zones',        label: 'Heater Zones' },
      { id: 'tc',           label: 'Thermocouples' },
    ] : []),
    ...(isLaser.value ? [
      { id: 'laser',        label: 'Laser' },
    ] : []),
    { id: 'fans',         label: 'Fans' },
    ...(!isLaser.value && !is3dPrinter.value ? [
      { id: 'vacuum',       label: 'Vacuum' },
    ] : []),
    ...(!isLaser.value ? [
      { id: 'illumination', label: is3dPrinter.value ? 'Lights' : 'Illumination' },
    ] : []),
    { id: 'cameras',      label: 'Cameras' },
    ...(!is3dPrinter.value ? [
      { id: 'steppers',     label: 'Stepper Slots' },
      { id: 'movement',     label: 'Movement' },
    ] : []),
    { id: 'dashboard_prefs', label: 'Dashboard' },
    { id: 'config',           label: 'Edit Config' },
  ]
  return base
})

const configPreview = computed(() => generateBakesailCfg(settings.$state))

async function writeConfig() {
  saving.value    = true
  saveError.value = ''
  try {
    await saveBakesailCfg(settings.$state)
    await settings.save()
    await ensurePrinterCfgInclude(settings.deviceType)
    await sendGcode('FIRMWARE_RESTART')
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
    await ensurePrinterCfgInclude(settings.deviceType)
    await sendGcode('FIRMWARE_RESTART')
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
  display: flex;
  flex-direction: column;
}
/* ConfigEditor fills available space — remove padding when it's active */
.ce-settings-embed {
  margin: -20px;
  flex: 1;
  min-height: 0;
  border-radius: var(--radius-lg);
  overflow: hidden;
}

/* ── Info cards (3d printer fan/LED panels) ──────────────── */
.info-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}
.info-card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}
.info-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.info-card-name {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  flex: 1;
}
.info-card-badge {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--text-muted);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1px 6px;
}
.info-card-live {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--teal);
}
.info-card-body {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.info-label {
  width: 90px;
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 11px;
}
.info-row code {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--amber);
  background: var(--bg);
  padding: 1px 5px;
  border-radius: 3px;
}
.info-val { color: var(--text-dim); font-family: var(--font-mono); font-size: 11px; }
.info-val--file { color: var(--text-muted); font-style: italic; }

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
.field-readonly {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-dim);
  padding: 4px 8px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  white-space: nowrap;
}

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

.zone-row { gap: 6px; }
.tc-select { width: 90px; flex: none; }

.cam-row { gap: 8px; align-items: center; }
.cam-device-select { width: 160px; flex: none; }
.cam-type-select   { width: 170px; flex: none; }
.cam-name-input    { width: 140px; flex: none; }
.cam-test-badge {
  display: inline-flex; align-items: center;
  padding: 3px 8px;
  border-radius: var(--radius);
  border: 1px solid var(--teal);
  background: var(--teal-glow);
  color: var(--teal);
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.1em;
  white-space: nowrap;
  width: 160px; justify-content: center;
}

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
