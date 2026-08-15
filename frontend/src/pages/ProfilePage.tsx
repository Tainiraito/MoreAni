import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { PageMain } from '@/components/layout/PageContainer'
import { ScoreBadge } from '@/components/rating/ScoreBadge'
import type { User, Rating } from '@/types'

export function ProfilePage() {
  const { id } = useParams<{ id: string }>()
  const [user, setUser] = useState<User | null>(null)
  const [ratings, setRatings] = useState<Rating[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([
      api.getUser(Number(id)) as Promise<User>,
      api.getUserRatings(Number(id)),
    ]).then(([u, r]) => {
      setUser(u)
      setRatings((r.items || []) as Rating[])
    }).catch(() => {}).finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <PageMain className="py-20">
        <div className="flex items-center justify-center">
          <div className="animate-spin w-8 h-8 border-2 border-brand/30 border-t-brand rounded-full" />
        </div>
      </PageMain>
    )
  }

  if (!user) {
    return (
      <PageMain className="py-20">
        <div className="text-center">
          <p className="text-4xl mb-4 opacity-40">🔍</p>
          <p className="text-muted">用户不存在</p>
        </div>
      </PageMain>
    )
  }

  return (
    <PageMain className="py-20 sm:py-24">
      {/* Profile Header */}
      <div className="bg-surface rounded-xl border border-black/[0.06] p-7 mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 rounded-full bg-brand-light/50 border border-brand/15 flex items-center justify-center">
            <span className="text-brand text-xl font-semibold">
              {user.username.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-ink">{user.username}</h1>
            <p className="text-sm text-muted mt-0.5">
              {user.role === 'admin' ? '管理员' : '成员'} · 加入于 {new Date(user.created_at).toLocaleDateString('zh-CN')}
            </p>
          </div>
        </div>
      </div>

      {/* Ratings */}
      <div className="bg-surface rounded-xl border border-black/[0.06] p-7 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <h2 className="text-lg font-semibold text-ink mb-5">评分记录</h2>
        {ratings.length === 0 ? (
          <p className="text-muted text-sm">还没有评分记录</p>
        ) : (
          <div className="space-y-3">
            {ratings.map(r => (
              <div key={r.id} className="flex items-center gap-3 py-2.5 border-b border-black/[0.04] last:border-b-0">
                <ScoreBadge score={r.score} size="sm" />
                <span className="text-sm text-ink font-medium">{r.content_id}</span>
                {r.review && <span className="text-xs text-muted truncate">{r.review}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </PageMain>
  )
}
