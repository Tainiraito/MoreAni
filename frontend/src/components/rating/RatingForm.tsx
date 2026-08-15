import { useState } from 'react'
import { StarRating } from './StarRating'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface RatingFormProps {
  initialScore?: number
  initialRecommend?: number
  initialReview?: string
  onSubmit: (score: number, recommend: number, review: string) => void
  onCancel: () => void
}

export function RatingForm({ initialScore = 0, initialRecommend = 0, initialReview = '', onSubmit, onCancel }: RatingFormProps) {
  const [score, setScore] = useState(initialScore)
  const [recommend, setRecommend] = useState(initialRecommend)
  const [review, setReview] = useState(initialReview)

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-ink mb-2">评分</label>
        <div className="flex items-center gap-3">
          <StarRating value={score} onChange={setScore} />
          <span className="font-display text-lg font-semibold text-ink">
            {score > 0 ? (score / 10).toFixed(1) : '—'}
          </span>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-2">推荐度</label>
        <div className="flex items-center gap-3">
          <StarRating value={recommend} onChange={setRecommend} />
          <span className="font-display text-lg font-semibold text-ink">
            {recommend > 0 ? (recommend / 10).toFixed(1) : '—'}
          </span>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-2">评论（可选）</label>
        <Textarea
          value={review}
          onChange={e => setReview(e.target.value)}
          placeholder="写点什么吧..."
          className="h-24 resize-none"
        />
      </div>

      <div className="flex gap-2.5">
        <Button onClick={() => onSubmit(score, recommend, review)} size="md">
          保存评分
        </Button>
        <Button onClick={onCancel} variant="outline" size="md">
          取消
        </Button>
      </div>
    </div>
  )
}
