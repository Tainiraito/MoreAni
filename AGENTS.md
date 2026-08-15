# AGENTS.md — MoreAni 项目协作指南

> **适用对象**: AI 助手（Hermes/Claude）— MoreAni 代码库的项目级规则。

## 项目概览

- **名称**: MoreAni（又看一集）
- **类型**: 朋友间内部内容分享工具
- **技术栈**: React 19 + TypeScript + Tailwind CSS v4 + FastAPI + SQLite
- **开发环境**: Windows 本地 (WSL2)
- **生产环境**: NAS (192.168.31.26)
- **域名**: moreani.lovelysia.top

## 代码风格原则

### LLM 友好代码

| 原则 | 规则 |
|------|------|
| 单一职责 | 每个文件只做一件事 |
| 组件化 | 保持文件精简，按职责拆分组件，提高可维护性 |
| 显式类型 | 所有地方都要有完整类型注解 |
| 自文档化 | 清晰的命名 + 文档字符串，不使用晦涩缩写 |
| 一致模式 | 相同功能 = 相同代码结构 |
| 扁平导入 | 不超过 2 层嵌套 |

### React + TypeScript

```tsx
// ✅ 正确：函数组件 + 类型 + 清晰命名
interface ContentCardProps {
  content: ContentItem
  onSelect: (id: number) => void
}

export function ContentCard({ content, onSelect }: ContentCardProps) {
  return (
    <div onClick={() => onSelect(content.id)}>
      <h3>{content.title}</h3>
    </div>
  )
}

// ❌ 错误：无类型、桶导出、默认导出
export default (props) => <div onClick={props.onSelect}>{props.content.title}</div>
```

### Python (FastAPI)

```python
# ✅ 正确：类型提示 + 文档字符串
def get_content_by_id(content_id: int, db: Session) -> ContentItem:
    """获取单个内容项。"""
    return db.query(ContentItem).filter(ContentItem.id == content_id).first()

# ❌ 错误：无类型、无文档
def get_c(cid, db):
    return db.query(ContentItem).filter(ContentItem.id == cid).first()
```

## 文件结构规范

### 后端

```
backend/
├── main.py           # 入口文件，不含业务逻辑
├── database.py       # 数据库连接
├── models.py         # SQLAlchemy 模型
├── schemas.py        # Pydantic 模式
├── auth.py           # JWT 工具
├── deps.py           # FastAPI 依赖注入
├── services/         # 业务逻辑层
│   ├── __init__.py
│   ├── content.py    # 内容 CRUD + 搜索
│   ├── rating.py     # 评分 CRUD + 统计
│   ├── user.py       # 用户管理
│   ├── tag.py        # 标签管理
│   └── bangumi.py    # Bangumi API 客户端
├── routers/          # HTTP 路由层（薄层，委托给 services）
│   └── v1/
│       ├── auth.py
│       ├── content.py
│       ├── rating.py
│       ├── user.py
│       ├── tag.py
│       ├── bangumi.py
│       └── proxy.py      # 图片代理（绕过 CORP/CORS）
├── middleware/        # 中间件
│   ├── rate_limit.py
│   └── security.py
└── scripts/          # CLI 工具
```

### 前端 (React + TypeScript)

```
frontend/src/
├── main.tsx              # 入口
├── App.tsx               # 根组件 + Provider
├── router.tsx            # React Router 配置
├── types/                # TypeScript 接口
│   ├── content.ts
│   ├── rating.ts
│   ├── user.ts
│   └── api.ts
├── stores/               # Zustand 状态管理
│   ├── auth-store.ts
│   ├── content-store.ts
│   └── ui-store.ts
├── pages/                # 页面组件（每个路由一个）
│   ├── HomePage.tsx
│   ├── ExplorePage.tsx
│   ├── DetailPage.tsx
│   ├── ProfilePage.tsx
│   ├── SettingsPage.tsx
│   ├── LoginPage.tsx
│   ├── RegisterPage.tsx
│   └── GuestPage.tsx
├── components/           # 可复用组件
│   ├── layout/           # AppHeader, AppFooter
│   ├── content/          # ContentCard, ContentGrid
│   ├── rating/           # RatingStars, RatingForm
│   ├── auth/             # LoginForm, RegisterForm
│   └── ui/               # shadcn/ui 组件
├── hooks/                # 自定义 Hooks
│   ├── use-api.ts
│   ├── use-auth.ts
│   └── use-content.ts
├── lib/                  # 工具库
│   ├── api.ts            # API 客户端（fetch 封装）
│   └── utils.ts          # 辅助函数
└── styles/
    └── globals.css       # Tailwind 导入 + 自定义样式
```

## Git 规范

- **本地提交**: 可以自动执行
- **推送到远程**: 必须先获得用户确认
- 未经用户明确批准，不得 `git push`

## 提交规范

```
feat: 添加功能 X
fix: 修复 bug Y
refactor: 重构 Z（无行为变化）
docs: 更新文档
style: 格式调整，无逻辑变化
test: 添加/修改测试
chore: 构建、CI、依赖
```

每次提交应该是：
- 原子性（一个逻辑变更）
- 描述性（改了什么，为什么改）
- 经过测试（如果适用）

## 分支策略

```
main          ← 稳定版本，仅通过 PR
  └── dev     ← 开发主线
       ├── feat/xxx
       ├── fix/xxx
       └── refactor/xxx
```

## 测试要求

### 后端

- 服务层单元测试: `pytest tests/unit/`
- 路由层 API 测试: `pytest tests/api/`
- 提交前运行: `pytest tests/ -v`

### 前端

- 组件测试: Vitest
- 提交前运行: `npm run test`

## 数据库迁移

修改模型时：
1. 更新 `models.py`
2. 在 `migrations/` 中创建迁移
3. 在开发数据上测试
4. 应用前备份生产数据库

## API 设计规范

- 所有 API 位于 `/api/v1/`
- RESTful 命名：名词，不是动词
- 统一响应格式
- 分页: `?page=1&size=20`
- 错误响应: `{"detail": "消息内容"}`
- 认证: JWT 存储在 httpOnly cookie
- 图片代理: `/api/v1/proxy/image?url=<编码后的URL>`（绕过 Bangumi CDN 的 CORP/CORS 限制）

## 安全规范

- 不在代码中存储密钥（使用 .env）
- 所有用户输入都经过验证（Pydantic）
- ORM 防止 SQL 注入
- 所有端点都有速率限制
- 分享链接使用加密随机 token
- 图片代理仅允许特定域名（bgm.tv、wikimedia 等）

## Vite 代理配置

前端开发服务器将 `/api/*` 代理到后端。**关键**：确保 `vite.config.ts` 指向正确端口：

```ts
// vite.config.ts
server: {
  proxy: {
    '/api': 'http://localhost:8080',  // 必须与后端端口一致
  },
},
```

## 图片 URL 处理（CORP/CORS）

Bangumi CDN（`lain.bgm.tv`）设置了 `Cross-Origin-Resource-Policy` 头，阻止浏览器直接访问。

**解决方案**：前端组件使用 `secureUrl()` 辅助函数代理外部图片：

```tsx
function secureUrl(url: string): string {
  if (!url) return url
  // 代理 Bangumi CDN 图片
  if (url.includes('lain.bgm.tv') || url.includes('bgm.tv')) {
    return `/api/v1/proxy/image?url=${encodeURIComponent(url)}`
  }
  return url.replace(/^http:\/\//, 'https://')
}
```

适用于：`ContentCard`、`HeroSection`、`ContentDetailDialog`。

## 布局系统（Gleamory 风格）

所有页面必须使用 `PageContainer` 或 `PageMain` 实现一致的居中布局：

```tsx
import { PageContainer, PageMain } from '@/components/layout/PageContainer'

// 页面内容（使用 <main> 元素）
<PageMain className="py-20 sm:py-24">
  {/* 内容 */}
</PageMain>

// 其他容器（使用 <div> 元素）
<PageContainer>
  {/* 内容 */}
</PageContainer>
```

**宽度模式**：
- `standard`（默认）: `px-6 sm:px-[5.5%]` + `max-w-[90rem]` — 适用于大多数页面
- `wide`: `px-4 sm:px-6 lg:px-8` + `max-w-[100rem]` — 适用于宽工作台

**关键规则**：
- `AppHeader` 必须使用与页面内容相同的宽度模式
- 页面级容器不得使用自定义 `max-w-*` 或 `mx-auto`
- 背景色: `var(--bg-page, #0a0a0a)`

### 滚动触发导航栏

页面顶部显示大品牌区域（`HeroBrand`：icon + 标题 + 副标题），导航栏在顶部时隐藏，向下滚动超过 80px 后平滑出现：

```tsx
// AppHeader.tsx
const [scrolled, setScrolled] = useState(false)

useEffect(() => {
  const handleScroll = () => setScrolled(window.scrollY > 80)
  window.addEventListener('scroll', handleScroll, { passive: true })
  return () => window.removeEventListener('scroll', handleScroll)
}, [])

// 导航栏样式
style={{
  opacity: scrolled ? 1 : 0,
  transform: scrolled ? 'translateY(0)' : 'translateY(-100%)',
  pointerEvents: scrolled ? 'auto' : 'none',
  backdropFilter: scrolled ? 'blur(12px)' : 'none',
}}
```

**适用场景**：首页有大 Hero 区域时，其他页面（Profile等）可直接显示导航栏。

## 配色规范（霓虹粉深色主题）

基于 favicon 图标的霓虹粉猫耳女孩设计，采用深色主题 + 霓虹粉强调色：

### 品牌色系

| 色名 | 色值 | 用途 |
|------|------|------|
| 品牌粉 | `#FF8CD4` | 主按钮、强调色、评分星星 |
| 品牌粉浅 | `#FFBDEA` | 浅色背景、hover 状态 |
| 品牌粉深 | `#E060B8` | hover、active 状态 |
| 霓虹洋红 | `#FF00FF` | 特殊强调、发光效果 |

### 中性色（深色主题）

| 色名 | 色值 | 用途 |
|------|------|------|
| 页面背景 | `#0a0a0a` | 最深背景 |
| 卡片背景 | `#141414` | 卡片、弹窗 |
| 卡片暖色 | `#1a1a1a` | 次级背景 |
| 主文字 | `#f0f0f0` | 标题、正文 |
| 次文字 | `#b0b0b0` | 描述文字 |
| 辅助文字 | `#808080` | 占位符、提示 |
| 边框线 | `rgba(255,140,212,0.12)` | 边框、分割线 |

### 发光效果

```css
--shadow-neon: 0 0 10px rgba(255, 140, 212, 0.3), 0 0 30px rgba(255, 140, 212, 0.1);
```

用于 hover 状态、按钮、卡片边框等交互元素。

### 禁止事项

- ❌ 路由层不要放业务逻辑
- ❌ Store 不要放 UI 逻辑
- ❌ TypeScript 不要使用 `any` 类型
- ❌ 不要省略类型注解
- ❌ 不要硬编码值（使用 config/env）
- ❌ 不要混合关注点（DB + HTTP + 业务）
- ❌ 不要使用默认导出（优先命名导出）
- ❌ 不要使用类组件（仅函数组件）

## CSS 层叠陷阱（Tailwind v4）

**关键规则**：`@layer` 外的 CSS 优先级**永远高于** `@layer` 内的。

```css
/* ❌ 这会覆盖 Tailwind 的 .px-6、.mx-auto 等工具类！ */
* {
  padding: 0;  /* 在 @layer 外 → 优先级高于 @layer utilities */
}

/* ✅ 正确：放入 @layer base */
@layer base {
  * {
    border-color: var(--border-line);
  }
}
```

**原因**：CSS 层叠规则中，`@layer` 外的样式 > `@layer` 内的样式，无论选择器特异性多高。Tailwind v4 的工具类在 `@layer utilities` 内，所以任何 `@layer` 外的通用选择器都能覆盖它们。

**经验教训**：不要在 `index.css` 中用 `*` 选择器设置 `margin`、`padding`、`box-sizing`——Tailwind 的 preflight 已经处理了这些。自定义样式放入 `@layer base` 或使用 Tailwind 的主题变量。

## 布局验证规范

**每次修改布局相关代码后，必须截图验证实际渲染效果**，不能只检查类名是否正确。

验证方法：
1. 用 headless Chromium 截图：`chrome --headless --screenshot=/tmp/check.png --window-size=1920,1080 http://localhost:5173/`
2. 用 `vision_analyze` 检查截图：确认内容居中、间距正确、header 对齐
3. 对比 Gleamory 的布局风格

**禁止**：仅通过 `curl` 检查 HTML 类名就声称布局正确。
