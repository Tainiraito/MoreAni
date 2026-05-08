import { ref, onUnmounted, type Ref } from 'vue'
import { useApi } from './useApi'
import type { BangumiSearchResult } from '@/types'

export function useBangumiSearch(form: Record<string, string | number>, tagsInput: Ref<string>) {
  const api = useApi()
  const keyword = ref('')
  const searching = ref(false)
  const searchResults = ref<BangumiSearchResult[]>([])
  const searchError = ref('')
  let searchTimer: ReturnType<typeof setTimeout> | null = null

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
        if (res.animes.length === 0) searchError.value = '未找到'
      } catch {
        searchResults.value = []
        searchError.value = '搜索暂不可用'
      } finally {
        searching.value = false
      }
    }, 300)
  }

  function clearSearch() {
    if (searchTimer) clearTimeout(searchTimer)
    keyword.value = ''
    searchResults.value = []
    searchError.value = ''
  }

  function applyBangumiItem(item: BangumiSearchResult) {
    form.title_cn = item.title_cn
    form.title_jp = item.title_jp
    form.cover_url = item.cover_url
    form.episodes = item.episodes
    form.air_date = item.air_date
    form.platform = item.platform
    form.status = item.status
    form.season = item.season
    form.description = ''
    tagsInput.value = item.tags.join(', ')
    searchResults.value = []
    keyword.value = ''
    searchError.value = ''
    fetchBangumiDetail(item.bgm_id)
  }

  async function fetchBangumiDetail(bgmId: number) {
    form.description = '⌛ 正在获取简介...'
    try {
      const detail = await api.getBangumiDetail(bgmId)
      if (detail.description) form.description = detail.description
      if (detail.status && !form.status) form.status = detail.status
      if (detail.season && !form.season) form.season = detail.season
      if (detail.episodes && !form.episodes) form.episodes = detail.episodes
      if (detail.platform && !form.platform) form.platform = detail.platform
      if (detail.tags.length && !tagsInput.value) tagsInput.value = detail.tags.join(', ')
    } catch {
      form.description = ''
    }
  }

  onUnmounted(() => {
    if (searchTimer) clearTimeout(searchTimer)
  })

  return {
    keyword,
    searching,
    searchResults,
    searchError,
    onSearchInput,
    clearSearch,
    applyBangumiItem
  }
}
