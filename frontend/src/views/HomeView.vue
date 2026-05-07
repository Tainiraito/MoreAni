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
        <h1 class="text-2xl font-bold text-gradient">MoreAni</h1>
        <div class="flex items-center gap-4">
          <template v-if="isLoggedIn">
            <div class="relative group">
              <div class="flex items-center gap-1.5 cursor-pointer select-none py-1 px-2 -mx-2 rounded-8 hover:bg-primary-pink/10 transition-colors">
                <el-icon class="text-primary-pink"><UserFilled /></el-icon>
                <span class="text-small text-text-body">{{ currentUser?.username }}</span>
                <el-icon class="text-text-secondary text-xs transition-transform group-hover:rotate-180"><ArrowDown /></el-icon>
              </div>
              <!-- Dropdown -->
              <div class="absolute right-0 top-full mt-1 min-w-[160px] bg-white rounded-8 shadow-lg border border-gray-100 py-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 translate-y-1 group-hover:translate-y-0 z-50">
                <button
                  class="w-full text-left px-4 py-2.5 text-small text-text-primary hover:bg-primary-pink/5 transition-colors flex items-center gap-2"
                  @click="showChangeUsernameDialog = true"
                >
                  <el-icon :size="14" class="text-primary-pink"><EditPen /></el-icon>
                  修改用户名
                </button>
                <button
                  class="w-full text-left px-4 py-2.5 text-small text-text-primary hover:bg-primary-pink/5 transition-colors flex items-center gap-2"
                  @click="showChangePasswordDialog = true"
                >
                  <el-icon :size="14" class="text-primary-purple"><Lock /></el-icon>
                  修改密码
                </button>
                <div class="border-t border-gray-50 my-1"></div>
                <button
                  class="w-full text-left px-4 py-2.5 text-small text-red-500 hover:bg-red-50 transition-colors flex items-center gap-2"
                  @click="handleLogout"
                >
                  <el-icon :size="14"><SwitchButton /></el-icon>
                  退出登录
                </button>
              </div>
            </div>
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
        <!-- 今天看什么 - 标题（移出卡片外） -->
        <div class="flex flex-col">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-3">
              <span class="w-1.5 h-5 bg-gradient-to-b from-primary-pink to-primary-purple rounded-full shrink-0"></span>
              <h2 class="section-title">今天看什么</h2>
            </div>
            <button
              class="btn-soft !text-xs !px-3 !py-1"
              @click.stop="refreshRandom"
            >
              <el-icon :size="13"><RefreshRight /></el-icon>
              换一个
            </button>
          </div>

          <section class="glass-card overflow-hidden relative cursor-pointer group flex-1 min-h-[220px]" @click="randomAnime && openDetail(randomAnime.id)">
            <!-- 封面图背景 -->
            <template v-if="randomAnime">
              <div v-if="randomAnime.cover_url" class="absolute inset-0">
                <img
                  :src="randomAnime.cover_url"
                  :alt="randomAnime.title_cn"
                  class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  @error="(e: Event) => { (e.target as HTMLImageElement).style.display = 'none' }"
                />
                <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent"></div>
              </div>
              <div v-else class="absolute inset-0 bg-gradient-to-br from-primary-pink/20 to-primary-purple/20">
                <div class="absolute inset-0 bg-gradient-to-t from-primary-pink/15 to-transparent"></div>
              </div>
            </template>

            <!-- 内容区域 -->
            <div class="relative z-10 flex flex-col justify-end h-full p-5" :class="randomAnime?.cover_url ? 'text-white' : ''">
              <!-- 信息 - 底部 -->
              <div v-if="randomAnime" class="mt-auto">
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
                    <span>均分 {{ Number(randomAnime.avg_anime_score).toFixed(1) }}</span>
                  </span>
                  <span v-if="randomAnime.avg_recommend" class="flex items-center gap-1 whitespace-nowrap">
                    <el-icon :size="13"><GoldMedal /></el-icon>
                    <span>推荐 {{ Number(randomAnime.avg_recommend).toFixed(1) }}</span>
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

            <!-- 悬停光效 -->
            <div v-if="randomAnime?.cover_url" class="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500">
              <div class="absolute -top-16 -right-16 w-32 h-32 bg-white/10 rounded-full blur-3xl"></div>
              <div class="absolute -bottom-16 -left-16 w-32 h-32 bg-primary-purple/15 rounded-full blur-3xl"></div>
            </div>
          </section>
        </div>

        <!-- 大家在看啥 -->
        <div class="flex flex-col">
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-center gap-3">
              <span class="w-1.5 h-5 bg-gradient-to-b from-primary-pink to-primary-purple rounded-full shrink-0"></span>
              <h2 class="section-title">大家在看啥</h2>
            </div>
            <button class="btn-soft !text-xs !px-3 !py-1" @click="showRatingsHistory = true">
              <el-icon :size="13"><List /></el-icon>
              全部
            </button>
          </div>

          <section class="glass-card p-5 flex-1">
          <div v-if="recentRatings.length > 0" class="space-y-3">
            <div
              v-for="rating in recentRatings"
              :key="rating.id"
              class="flex items-center gap-3 p-2 rounded-8 hover:bg-primary-pink/5 cursor-pointer transition-colors"
              @click="openDetail(rating.anime_id)"
            >
              <img
                :src="rating.anime_cover"
                class="w-14 h-20 object-cover rounded-4 flex-shrink-0"
                @error="(e: Event) => ((e.target as HTMLImageElement).style.opacity = '0')"
              />
              <div class="min-w-0 flex-1">
                <p class="text-small">
                  <span class="font-semibold text-primary-pink">{{ rating.username }}</span>
                  <span class="text-text-secondary"> → </span>
                  <span class="text-text-primary">{{ rating.anime_title }}</span>
                </p>
                <p class="text-small text-text-secondary">
                  <template v-if="rating.anime_score > 0">
                    <span class="inline-flex items-center gap-1">
                      <el-icon :size="13" class="text-primary-pink"><StarFilled /></el-icon>
                      <span class="text-primary-pink font-medium">{{ rating.anime_score }}分</span>
                    </span>
                    <span class="mx-1 text-text-body">·</span>
                    <span class="inline-flex items-center gap-1">
                      <el-icon :size="13" class="text-primary-purple"><GoldMedal /></el-icon>
                      <span class="text-primary-purple font-medium">{{ rating.recommend }}分</span>
                    </span>
                  </template>
                  <span v-else class="text-text-secondary text-xs">暂不打分</span>
                </p>
                <p v-if="rating.review" class="text-small text-text-body mt-1 whitespace-pre-wrap break-words">{{ rating.review }}</p>
              </div>
            </div>
          </div>
          <EmptyState v-else-if="loading" type="loading" title="加载中..." description="" />
          <EmptyState v-else type="empty" title="暂无动态" description="还没有评分哦～" />
        </section>
        </div>
      </div>

      <!-- Section 2: 评分汇总表 -->
      <section>
        <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 class="section-title flex items-center gap-3">
            <span class="w-1.5 h-5 bg-gradient-to-b from-primary-pink to-primary-purple rounded-full shrink-0"></span>
            番剧列表
          </h2>
          <div class="flex gap-2 items-center">
            <button
              class="btn-gradient h-7 whitespace-nowrap"
              @click="handleAddAnime"
            >
              <el-icon><Plus /></el-icon>
              添加番剧
            </button>
            <el-input
              v-model="searchKeyword"
              placeholder="搜索番剧..."
              size="small"
              clearable
              class="!w-40"
              @input="onSearch"
              @clear="onSearchClear"
            />
            <el-select v-model="sortBy" size="small" class="!w-32" @change="onSortChange">
              <el-option label="按均分" value="avg_score" />
              <el-option label="按推荐" value="avg_rec" />
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
                <th class="text-center py-3 px-2 text-text-secondary font-medium whitespace-nowrap w-10 text-xs">#</th>
                <th class="text-left py-3 px-4 text-text-secondary font-medium whitespace-nowrap w-auto min-w-[120px]">番剧名</th>
                <th class="text-center py-3 px-4 text-text-secondary font-medium whitespace-nowrap w-20">
                  <span class="inline-flex items-center gap-0.5"><el-icon :size="14" class="text-primary-pink"><StarFilled /></el-icon>均分</span>
                </th>
                <th class="text-center py-3 px-4 text-text-secondary font-medium whitespace-nowrap w-20">
                  <span class="inline-flex items-center gap-0.5"><el-icon :size="14" class="text-primary-purple"><GoldMedal /></el-icon>推荐</span>
                </th>
                <th class="text-center py-3 px-4 text-text-secondary font-medium whitespace-nowrap w-14">人数</th>
                <th class="text-left py-3 px-4 text-text-secondary font-medium whitespace-nowrap w-auto min-w-[160px] max-w-xs">最新评价</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(anime, i) in animes"
                :key="anime.id"
                class="border-b border-gray-50 hover:bg-primary-pink/5 cursor-pointer transition-colors"
                :class="{ 'bg-gradient-to-r from-primary-pink/[0.07] to-transparent': isLoggedIn && anime.user_rated === false }"
                @click="openDetail(anime.id)"
              >
                <td class="text-center py-3 px-2 text-text-secondary text-xs whitespace-nowrap">{{ i + 1 }}</td>
                <td class="py-3 px-4 min-w-0">
                  <div class="flex items-center gap-1.5 flex-nowrap">
                    <span class="text-text-primary truncate">{{ anime.title_cn }}</span>
                    <el-tag
                      v-for="t in getAnimeTags(anime)"
                      :key="t"
                      size="small"
                      round
                      class="tag-type"
                      @click.stop="filterByTag(t)"
                    >{{ t }}</el-tag>
                  </div>
                </td>
                <td class="py-3 px-4 text-center text-primary-pink font-semibold whitespace-nowrap">{{ anime.avg_anime_score != null ? Number(anime.avg_anime_score).toFixed(1) : '-' }}</td>
                <td class="py-3 px-4 text-center text-primary-purple font-semibold whitespace-nowrap">{{ anime.avg_recommend != null ? Number(anime.avg_recommend).toFixed(1) : '-' }}</td>
                <td class="py-3 px-4 text-center text-text-secondary whitespace-nowrap">{{ anime.rating_count ?? 0 }}</td>
                <td class="py-3 px-4 text-text-body truncate max-w-[220px]">
                  <el-tooltip
                    v-if="anime.latest_review"
                    :content="anime.latest_review"
                    placement="top"
                    effect="custom"
                    popper-class="custom-tooltip"
                    :disabled="!isReviewOverflowing(i)"
                  >
                    <span :ref="el => reviewRefs[i] = el as HTMLElement" class="block truncate">{{ anime.latest_review }}</span>
                  </el-tooltip>
                  <span v-else>-</span>
                </td>
              </tr>
            </tbody>
          </table>
          <!-- 底部加载指示 -->
          <div v-if="loadingMore" class="py-4 text-center text-text-secondary text-xs">
            <el-icon class="is-loading"><Loading /></el-icon> 加载更多...
          </div>
          <div v-else-if="!hasMore && animes.length > 0" class="py-4 text-center text-text-secondary text-xs">
            — 已显示全部 {{ totalCount }} 部番剧 —
          </div>
        </div>
      </section>
    </main>

    <!-- 页面底部 -->
    <footer class="py-6 text-center text-text-secondary text-sm border-t border-gray-100 font-normal">
      <p>© 2026 MoreAni</p>
    </footer>

    <!-- Change Username Dialog -->
    <el-dialog
      v-model="showChangeUsernameDialog"
      title="修改用户名"
      :width="userDialogWidth"
      destroy-on-close
      @closed="usernameUniqueError = ''"
    >
      <el-form label-position="top">
        <el-form-item
          label="新用户名"
          :error="usernameUniqueError"
        >
          <el-input
            v-model="changeUsernameForm.newUsername"
            placeholder="输入新用户名"
            :maxlength="50"
            @blur="checkUsernameUnique"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="flex justify-end gap-3">
          <el-button class="btn-soft !text-xs" @click="showChangeUsernameDialog = false">取消</el-button>
          <el-button class="btn-gradient !text-xs" :loading="changingUsername" @click="handleChangeUsername">
            确认修改
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- Change Password Dialog -->
    <el-dialog
      v-model="showChangePasswordDialog"
      title="修改密码"
      :width="userDialogWidth"
      destroy-on-close
      @opened="onPasswordDialogOpened"
    >
      <el-form label-position="top">
        <el-form-item label="原密码">
          <el-input
            v-model="changePasswordForm.oldPassword"
            type="password"
            placeholder="输入原密码"
            show-password
          />
        </el-form-item>
        <el-form-item label="新密码" :error="newPasswordError">
          <el-input
            v-model="changePasswordForm.newPassword"
            type="password"
            placeholder="输入新密码（至少6位）"
            show-password
            @input="onNewPasswordInput"
          />
        </el-form-item>
        <el-form-item label="再次输入新密码" :error="passwordConfirmError">
          <el-input
            v-model="changePasswordForm.confirmPassword"
            type="password"
            placeholder="再次输入新密码确认"
            show-password
            @input="onPasswordConfirmInput"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="flex justify-end gap-3">
          <el-button class="btn-soft !text-xs" @click="showChangePasswordDialog = false">取消</el-button>
          <el-button class="btn-gradient !text-xs" :loading="changingPassword" @click="handleChangePassword">
            确认修改
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- Anime Detail Modal -->
    <AnimeDetailModal
      v-model:visible="showDetail"
      :anime-id="selectedAnimeId"
      :has-previous="selectedAnimeIndex > 0"
      :has-next="selectedAnimeIndex < animes.length - 1"
      @previous="navigateAnime(-1)"
      @next="navigateAnime(1)"
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

    <!-- Ratings History Dialog -->
    <RatingsHistoryDialog
      v-model:visible="showRatingsHistory"
      @update="loadAll"
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
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useApi } from '@/composables/useApi'
import { useAuth } from '@/composables/useAuth'
import { ElMessage } from 'element-plus'
import EmptyState from '@/components/EmptyState.vue'
import AnimeDetailModal from '@/components/anime/AnimeDetailModal.vue'
import AddAnimeDialog from '@/components/anime/AddAnimeDialog.vue'
import AuthDialog from '@/components/auth/AuthDialog.vue'
import RatingsHistoryDialog from '@/components/RatingsHistoryDialog.vue'
import type { Anime, Rating } from '@/types'

const api = useApi()
const { currentUser, clearAuth, setAuth, isLoggedIn, token } = useAuth()
const loading = ref(true)
const randomAnime = ref<Anime | null>(null)
const recentRatings = ref<Rating[]>([])
const animes = ref<Anime[]>([])
const searchKeyword = ref('')
const tagFilter = ref('')
const sortBy = ref('avg_score')

const selectedAnimeIndex = computed(() =>
  animes.value.findIndex(a => a.id === selectedAnimeId.value)
)

function navigateAnime(direction: number) {
  const newIndex = selectedAnimeIndex.value + direction
  if (newIndex >= 0 && newIndex < animes.value.length) {
    selectedAnimeId.value = animes.value[newIndex].id
  }
}

const showDetail = ref(false)
const selectedAnimeId = ref(0)
const showAddDialog = ref(false)
const showAuthDialog = ref(false)
const showRatingsHistory = ref(false)
const showBackTop = ref(false)
const headerScrolled = ref(false)
const showChangeUsernameDialog = ref(false)
const showChangePasswordDialog = ref(false)
const changeUsernameForm = ref({ newUsername: '' })
const changePasswordForm = ref({ oldPassword: '', newPassword: '', confirmPassword: '' })
const changingUsername = ref(false)
const changingPassword = ref(false)
const usernameUniqueError = ref('')
const usernameCheckTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const passwordConfirmError = ref('')
const newPasswordError = ref('')
const userDialogWidth = ref(window.innerWidth < 768 ? '95%' : '400px')
const reviewRefs = ref<(HTMLElement | null)[]>([])
const page = ref(1)
const hasMore = ref(true)
const loadingMore = ref(false)
const totalCount = ref(0)

function getAnimeTags(anime: Anime): string[] {
  try {
    const parsed = JSON.parse(anime.tags)
    return Array.isArray(parsed) ? parsed.slice(0, 3) : []
  } catch {
    return []
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null

function isReviewOverflowing(index: number): boolean {
  const el = reviewRefs.value[index]
  if (!el) return false
  return el.scrollWidth > el.clientWidth
}

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
  // 手动输入时清除 tagFilter
  tagFilter.value = ''
  page.value = 1
  hasMore.value = true
  searchTimer = setTimeout(() => loadAnimes(), 300)
}

function onSearchClear() {
  searchKeyword.value = ''
  tagFilter.value = ''
  page.value = 1
  hasMore.value = true
  loadAnimes()
}

function filterByTag(tag: string) {
  searchKeyword.value = tag
  tagFilter.value = tag
  page.value = 1
  hasMore.value = true
  loadAnimes()
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
  page.value = 1
  hasMore.value = true
  try {
    await Promise.all([loadAnimes(), loadRandom(), loadRecent()])
  } catch {
    // 各子函数已有自己的错误处理
  } finally {
    loading.value = false
  }
}

async function loadAnimes(append = false) {
  try {
    const params: Record<string, string | number> = { limit: 50, sort: sortBy.value, page: page.value }
    if (searchKeyword.value && !tagFilter.value) params.search = searchKeyword.value
    if (tagFilter.value) params.tag = tagFilter.value
    const res = await api.getAnimes(params)
    totalCount.value = res.total
    if (append) {
      animes.value = [...animes.value, ...res.items]
    } else {
      animes.value = res.items
    }
    hasMore.value = animes.value.length < res.total
    reviewRefs.value = new Array(animes.value.length).fill(null)
  } catch {
    if (!append) animes.value = []
  }
}

async function loadMore() {
  if (loadingMore.value || !hasMore.value) return
  loadingMore.value = true
  page.value++
  await loadAnimes(true)
  loadingMore.value = false
}

function onSortChange() {
  page.value = 1
  hasMore.value = true
  loadAnimes()
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

async function checkUsernameUnique() {
  const val = changeUsernameForm.value.newUsername.trim()
  if (!val || val.length < 2) {
    usernameUniqueError.value = ''
    return
  }
  if (usernameCheckTimer.value) clearTimeout(usernameCheckTimer.value)
  usernameCheckTimer.value = setTimeout(async () => {
    try {
      const result = await api.checkUsername(val)
      usernameUniqueError.value = result.available ? '' : '该用户名已被使用'
    } catch {
      usernameUniqueError.value = ''
    }
  }, 500)
}

async function handleChangeUsername() {
  const form = changeUsernameForm.value
  if (!form.newUsername || form.newUsername.length < 2) {
    ElMessage.warning('用户名至少2个字符')
    return
  }
  if (usernameUniqueError.value) {
    ElMessage.warning('用户名已被使用，请换一个')
    return
  }
  changingUsername.value = true
  try {
    const user = await api.changeUsername(form.newUsername)
    // 强制更新当前用户信息
    setAuth(token.value!, user)
    // 额外确保：如果 setAuth 的 ref 更新未被追踪，直接赋值
    if (currentUser.value) currentUser.value.username = user.username
    ElMessage.success('用户名修改成功')
    // 刷新页面数据 — 让 "大家在看啥"、"大家的评分" 等展示最新用户名
    await loadRecent()
    showChangeUsernameDialog.value = false
    changeUsernameForm.value = { newUsername: '' }
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '修改失败')
  } finally {
    changingUsername.value = false
  }
}

async function handleChangePassword() {
  const form = changePasswordForm.value
  if (!form.oldPassword) {
    ElMessage.warning('请输入原密码')
    return
  }
  if (!form.newPassword || form.newPassword.length < 6) {
    ElMessage.warning('新密码至少6位')
    return
  }
  if (passwordConfirmError.value) {
    ElMessage.warning('两次输入的密码不一致')
    return
  }
  changingPassword.value = true
  try {
    await api.changePassword(form.oldPassword, form.newPassword)
    ElMessage.success('密码修改成功，请重新登录')
    showChangePasswordDialog.value = false
    changePasswordForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
    // 强制重新登录
    clearAuth()
    showAuthDialog.value = true
  } catch (e: unknown) {
    ElMessage.error((e as Error).message || '修改失败')
  } finally {
    changingPassword.value = false
  }
}

function onPasswordDialogOpened() {
  newPasswordError.value = ''
  passwordConfirmError.value = ''
  changePasswordForm.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
}

function onNewPasswordInput() {
  const newPwd = changePasswordForm.value.newPassword
  if (newPwd && newPwd.length < 6) {
    newPasswordError.value = '新密码至少6位'
  } else {
    newPasswordError.value = ''
  }
  // 新密码改变时也重新校验确认密码一致性
  onPasswordConfirmInput()
}

function onPasswordConfirmInput() {
  const confirm = changePasswordForm.value.confirmPassword
  const newPwd = changePasswordForm.value.newPassword
  if (confirm && newPwd && confirm !== newPwd) {
    passwordConfirmError.value = '两次输入的密码不一致'
  } else {
    passwordConfirmError.value = ''
  }
}

const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

const handleScroll = () => {
  showBackTop.value = window.scrollY > 400
  headerScrolled.value = window.scrollY > 60
  // 滚动加载：距底部 300px 时触发
  if (!loadingMore.value && hasMore.value) {
    const scrollBottom = window.innerHeight + window.scrollY
    const docHeight = document.documentElement.scrollHeight
    if (docHeight - scrollBottom < 300) {
      loadMore()
    }
  }
}

onMounted(() => {
  validateAuthThenLoad()
  window.addEventListener('scroll', handleScroll)
})

async function validateAuthThenLoad() {
  // 页面加载时主动校验 token 是否过期
  if (token.value) {
    try {
      await api.getMe()
    } catch {
      // token 过期，clearAuth 已在 request 中调用
    }
  }
  await loadAll()
}

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
  window.removeEventListener('scroll', handleScroll)
})
</script>
