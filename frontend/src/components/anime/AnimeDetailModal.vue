<template>
    <el-dialog
      :model-value="visible"
      :width="dialogWidth"
      destroy-on-close
      class="anime-dialog"
      @update:model-value="$emit('update:visible', $event)"
      @opened="loadDetail"
    >
      <template v-if="detail">
        <!-- 封面取色渐变背景（淡色，不溢出） -->
        <div
          class="absolute inset-0 transition-colors duration-700 rounded-12 pointer-events-none"
          :style="{ background: gradientBg }"
        ></div>

        <div class="relative z-10">
          <!-- Anime Info -->
          <div class="flex gap-4 mb-6 flex-col sm:flex-row">
            <img
              ref="coverRef"
              :src="detail.anime.cover_url"
              :alt="detail.anime.title_cn"
              class="w-24 h-32 object-cover rounded-8 flex-shrink-0 shadow-md mx-auto sm:mx-0"
              @load="extractColor"
              @error="onCoverError"
            />
            <div class="flex-1 min-w-0">
              <h2 class="text-card-title mb-1">{{ detail.anime.title_cn }}</h2>
              <p class="text-small text-text-secondary mb-2">{{ detail.anime.title_jp }}</p>
              <p class="text-small text-text-body mb-1">
                状态：{{ detail.anime.status || '未知' }}
                <template v-if="detail.anime.episodes"> · {{ detail.anime.episodes }}集</template>
                <template v-if="detail.anime.air_date"> · {{ detail.anime.air_date }}</template>
              </p>
              <p v-if="parsedTags.length" class="text-small text-text-secondary mb-2">
                类型：{{ parsedTags.join(' · ') }}
              </p>
              <p class="text-small text-text-body leading-relaxed">{{ detail.anime.description || '暂无简介' }}</p>
              <button
                v-if="isLoggedIn"
                class="text-small text-primary-pink hover:text-primary-dark mt-2 transition-colors flex items-center gap-1"
                @click="showEdit = !showEdit"
              >
                <el-icon :size="14"><EditPen /></el-icon>
                编辑番剧信息
              </button>
            </div>
          </div>

          <!-- Edit Anime Form -->
          <div v-if="showEdit" class="glass-card p-4 mb-4">
            <el-form :model="editForm" label-position="top" size="small">
              <div class="grid grid-cols-2 gap-3">
                <el-form-item label="中文名">
                  <el-input v-model="editForm.title_cn" />
                </el-form-item>
                <el-form-item label="日文名">
                  <el-input v-model="editForm.title_jp" />
                </el-form-item>
                <el-form-item label="封面URL">
                  <el-input v-model="editForm.cover_url" />
                </el-form-item>
                <el-form-item label="话数">
                  <el-input-number v-model="editForm.episodes" :min="0" />
                </el-form-item>
                <el-form-item label="状态">
                  <el-select v-model="editForm.status">
                    <el-option label="已完结" value="已完结" />
                    <el-option label="连载中" value="连载中" />
                    <el-option label="未开播" value="未开播" />
                  </el-select>
                </el-form-item>
                <el-form-item label="平台">
                  <el-select v-model="editForm.platform">
                    <el-option label="TV" value="TV" />
                    <el-option label="WEB" value="WEB" />
                    <el-option label="剧场版" value="剧场版" />
                    <el-option label="OVA" value="OVA" />
                  </el-select>
                </el-form-item>
                <el-form-item label="放送日期">
                  <el-input v-model="editForm.air_date" />
                </el-form-item>
                <el-form-item label="季度">
                  <el-input v-model="editForm.season" />
                </el-form-item>
              </div>
              <el-form-item label="简介">
                <el-input v-model="editForm.description" type="textarea" :rows="2" />
              </el-form-item>
              <el-button class="btn-gradient !text-xs !px-5" size="small" :loading="savingEdit" @click="saveEdit">
                保存修改
              </el-button>
            </el-form>
          </div>

          <!-- Rating Form (only for logged-in) -->
          <div v-if="isLoggedIn" class="glass-card p-4 mb-4">
            <h3 class="font-semibold mb-3 text-text-primary flex items-center gap-1.5">
              <span class="w-0.5 h-3.5 bg-gradient-to-b from-primary-pink to-primary-purple rounded-full shrink-0"></span>
              <el-icon :size="15"><EditPen /></el-icon>
              我的评分
            </h3>
            <div class="flex gap-6 mb-3 flex-wrap">
              <div class="flex items-center gap-2">
                <el-icon :size="16" class="text-primary-pink"><StarFilled /></el-icon>
                <span class="text-small text-text-secondary">番剧评分</span>
                <el-input-number v-model="ratingForm.anime_score" :min="1" :max="10" size="small" />
              </div>
              <div class="flex items-center gap-2">
                <el-icon :size="16" class="text-primary-yellow"><GoldMedal /></el-icon>
                <span class="text-small text-text-secondary">补番推荐度</span>
                <el-input-number v-model="ratingForm.recommend" :min="1" :max="10" size="small" />
              </div>
            </div>
            <el-input
              v-model="ratingForm.review"
              type="textarea"
              :rows="4"
              placeholder="写写你的感想吧...（支持长评）"
              class="mb-2"
            />
            <el-button class="btn-gradient !text-xs !px-5" size="small" :loading="savingRating" @click="saveRating">
              保存评分
            </el-button>
          </div>

          <!-- Friends Ratings -->
          <div v-if="detail.ratings.length > 0" class="glass-card p-4">
            <h3 class="font-semibold mb-3 text-text-primary flex items-center gap-1">
              <el-icon :size="15"><ChatDotRound /></el-icon>
              大家的评分
            </h3>
            <div class="space-y-3">
              <div v-for="rating in detail.ratings" :key="rating.id" class="flex items-start gap-3">
                <div class="flex-1 min-w-0">
                  <p class="text-small">
                    <span class="font-semibold text-primary-pink">{{ rating.username }}</span>
                    <span class="text-text-secondary ml-1">
                      <el-icon :size="13" class="text-primary-pink"><StarFilled /></el-icon>{{ rating.anime_score }}
                      <el-icon :size="13" class="text-primary-yellow"><GoldMedal /></el-icon>{{ rating.recommend }}
                    </span>
                  </p>
                  <p v-if="rating.review" class="text-small text-text-body mt-1 whitespace-pre-wrap break-words leading-relaxed">{{ rating.review }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
      <div v-else class="flex items-center justify-center py-20">
        <p class="text-text-secondary">加载中...</p>
      </div>

      <AuthDialog
        v-model:visible="showAuthDialog"
        @success="loadDetail"
      />
    </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { useApi } from '@/composables/useApi'
import { useAuth } from '@/composables/useAuth'
import { ElMessage } from 'element-plus'
import AuthDialog from '@/components/auth/AuthDialog.vue'
import type { AnimeDetail } from '@/types'

const props = defineProps<{
  visible: boolean
  animeId: number
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  refresh: []
}>()

const api = useApi()
const { isLoggedIn } = useAuth()
const detail = ref<AnimeDetail | null>(null)
const showEdit = ref(false)
const savingRating = ref(false)
const savingEdit = ref(false)
const showAuthDialog = ref(false)
const gradientBg = ref('linear-gradient(135deg, rgba(247,131,172,0.06) 0%, rgba(180,144,228,0.04) 50%, rgba(255,255,255,0.98) 100%)')
const coverRef = ref<HTMLImageElement | null>(null)

function onCoverError(e: Event) {
  const img = e.target as HTMLImageElement
  img.style.opacity = '0.3'
  gradientBg.value = 'linear-gradient(135deg, rgba(247,131,172,0.06) 0%, rgba(180,144,228,0.04) 50%, rgba(255,255,255,0.98) 100%)'
}

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

const ratingForm = reactive({
  anime_score: 8,
  recommend: 8,
  review: ''
})

const editForm = reactive({
  title_cn: '',
  title_jp: '',
  cover_url: '',
  description: '',
  episodes: 0,
  status: '',
  platform: '',
  air_date: '',
  season: ''
})

const parsedTags = computed(() => {
  if (!detail.value) return []
  try {
    return JSON.parse(detail.value.anime.tags as unknown as string)
  } catch {
    return typeof detail.value.anime.tags === 'string'
      ? (detail.value.anime.tags as string).split(',').filter(Boolean)
      : []
  }
})

async function loadDetail() {
  if (!props.animeId) return
  detail.value = null
  showEdit.value = false
  try {
    const data = await api.getAnime(props.animeId)
    detail.value = data
    if (data.my_rating) {
      ratingForm.anime_score = data.my_rating.anime_score
      ratingForm.recommend = data.my_rating.recommend
      ratingForm.review = data.my_rating.review
    } else {
      ratingForm.anime_score = 8
      ratingForm.recommend = 8
      ratingForm.review = ''
    }
    const anime = data.anime
    editForm.title_cn = anime.title_cn
    editForm.title_jp = anime.title_jp
    editForm.cover_url = anime.cover_url
    editForm.description = anime.description
    editForm.episodes = anime.episodes
    editForm.status = anime.status
    editForm.platform = anime.platform
    editForm.air_date = anime.air_date
    editForm.season = anime.season
  } catch {
    detail.value = null
  }
}

function extractColor() {
  const img = coverRef.value
  if (!img) return

  try {
    const canvas = document.createElement('canvas')
    canvas.width = 50
    canvas.height = 50
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, 0, 0, 50, 50)
    const data = ctx.getImageData(0, 0, 50, 50).data

    let r = 0,
      g = 0,
      b = 0,
      count = 0
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
      count++
    }
    r = Math.round(r / count)
    g = Math.round(g / count)
    b = Math.round(b / count)

    gradientBg.value = `linear-gradient(135deg, rgba(${r},${g},${b},0.12) 0%, rgba(${r},${g},${b},0.06) 40%, rgba(255,255,255,0.96) 100%)`
  } catch {
    // CORS 或取色失败，保持默认淡色渐变
  }
}

async function saveRating() {
  if (!detail.value) return
  savingRating.value = true
  try {
    await api.createRating({
      anime_id: detail.value.anime.id,
      anime_score: ratingForm.anime_score,
      recommend: ratingForm.recommend,
      review: ratingForm.review
    })
    ElMessage.success('评分已保存')
    emit('refresh')
    await loadDetail()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '保存失败')
  } finally {
    savingRating.value = false
  }
}

async function saveEdit() {
  savingEdit.value = true
  try {
    await api.updateAnime(props.animeId, { ...editForm })
    ElMessage.success('番剧信息已更新')
    showEdit.value = false
    emit('refresh')
    await loadDetail()
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '更新失败')
  } finally {
    savingEdit.value = false
  }
}

watch(
  () => props.visible,
  (v) => {
    if (!v) detail.value = null
  }
)

watch(isLoggedIn, (loggedIn) => {
  if (loggedIn && props.visible) loadDetail()
})
</script>

<style scoped>
.anime-dialog :deep(.el-dialog) {
  border-radius: 12px;
  overflow: hidden;
}
.anime-dialog :deep(.el-dialog__header) {
  margin: 0;
  padding: 16px 24px 0;
  position: relative;
  z-index: 10;
}
.anime-dialog :deep(.el-dialog__body) {
  position: relative;
}
</style>
