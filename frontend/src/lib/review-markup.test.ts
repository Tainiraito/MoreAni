import { describe, expect, it } from 'vitest'

import {
  parseReviewMarkup,
  renderEditableReviewMarkup,
  serializeReviewEditor,
} from '@/lib/review-markup'

describe('parseReviewMarkup', () => {
  it('parses every supported inline format', () => {
    expect(parseReviewMarkup('*斜体* **加粗** __下划线__ ~~删除线~~ ||剧透||')).toEqual([
      { kind: 'format', format: 'italic', children: [{ kind: 'text', value: '斜体' }] },
      { kind: 'text', value: ' ' },
      { kind: 'format', format: 'bold', children: [{ kind: 'text', value: '加粗' }] },
      { kind: 'text', value: ' ' },
      { kind: 'format', format: 'underline', children: [{ kind: 'text', value: '下划线' }] },
      { kind: 'text', value: ' ' },
      { kind: 'format', format: 'strike', children: [{ kind: 'text', value: '删除线' }] },
      { kind: 'text', value: ' ' },
      { kind: 'format', format: 'inline-spoiler', children: [{ kind: 'text', value: '剧透' }] },
    ])
  })

  it('supports nested formats and preserves line breaks', () => {
    expect(parseReviewMarkup('**重点 ||剧透||**\n下一行')).toEqual([
      {
        kind: 'format',
        format: 'bold',
        children: [
          { kind: 'text', value: '重点 ' },
          { kind: 'format', format: 'inline-spoiler', children: [{ kind: 'text', value: '剧透' }] },
        ],
      },
      { kind: 'text', value: '\n下一行' },
    ])
  })

  it('supports a single-star format containing double-star formatting', () => {
    expect(parseReviewMarkup('*斜体 **加粗** 结尾*')).toEqual([
      {
        kind: 'format',
        format: 'italic',
        children: [
          { kind: 'text', value: '斜体 ' },
          { kind: 'format', format: 'bold', children: [{ kind: 'text', value: '加粗' }] },
          { kind: 'text', value: ' 结尾' },
        ],
      },
    ])
  })

  it('keeps unclosed syntax literal and supports escaping', () => {
    expect(parseReviewMarkup('*未闭合 \\*字面星号\\* \\||字面竖线\\||')).toEqual([
      { kind: 'text', value: '*未闭合 *字面星号* ||字面竖线||' },
    ])
  })

  it('round-trips nested formats, line breaks, empty formats, and literal HTML safely', () => {
    const source = '**重点 ||剧透||**\n||||\n<script>alert(1)</script>'
    const editor = document.createElement('div')
    editor.innerHTML = renderEditableReviewMarkup(source)

    expect(editor.querySelector('[data-review-format="bold"]')).toHaveTextContent('重点')
    expect(editor.querySelector('[data-review-format="bold"]')).toHaveTextContent('剧透')
    expect(editor.querySelector('[data-review-format="inline-spoiler"]')).toHaveTextContent('剧透')
    expect(editor.querySelector('[data-review-format="bold"] > [data-review-token]')).toHaveAttribute('data-review-token', '**')
    expect(editor.querySelector('[data-review-format="inline-spoiler"] > [data-review-token]')).toHaveAttribute('data-review-token', '||')
    const emptyFormat = Array.from(editor.querySelectorAll('[data-review-format="inline-spoiler"]'))
      .find(element => element.textContent === '||||')
    expect(emptyFormat).not.toBeNull()
    expect(editor.textContent?.replaceAll('\u200B', '')).toContain('\n')
    expect(editor.innerHTML).not.toContain('<script>')
    expect(serializeReviewEditor(editor)).toBe(source)
  })
})
