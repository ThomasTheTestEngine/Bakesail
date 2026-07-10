/**
 * cameraTypes.js
 *
 * Single source of truth for camera "type" → display label.
 * Two sets of types exist: rework/BGA types for all other device modes,
 * and 3D-printer-specific types for 3d_printer mode.
 */

// BGA / rework station types (non-3d_printer modes)
export const CAMERA_TYPE_LABELS = {
  bga_grid:        'BGA Grid',
  alignment_chip:  'Alignment - Chip',
  alignment_board: 'Alignment - Board',
  custom:          'Custom',
}

// 3D printer camera types.
// All except 'custom' use the type label as the display name (no renaming).
export const CAMERA_TYPE_LABELS_3D = {
  printer:  'Printer',
  nozzle:   'Nozzle',
  bed:      'Bed',
  filament: 'Filament',
  door:     'Door',
  custom:   'Custom',
}

// Types that allow a custom name (regardless of device mode)
export const CUSTOM_NAME_TYPES = new Set(['custom'])

export function cameraTypeLabel(type) {
  return CAMERA_TYPE_LABELS[type] || CAMERA_TYPE_LABELS_3D[type] || type
}

/**
 * Resolve the display name for a camera object: explicit name wins for
 * 'custom' type; otherwise falls back to the type label.
 */
export function cameraDisplayName(cam) {
  if (!cam) return 'Camera'
  if (cam.name && CUSTOM_NAME_TYPES.has(cam.type)) return cam.name
  return cameraTypeLabel(cam.type) || cam.name || 'Camera'
}
