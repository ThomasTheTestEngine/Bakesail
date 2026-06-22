import { createRouter, createWebHistory } from 'vue-router'
import { useDeviceStore } from '../stores/device.js'

import Dashboard      from '../views/Dashboard.vue'
import SetupWizard    from '../views/wizard/SetupWizard.vue'
import ProfileManager from '../views/ProfileManager.vue'
import Cameras        from '../views/Cameras.vue'
import Calibration    from '../views/Calibration.vue'
import Alignment      from '../views/Alignment.vue'
import Settings       from '../views/Settings.vue'

export const routes_extra = [
  { path: '/wizard', name: 'wizard', component: SetupWizard },
]

export const tabs = [
  { path: '/',           name: 'dashboard',      label: 'Dashboard',        icon: '◈', component: Dashboard      },
  { path: '/profiles',   name: 'profiles',        label: 'Profile Manager',  icon: '⊞', component: ProfileManager  },
  { path: '/cameras',    name: 'cameras',          label: 'Cameras',          icon: '⊙', component: Cameras        },
  { path: '/calibration',name: 'calibration',     label: 'Calibration',      icon: '◎', component: Calibration    },
  { path: '/alignment',  name: 'alignment',        label: 'Alignment',        icon: '⊕', component: Alignment,
    meta: { requiresSemiAuto: true } },
  { path: '/settings',   name: 'settings',         label: 'Settings',         icon: '⊗', component: Settings       },
]

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    ...routes_extra,
    ...tabs.map(t => ({
    path:      t.path,
    name:      t.name,
    component: t.component,
    meta:      t.meta || {},
  }))],
})

// Guard Alignment tab — only accessible when semi-auto machine type is configured
router.beforeEach((to) => {
  if (to.meta.requiresSemiAuto) {
    const store = useDeviceStore()
    if (!store.isSemiAuto) return { name: 'dashboard' }
  }
})
