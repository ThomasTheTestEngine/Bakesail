<template>
  <component :is="dashboardComponent" />
</template>

<script setup>
/**
 * DashboardRouter.vue
 *
 * Thin router: looks at the current device type and renders the appropriate
 * dashboard component. This is the only place that knows about the
 * device-type → dashboard mapping.
 *
 * To add a new device type:
 *   1. Create src/views/YourDashboard.vue  (copy PrinterDashboard.vue as a starting point)
 *   2. Import it below
 *   3. Add an entry to DASHBOARD_MAP
 *   That's it. Nothing else needs to change.
 */

import { computed } from 'vue'
import { useSettingsStore } from '../stores/settings.js'

import ThermalDashboard from './ThermalDashboard.vue'
import LaserDashboard   from './LaserDashboard.vue'
import PrinterDashboard from './PrinterDashboard.vue'

const settings = useSettingsStore()

// ── Device type → dashboard component ─────────────────────────
// Thermal types share one dashboard; add new types by extending this map.
const DASHBOARD_MAP = {
  oven:          ThermalDashboard,
  ir_rework:     ThermalDashboard,
  hot_air:       ThermalDashboard,
  hot_plate:     ThermalDashboard,
  laser_plotter: LaserDashboard,
  '3d_printer':  PrinterDashboard,
}

const dashboardComponent = computed(() =>
  DASHBOARD_MAP[settings.deviceType] ?? ThermalDashboard
)
</script>
