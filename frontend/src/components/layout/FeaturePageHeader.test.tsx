import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FeaturePageHeader } from '@/components/layout/FeaturePageHeader'

describe('FeaturePageHeader', () => {
  it('统一渲染英文标题、中文标题、说明和操作区', () => {
    const view = render(
      <FeaturePageHeader
        eyebrow="Example feature"
        title="示例功能"
        description="这是示例功能说明。"
        actions={<button type="button">操作</button>}
      />,
    )

    expect(view.getByText('Example feature')).toBeInTheDocument()
    expect(view.getByRole('heading', { level: 1, name: '示例功能' })).toBeInTheDocument()
    expect(view.getByText('这是示例功能说明。')).toBeInTheDocument()
    expect(view.getByRole('button', { name: '操作' })).toBeInTheDocument()
  })
})
