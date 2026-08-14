# MoreAni v2.0 — UI/UX 设计规范

> **文档版本**: v1.0  
> **日期**: 2026-08-15  
> **状态**: 📋 设计规范  
> **风格方向**: 扁平 / 二次元 / 杂志编排  
> **技术基础**: React 18 + TypeScript + shadcn/ui + Tailwind CSS v4

---

## 目录

1. [设计原则](#1-设计原则)
2. [风格定位](#2-风格定位)
3. [色彩系统](#3-色彩系统)
4. [字体系统](#4-字体系统)
5. [间距与栅格](#5-间距与栅格)
6. [布局系统](#6-布局系统)
7. [组件规范](#7-组件规范)
8. [页面结构](#8-页面结构)
9. [响应式断点](#9-响应式断点)
10. [动效原则](#10-动效原则)
11. [实现参考](#11-实现参考)

---

## 1. 设计原则

### 1.1 四大核心原则

| # | 原则 | 说明 | 反面 |
|---|------|------|------|
| P1 | **扁平干净** | 无阴影、无渐变、硬边框、纯色块 | ≠ 毛玻璃、≠ 新拟态 |
| P2 | **杂志编排** | 大标题、强栅格、封面图突出、编辑感排版 | ≠ 信息平铺、≠ 卡片堆砌 |
| P3 | **二次元调性** | 鲜明但不花哨、漫画分格感、日式杂志能量 | ≠ 全站霓虹、≠ 过度装饰 |
| P4 | **组件可控** | 所有组件基于 shadcn/ui 定制，代码即设计 | ≠ 图标库替换、≠ 第三方 UI 框架 |

### 1.2 设计哲学

> **"用杂志的态度做工具，用动漫的能量做界面。"**

MoreAni 是朋友间的内容分享工具——不需要企业级的严肃感，但要有**有态度的设计**。封面大图就是大图，标题粗就是粗，色彩鲜明就是鲜明。不藏不躲，直给。

---

## 2. 风格定位

### 2.1 视觉参考

| 参考项目 | 提取元素 | MoreAni 用法 |
|----------|----------|-------------|
| **AniHive** | 大封面 + 标题叠加、卡片网格 | 首页封面 Hero 区域 |
| **MangaFox** | 漫画分格式内容展示、分栏排版 | 内容分类区域 |
| **Weeboo** | 评分徽章、标签系统、色彩系统 | 评分组件、标签样式 |
| **Kurosaw** | 简洁信息架构、大字排版 | 导航、标题层级 |

### 2.2 绝对不做

- ❌ 毛玻璃效果（backdrop-filter: blur）
- ❌ 新拟态（内外阴影模拟凹凸）
- ❌ 渐变色背景
- ❌ 圆角 > 12px（保持硬朗感）
- ❌ 透明度叠加（除弹窗外的遮罩）
- ❌ 柔和阴影

### 2.3 关键视觉词汇

| 词汇 | 表现 |
|------|------|
| **硬边** | 2px 实线边框，无圆角或 4px 小圆角 |
| **色块** | 纯色填充，无渐变 |
| **大字** | 标题 32-64px，加粗，字间距紧 |
| **对比** | 深色文字 + 亮色背景 + 鲜色强调 |
| **网格** | 漫画分格式 Grid 布局 |
| **徽章** | 评分、状态用色块徽章展示 |

---

## 3. 色彩系统

### 3.1 设计理念

以**洋红-紫**为主调（延续 v1.0 品牌色基因），搭配**深蓝灰**作为结构色，辅以高饱和度的**漫画强调色**。整体配色灵感来自日式杂志封面——大胆、鲜明、有节奏。

### 3.2 核心色板

#### 主色（Brand）

| 色名 | Tailwind Token | 色值 | 用途 |
|------|---------------|------|------|
| 品牌粉 | `--color-brand` | `#E83E8C` | 主按钮、重点强调、品牌标识 |
| 品牌粉浅 | `--color-brand-light` | `#FFD6EA` | 标签背景、悬浮状态 |
| 品牌粉深 | `--color-brand-deep` | `#B82A6D` | 按钮悬浮、活动状态 |

#### 中性色（Neutral）

| 色名 | Tailwind Token | 色值 | 用途 |
|------|---------------|------|------|
| 墨色 | `--color-ink` | `#1A1A2E` | 主要文字、标题 |
| 深灰 | `--color-slate` | `#3D3D5C` | 次要文字 |
| 中灰 | `--color-muted` | `#8888AA` | 辅助文字、占位符 |
| 浅灰 | `--color-border` | `#D8D8E8` | 边框、分割线 |
| 纸白 | `--color-paper` | `#F5F5FA` | 背景色 |
| 纯白 | `--color-white` | `#FFFFFF` | 卡片背景、弹窗 |

#### 强调色（Accent）— 漫画分格调色板

| 色名 | Tailwind Token | 色值 | 用途 |
|------|---------------|------|------|
| 藤紫 | `--color-accent-purple` | `#7B61FF` | 番剧标签、特殊强调 |
| 青蓝 | `--color-accent-cyan` | `#00D4AA` | 电影标签、成功状态 |
| 橙黄 | `--color-accent-orange` | `#FF8C42` | 游戏标签、警告 |
| 柠黄 | `--color-accent-yellow` | `#FFD93D` | 软件标签、高亮 |
| 湖蓝 | `--color-accent-blue` | `#4DA6FF` | 网站标签、链接 |
| 珊瑚 | `--color-accent-coral` | `#FF6B6B` | 书籍标签、错误 |

#### 内容类型色彩映射

```css
/* 每种内容类型有专属颜色，用于标签、边框、状态指示 */
--type-anime:    #7B61FF;  /* 藤紫 — 番剧 */
--type-movie:    #00D4AA;  /* 青蓝 — 电影 */
--type-game:     #FF8C42;  /* 橙黄 — 游戏 */
--type-software: #FFD93D;  /* 柠黄 — 软件 */
--type-website:  #4DA6FF;  /* 湖蓝 — 网站 */
--type-book:     #FF6B6B;  /* 珊瑚 — 书籍 */
```

### 3.3 色彩使用规则

| 场景 | 规则 |
|------|------|
| **背景** | 全站 `paper` 色，弹窗用 `white` |
| **文字** | 主标题 `ink`，正文 `ink`，辅助 `muted` |
| **按钮** | 主操作 `brand`，次操作 `ink`（黑底白字） |
| **边框** | 统一 `border` 色，2px 实线 |
| **评分** | 星星用 `brand` 色，分数用 `ink` |
| **标签** | 内容类型用对应 accent 色，自定义标签用 `brand-light` |

### 3.4 Tailwind 配置

```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss'

const config: Config = {
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#E83E8C',
          light: '#FFD6EA',
          deep: '#B82A6D',
        },
        ink: '#1A1A2E',
        slate: '#3D3D5C',
        muted: '#8888AA',
        border: '#D8D8E8',
        paper: '#F5F5FA',
        accent: {
          purple: '#7B61FF',
          cyan: '#00D4AA',
          orange: '#FF8C42',
          yellow: '#FFD93D',
          blue: '#4DA6FF',
          coral: '#FF6B6B',
        },
        type: {
          anime: '#7B61FF',
          movie: '#00D4AA',
          game: '#FF8C42',
          software: '#FFD93D',
          website: '#4DA6FF',
          book: '#FF6B6B',
        },
      },
    },
  },
}
```

---

## 4. 字体系统

### 4.1 字体选择

| 用途 | 字体 | 回退 | 理由 |
|------|------|------|------|
| **中文正文** | `"Noto Sans SC"` | system-ui, sans-serif | Google Fonts 免费，中英文均衡 |
| **英文标题** | `"Space Grotesk"` | system-ui, sans-serif | 几何感强，杂志风 |
| **数字/评分** | `"Space Grotesk"` | monospace | 等宽数字，评分醒目 |
| **日文（可选）** | `"Noto Sans JP"` | system-ui, sans-serif | 番剧原名展示 |

### 4.2 字体层级

| 层级 | 名称 | 大小 | 字重 | 行高 | 字间距 | 用途 |
|------|------|------|------|------|--------|------|
| H1 | 大标题 | 48px / 3rem | 800 | 1.1 | -0.02em | 页面大标题、Hero |
| H2 | 章节标题 | 32px / 2rem | 700 | 1.2 | -0.01em | 区域标题 |
| H3 | 卡片标题 | 20px / 1.25rem | 600 | 1.3 | 0 | 内容标题、卡片名 |
| Body | 正文 | 16px / 1rem | 400 | 1.6 | 0 | 描述、评论 |
| Caption | 辅助文字 | 14px / 0.875rem | 400 | 1.5 | 0 | 标签、元信息 |
| Micro | 徽章文字 | 12px / 0.75rem | 600 | 1.4 | 0.02em | 评分数字、状态标签 |
| Display | 展示用 | 64px / 4rem | 800 | 1.0 | -0.03em | 特殊展示、大数字 |

### 4.3 样式特征

- **标题一律大写**（英文）或 **加粗**（中文），不做斜体
- **数字统一使用等宽字体**（Space Grotesk），评分和统计数据对齐
- **字间距**：标题紧凑（-0.02em ~ -0.03em），正文默认（0）
- **不使用**：下划线链接、手写体、衬线体

### 4.4 Tailwind 配置

```ts
// tailwind.config.ts
theme: {
  fontFamily: {
    sans: ['"Noto Sans SC"', 'system-ui', 'sans-serif'],
    display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
    jp: ['"Noto Sans JP"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
  },
  fontSize: {
    'display': ['4rem', { lineHeight: '1.0', fontWeight: '800', letterSpacing: '-0.03em' }],
    'h1': ['3rem', { lineHeight: '1.1', fontWeight: '800', letterSpacing: '-0.02em' }],
    'h2': ['2rem', { lineHeight: '1.2', fontWeight: '700', letterSpacing: '-0.01em' }],
    'h3': ['1.25rem', { lineHeight: '1.3', fontWeight: '600' }],
    'body': ['1rem', { lineHeight: '1.6', fontWeight: '400' }],
    'caption': ['0.875rem', { lineHeight: '1.5', fontWeight: '400' }],
    'micro': ['0.75rem', { lineHeight: '1.4', fontWeight: '600', letterSpacing: '0.02em' }],
  },
},
```

---

## 5. 间距与栅格

### 5.1 间距系统

基于 **4px 基数**，所有间距为 4 的倍数：

| Token | 值 | Tailwind | 用途 |
|-------|-----|----------|------|
| `space-1` | 4px | `p-1` / `gap-1` | 徽章内边距、图标间距 |
| `space-2` | 8px | `p-2` / `gap-2` | 小组件间距、紧凑列表 |
| `space-3` | 12px | `p-3` / `gap-3` | 卡片内边距、表单间距 |
| `space-4` | 16px | `p-4` / `gap-4` | 标准间距、网格间隔 |
| `space-6` | 24px | `p-6` / `gap-6` | 区域间距、大卡片 |
| `space-8` | 32px | `p-8` / `gap-8` | 页面区块间距 |
| `space-12` | 48px | `p-12` / `gap-12` | 大区域分隔 |
| `space-16` | 64px | `p-16` / `gap-16` | 页面顶部留白 |

### 5.2 栅格系统

```
桌面端（≥1024px）：12 列栅格，间距 24px，两侧 margin 48px
平板端（768-1023px）：8 列栅格，间距 16px，两侧 margin 24px
手机端（<768px）：4 列栅格，间距 12px，两侧 margin 16px
```

| 屏幕 | 列数 | 间距 | 内容最大宽度 |
|------|------|------|-------------|
| Desktop XL (≥1440px) | 12 | 24px | 1200px |
| Desktop (1024-1439px) | 12 | 24px | 100% - 96px |
| Tablet (768-1023px) | 8 | 16px | 100% - 48px |
| Mobile (<768px) | 4 | 12px | 100% - 32px |

### 5.3 尺寸规范

| 元素 | 宽度/高度 | 说明 |
|------|----------|------|
| 内容卡片 | 宽度自适应（Grid 自动） | 最小 200px，最大 320px |
| 封面图片 | 宽度 100%，宽高比 3:4 | 番剧/电影封面统一比例 |
| 头像 | 40px × 40px | 导航栏 / 48px × 48px 个人页 |
| 图标 | 16px / 20px / 24px | 三档尺寸 |
| 按钮高度 | 36px / 40px / 44px | 三档：小/标准/大 |
| 输入框高度 | 40px | 标准输入 |
| 弹窗宽度 | 480px（登录）/ 720px（详情） | 不同弹窗不同宽度 |

---

## 6. 布局系统

### 6.1 全局布局

```
┌──────────────────────────────────────────────────┐
│  AppHeader（固定顶部）                              │
│  [Logo]  [搜索栏]                    [用户菜单]    │
├──────────────────────────────────────────────────┤
│                                                    │
│  PageContent                                      │
│  （全宽或带 max-width 容器）                        │
│                                                    │
├──────────────────────────────────────────────────┤
│  AppFooter（可选，极简）                            │
└──────────────────────────────────────────────────┘
```

- **AppHeader**: 固定顶部，高度 56px，白色背景，2px 底部边框
- **内容区**: 纸白背景（`paper`），最大宽度 1200px 居中
- **弹窗**: 从右侧滑入或居中弹出，白色背景

### 6.2 首页/探索页布局

首页采用**杂志封面式**布局，分为 Hero 区和内容区：

```
┌──────────────────────────────────────────────────┐
│  Hero 区（大封面）                                 │
│  ┌──────────────┐  ┌──────────────────────────┐  │
│  │              │  │  标题（H1 大字）            │  │
│  │   封面大图   │  │  副标题 / 标签              │  │
│  │   3:4 比例   │  │  评分徽章                   │  │
│  │              │  │  [查看详情] 按钮             │  │
│  └──────────────┘  └──────────────────────────┘  │
├──────────────────────────────────────────────────┤
│  分类标签栏（漫画分格标签页）                        │
│  [全部] [番剧] [电影] [游戏] [软件] [网站] [书籍]  │
├──────────────────────────────────────────────────┤
│  内容网格（漫画分格式 Grid）                         │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│  │      │ │      │ │      │ │      │            │
│  │ Card │ │ Card │ │ Card │ │ Card │            │
│  │      │ │      │ │      │ │      │            │
│  └──────┘ └──────┘ └──────┘ └──────┘            │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│  │ Card │ │ Card │ │ Card │ │ Card │            │
│  └──────┘ └──────┘ └──────┘ └──────┘            │
├──────────────────────────────────────────────────┤
│  动态区域（大家在看啥）                              │
│  时间线式布局，水平滚动                              │
└──────────────────────────────────────────────────┘
```

### 6.3 详情弹窗布局

```
┌──────────────────────────────────────────────────┐
│  [✕ 关闭]                            [←] [→]     │
├──────────────────────────────────────────────────┤
│  ┌─────────────────────┐  ┌──────────────────┐  │
│  │                     │  │  标题（H2）        │  │
│  │     封面大图         │  │  副标题 / 原名     │  │
│  │     3:4 比例        │  │                   │  │
│  │                     │  │  ┌──────┐         │  │
│  │                     │  │  │ 9.2  │ 评分    │  │
│  └─────────────────────┘  │  └──────┘         │  │
│                            │  标签们            │  │
│                            │  状态选择器        │  │
│                            │  描述文字          │  │
│                            └──────────────────┘  │
├──────────────────────────────────────────────────┤
│  评分区域                                          │
│  我的评分: ★★★★☆  推荐度: ★★★★☆                   │
│  评论: "这是一部..."                               │
├──────────────────────────────────────────────────┤
│  评分记录列表                                       │
│  [用户A] ★9.0 ★推荐 — "评论内容..."                │
│  [用户B] ★8.5 ★推荐 — "评论内容..."                │
└──────────────────────────────────────────────────┘
```

### 6.4 漫画分格（Panel）布局模式

MoreAni 的标志性布局——借鉴漫画分格，用 2px 实线边框创建网格感：

```css
/* 漫画分格效果 */
.panel {
  border: 2px solid var(--color-ink);
  background: white;
}

.panel-group {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0; /* 分格无间距，靠边框分隔 */
  border: 2px solid var(--color-ink);
}

.panel-group > * {
  border: 1px solid var(--color-border);
}
```

**适用场景**：
- 内容网格（首页内容列表）
- 分类标签栏（标签页分格）
- 个人页数据统计（数据面板）

---

## 7. 组件规范

### 7.1 按钮（Button）

#### 变体

| 变体 | 样式 | Tailwind | 用途 |
|------|------|----------|------|
| **Primary** | 品牌粉底色，白字，2px 边框 | `bg-brand text-white border-2 border-brand` | 主要操作（提交、添加） |
| **Secondary** | 墨色底色，白字，2px 边框 | `bg-ink text-white border-2 border-ink` | 次要操作（查看详情） |
| **Outline** | 白底，墨色字，2px 墨色边框 | `bg-white text-ink border-2 border-ink` | 辅助操作（取消） |
| **Ghost** | 透明底，墨色字，无边框 | `bg-transparent text-ink hover:bg-paper` | 导航项、工具按钮 |
| **Danger** | 珊瑚红底色，白字 | `bg-accent-coral text-white border-2 border-accent-coral` | 删除、危险操作 |

#### 尺寸

| 尺寸 | 高度 | 内边距 | 字号 | 圆角 |
|------|------|--------|------|------|
| **sm** | 32px | px-3 py-1.5 | 12px | 4px |
| **md** | 40px | px-4 py-2 | 14px | 4px |
| **lg** | 44px | px-6 py-2.5 | 16px | 4px |

#### 状态

- **Default**: 正常状态
- **Hover**: 背景色加深一级（品牌粉 → 品牌粉深）
- **Active/Pressed**: 背景色再深一级，微缩放 `scale(0.98)`
- **Disabled**: `opacity: 0.5`，`cursor: not-allowed`
- **Loading**: 文字替换为旋转图标

#### 实现

```tsx
// components/ui/button.tsx
import { cva, type VariantProps } from "class-variance-authority"

const buttonVariants = cva(
  "inline-flex items-center justify-center font-semibold transition-all duration-150 select-none border-2",
  {
    variants: {
      variant: {
        primary: "bg-brand text-white border-brand hover:bg-brand-deep",
        secondary: "bg-ink text-white border-ink hover:bg-slate",
        outline: "bg-white text-ink border-ink hover:bg-paper",
        ghost: "bg-transparent text-ink border-transparent hover:bg-paper",
        danger: "bg-accent-coral text-white border-accent-coral hover:opacity-90",
      },
      size: {
        sm: "h-8 px-3 text-micro rounded",
        md: "h-10 px-4 text-caption rounded",
        lg: "h-11 px-6 text-body rounded",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)
```

---

### 7.2 卡片（Card）

#### 内容卡片（ContentCard）

卡片是 MoreAni 最核心的组件，承载番剧、电影、游戏等所有内容展示。

**结构**：
```
┌────────────────────┐
│                    │
│    封面图片         │
│    3:4 比例        │
│                    │
├────────────────────┤ ← 2px 分隔线
│ ▓ 类型标签（色块）   │
│ 标题（H3 粗体）     │
│ ★ 8.5  ·  24集     │
└────────────────────┘
```

**样式规范**：

| 属性 | 值 | 说明 |
|------|-----|------|
| 背景 | 白色 | `bg-white` |
| 边框 | 2px solid ink | `border-2 border-ink` |
| 圆角 | 4px | `rounded` |
| 溢出 | `overflow: hidden` | 封面图裁切 |
| 阴影 | 无 | **禁止阴影** |
| 悬浮 | 边框色变品牌色 | `hover:border-brand` |

**封面区域**：
- 宽高比固定 3:4
- 使用 `aspect-[3/4]` + `object-cover`
- 无加载骨架屏，使用 `loading="lazy"` 原生懒加载

**信息区域**：
- 内边距 `12px`（`p-3`）
- 类型标签：色块 + 白字，`text-micro`，`px-2 py-0.5`，左对齐
- 标题：`text-h3`，单行省略（`line-clamp-1`）
- 元信息：`text-caption text-muted`，评分星星 + 数据

**评分数字**：
```
┌─────┐
│ 9.2 │  ← 墨色底，品牌粉字，Space Grotesk 等宽字体
└─────┘
```
- 尺寸：`text-micro font-display`
- 背景：`bg-ink`
- 文字：`text-brand`
- 内边距：`px-1.5 py-0.5`

#### 实现

```tsx
interface ContentCardProps {
  content: ContentItem
  onSelect: (id: number) => void
}

export function ContentCard({ content, onSelect }: ContentCardProps) {
  const typeColors: Record<ContentType, string> = {
    anime: 'bg-type-anime text-white',
    movie: 'bg-type-movie text-white',
    game: 'bg-type-game text-white',
    software: 'bg-type-software text-ink',
    website: 'bg-type-website text-white',
    book: 'bg-type-book text-white',
  }

  return (
    <article
      className="bg-white border-2 border-ink rounded overflow-hidden cursor-pointer
                 hover:border-brand transition-colors duration-150"
      onClick={() => onSelect(content.id)}
    >
      {/* 封面 */}
      <div className="aspect-[3/4] overflow-hidden">
        <img
          src={content.cover_url}
          alt={content.title}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>

      {/* 信息 */}
      <div className="p-3 border-t-2 border-ink">
        {/* 类型标签 */}
        <span className={`inline-block px-2 py-0.5 text-micro font-semibold ${typeColors[content.content_type]}`}>
          {contentTypeLabels[content.content_type]}
        </span>

        {/* 标题 */}
        <h3 className="mt-2 text-h3 line-clamp-1">{content.title}</h3>

        {/* 元信息 */}
        <div className="mt-1 flex items-center gap-2 text-caption text-muted">
          <span className="font-display font-semibold text-ink">★ {content.avg_score}</span>
          <span>·</span>
          <span>{content.episodes}集</span>
        </div>
      </div>
    </article>
  )
}
```

---

### 7.3 标签（Badge / Tag）

#### 内容类型标签

| 类型 | 背景色 | 文字色 | 示例 |
|------|--------|--------|------|
| 番剧 | `bg-type-anime` | white | `番剧` |
| 电影 | `bg-type-movie` | white | `电影` |
| 游戏 | `bg-type-game` | white | `游戏` |
| 软件 | `bg-type-software` | ink | `软件` |
| 网站 | `bg-type-website` | white | `网站` |
| 书籍 | `bg-type-book` | white | `书籍` |

**样式**：`px-2 py-0.5 text-micro font-semibold rounded-sm border-none`

#### 状态标签

| 状态 | 样式 | 说明 |
|------|------|------|
| 想看 | `bg-paper text-ink border-2 border-ink` | 空心框 |
| 在看 | `bg-brand text-white border-2 border-brand` | 品牌色填充 |
| 已看 | `bg-ink text-white border-2 border-ink` | 墨色填充 |
| 弃坑 | `bg-transparent text-muted border-2 border-border` | 灰色空心 |

#### Bangumi 标签

```
样式：bg-paper text-slate border border-border rounded-sm px-2 py-0.5 text-caption
悬浮：bg-brand-light text-brand-deep
```

---

### 7.4 对话框（Dialog）

MoreAni 的弹窗不是传统的居中 Modal，而是**侧面板式**（右滑入），更符合杂志翻页感。

#### 详情弹窗（Content Detail Dialog）

```
┌────────────────────────────────────┐
│  ✕                          ←  →  │  ← 顶部栏
├────────────────────────────────────┤
│                                    │
│  （内容区域，滚动）                  │
│                                    │
│                                    │
│                                    │
└────────────────────────────────────┘
```

**规格**：

| 属性 | 值 |
|------|-----|
| 宽度 | 720px（桌面）/ 100vw（手机） |
| 位置 | 右侧滑入，距右边 0 |
| 高度 | 100vh |
| 背景 | 白色 |
| 遮罩 | 半透明黑色 `bg-black/30` |
| 动画 | 从右滑入 `translateX(100%)` → `translateX(0)` |
| 边框 | 左侧 2px 边框 `border-l-2 border-ink` |

#### 登录/注册弹窗

| 属性 | 值 |
|------|-----|
| 宽度 | 420px |
| 位置 | 居中 |
| 背景 | 白色 |
| 边框 | 2px solid ink |
| 圆角 | 4px |
| 遮罩 | 半透明黑色 |

#### 设置弹窗

| 属性 | 值 |
|------|-----|
| 宽度 | 480px |
| 位置 | 居中 |
| 背景 | 白色 |
| 边框 | 2px solid ink |

#### 实现

```tsx
// 使用 shadcn/ui Dialog 定制
import * as DialogPrimitive from "@radix-ui/react-dialog"

// 自定义内容面板样式
const DialogContent = React.forwardRef<...>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Content
    ref={ref}
    className={cn(
      // 基础：白底、墨色边框、无阴影
      "bg-white border-2 border-ink rounded",
      // 入场动画
      "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
      "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
      className
    )}
    {...props}
  >
    {children}
  </DialogPrimitive.Content>
))
```

---

### 7.5 表单（Form）

#### 输入框（Input）

| 属性 | 值 |
|------|-----|
| 高度 | 40px |
| 边框 | 2px solid border 色 |
| 圆角 | 4px |
| 背景 | 白色 |
| 聚焦 | 边框色变为 `brand`，无外发光 |
| 错误 | 边框色变为 `accent-coral` |
| 文字 | `text-body text-ink` |
| 占位符 | `text-muted` |

```tsx
// components/ui/input.tsx
const inputStyles = cn(
  "flex h-10 w-full rounded border-2 border-border bg-white px-3 py-2",
  "text-body text-ink placeholder:text-muted",
  "transition-colors duration-150",
  "focus:outline-none focus:border-brand",
  "disabled:opacity-50 disabled:cursor-not-allowed",
  "aria-invalid:border-accent-coral"
)
```

#### 下拉选择（Select）

- 样式同 Input
- 下拉菜单：白底，2px 边框，无阴影
- 选项悬浮：`bg-brand-light` 背景

#### 评分组件（Rating）

评分是 MoreAni 的核心交互组件，采用**大数字 + 星星**的组合：

```
┌──────────────────────────────────────────┐
│  评分                                    │
│  ┌──────┐                               │
│  │ 8.5  │  ★ ★ ★ ★ ☆  (10星)           │
│  │ /10  │                               │
│  └──────┘                               │
│                                          │
│  推荐度                                  │
│  ┌──────┐                               │
│  │ 9.0  │  ★ ★ ★ ★ ★  (10星)           │
│  │ /10  │                               │
│  └──────┘                               │
│                                          │
│  ┌──────────────────────────────────┐   │
│  │ 写点什么吧...（评论输入框）         │   │
│  └──────────────────────────────────┘   │
│                                          │
│  [提交评分]                               │
└──────────────────────────────────────────┘
```

**星星**：
- 大小：24px
- 填充色：`brand`（已选）/ `border`（未选）
- 半星支持：0.5 步进
- 悬浮预览：星色变 `brand-light`

**分数数字**：
- 字体：`font-display`（Space Grotesk）
- 大小：`text-h2`
- 颜色：`text-ink`
- 显示格式：`8.5` / `—`（未评分）

---

### 7.6 导航（Navigation）

#### 顶部导航栏（AppHeader）

```
┌──────────────────────────────────────────────────────┐
│ ▣ 又看一集    [搜索内容...]              [👤 用户] [⚙] │
└──────────────────────────────────────────────────────┘
```

| 属性 | 值 |
|------|-----|
| 高度 | 56px |
| 背景 | 白色 |
| 底边框 | 2px solid ink |
| 固定 | `position: sticky; top: 0; z-index: 50` |
| Logo | 品牌粉方块 + "又看一集" 粗体 |
| 搜索栏 | 宽度自适应，居中，最大 400px |
| 用户区 | 右对齐 |

**Logo 区域**：
```tsx
// Logo: 品牌色方块 + 项目名
<div className="flex items-center gap-2">
  <div className="w-8 h-8 bg-brand rounded-sm" /> {/* 品牌色方块 */}
  <span className="text-h3 font-bold">又看一集</span>
</div>
```

#### 分类标签栏

内容类型切换采用**漫画分格式标签栏**：

```
┌────────┬────────┬────────┬────────┬────────┬────────┬────────┐
│  全部  │  番剧  │  电影  │  游戏  │  软件  │  网站  │  书籍  │
└────────┴────────┴────────┴────────┴────────┴────────┴────────┘
```

| 属性 | 值 |
|------|-----|
| 样式 | 等宽列分格，2px 边框 |
| 选中 | 底部 `brand` 色块 + 白字 |
| 未选 | 白底墨字 |
| 悬浮 | `paper` 背景 |
| 过渡 | 背景色切换 `duration-150` |

```tsx
const tabs = ['全部', '番剧', '电影', '游戏', '软件', '网站', '书籍'] as const

// 漫画分格式标签栏
<div className="grid grid-cols-7 border-2 border-ink">
  {tabs.map(tab => (
    <button
      key={tab}
      className={cn(
        "py-2 text-center text-caption font-semibold border-r border-border last:border-r-0",
        "transition-colors duration-150",
        activeTab === tab
          ? "bg-brand text-white"
          : "bg-white text-ink hover:bg-paper"
      )}
    >
      {tab}
    </button>
  ))}
</div>
```

---

### 7.7 滚动条

自定义滚动条延续品牌风格：

```css
/* 自定义滚动条 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: var(--color-paper);
}

::-webkit-scrollbar-thumb {
  background: var(--color-brand-light);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--color-brand);
}
```

---

### 7.8 工具提示（Tooltip）

| 属性 | 值 |
|------|-----|
| 背景 | `ink` 色 |
| 文字 | 白色 |
| 圆角 | 4px |
| 边框 | 无 |
| 阴影 | 无 |
| 延迟 | 显示 300ms，隐藏 100ms |

---

## 8. 页面结构

### 8.1 页面清单

| 页面 | 路由 | 形态 | 说明 |
|------|------|------|------|
| 首页/探索 | `/` | 页面 | 合并首页+探索，杂志封面式 |
| 内容详情 | — | 弹窗（右侧滑入） | 点击卡片触发 |
| 登录/注册 | — | 弹窗（居中） | 未登录自动弹出 |
| 设置 | — | 弹窗（居中） | 头部菜单触发 |
| 个人主页 | `/profile/:id` | 页面 | 用户个人信息 |

### 8.2 页面到组件映射

```
pages/
├── HomePage.tsx              → Hero + CategoryTabs + ContentGrid + ActivityFeed
├── ProfilePage.tsx           → UserProfile + UserRatings + UserContent
components/
├── layout/
│   ├── AppHeader.tsx         → Logo + SearchBar + UserMenu
│   └── AppFooter.tsx         → 极简版权信息
├── content/
│   ├── ContentCard.tsx       → 封面 + 类型标签 + 标题 + 评分
│   ├── ContentGrid.tsx       → 漫画分格式 Grid
│   ├── ContentDetail.tsx     → 详情弹窗内容
│   ├── HeroSection.tsx       → 大封面 + 标题
│   └── CategoryTabs.tsx      → 内容类型切换标签栏
├── rating/
│   ├── RatingDisplay.tsx     → 只读评分展示
│   ├── RatingForm.tsx        → 评分输入表单
│   ├── StarRating.tsx        → 星星组件
│   └── ScoreBadge.tsx        → 评分徽章
├── activity/
│   └── ActivityFeed.tsx      → 最近动态时间线
├── auth/
│   ├── LoginDialog.tsx       → 登录弹窗
│   └── RegisterDialog.tsx    → 注册弹窗
└── ui/                       → shadcn/ui 定制组件
    ├── button.tsx
    ├── dialog.tsx
    ├── input.tsx
    ├── select.tsx
    ├── badge.tsx
    ├── scroll-area.tsx
    └── tooltip.tsx
```

---

## 9. 响应式断点

### 9.1 断点定义

| 名称 | 断点 | Tailwind 前缀 | 说明 |
|------|------|---------------|------|
| **Mobile** | < 640px | 默认 / `sm:` | 手机 |
| **Tablet** | 640-1023px | `md:` | 平板 |
| **Desktop** | 1024-1439px | `lg:` | 桌面 |
| **Desktop XL** | ≥ 1440px | `xl:` | 大屏桌面 |

### 9.2 响应式适配规则

#### Hero 区域

| 屏幕 | 布局 |
|------|------|
| Desktop XL | 左 40% 封面 + 右 60% 标题信息 |
| Desktop | 左 40% 封面 + 右 60% 标题信息 |
| Tablet | 全宽封面 + 下方标题 |
| Mobile | 全宽封面 + 下方标题，封面高度 50vh |

#### 内容网格

| 屏幕 | 列数 | 卡片最小宽度 |
|------|------|-------------|
| Desktop XL | 5-6 列 | 220px |
| Desktop | 4 列 | 220px |
| Tablet | 3 列 | 200px |
| Mobile | 2 列 | 150px |

#### 详情弹窗

| 屏幕 | 布局 |
|------|------|
| Desktop | 右侧面板 720px，左侧内容区 |
| Tablet | 右侧面板 600px |
| Mobile | 全屏弹窗 100vw |

#### 导航栏

| 屏幕 | 布局 |
|------|------|
| Desktop | Logo + 搜索 + 用户菜单 一行 |
| Tablet | Logo + 搜索 + 用户菜单 一行 |
| Mobile | Logo + 汉堡菜单，搜索在菜单内 |

---

## 10. 动效原则

### 10.1 动效哲学

> **"干脆利落，不拖泥带水。"**

动效是杂志翻页的感觉——快速、有节奏、有力度。不做缓慢渐变，不做弹性回弹。

### 10.2 通用规范

| 属性 | 值 | 说明 |
|------|-----|------|
| 默认时长 | 150ms | 大部分交互 |
| 弹窗入场 | 200ms | 对话框出现 |
| 弹窗退场 | 150ms | 对话框消失 |
| 缓动函数 | `ease-out` | 快出慢入 |
| 缩放 | `scale(0.98)` | 按钮按下 |
| 禁用动画 | `prefers-reduced-motion` | 尊重系统设置 |

### 10.3 具体动效

#### 页面/弹窗过渡

```css
/* 弹窗入场 — 从右侧滑入 */
@keyframes slide-in-right {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

/* 弹窗退场 — 向右滑出 */
@keyframes slide-out-right {
  from { transform: translateX(0); }
  to { transform: translateX(100%); }
}

/* 居中弹窗 — 缩放进入 */
@keyframes scale-in {
  from { transform: scale(0.95); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
```

#### 悬浮效果

```css
/* 卡片悬浮 — 边框变色 */
.content-card {
  transition: border-color 150ms ease-out;
}
.content-card:hover {
  border-color: var(--color-brand);
}

/* 按钮悬浮 — 背景色变化 */
.btn-primary {
  transition: background-color 150ms ease-out;
}
.btn-primary:hover {
  background-color: var(--color-brand-deep);
}
```

#### 列表动画

```tsx
// 使用 Tailwind 的 transition 和 CSS 网格
// 内容网格变化时，使用 FLIP 动画
<div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-2 border-ink">
  {items.map(item => (
    <div key={item.id} className="animate-in fade-in duration-200">
      <ContentCard content={item} />
    </div>
  ))}
</div>
```

### 10.4 禁止的动效

- ❌ 弹性动画（spring / bounce）
- ❌ 旋转动画（除 loading spinner）
- ❌ 模糊/毛玻璃过渡
- ❌ 粒子效果
- ❌ 视差滚动
- ❌ 超过 500ms 的动画

---

## 11. 实现参考

### 11.1 全局 CSS

```css
/* styles/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* 色彩系统变量 */
    --color-brand: #E83E8C;
    --color-brand-light: #FFD6EA;
    --color-brand-deep: #B82A6D;
    --color-ink: #1A1A2E;
    --color-slate: #3D3D5C;
    --color-muted: #8888AA;
    --color-border: #D8D8E8;
    --color-paper: #F5F5FA;
    --color-white: #FFFFFF;

    --type-anime: #7B61FF;
    --type-movie: #00D4AA;
    --type-game: #FF8C42;
    --type-software: #FFD93D;
    --type-website: #4DA6FF;
    --type-book: #FF6B6B;
  }

  /* 基础重置 — 扁平化 */
  * {
    box-shadow: none !important; /* 全局禁止阴影 */
  }

  body {
    @apply bg-paper text-ink font-sans;
    -webkit-font-smoothing: antialiased;
  }
}

@layer components {
  /* 漫画分格组件 */
  .panel-grid {
    @apply border-2 border-ink bg-white;
  }

  .panel-grid > * {
    @apply border-b border-r border-border;
  }

  .panel-grid > *:nth-child(4n) {
    @apply border-r-0;
  }

  /* 评分徽章 */
  .score-badge {
    @apply inline-flex items-center px-1.5 py-0.5 bg-ink text-brand font-display font-semibold text-micro;
  }

  /* 类型色块标签 */
  .type-badge {
    @apply inline-block px-2 py-0.5 text-micro font-semibold;
  }
}
```

### 11.2 shadcn/ui 组件定制清单

以下 shadcn/ui 组件需要定制以匹配 MoreAni 风格：

| 组件 | 定制要点 |
|------|---------|
| `Button` | 2px 边框，无阴影，品牌色系 |
| `Dialog` | 侧面板滑入，墨色边框 |
| `Input` | 2px 边框，聚焦变品牌色 |
| `Select` | 2px 边框，下拉无阴影 |
| `Badge` | 类型色块，无圆角或小圆角 |
| `Tooltip` | 墨色背景，无阴影 |
| `ScrollArea` | 品牌粉滚动条 |
| `Tabs` | 漫画分格式 |
| `Card` | 2px 边框，无阴影 |

### 11.3 字体加载

```tsx
// index.html 或 layout.tsx
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
<link
  href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700;800&family=Space+Grotesk:wght@400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

### 11.4 内容类型颜色使用

```tsx
// lib/content-types.ts
export const CONTENT_TYPES = {
  anime:    { label: '番剧', color: 'bg-type-anime',    textColor: 'text-white' },
  movie:    { label: '电影', color: 'bg-type-movie',    textColor: 'text-white' },
  game:     { label: '游戏', color: 'bg-type-game',     textColor: 'text-white' },
  software: { label: '软件', color: 'bg-type-software', textColor: 'text-ink' },
  website:  { label: '网站', color: 'bg-type-website',  textColor: 'text-white' },
  book:     { label: '书籍', color: 'bg-type-book',     textColor: 'text-white' },
} as const

export type ContentType = keyof typeof CONTENT_TYPES
```

### 11.5 设计 Token 速查表

| Token | 值 | Tailwind |
|-------|-----|----------|
| `brand` | `#E83E8C` | `text-brand` / `bg-brand` |
| `brand-light` | `#FFD6EA` | `text-brand-light` / `bg-brand-light` |
| `brand-deep` | `#B82A6D` | `text-brand-deep` / `bg-brand-deep` |
| `ink` | `#1A1A2E` | `text-ink` / `bg-ink` |
| `slate` | `#3D3D5C` | `text-slate` / `bg-slate` |
| `muted` | `#8888AA` | `text-muted` |
| `border` | `#D8D8E8` | `border-border` |
| `paper` | `#F5F5FA` | `bg-paper` |
| `type-anime` | `#7B61FF` | `bg-type-anime` |
| `type-movie` | `#00D4AA` | `bg-type-movie` |
| `type-game` | `#FF8C42` | `bg-type-game` |
| `type-software` | `#FFD93D` | `bg-type-software` |
| `type-website` | `#4DA6FF` | `bg-type-website` |
| `type-book` | `#FF6B6B` | `bg-type-book` |

---

## 附录 A：与 v1.0 的差异

| 维度 | v1.0 | v2.0 |
|------|------|------|
| 设计风格 | 毛玻璃（glass-card） | 扁平硬边 |
| 阴影 | 大量使用 | **完全禁止** |
| 渐变 | 粉白渐变滚动条 | 纯色块 |
| 圆角 | 12-16px | 0-4px |
| 色彩 | 粉紫单色 | 多色系（类型色映射） |
| 组件库 | Element Plus | shadcn/ui（定制） |
| 框架 | Vue 3 | React 18 |
| 栅格 | 卡片流式 | 漫画分格式 Grid |
| 弹窗 | 居中 Modal | 右侧滑入面板 + 居中 |

## 附录 B：设计检查清单

开发时对照此清单验证 UI 实现：

- [ ] 无阴影（box-shadow: none）
- [ ] 无渐变（无 linear-gradient / radial-gradient）
- [ ] 无毛玻璃（无 backdrop-filter: blur）
- [ ] 边框统一 2px 实线
- [ ] 圆角 ≤ 4px
- [ ] 标题使用 Space Grotesk（英文/数字）
- [ ] 中文使用 Noto Sans SC
- [ ] 评分数字对齐（等宽字体）
- [ ] 内容类型使用对应颜色
- [ ] 卡片封面 3:4 比例
- [ ] 按钮悬浮变色（150ms）
- [ ] 弹窗滑入动画（200ms）
- [ ] 滚动条品牌粉样式
- [ ] 移动端适配（2列网格）
- [ ] `prefers-reduced-motion` 支持

---

> **文档结束**  
> 本规范是 MoreAni v2.0 前端开发的唯一视觉参考。实现时严格遵循此规范，如需调整请先更新本文档再修改代码。
