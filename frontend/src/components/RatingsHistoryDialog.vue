<template>
  <el-dialog
    :model-value="visible"
    :width="dialogWidth"
    title="全部动态"
    destroy-on-close
    class="ratings-history-dialog"
    @update:model-value="$emit('update:visible', $event)"
    @opened="loadPage(1)"
  >
    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-12">
      <el-icon class="is-loading" :size="24"><Loading /></el-icon>
    </div>

    <!-- Empty -->
    <EmptyState v-else-if="items.length === 0" type="empty" title="暂无动态" description="" />

    <!-- Ratings List -->
    <div v-else class="space-y-1">
      <div
        v-for="rating in items"
        :key="rating.id"
        class="flex items-start gap-3 p-3 hover:bg-primary-pink/5 cursor-pointer transition-colors rounded-8"
        @click="openDetail(rating.anime_id)"
      >
        <img
          :src="rating.anime_cover"
          class="w-14 h-20 object-cover rounded-4 flex-shrink-0 mt-0.5"
          @error="(e: Event) => ((e.target as HTMLImageElement).style.opacity = '0')"
        />
        <div class="min-w-0 flex-1">
          <p class="text-small">
            <span class="font-semibold text-primary-pink">{{ rating.username }}</span>
            <span class="text-text-secondary"> → </span>
            <span class="text-text-primary">{{ rating.anime_title }}</span>
          </p>
          <p class="text-small text-text-secondary mt-0.5">
            <span class="inline-flex items-center gap-1">
              <el-icon :size="13" class="text-primary-pink"><StarFilled /></el-icon>
              <span class="text-primary-pink font-medium">{{ rating.anime_score }}分</span>
            </span>
            <span class="mx-1 text-text-body">·</span>
            <span class="inline-flex items-center gap-1">
              <el-icon :size="13" class="text-primary-purple"><GoldMedal /></el-icon>
              <span class="text-primary-purple font-medium">{{ rating.recommend }}分</span>
            </span>
          </p>
          <p v-if="rating.review" class="text-small text-text-body mt-1 whitespace-pre-wrap break-words">{{ rating.review }}</p>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="totalPages > 1" class="flex items-center justify-center gap-2 mt-4 pt-3 border-t border-gray-100">
      <el-button
        class="btn-soft !text-xs !px-3 !py-1"
        size="small"
        :disabled="currentPage <= 1"
        :loading="loading"
        @click="loadPage(currentPage - 1)"
      >
        上一页
      </el-button>
      <span class="text-xs text-text-secondary px-2">
        {{ currentPage }} / {{ totalPages }}
      </span>
      <el-button
        class="btn-soft !text-xs !px-3 !py-1"
        size="small"
        :disabled="currentPage >= totalPages"
        :loading="loading"
        @click="loadPage(currentPage + 1)"
      >
        下一页
      </el-button>
    </div>

    <!-- Detail Dialog (nested) -->
    <AnimeDetailModal
      v-model:visible="showDetail"
      :anime-id="selectedAnimeId"
      @refresh="loadPage(currentPage)"
    />
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useApi } from '@/composables/useApi'
import EmptyState from '@/components/EmptyState.vue'
import AnimeDetailModal from '@/components/anime/AnimeDetailModal.vue'
import type { Rating } from '@/types'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  'update:visible': [value: boolean]
  update: []
}>()

const api = useApi()
const PAGE_SIZE = 20

const items = ref<Rating[]>([])
const loading = ref(false)
const currentPage = ref(1)
const totalPages = ref(1)

const showDetail = ref(false)
const selectedAnimeId = ref(0)

const dialogWidth = ref(window.innerWidth < 768 ? '95%' : '600px')

function onResize() {
  dialogWidth.value = window.innerWidth < 768 ? '95%' : '600px'
}

onMounted(() => {
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
})

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const time = new Date(dateStr).getTime()
  const diff = Math.floor((now - time) / 1000)
  if (diff < 60) return '刚刚'
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`
  if (diff < 2592000) return `${Math.floor(diff / 86400)}天前`
  return new Date(dateStr).toLocaleDateString('zh-CN')
}

function openDetail(animeId: number) {
  selectedAnimeId.value = animeId
  showDetail.value = true
}

async function loadPage(page: number) {
  loading.value = true
  try {
    const res = await api.getRatingHistory(page, PAGE_SIZE)
    items.value = res.items
    currentPage.value = res.page
    totalPages.value = Math.max(1, Math.ceil(res.total / res.limit))
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}
</script>
