<template>
  <div class="min-h-screen bg-white">
    <!-- Navbar -->
    <header class="sticky top-0 z-50 border-b border-gray-100">
      <!-- 白色 overlay — 滚动时渐显，增强对比 -->
      <div
        class="absolute inset-0 bg-white transition-opacity duration-500"
        :style="{ opacity: headerScrolled ? 0.82 : 0 }"
      ></div>
      <!-- 原始渐变背景（始终存在） -->
      <div class="absolute inset-0 bg-gradient-to-r from-primary-pink/10 via-white/60 to-primary-purple/10 backdrop-blur-md"></div>
      <!-- 内容 -->
      <div class="relative container mx-auto px-4 py-3 flex items-center justify-between">
        <h1 class="text-2xl font-bold text-gradient">MoreAni 又看一集</h1>
        <div class="flex items-center gap-4">
          <template v-if="isLoggedIn">
            <span class="text-small text-text-body flex items-center gap-1">
              <el-icon><UserFilled /></el-icon>
              {{ currentUser?.username }}
            </span>
            <button
              class="btn-text"
              @click="handleLogout"
            >
              <el-icon><SwitchButton /></el-icon>
              退出
            </button>
          </template>
          <button
            v-else
            class="btn-gradient"
            @click="showAuthDialog = true"
          >
            <el-icon><User /></el-icon>
            登录
          </button>
        </div>
      </div>
    </header>

    <main class="container mx-auto px-4 py-6">
      <!-- Section 1: 今天看什么 + 大家在看啥 -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <!-- 今天看什么 -->
        <section class="glass-card overflow-hidden relative cursor-pointer group" @click="randomAnime && openDetail(randomAnime.id)">
          <!-- 封面图背景（有封面时） -->
          <template v-if="randomAnime">
            <div v-if="randomAnime.cover_url" class="absolute inset-0">
              <img
                :src="randomAnime.cover_url"
                :alt="randomAnime.title_cn"
                class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                @error="(e: Event) => { (e.target as HTMLImageElement).style.display = 'none' }"
              />
              <div class="absolute inset-0 bg-gradient-to-r from-black/65 via-black/40 to-black/20"></div>
            </div>
            <div v-else class="absolute inset-0 bg-gradient-to-br from-primary-pink/20 to-primary-purple/20">
              <div class="absolute inset-0 bg-gradient-to-r from-primary-pink/10 to-primary-purple/5"></div>
            </div>
          </template>

          <!-- 内容区域 -->
          <div class="relative z-10" :class="randomAnime ? (randomAnime.cover_url ? 'p-5 flex flex-col justify-between min-h-[180px] text-white' : 'p-5') : ''">
            <!-- 标题栏 -->
            <div class="flex items-start justify-between mb-1">
              <h2
                :class="randomAnime?.cover_url
                  ? 'mb-0 flex items-center gap-1 text-lg font-bold text-white'
                  : 'section-title mb-0 flex items-center gap-1'"
              >
                <el-icon :size="18"><MagicStick /></el-icon>
                今天看什么
              </h2>
              <button
                class="btn-soft !border-white/30 !bg-white/15 backdrop-blur-sm !text-white/90 hover:!text-white hover:!bg-white/25 hover:!border-white/50 shrink-0"
                :class="{ '!border-primary-purple/30 !bg-primary-purple/5 !text-primary-purple hover:!text-primary-purple hover:!bg-primary-purple/15': !randomAnime?.cover_url }"
                @click.stop="refreshRandom"
              >
                <el-icon><RefreshRight /></el-icon>
                换一个
              </button>
            </div>

            <!-- 有推荐内容时 -->
            <div v-if="randomAnime" class="mt-2">
              <h3 class="font-semibold leading-tight mb-0.5" :class="randomAnime.cover_url ? 'text-lg' : 'text-card-title text-text-primary'">
                {{ randomAnime.title_cn }}
              </h3>
              <p class="text-xs opacity-70 mb-1.5">{{ randomAnime.title_jp }}</p>
              <p class="text-xs leading-relaxed line-clamp-2 mb-2" :class="randomAnime.cover_url ? 'opacity-85' : 'text-text-body'">
                {{ randomAnime.description }}
              </p>
              <!-- 评分 -->
              <div class="flex items-center gap-x-2.5 text-xs leading-none" :class="randomAnime.cover_url ? 'opacity-90' : 'text-text-secondary'">
                <span v-if="randomAnime.avg_anime_score" class="flex items-center gap-1 whitespace-nowrap">
                  <el-icon :size="13"><StarFilled /></el-icon>
                  <span>均分 {{ randomAnime.avg_anime_score }}</span>
                </span>
                <span v-if="randomAnime.avg_recommend" class="flex items-center gap-1 whitespace-nowrap">
                  <el-icon :size="13"><GoldMedal /></el-icon>
                  <span>推荐 {{ randomAnime.avg_recommend }}</span>
                </span>
                <span v-if="randomAnime.rating_count" class="flex items-center gap-1 whitespace-nowrap">
                  <el-icon :size="13"><User /></el-icon>
                  <span>{{ randomAnime.rating_count }}人已评</span>
                </span>
              </div>
            </div>

            <!-- 加载/空状态 -->
            <EmptyState v-if="!randomAnime && loading" type="loading" title="加载中..." description="" />
            <EmptyState v-else-if="!randomAnime" type="empty" title="暂无推荐" description="添加一些番剧后再来看看吧～" />
          </div>

          <!-- 悬停光效装饰 -->
          <div v-if="randomAnime?.cover_url" class="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500">
            <div class="absolute -top-16 -right-16 w-32 h-32 bg-white/10 rounded-full blur-3xl"></div>
            <div class="absolute -bottom-16 -left-16 w-32 h-32 bg-primary-purple/15 rounded-full blur-3xl"></div>
          </div>
        </section>

        <!-- 大家在看啥 -->
        <section class="glass-card p-6">
          <h2 class="section-title mb-4 flex items-center gap-1">
            <span class="w-0.5 h-4 bg-gradient-to-b from-primary-pink to-primary-purple rounded-full shrink-0"></span>
            <el-icon :size="18"><Connection /></el-icon>
            大家在看啥
          </h2>
          <div v-if="recentRatings.length > 0" class="space-y-3">
            <div
              v-for="rating in recentRatings"
              :key="rating.id"
              class="flex items-center gap-3 p-2 rounded-8 hover:bg-primary-pink/5 cursor-pointer transition-colors"
              @click="openDetail(rating.anime_id)"
            >
              <img
                :src="rating.anime_cover"
                class="w-10 h-14 object-cover rounded-4 flex-shrink-0"
                @error="(e: Event) => ((e.target as HTMLImageElement).style.opacity = '0')"
              />
              <div class="min-w-0 flex-1">
                <p class="text-small">
                  <span class="font-semibold text-primary-pink">{{ rating.username }}</span>
                  <span class="text-text-secondary"> → </span>
                  <span class="text-text-primary">{{ rating.anime_title }}</span>
                </p>
                <p class="text-small text-text-secondary">
                  <el-icon :size="13" class="text-primary-pink"><StarFilled /></el-icon>{{ rating.anime_score }}
                  <el-icon :size="13" class="text-primary-yellow"><GoldMedal /></el-icon>{{ rating.recommend }}
                  <span v-if="rating.review" class="text-text-body">
                    <span class="mx-1">·</span>{{ rating.review }}
                  </span>
                </p>
              </div>
            </div>
          </div>
          <EmptyState v-else-if="loading" type="loading" title="加载中..." description="" />
          <EmptyState v-else type="empty" title="暂无动态" description="还没有评分哦～" />
        </section>
      </div>

      <!-- Section 2: 评分汇总表 -->
      <section>
        <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 class="section-title flex items-center gap-1">
            <span class="w-0.5 h-4 bg-gradient-to-b from-primary-pink to-primary-purple rounded-full shrink-0"></span>
            <el-icon :size="18"><Film /></el-icon>
            番剧列表
          </h2>
          <div class="flex gap-2 items-center">
            <button
              class="btn-gradient h-7"
              @click="handleAddAnime"
            >
              <el-icon><Plus /></el-icon>
              添加番剧
            </button>
            <el-input
              v-model="searchKeyword"
              placeholder="搜索番剧..."
              size="small"
              class="!w-40"
              @input="onSearch"
            />
            <el-select v-model="sortBy" size="small" class="!w-28" @change="loadAnimes">
              <el-option label="按均分" value="avg_score" />
              <el-option label="按人数" value="count" />
            </el-select>
          </div>
        </div>

        <EmptyState v-if="loading" type="loading" title="加载中..." description="" />
        <EmptyState v-else-if="animes.length === 0" type="empty" title="暂无番剧" description="点击右上角添加第一个番剧吧～" />
        <div v-else class="glass-card overflow-x-auto">
          <table class="w-full text-small">
            <thead>
              <tr class="border-b border-gray-100">
                <th class="text-left py-3 px-4 text-text-secondary font-medium whitespace-nowrap w-auto min-w-[120px]">番剧名</th>
                <th class="text-center py-3 px-4 text-text-secondary font-medium whitespace-nowrap w-20">
                  <span class="inline-flex items-center gap-0.5"><el-icon :size="14" class="text-primary-pink"><StarFilled /></el-icon>均分</span>
                </th>
                <th class="text-center py-3 px-4 text-text-secondary font-medium whitespace-nowrap w-20">
                  <span class="inline-flex items-center gap-0.5"><el-icon :size="14" class="text-primary-yellow"><GoldMedal /></el-icon>推荐</span>
                </th>
                <th class="text-center py-3 px-4 text-text-secondary font-medium whitespace-nowrap w-14">人数</th>
                <th class="text-left py-3 px-4 text-text-secondary font-medium whitespace-nowrap w-auto min-w-[160px] max-w-xs">最新评价</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="anime in animes"
                :key="anime.id"
                class="border-b border-gray-50 hover:bg-primary-pink/5 cursor-pointer transition-colors"
                @click="openDetail(anime.id)"
              >
                <td class="py-3 px-4 text-text-primary whitespace-nowrap truncate max-w-[200px]">{{ anime.title_cn }}</td>
                <td class="py-3 px-4 text-center text-primary-pink font-semibold whitespace-nowrap">{{ anime.avg_anime_score ?? '-' }}</td>
                <td class="py-3 px-4 text-center text-primary-purple font-semibold whitespace-nowrap">{{ anime.avg_recommend ?? '-' }}</td>
                <td class="py-3 px-4 text-center text-text-secondary whitespace-nowrap">{{ anime.rating_count ?? 0 }}</td>
                <td class="py-3 px-4 text-text-body truncate max-w-[220px]" :title="anime.latest_review || ''">{{ anime.latest_review || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>

    <!-- 页面底部 -->
    <footer class="py-6 text-center text-text-secondary text-sm border-t border-gray-100 font-normal">
      <p>© 2026 MoreAni</p>
    </footer>

    <!-- Anime Detail Modal -->
    <AnimeDetailModal
      v-model:visible="showDetail"
      :anime-id="selectedAnimeId"
      @refresh="loadAll"
    />

    <!-- Add Anime Dialog -->
    <AddAnimeDialog
      v-model:visible="showAddDialog"
      @added="loadAll"
    />

    <!-- Auth Dialog -->
    <AuthDialog
      v-model:visible="showAuthDialog"
      @success="loadAll"
    />

    <!-- 回到顶部按钮 -->
    <button
      class="back-to-top"
      @click="scrollToTop"
      :class="{ visible: showBackTop }"
      aria-label="回到顶部"
    >
      ↑
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useApi } from '@/composables/useApi'
import { useAuth } from '@/composables/useAuth'
import EmptyState from '@/components/EmptyState.vue'
import AnimeDetailModal from '@/components/anime/AnimeDetailModal.vue'
import AddAnimeDialog from '@/components/anime/AddAnimeDialog.vue'
import AuthDialog from '@/components/auth/AuthDialog.vue'
import type { Anime, Rating } from '@/types'

const api = useApi()
const { currentUser, clearAuth, isLoggedIn } = useAuth()

const loading = ref(true)
const randomAnime = ref<Anime | null>(null)
const recentRatings = ref<Rating[]>([])
const animes = ref<Anime[]>([])
const searchKeyword = ref('')
const sortBy = ref('avg_score')

const showDetail = ref(false)
const selectedAnimeId = ref(0)
const showAddDialog = ref(false)
const showAuthDialog = ref(false)
const showBackTop = ref(false)
const headerScrolled = ref(false)

let searchTimer: ReturnType<typeof setTimeout> | null = null

function openDetail(id: number) {
  selectedAnimeId.value = id
  showDetail.value = true
}

function handleAddAnime() {
  if (isLoggedIn.value) {
    showAddDialog.value = true
  } else {
    showAuthDialog.value = true
  }
}

function onSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => loadAnimes(), 300)
}

async function refreshRandom() {
  try {
    randomAnime.value = await api.getRandomUnrated()
  } catch {
    randomAnime.value = null
  }
}

async function loadAll() {
  loading.value = true
  await Promise.all([loadAnimes(), loadRandom(), loadRecent()])
  loading.value = false
}

async function loadAnimes() {
  try {
    const params: Record<string, string | number> = { limit: 50, sort: sortBy.value }
    if (searchKeyword.value) params.search = searchKeyword.value
    const res = await api.getAnimes(params)
    animes.value = res.items
  } catch {
    animes.value = []
  }
}

async function loadRandom() {
  try {
    randomAnime.value = await api.getRandomUnrated()
  } catch {
    randomAnime.value = null
  }
}

async function loadRecent() {
  try {
    recentRatings.value = await api.getRecentRatings(5)
  } catch {
    recentRatings.value = []
  }
}

function handleLogout() {
  clearAuth()
  // 退出后留在首页，登录按钮自动切换为显示状态
}

const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

const handleScroll = () => {
  showBackTop.value = window.scrollY > 400
  headerScrolled.value = window.scrollY > 60
}

onMounted(() => {
  loadAll()
  window.addEventListener('scroll', handleScroll)
})

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
  window.removeEventListener('scroll', handleScroll)
})
</script>
