<template>
  <div class="flex flex-col items-center justify-center py-16 text-center">
    <svg
      class="w-16 h-16 mb-4"
      :class="iconColorClass"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        v-if="type === 'empty'"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.5"
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
      />
      <path
        v-else-if="type === 'error'"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.5"
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
      <path
        v-else
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="1.5"
        d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
      />
    </svg>
    <h3 class="text-lg font-semibold text-text-primary mb-2">{{ title }}</h3>
    <p class="text-text-secondary text-sm max-w-sm">{{ description }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  type?: 'empty' | 'error' | 'loading'
  title?: string
  description?: string
}>()

const iconColorClass = computed(() => {
  const map: Record<string, string> = {
    empty: 'text-primary-purple/40',
    error: 'text-primary-pink/50',
    loading: 'text-primary-purple/30'
  }
  return map[props.type ?? 'empty'] || map.empty
})
</script>
