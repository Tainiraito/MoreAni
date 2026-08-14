# MoreAni v2.0 — I阶段：创意构思

> **文档版本**: v0.1
> **日期**: 2026-08-14
> **状态**: 🔄 进行中

---

## 1. 创意构思总览

基于 R 阶段确认的 11 项决策，逐个领域提出创意方案。

---

## 2. 领域一：内容类型扩展

### 现状
当前只支持「番剧」，用 `animes` 表存储。但用户需求是「番剧/电影/游戏/软件/网站」都要支持。

### 创意 A：统一内容模型（推荐 ✅）

```
content_items（内容条目）
├── type: enum('anime', 'movie', 'game', 'software', 'website', 'book')
├── title, title_alt, cover_url, description
├── source_type: enum('bangumi', 'manual', 'steam', 'douban')
├── source_id: string (关联外部平台)
├── tags: 关联表
├── created_by → users
└── created_at, updated_at
```

**优点**：
- 一套代码支持所有类型
- 按 type 筛选即可
- 未来扩展新类型只需加 enum 值
- Bangumi 只是数据源之一，不是唯一

**实现成本**：中等（需要改表名和字段映射）

### 创意 B：多表独立模型

每种类型一个表（animes, movies, games...），共享评分表。

**优点**：各类型字段可以不同
**缺点**：大量重复代码，评分系统要写 N 套

### 决策

**选择 A**。统一模型更简洁，符合「内容分享工具」的定位。

---

## 3. 领域二：分类与标签

### 现状
标签用 JSON 字符串存储，没有分类体系。

### 创意 A：Bangumi 标签 + 自定义标签混合（推荐 ✅）

```
tags（标签表）
├── id, name, type: enum('bangumi', 'custom')
└── created_at

content_tags（关联表）
└── content_id → content_items, tag_id → tags
```

- 从 Bangumi 导入时，自动抓取标签并存入 tags 表
- 用户可以手动添加自定义标签
- Bangumi 标签标记为 `type='bangumi'`，自定义标记为 `type='custom'`
- 不维护「分类字典」，直接用标签系统

**优点**：
- 不需要自己维护分类体系
- Bangumi 标签天然丰富
- 用户可以自由打标签
- 标签可以跨类型使用（一个标签可以同时用于番剧和电影）

### 创意 B：维护本地分类字典

自己建 categories 表，手动维护类型→分类映射。

**优点**：完全可控
**缺点**：维护成本高，和 Bangumi 对不上

### 决策

**选择 A**。用标签系统代替分类字典，Bangumi 标签 + 自定义标签混合。

---

## 4. 领域三：评分系统

### 现状
- 内部和 UI 都是 1-10 整数
- 双维度：anime_score + recommend

### 创意：百分制内部存储 + 10星 UI 显示

```
ratings 表
├── score: integer (0-100, 百分制内部存储)
├── recommend: integer (0-100, 百分制内部存储)
└── review: text

API 层
├── 返回 score（百分制）给需要精确数据的场景
└── 返回 score_display（1-10）给 UI 显示

UI 层
├── el-rate :max="10" 显示 10 星
└── 显示分数时除以10: `${score/10}分`
```

**评分转换**：
- 用户打 8 星 → 存储 80
- 显示均分 → `avg/10` 四舍五入到一位小数
- 未来如果要支持半星 → 存储 85 显示 8.5 星

**优点**：
- 内部精度高，方便后续换算
- UI 保持 10 星直觉
- 0分 = 暂不打分（保持兼容）

---

## 5. 领域四：观看状态

### 创意：独立的用户-内容状态表

```
user_content_status（用户观看状态）
├── user_id → users
├── content_id → content_items
├── status: enum('want', 'watching', 'watched', 'dropped')
├── updated_at
└── UNIQUE(user_id, content_id)
```

**状态定义**：
| 状态 | 中文 | 图标 | 说明 |
|------|------|------|------|
| want | 想看 | 📋 | 收藏/计划观看 |
| watching | 在看 | ▶️ | 正在观看 |
| watched | 看完 | ✅ | 已完成 |
| dropped | 弃坑 | ❌ | 放弃观看 |

**UI 设计**：
- 番剧卡片上显示状态图标
- 筛选器支持按状态筛选
- 首页「我的片单」按状态分组

---

## 6. 领域五：用户头像

### 创意：内置头像集 + 随机分配

```
avatars（头像配置，代码内嵌或配置文件）
├── 20-30 个预设头像（SVG 或 PNG）
├── 风格统一（可爱/简约/像素风）
└── 注册时随机分配，用户可在设置中切换
```

**头像存储**：
- 放在 `frontend/public/avatars/` 目录
- 用户记录 `avatar_id: integer`（头像编号）
- 不存图片文件，只存编号

**切换方式**：
- 设置页展示头像网格
- 点击选择 → 更新 avatar_id

---

## 7. 领域六：内容分享类型扩展

### 现状
只支持 Bangumi 导入。

### 创意：多源导入架构

```
content_items
├── source_type: enum('bangumi', 'steam', 'manual')
├── source_id: string
└── source_url: string (原始链接)

导入流程
├── Bangumi → 自动填充元数据
├── Steam → 自动填充（未来）
├── 手动 → 用户自己填
└── 链接解析 → 自动识别类型（未来）
```

**MVP 阶段**：只做 Bangumi + 手动
**未来扩展**：Steam、豆瓣、IT 邦助等

---

## 8. 领域七：安全与隐私

### 8.1 安全防护

| 威胁 | 防护方案 |
|------|----------|
| 暴力破解登录 | 登录失败 5 次锁定 15 分钟 |
| SQL 注入 | SQLAlchemy ORM 天然防护 |
| XSS 攻击 | 前端 v-text/v-html 安全使用 |
| CSRF | SameSite cookie + JWT |
| 频率限制 | API 限流（60次/分钟） |
| 邀请码枚举 | 注册失败不区分「码错」和「用户已存在」 |

### 8.2 隐私保护

**核心原则**：只有注册用户才能看到内容。

| 场景 | 方案 |
|------|------|
| 未登录访问 | 只看到登录页面，看不到任何内容 |
| 未注册用户 | 无法注册（需邀请码） |
| 内容可见性 | 所有登录用户可见所有内容（内部工具） |
| API 保护 | 所有 API 需要 JWT token（除 login/register） |

**实现**：
- 前端路由守卫：未登录重定向到登录页
- 后端中间件：所有 /api/* 需要 token（除 /api/auth/login 和 /api/auth/register）
- 不做「公开/私密」分级（内部工具，要么全看要么全不看）

---

## 9. 领域八：架构重设计

### 9.1 后端架构

```
backend/
├── main.py              # FastAPI 入口
├── database.py          # 数据库连接
├── models.py            # SQLAlchemy 模型
├── schemas.py           # Pydantic Schema
├── auth.py              # JWT 认证
├── deps.py              # 依赖注入（get_db, get_current_user）
├── services/
│   ├── content.py       # 内容业务逻辑
│   ├── rating.py        # 评分业务逻辑
│   ├── user.py          # 用户业务逻辑
│   └── bangumi.py       # Bangumi API 客户端
├── routers/
│   ├── v1/
│   │   ├── auth.py      # 认证路由
│   │   ├── content.py   # 内容路由
│   │   ├── rating.py    # 评分路由
│   │   └── user.py      # 用户路由
│   └── __init__.py
├── middleware/
│   ├── rate_limit.py    # 限流中间件
│   └── security.py      # 安全中间件
└── scripts/
    ├── manage_codes.py  # 邀请码管理
    └── seed_avatars.py  # 头像初始化
```

### 9.2 前端架构

```
frontend/src/
├── App.vue
├── main.ts
├── router/
│   └── index.ts         # 路由配置
├── stores/
│   ├── auth.ts          # 认证状态
│   ├── content.ts       # 内容数据
│   └── app.ts           # 全局状态
├── views/
│   ├── HomeView.vue     # 首页（推荐+动态）
│   ├── ExploreView.vue  # 探索（列表+搜索+筛选）
│   ├── DetailView.vue   # 内容详情页
│   ├── ProfileView.vue  # 个人主页
│   └── SettingsView.vue # 设置页
├── components/
│   ├── layout/
│   │   ├── AppHeader.vue
│   │   └── AppFooter.vue
│   ├── content/
│   │   ├── ContentCard.vue
│   │   ├── ContentGrid.vue
│   │   └── ContentDetail.vue
│   ├── rating/
│   │   ├── RatingStars.vue
│   │   ├── RatingForm.vue
│   │   └── RatingList.vue
│   ├── auth/
│   │   ├── LoginDialog.vue
│   │   └── RegisterDialog.vue
│   └── common/
│       ├── AvatarPicker.vue
│       ├── StatusBadge.vue
│       └── EmptyState.vue
├── composables/
│   ├── useApi.ts
│   ├── useAuth.ts
│   └── useContent.ts
├── types/
│   └── index.ts
└── styles/
    └── main.css
```

### 9.3 关键设计决策

| 决策 | 方案 | 理由 |
|------|------|------|
| 路由 | vue-router，5 个页面 | 功能分离，URL 可分享 |
| 状态管理 | Pinia（3 个 store） | 类型安全，DevTools 支持 |
| API 版本 | /api/v1/ | 向后兼容 |
| 认证 | JWT + httpOnly cookie | 比 localStorage 更安全 |
| 数据库 | SQLite（暂不迁移） | 够用，简单 |

---

## 10. MVP 功能范围

### v2.0 MVP（必须完成）

| # | 功能 | 说明 |
|---|------|------|
| 1 | 统一内容模型 | 替代 animes 表，支持多类型 |
| 2 | 观看状态 | 想看/在看/看完/弃坑 |
| 3 | 百分制评分 | 内部百分制，UI 10 星 |
| 4 | 前端路由拆分 | 5 个页面 |
| 5 | Pinia 状态管理 | 3 个 store |
| 6 | 后端 service 层 | 业务逻辑分离 |
| 7 | 登录安全加固 | 限流 + 防暴力破解 |
| 8 | 内容访问控制 | 未登录不可见 |
| 9 | UI 完全重设计 | 新视觉风格 |
| 10 | AGENTS.md | LLM 协作规范 |
| 11 | 分支策略 | git flow 规范 |

### v2.1（后续迭代）

| # | 功能 |
|---|------|
| 12 | 用户个人主页 |
| 13 | 内置头像系统 |
| 14 | 单元测试 |
| 15 | CI/CD |

---

## 11. 下一步

I 阶段创意构思完成。等待主人确认后，进入 P 阶段（方案设计），产出详细的技术设计文档。

**需要主人确认**：
1. 以上 8 个领域的创意方案是否认可？
2. MVP 功能范围是否合理？
3. 有没有需要调整或补充的？
