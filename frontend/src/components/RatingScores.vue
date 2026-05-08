<template>
  <template v-if="score > 0">
    <span class="inline-flex items-center gap-1">
      <el-icon :size="iconSize" class="text-primary-pink"><StarFilled /></el-icon>
      <span class="text-primary-pink font-medium">{{ score }}分</span>
    </span>
    <span class="mx-1 text-text-body">&middot;</span>
    <span class="inline-flex items-center gap-1">
      <el-icon :size="iconSize" class="text-primary-purple"><GoldMedal /></el-icon>
      <span class="text-primary-purple font-medium">{{ recommend }}分</span>
    </span>
  </template>
  <span v-else class="text-text-secondary text-xs">暂不打分</span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ score: number; recommend: number; iconSize?: number }>(), {
  iconSize: 13
})
</script>
