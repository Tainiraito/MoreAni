export function contentDetailQueryKey(contentId: number | null, userId: number | null) {
  return ['content-detail', contentId, userId] as const
}

export function contentDetailQueryKeyPrefix(contentId: number) {
  return ['content-detail', contentId] as const
}
