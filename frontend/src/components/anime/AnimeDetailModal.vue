<template>
  <el-dialog
    :model-value="visible"
    :width="dialogWidth"
    class="anime-dialog"
    overlay-class="anime-overlay"
    :style="{ background: gradientBg }"
    @update:model-value="$emit('update:visible', $event)"
  >
    <div class="relative min-h-[350px] rounded-12 p-5">
      <!-- 自定义 Loading 覆盖层 — 粉紫主题，绝对居中，不跳动 -->
      <div
        v-if="loading"
        class="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-12"
        style="background: rgba(255, 255, 255, 0.85)"
      >
        <svg class="animate-spin h-8 w-8" viewBox="0 0 24 24">
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="var(--primary-purple)"
            stroke-width="3"
            fill="none"
          />
          <path
            class="opacity-75"
            fill="var(--primary-pink)"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <span class="text-xs" style="color: var(--primary-purple)">加载中...</span>
      </div>

      <template v-if="detail">
        <div class="relative z-10">
          <!-- Anime Info -->
          <div class="flex gap-4 mb-6 flex-col sm:flex-row">
            <el-image
              ref="coverRef"
              :src="detail.anime.cover_url"
              :alt="detail.anime.title_cn"
              :preview-src-list="[detail.anime.cover_url]"
              hide-on-click-modal
              class="w-24 h-32 flex-shrink-0 shadow-md mx-auto sm:mx-0"
              fit="cover"
              @load="extractColor"
              @error="onCoverError"
            >
              <template #error>
                <div class="w-24 h-32 flex items-center justify-center bg-gray-100 rounded-8">
                  <el-icon :size="24" class="text-text-secondary"><PictureFilled /></el-icon>
                </div>
              </template>
            </el-image>
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
              <p class="text-small text-text-body leading-relaxed">
                {{ detail.anime.description || '暂无简介' }}
              </p>
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
          <div v-if="showEdit" class="glass-card p-4 mb-4 edit-form-card">
            <!-- Bangumi Search -->
            <div class="mb-3">
              <el-input
                v-model="searchKeyword"
                placeholder="搜索 Bangumi 自动填充..."
                size="small"
                :loading="searching"
                clearable
                @input="onSearchInput"
                @clear="clearSearch"
              >
                <template #prefix>
                  <el-icon class="text-text-secondary"><Search /></el-icon>
                </template>
              </el-input>

              <div v-if="searching" class="mt-2 text-xs text-text-secondary text-center py-4">
                <el-icon class="is-loading"><Loading /></el-icon> 正在搜索...
              </div>
              <div
                v-else-if="searchResults.length > 0"
                class="mt-2 border border-gray-200 rounded-8 max-h-48 overflow-y-auto bg-white"
              >
                <div
                  v-for="item in searchResults"
                  :key="item.bgm_id"
                  class="flex items-center gap-2 p-2 hover:bg-primary-pink/5 cursor-pointer transition-colors border-b border-gray-50 last:border-0"
                  @click="applyBangumiItem(item)"
                >
                  <img
                    :src="item.cover_url"
                    class="w-8 h-11 object-cover rounded-4 flex-shrink-0"
                    @error="(e: Event) => ((e.target as HTMLImageElement).style.opacity = '0')"
                  />
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-semibold text-text-primary truncate">
                      {{ item.title_cn }}
                    </p>
                    <p class="text-xs text-text-secondary">
                      {{ item.rating || '-' }}分 · {{ item.platform || '未知' }}
                      <template v-if="item.episodes"> · {{ item.episodes }}集</template>
                    </p>
                  </div>
                </div>
              </div>

              <p v-if="searchError" class="text-xs text-primary-pink mt-1">
                {{ searchError }}
              </p>
            </div>
            <el-divider class="!my-3 !border-gray-100" />
            <el-form :model="editForm" label-position="top" size="default">
              <div class="grid grid-cols-2 gap-x-3 gap-y-0">
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
              <el-form-item label="标签（中、英文逗号分隔）">
                <el-input v-model="tagsInput" placeholder="科幻, 悬疑, 催泪" />
              </el-form-item>
              <el-form-item label="简介">
                <el-input v-model="editForm.description" type="textarea" :rows="2" />
              </el-form-item>
              <div class="flex gap-2 mt-3">
                <el-button
                  class="btn-gradient !text-xs !px-5"
                  size="small"
                  :loading="savingEdit"
                  @click="saveEdit"
                >
                  保存修改
                </el-button>
                <el-button
                  class="btn-soft !text-xs !px-5 !border-red-200 !text-red-500 hover:!bg-red-50 hover:!border-red-300"
                  size="small"
                  @click="handleDelete"
                >
                  <el-icon :size="13"><Delete /></el-icon>
                  删除番剧
                </el-button>
              </div>
            </el-form>
          </div>

          <!-- Average Score Cards — 置于我的评分之上 -->
          <div v-if="detail.anime.avg_anime_score" class="flex gap-3 mb-4">
            <!-- 均分卡 -->
            <div
              class="flex-1 glass-card p-3 flex flex-col items-center justify-center text-center min-h-[80px]"
            >
              <span class="text-xs text-text-secondary font-medium mb-0.5 flex items-center gap-1">
                <el-icon :size="12" class="text-primary-pink"><StarFilled /></el-icon>均分
              </span>
              <div class="flex items-baseline justify-center gap-0.5">
                <span class="text-2xl font-bold text-gradient">{{
                  detail.anime.avg_anime_score
                }}</span>
                <span class="text-xs text-text-secondary">/ 10</span>
              </div>
            </div>
            <!-- 推荐度卡 -->
            <div
              class="flex-1 glass-card p-3 flex flex-col items-center justify-center text-center min-h-[80px]"
            >
              <span class="text-xs text-text-secondary font-medium mb-0.5 flex items-center gap-1">
                <el-icon :size="12" class="text-primary-purple"><GoldMedal /></el-icon>推荐度
              </span>
              <div class="flex items-baseline justify-center gap-0.5">
                <span class="text-2xl font-bold text-gradient">{{
                  detail.anime.avg_recommend
                }}</span>
                <span class="text-xs text-text-secondary">/ 10</span>
              </div>
            </div>
          </div>

          <!-- Rating Section (only for logged-in) -->
          <div
            v-if="isLoggedIn"
            class="glass-card p-4 mb-4"
            :class="{ 'cursor-pointer': !showRatingForm }"
            @click="!showRatingForm ? enterRatingMode() : undefined"
          >
            <div class="flex items-center justify-between mb-3">
              <h3 class="font-semibold text-text-primary flex items-center gap-1.5">
                <el-icon :size="15"><EditPen /></el-icon>
                我的评分
              </h3>
              <span
                v-if="hasExistingRating && !showRatingForm"
                class="text-xs text-primary-pink/60 flex items-center gap-1"
              >
                <el-icon :size="12"><EditPen /></el-icon>
                点击修改评分
              </span>
            </div>

            <!-- Default state: not editing -->
            <template v-if="!showRatingForm">
              <!-- Has existing rating: read-only display -->
              <div v-if="hasExistingRating && detail?.my_rating">
                <template v-if="detail.my_rating.anime_score > 0">
                  <div class="flex flex-col gap-1 mb-3">
                    <div class="flex items-center gap-2">
                      <el-icon :size="16" class="text-primary-pink"><StarFilled /></el-icon>
                      <span class="text-small text-text-secondary whitespace-nowrap">番剧评分</span>
                      <el-rate
                        :model-value="detail.my_rating.anime_score"
                        :max="10"
                        show-score
                        size="small"
                        :score-template="'{value}分'"
                        :colors="['#f783ac', '#d087c8', '#b490e4']"
                        disabled
                      />
                    </div>
                    <div class="flex items-center gap-2">
                      <el-icon :size="16" class="text-primary-purple"><GoldMedal /></el-icon>
                      <span class="text-small text-text-secondary whitespace-nowrap"
                        >补番推荐度</span
                      >
                      <el-rate
                        :model-value="detail.my_rating.recommend"
                        :max="10"
                        show-score
                        size="small"
                        :score-template="'{value}分'"
                        :colors="['#f783ac', '#d087c8', '#b490e4']"
                        disabled
                      />
                    </div>
                  </div>
                </template>
                <p v-else class="text-small text-text-secondary mb-3">暂不打分</p>
                <p
                  v-if="detail.my_rating.review"
                  class="text-small text-text-body whitespace-pre-wrap break-words leading-relaxed"
                >
                  {{ detail.my_rating.review }}
                </p>
              </div>

              <!-- No rating: show button -->
              <el-button
                v-else
                class="btn-gradient !text-xs !w-full"
                size="small"
                @click="enterRatingMode"
              >
                去评分
              </el-button>
            </template>

            <!-- Edit state: show form -->
            <template v-else>
              <div class="flex items-center gap-2 mb-3">
                <el-checkbox
                  v-model="ratingForm.unwatched"
                  size="small"
                  @change="onUnwatchedToggle"
                >
                  <span class="text-xs text-text-secondary"
                    >暂不打分（评分为0，不计入均分计算）</span
                  >
                </el-checkbox>
              </div>
              <div v-if="!ratingForm.unwatched" class="flex flex-col gap-1 mb-3">
                <div class="flex items-center gap-2">
                  <el-icon :size="16" class="text-primary-pink"><StarFilled /></el-icon>
                  <span class="text-small text-text-secondary whitespace-nowrap">番剧评分</span>
                  <el-rate
                    v-model="ratingForm.anime_score"
                    :max="10"
                    show-score
                    size="small"
                    :score-template="'{value}分'"
                    :colors="['#f783ac', '#d087c8', '#b490e4']"
                  />
                </div>
                <div class="flex items-center gap-2">
                  <el-icon :size="16" class="text-primary-purple"><GoldMedal /></el-icon>
                  <span class="text-small text-text-secondary whitespace-nowrap">补番推荐度</span>
                  <el-rate
                    v-model="ratingForm.recommend"
                    :max="10"
                    show-score
                    size="small"
                    :score-template="'{value}分'"
                    :colors="['#f783ac', '#d087c8', '#b490e4']"
                  />
                </div>
              </div>
              <el-input
                v-model="ratingForm.review"
                type="textarea"
                :autosize="{ minRows: 4, maxRows: 12 }"
                placeholder="写写你的感想吧...（支持长评）"
                class="mb-2"
              />
              <div class="flex gap-2">
                <el-button
                  class="btn-soft !text-xs flex-1"
                  size="small"
                  :disabled="savingRating"
                  @click.stop="cancelRating"
                >
                  取消
                </el-button>
                <el-button
                  class="btn-gradient !text-xs flex-1"
                  size="small"
                  :loading="savingRating"
                  @click.stop="saveRating"
                >
                  保存评分
                </el-button>
              </div>
            </template>
          </div>

          <!-- Friends Ratings -->
          <!-- 大家的评分 — 模块本身无 hover，每条评分独立卡片 + hover -->
          <div
            v-if="otherRatings.length > 0"
            class="bg-white/95 backdrop-blur-md border border-primary-purple/20 rounded-12 p-4"
          >
            <h3 class="font-semibold mb-3 text-text-primary flex items-center gap-1">
              <el-icon :size="15"><ChatDotRound /></el-icon>
              大家的评分
            </h3>
            <div class="space-y-3">
              <div
                v-for="rating in otherRatings"
                :key="rating.id"
                class="bg-white/80 backdrop-blur-sm border border-primary-purple/10 rounded-8 p-3 transition-all duration-300 hover:border-primary-purple/30 hover:-translate-y-0.5 hover:shadow-sm hover:bg-white/95"
              >
                <div class="flex items-start gap-3">
                  <div class="flex-1 min-w-0">
                    <p class="text-small mb-1">
                      <span class="font-semibold text-primary-pink">{{ rating.username }}</span>
                    </p>
                    <p
                      class="text-small text-text-secondary mb-1 flex items-center gap-1 flex-wrap"
                    >
                      <RatingScores :score="rating.anime_score" :recommend="rating.recommend" />
                    </p>
                    <p
                      v-if="rating.review"
                      class="text-small text-text-body whitespace-pre-wrap break-words leading-relaxed"
                    >
                      {{ rating.review }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Navigation buttons - 放在 el-dialog 内部，与弹窗同生命周期，无延迟 -->
    <button v-show="hasPrevious" class="nav-btn nav-prev" @click.stop="emit('previous')">
      <el-icon :size="20"><ArrowLeft /></el-icon>
    </button>
    <button v-show="hasNext" class="nav-btn nav-next" @click.stop="emit('next')">
      <el-icon :size="20"><ArrowRight /></el-icon>
    </button>

    <AuthDialog v-model:visible="showAuthDialog" @success="loadDetail" />
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue'
import { useResponsiveDialog } from '@/composables/useResponsiveDialog'
import { useBangumiSearch } from '@/composables/useBangumiSearch'
import { useApi } from '@/composables/useApi'
import { useAuth } from '@/composables/useAuth'
import { ElMessage, ElMessageBox } from 'element-plus'
import AuthDialog from '@/components/auth/AuthDialog.vue'
import RatingScores from '@/components/RatingScores.vue'
import type { AnimeDetail } from '@/types'

const props = withDefaults(
  defineProps<{
    visible: boolean
    animeId: number
    hasPrevious?: boolean
    hasNext?: boolean
  }>(),
  {
    hasPrevious: false,
    hasNext: false
  }
)

const emit = defineEmits<{
  'update:visible': [value: boolean]
  refresh: []
  previous: []
  next: []
}>()

const api = useApi()
const { isLoggedIn, currentUser } = useAuth()
const detail = ref<AnimeDetail | null>(null)
const loading = ref(true)
const showEdit = ref(false)
const savingRating = ref(false)
const savingEdit = ref(false)
const showAuthDialog = ref(false)
const tagsInput = ref('')
const gradientBg = ref(
  'linear-gradient(135deg, rgba(247,131,172,0.08) 0%, transparent 40%), #fff'
)
const coverRef = ref<HTMLImageElement | null>(null)

function onCoverError(e: Event) {
  const img = e.target as HTMLImageElement
  img.style.opacity = '0.3'
  gradientBg.value =
    'linear-gradient(135deg, rgba(247,131,172,0.08) 0%, transparent 40%), #fff'
}

const { dialogWidth } = useResponsiveDialog('600px')

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
})

function onKeyDown(e: KeyboardEvent) {
  if (!props.visible) return
  if (e.key === 'ArrowLeft' && props.hasPrevious) {
    emit('previous')
  } else if (e.key === 'ArrowRight' && props.hasNext) {
    emit('next')
  }
}

const ratingForm = reactive({
  anime_score: 8,
  recommend: 8,
  review: '',
  unwatched: false
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

const showRatingForm = ref(false)
const {
  keyword: searchKeyword,
  searching,
  searchResults,
  searchError,
  onSearchInput,
  clearSearch,
  applyBangumiItem
} = useBangumiSearch(editForm, tagsInput)
const hasExistingRating = computed(() => detail.value?.my_rating != null)

const otherRatings = computed(() => {
  if (!detail.value) return []
  if (!currentUser.value?.username) return detail.value.ratings
  return detail.value.ratings.filter((r) => r.username !== currentUser.value!.username)
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
  showEdit.value = false
  loading.value = true
  try {
    const data = await api.getAnime(props.animeId)
    detail.value = data
    loading.value = false
    if (data.my_rating) {
      ratingForm.anime_score = data.my_rating.anime_score
      ratingForm.recommend = data.my_rating.recommend
      ratingForm.review = data.my_rating.review
      ratingForm.unwatched = data.my_rating.anime_score === 0
    } else {
      ratingForm.anime_score = 8
      ratingForm.recommend = 8
      ratingForm.review = ''
      ratingForm.unwatched = false
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
    setTagsInput(anime.tags)
  } catch {
    detail.value = null
    loading.value = false
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

    gradientBg.value = `linear-gradient(135deg, rgba(${r},${g},${b},0.10) 0%, transparent 40%), #fff`
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
    showRatingForm.value = false
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
    const tags = tagsInput.value
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)
    await api.updateAnime(props.animeId, { ...editForm, tags: JSON.stringify(tags) })
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

function setTagsInput(tags: string) {
  try {
    const parsed = JSON.parse(tags)
    tagsInput.value = Array.isArray(parsed) ? parsed.join(', ') : tags
  } catch {
    tagsInput.value = tags.split(/[,，]/).filter(Boolean).join(', ')
  }
}

async function handleDelete() {
  try {
    await ElMessageBox.confirm(
      '确定要删除这部番剧吗？相关评分也会一并删除，此操作不可撤销。',
      '删除确认',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning',
        confirmButtonClass: 'btn-gradient !text-xs !px-5',
        cancelButtonClass: 'btn-soft !text-xs !px-5'
      }
    )
  } catch {
    return // 用户取消
  }

  try {
    await api.deleteAnime(props.animeId)
    ElMessage.success('番剧已删除')
    emit('update:visible', false)
    emit('refresh')
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '删除失败')
  }
}

function enterRatingMode() {
  showRatingForm.value = true
}

function onUnwatchedToggle(val: boolean) {
  if (val) {
    ratingForm.anime_score = 0
    ratingForm.recommend = 0
  } else {
    ratingForm.anime_score = 8
    ratingForm.recommend = 8
  }
}

function cancelRating() {
  showRatingForm.value = false
  if (detail.value?.my_rating) {
    ratingForm.anime_score = detail.value.my_rating.anime_score
    ratingForm.recommend = detail.value.my_rating.recommend
    ratingForm.review = detail.value.my_rating.review
    ratingForm.unwatched = detail.value.my_rating.anime_score === 0
  } else {
    ratingForm.anime_score = 8
    ratingForm.recommend = 8
    ratingForm.review = ''
    ratingForm.unwatched = false
  }
}

watch(
  () => props.visible,
  (v) => {
    if (!v) {
      detail.value = null
      showRatingForm.value = false
    }
  }
)

watch(isLoggedIn, (loggedIn) => {
  if (loggedIn && props.visible) loadDetail()
})

watch(
  () => props.animeId,
  () => {
    if (props.visible) loadDetail()
  }
)

// 弹窗打开时首次加载
watch(
  () => props.visible,
  (v) => {
    if (v) loadDetail()
  }
)
</script>

<style scoped>
.anime-dialog {
  border-radius: 12px;
  overflow: hidden;
  margin: 0 !important;
  height: 90vh;
  max-width: 95vw;
  width: 600px;
  display: flex;
  flex-direction: column;
}
.anime-dialog :deep(.el-dialog__header) {
  margin: 0;
  padding: 16px 24px 0;
  position: relative;
  z-index: 10;
  background: transparent;
}
.anime-dialog :deep(.el-dialog__body) {
  flex: 1;
  overflow-y: auto;
  max-height: none;
  position: relative;
  padding: 0;
  background: transparent;
}

/* 编辑表单 - 压缩 FormItem 间距 */
.edit-form-card :deep(.el-form-item) {
  margin-bottom: 8px !important;
}
.edit-form-card :deep(.el-form-item__label) {
  padding-bottom: 2px !important;
  font-size: 12px !important;
}

/* ========================================
   导航按钮 - 弹窗两侧
   ======================================== */
.nav-btn {
  position: fixed;
  top: 50%;
  transform: translateY(-50%);
  z-index: 9999;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid rgba(180, 144, 228, 0.2);
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  color: var(--primary-pink);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
.nav-btn:hover {
  background: linear-gradient(135deg, var(--primary-pink), var(--primary-purple));
  color: #fff;
  border-color: transparent;
  box-shadow: 0 4px 16px rgba(247, 131, 172, 0.3);
  transform: translateY(-50%) scale(1.1);
}
.nav-btn:active {
  transform: translateY(-50%) scale(0.95);
}
.nav-prev {
  left: calc(50% - 352px);
}
.nav-next {
  left: calc(50% + 312px);
}

/* ========================================
   Loading 覆盖层 — 粉紫主题 + 防跳动 - 已迁移为自定义组件
   ======================================== */
</style>
