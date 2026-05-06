<template>
  <el-dialog
    :model-value="visible"
    :width="dialogWidth"
    title="添加番剧"
    destroy-on-close
    class="add-anime-dialog"
    overlay-class="add-anime-overlay"
    @update:model-value="$emit('update:visible', $event)"
  >
    <!-- Bangumi Search -->
    <div class="mb-4">
      <el-input
        v-model="keyword"
        placeholder="搜索 Bangumi..."
        size="large"
        :loading="searching"
        @input="onSearchInput"
      >
        <template #prefix>
          <el-icon class="text-text-secondary"><Search /></el-icon>
        </template>
      </el-input>

      <!-- Search Results Dropdown -->
      <div v-if="searchResults.length > 0" class="mt-2 border border-gray-200 rounded-8 max-h-64 overflow-y-auto">
        <div
          v-for="item in searchResults"
          :key="item.bgm_id"
          class="flex items-center gap-3 p-3 hover:bg-primary-pink/5 cursor-pointer transition-colors border-b border-gray-50 last:border-0"
          @click="selectBangumi(item)"
        >
          <img
            :src="item.cover_url"
            class="w-10 h-14 object-cover rounded-4 flex-shrink-0"
            @error="(e: Event) => ((e.target as HTMLImageElement).style.opacity = '0')"
          />
          <div class="min-w-0 flex-1">
            <p class="text-small font-semibold text-text-primary truncate">{{ item.title_cn }}</p>
            <p class="text-small text-text-secondary">
              评分 {{ item.rating || '-' }} · {{ item.platform || '未知' }}
              <template v-if="item.episodes"> · {{ item.episodes }}集</template>
            </p>
          </div>
        </div>
      </div>

      <p v-if="searchError" class="text-small text-primary-pink mt-2">{{ searchError }}</p>
    </div>

    <el-divider>或手动填写</el-divider>

    <!-- Manual Form -->
    <el-form :model="form" label-position="top" size="default">
      <div class="grid grid-cols-2 gap-x-3 gap-y-0">
        <el-form-item label="中文名 *">
          <el-input v-model="form.title_cn" placeholder="必填" />
        </el-form-item>
        <el-form-item label="日文名">
          <el-input v-model="form.title_jp" />
        </el-form-item>
        <el-form-item label="封面URL">
          <el-input v-model="form.cover_url" placeholder="https://..." />
        </el-form-item>
        <el-form-item label="话数">
          <el-input-number v-model="form.episodes" :min="0" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status">
            <el-option label="已完结" value="已完结" />
            <el-option label="连载中" value="连载中" />
            <el-option label="未开播" value="未开播" />
          </el-select>
        </el-form-item>
        <el-form-item label="平台">
          <el-select v-model="form.platform">
            <el-option label="TV" value="TV" />
            <el-option label="WEB" value="WEB" />
            <el-option label="剧场版" value="剧场版" />
            <el-option label="OVA" value="OVA" />
          </el-select>
        </el-form-item>
        <el-form-item label="放送日期">
          <el-input v-model="form.air_date" placeholder="如 2024年1月" />
        </el-form-item>
        <el-form-item label="季度">
          <el-input v-model="form.season" placeholder="如 2024年冬" />
        </el-form-item>
      </div>
      <el-form-item label="标签（逗号分隔）">
        <el-input v-model="tagsInput" placeholder="科幻, 悬疑, 催泪" />
      </el-form-item>
      <el-form-item label="简介">
        <el-input v-model="form.description" type="textarea" :rows="3" />
      </el-form-item>

      <el-button
        class="btn-gradient w-full"
        :loading="submitting"
        :disabled="!form.title_cn"
        @click="submit"
      >
        确认添加
      </el-button>
    </el-form>

    <div v-if="importMessage" class="mt-4 p-3 bg-green-50 rounded-8 text-small text-green-700">
      {{ importMessage }}
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onUnmounted, onMounted } from 'vue'
import { useApi } from '@/composables/useApi'
import { ElMessage } from 'element-plus'
import type { BangumiSearchResult } from '@/types'

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{
  'update:visible': [value: boolean]
  added: []
}>()

const api = useApi()
const keyword = ref('')
const searching = ref(false)
const submitting = ref(false)
const searchResults = ref<BangumiSearchResult[]>([])
const searchError = ref('')
const tagsInput = ref('')
const importMessage = ref('')

const dialogWidth = ref(window.innerWidth < 768 ? '95%' : '550px')

function onResize() {
  dialogWidth.value = window.innerWidth < 768 ? '95%' : '550px'
}

onMounted(() => {
  window.addEventListener('resize', onResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  if (searchTimer) clearTimeout(searchTimer)
})

const form = reactive({
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

let searchTimer: ReturnType<typeof setTimeout> | null = null

function resetForm() {
  form.title_cn = ''
  form.title_jp = ''
  form.cover_url = ''
  form.description = ''
  form.episodes = 0
  form.status = ''
  form.platform = ''
  form.air_date = ''
  form.season = ''
  tagsInput.value = ''
  searchResults.value = []
  searchError.value = ''
  importMessage.value = ''
  keyword.value = ''
}

watch(
  () => props.visible,
  (v) => {
    if (v) resetForm()
  }
)

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  const val = keyword.value.trim()
  if (!val) {
    searchResults.value = []
    searchError.value = ''
    return
  }
  searchTimer = setTimeout(async () => {
    searching.value = true
    searchError.value = ''
    try {
      const res = await api.searchBangumi(val)
      searchResults.value = res.animes
      if (res.animes.length === 0) searchError.value = '未找到，试试手动填写'
    } catch {
      searchResults.value = []
      searchError.value = '搜索暂不可用，请尝试手动填写'
    } finally {
      searching.value = false
    }
  }, 300)
}

function selectBangumi(item: BangumiSearchResult) {
  form.title_cn = item.title_cn
  form.title_jp = item.title_jp
  form.cover_url = item.cover_url
  form.description = item.summary
  form.episodes = item.episodes
  form.air_date = item.air_date
  form.platform = item.platform
  tagsInput.value = item.tags.join(', ')
  searchResults.value = []
  keyword.value = ''
  // 异步获取详细数据（状态、季度等）
  fetchBangumiDetail(item.bgm_id)
}

async function fetchBangumiDetail(bgmId: number) {
  try {
    const detail = await api.getBangumiDetail(bgmId)
    if (detail.status) form.status = detail.status
    if (detail.season) form.season = detail.season
    if (detail.description && !form.description) form.description = detail.description
    // 如果搜到的空字段较多，用详情数据补充
    if (detail.episodes && !form.episodes) form.episodes = detail.episodes
    if (detail.platform && !form.platform) form.platform = detail.platform
    if (detail.tags.length && !tagsInput.value) tagsInput.value = detail.tags.join(', ')
  } catch {
    // 详情获取失败不影响手动填写
  }
}

async function submit() {
  if (!form.title_cn) return
  submitting.value = true
  try {
    const tags = tagsInput.value
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean)

    await api.createAnime({
      ...form,
      tags: JSON.stringify(tags)
    })

    ElMessage.success('番剧添加成功')
    emit('update:visible', false)
    emit('added')
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '添加失败')
  } finally {
    submitting.value = false
  }
}

</script>

<style scoped>
.add-anime-dialog {
  margin: 0 !important;
  height: 90vh;
  max-width: 95vw;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
}
.add-anime-dialog :deep(.el-dialog__body) {
  flex: 1;
  overflow-y: auto;
}
/* 表单间距压缩 */
.add-anime-dialog :deep(.el-form-item) {
  margin-bottom: 8px !important;
}
.add-anime-dialog :deep(.el-form-item__label) {
  padding-bottom: 2px !important;
  font-size: 12px !important;
}
</style>
