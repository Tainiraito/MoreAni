import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Search, Star, Tv, Save, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useToastStore } from '@/stores/toast-store'
import { useUIStore } from '@/stores/ui-store'
import { useLockBodyScroll } from '@/hooks/use-lock-body-scroll'
import { useMaskClose } from '@/hooks/use-mask-close'
import { secureUrl } from '@/lib/image-url'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { DatePicker } from '@/components/ui/date-picker'
import type { ContentItem, ContentType } from '@/types'

/** Bangumi search result from API */
interface BangumiItem {
  bgm_id: number
  name: string
  name_cn: string
  cover_url: string
  rating: number
  tags: string[]
  eps: number
  air_date: string
  platform: string
  summary: string
}

/** Tag shape returned by the API inside ContentItemResponse.tags */
interface TagResponse {
  id: number
  name: string
  tag_type: string
}

/** Form data shared between add and edit modes */
interface ContentFormData {
  title: string
  title_alt: string
  cover_url: string
  description: string
  content_type: ContentType
  episodes: number
  platform: string
  release_date: string
  tags: string
  bgm_id?: number | null  // set when picked from Bangumi search
}

const CONTENT_TYPES: { value: ContentType; label: string }[] = [
  { value: 'anime', label: '番剧' },
  { value: 'anime_movie', label: '动画电影' },
  { value: 'movie', label: '电影' },
  { value: 'game', label: '游戏' },
  { value: 'software', label: '软件' },
  { value: 'website', label: '网站' },
  { value: 'book', label: '书籍' },
]

function emptyForm(): ContentFormData {
  return {
    title: '',
    title_alt: '',
    cover_url: '',
    description: '',
    content_type: 'anime',
    episodes: 0,
    platform: '',
    release_date: '',
    tags: '',
    bgm_id: null,
  }
}

/** Map a fetched ContentItem into our form shape */
function toForm(item: ContentItem & { tags?: TagResponse[] }): ContentFormData {
  const tagNames = (item.tags ?? []).map((t: TagResponse) => t.name)
  return {
    title: item.title ?? '',
    title_alt: item.title_alt ?? '',
    cover_url: item.cover_url ?? '',
    description: item.description ?? '',
    content_type: (item.content_type as ContentType) ?? 'anime',
    episodes: item.episodes ?? 0,
    platform: item.platform ?? '',
    release_date: item.release_date ?? '',
    tags: tagNames.join(', '),
    // 编辑已有 Bangumi 条目时回填来源 ID（重新获取后提交可更新 Bangumi 关联）
    bgm_id: item.source_type === 'bangumi' && item.source_id ? Number(item.source_id) || null : null,
  }
}

/** Map a Bangumi search result into form fields */
function bangumiToForm(item: BangumiItem): ContentFormData {
  return {
    title: item.name_cn || item.name,
    title_alt: item.name_cn ? item.name : '',
    cover_url: item.cover_url || '',
    description: item.summary || '',
    content_type: 'anime',
    episodes: item.eps || 0,
    platform: item.platform || '',
    release_date: item.air_date || '',
    tags: (item.tags || []).join(', '),
    bgm_id: item.bgm_id,
  }
}

interface ContentFormDialogProps {
  contentId?: number | null  // null/undefined = add mode, number = edit mode
  open: boolean
  onClose: () => void
  onSaved?: () => void  // callback after successful create/update
  initialBangumiSubjectId?: number
  initialBangumiTitle?: string
  initialBangumiTitleAlt?: string
}

export function ContentFormDialog({
  contentId,
  open,
  onClose,
  onSaved,
  initialBangumiSubjectId,
  initialBangumiTitle,
  initialBangumiTitleAlt,
}: ContentFormDialogProps) {
  useLockBodyScroll(open)
  const toast = useToastStore.getState()
  const isEditMode = contentId != null
  // 必须放在 if (!open) return null 之前（hook 无条件调用）
  const maskProps = useMaskClose(() => {
    if (confirmDelete) {
      setConfirmDelete(false)
      return
    }
    onClose()
  })

  // ── Form state ──
  const [form, setForm] = useState<ContentFormData>(emptyForm)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // ── Bangumi search state ──
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BangumiItem[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Input style ──
  const inputStyle: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid var(--border-line)',
    color: 'var(--text-primary)',
  }

  // ── Fetch content for edit mode ──
  useEffect(() => {
    if (!open || !isEditMode) return
    setLoading(true)
    ;(api.getContent(contentId!) as Promise<ContentItem & { tags?: TagResponse[] }>)
      .then(item => setForm(toForm(item)))
      .catch(() => toast.addToast('error', '加载内容失败'))
      .finally(() => setLoading(false))
  }, [open, contentId, isEditMode, toast])

  // ── Prefill a new anime from an exact weekly-calendar Bangumi subject ──
  useEffect(() => {
    if (!open || isEditMode || !initialBangumiSubjectId) return
    let cancelled = false
    const fallback = {
      ...emptyForm(),
      title: initialBangumiTitle ?? '',
      title_alt: initialBangumiTitleAlt ?? '',
    }
    setForm(fallback)
    setLoading(true)
    api.getBangumiDetail(initialBangumiSubjectId)
      .then(detail => {
        if (cancelled) return
        setForm(bangumiToForm(detail as unknown as BangumiItem))
      })
      .catch(() => {
        if (cancelled) return
        toast.addToast('warning', 'Bangumi 信息获取失败，请手动搜索或补充内容')
        setForm(fallback)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, isEditMode, initialBangumiSubjectId, initialBangumiTitle, initialBangumiTitleAlt, toast])

  // ── Debounced Bangumi search ──
  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setSearched(false)
      return
    }
    setSearching(true)
    setSearched(true)
    try {
      const res = await api.searchBangumi(q.trim())
      setResults((res.items || []) as BangumiItem[])
      setShowDropdown(true)
    } catch {
      toast.addToast('error', '搜索失败，请稍后再试')
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [toast])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) {
      setResults([])
      setSearched(false)
      return
    }
    debounceRef.current = setTimeout(() => doSearch(query), 500)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, doSearch])

  // ── Lock body scroll when open ──
  useEffect(() => {
    if (open) {
      const scrollY = window.scrollY
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
      return () => {
        document.documentElement.style.overflow = ''
        document.body.style.overflow = ''
        requestAnimationFrame(() => window.scrollTo(0, scrollY))
      }
    }
  }, [open])

  // ── Reset state when dialog closes ──
  useEffect(() => {
    if (!open) {
      setForm(emptyForm())
      setQuery('')
      setResults([])
      setSearched(false)
      setShowDropdown(false)
      setConfirmDelete(false)
      setDeleting(false)
    }
  }, [open, isEditMode])

  // ── Generic field updater ──
  const update = <K extends keyof ContentFormData>(key: K, value: ContentFormData[K]) =>
    setForm(prev => ({ ...prev, [key]: value }))

  // ── Bangumi auto-fill ──
  const handleBangumiSelect = async (item: BangumiItem) => {
    setForm(bangumiToForm(item))
    setShowDropdown(false)
    setResults([])
    setQuery('')
    toast.addToast('success', `已填入「${item.name_cn || item.name}」的信息`)

    // Fetch full details to get tags + summary (search API doesn't return them)
    try {
      const detail = await api.getBangumiDetail(item.bgm_id) as { tags?: string[]; summary?: string }
      if ((detail.tags && detail.tags.length > 0) || detail.summary) {
        setForm(prev => ({
          ...prev,
          tags: detail.tags && detail.tags.length > 0 ? detail.tags!.join(', ') : prev.tags,
          description: detail.summary || prev.description,
        }))
      }
    } catch {
      // Tags fetch failed — not critical
    }
  }

  // ── Re-fetch from Bangumi (edit mode) ──
  const handleRefetch = async () => {
    const searchTerm = query.trim() || form.title.trim()
    if (!searchTerm) {
      toast.addToast('warning', '请输入搜索关键词')
      return
    }
    setSearching(true)
    try {
      // Try candidates in order: full title → alt title → stripped → alphanumeric prefix
      const candidates = [
        searchTerm,
        form.title_alt?.trim() || '',
        searchTerm.replace(/[\s\-—–~～・·.。:：'"'']/g, ''),
        (searchTerm.match(/[A-Za-z0-9\u4e00-\u9fff]+/g) || []).join('') || searchTerm,
      ].filter(Boolean)

      let items: BangumiItem[] = []
      for (const term of candidates) {
        if (items.length > 0) break
        const res = await api.searchBangumi(term)
        items = (res.items || []) as BangumiItem[]
      }

      if (items.length > 0) {
        const detail = await api.getBangumiDetail(items[0].bgm_id) as { tags?: string[]; summary?: string }
        const bangumiItem = items[0]
        // 与 handleBangumiSelect 的 bangumiToForm 对齐：更新 Bangumi 全字段
        // （title/title_alt/cover_url/description/episodes/platform/release_date/bgm_id）
        // 有值才覆盖（空值保留原表单），content_type 不覆盖（保留用户设置）
        const bf = bangumiToForm(bangumiItem)
        setForm(prev => {
          const next: ContentFormData = {
            ...prev,
            title: bf.title || prev.title,
            title_alt: bf.title_alt || prev.title_alt,
            cover_url: bf.cover_url || prev.cover_url,
            episodes: bf.episodes || prev.episodes,
            platform: bf.platform || prev.platform,
            release_date: bf.release_date || prev.release_date,
            bgm_id: bf.bgm_id || prev.bgm_id,
            description: detail.summary || bf.description || prev.description,
            tags: detail.tags?.length ? detail.tags.join(', ') : (bf.tags || prev.tags),
          }
          return next
        })
        toast.addToast('success', `已从 Bangumi 更新「${bangumiItem.name_cn || bangumiItem.name}」`)
      } else {
        toast.addToast('error', '未在 Bangumi 找到匹配条目')
      }
    } catch {
      toast.addToast('error', '获取失败')
    } finally {
      setSearching(false)
    }
  }

  // ── Delete (soft delete) ──
  const handleDelete = async () => {
    if (!contentId) return
    setDeleting(true)
    try {
      await api.deleteContent(contentId)
      toast.addToast('success', '已删除')
      onClose()
      // 若详情弹窗还开着（编辑弹窗从详情打开），一并关闭
      useUIStore.getState().closeDetail()
    } catch (err: any) {
      // 显示真实错误原因（403 无权限 / 429 限流等），避免「到底删没删」的困惑
      toast.addToast('error', err.message || '删除失败')
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
    // 删除成功后才刷新列表；不放进 try，避免刷新异常误报「删除失败」
    onSaved?.()
  }

  // ── Submit ──
  const handleSubmit = async () => {
    if (!form.title.trim()) {
      toast.addToast('warning', '标题不能为空')
      return
    }

    setSaving(true)
    try {
      const tags = form.tags
        .split(',')
        .map(t => t.trim())
        .filter(Boolean)

      const payload = {
        title: form.title.trim(),
        title_alt: form.title_alt,
        cover_url: form.cover_url,
        description: form.description,
        content_type: form.content_type,
        episodes: form.episodes,
        platform: form.platform,
        release_date: form.release_date,
        tags,
      }

      if (isEditMode) {
        const updatePayload: Record<string, unknown> = { ...payload }
        // 有 bgm_id（重新获取过/原本关联 Bangumi）→ 更新来源关联；无 → 不传 source 字段保留原值
        if (form.bgm_id) {
          updatePayload.source_type = 'bangumi'
          updatePayload.source_id = String(form.bgm_id)
          updatePayload.source_url = `https://bangumi.tv/subject/${form.bgm_id}`
        }
        await api.updateContent(contentId!, updatePayload)
        toast.addToast('success', '更新成功')
      } else {
        const isFromBangumi = !!form.bgm_id
        await api.createContent({
          ...payload,
          status: 'active',
          source_type: isFromBangumi ? 'bangumi' : 'manual',
          source_id: isFromBangumi ? String(form.bgm_id) : '',
          source_url: isFromBangumi ? `https://bangumi.tv/subject/${form.bgm_id}` : '',
          is_public: true,
        })
        toast.addToast('success', `已添加「${form.title.trim()}」`)
      }

      onSaved?.()
      onClose()
    } catch {
      toast.addToast('error', isEditMode ? '更新失败' : '添加失败')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  // Close one layer at a time: confirm dialog first, then main dialog
  const handleClose = () => {
    if (confirmDelete) {
      setConfirmDelete(false)
      return
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ animation: 'fade-in 200ms ease-out' }}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" {...maskProps} />

      <div
        className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-line)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          animation: 'scale-in 200ms ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4">
          <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isEditMode ? '编辑内容' : '添加番剧'}
          </h2>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 hover:opacity-80"
            style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)', color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Body ── */}
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div
              className="animate-spin w-8 h-8 border-2 rounded-full"
              style={{ borderColor: 'var(--border-line)', borderTopColor: '#FB71A7' }}
            />
          </div>
        ) : (
          <div className="overflow-y-auto max-h-[calc(85vh-130px)] px-6 pb-6">
            {/* ── Bangumi Search ── */}
            <div className="relative pt-px mb-5">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: 'var(--text-muted)' }}
                  />
                  <input
                    value={query}
                    onChange={e => {
                      setQuery(e.target.value)
                      setShowDropdown(true)
                    }}
                    onFocus={() => { if (results.length > 0) setShowDropdown(true) }}
                    onBlur={() => { setTimeout(() => setShowDropdown(false), 200) }}
                    placeholder={isEditMode ? "搜索 Bangumi 更新信息..." : "从 Bangumi 搜索番剧..."}
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg outline-none focus:ring-1 focus:ring-[#FB71A7]/50"
                    style={{ ...inputStyle, boxSizing: 'border-box' }}
                  />
                </div>
                <button
                  onClick={isEditMode ? handleRefetch : () => { if (query.trim()) doSearch(query) }}
                  disabled={searching || (!isEditMode && !query.trim())}
                  className="h-9 px-3 rounded-lg text-sm font-medium transition-all duration-200 hover:opacity-80 disabled:opacity-50 flex items-center gap-1.5"
                  style={{ background: '#FB71A7', color: 'white', border: 'none' }}
                >
                  {searching ? (
                    <div className="animate-spin w-3 h-3 border-2 border-white/30 border-t-white rounded-full" />
                  ) : (
                    <Search size={14} />
                  )}
                  {isEditMode ? '重新获取' : '搜索'}
                </button>
              </div>

              {/* Search results dropdown */}
              {showDropdown && (results.length > 0 || searched) && (
                <div
                  className="absolute z-20 left-0 right-0 mt-1 rounded-lg max-h-[40vh] overflow-y-auto shadow-lg"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}
                >
                  {results.length > 0 ? (
                    results.map(item => (
                      <button
                        key={item.bgm_id}
                        className="w-full text-left flex gap-3 p-3 transition-all duration-200 hover:opacity-80 cursor-pointer"
                        style={{ borderBottom: '1px solid var(--border-line)' }}
                        onClick={() => handleBangumiSelect(item)}
                      >
                        {item.cover_url ? (
                          <img
                            src={secureUrl(item.cover_url)}
                            alt={item.name_cn || item.name}
                            className="w-10 h-14 object-cover rounded-lg flex-shrink-0"
                            style={{ border: '1px solid var(--border-line)' }}
                          />
                        ) : (
                          <div
                            className="w-10 h-14 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ background: 'var(--bg-card-warm)' }}
                          >
                            <Tv size={14} style={{ color: 'var(--text-muted)' }} />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                            {item.name_cn || item.name}
                          </p>
                          {item.name_cn && item.name !== item.name_cn && (
                            <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                              {item.name}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                            {item.rating > 0 && (
                              <span className="flex items-center gap-1">
                                <Star size={10} fill="#FB71A7" style={{ color: '#FB71A7' }} />
                                {item.rating.toFixed(1)}
                              </span>
                            )}
                            {item.eps > 0 && <span>{item.eps}集</span>}
                            {item.air_date && <span>{item.air_date}</span>}
                          </div>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                      未找到相关番剧
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Form Fields ── */}
            <div className="space-y-4">
              {/* Cover preview */}
              {form.cover_url && (
                <div className="w-full max-h-[200px] rounded-xl overflow-hidden" style={{ background: 'var(--bg-card-warm)' }}>
                  <img
                    src={secureUrl(form.cover_url)}
                    alt="封面预览"
                    className="w-full h-full max-h-[200px] object-cover"
                  />
                </div>
              )}

              {/* Title */}
              <label className="block">
                <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                  标题 <span style={{ color: '#FB71A7' }}>*</span>
                </span>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => update('title', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-1 focus:ring-[#FB71A7]/50 transition-shadow"
                  style={inputStyle}
                  placeholder="内容标题"
                />
              </label>

              {/* Title Alt */}
              <label className="block">
                <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                  别名 / 日文标题
                </span>
                <input
                  type="text"
                  value={form.title_alt}
                  onChange={e => update('title_alt', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-1 focus:ring-[#FB71A7]/50 transition-shadow"
                  style={inputStyle}
                  placeholder="可选"
                />
              </label>

              {/* Cover URL */}
              <label className="block">
                <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                  封面 URL
                </span>
                <input
                  type="text"
                  value={form.cover_url}
                  onChange={e => update('cover_url', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-1 focus:ring-[#FB71A7]/50 transition-shadow"
                  style={inputStyle}
                  placeholder="https://..."
                />
              </label>

              {/* Description */}
              <label className="block">
                <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                  简介
                </span>
                <Textarea
                  value={form.description}
                  onChange={e => update('description', e.target.value)}
                  rows={3}
                  placeholder="内容简介..."
                  className="resize-none whitespace-pre-line"
                  style={inputStyle}
                />
              </label>

              {/* Content Type */}
              <label className="block">
                <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                  类型
                </span>
                <Select
                  value={form.content_type}
                  onChange={v => update('content_type', v as ContentType)}
                  className="w-full"
                  options={CONTENT_TYPES.map(t => ({ value: t.value, label: t.label }))}
                />
              </label>

              {/* Episodes + Platform */}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                    集数
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={form.episodes}
                    onChange={e => update('episodes', parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-1 focus:ring-[#FB71A7]/50 transition-shadow"
                    style={inputStyle}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                    平台
                  </span>
                  <input
                    type="text"
                    value={form.platform}
                    onChange={e => update('platform', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-1 focus:ring-[#FB71A7]/50 transition-shadow"
                    style={inputStyle}
                    placeholder="如：B站、Netflix"
                  />
                </label>
              </div>

              {/* Release Date */}
              <DatePicker
                label="发行日期"
                value={form.release_date}
                onChange={v => update('release_date', v)}
              />

              {/* Tags */}
              <label className="block">
                <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
                  标签 <span style={{ color: 'var(--text-muted)' }}>(逗号分隔)</span>
                </span>
                <input
                  type="text"
                  value={form.tags}
                  onChange={e => update('tags', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-1 focus:ring-[#FB71A7]/50 transition-shadow"
                  style={inputStyle}
                  placeholder="日常, 搞笑, 治愈"
                />
              </label>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        {!loading && (
          <div
            className="flex items-center justify-between gap-3 px-6 py-4"
            style={{ borderTop: '1px solid var(--border-line)' }}
          >
            {isEditMode ? (
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={deleting}
                className="h-9 flex items-center gap-1.5 px-3 rounded-lg text-sm transition-all duration-200 hover:opacity-80 disabled:opacity-50"
                style={{ background: 'transparent', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444' }}
              >
                {deleting ? (
                  <div className="animate-spin w-4 h-4 border-2 border-red-400/30 border-t-red-400 rounded-full" />
                ) : (
                  <Trash2 size={14} />
                )}
                删除
              </button>
            ) : <span />}
            <div className="flex items-center gap-3">
              <button
                onClick={handleClose}
                className="h-9 px-4 rounded-lg text-sm transition-all duration-200 hover:opacity-80"
                style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)', color: 'var(--text-muted)' }}
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="h-9 flex items-center gap-1.5 px-4 rounded-lg text-sm font-medium transition-all duration-200 hover:opacity-80 disabled:opacity-50"
                style={{ background: '#FB71A7', color: 'white' }}
              >
                {saving ? (
                  <div className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                ) : (
                  <Save size={14} />
                )}
                {isEditMode ? '保存' : '添加'}
              </button>
            </div>
          </div>
        )}

        {/* ── Delete confirmation ── */}
        {confirmDelete && (
          <div
            className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl"
            style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
            onClick={() => setConfirmDelete(false)}
          >
            <div
              className="p-6 rounded-xl mx-6 max-w-sm w-full"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}
              onClick={e => e.stopPropagation()}
            >
              <h4 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>确认删除</h4>
              <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
                确定要删除「{form.title || '这个条目'}」吗？删除后无法恢复。
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="h-9 px-4 rounded-lg text-sm transition-all duration-200 hover:opacity-80"
                  style={{ background: 'var(--bg-card-warm)', border: '1px solid var(--border-line)', color: 'var(--text-muted)' }}
                >
                  取消
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="h-9 flex items-center gap-1.5 px-4 rounded-lg text-sm font-medium transition-all duration-200 hover:opacity-80 disabled:opacity-50"
                  style={{ background: '#ef4444', color: 'white' }}
                >
                  {deleting ? <div className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full" /> : <Trash2 size={14} />}
                  删除
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
