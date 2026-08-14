# MoreAni v2.0 — P阶段：技术设计

> **文档版本**: v0.2（根据 I 阶段确认更新）
> **日期**: 2026-08-14
> **状态**: 🔄 待确认

---

## 1. 技术栈

| 层 | 选择 | 理由 |
|----|------|------|
| 后端 | Python FastAPI | 现有基础，LLM 支持最好 |
| ORM | SQLAlchemy 2.0 | 类型安全 |
| 数据库 | SQLite | 暂不迁移 |
| 前端 | React 18 + TypeScript | LLM 友好 |
| UI | shadcn/ui + Tailwind CSS | 无运行时、可定制 |
| 状态 | Zustand | 轻量、显式 |
| 路由 | React Router v6 | 类型安全 |
| 构建 | Vite | 快 |
| 部署 | Docker | 现有方案 |

---

## 2. 数据库设计

### 2.1 ER 图

```
users ─────┬──────────────────────┐
  │        │                      │
  │ 1:N    │ 1:N                  │ 1:N
  ▼        ▼                      ▼
content_items   ratings     user_content_status
  │             │
  │ 1:N         │
  ▼             │
content_tags ◄──┘
  │
  │ N:1
  ▼
tags
```

### 2.2 表结构

#### users

```sql
CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      VARCHAR(50)  NOT NULL UNIQUE,
    password_hash VARCHAR(128) NOT NULL,
    avatar_id     INTEGER      DEFAULT 0,
    role          VARCHAR(20)  DEFAULT 'user',
    created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP
);
```

#### content_items

```sql
CREATE TABLE content_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         VARCHAR(200) NOT NULL,
    title_alt     VARCHAR(200) DEFAULT '',
    cover_url     VARCHAR(500) DEFAULT '',
    description   TEXT         DEFAULT '',
    content_type  VARCHAR(20)  NOT NULL,      -- anime/movie/game/software/website/book
    episodes      INTEGER      DEFAULT 0,
    status        VARCHAR(20)  DEFAULT '',    -- airing/finished/upcoming
    release_date  VARCHAR(20)  DEFAULT '',
    platform      VARCHAR(50)  DEFAULT '',
    source_type   VARCHAR(20)  DEFAULT 'manual', -- bangumi/manual
    source_id     VARCHAR(50)  DEFAULT '',
    source_url    VARCHAR(500) DEFAULT '',
    metadata      TEXT         DEFAULT '{}',  -- JSON: 各类型特有字段
    is_public     BOOLEAN      DEFAULT 1,
    created_by    INTEGER      REFERENCES users(id),
    created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     DEFAULT CURRENT_TIMESTAMP
);
```

**metadata 示例**：
- 番剧: `{"episodes": 24, "air_status": "finished"}`
- 游戏: `{"developer": "miHoYo", "platforms": ["PC", "PS5"]}`
- 软件: `{"version": "1.0", "license": "MIT"}`

#### tags

```sql
CREATE TABLE tags (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      VARCHAR(50) NOT NULL UNIQUE,
    tag_type  VARCHAR(20) DEFAULT 'custom',  -- bangumi/custom
    created_at DATETIME    DEFAULT CURRENT_TIMESTAMP
);
```

#### content_tags

```sql
CREATE TABLE content_tags (
    content_id INTEGER REFERENCES content_items(id) ON DELETE CASCADE,
    tag_id     INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (content_id, tag_id)
);
```

#### ratings

```sql
CREATE TABLE ratings (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER REFERENCES content_items(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    score      INTEGER NOT NULL,   -- 0-100 百分制（0=暂不打分，5=0.5星，100=10星）
    recommend  INTEGER NOT NULL,   -- 0-100 百分制
    review     TEXT    DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(content_id, user_id)
);
```

**换算**：`score / 10 = X.X 星`，`score / 10 = XX 分`

#### user_content_status

```sql
CREATE TABLE user_content_status (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    content_id INTEGER REFERENCES content_items(id) ON DELETE CASCADE,
    status     VARCHAR(20) NOT NULL,  -- want/watching/watched/dropped
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, content_id)
);
```

**状态标签按类型显示**：

| 类型 | 想看 | 在看 | 已看 | 弃坑 |
|------|------|------|------|------|
| 番剧/电影 | 想看 | 在看 | 已看 | 弃坑 |
| 游戏 | 想玩 | 在玩 | 已玩 | 弃坑 |
| 软件/网站 | 收藏 | — | — | — |

#### invite_codes

```sql
CREATE TABLE invite_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       VARCHAR(50) NOT NULL UNIQUE,
    used_by    INTEGER     REFERENCES users(id),
    created_at DATETIME    DEFAULT CURRENT_TIMESTAMP
);
```

#### share_links

```sql
CREATE TABLE share_links (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token      VARCHAR(32) NOT NULL UNIQUE,
    created_by INTEGER     REFERENCES users(id),
    expires_at DATETIME    DEFAULT NULL,
    view_count INTEGER     DEFAULT 0,
    created_at DATETIME    DEFAULT CURRENT_TIMESTAMP
);
```

### 2.3 索引

```sql
CREATE INDEX idx_content_type ON content_items(content_type);
CREATE INDEX idx_content_source ON content_items(source_type, source_id);
CREATE INDEX idx_rating_content ON ratings(content_id);
CREATE INDEX idx_rating_user ON ratings(user_id);
CREATE INDEX idx_status_user ON user_content_status(user_id);
CREATE INDEX idx_tags_name ON tags(name);
```

---

## 3. API 设计（/api/v1/）

### 3.1 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /auth/register | 注册（需邀请码） |
| POST | /auth/login | 登录 |
| GET | /auth/me | 当前用户 |
| PUT | /auth/me/avatar | 修改头像 |
| PUT | /auth/me/password | 修改密码 |

### 3.2 内容

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /content | 列表（分页+筛选+搜索） |
| GET | /content/random | 随机推荐 |
| GET | /content/:id | 详情 |
| POST | /content | 创建 |
| PUT | /content/:id | 更新 |
| DELETE | /content/:id | 删除 |
| POST | /content/:id/share | 创建分享链接 |

**列表参数**：`?type=&status=&tag=&q=&sort=&page=&size=`

### 3.3 评分

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /rating | 创建/更新 |
| GET | /rating/recent | 最近动态 |
| GET | /rating/history | 我的历史 |
| DELETE | /rating/:id | 删除 |

### 3.4 观看状态

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /status | 设置 |
| GET | /status | 我的状态列表 |
| DELETE | /status/:content_id | 清除 |

### 3.5 标签

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /tag | 标签列表（?q= 搜索） |
| POST | /tag | 创建自定义标签 |

### 3.6 用户

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /user/:id | 公开信息 |
| GET | /user/:id/ratings | 评分历史 |

### 3.7 分享链接（游客）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /guest/:token | 获取临时权限 |
| GET | /guest/:token/content | 浏览内容 |
| GET | /guest/:token/search | 搜索内容 |

### 3.8 Bangumi

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /bangumi/search | 搜索 |
| GET | /bangumi/:bgm_id | 详情 |
| POST | /bangumi/import/:bgm_id | 导入 |

---

## 4. 前端设计

### 4.1 页面结构

| 组件 | 形态 | 路由/触发 |
|------|------|-----------|
| 首页/探索 | 页面 | `/` |
| 内容详情 | 弹窗 | 点击卡片 |
| 登录/注册 | 弹窗 | 未登录自动弹 |
| 设置 | 弹窗 | 头部菜单 |
| 用户主页 | 页面 | `/profile/:id` |

### 4.2 文件结构

```
frontend/src/
├── main.tsx
├── App.tsx
├── router.tsx
├── types/
│   ├── content.ts
│   ├── rating.ts
│   ├── user.ts
│   └── api.ts
├── stores/
│   ├── auth-store.ts
│   ├── content-store.ts
│   └── ui-store.ts
├── pages/
│   ├── HomePage.tsx        # 首页/探索合并
│   └── ProfilePage.tsx     # 用户主页
├── components/
│   ├── layout/             # AppHeader
│   ├── content/            # ContentCard, ContentGrid, ContentDetailDialog
│   ├── rating/             # RatingStars, RatingForm
│   ├── auth/               # AuthDialog（登录+注册合并）
│   ├── settings/           # SettingsDialog, AvatarPicker
│   └── ui/                 # shadcn/ui 组件
├── hooks/
│   ├── use-api.ts
│   ├── use-auth.ts
│   └── use-content.ts
├── lib/
│   ├── api.ts
│   └── utils.ts
└── styles/
    └── globals.css
```

### 4.3 组件规范（React + TypeScript）

```tsx
// 1. imports
// 2. types/interfaces
// 3. hooks
// 4. component
// 5. named export

interface ContentCardProps {
  content: ContentItem
  onSelect: (id: number) => void
}

export function ContentCard({ content, onSelect }: ContentCardProps) {
  return <div onClick={() => onSelect(content.id)}>{content.title}</div>
}
```

---

## 5. 安全设计

### 5.1 认证

JWT + httpOnly cookie，中间件校验。

### 5.2 限流

| 端点 | 限制 |
|------|------|
| POST /auth/login | 5次/15分钟（按 IP） |
| POST /auth/register | 3次/小时（按 IP） |
| 其他写操作 | 20次/分钟（按用户） |
| 读操作 | 60次/分钟（按 IP） |

### 5.3 权限模型

| 角色 | 权限 |
|------|------|
| 未登录 | 只看到登录页 |
| 游客（分享链接） | 全站只读（浏览+搜索） |
| 普通用户 | 全部读写 |
| 管理员 | 全部 + 用户管理 |

---

## 6. 工程化

### 6.1 分支策略

```
main          ← 稳定版本
  └── dev     ← 开发主线
       ├── feat/xxx
       ├── fix/xxx
       └── refactor/xxx
```

### 6.2 文件大小限制

| 类型 | 上限 | 超过处理 |
|------|------|----------|
| Python | 300 行 | 拆分模块 |
| TSX/TS | 200 行 | 拆分组件 |
| CSS | 200 行 | 用 Tailwind |

---

## 7. 下一步

P 阶段文档已根据 I 阶段确认内容更新。请主人审阅，有问题逐个确认~ ♪
