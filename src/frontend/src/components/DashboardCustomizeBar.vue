<!--
  DashboardCustomizeBar.vue

  Shared "customize mode" shell for every device dashboard:
  - Gear button teleported into the global topbar (App.vue's #topbar-page-slot)
  - One toolbar (Add Widget / Load Saved / Save As / Reset / Apply),
    shown only while customizing

  This is the pattern PrinterDashboard.vue originated (the most
  fleshed-out dashboard). ThermalDashboard.vue and LaserDashboard.vue
  previously used an older pattern instead — a page-local toolbar just
  for the gear button, plus a separate sticky footer at the bottom for
  Load/Save/Reset/Apply. Two places to look instead of one, and it
  meant every new device type had to invent its own version of this
  shell. Now there's one implementation and every dashboard — including
  future ones — just plugs into it.

  Props:
    layout            useDashboardLayout() instance for this dashboard
    widgetDefs        that dashboard's WIDGET_DEFS array. A def can set
                       `multiple: true` for widget types that may be
                       added more than once (e.g. camera) — everything
                       else disappears from "Add Widget" once one is on
                       the canvas.
    dashboardId       short id used in save/load filenames, e.g. 'printer'
    getDefaultLayout  optional fn returning a fresh default layout array,
                       for dashboards whose default depends on live state
                       (e.g. Thermal's zone count). Omit for a static default.
-->
<template>
  <Teleport to="#topbar-page-slot">
    <button
      class="topbar-customize-btn"
      :class="{ 'topbar-customize-btn--active': layout.customizeMode.value }"
      :title="layout.customizeMode.value ? 'Exit customize' : 'Customize dashboard'"
      @click.stop="layout.customizeMode.value ? exitCustomize() : enterCustomize()"
    >⚙</button>
  </Teleport>

  <div class="dash-toolbar" v-if="layout.customizeMode.value">
    <div class="dt-right" style="width:100%;justify-content:flex-end">
      <button class="btn btn-ghost btn-sm" @click="toggleLoadMenu">{{ showLoadMenu ? '✕' : 'Load Saved' }}</button>
      <div v-if="showLoadMenu" class="load-menu" @click.stop>
        <div v-if="layout.loadingLayouts.value" class="load-menu-item" style="opacity:0.5">Loading…</div>
        <div v-else-if="!layout.availableLayouts.value.length" class="load-menu-item" style="opacity:0.5">No saved layouts</div>
        <button v-else v-for="f in layout.availableLayouts.value" :key="f" class="load-menu-item" @click="doLoadLayout(f)">
          {{ f.replace(`bakesail_dashboard_${dashboardId}_`, '').replace('.json', '') }}
        </button>
      </div>

      <button class="btn btn-ghost btn-sm" @click="promptSaveAs">Save As…</button>
      <button class="btn btn-ghost btn-sm" @click="doRevert">↺ Reset</button>
      <button class="btn btn-ghost btn-sm" @click="doFitScreen" title="Expand all widget edges to fill gaps and reach canvas boundary">⤢ Fit Screen</button>
      <span v-if="layout.saveMsg.value" class="dt-save-msg">{{ layout.saveMsg.value }}</span>

      <div class="add-widget-wrap" @click.stop>
        <button class="btn btn-primary btn-sm" @click="layout.addWidgetOpen.value = !layout.addWidgetOpen.value">
          + Add Widget
        </button>
        <div v-if="layout.addWidgetOpen.value" class="add-widget-dropdown">
          <button v-for="def in availableToAdd" :key="def.type" class="add-widget-item"
                  @click="layout.addWidget(def.type, widgetDefs)">
            {{ def.label }}
          </button>
          <div v-if="!availableToAdd.length" class="add-widget-item" style="opacity:0.5;cursor:default">Nothing to add</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, inject } from 'vue'

const props = defineProps({
  layout:           { type: Object,   required: true },
  widgetDefs:       { type: Array,    required: true },
  dashboardId:      { type: String,   required: true },
  getDefaultLayout: { type: Function, default: null },
})

// PrinterDashboard originated this signal (used to show the drag handle /
// adjust the topbar while dragging widgets around). Every dashboard now
// wires it consistently, even if App.vue doesn't yet read it anywhere else.
const setCustomizing = inject('setCustomizing', () => {})

function enterCustomize() {
  props.layout.enterCustomize()
  setCustomizing(true)
}
function exitCustomize() {
  setCustomizing(false)
  props.layout.applyLayout()   // saves + exits (same as old Apply button)
  showLoadMenu.value = false
}

function doRevert() {
  if (props.getDefaultLayout) props.layout.revertToDefault(props.getDefaultLayout())
  else props.layout.revertToDefault()
}

function doFitScreen() {
  const content = document.querySelector('.content')
  const canvas  = document.querySelector('.pd-root, .td-root, .ld-root, .dashboard-root')
  if (!canvas || !content) return

  // availW: the canvas element's own rendered width (no guessing)
  const availW = canvas.offsetWidth

  // availH: viewport height minus everything ABOVE the canvas (topbar, cbar,
  // customize toolbar) and everything BELOW it (cbar). We compute this by
  // finding where the canvas starts inside the content scroll area and how
  // much content-area height is left from there.
  // canvas.getBoundingClientRect().top = distance from viewport top to canvas top
  // content.getBoundingClientRect().bottom = distance from viewport top to content bottom
  const canvasTop     = canvas.getBoundingClientRect().top
  const contentBottom = content.getBoundingClientRect().bottom
  const availH        = Math.max(200, contentBottom - canvasTop)

  props.layout.fitScreen(availW, availH)
}

// ── Add widget dropdown ──────────────────────────────────────────
const availableToAdd = computed(() => {
  const onCanvas = new Set(props.layout.widgets.value.map(w => w.type))
  return props.widgetDefs.filter(d => d.multiple || !onCanvas.has(d.type))
})

// ── Load menu ─────────────────────────────────────────────────────
const showLoadMenu = ref(false)
async function toggleLoadMenu() {
  showLoadMenu.value = !showLoadMenu.value
  if (showLoadMenu.value) await props.layout.fetchAvailableLayouts()
}
async function doLoadLayout(f) {
  await props.layout.loadLayout(f.replace(/^.*\//, ''))
  showLoadMenu.value = false
}

function promptSaveAs() {
  const name = prompt('Save layout as:', `my_${props.dashboardId}_layout`)
  if (name) props.layout.saveLayout(name)
}
</script>

<style scoped>
.dash-toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-shrink: 0; gap: 10px; position: relative; flex-wrap: wrap; }
.dt-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.dt-save-msg { font-size: 11px; color: var(--green); font-family: var(--font-mono); }

.add-widget-wrap { position: relative; }
.add-widget-dropdown { position: absolute; top: 32px; left: 0; z-index: 200; background: var(--surface); border: 1px solid var(--border-2); border-radius: var(--radius); padding: 6px; display: flex; flex-direction: column; gap: 2px; min-width: 180px; }
.add-widget-item { text-align: left; padding: 6px 10px; background: transparent; border: none; color: var(--text-dim); font-size: 12px; cursor: pointer; border-radius: var(--radius); transition: background 0.1s; }
.add-widget-item:hover { background: var(--surface-2); color: var(--text); }

.load-menu { position: absolute; top: 40px; right: 80px; z-index: 200; background: var(--surface); border: 1px solid var(--border-2); border-radius: var(--radius); padding: 6px; display: flex; flex-direction: column; gap: 2px; min-width: 180px; }
.load-menu-item { text-align: left; padding: 6px 10px; background: transparent; border: none; color: var(--text-dim); font-size: 12px; cursor: pointer; border-radius: var(--radius); transition: background 0.1s; }
.load-menu-item:hover { background: var(--surface-2); color: var(--text); }
</style>
