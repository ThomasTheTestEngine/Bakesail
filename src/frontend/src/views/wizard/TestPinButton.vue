<template>
  <button
    class="test-pin-btn"
    :class="{ 'test-pin-btn--busy': busy }"
    :disabled="!pin || busy"
    @click="test"
    :title="pin ? `Test pin ${pin}` : 'Enter a pin name first'"
  >
    {{ busy ? busyLabel : (label || 'Test') }}
  </button>
</template>

<script setup>
import { ref } from 'vue'
import { saveTestPinCfg } from '../../utils/configWriter.js'
import { useMoonraker, waitForReady } from '../../composables/useMoonraker.js'

const props = defineProps({
  pin:   { type: String, default: '' },
  label: { type: String, default: '' },
})

const { runGcode } = useMoonraker()
const busy      = ref(false)
const busyLabel = ref('…')

async function test() {
  if (!props.pin) return
  busy.value = true
  try {
    // 1. Write temp config with this pin
    busyLabel.value = 'Writing…'
    await saveTestPinCfg(props.pin)

    // 2. Restart Klipper to load the new pin declaration
    busyLabel.value = 'Restarting…'
    await runGcode('FIRMWARE_RESTART')

    // 3. Wait for Klipper to come back
    busyLabel.value = 'Waiting…'
    await waitForReady(30000)

    // 4. Fire the test pulse
    busyLabel.value = 'Testing…'
    await runGcode('BAKESAIL_TEST_PIN VALUE=1 DURATION=0.5')

  } catch (e) {
    console.error('[bakesail] test pin failed:', e)
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.test-pin-btn {
  padding: 6px 12px;
  border-radius: var(--radius);
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--text-dim);
  font-size: 12px;
  font-family: var(--font-ui);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}

.test-pin-btn:hover:not(:disabled) {
  background: var(--teal-glow);
  border-color: var(--teal);
  color: var(--teal);
}

.test-pin-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.test-pin-btn--busy {
  color: var(--amber);
  border-color: var(--amber-dim);
  background: var(--amber-glow);
}
</style>
