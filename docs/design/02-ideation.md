# MoreAni v2.0 — I阶段：创意构思

> **文档版本**: v0.2
> **日期**: 2026-08-14
> **状态**: ✅ 已确认

---

## 1. 创意构思总览

基于 R 阶段确认的 11 项决策，逐个领域提出创意方案。

---

## 2. 领域一：内容类型扩展

### 现状
当前只支持「番剧」，用 `animes` 表存储。但用户需求是「番剧/电影/游戏/软件/网站」都要支持。

### 方案（✅ 已确认）

统一 `content_items` 模型，公共字段 + JSON `metadata` 存各类型特有字段。

```
content_items
├── id, title, title_alt, cover_url, description
├── content_type: enum('anime', 'movie', 'game', 'software', 'website', 'book')
├── episodes, status, release_date, platform  ← 公共字段
├── source_type, source_id, source_url        ← 外部源
├── share_token, is_public                    ← 分享
├── metadata: JSON                            ← 各类型特有字段
├── created_by → users
└── created_at, updated_at
```

**metadata 示例**：
- 番剧: `{ "episodes": 24, "air_status": "finished" }`
- 游戏: `{ "developer": "miHoYo", "platforms": ["PC", "PS5"], "playtime_hours": 120 }`
- 软件: `{ "version": "1.0", "license": "MIT", "platforms": ["Windows", "Mac"] }`

**优点**：不改表结构即可扩展，前端按 type 渲染不同表单。
**缺点**：JSON 字段不方便精确查询（本项目查询需求简单，够用）。

> 决策 D18: 统一内容模型 + JSON metadata 存特有字段

---

## 3. 领域二：分类与标签

### 现状
标签用 JSON 字符串存储，没有分类体系。

### 方案（✅ 已确认）

独立标签表 + 关联表，Bangumi 标签和自定义标签混合。

```
tags
├── id, name (UNIQUE)
├── tag_type: enum('bangumi', 'custom')
└── created_at

content_tags
├── content_id → content_items (ON DELETE CASCADE)
├── tag_id → tags (ON DELETE CASCADE)
└── PRIMARY KEY (content_id, tag_id)
```

- Bangumi 导入时自动抓取标签 → `tag_type='bangumi'`
- 用户可手动添加标签 → `tag_type='custom'`
- 标签可跨内容类型使用
- 不维护分类字典，标签系统足够

> 决策 D19: 独立标签表 + Bangumi/自定义混合

---

## 4. 领域三：评分系统

### 现状
- 内部和 UI 都是 1-10 整数
- 双维度：anime_score + recommend

### 方案（✅ 已确认）

百分制（0-100）内部存储，10 星半星 UI 显示。

```
ratings 表
├── score: integer (0-100, 百分制)
├── recommend: integer (0-100, 百分制)
└── review: text
```

**换算**：
- 用户打 8.5 星 → 存 85
- 显示均分 → `avg / 10` 四舍五入（如 85 → 8.5）
- 百分制分数 → 直接显示（85分）
- 0 分 = 暂不打分（不计入均分）

**半星实现**：el-rate `allow-half` 属性，步长0.5。

> 决策 D20: 百分制评分（0-100），UI 10 星半星

---

## 5. 领域四：观看状态

### 方案（✅ 已确认）

独立表 `user_content_status`，底层4个状态值，UI 标签按内容类型动态显示。

```
user_content_status
├── user_id → users
├── content_id → content_items
├── status: enum('want', 'watching', 'watched', 'dropped')
├── created_at, updated_at
└── UNIQUE(user_id, content_id)
```

**状态标签按类型显示**：

| 类型 | 想看 | 在看 | 已看 | 弃坑 |
|------|------|------|------|------|
| 番剧/电影 | 想看 | 在看 | 已看 | 弃坑 |
| 游戏 | 想玩 | 在玩 | 已玩 | 弃坑 |
| 软件/网站 | 收藏 | — | — | — |

- 软件/网站只用 `want` 一个值，显示为「收藏」
- 底层存的都是 `want/watching/watched/dropped`

> 决策 D21: 观看状态按内容类型动态显示标签，软件/网站只有「收藏」

---

## 6. 领域五：用户头像

### 方案（✅ 已确认）

内置头像集，前端 `public/avatars/` 目录，用户记录 `avatar_id` 整数编号。

- 注册时随机分配
- 设置页展示头像网格，点击切换
- 不存图片文件，只存编号
- 20-30 个预设头像，风格统一

> 决策 D22: 内置头像集 + avatar_id 编号

---

## 7. 领域六：内容分享类型扩展

### 方案（✅ 已确认）

MVP 支持两种导入：Bangumi + 手动。未来可扩展 Steam、豆瓣等。

```
content_items
├── source_type: enum('bangumi', 'manual')  ← MVP
├── source_id: string
└── source_url: string
```

- Bangumi：搜索 + 一键导入元数据
- 手动：用户自己填写所有字段

> 决策 D23: MVP 先做 Bangumi + 手动导入

---

## 8. 领域七：安全与隐私

### 方案（✅ 已确认）

**A. 安全防护**：

| 威胁 | 防护 |
|------|------|
| 暴力破解登录 | 失败 5 次锁定 15 分钟 |
| API 频率 | 60 次/分钟（按 IP） |
| 邀请码枚举 | 注册限流 3 次/小时（按 IP） |
| SQL 注入 | SQLAlchemy ORM |
| XSS | React 天然转义 |
| CSRF | SameSite cookie + JWT |

**B. 隐私保护**：

| 场景 | 权限 |
|------|------|
| 未登录 | 只看到登录页，无任何内容 |
| 分享链接游客 | 可看内容+评分+评论，不可看用户名/头像 |
| 已登录用户 | 全站可见（内部工具） |

> 决策 D24: 安全限流 + 游客脱敏 + 未登录不可见

---

## 9. 领域八：架构重设计

### 方案（✅ 已确认）

**A. 后端**：service 层拆分，路由薄转发，API `/api/v1/`。

**B. 前端页面结构**：

| 组件 | 形态 | 路由/触发 |
|------|------|-----------|
| 首页/探索 | 合并 1 个页面 | `/` |
| 内容详情 | 弹窗 | 点击卡片弹出 |
| 登录/注册 | 合并 1 个弹窗 | 未登录自动弹出 |
| 设置 | 弹窗 | 头部菜单触发 |
| 用户主页 | 页面 | `/profile/:id` |

**C. 分享链接 = 临时权限**：
- 游客点链接 → 获得临时会话
- 可浏览全站、搜索查询
- 不可评分、评论、任何写操作
- 不是单独页面，是后端权限模式

> 决策 D25: 页面合并+弹窗化，分享链接为临时权限模式

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
