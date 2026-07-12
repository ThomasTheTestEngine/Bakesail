import { createRouter, createWebHistory } from 'vue-router'
import { useDeviceStore } from '../stores/device.js'
import { useSettingsStore } from '../stores/settings.js'

import DashboardRouter from '../views/DashboardRouter.vue'
import SetupWizard     from '../views/wizard/SetupWizard.vue'
import ProfileManager  from '../views/ProfileManager.vue'
import Cameras         from '../views/Cameras.vue'
import Calibration     from '../views/Calibration.vue'
import Alignment       from '../views/Alignment.vue'
import Settings        from '../views/Settings.vue'
import JobQueue        from '../views/JobQueue.vue'
import MaterialLibrary from '../views/MaterialLibrary.vue'
import FileExplorer      from '../views/FileExplorer.vue'
import PrinterJobManager from '../views/PrinterJobManager.vue'
import GcodeViewer      from '../views/GcodeViewer.vue'

export const routes_extra = [
  { path: '/wizard', name: 'wizard', component: SetupWizard },
]

// ── Tab definitions ────────────────────────────────────────────
// hiddenFor: array of deviceType values where this tab is NOT shown.
// onlyFor:   array of deviceType values where this tab IS shown (exclusive).

export const ALL_TABS = [
  {
    path: '/',
    name: 'dashboard',
    label: 'Dashboard',
    icon: '◈',
    component: DashboardRouter,
  },
  {
    path: '/profiles',
    name: 'profiles',
    label: 'Profile Manager',
    icon: '⊞',
    component: ProfileManager,
    hiddenFor: ['laser_plotter', '3d_printer'],  // 3d_printer gets Job Manager instead
  },
  {
    path: '/job-queue',
    name: 'job-queue',
    label: 'Job Queue',
    icon: '⊡',
    component: JobQueue,
    onlyFor: ['laser_plotter'],
  },
  {
    path: '/printer-jobs',
    name: 'printer-jobs',
    label: 'Job Manager',
    icon: '⊡',
    component: PrinterJobManager,
    onlyFor: ['3d_printer'],
  },
  {
    path: '/gcode-viewer',
    name: 'gcode-viewer',
    label: 'Gcode Viewer',
    icon: '◈',
    component: GcodeViewer,
    onlyFor: ['3d_printer'],
  },
  {
    path: '/material-library',
    name: 'material-library',
    label: 'Material Library',
    icon: '◧',
    component: MaterialLibrary,
    onlyFor: ['laser_plotter'],
  },
  {
    path: '/cameras',
    name: 'cameras',
    label: 'Cameras',
    icon: '⊙',
    component: Cameras,
  },
  {
    path: '/calibration',
    name: 'calibration',
    label: 'Calibration',
    icon: '◎',
    component: Calibration,
  },
  {
    path: '/files',
    name: 'files',
    label: 'File Manager',
    icon: '◫',
    component: FileExplorer,
  },
  {
    path: '/alignment',
    name: 'alignment',
    label: 'Alignment',
    icon: '⊕',
    component: Alignment,
    hiddenFor: ['hot_plate', 'laser_plotter', '3d_printer'],
    meta: { requiresSemiAuto: true },
  },
  {
    path: '/settings',
    name: 'settings',
    label: 'Settings',
    icon: '⊗',
    component: Settings,
  },
]

// Helper — returns the tabs visible for a given deviceType
export function tabsForDevice(deviceType) {
  return ALL_TABS.filter(tab => {
    if (tab.onlyFor  && !tab.onlyFor.includes(deviceType))  return false
    if (tab.hiddenFor && tab.hiddenFor.includes(deviceType)) return false
    return true
  })
}

// Legacy export kept for any existing imports
export const tabs = ALL_TABS

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    ...routes_extra,
    ...ALL_TABS.map(t => ({
      path:      t.path,
      name:      t.name,
      component: t.component,
      meta:      t.meta || {},
    })),
  ],
})

// Guard: alignment only for semi-auto/automatic
// Guard: redirect laser-hidden tabs back to dashboard
router.beforeEach((to) => {
  const deviceStore   = useDeviceStore()
  const settingsStore = useSettingsStore()
  const deviceType    = settingsStore.deviceType || 'oven'

  if (to.meta.requiresSemiAuto) {
    if (!deviceStore.isSemiAuto) return { name: 'dashboard' }
  }

  const tab = ALL_TABS.find(t => t.name === to.name)
  if (tab) {
    if (tab.onlyFor   && !tab.onlyFor.includes(deviceType))   return { name: 'dashboard' }
    if (tab.hiddenFor &&  tab.hiddenFor.includes(deviceType))  return { name: 'dashboard' }
  }
})
