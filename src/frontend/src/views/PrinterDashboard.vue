<template>
  <div class="pd-root">

    <!-- ── Klippy not ready ──────────────────────────────────── -->
    <div v-if="klippyState !== 'ready'" class="pd-offline">
      <div class="pd-offline-dot"></div>
      <span>{{ klippyState === 'disconnected' ? 'Connecting to Klipper…' : 'Klipper ' + klippyState }}</span>
    </div>

    <!-- ── Toolbar ────────────────────────────────────────────── -->
    <!-- Toolbar only visible in customize mode -->
    <div class="dash-toolbar" v-if="layout.customizeMode.value">
      <div class="dt-right" style="width:100%;justify-content:flex-end">
        <!-- Add Widget -->
        <div class="add-widget-wrap" @click.stop>
          <button class="btn btn-ghost btn-sm" @click="layout.addWidgetOpen.value = !layout.addWidgetOpen.value">
            + Add Widget
          </button>
          <div v-if="layout.addWidgetOpen.value" class="add-widget-dropdown">
            <button
              v-for="def in availableToAdd" :key="def.type"
              class="add-widget-item"
              @click="layout.addWidget(def.type, WIDGET_DEFS)"
            >{{ def.label }}</button>
            <div v-if="!availableToAdd.length" class="add-widget-item" style="opacity:0.5;cursor:default">Nothing to add</div>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" @click="toggleLoadMenu">{{ showLoadMenu ? '✕' : 'Load Saved' }}</button>
        <div v-if="showLoadMenu" class="load-menu" @click.stop>
          <div v-if="layout.loadingLayouts.value" class="load-menu-item" style="opacity:0.5">Loading…</div>
          <div v-else-if="!layout.availableLayouts.value.length" class="load-menu-item" style="opacity:0.5">No saved layouts</div>
          <button v-else v-for="f in layout.availableLayouts.value" :key="f" class="load-menu-item" @click="doLoadLayout(f)">
            {{ f.replace('bakesail_dashboard_printer_','').replace('.json','') }}
          </button>
        </div>
        <button class="btn btn-ghost btn-sm" @click="promptSaveAs">Save As…</button>
        <button class="btn btn-ghost btn-sm" @click="layout.revertToDefault()">↺ Reset</button>
        <button class="btn btn-primary btn-sm" @click="layout.applyLayout()">✓ Apply</button>
        <span v-if="layout.saveMsg.value" class="dt-save-msg">{{ layout.saveMsg.value }}</span>
      </div>
    </div>

    <!-- Gear button teleported into topbar slot -->
    <Teleport to="#topbar-page-slot">
      <button
        class="topbar-customize-btn"
        :class="{ 'topbar-customize-btn--active': layout.customizeMode.value }"
        :title="layout.customizeMode.value ? 'Exit customize' : 'Customize dashboard'"
        @click.stop="layout.customizeMode.value ? exitCustomize() : (layout.enterCustomize(), setCustomizing(true))"
      >⚙</button>
    </Teleport>

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
          <div class="w-state">
            <div class="ws-status" :style="{ color: stateColour }">{{ stateLabel }}</div>
            <div class="ws-filename" v-if="printer.filename && !isFieldHidden(w,'filename')">{{ printer.filename }}</div>
            <div class="ws-layer" v-if="printer.currentLayer && !isFieldHidden(w,'layer')">
              Layer {{ printer.currentLayer }}<span v-if="printer.totalLayers"> / {{ printer.totalLayers }}</span>
            </div>
          </div>
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

        <!-- ── Monitor ───────────────────────────────────────── -->
        <template v-else-if="w.type === 'chart'">
          <div class="w-monitor">

            <!-- Temperature chart -->
            <template v-if="!isFieldHidden(w,'tempchart')">
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
              <div class="wmon-chart-wrap"
                   :style="{ height: (w.config?.chartHeight ?? 180) + 'px' }">
                <canvas :ref="el => { if (el) chartCanvases[w.id] = el }" style="width:100%;height:100%;display:block"></canvas>
              </div>

            </template>

            <!-- Temperatures -->
            <template v-if="!isFieldHidden(w,'temps')">
              <div class="wmon-section-title" style="margin-top:8px">TEMPERATURES</div>
              <div class="wmon-sensor-grid">
                <!-- Extruder -->
                <div class="wmon-sensor-row">
                  <span class="wmon-sensor-name">Extruder</span>
                  <span class="wmon-sensor-val">{{ printer.hotendTemp?.toFixed(1) ?? '—' }}°C</span>
                  <span class="wmon-sensor-target" v-if="printer.hotendTarget > 0">→ {{ printer.hotendTarget.toFixed(0) }}°</span>
                </div>
                <!-- Bed -->
                <div class="wmon-sensor-row">
                  <span class="wmon-sensor-name">Bed</span>
                  <span class="wmon-sensor-val">{{ printer.bedTemp?.toFixed(1) ?? '—' }}°C</span>
                  <span class="wmon-sensor-target" v-if="printer.bedTarget > 0">→ {{ printer.bedTarget.toFixed(0) }}°</span>
                </div>
                <!-- Dynamic temperature_sensor * -->
                <div class="wmon-sensor-row" v-for="(obj, name) in tempSensors" :key="name">
                  <span class="wmon-sensor-name">{{ name.replace('temperature_sensor ','') }}</span>
                  <span class="wmon-sensor-val">{{ obj.temperature?.toFixed(1) ?? '—' }}°C</span>
                  <span class="wmon-sensor-target" v-if="obj.target != null && obj.target > 0">→ {{ obj.target.toFixed(0) }}°</span>
                </div>
              </div>
            </template>

            <!-- Fans -->
            <template v-if="!isFieldHidden(w,'fans')">
              <div class="wmon-section-title" style="margin-top:8px">FANS</div>
              <div class="wmon-sensor-grid">
                <div class="wmon-sensor-row">
                  <span class="wmon-sensor-name">Part Fan</span>
                  <span class="wmon-sensor-val">{{ printer.fanSpeed != null ? (printer.fanSpeed*100).toFixed(0)+'%' : '—' }}</span>
                </div>
                <div class="wmon-sensor-row" v-for="(obj, name) in allFans" :key="name">
                  <span class="wmon-sensor-name">{{ name.replace(/^(heater_fan |fan_generic |temperature_fan )/,'') }}</span>
                  <span class="wmon-sensor-val">{{ obj.speed != null ? (obj.speed*100).toFixed(0)+'%' : '—' }}</span>
                  <span class="wmon-sensor-target" v-if="obj.rpm != null">{{ Math.round(obj.rpm) }} RPM</span>
                </div>
              </div>
            </template>

            <!-- Lighting / LEDs -->
            <template v-if="!isFieldHidden(w,'lighting') && ledObjects.length > 0">
              <div class="wmon-section-title" style="margin-top:8px">LIGHTING</div>
              <div class="wmon-sensor-grid">
                <div class="wmon-sensor-row" v-for="(obj, name) in ledObjects" :key="name">
                  <span class="wmon-sensor-name">{{ name.replace(/^(neopixel |led )/,'') }}</span>
                  <div class="wmon-led-swatches">
                    <div v-for="(color, i) in (obj.color_data ?? [])" :key="i" class="wmon-led-swatch"
                         :style="{ background: `rgb(${Math.round(color[0]*255)},${Math.round(color[1]*255)},${Math.round(color[2]*255)})` }">
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- System loads -->
            <template v-if="!isFieldHidden(w,'sysloads')">
              <div class="wmon-section-title" style="margin-top:8px">SYSTEM LOADS</div>
              <div class="wmon-loads">
                <div class="wmon-load-row" v-for="mcu in deviceStore.mcus" :key="mcu.name">
                  <div class="wmon-load-left">
                    <div class="wmon-load-name">
                      <span class="wmon-load-bold">{{ mcu.name }}</span>
                      <span class="wmon-load-chip" v-if="deviceStore.hostInfo?.mcu_info?.[mcu.name]?.chip">
                        ({{ deviceStore.hostInfo.mcu_info[mcu.name].chip }})
                      </span>
                    </div>
                    <div class="wmon-load-detail" v-if="mcu.version">Version: {{ mcu.version }}</div>
                    <div class="wmon-load-detail">
                      <template v-if="mcu.load != null">Load: {{ mcu.load }}, </template>
                      <template v-if="mcu.awake != null">Awake: {{ mcu.awake }}, </template>
                      <template v-if="mcu.freq != null">Freq: {{ mcu.freq }} MHz<template v-if="mcu.temp != null">, </template></template>
                      <template v-if="mcu.temp != null">Temp: {{ mcu.temp }}°C</template>
                    </div>
                  </div>
                  <div class="wmon-load-gauge" v-if="mcu.load != null">
                    <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
                      <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
                      <circle cx="24" cy="24" r="20" fill="none" stroke="var(--teal)" stroke-width="4"
                              stroke-dasharray="125.66"
                              :stroke-dashoffset="125.66 * (1 - Math.min(parseFloat(mcu.load), 1))"
                              stroke-linecap="round" transform="rotate(-90 24 24)"/>
                      <text x="24" y="29" text-anchor="middle" font-size="12" fill="var(--teal)" font-family="var(--font-mono)">
                        {{ Math.round(parseFloat(mcu.load) * 100) }}
                      </text>
                    </svg>
                  </div>
                </div>

                <!-- Host row -->
                <div class="wmon-load-row" v-if="deviceStore.systemStats">
                  <div class="wmon-load-left">
                    <div class="wmon-load-name">
                      <span class="wmon-load-bold">Host</span>
                      <span class="wmon-load-chip" v-if="deviceStore.hostInfo?.cpu_info">
                        ({{ deviceStore.hostInfo.cpu_info.processor }}, {{ deviceStore.hostInfo.cpu_info.bits }})
                      </span>
                    </div>
                    <div class="wmon-load-detail" v-if="deviceStore.hostInfo?.software_info?.moonraker_version">
                      Version: {{ deviceStore.hostInfo.software_info.moonraker_version }}
                    </div>
                    <div class="wmon-load-detail" v-if="deviceStore.hostInfo?.distribution">
                      OS: {{ deviceStore.hostInfo.distribution.name }} {{ deviceStore.hostInfo.distribution.version_parts?.major ?? '' }}
                      ({{ deviceStore.hostInfo.distribution.codename }})
                      · Distro: {{ deviceStore.hostInfo.distribution.like ?? '—' }}
                    </div>
                    <div class="wmon-load-detail">
                      Load: {{ deviceStore.systemStats.sysload?.toFixed(2) ?? '—' }}
                      <template v-if="deviceStore.systemStats.memavail != null && deviceStore.hostInfo?.cpu_info?.total_memory">
                        , Mem: {{ Math.round((deviceStore.hostInfo.cpu_info.total_memory - deviceStore.systemStats.memavail) / 1024) }} MB
                        / {{ (deviceStore.hostInfo.cpu_info.total_memory / 1024 / 1024).toFixed(1) }} GB
                      </template>
                    </div>
                    <template v-if="deviceStore.hostInfo?.network">
                      <div class="wmon-load-detail" v-for="(iface, name) in deviceStore.hostInfo.network" :key="name">
                        {{ name }}
                        <template v-if="iface.ip_addresses?.[0]?.address"> ({{ iface.ip_addresses[0].address }})</template>
                        : Bandwidth: {{ ((iface.bandwidth ?? 0) / 1024).toFixed(1) }} kB/s,
                        Received: {{ ((iface.rx_bytes ?? 0) / 1048576).toFixed(1) }} MB,
                        Transmitted: {{ ((iface.tx_bytes ?? 0) / 1048576).toFixed(1) }} MB
                      </div>
                    </template>
                  </div>
                  <div class="wmon-gauge-pair">
                    <div class="wmon-gauge-wrap" v-if="deviceStore.systemStats.sysload != null">
                      <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
                        <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
                        <circle cx="24" cy="24" r="20" fill="none" stroke="var(--teal)" stroke-width="4"
                                stroke-dasharray="125.66"
                                :stroke-dashoffset="125.66 * (1 - Math.min(deviceStore.systemStats.sysload / (deviceStore.hostInfo?.cpu_info?.cpu_count || 4), 1))"
                                stroke-linecap="round" transform="rotate(-90 24 24)"/>
                        <text x="24" y="29" text-anchor="middle" font-size="12" fill="var(--teal)" font-family="var(--font-mono)">
                          {{ Math.round(Math.min(deviceStore.systemStats.sysload / (deviceStore.hostInfo?.cpu_info?.cpu_count || 4), 1) * 100) }}
                        </text>
                      </svg>
                      <span class="wmon-gauge-label">CPU</span>
                    </div>
                    <div class="wmon-gauge-wrap" v-if="deviceStore.systemStats.memavail != null && deviceStore.hostInfo?.cpu_info?.total_memory">
                      <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
                        <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
                        <circle cx="24" cy="24" r="20" fill="none" stroke="var(--teal)" stroke-width="4"
                                stroke-dasharray="125.66"
                                :stroke-dashoffset="125.66 * (deviceStore.systemStats.memavail / deviceStore.hostInfo.cpu_info.total_memory)"
                                stroke-linecap="round" transform="rotate(-90 24 24)"/>
                        <text x="24" y="29" text-anchor="middle" font-size="12" fill="var(--teal)" font-family="var(--font-mono)">
                          {{ Math.round((1 - deviceStore.systemStats.memavail / deviceStore.hostInfo.cpu_info.total_memory) * 100) }}
                        </text>
                      </svg>
                      <span class="wmon-gauge-label">MEM</span>
                    </div>
                  </div>
                </div>
              </div>
            </template>

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
          <div class="w-monitor" style="overflow-y:auto;height:100%">
              <div class="wmon-section-title" style="margin-top:8px">SYSTEM LOADS</div>
              <div class="wmon-loads">
                <div class="wmon-load-row" v-for="mcu in deviceStore.mcus" :key="mcu.name">
                  <div class="wmon-load-left">
                    <div class="wmon-load-name">
                      <span class="wmon-load-bold">{{ mcu.name }}</span>
                      <span class="wmon-load-chip" v-if="deviceStore.hostInfo?.mcu_info?.[mcu.name]?.chip">
                        ({{ deviceStore.hostInfo.mcu_info[mcu.name].chip }})
                      </span>
                    </div>
                    <div class="wmon-load-detail" v-if="mcu.version">Version: {{ mcu.version }}</div>
                    <div class="wmon-load-detail">
                      <template v-if="mcu.load != null">Load: {{ mcu.load }}, </template>
                      <template v-if="mcu.awake != null">Awake: {{ mcu.awake }}, </template>
                      <template v-if="mcu.freq != null">Freq: {{ mcu.freq }} MHz<template v-if="mcu.temp != null">, </template></template>
                      <template v-if="mcu.temp != null">Temp: {{ mcu.temp }}°C</template>
                    </div>
                  </div>
                  <div class="wmon-load-gauge" v-if="mcu.load != null">
                    <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
                      <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
                      <circle cx="24" cy="24" r="20" fill="none" stroke="var(--teal)" stroke-width="4"
                              stroke-dasharray="125.66"
                              :stroke-dashoffset="125.66 * (1 - Math.min(parseFloat(mcu.load), 1))"
                              stroke-linecap="round" transform="rotate(-90 24 24)"/>
                      <text x="24" y="29" text-anchor="middle" font-size="12" fill="var(--teal)" font-family="var(--font-mono)">
                        {{ Math.round(parseFloat(mcu.load) * 100) }}
                      </text>
                    </svg>
                  </div>
                </div>

                <!-- Host row -->
                <div class="wmon-load-row" v-if="deviceStore.systemStats">
                  <div class="wmon-load-left">
                    <div class="wmon-load-name">
                      <span class="wmon-load-bold">Host</span>
                      <span class="wmon-load-chip" v-if="deviceStore.hostInfo?.cpu_info">
                        ({{ deviceStore.hostInfo.cpu_info.processor }}, {{ deviceStore.hostInfo.cpu_info.bits }})
                      </span>
                    </div>
                    <div class="wmon-load-detail" v-if="deviceStore.hostInfo?.software_info?.moonraker_version">
                      Version: {{ deviceStore.hostInfo.software_info.moonraker_version }}
                    </div>
                    <div class="wmon-load-detail" v-if="deviceStore.hostInfo?.distribution">
                      OS: {{ deviceStore.hostInfo.distribution.name }} {{ deviceStore.hostInfo.distribution.version_parts?.major ?? '' }}
                      ({{ deviceStore.hostInfo.distribution.codename }})
                      · Distro: {{ deviceStore.hostInfo.distribution.like ?? '—' }}
                    </div>
                    <div class="wmon-load-detail">
                      Load: {{ deviceStore.systemStats.sysload?.toFixed(2) ?? '—' }}
                      <template v-if="deviceStore.systemStats.memavail != null && deviceStore.hostInfo?.cpu_info?.total_memory">
                        , Mem: {{ Math.round((deviceStore.hostInfo.cpu_info.total_memory - deviceStore.systemStats.memavail) / 1024) }} MB
                        / {{ (deviceStore.hostInfo.cpu_info.total_memory / 1024 / 1024).toFixed(1) }} GB
                      </template>
                    </div>
                    <template v-if="deviceStore.hostInfo?.network">
                      <div class="wmon-load-detail" v-for="(iface, name) in deviceStore.hostInfo.network" :key="name">
                        {{ name }}
                        <template v-if="iface.ip_addresses?.[0]?.address"> ({{ iface.ip_addresses[0].address }})</template>
                        : Bandwidth: {{ ((iface.bandwidth ?? 0) / 1024).toFixed(1) }} kB/s,
                        Received: {{ ((iface.rx_bytes ?? 0) / 1048576).toFixed(1) }} MB,
                        Transmitted: {{ ((iface.tx_bytes ?? 0) / 1048576).toFixed(1) }} MB
                      </div>
                    </template>
                  </div>
                  <div class="wmon-gauge-pair">
                    <div class="wmon-gauge-wrap" v-if="deviceStore.systemStats.sysload != null">
                      <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
                        <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
                        <circle cx="24" cy="24" r="20" fill="none" stroke="var(--teal)" stroke-width="4"
                                stroke-dasharray="125.66"
                                :stroke-dashoffset="125.66 * (1 - Math.min(deviceStore.systemStats.sysload / (deviceStore.hostInfo?.cpu_info?.cpu_count || 4), 1))"
                                stroke-linecap="round" transform="rotate(-90 24 24)"/>
                        <text x="24" y="29" text-anchor="middle" font-size="12" fill="var(--teal)" font-family="var(--font-mono)">
                          {{ Math.round(Math.min(deviceStore.systemStats.sysload / (deviceStore.hostInfo?.cpu_info?.cpu_count || 4), 1) * 100) }}
                        </text>
                      </svg>
                      <span class="wmon-gauge-label">CPU</span>
                    </div>
                    <div class="wmon-gauge-wrap" v-if="deviceStore.systemStats.memavail != null && deviceStore.hostInfo?.cpu_info?.total_memory">
                      <svg viewBox="0 0 48 48" class="wmon-gauge-svg">
                        <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-2)" stroke-width="4"/>
                        <circle cx="24" cy="24" r="20" fill="none" stroke="var(--teal)" stroke-width="4"
                                stroke-dasharray="125.66"
                                :stroke-dashoffset="125.66 * (deviceStore.systemStats.memavail / deviceStore.hostInfo.cpu_info.total_memory)"
                                stroke-linecap="round" transform="rotate(-90 24 24)"/>
                        <text x="24" y="29" text-anchor="middle" font-size="12" fill="var(--teal)" font-family="var(--font-mono)">
                          {{ Math.round((1 - deviceStore.systemStats.memavail / deviceStore.hostInfo.cpu_info.total_memory) * 100) }}
                        </text>
                      </svg>
                      <span class="wmon-gauge-label">MEM</span>
                    </div>
                  </div>
                </div>
              </div>
          </div>
        </template>

        <!-- ── Console ──────────────────────────────────────── -->
        <template v-else-if="w.type === 'console'">
          <ConsoleWidget style="height:100%" />
        </template>

        <!-- ── Camera Feed ────────────────────────────────────── -->
        <template v-else-if="w.type === 'camera'">
          <CameraWidget :widget="w" />
        </template>

      </WidgetShell>
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

import { ref, reactive, computed, onMounted, onUnmounted, inject } from 'vue'
import { useSettingsStore }   from '../stores/settings.js'
import { useDeviceStore }     from '../stores/device.js'
import { useMoonraker }       from '../composables/useMoonraker.js'
import { useDashboardLayout } from '../composables/useDashboardLayout.js'
import WidgetShell from '../components/WidgetShell.vue'
import CameraWidget   from '../components/CameraWidget.vue'
import ConsoleWidget  from '../components/ConsoleWidget.vue'

const settings = useSettingsStore()
const deviceStore = useDeviceStore()
const setCustomizing = inject('setCustomizing', () => {})
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

const HISTORY_LEN = 300
const tempHistory = reactive({ hotend: [], bed: [] })

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

  const t = Date.now()
  if (data.extruder?.temperature != null) {
    tempHistory.hotend.push({ t, v: printer.hotendTemp })
    if (tempHistory.hotend.length > HISTORY_LEN) tempHistory.hotend.shift()
  }
  if (data.heater_bed?.temperature != null) {
    tempHistory.bed.push({ t, v: printer.bedTemp })
    if (tempHistory.bed.length > HISTORY_LEN) tempHistory.bed.shift()
  }
  // Track temperature_sensor * objects
  for (const [key, val] of Object.entries(data)) {
    if (key.startsWith('temperature_sensor ') && val.temperature != null) {
      if (!tempHistory[key]) tempHistory[key] = []
      tempHistory[key].push({ t, v: val.temperature })
      if (tempHistory[key].length > HISTORY_LEN) tempHistory[key].shift()
    }
  }
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
  { type: 'chart',     label: 'Monitor',             defaultW: 560, defaultH: 500, defaultConfig: { hiddenFields: ['sysloads'] }, fields: [
    { key: 'tempchart', label: 'Temperature chart' },
    { key: 'temps',     label: 'Temperatures' },
    { key: 'fans',      label: 'Fans' },
    { key: 'lighting',  label: 'Lighting' },
    { key: 'sysloads',  label: 'System loads' },
  ] },
  { type: 'sysloads',  label: 'System Loads',          defaultW: 380, defaultH: 400, defaultConfig: {}, fields: [] },
  { type: 'progress',  label: 'Print Progress',      defaultW: 520, defaultH: 120, defaultConfig: {}, fields: [{ key: 'time', label: 'Print time' }, { key: 'eta', label: 'ETA' }, { key: 'filament', label: 'Filament used' }] },
  { type: 'fan',       label: 'Part Fan',            defaultW: 180, defaultH: 140, defaultConfig: { label: 'Part Fan' }, fields: [] },
  { type: 'speedflow', label: 'Extruder',            defaultW: 400, defaultH: 420, defaultConfig: {}, fields: [] },
  { type: 'toolhead',  label: 'Toolhead',            defaultW: 400, defaultH: 460, defaultConfig: {}, fields: [
    { key: 'coords',  label: 'Position display' },
    { key: 'jog',     label: 'Movement buttons' },
    { key: 'zoffset', label: 'Z-Offset adjust' },
    { key: 'speed',   label: 'Speed factor' },
  ] },
  { type: 'controls',  label: 'Print Controls',      defaultW: 600, defaultH: 60,  defaultConfig: {}, fields: [] },
  { type: 'macros',    label: 'Macro Buttons',       defaultW: 400, defaultH: 100, defaultConfig: { macros: ['BED_MESH_CALIBRATE', 'LOAD_FILAMENT', 'UNLOAD_FILAMENT'] }, fields: [] },
  { type: 'console',   label: 'Console',             defaultW: 480, defaultH: 360, defaultConfig: {}, fields: [] },
  { type: 'camera',    label: 'Camera Feed',         defaultW: 320, defaultH: 260, defaultConfig: { cameraId: null }, fields: [{ key: 'label', label: 'Show camera name' }] },
]

function widgetLabel(type)   { return WIDGET_DEFS.find(d => d.type === type)?.label ?? type }
function widgetFields(type)  { return WIDGET_DEFS.find(d => d.type === type)?.fields || [] }
function defaultConfig(type) { return WIDGET_DEFS.find(d => d.type === type)?.defaultConfig || {} }
function isFieldHidden(w, key) { return w.config?.hiddenFields?.includes(key) }

// ── Default layout ─────────────────────────────────────────────
function buildDefaultLayout() {
  const hasCam = settings.cameras.length > 0

  // Measure available canvas width from the DOM, fall back to window width minus sidebar/padding
  const canvasEl = document.querySelector('.pd-root')
  const availW = canvasEl ? canvasEl.offsetWidth - 32 : window.innerWidth - 280

  // Three equal-ish columns: toolhead | camera | extruder+sysloads
  // With camera: split into 3. Without camera: split into 2 (toolhead + extruder)
  const gap = 10
  const numCols = hasCam ? 3 : 2
  const colW = Math.floor((availW - gap * (numCols - 1)) / numCols)
  const camW = hasCam ? colW : 0

  const rightX    = hasCam ? colW + gap + camW + gap : colW + gap
  const rightColX = rightX
  const monitorY  = 470
  const monitorH  = 520
  const extruderH = monitorY - gap
  const totalW    = rightColX + colW

  return [
    { id: 'toolhead',  type: 'toolhead',  x: 0,          y: 0,        w: colW,      h: monitorY - gap, config: {} },
    ...(hasCam ? [{ id: 'camera', type: 'camera', x: colW + gap, y: 0, w: camW, h: monitorY - gap, config: {} }] : []),
    { id: 'speedflow', type: 'speedflow', x: rightColX,  y: 0,        w: colW,      h: extruderH,      config: {} },
    { id: 'chart',     type: 'chart',     x: 0,          y: monitorY, w: rightColX, h: monitorH,       config: { hiddenFields: ['sysloads'] } },
    { id: 'sysloads',  type: 'sysloads',  x: rightColX,  y: monitorY, w: colW,      h: monitorH,       config: {} },
  ]
}

const layout = useDashboardLayout('printer', buildDefaultLayout())

const canvasStyle = computed(() => {
  const minH = layout.widgets.value.reduce((m, w) => Math.max(m, w.y + w.h), 600)
  return { height: (minH + 80) + 'px' }
})

const availableToAdd = computed(() => {
  const onCanvas = new Set(layout.widgets.value.map(w => w.type))
  return WIDGET_DEFS.filter(d => d.type === 'camera' || d.type === 'macros' || !onCanvas.has(d.type))
})

// ── Helpers ────────────────────────────────────────────────────
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
const chartWindows   = reactive({})   // widgetId → minutes (default 60)
const chartHeights   = reactive({})   // widgetId → px height
const hiddenSeries   = reactive({})   // widgetId → { seriesKey: bool }
const seriesMenuOpen = ref(null)
let chartTimer = null

const TIME_WINDOWS = [1, 2, 5, 15, 30, 60, 120, 240, 480]

function chartWindowMins(id) { return chartWindows[id] ?? 60 }
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
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
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

    // X time axis labels — left=oldest, right=now
    const xSteps = 6
    ctx.fillStyle = colT; ctx.font = '10px system-ui'
    for (let i = 0; i <= xSteps; i++) {
      const t = tMin + (windowMs / xSteps) * i
      const x = pad.l + (pw / xSteps) * i
      const ago = Math.round((now - t) / 60000)
      const label = ago === 0 ? 'now' : `-${ago}m`
      ctx.textAlign = i === 0 ? 'left' : i === xSteps ? 'right' : 'center'
      ctx.fillText(label, x, h - 4)
    }

    // Draw each series
    let li = 0
    for (const s of seriesData) {
      if (s.pts.length < 2) { li++; continue }
      ctx.strokeStyle = s.colour; ctx.lineWidth = 1.5; ctx.beginPath()
      s.pts.forEach((p, i) => {
        const x = pad.l + ((p.t - tMin) / windowMs) * pw
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

// ── Customize helpers ──────────────────────────────────────────
const showLoadMenu = ref(false)
function exitCustomize() {
  setCustomizing(false)
  layout.exitCustomize(); showLoadMenu.value = false }
async function toggleLoadMenu() { showLoadMenu.value = !showLoadMenu.value; if (showLoadMenu.value) await layout.fetchAvailableLayouts() }
async function doLoadLayout(f) { await layout.loadLayout(f.replace(/^.*\//, '')); showLoadMenu.value = false }
function promptSaveAs() { const name = prompt('Save layout as:', 'my_printer_layout'); if (name) layout.saveLayout(name) }

// ── Lifecycle ──────────────────────────────────────────────────
let unsubscribe = null

onMounted(async () => {
  await layout.tryAutoLoad()
  unsubscribe = subscribeToStatus(handleStatus)
  chartTimer = setInterval(drawCharts, 1000)
  // Fetch host system info once (OS, distro, memory total, network interfaces)
  try {
    const r = await fetch('/machine/system_info')
    if (r.ok) {
      const d = await r.json()
      deviceStore.updateHostInfo(d.result?.system_info ?? null)
    }
  } catch {}
})

onUnmounted(() => {
  if (unsubscribe) unsubscribe()
  if (chartTimer) clearInterval(chartTimer)
})
</script>

<style scoped>
.pd-root { position: relative; min-height: 100%; padding-bottom: 40px; }

.pd-offline { display: flex; align-items: center; gap: 10px; padding: 10px 14px; margin-bottom: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); font-size: 13px; color: var(--text-dim); }
.pd-offline-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--amber); opacity: 0.5; animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:1} }

.dash-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-shrink: 0; gap: 10px; position: relative; flex-wrap: wrap; }
.dt-left  { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.dt-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.dt-mode-label { font-size: 11px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; color: var(--amber); white-space: nowrap; }
.dt-save-msg { font-size: 11px; color: var(--green); font-family: var(--font-mono); }
.pd-state-label { font-size: 15px; font-weight: 700; letter-spacing: 0.04em; white-space: nowrap; }
.pd-filename { font-size: 12px; color: var(--text-dim); font-family: var(--font-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.customize-btn { transition: color 0.12s, border-color 0.12s; }
.customize-btn--active { color: var(--amber); border-color: var(--amber); }

.add-widget-wrap { position: relative; }
.add-widget-dropdown { position: absolute; top: 32px; left: 0; z-index: 200; background: var(--surface); border: 1px solid var(--border-2); border-radius: var(--radius); padding: 6px; display: flex; flex-direction: column; gap: 2px; min-width: 180px; }
.add-widget-item { text-align: left; padding: 6px 10px; background: transparent; border: none; color: var(--text-dim); font-size: 12px; cursor: pointer; border-radius: var(--radius); transition: background 0.1s; }
.add-widget-item:hover { background: var(--surface-2); color: var(--text); }

.load-menu { position: absolute; top: 40px; right: 80px; z-index: 200; background: var(--surface); border: 1px solid var(--border-2); border-radius: var(--radius); padding: 6px; display: flex; flex-direction: column; gap: 2px; min-width: 180px; }
.load-menu-item { text-align: left; padding: 6px 10px; background: transparent; border: none; color: var(--text-dim); font-size: 12px; cursor: pointer; border-radius: var(--radius); transition: background 0.1s; }
.load-menu-item:hover { background: var(--surface-2); color: var(--text); }

.dash-canvas { position: relative; width: 100%; }
.grid-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }

/* State */
.w-state { display: flex; flex-direction: column; gap: 5px; height: 100%; justify-content: center; }
.ws-status   { font-size: 22px; font-weight: 700; letter-spacing: 0.04em; }
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
.wmon-loads { display: flex; flex-direction: column; gap: 0; }
.wmon-load-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
  gap: 12px;
}
.wmon-load-row:last-child { border-bottom: none; }
.wmon-load-left { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.wmon-load-name { display: flex; align-items: baseline; gap: 6px; }
.wmon-load-bold { font-size: 13px; font-weight: 700; }
.wmon-load-chip { font-size: 11px; color: var(--text-muted); }
.wmon-load-detail { font-size: 11px; color: var(--text-dim); line-height: 1.5; }
.wmon-gauge-svg { width: 48px; height: 48px; flex-shrink: 0; }
.wmon-gauge-pair { display: flex; gap: 8px; flex-shrink: 0; align-items: flex-start; }
.wmon-gauge-wrap { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.wmon-gauge-label { font-size: 10px; color: var(--text-muted); font-weight: 600; letter-spacing: 0.06em; }

.wmon-sensor-grid { display: flex; flex-direction: column; gap: 0; }
.wmon-sensor-row { display: flex; align-items: baseline; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--border); }
.wmon-sensor-row:last-child { border-bottom: none; }
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
.wmon-chart-wrap { flex-shrink: 0; width: 100%; }
.wmon-chart-resize { padding: 2px 0; }
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
