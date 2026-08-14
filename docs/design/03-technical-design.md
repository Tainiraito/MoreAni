# MoreAni v2.0 — P阶段：方案设计

> **文档版本**: v0.1
> **日期**: 2026-08-14
> **状态**: 🔄 进行中

---

## 1. 设计原则

### 1.1 面向 LLM 编写的代码规范

| 原则 | 说明 | 示例 |
|------|------|------|
| **单一职责** | 每个文件只做一件事 | `user_service.py` 只管用户逻辑 |
| **小文件** | 单文件不超过 300 行 | 超过就拆分 |
| **显式类型** | 全量类型标注 | Python: type hints, TS: interface |
| **自文档化** | 清晰命名 + docstring | `get_content_by_id()` 不是 `get_c()` |
| **一致模式** | 相同功能用相同写法 | 所有 service 方法签名统一 |
| **扁平导入** | 避免深层嵌套 | `from services import user` 不是 `from services.user.helpers import ...` |

### 1.2 技术栈确认

| 层 | 选择 | 理由 |
|----|------|------|
| 后端 | Python FastAPI | 现有代码基础，LLM 支持最好 |
| ORM | SQLAlchemy 2.0 | 类型安全，async 支持 |
| 数据库 | SQLite | 暂不迁移，够用 |
| 前端 | **React 18 + TypeScript** | LLM 友好：一种语言、显式状态、训练数据多 |
| UI 库 | **shadcn/ui + Tailwind CSS** | 无运行时依赖、可定制、LLM 友好 |
| 状态管理 | **Zustand** | 轻量、显式、TypeScript 友好 |
| 路由 | React Router v6 | 成熟、类型安全 |
| 构建 | Vite | 快，HMR 好 |
| 部署 | Docker | 现有方案 |

---

## 2. 数据库设计

### 2.1 ER 图

```
users ──────────┬──────────────────────┐
  │             │                      │
  │ 1:N         │ 1:N                  │ 1:N
  ▼             ▼                      ▼
content_items   ratings          user_content_status
  │             │                      │
  │ 1:N         │                      │
  ▼             │                      │
content_tags ◄──┘                      │
  │                                    │
  │ N:1                                │
  ▼                                    │
tags ──────────────────────────────────┘
```

### 2.2 表结构

#### users（用户表）

```sql
CREATE TABLE users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    VARCHAR(50)  NOT NULL UNIQUE,
    password_hash VARCHAR(128) NOT NULL,
    avatar_id   INTEGER      DEFAULT 0,
    role        VARCHAR(20)  DEFAULT 'user',  -- 'admin' / 'user'
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
);
```

#### content_items（内容条目表）

```sql
CREATE TABLE content_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       VARCHAR(200) NOT NULL,
    title_alt   VARCHAR(200) DEFAULT '',      -- 原名/别名
    cover_url   VARCHAR(500) DEFAULT '',
    description TEXT         DEFAULT '',
    content_type VARCHAR(20) NOT NULL,        -- 'anime'/'movie'/'game'/'software'/'website'/'book'
    episodes    INTEGER      DEFAULT 0,
    status      VARCHAR(20)  DEFAULT '',      -- 'airing'/'finished'/'upcoming'
    release_date VARCHAR(20) DEFAULT '',
    platform    VARCHAR(50)  DEFAULT '',      -- 'TV'/'Web'/'Steam' etc.
    source_type VARCHAR(20)  DEFAULT 'manual', -- 'bangumi'/'steam'/'manual'
    source_id   VARCHAR(50)  DEFAULT '',       -- 外部平台 ID
    source_url  VARCHAR(500) DEFAULT '',       -- 原始链接
    share_token VARCHAR(32)  UNIQUE,           -- 分享链接 token
    is_public   BOOLEAN      DEFAULT 1,        -- 是否可公开访问
    created_by  INTEGER      REFERENCES users(id),
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
);
```

#### tags（标签表）

```sql
CREATE TABLE tags (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        VARCHAR(50)  NOT NULL UNIQUE,
    tag_type    VARCHAR(20)  DEFAULT 'custom', -- 'bangumi'/'custom'
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
);
```

#### content_tags（内容-标签关联表）

```sql
CREATE TABLE content_tags (
    content_id  INTEGER REFERENCES content_items(id) ON DELETE CASCADE,
    tag_id      INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (content_id, tag_id)
);
```

#### ratings（评分表）

```sql
CREATE TABLE ratings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id  INTEGER REFERENCES content_items(id) ON DELETE CASCADE,
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    score       INTEGER      NOT NULL,  -- 0-1000 千分制（0=暂不打分，50=0.5星，1000=10星）
    recommend   INTEGER      NOT NULL,  -- 0-1000 千分制
    review      TEXT         DEFAULT '',
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(content_id, user_id)
);
```

**评分换算公式**：
```
UI 显示: score / 100 = X.X 星（如 850 → 8.5 星）
百分制:  score / 10 = XX 分（如 850 → 85 分）
```

#### user_content_status（观看状态表）

```sql
CREATE TABLE user_content_status (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    content_id  INTEGER REFERENCES content_items(id) ON DELETE CASCADE,
    status      VARCHAR(20)  NOT NULL, -- 'want'/'watching'/'watched'/'dropped'
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, content_id)
);
```

#### invite_codes（邀请码表）

```sql
CREATE TABLE invite_codes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        VARCHAR(50)  NOT NULL UNIQUE,
    used_by     INTEGER      REFERENCES users(id),
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
);
```

#### share_links（分享链接表）

```sql
CREATE TABLE share_links (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id  INTEGER REFERENCES content_items(id) ON DELETE CASCADE,
    token       VARCHAR(32)  NOT NULL UNIQUE,
    created_by  INTEGER      REFERENCES users(id),
    expires_at  DATETIME     DEFAULT NULL,    -- NULL=永不过期
    view_count  INTEGER      DEFAULT 0,
    created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP
);
```

### 2.3 索引策略

```sql
CREATE INDEX idx_content_type ON content_items(content_type);
CREATE INDEX idx_content_source ON content_items(source_type, source_id);
CREATE INDEX idx_content_share ON content_items(share_token);
CREATE INDEX idx_rating_content ON ratings(content_id);
CREATE INDEX idx_rating_user ON ratings(user_id);
CREATE INDEX idx_status_user ON user_content_status(user_id);
CREATE INDEX idx_status_content ON user_content_status(content_id);
CREATE INDEX idx_tags_name ON tags(name);
```

---

## 3. API 设计

### 3.1 API 版本化

所有 API 挂载在 `/api/v1/` 下，未来可扩展 `/api/v2/`。

### 3.2 认证 API

```
POST   /api/v1/auth/register          # 注册（需邀请码）
POST   /api/v1/auth/login             # 登录
GET    /api/v1/auth/me                # 当前用户信息
PUT    /api/v1/auth/me/avatar         # 修改头像
PUT    /api/v1/auth/me/password       # 修改密码
```

### 3.3 内容 API

```
GET    /api/v1/content                # 列表（分页+筛选+搜索）
GET    /api/v1/content/random         # 随机推荐
GET    /api/v1/content/:id            # 详情
POST   /api/v1/content                # 创建
PUT    /api/v1/content/:id            # 更新
DELETE /api/v1/content/:id            # 删除
GET    /api/v1/content/:id/share      # 获取/创建分享链接
```

**列表查询参数**：
```
?type=anime            # 按类型筛选
?status=watching       # 按观看状态筛选（当前用户）
?tag=科幻              # 按标签筛选
?q=鬼灭                # 搜索标题/描述
?sort=score            # 排序：score/recommend/count/newest
?page=1&size=20        # 分页
```

### 3.4 评分 API

```
POST   /api/v1/rating                 # 创建/更新评分
GET    /api/v1/rating/recent          # 最近动态
GET    /api/v1/rating/history         # 我的评分历史
DELETE /api/v1/rating/:id             # 删除评分
```

### 3.5 观看状态 API

```
POST   /api/v1/status                 # 设置状态
GET    /api/v1/status                 # 我的状态列表
DELETE /api/v1/status/:content_id     # 清除状态
```

### 3.6 标签 API

```
GET    /api/v1/tag                    # 标签列表（支持 ?q= 搜索）
POST   /api/v1/tag                    # 创建自定义标签
```

### 3.7 用户 API

```
GET    /api/v1/user/:id               # 用户公开信息
GET    /api/v1/user/:id/ratings       # 用户评分历史
```

### 3.8 游客 API（分享链接）

```
GET    /api/v1/guest/:token           # 通过分享链接获取内容详情
GET    /api/v1/guest/:token/ratings   # 通过分享链接获取评分列表
```

### 3.9 Bangumi API（代理）

```
POST   /api/v1/bangumi/search         # 搜索 Bangumi
GET    /api/v1/bangumi/:bgm_id        # 获取详情
POST   /api/v1/bangumi/import/:bgm_id # 导入
```

---

## 4. 前端页面设计

### 4.1 路由结构

```
/                   → HomeView（首页：推荐+动态）
/explore            → ExploreView（探索：列表+搜索+筛选）
/content/:id        → DetailView（内容详情+评分）
/profile/:id        → ProfileView（用户主页）
/settings           → SettingsView（设置）
/login              → LoginPage（登录）
/register           → RegisterPage（注册）
/guest/:token       → GuestView（游客查看）
```

### 4.2 页面职责

| 页面 | 职责 | 核心组件 |
|------|------|----------|
| HomeView | 推荐卡片 + 最近动态 | ContentCarousel, RecentActivity |
| ExploreView | 内容网格 + 搜索 + 筛选 | ContentGrid, FilterBar, SearchBox |
| DetailView | 内容详情 + 评分 + 评论 | ContentDetail, RatingForm, RatingList |
| ProfileView | 用户信息 + 评分历史 | UserStats, RatingHistory |
| SettingsView | 头像 + 密码 | AvatarPicker, PasswordForm |
| GuestView | 只读内容详情 | ContentDetail (readonly) |

### 4.3 组件规范（React + TypeScript）

**每个组件文件结构**：
```tsx
// 1. imports
// 2. types/interfaces
// 3. hooks
// 4. component
// 5. named export
```

**命名规范**：
- 组件文件：PascalCase（`ContentCard.tsx`）
- 页面文件：PascalCase + Page（`ExplorePage.tsx`）
- Hook 文件：camelCase + use（`useContent.ts`）
- Store 文件：camelCase + store（`useContentStore.ts`）
- 工具文件：camelCase（`formatScore.ts`）
- CSS 类：Tailwind utility classes（无自定义 CSS 文件）

---

## 5. 安全设计

### 5.1 认证流程

```
登录 → 服务端验证 → 返回 JWT (httpOnly cookie)
                        ↓
后续请求 → 自动携带 cookie → 中间件验证 token → 放行/拒绝
```

### 5.2 限流规则

| 端点 | 限制 | 说明 |
|------|------|------|
| POST /auth/login | 5次/15分钟 | 按 IP |
| POST /auth/register | 3次/小时 | 按 IP |
| POST /content | 10次/分钟 | 按用户 |
| POST /rating | 20次/分钟 | 按用户 |
| GET /* | 60次/分钟 | 按 IP |

### 5.3 游客权限

```
/guest/:token
├── ✅ 查看内容详情
├── ✅ 查看评分列表（不含用户信息）
├── ❌ 评分
├── ❌ 评论
├── ❌ 查看用户信息
└── ❌ 任何写操作
```

### 5.4 数据脱敏

| 数据 | 登录用户 | 游客 |
|------|----------|------|
| 内容详情 | 完整 | 完整 |
| 评分分数 | 完整 | 完整 |
| 评分评论 | 完整 | 完整 |
| 评分用户名 | 显示 | 隐藏（显示「匿名用户」） |
| 评分用户头像 | 显示 | 隐藏 |
| 用户 ID | 显示 | 隐藏 |

---

## 6. 工程化规范

### 6.1 分支策略

```
main          ← 稳定版本，只接受 PR 合并
  └── dev     ← 开发主线，功能分支从这里分出
       ├── feat/xxx     ← 功能分支
       ├── fix/xxx      ← 修复分支
       └── refactor/xxx ← 重构分支
```

### 6.2 版本管理

采用 Semantic Versioning：`MAJOR.MINOR.PATCH`

- MAJOR：不兼容的 API 变更
- MINOR：新增功能（向下兼容）
- PATCH：Bug 修复

### 6.3 提交规范

```
feat: 新功能
fix: 修复
refactor: 重构（不改功能）
docs: 文档
style: 样式
test: 测试
chore: 构建/工具
```

### 6.4 文件大小限制

| 类型 | 建议上限 | 超过处理 |
|------|----------|----------|
| Python | 300 行 | 拆分为多个模块 |
| Vue | 300 行 | 拆分为子组件 |
| TypeScript | 200 行 | 拆分为多个文件 |
| CSS | 200 行 | 拆分为多个样式文件 |

---

## 7. 下一步

P 阶段方案设计完成。等待主人确认后，进入 E 阶段（执行开发）。

**需要主人确认**：
1. 数据库表结构是否合理？
2. API 设计是否满足需求？
3. 前端页面划分是否 OK？
4. 安全和隐私方案是否满意？
5. 工程化规范是否认可？
