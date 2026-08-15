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
          <div className="animate-spin w-8 h-8 rounded-full" style={{ border: '2px solid var(--border-line)', borderTopColor: 'var(--brand)' }} />
        </div>
      </PageMain>
    )
  }

  if (!user) {
    return (
      <PageMain className="py-20">
        <div className="text-center">
          <p className="text-4xl mb-4 opacity-40">🔍</p>
          <p style={{ color: 'var(--text-muted)' }}>用户不存在</p>
        </div>
      </PageMain>
    )
  }

  return (
    <PageMain className="py-20 sm:py-24">
      {/* Profile Header */}
      <div
        className="rounded-xl p-7 mb-6"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-line)',
          boxShadow: '0 0 15px rgba(255, 140, 212, 0.05)',
        }}
      >
        <div className="flex items-center gap-5">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{
              background: 'linear-gradient(135deg, var(--brand-light), var(--brand))',
              border: '2px solid var(--brand)',
              boxShadow: '0 0 15px rgba(255, 140, 212, 0.3)',
            }}
          >
            <span className="text-white text-xl font-semibold">
              {user.username.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{user.username}</h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {user.role === 'admin' ? '管理员' : '成员'} · 加入于 {new Date(user.created_at).toLocaleDateString('zh-CN')}
            </p>
          </div>
        </div>
      </div>

      {/* Ratings */}
      <div
        className="rounded-xl p-7"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-line)',
        }}
      >
        <h2 className="text-lg font-semibold mb-5" style={{ color: 'var(--text-primary)' }}>评分记录</h2>
        {ratings.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>还没有评分记录</p>
        ) : (
          <div className="space-y-3">
            {ratings.map(r => (
              <div
                key={r.id}
                className="flex items-center gap-3 py-2.5"
                style={{ borderBottom: '1px solid var(--border-line)' }}
              >
                <ScoreBadge score={r.score} size="sm" />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{r.content_id}</span>
                {r.review && <span className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{r.review}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </PageMain>
  )
}
