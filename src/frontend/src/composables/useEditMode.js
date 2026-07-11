/**
 * useEditMode.js
 *
 * Singleton reactive flag: true when any dashboard is in customize mode.
 * DashboardCustomizeBar sets it; the topbar reads it to show macro editing controls.
 */
import { ref } from 'vue'

const editing = ref(false)

export function useEditMode() {
  return { editing }
}
