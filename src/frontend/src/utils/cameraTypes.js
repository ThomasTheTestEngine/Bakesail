/**
 * cameraTypes.js
 *
 * Single source of truth for camera "type" → display label.
 * Previously this map was copy-pasted independently in CameraFeed.vue,
 * Cameras.vue, and Settings.vue — this file replaces all three.
 *
 * To add a camera type: add one entry here. Every view picks it up
 * automatically.
 */
export const CAMERA_TYPE_LABELS = {
  bga_grid:        'BGA Grid',
  alignment_chip:  'Alignment - Chip',
  alignment_board: 'Alignment - Board',
  custom:          'Custom',
}

export function cameraTypeLabel(type) {
  return CAMERA_TYPE_LABELS[type] || type
}

/**
 * Resolve the display name for a camera object: explicit name wins,
 * otherwise falls back to the type label.
 */
export function cameraDisplayName(cam) {
  if (!cam) return 'Camera'
  if (cam.name) return cam.name
  return cameraTypeLabel(cam.type)
}
