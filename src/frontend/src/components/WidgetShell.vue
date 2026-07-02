<!--
  WidgetShell.vue — reusable wrapper for every dashboard widget.
  In normal mode: plain card. In customize mode: drag bar, resize handles,
  minus button, gear settings popout.
-->
<template>
  <div
    class="widget-shell"
    :class="{ 'widget-shell--customize': customizeMode }"
    :style="shellStyle"
  >
    <template v-if="customizeMode">
      <!-- Remove button top-left -->
      <button class="ws-remove-btn" @click.stop="$emit('remove', widget.id)" title="Remove widget">−</button>

      <!-- Drag handle bar -->
      <div class="ws-drag-bar"
           @pointerdown.prevent="$emit('startDrag', $event, widget.id)">
        <span class="ws-type-label">{{ widgetLabel || widget.type }}</span>
        <div class="ws-drag-bar-actions">
          <button class="ws-icon-btn" @click.stop="$emit('toggleSettings', widget.id)" title="Widget settings">⚙</button>
        </div>
      </div>

      <!-- Resize handles -->
      <div class="ws-resize ws-resize--e"  @pointerdown.prevent.stop="$emit('startResize', $event, widget.id, 'e')"></div>
      <div class="ws-resize ws-resize--s"  @pointerdown.prevent.stop="$emit('startResize', $event, widget.id, 's')"></div>
      <div class="ws-resize ws-resize--se" @pointerdown.prevent.stop="$emit('startResize', $event, widget.id, 'se')"></div>
      <div class="ws-resize ws-resize--sw" @pointerdown.prevent.stop="$emit('startResize', $event, widget.id, 'sw')"></div>
      <div class="ws-resize ws-resize--w"  @pointerdown.prevent.stop="$emit('startResize', $event, widget.id, 'w')"></div>
      <div class="ws-resize ws-resize--n"  @pointerdown.prevent.stop="$emit('startResize', $event, widget.id, 'n')"></div>
      <div class="ws-resize ws-resize--ne" @pointerdown.prevent.stop="$emit('startResize', $event, widget.id, 'ne')"></div>
      <div class="ws-resize ws-resize--nw" @pointerdown.prevent.stop="$emit('startResize', $event, widget.id, 'nw')"></div>

      <!-- Settings popout -->
      <div v-if="settingsOpen" class="ws-popout" @click.stop @pointerdown.stop>
        <button class="ws-close-btn" @click="$emit('closeSettings')">✕</button>
        <div class="ws-popout-title">Widget Settings</div>

        <div class="ws-field-row">
          <label class="ws-field-label">Font size</label>
          <input class="ws-field-input ws-field-input--sm" type="number"
                 v-model.number="widget.config.fontSize" min="10" max="72" />
          <span class="ws-field-unit">px</span>
        </div>

        <div class="ws-field-row">
          <label class="ws-field-label">Value colour</label>
          <input class="ws-color-swatch" type="color"
                 :value="widget.config.valueColor || '#E8E8E8'"
                 @input="widget.config.valueColor = $event.target.value" />
        </div>

        <div class="ws-field-row">
          <label class="ws-field-label">Background</label>
          <input class="ws-color-swatch" type="color"
                 :value="widget.config.bgColor || '#141414'"
                 @input="widget.config.bgColor = $event.target.value" />
          <button class="ws-clear-btn" @click="delete widget.config.bgColor" title="Clear">↺</button>
        </div>

        <div v-if="allFields && allFields.length > 0" class="ws-fields-section">
          <div class="ws-fields-title">Display</div>
          <label v-for="f in allFields" :key="f.key" class="ws-field-toggle">
            <input type="checkbox"
                   :checked="!widget.config.hiddenFields?.includes(f.key)"
                   @change="toggleField(f.key, $event.target.checked)" />
            {{ f.label }}
          </label>
        </div>

        <!-- Camera selector (only for camera widgets) -->
        <div v-if="widget.type === 'camera' && availableCameras.length > 0" class="ws-fields-section">
          <div class="ws-fields-title">Camera</div>
          <select class="ws-field-input" style="width:100%;flex:none"
                  v-model="widget.config.cameraId">
            <option :value="null">First available</option>
            <option v-for="cam in availableCameras" :key="cam.id" :value="cam.id">
              {{ cam.name || cam.type }}{{ cam.test ? ' (TEST)' : '' }}
            </option>
          </select>
        </div>

        <!-- Chart height slider (only for monitor/chart widgets) -->
        <div v-if="widget.type === 'chart'" class="ws-fields-section">
          <div class="ws-fields-title">Chart Height</div>
          <div class="ws-slider-row">
            <input type="range" min="100" max="500" step="10"
                   :value="widget.config.chartHeight ?? 180"
                   @input="widget.config.chartHeight = parseInt($event.target.value)"
                   class="ws-field-input" style="flex:1;padding:0" />
            <span class="ws-slider-val">{{ widget.config.chartHeight ?? 180 }}px</span>
          </div>
        </div>

        <button class="ws-revert-btn" @click="revertConfig">↺ Revert widget to defaults</button>
      </div>
    </template>

    <!-- Content slot -->
    <div class="ws-content"
         :style="contentStyle"
         :class="{ 'ws-content--customize': customizeMode }">
      <slot />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useSettingsStore } from '../stores/settings.js'

const props = defineProps({
  widgetLabel: { type: String, default: null },
  widget:        { type: Object,  required: true },
  customizeMode: { type: Boolean, default: false },
  settingsOpen:  { type: Boolean, default: false },
  allFields:     { type: Array,   default: () => [] },
  defaultConfig: { type: Object,  default: () => ({}) },
})

defineEmits(['startDrag','startResize','remove','toggleSettings','closeSettings'])

const _settings = useSettingsStore()
const availableCameras = computed(() => Array.isArray(_settings.cameras) ? _settings.cameras : [])

const shellStyle = computed(() => {
  const s = {
    left:   props.widget.x + 'px',
    top:    props.widget.y + 'px',
    width:  props.widget.w + 'px',
    height: props.widget.h + 'px',
  }
  if (props.widget.config?.bgColor) s.background = props.widget.config.bgColor
  return s
})

const contentStyle = computed(() => {
  const s = {}
  if (props.widget.config?.fontSize)   s['--widget-font-size']   = props.widget.config.fontSize + 'px'
  if (props.widget.config?.valueColor) s['--widget-value-color'] = props.widget.config.valueColor
  return s
})

function toggleField(key, checked) {
  if (!props.widget.config.hiddenFields) props.widget.config.hiddenFields = []
  if (checked) {
    props.widget.config.hiddenFields = props.widget.config.hiddenFields.filter(k => k !== key)
  } else {
    if (!props.widget.config.hiddenFields.includes(key)) props.widget.config.hiddenFields.push(key)
  }
}

function revertConfig() {
  const keep = { hiddenFields: [], fontSize: null, valueColor: null, bgColor: null }
  Object.assign(props.widget.config, JSON.parse(JSON.stringify(props.defaultConfig)), keep)
}
</script>

<style scoped>
.widget-shell {
  position: absolute;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-sizing: border-box;
  overflow: visible;
}
.widget-shell--customize {
  border-color: var(--amber-dim);
  box-shadow: 0 0 0 1px var(--amber-dim);
}

/* Remove button */
.ws-remove-btn {
  position: absolute;
  top: 4px; left: 6px;
  width: 20px; height: 20px;
  border-radius: 50%;
  border: 1px solid var(--red);
  background: var(--surface);
  color: var(--red);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  z-index: 5;
  transition: background 0.1s;
}
.ws-remove-btn:hover { background: var(--red-glow); }

/* Drag bar */
.ws-drag-bar {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 28px;
  background: rgba(240,127,170,0.08);
  border-bottom: 1px solid var(--amber-dim);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 32px;
  cursor: grab;
  user-select: none;
  z-index: 2;
}
.ws-drag-bar:active { cursor: grabbing; }
.ws-type-label {
  font-size: 9px; font-weight: 700;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--amber); opacity: 0.7;
}
.ws-drag-bar-actions { display: flex; gap: 4px; }
.ws-icon-btn {
  width: 20px; height: 20px;
  border-radius: 3px; border: none;
  background: transparent; color: var(--amber);
  font-size: 13px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  opacity: 0.7; transition: opacity 0.1s, background 0.1s;
}
.ws-icon-btn:hover { opacity: 1; background: var(--amber-glow); }

/* Resize handles */
.ws-resize { position: absolute; z-index: 4; }
.ws-resize--e  { right: -4px; top: 10%; height: 80%; width: 8px;  cursor: ew-resize; }
.ws-resize--w  { left: -4px;  top: 10%; height: 80%; width: 8px;  cursor: ew-resize; }
.ws-resize--s  { bottom: -4px; left: 10%; width: 80%; height: 8px; cursor: ns-resize; }
.ws-resize--n  { top: -4px;   left: 10%; width: 80%; height: 8px; cursor: ns-resize; }
.ws-resize--se { right: -5px; bottom: -5px; width: 12px; height: 12px; cursor: se-resize; }
.ws-resize--sw { left: -5px;  bottom: -5px; width: 12px; height: 12px; cursor: sw-resize; }
.ws-resize--ne { right: -5px; top: -5px;    width: 12px; height: 12px; cursor: ne-resize; }
.ws-resize--nw { left: -5px;  top: -5px;    width: 12px; height: 12px; cursor: nw-resize; }

/* Settings popout */
.ws-popout {
  position: absolute;
  top: 32px; right: 0;
  width: 230px;
  background: var(--surface);
  border: 1px solid var(--amber-dim);
  border-radius: var(--radius-lg);
  padding: 14px 14px 12px;
  z-index: 100;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  display: flex; flex-direction: column; gap: 8px;
}
.ws-popout-title {
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.10em; text-transform: uppercase;
  color: var(--text-muted); margin-bottom: 2px;
}
.ws-close-btn {
  position: absolute; top: 8px; right: 8px;
  width: 18px; height: 18px;
  border: none; background: transparent;
  color: var(--text-muted); cursor: pointer; font-size: 12px;
}
.ws-close-btn:hover { color: var(--text); }
.ws-field-row { display: flex; align-items: center; gap: 8px; }
.ws-field-label { font-size: 11px; color: var(--text-dim); flex: 1; }
.ws-slider-row { display: flex; align-items: center; gap: 8px; }
.ws-slider-val { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); flex-shrink: 0; }
.ws-field-input {
  background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 4px; padding: 4px 6px;
  color: var(--text); font-size: 12px; outline: none;
}
.ws-field-input--sm { width: 54px; }
.ws-field-unit { font-size: 11px; color: var(--text-muted); }
.ws-color-swatch {
  width: 28px; height: 22px;
  border: 1px solid var(--border); border-radius: 4px;
  padding: 1px; background: transparent; cursor: pointer;
}
.ws-clear-btn {
  width: 20px; height: 20px; background: transparent;
  border: none; color: var(--text-muted); cursor: pointer; font-size: 13px;
}
.ws-clear-btn:hover { color: var(--amber); }
.ws-fields-section { margin-top: 4px; }
.ws-fields-title {
  font-size: 10px; font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--text-muted); margin-bottom: 6px;
}
.ws-field-toggle {
  display: flex; align-items: center; gap: 7px;
  font-size: 12px; color: var(--text-dim);
  cursor: pointer; padding: 3px 0;
}
.ws-field-toggle input[type="checkbox"] { accent-color: var(--amber); }
.ws-revert-btn {
  margin-top: 4px; padding: 5px 8px;
  border-radius: var(--radius); border: 1px solid var(--border-2);
  background: transparent; color: var(--text-muted);
  font-size: 11px; cursor: pointer; text-align: left;
  transition: color 0.1s, border-color 0.1s;
}
.ws-revert-btn:hover { color: var(--amber); border-color: var(--amber-dim); }

/* Content */
.ws-content {
  position: absolute; inset: 0;
  padding: 16px; overflow: hidden; box-sizing: border-box;
}
.ws-content--customize {
  top: 28px;
  pointer-events: none;
}
</style>
