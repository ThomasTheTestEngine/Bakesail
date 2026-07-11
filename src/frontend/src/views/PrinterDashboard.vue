<template>
  <div class="pd-root">

    <!-- ── Klippy not ready ──────────────────────────────────── -->
    <div v-if="klippyState !== 'ready'" class="pd-offline">
      <div class="pd-offline-dot"></div>
      <span>{{ klippyState === 'disconnected' ? 'Connecting to Klipper…' : 'Klipper ' + klippyState }}</span>
    </div>

    <!-- ── Customize shell (gear + toolbar) ──────────────────── -->
    <DashboardCustomizeBar :layout="layout" :widget-defs="WIDGET_DEFS" dashboard-id="printer" :get-default-layout="buildDefaultLayout" />

    <!-- ── Widget canvas ─────────────────────────────────────── -->
    <div class="dash-canvas" :style="canvasStyle" @click.self="layout.closeWidgetSettings()">

      <!-- Grid overlay -->
      <svg v-if="layout.customizeMode.value && settings.dashboardGridSnap"
           class="grid-overlay" aria-hidden="true">
        <defs>
          <pattern :id="`pgrid-${_uid}`"
                   :width="settings.dashboardGridSize" :height="settings.dashboardGridSize"
                   patternUnits="userSpaceOnUse">
            <path :d="`M ${settings.dashboardGridSize} 0 L 0 0 0 ${settings.dashboardGridSize}`"
                  fill="none" stroke="rgba(240,127,170,0.08)" stroke-width="0.5"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" :fill="`url(#pgrid-${_uid})`"/>
      </svg>

      <WidgetShell
        v-for="w in layout.widgets.value"
        :key="w.id"
        :widget="w"
        :customizeMode="layout.customizeMode.value"
        :settingsOpen="layout.openWidgetSettings.value === w.id"
        :widgetLabel="widgetLabel(w.type)"
        :allFields="widgetFields(w.type)"
        :defaultConfig="defaultConfig(w.type)"
        @startDrag="layout.startDrag"
        @startResize="layout.startResize"
        @remove="layout.removeWidget"
        @toggleSettings="layout.toggleWidgetSettings"
        @closeSettings="layout.closeWidgetSettings"
      >

        <!-- ── State Header ───────────────────────────────────── -->
        <template v-if="w.type === 'state'">
          <StatusHeaderWidget
            :color="stateColour"
            :label="stateLabel"
            :dot="false"
            label-class="ws-label--lg"
          >
            <div class="ws-filename" v-if="printer.filename && !isFieldHidden(w,'filename')">{{ printer.filename }}</div>
            <div class="ws-layer" v-if="printer.currentLayer && !isFieldHidden(w,'layer')">
              Layer {{ printer.currentLayer }}<span v-if="printer.totalLayers"> / {{ printer.totalLayers }}</span>
            </div>
          </StatusHeaderWidget>
        </template>

        <!-- ── Hotend Temperature ─────────────────────────────── -->
        <template v-else-if="w.type === 'hotend'">
          <div class="w-temp">
            <div class="wt-label">{{ w.config?.label || 'Hotend' }}</div>
            <div class="wt-value" :class="tempClass(printer.hotendTemp, printer.hotendTarget)">
              {{ printer.hotendTemp != null ? printer.hotendTemp.toFixed(1) : '—' }}°
            </div>
            <div class="wt-target" v-if="printer.hotendTarget > 0">
              <span class="wt-arrow">→</span> {{ printer.hotendTarget.toFixed(0) }}°
            </div>
            <div class="wt-power-bar" v-if="!isFieldHidden(w,'power')">
              <div class="wt-power-fill" :style="{ width: (printer.hotendPower * 100).toFixed(0) + '%' }"></div>
            </div>
            <div class="wt-off" v-if="printer.hotendTarget === 0">OFF</div>
          </div>
        </template>

        <!-- ── Bed Temperature ────────────────────────────────── -->
        <template v-else-if="w.type === 'bed'">
          <div class="w-temp">
            <div class="wt-label">{{ w.config?.label || 'Bed' }}</div>
            <div class="wt-value" :class="tempClass(printer.bedTemp, printer.bedTarget)">
              {{ printer.bedTemp != null ? printer.bedTemp.toFixed(1) : '—' }}°
            </div>
            <div class="wt-target" v-if="printer.bedTarget > 0">
              <span class="wt-arrow">→</span> {{ printer.bedTarget.toFixed(0) }}°
            </div>
            <div class="wt-power-bar" v-if="!isFieldHidden(w,'power')">
              <div class="wt-power-fill" :style="{ width: (printer.bedPower * 100).toFixed(0) + '%' }"></div>
            </div>
            <div class="wt-off" v-if="printer.bedTarget === 0">OFF</div>
          </div>
        </template>

        <!-- ── Temperature History chart ─────────────────────── -->
        <template v-else-if="w.type === 'chart'">
          <div class="w-monitor">
            <div class="wmon-chart-header">
              <span class="wmon-section-title">TEMPERATURE HISTORY</span>
              <div class="wmon-chart-controls">
                <!-- Gear opens combined series + time scale menu -->
                <div class="wmon-chart-gear-wrap" @click.stop>
                  <button class="wmon-chart-btn wmon-chart-gear" @click="toggleSeriesMenu(w.id)" title="Chart settings">⚙</button>
                  <div v-if="seriesMenuOpen === w.id" class="wmon-series-menu">
                    <!-- Time scale section -->
                    <div class="wmon-series-section">TIME SCALE</div>
                    <div class="wmon-timescale-row">
                      <button class="wmon-chart-btn" @click.stop="decreaseTimeWindow(w.id)">−</button>
                      <span class="wmon-chart-window">{{ chartWindowLabel(w.id) }}</span>
                      <button class="wmon-chart-btn" @click.stop="increaseTimeWindow(w.id)">+</button>
                    </div>
                    <!-- Series section -->
                    <div class="wmon-series-section">SERIES</div>
                    <div v-for="s in chartSeries(w.id)" :key="s.key" class="wmon-series-item">
                      <input type="checkbox" :checked="!hiddenSeries[w.id]?.[s.key]"
                             @change="toggleSeries(w.id, s.key, $event.target.checked)" />
                      <!-- Colour dot — click opens native colour picker -->
                      <label class="wmon-series-colour-wrap" :title="'Change colour for ' + s.label">
                        <span class="wmon-series-dot" :style="{ background: s.colour }"></span>
                        <input type="color" class="wmon-colour-input" :value="s.colour"
                               @input.stop="setSeriesColour(w.id, s.key, $event.target.value)" />
                      </label>
                      <span class="wmon-series-label">{{ s.label }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="wmon-chart-wrap" style="flex:1;min-height:0">
              <canvas :ref="el => { if (el) chartCanvases[w.id] = el }" style="width:100%;height:100%;display:block"></canvas>
            </div>
          </div>
        </template>

        <!-- ── Temperatures ──────────────────────────────────── -->
        <template v-else-if="w.type === 'temps'">
          <div class="w-monitor">
            <div class="wmon-section-header">
              <span class="wmon-section-title">TEMPERATURES</span>
              <button class="wmon-cooldown-btn" @click="sendGcode('TURN_OFF_HEATERS')" title="Turn off all heaters">❄ Cooldown</button>
            </div>
            <div class="wmon-sensor-grid">
              <!-- Extruder -->
              <div class="wmon-sensor-row wmon-sensor-row--heater">
                <span class="wmon-sensor-name">Extruder</span>
                <span class="wmon-heater-spacer"></span>
                <span class="wmon-heater-status" :class="printer.hotendTarget > 0 ? 'wmon-status--on' : 'wmon-status--off'">
                  {{ printer.hotendTarget > 0 ? 'ON' : 'OFF' }}
                </span>
                <input class="wmon-temp-input"
                       type="number" min="0" max="350" step="5"
                       v-model="hotendInput"
                       :placeholder="printer.hotendTarget > 0 ? printer.hotendTarget.toFixed(0) : '0'"
                       @keydown.enter.prevent="e => { setHotend(hotendInput); hotendInput = ''; e.target.blur() }"
                       @keydown.escape="e => { hotendInput = ''; e.target.blur() }" />
                <span class="wmon-sensor-val">{{ printer.hotendTemp?.toFixed(1) ?? '—' }}°C</span>
              </div>
              <!-- Bed -->
              <div class="wmon-sensor-row wmon-sensor-row--heater">
                <span class="wmon-sensor-name">Bed</span>
                <span class="wmon-heater-spacer"></span>
                <span class="wmon-heater-status" :class="printer.bedTarget > 0 ? 'wmon-status--on' : 'wmon-status--off'">
                  {{ printer.bedTarget > 0 ? 'ON' : 'OFF' }}
                </span>
                <input class="wmon-temp-input"
                       type="number" min="0" max="130" step="5"
                       v-model="bedInput"
                       :placeholder="printer.bedTarget > 0 ? printer.bedTarget.toFixed(0) : '0'"
                       @keydown.enter.prevent="e => { setBed(bedInput); bedInput = ''; e.target.blur() }"
                       @keydown.escape="e => { bedInput = ''; e.target.blur() }" />
                <span class="wmon-sensor-val">{{ printer.bedTemp?.toFixed(1) ?? '—' }}°C</span>
              </div>
              <!-- Dynamic temperature_sensor * (read-only, no target input) -->
              <div class="wmon-sensor-row" v-for="(obj, name) in tempSensors" :key="name">
                <span class="wmon-sensor-name">{{ name.replace('temperature_sensor ','') }}</span>
                <span class="wmon-sensor-val">{{ obj.temperature?.toFixed(1) ?? '—' }}°C</span>
                <span class="wmon-sensor-target" v-if="obj.target != null && obj.target > 0">→ {{ obj.target.toFixed(0) }}°</span>
              </div>
            </div>
          </div>
        </template>

        <!-- ── Misc: fans + LED controls ──────────────────────── -->
        <template v-else-if="w.type === 'fanlist'">
          <div class="w-monitor">
            <div class="wmon-section-title">MISC</div>
            <div class="wmon-sensor-grid">
              <!-- Part fan with slider -->
              <div class="wmon-sensor-row wmon-fan-row">
                <span class="wmon-sensor-name">Part Fan</span>
                <input class="wmon-fan-slider" type="range" min="0" max="100" step="1"
                       :value="Math.round((printer.fanSpeed ?? 0) * 100)"
                       @change="e => sendGcode(`M106 S${Math.round(+e.target.value * 2.55)}`)" />
                <span class="wmon-sensor-val">{{ printer.fanSpeed != null ? (printer.fanSpeed*100).toFixed(0)+'%' : '—' }}</span>
              </div>
              <!-- Other fans (read-only) -->
              <div class="wmon-sensor-row" v-for="(obj, name) in allFans" :key="name">
                <span class="wmon-sensor-name">{{ name.replace(/^(heater_fan |fan_generic |temperature_fan )/,'') }}</span>
                <span class="wmon-sensor-val">{{ obj.speed != null ? (obj.speed*100).toFixed(0)+'%' : '—' }}</span>
                <span class="wmon-sensor-target" v-if="obj.rpm != null">{{ Math.round(obj.rpm) }} RPM</span>
              </div>
              <!-- LED controls -->
              <div class="wmon-sensor-row" v-for="(obj, name) in ledObjects" :key="name">
                <span class="wmon-sensor-name">{{ name.replace(/^(neopixel |led )/,'') }}</span>
                <span class="wmon-heater-spacer"></span>
                <LedColorPicker
                  :led-name="name.replace(/^(neopixel |led )/,'')"
                  :r="ledRgbw(obj).r" :g="ledRgbw(obj).g" :b="ledRgbw(obj).b" :w="ledRgbw(obj).w"
                  :has-white="ledRgbw(obj).hasWhite"
                  @change="c => setLed(name, c)"
                />
              </div>
            </div>
          </div>
        </template>

        <!-- ── Lighting / LEDs ───────────────────────────────── -->
        <template v-else-if="w.type === 'lighting'">
          <div class="w-monitor">
            <div class="wmon-section-title">LIGHTING</div>
            <div v-if="Object.keys(ledObjects).length === 0" class="wmon-sensor-target" style="padding:4px 0">
              No LED / NeoPixel devices configured.
            </div>
            <div v-else class="wmon-sensor-grid">
              <div class="wmon-sensor-row" v-for="(obj, name) in ledObjects" :key="name">
                <span class="wmon-sensor-name">{{ name.replace(/^(neopixel |led )/,'') }}</span>
                <div class="wmon-led-swatches">
                  <div v-for="(color, i) in (obj.color_data ?? [])" :key="i" class="wmon-led-swatch"
                       :style="{ background: `rgb(${Math.round(color[0]*255)},${Math.round(color[1]*255)},${Math.round(color[2]*255)})` }">
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- ── Print Progress ─────────────────────────────────── -->
        <template v-else-if="w.type === 'progress'">
          <div class="w-progress">
            <div class="wp-filename">{{ printer.filename || 'No file loaded' }}</div>
            <div class="wp-bar-track">
              <div class="wp-bar-fill" :style="{ width: (printer.progress * 100).toFixed(1) + '%' }"></div>
            </div>
            <div class="wp-stats">
              <span class="wp-pct">{{ (printer.progress * 100).toFixed(1) }}%</span>
              <span class="wp-time" v-if="!isFieldHidden(w,'time') && printer.printDuration > 0">{{ formatDuration(printer.printDuration) }}</span>
              <span class="wp-eta"  v-if="!isFieldHidden(w,'eta') && printer.progress > 0 && printer.progress < 1">ETA {{ formatEta(printer.printDuration, printer.progress) }}</span>
            </div>
            <div class="wp-filament" v-if="!isFieldHidden(w,'filament') && printer.filamentUsed > 0">
              {{ (printer.filamentUsed / 1000).toFixed(2) }}m used
            </div>
          </div>
        </template>

        <!-- ── Fan Speed ──────────────────────────────────────── -->
        <template v-else-if="w.type === 'fan'">
          <div class="w-fan">
            <div class="wf-label">{{ w.config?.label || 'Part Fan' }}</div>
            <div class="wf-value" :class="{ 'wf-off': printer.fanSpeed === 0 }">
              {{ printer.fanSpeed != null ? (printer.fanSpeed * 100).toFixed(0) + '%' : '—' }}
            </div>
            <div class="wf-bar-track">
              <div class="wf-bar-fill" :style="{ width: (printer.fanSpeed * 100).toFixed(0) + '%' }"></div>
            </div>
          </div>
        </template>

        <!-- ── Speed / Flow ───────────────────────────────────── -->
        <template v-else-if="w.type === 'speedflow'">
          <div class="w-extruder">

            <!-- Extrusion factor -->
            <div class="wex-section">
              <div class="wex-header">
                <span class="wex-icon">⬇</span>
                <span class="wex-label">Extrusion factor</span>
                <span class="wex-pct">{{ Math.round(printer.extrudeFactor * 100) }} %</span>
              </div>
              <div class="wex-slider-row">
                <button class="btn btn-ghost btn-xs wex-adj" @click="sendGcode(`M221 S${Math.max(10,Math.round(printer.extrudeFactor*100)-10)}`)">−</button>
                <input type="range" class="wex-slider" min="10" max="200" step="1"
                       :value="Math.round(printer.extrudeFactor * 100)"
                       @input="sendGcode(`M221 S${$event.target.value}`)" />
                <button class="btn btn-ghost btn-xs wex-adj" @click="sendGcode(`M221 S${Math.min(200,Math.round(printer.extrudeFactor*100)+10)}`)">+</button>
              </div>
            </div>

            <div class="wex-divider"></div>

            <!-- Pressure Advance + Smooth Time -->
            <div class="wex-two-col">
              <div class="wex-field-wrap">
                <div class="wex-field-label">Pressure Advance</div>
                <div class="wex-field-row">
                  <div class="wex-field-box">
                    <input class="wex-input" type="number" step="0.001" min="0"
                           v-model.number="printer.pressureAdvance"
                           @change="setPressureAdvance" />
                    <span class="wex-unit">s</span>
                  </div>
                  <div class="wex-steppers">
                    <button class="wex-step" @click="printer.pressureAdvance = +(printer.pressureAdvance+0.005).toFixed(4); setPressureAdvance()">▲</button>
                    <button class="wex-step" @click="printer.pressureAdvance = +(Math.max(0,printer.pressureAdvance-0.005)).toFixed(4); setPressureAdvance()">▼</button>
                  </div>
                </div>
              </div>
              <div class="wex-field-wrap">
                <div class="wex-field-label">Smooth Time</div>
                <div class="wex-field-row">
                  <div class="wex-field-box">
                    <input class="wex-input" type="number" step="0.001" min="0"
                           v-model.number="printer.smoothTime"
                           @change="setPressureAdvance" />
                    <span class="wex-unit">s</span>
                  </div>
                  <div class="wex-steppers">
                    <button class="wex-step" @click="printer.smoothTime = +(printer.smoothTime+0.005).toFixed(4); setPressureAdvance()">▲</button>
                    <button class="wex-step" @click="printer.smoothTime = +(Math.max(0,printer.smoothTime-0.005)).toFixed(4); setPressureAdvance()">▼</button>
                  </div>
                </div>
              </div>
            </div>

            <div class="wex-divider"></div>

            <!-- Filament length + feedrate -->
            <div class="wex-two-col">
              <div class="wex-field-wrap">
                <div class="wex-field-label">Filament Length</div>
                <div class="wex-field-row">
                  <div class="wex-field-box">
                    <input class="wex-input" type="number" step="1" min="1" v-model.number="printer.extrudeLen" />
                    <span class="wex-unit">mm</span>
                  </div>
                  <div class="wex-steppers">
                    <button class="wex-step" @click="printer.extrudeLen = Math.min(500, printer.extrudeLen+1)">▲</button>
                    <button class="wex-step" @click="printer.extrudeLen = Math.max(1,   printer.extrudeLen-1)">▼</button>
                  </div>
                </div>
                <div class="wex-presets">
                  <button v-for="v in [50,25,10,5,1]" :key="v" class="btn btn-ghost btn-xs"
                          :class="{ 'wex-preset--active': printer.extrudeLen===v }"
                          @click="printer.extrudeLen = v">{{ v }}</button>
                </div>
              </div>
              <div class="wex-field-wrap">
                <div class="wex-field-label">Extrusion Feedrate</div>
                <div class="wex-field-row">
                  <div class="wex-field-box">
                    <input class="wex-input" type="number" step="1" min="1" v-model.number="printer.extrudeFeedrate" />
                    <span class="wex-unit">mm/s</span>
                  </div>
                  <div class="wex-steppers">
                    <button class="wex-step" @click="printer.extrudeFeedrate = Math.min(50, printer.extrudeFeedrate+1)">▲</button>
                    <button class="wex-step" @click="printer.extrudeFeedrate = Math.max(1,  printer.extrudeFeedrate-1)">▼</button>
                  </div>
                </div>
                <div class="wex-presets">
                  <button v-for="v in [10,5,2,1]" :key="v" class="btn btn-ghost btn-xs"
                          :class="{ 'wex-preset--active': printer.extrudeFeedrate===v }"
                          @click="printer.extrudeFeedrate = v">{{ v }}</button>
                </div>
              </div>
            </div>

            <!-- Retract / Extrude -->
            <div class="wex-extrude-row">
              <button class="btn wex-retract-btn" @click="doExtrude(true)">⬆ RETRACT</button>
              <button class="btn wex-extrude-btn" @click="doExtrude(false)">⬇ EXTRUDE</button>
            </div>

          </div>
        </template>

        <!-- ── Toolhead Position ──────────────────────────────── -->
        <template v-else-if="w.type === 'toolhead'">
          <div class="w-toolhead">

            <!-- Position: absolute label -->
            <template v-if="!isFieldHidden(w,'coords')">
            <div class="wth-pos-header">
              <span class="wth-pos-icon">⊙</span>
              <span class="wth-pos-label">Position: absolute</span>
            </div>

            <!-- XYZ position display -->
            <div class="wth-axes">
              <div class="wth-axis-card" v-for="(val, axis) in { X: printer.posX, Y: printer.posY, Z: printer.posZ }" :key="axis"
                   :class="{ 'wth-unhomed': !printer.homedAxes.includes(axis.toLowerCase()) }">
                <div class="wth-axis-top">
                  <span class="wth-axis-label">{{ axis }}</span>
                  <span class="wth-axis-limit">[{{ val != null ? val.toFixed(2) : '?' }}]</span>
                </div>
                <span class="wth-axis-val">{{ val != null ? val.toFixed(2) : '?' }}</span>
              </div>
            </div>

            </template>

            <!-- Home / QGL / Motor off buttons -->
            <div class="wth-action-row" v-if="!isFieldHidden(w,'jog')">
              <button class="btn btn-primary btn-sm wth-home-btn" @click="sendGcode('G28')" title="Home All">
                <span class="wth-home-icon">⌂</span> ALL
              </button>
              <button class="btn btn-sm wth-qgl-btn" @click="sendGcode('QUAD_GANTRY_LEVEL')" title="Quad Gantry Level">QGL</button>
              <button class="btn btn-ghost btn-sm wth-motors-btn"
                      :class="{ 'wth-motors-btn--off': !printer.motorsEnabled }"
                      @click="toggleMotors"
                      :title="printer.motorsEnabled ? 'Disable motors' : 'Enable motors'">
                <span class="wth-motors-icon">⛌</span>
              </button>
            </div>

            <!-- XY jog grid -->
            <div class="wth-jog-section" v-if="!isFieldHidden(w,'jog')">
              <div class="wth-jog-row" v-for="(axis, ai) in ['X','Y']" :key="axis">
                <button v-for="d in [-100,-10,-1]" :key="d" class="btn btn-ghost btn-xs wth-jog-btn"
                        @click="sendGcode(`G91\nG0 ${axis}${d} F3000\nG90`)">{{ d }}</button>
                <span class="wth-jog-axis-label" :style="{ color: axis==='X' ? 'var(--teal)' : 'var(--amber)' }">{{ axis }}</span>
                <button v-for="d in [1,10,100]" :key="d" class="btn btn-ghost btn-xs wth-jog-btn"
                        @click="sendGcode(`G91\nG0 ${axis}+${d} F3000\nG90`)">+{{ d }}</button>
              </div>
              <!-- Z row with different increments -->
              <div class="wth-jog-row">
                <button v-for="d in [-25,-1,-0.1]" :key="d" class="btn btn-ghost btn-xs wth-jog-btn"
                        @click="sendGcode(`G91\nG0 Z${d} F600\nG90`)">{{ d }}</button>
                <span class="wth-jog-axis-label" style="color:var(--yellow)">Z</span>
                <button v-for="d in [0.1,1,25]" :key="d" class="btn btn-ghost btn-xs wth-jog-btn"
                        @click="sendGcode(`G91\nG0 Z+${d} F600\nG90`)">+{{ d }}</button>
              </div>
            </div>

            <!-- Z-Offset -->
            <div class="wth-zoffset-section" v-if="!isFieldHidden(w,'zoffset')">
              <div class="wth-zoffset-header">
                <span class="wth-pos-icon">◈</span>
                <span class="wth-pos-label">Z-Offset: {{ printer.zOffset.toFixed(3) }}</span>
              </div>
              <!-- Row 1: negative adjustments -->
              <div class="wth-zoffset-row">
                <button v-for="d in [-0.05,-0.025,-0.01,-0.005]" :key="d" class="btn btn-ghost btn-xs wth-jog-btn"
                        @click="sendGcode(`SET_GCODE_OFFSET Z_ADJUST=${d} MOVE=1`)">{{ d }}</button>
              </div>
              <!-- Row 2: save buttons + positive adjustments -->
              <div class="wth-zoffset-row">
                <button class="btn btn-ghost btn-xs wth-save-btn"
                        @click="sendGcode('Z_OFFSET_APPLY_PROBE')" title="Save to config">↓ Save</button>
                <button class="btn btn-ghost btn-xs wth-save-btn"
                        @click="sendGcode('SAVE_CONFIG')" title="Apply & save">↑ Apply</button>
                <button v-for="d in [0.005,0.01,0.025,0.05]" :key="d" class="btn btn-ghost btn-xs wth-jog-btn"
                        @click="sendGcode(`SET_GCODE_OFFSET Z_ADJUST=${d} MOVE=1`)">+{{ d }}</button>
              </div>
            </div>

            <!-- Speed factor -->
            <div class="wth-speed-section" v-if="!isFieldHidden(w,'speed')">
              <div class="wth-speed-header">
                <span class="wth-pos-icon">↻</span>
                <span class="wth-pos-label">Speed factor</span>
                <span class="wth-speed-pct">{{ Math.round(printer.speedFactor * 100) }} %</span>
              </div>
              <div class="wth-speed-row">
                <button class="btn btn-ghost btn-xs wth-speed-adj" @click="adjustSpeed(-10)">−</button>
                <input type="range" class="wth-speed-slider" min="10" max="200" step="1"
                       :value="Math.round(printer.speedFactor * 100)"
                       @input="setSpeed($event.target.value)" />
                <button class="btn btn-ghost btn-xs wth-speed-adj" @click="adjustSpeed(10)">+</button>
              </div>
            </div>

          </div>
        </template>

        <!-- ── Print Controls ─────────────────────────────────── -->
        <template v-else-if="w.type === 'controls'">
          <div class="w-controls">
            <button class="btn btn-ghost" @click="sendGcode('PAUSE')"   :disabled="!printer.isPrinting">Pause</button>
            <button class="btn btn-ghost" @click="sendGcode('RESUME')" :disabled="!printer.isPaused">Resume</button>
            <button class="btn btn-danger" @click="confirmCancel"      :disabled="!printer.isPrinting && !printer.isPaused">Cancel</button>
          </div>
        </template>

        <!-- ── Macros ─────────────────────────────────────────── -->
        <template v-else-if="w.type === 'macros'">
          <div class="w-macros">
            <div class="wm-label">Macros</div>
            <div class="wm-btns">
              <button
                v-for="m in (w.config?.macros || defaultMacros)"
                :key="m"
                class="btn btn-ghost btn-sm"
                @click="sendGcode(m)"
              >{{ m }}</button>
            </div>
          </div>
        </template>


        <!-- ── System Loads ───────────────────────────────────── -->
        <template v-else-if="w.type === 'sysloads'">
          <SystemMonitorWidget />
        </template>

        <!-- ── Console ──────────────────────────────────────── -->
        <template v-else-if="w.type === 'console'">
          <ConsoleWidget style="height:100%" />
        </template>

        <!-- ── Camera Feed ────────────────────────────────────── -->
        <template v-else-if="w.type === 'camera'">
          <CameraWidget :widget="w" />
        </template>

        <!-- ── Toolhead 3D ────────────────────────────────────── -->
        <template v-else-if="w.type === 'toolhead3d'">
          <Toolhead3DWidget :widget="w" />
        </template>

      </WidgetShell>

      <!-- ── Canvas bottom resize handle (edit mode) ───────────── -->
      <template v-if="layout.customizeMode.value">
        <!-- Bottom drag handle -->
        <div class="canvas-resize-handle canvas-resize-handle--bottom"
             :style="{ top: canvasHeight + 'px' }"
             @mousedown.prevent="startCanvasResize('bottom', $event)"
             title="Drag to extend canvas height"></div>
      </template>

      <!-- ── Canvas right resize handle (edit mode + hscroll enabled) ── -->
      <template v-if="layout.customizeMode.value && settings.dashboardAllowHorizontalScroll">
        <div class="canvas-resize-handle canvas-resize-handle--right"
             :style="{ left: (canvasWidth - 6) + 'px' }"
             @mousedown.prevent="startCanvasResize('right', $event)"
             title="Drag to extend canvas width"></div>
      </template>

    </div>

    <!-- ── Cancel confirm dialog ─────────────────────────────── -->
    <div v-if="showCancelConfirm" class="modal-backdrop" @click.self="showCancelConfirm = false">
      <div class="card modal">
        <div class="modal-title">Cancel Print?</div>
        <p style="font-size:13px;color:var(--text-dim);margin-bottom:16px">
          This will cancel <strong>{{ printer.filename }}</strong> and cannot be undone.
        </p>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-ghost" @click="showCancelConfirm = false">Keep Printing</button>
          <button class="btn btn-danger" @click="doCancel">Cancel Print</button>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
/**
 * PrinterDashboard.vue — Widgetized 3D printer dashboard for Bakesail.
 *
 * Widget types: state, hotend, bed, chart, progress, fan, speedflow,
 *               toolhead, controls, macros, camera
 *
 * To add a widget:
 *   1. Add an entry to WIDGET_DEFS
 *   2. Add a <template v-else-if="w.type === 'yourtype'"> block above
 *   3. Wire reactive data from handleStatus() into the `printer` object
 */

import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useSettingsStore }   from '../stores/settings.js'
import { useDeviceStore }     from '../stores/device.js'
import { useMoonraker }       from '../composables/useMoonraker.js'
import { useDashboardLayout } from '../composables/useDashboardLayout.js'
import WidgetShell from '../components/WidgetShell.vue'
import CameraWidget   from '../components/CameraWidget.vue'
import SystemMonitorWidget from '../components/SystemMonitorWidget.vue'
import StatusHeaderWidget from '../components/StatusHeaderWidget.vue'
import DashboardCustomizeBar from '../components/DashboardCustomizeBar.vue'
import LedColorPicker from '../components/LedColorPicker.vue'
import ConsoleWidget      from '../components/ConsoleWidget.vue'
import Toolhead3DWidget   from '../components/Toolhead3DWidget.vue'

const settings = useSettingsStore()
const deviceStore = useDeviceStore()
const { klippyState, sendGcode, subscribeToStatus } = useMoonraker()
const _uid = Math.random().toString(36).slice(2, 7)

// ── Printer state ──────────────────────────────────────────────
const printer = reactive({
  hotendTemp:    null,
  hotendTarget:  0,
  hotendPower:   0,
  bedTemp:       null,
  bedTarget:     0,
  bedPower:      0,
  fanSpeed:      0,
  filename:      '',
  state:         'standby',
  isPrinting:    false,
  isPaused:      false,
  printDuration: 0,
  filamentUsed:  0,
  currentLayer:  null,
  totalLayers:   null,
  progress:      0,
  speedFactor:   1.0,
  extrudeFactor: 1.0,
  posX: null, posY: null, posZ: null,
  homedAxes: '',
  zOffset:        0.0,
  jogStep:        10,
  motorsEnabled:  true,
  pressureAdvance: 0.05,
  smoothTime:      0.040,
  extrudeLen:      50,
  extrudeFeedrate: 5,
})

const HISTORY_LEN = 600  // 600 × 2s ≈ 20 min
const tempHistory = reactive({ hotend: [], bed: [] })

// Uniform 2s sampler — Klipper diffs omit unchanged temps, so status-only
// pushing causes sensors to fill different fractions of the chart window.
let _historyTimer = null
function _pushHistory(t) {
  const push = (key, val) => {
    if (val == null) return
    if (!tempHistory[key]) tempHistory[key] = []
    tempHistory[key].push({ t, v: val })
    if (tempHistory[key].length > HISTORY_LEN) tempHistory[key].shift()
  }
  push('hotend', printer.hotendTemp)
  push('bed',    printer.bedTemp)
  for (const [key, val] of Object.entries(deviceStore.dynamicObjects)) {
    if (key.startsWith('temperature_sensor ') && val.temperature != null)
      push(key, val.temperature)
  }
}

function handleStatus(data) {
  if (data.extruder) {
    if (data.extruder.temperature      != null) printer.hotendTemp      = data.extruder.temperature
    if (data.extruder.target           != null) printer.hotendTarget    = data.extruder.target
    if (data.extruder.power            != null) printer.hotendPower     = data.extruder.power
    if (data.extruder.pressure_advance != null) printer.pressureAdvance = data.extruder.pressure_advance
    if (data.extruder.smooth_time      != null) printer.smoothTime      = data.extruder.smooth_time
  }
  if (data.heater_bed) {
    if (data.heater_bed.temperature != null) printer.bedTemp   = data.heater_bed.temperature
    if (data.heater_bed.target      != null) printer.bedTarget = data.heater_bed.target
    if (data.heater_bed.power       != null) printer.bedPower  = data.heater_bed.power
  }
  if (data.fan?.speed          != null) printer.fanSpeed      = data.fan.speed
  if (data.display_status?.progress != null) printer.progress = data.display_status.progress
  if (data.print_stats) {
    const ps = data.print_stats
    if (ps.state          != null) { printer.state = ps.state; printer.isPrinting = ps.state === 'printing'; printer.isPaused = ps.state === 'paused' }
    if (ps.filename       != null) printer.filename      = ps.filename
    if (ps.print_duration != null) printer.printDuration = ps.print_duration
    if (ps.filament_used  != null) printer.filamentUsed  = ps.filament_used
    if (ps.info?.current_layer != null) printer.currentLayer = ps.info.current_layer
    if (ps.info?.total_layer   != null) printer.totalLayers  = ps.info.total_layer
  }
  if (data.gcode_move) {
    if (data.gcode_move.speed_factor   != null) printer.speedFactor   = data.gcode_move.speed_factor
    if (data.gcode_move.extrude_factor != null) printer.extrudeFactor = data.gcode_move.extrude_factor
    if (data.gcode_move.homing_origin  != null) printer.zOffset       = data.gcode_move.homing_origin[2]
  }
  if (data.toolhead) {
    if (data.toolhead.position   != null) { printer.posX = data.toolhead.position[0]; printer.posY = data.toolhead.position[1]; printer.posZ = data.toolhead.position[2] }
    if (data.toolhead.homed_axes != null) {
      printer.homedAxes = data.toolhead.homed_axes
      // Homing always re-enables steppers
      if (data.toolhead.homed_axes.length > 0) {
        printer.motorsEnabled = true
      }
    }
  }
  // Keep device store in sync so topbar can read printer state from anywhere
  deviceStore.updatePrinter({
    printerState:  printer.state,
    idleState:     data.idle_timeout?.state ?? undefined,
    homedAxes:     data.toolhead?.homed_axes ?? undefined,
    motorsEnabled: printer.motorsEnabled,
    filename:      printer.filename,
    progress:      printer.progress,
    printDuration: printer.printDuration,
    qglApplied:    data.quad_gantry_level?.applied ?? undefined,
  })
  // History is now pushed by the uniform 2s timer (_pushHistory) rather than
  // here, so all sensors fill the same fraction of the chart window.
}

// ── State label / colour ───────────────────────────────────────
const STATE_META = {
  standby:   { label: 'Standby',   colour: 'var(--text-muted)' },
  printing:  { label: 'Printing',  colour: 'var(--amber)'      },
  paused:    { label: 'Paused',    colour: 'var(--yellow)'     },
  complete:  { label: 'Complete',  colour: 'var(--green)'      },
  error:     { label: 'Error',     colour: 'var(--red)'        },
  cancelled: { label: 'Cancelled', colour: 'var(--text-dim)'   },
}
const stateLabel  = computed(() => STATE_META[printer.state]?.label  ?? printer.state)
const stateColour = computed(() => STATE_META[printer.state]?.colour ?? 'var(--text-muted)')

// ── Dynamic object filters (for monitor widget) ───────────────
const tempSensors = computed(() => {
  const out = {}
  for (const [k, v] of Object.entries(deviceStore.dynamicObjects)) {
    if (k.startsWith('temperature_sensor ')) out[k] = v
  }
  return out
})

const allFans = computed(() => {
  const out = {}
  for (const [k, v] of Object.entries(deviceStore.dynamicObjects)) {
    if (k.startsWith('heater_fan ') || k.startsWith('fan_generic ') || k.startsWith('temperature_fan ')) out[k] = v
  }
  return out
})

const ledObjects = computed(() => {
  const out = {}
  for (const [k, v] of Object.entries(deviceStore.dynamicObjects)) {
    if (k.startsWith('neopixel ') || k.startsWith('led ')) out[k] = v
  }
  return out
})

// ── Speed / flow helpers ──────────────────────────────────────
function setSpeed(pct) {
  const factor = Math.max(0.1, Math.min(2.0, parseInt(pct) / 100))
  sendGcode(`M220 S${Math.round(factor * 100)}`)
}
function adjustSpeed(delta) {
  const current = Math.round(printer.speedFactor * 100)
  setSpeed(Math.max(10, Math.min(200, current + delta)))
}

// ── Motor enable/disable ──────────────────────────────────────
function toggleMotors() {
  if (printer.motorsEnabled) {
    sendGcode('M18')
    printer.motorsEnabled = false
  } else {
    sendGcode('M17')
    printer.motorsEnabled = true
  }
  deviceStore.updatePrinter({ motorsEnabled: printer.motorsEnabled })
}

// ── Extruder control ───────────────────────────────────────────
function doExtrude(retract = false) {
  const sign = retract ? -1 : 1
  const feedMms = printer.extrudeFeedrate
  sendGcode(`M83\nG1 E${sign * printer.extrudeLen} F${feedMms * 60}\nM82`)
}

function setPressureAdvance() {
  sendGcode(`SET_PRESSURE_ADVANCE ADVANCE=${printer.pressureAdvance} SMOOTH_TIME=${printer.smoothTime}`)
}

// ── Widget definitions ─────────────────────────────────────────
const WIDGET_DEFS = [
  { type: 'state',     label: 'State Header',       defaultW: 700, defaultH: 80,  defaultConfig: {}, fields: [{ key: 'filename', label: 'Filename' }, { key: 'layer', label: 'Layer counter' }] },
  { type: 'hotend',    label: 'Hotend Temp',         defaultW: 180, defaultH: 160, defaultConfig: { label: 'Hotend' }, fields: [{ key: 'power', label: 'Heater power bar' }] },
  { type: 'bed',       label: 'Bed Temp',            defaultW: 180, defaultH: 160, defaultConfig: { label: 'Bed' },    fields: [{ key: 'power', label: 'Heater power bar' }] },
  { type: 'chart',     label: 'Temperature Chart',   defaultW: 560, defaultH: 240, defaultConfig: {}, fields: [] },
  { type: 'temps',     label: 'Temperatures',        defaultW: 280, defaultH: 160, defaultConfig: {}, fields: [] },
  { type: 'fanlist',   label: 'Fan List',            defaultW: 280, defaultH: 160, defaultConfig: {}, fields: [] },
  { type: 'lighting',  label: 'Lighting',            defaultW: 280, defaultH: 140, defaultConfig: {}, fields: [] },
  { type: 'sysloads',  label: 'System Loads',          defaultW: 380, defaultH: 400, defaultConfig: {}, fields: [] },
  { type: 'progress',  label: 'Print Progress',      defaultW: 520, defaultH: 120, defaultConfig: {}, fields: [{ key: 'time', label: 'Print time' }, { key: 'eta', label: 'ETA' }, { key: 'filament', label: 'Filament used' }] },
  { type: 'fan',       label: 'Part Fan',            defaultW: 180, defaultH: 140, defaultConfig: { label: 'Part Fan' }, fields: [] },
  { type: 'speedflow', label: 'Extruder',            defaultW: 400, defaultH: 420, defaultConfig: {}, fields: [] },
  { type: 'toolhead',   label: 'Toolhead Classic',    defaultW: 400, defaultH: 460, defaultConfig: {}, fields: [
    { key: 'coords',  label: 'Position display' },
    { key: 'jog',     label: 'Movement buttons' },
    { key: 'zoffset', label: 'Z-Offset adjust' },
    { key: 'speed',   label: 'Speed factor' },
  ] },
  { type: 'toolhead3d', label: 'Toolhead 3D',         defaultW: 480, defaultH: 460, defaultConfig: {}, fields: [] },
  { type: 'controls',  label: 'Print Controls',      defaultW: 600, defaultH: 60,  defaultConfig: {}, fields: [] },
  { type: 'macros',    label: 'Macro Buttons',       defaultW: 400, defaultH: 100, defaultConfig: { macros: ['BED_MESH_CALIBRATE', 'LOAD_FILAMENT', 'UNLOAD_FILAMENT'] }, fields: [], multiple: true },
  { type: 'console',   label: 'Console',             defaultW: 480, defaultH: 360, defaultConfig: {}, fields: [] },
  { type: 'camera',    label: 'Camera Feed',         defaultW: 400, defaultH: 225, defaultConfig: { cameraId: null }, fields: [{ key: 'label', label: 'Show camera name' }], multiple: true },
]

function widgetLabel(type)   { return WIDGET_DEFS.find(d => d.type === type)?.label ?? type }
function widgetFields(type)  { return WIDGET_DEFS.find(d => d.type === type)?.fields || [] }
function defaultConfig(type) { return WIDGET_DEFS.find(d => d.type === type)?.defaultConfig || {} }
function isFieldHidden(w, key) { return w.config?.hiddenFields?.includes(key) }

// ── Default layout ─────────────────────────────────────────────
function buildDefaultLayout() {
  const hasCam   = settings.cameras.length > 0
  const canvasEl = document.querySelector('.pd-root')

  const availW = canvasEl?.offsetWidth ?? (window.innerWidth - 220)
  // Viewport height minus topbar+cbar
  const viewH  = Math.max(400, window.innerHeight - 100)

  const gap  = 10
  // 3-column layout: toolhead3d | camera (if any) | sysloads
  // Left col = ~35%, camera col = ~35%, right col = ~30%
  // Without camera: left ~55%, right ~45%
  let col0W, col1W, col2W, col1X, col2X
  if (hasCam) {
    col0W = Math.floor(availW * 0.35)
    col1W = Math.floor(availW * 0.35)
    col2W = availW - col0W - col1W - gap * 2
    col1X = col0W + gap
    col2X = col1X + col1W + gap
  } else {
    col0W = Math.floor(availW * 0.55)
    col1W = 0
    col2W = availW - col0W - gap
    col1X = 0
    col2X = col0W + gap
  }

  // Row heights
  const topH     = Math.floor(viewH * 0.50)   // toolhead3d / camera / sysloads
  const row2Y    = topH + gap
  const chartH   = Math.floor(viewH * 0.23)   // temp chart spans left+center
  const chartW   = hasCam ? col1X + col1W : col0W  // left cols
  // misc and temps stack right of chart — auto-height (tall enough to fit)
  const miscH    = 220   // tall enough for ~8 fans/lights
  const tempsH   = 300   // tall enough for ~10 sensors
  const row3Y    = row2Y + miscH + gap

  return [
    // Top row
    { id: 'toolhead',  type: 'toolhead3d', x: 0,     y: 0,     w: col0W, h: topH,   config: {} },
    ...(hasCam ? [{ id: 'camera', type: 'camera', x: col1X, y: 0, w: col1W, h: topH, config: {} }] : []),
    { id: 'sysloads',  type: 'sysloads',   x: col2X, y: 0,     w: col2W, h: topH,   config: {} },
    // Bottom-left: chart spanning left+center cols
    { id: 'chart',     type: 'chart',      x: 0,     y: row2Y, w: chartW, h: chartH, config: {} },
    // Bottom-right: speedflow (extruder) top, then misc + temps below
    { id: 'speedflow', type: 'speedflow',  x: col2X, y: row2Y, w: col2W, h: 350,    config: {} },
    // Below chart: fanlist + temps side by side
    { id: 'fanlist',   type: 'fanlist',    x: 0,                           y: row2Y + chartH + gap, w: Math.floor((chartW - gap) / 2), h: tempsH, config: {} },
    { id: 'temps',     type: 'temps',      x: Math.floor((chartW - gap) / 2) + gap, y: row2Y + chartH + gap, w: chartW - Math.floor((chartW - gap) / 2) - gap, h: tempsH, config: {} },
  ]
}

const layout = useDashboardLayout('printer', buildDefaultLayout())

// Viewport dims (excluding topbar/cbar) — used for snap lines and resize clamping
const viewportH = computed(() => {
  const content = document.querySelector('.content')
  const canvas  = document.querySelector('.pd-root')
  if (!canvas || !content) return window.innerHeight - 100
  const top    = canvas.getBoundingClientRect().top
  const bottom = content.getBoundingClientRect().bottom
  return Math.max(300, Math.floor(bottom - top))
})
const viewportW = computed(() => {
  const canvas = document.querySelector('.pd-root')
  return canvas ? canvas.clientWidth : window.innerWidth - 220
})

// Canvas dimensions: viewport + any user-extended extra
const canvasHeight = computed(() => {
  const ws     = layout.widgets.value
  const bottom = ws.length ? ws.reduce((m, w) => Math.max(m, w.y + w.h), 0) : 0
  return Math.max(bottom + 10, viewportH.value + layout.canvasExtraH.value)
})

// Total height of the canvas DOM element: content + 100px scrollable buffer in edit mode
const canvasDomHeight = computed(() =>
  canvasHeight.value + (layout.customizeMode.value ? 100 : 0)
)

const canvasWidth = computed(() => {
  if (!settings.dashboardAllowHorizontalScroll) return undefined  // CSS 100%
  return viewportW.value + layout.canvasExtraW.value
})

const canvasStyle = computed(() => ({
  height: canvasDomHeight.value + 'px',
  width:  canvasWidth.value ? canvasWidth.value + 'px' : '100%',
}))

// ── Canvas resize drag ─────────────────────────────────────────────────────────
function startCanvasResize(edge, evt) {
  const startY   = evt.clientY
  const startX   = evt.clientX
  const startExH = layout.canvasExtraH.value
  const startExW = layout.canvasExtraW.value
  const snapH    = viewportH.value
  const snapW    = viewportW.value

  function onMove(e) {
    if (edge === 'bottom') {
      const dy  = e.clientY - startY
      let newExH = Math.max(0, startExH + dy)
      // Snap to viewport boundary (within 20px)
      if (Math.abs(viewportH.value + newExH - snapH - startExH - dy + startExH) < 20) {
        // snap to 0 extra (viewport edge)
        if (Math.abs(newExH) < 20) newExH = 0
      }
      layout.canvasExtraH.value = Math.round(newExH)
    } else {
      const dx  = e.clientX - startX
      let newExW = Math.max(0, startExW + dx)
      if (Math.abs(newExW) < 20) newExW = 0
      layout.canvasExtraW.value = Math.round(newExW)
    }
  }
  function onUp() {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup',   onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup',   onUp)
}

// ── Helpers ────────────────────────────────────────────────────
// ── Temperature target inputs ──────────────────────────────────
// Uncontrolled inputs: value is empty by default, populated on focus,
// cleared on blur. Enter sends the gcode, Escape blurs without sending.
const hotendInput = ref('')
const bedInput    = ref('')

// ── LED helpers ───────────────────────────────────────────────
function ledRgbw(obj) {
  const c = obj?.color_data?.[0] ?? [1,1,1,0]
  const hasWhite = c.length >= 4 && c[3] !== undefined
  return {
    r: Math.round((c[0] ?? 1) * 255),
    g: Math.round((c[1] ?? 1) * 255),
    b: Math.round((c[2] ?? 1) * 255),
    w: Math.round((c[3] ?? 0) * 255),
    hasWhite,
  }
}

function setLed(name, { r, g, b, w }) {
  const led = name.replace(/^(neopixel |led )/, '')
  const rf = (r/255).toFixed(4), gf = (g/255).toFixed(4)
  const bf = (b/255).toFixed(4), wf = (w/255).toFixed(4)
  sendGcode(`SET_LED LED=${led} RED=${rf} GREEN=${gf} BLUE=${bf} WHITE=${wf}`)
}

function setHotend(val) {
  const t = parseInt(val, 10)
  if (isNaN(t) || t < 0) return
  sendGcode(`M104 S${t}`)
}
function setBed(val) {
  const t = parseInt(val, 10)
  if (isNaN(t) || t < 0) return
  sendGcode(`M140 S${t}`)
}

function tempClass(temp, target) {
  if (temp == null || target === 0) return ''
  const diff = Math.abs(temp - target)
  if (diff < 3)       return 'temp-at-target'
  if (temp < target)  return 'temp-heating'
  return 'temp-over'
}

function formatDuration(s) {
  if (!s) return '0:00:00'
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60)
  return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`
}

function formatEta(elapsed, progress) {
  if (!progress || progress <= 0) return '—'
  const remaining = (elapsed / progress) - elapsed
  return new Date(Date.now() + remaining * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const defaultMacros = ['BED_MESH_CALIBRATE', 'LOAD_FILAMENT', 'UNLOAD_FILAMENT']

// ── Cancel confirm ─────────────────────────────────────────────
const showCancelConfirm = ref(false)
function confirmCancel() { showCancelConfirm.value = true }
async function doCancel() { showCancelConfirm.value = false; await sendGcode('CANCEL_PRINT') }

// ── Temperature chart ──────────────────────────────────────────
const chartCanvases  = ref({})
const chartWindows   = reactive({})   // widgetId → minutes (default 15)
const hiddenSeries   = reactive({})   // widgetId → { seriesKey: bool }
const seriesMenuOpen = ref(null)
let chartTimer = null

const TIME_WINDOWS = [1, 2, 5, 15, 30, 60, 120, 240, 480]

function chartWindowMins(id) { return chartWindows[id] ?? 15 }
function chartWindowLabel(id) {
  const m = chartWindowMins(id)
  return m >= 60 ? `${m/60}h` : `${m}m`
}
function increaseTimeWindow(id) {
  const idx = TIME_WINDOWS.indexOf(chartWindowMins(id))
  if (idx < TIME_WINDOWS.length - 1) chartWindows[id] = TIME_WINDOWS[idx + 1]
}
function decreaseTimeWindow(id) {
  const idx = TIME_WINDOWS.indexOf(chartWindowMins(id))
  if (idx > 0) chartWindows[id] = TIME_WINDOWS[idx - 1]
}

// Default palette for series beyond the first two
const SERIES_PALETTE = [
  '#e06c75', // red
  '#c678dd', // purple
  '#56b6c2', // cyan
  '#98c379', // green
  '#d19a66', // orange
  '#61afef', // blue
  '#e5c07b', // yellow
]

function seriesColour(widgetId, key, paletteIdx) {
  // User-overridden colour takes priority
  const w = layout.widgets.value.find(w => w.id === widgetId)
  const stored = w?.config?.seriesColours?.[key]
  if (stored) return stored
  // Built-in defaults
  const cs = getComputedStyle(document.documentElement)
  if (key === 'hotend') return cs.getPropertyValue('--amber').trim() || '#e5a550'
  if (key === 'bed')    return cs.getPropertyValue('--teal').trim()  || '#4ec9b0'
  return SERIES_PALETTE[paletteIdx % SERIES_PALETTE.length]
}

function setSeriesColour(widgetId, key, colour) {
  const w = layout.widgets.value.find(w => w.id === widgetId)
  if (!w) return
  if (!w.config.seriesColours) w.config.seriesColours = {}
  w.config.seriesColours[key] = colour
  layout.saveLayout('')
}

function chartSeries(id) {
  const series = [
    { key: 'hotend', label: 'Hotend', colour: seriesColour(id, 'hotend', 0), data: () => tempHistory.hotend },
    { key: 'bed',    label: 'Bed',    colour: seriesColour(id, 'bed', 1),    data: () => tempHistory.bed   },
  ]
  let pi = 0
  for (const name of Object.keys(deviceStore.dynamicObjects)) {
    if (name.startsWith('temperature_sensor ')) {
      const label = name.replace('temperature_sensor ', '')
      series.push({ key: name, label, colour: seriesColour(id, name, pi), data: () => tempHistory[name] ?? [] })
      pi++
    }
  }
  return series
}

function toggleSeriesMenu(id) {
  seriesMenuOpen.value = seriesMenuOpen.value === id ? null : id
}

function toggleSeries(id, key, checked) {
  if (!hiddenSeries[id]) hiddenSeries[id] = {}
  hiddenSeries[id][key] = !checked
}

// Close series menu on outside click
if (typeof window !== 'undefined') {
  window.addEventListener('click', () => { seriesMenuOpen.value = null })
}

function drawCharts() {
  for (const [id, canvas] of Object.entries(chartCanvases.value)) {
    if (!canvas) continue
    const w = canvas.offsetWidth || canvas.parentElement?.offsetWidth || 0
    const h = canvas.offsetHeight || canvas.parentElement?.offsetHeight || 0
    if (!w || !h) continue
    // Render at device pixel ratio so text/lines are crisp on HiDPI screens.
    // The backing store is sized in physical pixels (w*dpr × h*dpr) while all
    // the drawing math below stays in CSS pixels — ctx.setTransform maps one
    // onto the other. Without this the canvas was drawn at 1x and upscaled by
    // the browser, which is what made the labels blurry.
    const dpr = window.devicePixelRatio || 1
    const ctx = canvas.getContext('2d')
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width  = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const cs  = getComputedStyle(document.documentElement)
    const colG = cs.getPropertyValue('--border').trim()
    const colT = cs.getPropertyValue('--text-muted').trim()

    ctx.clearRect(0, 0, w, h)

    // Build active series
    const allSeries = chartSeries(id)
    const activeSeries = allSeries.filter(s => !hiddenSeries[id]?.[s.key])

    // Time window
    const windowMs = chartWindowMins(id) * 60 * 1000
    const now = Date.now()
    const tMin = now - windowMs
    const tMax = now

    // Filter data to window
    const seriesData = activeSeries.map(s => ({
      ...s,
      pts: s.data().filter(p => p.t >= tMin),
    }))

    const allVals = seriesData.flatMap(s => s.pts.map(p => p.v)).filter(v => v != null)
    if (allVals.length < 2) {
      ctx.fillStyle = colT; ctx.font = '12px system-ui'; ctx.textAlign = 'center'
      ctx.fillText('Collecting temperature data…', w / 2, h / 2)
      continue
    }

    const pad = { t: 8, r: 8, b: 28, l: 38 }
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b
    const rawMin = Math.min(...allVals), rawMax = Math.max(...allVals)
    const spread = rawMax - rawMin || 10
    const minT = rawMin - spread * 0.1
    const maxT = rawMax + spread * 0.1

    // Y grid lines
    ctx.strokeStyle = colG; ctx.lineWidth = 0.5
    const ySteps = 4
    for (let i = 0; i <= ySteps; i++) {
      const y = pad.t + (ph / ySteps) * i
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + pw, y); ctx.stroke()
      ctx.fillStyle = colT; ctx.font = '10px system-ui'; ctx.textAlign = 'right'
      ctx.fillText((maxT - ((maxT - minT) / ySteps) * i).toFixed(0) + '°', pad.l - 2, y + 4)
    }

    // X time axis labels — left=now, right=oldest (chart scrolls left→right)
    const xSteps = 6
    ctx.fillStyle = colT; ctx.font = '10px system-ui'
    for (let i = 0; i <= xSteps; i++) {
      const t = tMax - (windowMs / xSteps) * i   // left=now, right=oldest
      const x = pad.l + (pw / xSteps) * i
      const ago = Math.round((now - t) / 60000)
      const label = ago === 0 ? 'now' : `-${ago}m`
      ctx.textAlign = i === 0 ? 'left' : i === xSteps ? 'right' : 'center'
      ctx.fillText(label, x, h - 4)
    }

    // Draw each series (x maps newest to left: x = pad.l + (tMax - p.t)/windowMs * pw)
    let li = 0
    for (const s of seriesData) {
      if (s.pts.length < 2) { li++; continue }
      ctx.strokeStyle = s.colour; ctx.lineWidth = 1.5; ctx.beginPath()
      s.pts.forEach((p, i) => {
        const x = pad.l + ((tMax - p.t) / windowMs) * pw   // newest on left
        const y = pad.t + ph - ((p.v - minT) / (maxT - minT)) * ph
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.stroke()
      // Legend dot
      ctx.fillStyle = s.colour
      ctx.beginPath(); ctx.arc(pad.l + 8 + li * 70, h - 20, 4, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = colT; ctx.font = '10px system-ui'; ctx.textAlign = 'left'
      ctx.fillText(s.label, pad.l + 16 + li * 70, h - 16)
      li++
    }
  }
}

// ── Lifecycle ──────────────────────────────────────────────────
let unsubscribe = null

onMounted(async () => {
  const hadSaved = await layout.tryAutoLoad()
  if (!hadSaved) {
    // First load — apply fitScreen to fill gaps after DOM settles
    await nextTick()
    setTimeout(() => {
      const root = document.querySelector('.pd-root')
      if (root) layout.fitScreen(root.offsetWidth, null)
    }, 80)
  }
  unsubscribe = subscribeToStatus(handleStatus)
  chartTimer = setInterval(drawCharts, 1000)
  _historyTimer = setInterval(() => _pushHistory(Date.now()), 2000)
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
  if (chartTimer)   clearInterval(chartTimer)
  if (_historyTimer) clearInterval(_historyTimer)
})
</script>

<style scoped>
.pd-root { position: relative; min-height: 100%; }

.pd-offline { display: flex; align-items: center; gap: 10px; padding: 10px 14px; margin-bottom: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); font-size: 13px; color: var(--text-dim); }
.pd-offline-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--amber); opacity: 0.5; animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:1} }

.dt-left  { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.pd-state-label { font-size: 15px; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; }
.pd-filename { font-size: 12px; color: var(--text-dim); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }


.dash-canvas { position: relative; width: 100%; }

/* Canvas resize handles (edit mode only) */
.canvas-resize-handle {
  position: absolute;
  z-index: 50;
  background: var(--amber-dim);
  transition: background 0.15s;
}
.canvas-resize-handle--bottom {
  left: 0; right: 0; height: 6px;
  cursor: ns-resize;
}
.canvas-resize-handle--right {
  top: 0; bottom: 0; width: 6px;
  cursor: ew-resize;
}
.canvas-resize-handle:hover { background: var(--amber); }


.grid-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }

/* State */
.ws-filename { font-size: 12px; color: var(--text-dim); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ws-layer    { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }

/* Temp */
.w-temp { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 4px; }
.wt-label { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); }
.wt-value { font-size: 34px; font-weight: 700; font-family: var(--font-mono); color: var(--text); transition: color 0.4s; }
.wt-value.temp-at-target { color: var(--green); }
.wt-value.temp-heating   { color: var(--amber); }
.wt-value.temp-over      { color: var(--red);   }
.wt-target { font-size: 13px; color: var(--text-dim); font-family: var(--font-mono); }
.wt-arrow  { color: var(--amber); }
.wt-power-bar  { width: 80%; height: 4px; background: var(--surface-2); border-radius: 2px; overflow: hidden; margin-top: 2px; }
.wt-power-fill { height: 100%; background: var(--amber); border-radius: 2px; transition: width 0.5s ease; }
.wt-off { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); letter-spacing: 0.08em; }

/* Monitor */
.w-monitor { display: flex; flex-direction: column; height: 100%; gap: 4px; overflow-y: auto; }
.wmon-section-title { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; color: var(--text-muted); flex-shrink: 0; }
.wch-canvas { flex: 1; min-height: 120px; width: 100%; display: block; }

.wmon-sensor-grid { display: flex; flex-direction: column; gap: 0; }
.wmon-sensor-row { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--border); }
.wmon-sensor-row:last-child { border-bottom: none; }

.wmon-section-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
}
.wmon-section-header .wmon-section-title { margin-bottom: 0; }

.wmon-cooldown-btn {
  font-size: 10px; font-weight: 600; letter-spacing: 0.06em;
  padding: 2px 8px; border-radius: var(--radius);
  border: 1px solid var(--teal); color: var(--teal);
  background: transparent; cursor: pointer;
  transition: background 0.1s;
}
.wmon-cooldown-btn:hover { background: var(--teal-glow); }

.wmon-sensor-row--heater { align-items: center; }
.wmon-heater-spacer { flex: 1; }

.wmon-fan-row { align-items: center; }
.wmon-fan-slider {
  flex: 1; height: 4px; cursor: pointer;
  -webkit-appearance: none; appearance: none;
  background: var(--border-2); border-radius: 2px; outline: none;
  margin: 0 8px;
}
.wmon-fan-slider::-webkit-slider-thumb {
  -webkit-appearance: none; width: 12px; height: 12px;
  border-radius: 50%; background: var(--amber); cursor: pointer;
}
.wmon-fan-slider::-moz-range-thumb {
  width: 12px; height: 12px; border-radius: 50%;
  background: var(--amber); border: none; cursor: pointer;
}
.wmon-heater-status {
  font-size: 9px; font-weight: 700; letter-spacing: 0.08em;
  padding: 1px 5px; border-radius: 3px; border: 1px solid;
  flex-shrink: 0; min-width: 28px; text-align: center;
}
.wmon-status--on  { color: var(--amber); border-color: var(--amber); }
.wmon-status--off { color: var(--text-muted); border-color: var(--border-2); opacity: 0.6; }

.wmon-temp-input {
  width: 48px; flex-shrink: 0;
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text);
  font-family: var(--font-mono); font-size: 12px;
  padding: 2px 5px; text-align: center;
  -moz-appearance: textfield;
}
.wmon-temp-input::-webkit-outer-spin-button,
.wmon-temp-input::-webkit-inner-spin-button { -webkit-appearance: none; }
.wmon-temp-input:focus { outline: none; border-color: var(--amber); }
.wmon-temp-input::placeholder { color: var(--text-muted); }
.wmon-sensor-name { font-size: 12px; font-weight: 600; flex: 1; }
.wmon-sensor-val  { font-size: 13px; font-family: var(--font-mono); font-weight: 700; color: var(--teal); }
.wmon-sensor-target { font-size: 11px; color: var(--text-muted); }

.wmon-led-swatches { display: flex; gap: 3px; flex-wrap: wrap; }
.wmon-led-swatch { width: 14px; height: 14px; border-radius: 3px; border: 1px solid var(--border-2); }

.wmon-chart-header { display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.wmon-chart-controls { display: flex; align-items: center; gap: 4px; }
.wmon-chart-btn {
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 3px;
  color: var(--text-dim); font-size: 12px; cursor: pointer; padding: 1px 7px; line-height: 1.6;
  transition: color 0.1s, background 0.1s;
}
.wmon-chart-btn:hover { color: var(--text); background: var(--border); }
.wmon-chart-window { font-size: 11px; font-family: var(--font-mono); color: var(--text-dim); min-width: 28px; text-align: center; }
.wmon-chart-gear { font-size: 13px; padding: 1px 5px; }
.wmon-chart-gear-wrap { position: relative; }
.wmon-series-menu {
  position: absolute; right: 0; top: calc(100% + 4px); z-index: 100;
  background: var(--surface); border: 1px solid var(--border-2); border-radius: var(--radius);
  padding: 6px 0; min-width: 160px; box-shadow: 0 8px 24px rgba(0,0,0,0.35);
}
.wmon-series-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px; cursor: pointer; font-size: 12px;
  transition: background 0.1s;
}
.wmon-series-item:hover { background: var(--surface-2); }
.wmon-series-section {
  padding: 6px 12px 3px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.wmon-timescale-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 12px 8px;
}
.wmon-series-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; cursor: pointer; }
.wmon-series-colour-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  flex-shrink: 0;
}
.wmon-colour-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
  padding: 0;
  border: none;
}
.wmon-series-label { font-size: 12px; }
.wmon-chart-wrap { flex: 1; min-height: 0; width: 100%; }
.wmon-chart-slider { width: 100%; accent-color: var(--border-2); cursor: row-resize; height: 4px; }

.w-chart { display: flex; flex-direction: column; height: 100%; gap: 4px; }
.wch-label  { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); flex-shrink: 0; }
.wch-canvas { flex: 1; width: 100%; min-height: 0; }

/* Progress */
.w-progress { display: flex; flex-direction: column; gap: 8px; justify-content: center; height: 100%; }
.wp-filename  { font-size: 12px; color: var(--text-dim); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wp-bar-track { height: 8px; background: var(--surface-2); border-radius: 4px; overflow: hidden; }
.wp-bar-fill  { height: 100%; background: var(--amber); border-radius: 4px; transition: width 0.8s ease; }
.wp-stats { display: flex; align-items: baseline; gap: 14px; }
.wp-pct  { font-size: 22px; font-weight: 700; font-family: var(--font-mono); }
.wp-time { font-size: 12px; color: var(--text-dim);  font-family: var(--font-mono); }
.wp-eta  { font-size: 12px; color: var(--teal);      font-family: var(--font-mono); }
.wp-filament { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }

/* Fan */
.w-fan { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 6px; }
.wf-label { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); }
.wf-value { font-size: 28px; font-weight: 700; font-family: var(--font-mono); color: var(--teal); }
.wf-value.wf-off { color: var(--text-muted); }
.wf-bar-track { width: 80%; height: 4px; background: var(--surface-2); border-radius: 2px; overflow: hidden; }
.wf-bar-fill  { height: 100%; background: var(--teal); border-radius: 2px; transition: width 0.5s ease; }

/* Speed/Flow */
.w-extruder { display: flex; flex-direction: column; gap: 12px; height: 100%; overflow-y: auto; padding: 2px; }

.wex-section { display: flex; flex-direction: column; gap: 6px; }
.wex-header { display: flex; align-items: center; gap: 6px; }
.wex-icon { font-size: 13px; color: var(--text-muted); }
.wex-label { font-size: 12px; color: var(--text-dim); flex: 1; }
.wex-pct { font-size: 13px; font-weight: 700; font-family: var(--font-mono); }
.wex-slider-row { display: flex; align-items: center; gap: 8px; }
.wex-slider { flex: 1; accent-color: var(--teal); cursor: pointer; }
.wex-adj { font-size: 15px; width: 28px; padding: 2px; flex-shrink: 0; }

.wex-divider { height: 1px; background: var(--border); }

.wex-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.wex-field-wrap { display: flex; flex-direction: column; gap: 6px; }
.wex-field-label { font-size: 11px; color: var(--text-muted); font-weight: 500; }
.wex-field-row { display: flex; gap: 4px; align-items: center; }
.wex-field-box {
  flex: 1;
  display: flex;
  align-items: center;
  border: 1px solid var(--border-2);
  border-radius: var(--radius);
  padding: 6px 10px;
  background: var(--surface-2);
  gap: 6px;
}
.wex-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: var(--text);
  font-size: 18px;
  font-weight: 600;
  font-family: var(--font-mono);
  width: 0;
  min-width: 0;
}
.wex-unit { font-size: 11px; color: var(--text-muted); white-space: nowrap; }
.wex-steppers { display: flex; flex-direction: column; gap: 2px; }
.wex-step {
  background: var(--surface-2);
  border: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 10px;
  padding: 2px 5px;
  cursor: pointer;
  border-radius: 3px;
  line-height: 1;
  transition: background 0.1s;
}
.wex-step:hover { background: var(--surface); color: var(--text); }

.wex-presets { display: flex; gap: 3px; flex-wrap: wrap; }
.wex-preset--active { border-color: var(--teal); color: var(--teal); }

.wex-extrude-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.wex-retract-btn { background: var(--surface-2); border-color: var(--border-2); color: var(--text-dim); font-size: 12px; font-weight: 700; letter-spacing: 0.06em; }
.wex-retract-btn:hover { color: var(--text); border-color: var(--border-2); }
.wex-extrude-btn { background: var(--surface-2); border-color: var(--border-2); color: var(--text-dim); font-size: 12px; font-weight: 700; letter-spacing: 0.06em; }
.wex-extrude-btn:hover { color: var(--text); border-color: var(--border-2); }

/* motor off state */
.wth-motors-btn--off { opacity: 1; color: var(--text-muted) !important; }
.wsf-value { font-size: 20px; font-weight: 700; font-family: var(--font-mono); }
.wsf-btns  { display: flex; gap: 6px; flex-wrap: wrap; }

/* Toolhead */
.w-toolhead {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  padding: 4px 2px;
  overflow-y: auto;
}

/* Position header */
.wth-pos-header, .wth-zoffset-header, .wth-speed-header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.wth-pos-icon { font-size: 14px; color: var(--text-muted); }
.wth-pos-label { font-size: 12px; color: var(--text-dim); }
.wth-speed-pct { margin-left: auto; font-size: 13px; font-weight: 700; font-family: var(--font-mono); }

/* Axis cards */
.wth-axes {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.wth-axis-card {
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 6px 10px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.wth-axis-card.wth-unhomed { border-color: var(--red); }
.wth-axis-top { display: flex; justify-content: space-between; align-items: baseline; }
.wth-axis-label { font-size: 11px; font-weight: 700; color: var(--text-muted); }
.wth-axis-limit { font-size: 10px; font-family: var(--font-mono); color: var(--text-muted); }
.wth-axis-val { font-size: 20px; font-weight: 700; font-family: var(--font-mono); }
.wth-axis-card.wth-unhomed .wth-axis-val { color: var(--red); }

/* Action row */
.wth-action-row { display: flex; gap: 8px; }
.wth-home-btn { background: var(--teal); border-color: var(--teal); color: #fff; flex: 1; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; }
.wth-home-btn:hover { opacity: 0.85; }
.wth-qgl-btn { background: var(--amber); border-color: var(--amber); color: #fff; flex: 1; font-size: 12px; font-weight: 700; letter-spacing: 0.06em; }
.wth-qgl-btn:hover { opacity: 0.85; }
.wth-motors-btn { flex-shrink: 0; opacity: 0.6; }
.wth-motors-btn:hover { opacity: 1; }

/* Jog grid */
.wth-jog-section { display: flex; flex-direction: column; gap: 4px; }
.wth-jog-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr) 24px repeat(3, 1fr);
  gap: 3px;
  align-items: center;
}
.wth-jog-axis-label {
  text-align: center;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.wth-jog-btn {
  font-size: 11px;
  padding: 4px 2px;
  text-align: center;
  font-family: var(--font-mono);
  white-space: nowrap;
}

/* Z-offset */
.wth-zoffset-section { display: flex; flex-direction: column; gap: 6px; }
.wth-zoffset-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr) auto auto repeat(4, 1fr);
  gap: 3px;
  align-items: center;
}
.wth-save-btn { font-size: 13px; padding: 4px 6px; }

/* Speed slider */
.wth-speed-section { display: flex; flex-direction: column; gap: 6px; }
.wth-speed-row { display: flex; align-items: center; gap: 8px; }
.wth-speed-slider { flex: 1; accent-color: var(--teal); cursor: pointer; }
.wth-speed-adj { font-size: 15px; width: 28px; padding: 2px; flex-shrink: 0; }

/* Controls */
.w-controls { display: flex; align-items: center; gap: 8px; height: 100%; flex-wrap: wrap; }

/* Macros */
.w-macros { display: flex; flex-direction: column; gap: 8px; height: 100%; justify-content: center; }
.wm-label { font-size: 10px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--text-muted); }
.wm-btns  { display: flex; gap: 6px; flex-wrap: wrap; }

/* Camera */

/* Modal */
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 300; }
.modal { width: 360px; }
.modal-title { font-size: 12px; font-weight: 600; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 14px; }

.btn-sm { padding: 6px 12px; font-size: 12px; }
.btn-xs { padding: 4px 8px; font-size: 11px; }
</style>
