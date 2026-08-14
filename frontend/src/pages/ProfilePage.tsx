import { useParams } from 'react-router-dom'

export function ProfilePage() {
  const { id } = useParams<{ id: string }>()

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h2 className="font-display text-2xl font-bold text-brand-dark">
        用户主页 #{id}
      </h2>
      <p className="mt-2 text-gray-500">TODO: 用户信息 + 评分历史</p>
    </div>
  )
}
