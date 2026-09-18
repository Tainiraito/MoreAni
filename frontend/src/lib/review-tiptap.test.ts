import { describe, expect, it } from 'vitest'

import { reviewMarkupToTiptapDocument, serializeTiptapDocument } from '@/lib/review-tiptap'

describe('review-tiptap adapter', () => {
  it.each([
    ['普通文本', '普通文本'],
    ['*斜体* **加粗** __下划线__ ~~删除线~~ ||剧透||', '*斜体* **加粗** __下划线__ ~~删除线~~ ||剧透||'],
    ['第一行\n第二行', '第一行\n第二行'],
    ['||||', '||||'],
  ])('保持已有评论语法的语义：%s', source => {
    expect(serializeTiptapDocument(reviewMarkupToTiptapDocument(source))).toBe(source)
  })

  it('将嵌套语法转换为同一段文本上的 ProseMirror marks', () => {
    const document = reviewMarkupToTiptapDocument('**外层 *嵌套*外层**')
    const nestedText = document.content?.[0]?.content?.find(node => node.text === '嵌套')

    expect(nestedText?.marks?.map(mark => mark.type)).toEqual(['reviewBold', 'reviewItalic'])
    expect(serializeTiptapDocument(document)).toBe('**外层 *嵌套*外层**')
  })

  it('序列化时忽略编辑器用于离开格式块的不可见光标锚点', () => {
    expect(serializeTiptapDocument({
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: '||剧透||' },
          { type: 'text', text: '\u200B', marks: [{ type: 'reviewCaretAnchor' }] },
          { type: 'text', text: '普通文本' },
        ],
      }],
    })).toBe('||剧透||普通文本')
  })
})
