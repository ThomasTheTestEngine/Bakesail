<template>
  <div class="cameras-page">
    <div class="page-title">CAMERAS</div>

    <div v-if="settings.cameras.length === 0" class="stub-card">
      <h2>No cameras configured</h2>
      <p>Add cameras in <strong>Settings → Cameras</strong>.</p>
    </div>

    <div v-else class="cam-grid">
      <div
        v-for="cam in settings.cameras"
        :key="cam.id"
        class="cam-card card"
      >
        <div class="cam-card-title">{{ displayName(cam) }}</div>
        <div class="cam-card-feed">
          <CameraFeed :cam="cam" :showLabel="false" />
        </div>
        <div class="cam-card-meta">
          <span class="cam-type-badge">{{ typeLabel(cam.type) }}</span>
          <span class="cam-device" v-if="!cam.test">
            {{ cam.device === '__manual__' ? cam.deviceManual : cam.device }}
          </span>
          <span class="cam-test-badge" v-else>TEST</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useSettingsStore } from '../stores/settings.js'
import CameraFeed from '../components/CameraFeed.vue'
import { cameraTypeLabel, cameraDisplayName } from '../utils/cameraTypes.js'

const settings = useSettingsStore()

function typeLabel(type) { return cameraTypeLabel(type) }
function displayName(cam) { return cameraDisplayName(cam) }
</script>

<style scoped>
.cameras-page { display: flex; flex-direction: column; gap: 16px; }

.cam-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}

.cam-card { display: flex; flex-direction: column; gap: 10px; padding: 14px; }

.cam-card-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.cam-card-feed {
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--surface-2);
}

.cam-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cam-type-badge {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
  padding: 2px 6px;
  border: 1px solid var(--border-2);
  border-radius: 3px;
}

.cam-device {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
}

.cam-test-badge {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.10em;
  color: var(--teal);
  padding: 2px 6px;
  border: 1px solid var(--teal);
  background: var(--teal-glow);
  border-radius: 3px;
}
</style>
