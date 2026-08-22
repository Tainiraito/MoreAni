# MoreAni v2.0 — 项目架构文档

> **生成日期**: 2026-08-15
> **工具**: CodeGraph 自动分析

---

## 项目概览

MoreAni（又看一集）是一个面向朋友小圈子的内部内容分享工具，支持番剧、电影、游戏、软件、网站、书籍的统一管理和评分。

---

## 后端架构

### 入口文件

```
backend/main.py
├── FastAPI 应用入口
├── 注册所有 v1 路由（/api/v1/*）
├── CORS 中间件（按环境白名单）
├── Rate Limit 中间件
└── 启动时自动创建数据库表
```

### 数据模型 (models.py)

```
┌─────────────────────────────────────────────────────────────┐
│                        User (users)                         │
│  id, username, password_hash, avatar_id, role, timestamps   │
├─────────────────────────────────────────────────────────────┤
│                        ↓ 1:N                                │
├─────────────────────────────────────────────────────────────┤
│                   ContentItem (content_items)                │
│  id, title, title_alt, cover_url, description,              │
│  content_type, episodes, status, release_date, platform,    │
│  source_type, source_id, source_url, metadata, is_public    │
├─────────────────────────────────────────────────────────────┤
│         ↓ 1:N              ↓ N:N              ↓ 1:N        │
├─────────────────────────────────────────────────────────────┤
│     Rating (ratings)    Tag (tags)    UserContentStatus     │
│  score, recommend,      name,         status:               │
│  review                 tag_type      want/watching/        │
│                                       watched/dropped       │
└─────────────────────────────────────────────────────────────┘
```

### API 路由 (routers/v1/)

| 路由文件 | 前缀 | 功能 |
|----------|------|------|
| auth.py | /auth | 登录/注册/用户信息/修改密码/头像 |
| content.py | /content | 内容 CRUD/列表/搜索/随机/分享链接 |
| rating.py | /rating | 评分 CRUD/最近动态/历史记录 |
| status.py | /status | 观看状态设置/清除/列表 |
| tag.py | /tag | 标签创建/搜索 |
| bangumi.py | /bangumi | Bangumi 搜索/导入 |
| proxy.py | /proxy | 图片代理（绕过 CORP 限制） |

### 服务层 (services/)

| 服务 | 职责 |
|------|------|
| content.py | 内容 CRUD、列表查询、搜索、标签关联 |
| rating.py | 评分 CRUD、统计、最近动态 |
| user.py | 用户管理、头像、密码 |
| tag.py | 标签 CRUD、搜索 |
| bangumi.py | Bangumi API 客户端 |

### 依赖注入 (deps.py)

- `get_db()` — 数据库会话
- `get_current_user()` — JWT 认证用户
- `get_current_user_optional()` — 可选认证

---

## 前端架构

### 组件树

```
App.tsx
├── AppHeader (导航栏)
│   ├── Logo
│   ├── 用户菜单
│   └── 登录/注册按钮
│
├── HomePage (首页)
│   ├── PageContainer (布局容器)
│   ├── HeroSection (大封面展示)
│   ├── CategoryTabs (分类标签)
│   ├── ContentCard[] (番剧卡片网格)
│   └── ContentListItem[] (其他内容列表)
│
├── ProfilePage (用户主页)
│
├── ContentDetailDialog (详情侧边栏)
│   ├── 封面大图
│   ├── 评分徽章
│   ├── RatingForm (评分表单)
│   └── StarRating (星星组件)
│
├── AuthDialog (登录/注册弹窗)
│
└── SettingsDialog (设置弹窗)
```

### 状态管理 (stores/)

| Store | 职责 |
|-------|------|
| auth-store.ts | 用户认证状态、登录/登出 |
| ui-store.ts | 弹窗状态管理 |

### API 客户端 (lib/api.ts)

统一的 fetch 封装，包含：
- 认证：login, register, getMe, updateAvatar
- 内容：listContent, getContent, createContent, updateContent, deleteContent, getRandom
- 评分：upsertRating, deleteRating, getRecentRatings
- 状态：setStatus, clearStatus, getMyStatuses
- 标签：searchTags, createTag
- Bangumi：searchBangumi, importBangumi
- 用户：getUser, getUserRatings
- 代理：图片 URL 自动代理

### 图片处理 (CORP/CORS)

外部图片（lain.bgm.tv）通过 `secureUrl()` 函数自动代理：

```typescript
function secureUrl(url: string): string {
  if (!url) return url
  if (url.includes('lain.bgm.tv') || url.includes('bgm.tv')) {
    return `/api/v1/proxy/image?url=${encodeURIComponent(url)}`
  }
  return url.replace(/^http:\/\//, 'https://')
}
```

---

## 数据库表结构

| 表名 | 说明 | 关键字段 |
|------|------|----------|
| users | 用户表 | username, password_hash, role |
| invite_codes | 邀请码 | code, used_by |
| content_items | 统一内容表 | title, content_type, cover_url, source_type |
| tags | 标签表 | name, tag_type |
| content_tags | 内容-标签关联 | content_id, tag_id |
| ratings | 评分表 | score(0-100), recommend(0-100), review |
| user_content_status | 观看状态 | status(want/watching/watched/dropped) |
| share_links | 分享链接 | token, expires_at, view_count |

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 19 + TypeScript + Tailwind CSS v4 |
| 状态管理 | Zustand |
| 路由 | React Router v6 |
| 构建 | Vite |
| 后端 | Python FastAPI + SQLAlchemy 2.0 |
| 数据库 | SQLite |
| 认证 | JWT (httpOnly cookie) |
| 外部 API | Bangumi API v0 |

---

## 关键依赖关系

```
前端组件 → API 客户端 → 后端路由 → 服务层 → 数据模型
    ↓           ↓           ↓          ↓          ↓
  Zustand    fetch()    FastAPI    SQLAlchemy   SQLite
```

---

## 安全设计

1. **认证**: JWT token 存储在 httpOnly cookie
2. **限流**: Rate Limit 中间件防暴力破解
3. **权限**: 创建者/admin 才能编辑/删除
4. **图片代理**: 域名白名单限制
5. **输入校验**: Pydantic schema 验证

---

## 文件结构

```
MoreAni/
├── backend/
│   ├── main.py              # FastAPI 入口
│   ├── models.py            # SQLAlchemy ORM 模型
│   ├── schemas.py           # Pydantic 请求/响应模型
│   ├── auth.py              # JWT 工具函数
│   ├── deps.py              # FastAPI 依赖注入
│   ├── database.py          # 数据库连接
│   ├── middleware/           # 中间件
│   │   └── rate_limit.py    # 限流中间件
│   ├── routers/v1/          # API 路由
│   │   ├── auth.py          # 认证路由
│   │   ├── content.py       # 内容路由
│   │   ├── rating.py        # 评分路由
│   │   ├── status.py        # 状态路由
│   │   ├── tag.py           # 标签路由
│   │   ├── bangumi.py       # Bangumi 路由
│   │   └── proxy.py         # 图片代理路由
│   └── services/            # 业务逻辑层
│       ├── content.py       # 内容服务
│       ├── rating.py        # 评分服务
│       ├── user.py          # 用户服务
│       ├── tag.py           # 标签服务
│       └── bangumi.py       # Bangumi 服务
│
├── frontend/
│   └── src/
│       ├── App.tsx          # 根组件
│       ├── main.tsx         # 入口
│       ├── pages/           # 页面组件
│       │   ├── HomePage.tsx
│       │   └── ProfilePage.tsx
│       ├── components/      # UI 组件
│       │   ├── layout/      # 布局组件
│       │   ├── content/     # 内容组件
│       │   ├── rating/      # 评分组件
│       │   ├── auth/        # 认证组件
│       │   └── ui/          # 基础 UI 组件
│       ├── stores/          # Zustand 状态
│       ├── lib/             # 工具库
│       │   ├── api.ts       # API 客户端
│       │   └── utils.ts     # 工具函数
│       └── types/           # TypeScript 类型
│
└── docs/                    # 项目文档
    ├── design/              # 设计文档
    ├── decisions/           # 决策日志
    └── review/              # 架构评审
```
