# MoreAni — 番剧评分网站 · 产品方案（V4.5 · 按需登录版）

---

## 一、产品定位

> 一个给朋友们用的番剧评分网站，大家可以给看过的番打分、写评论，所有评分在界面上展示出来。
> 也是一个「今天看什么」的补番决策工具。

- **目标用户**：你和你的一群朋友
- **核心价值**：记录看过的番 + 看看朋友的评价 + 解决「今天看什么」的难题

---

## 二、用户系统

| 功能 | 说明 |
|------|------|
| ✅ 浏览 | 无需登录即可浏览首页、番剧列表、评分汇总、朋友动态 |
| ✅ 注册 | 需要有效邀请码，在弹窗中完成 |
| ✅ 登录 | 用户名 + 密码，在弹窗中完成 |
| ✅ 评分/评论 | 需登录，未登录时弹窗提示 |
| ❌ 个人主页 | **不需要** |

### 邀请码

- 由「你」生成一批固定邀请码，分享给朋友
- 每个码可重复使用（多人共用同一个码）
- 通过 CLI 脚本管理（`python3 scripts/manage_codes.py init/add/list`）

---

## 三、首页结构

```
┌───────────────────────┬──────────────────────────────┐
│  🎲 今天看什么        │  👀 朋友在看啥                │
│                       │                              │
│  随机一部未评过的番    │  最新 5 条评分动态            │
│  封面 + 标题 + 简介   │  张三 → 命运石之门 🌟9 📊10  │
│  [换一个]  [去看看]   │  李四 → 东京喰种    🌟7 📊6  │
└───────────────────────┴──────────────────────────────┘

📺 番剧列表（Netflix 横向滚动卡片）
  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐
  │  │ │  │ │  │ │  │ │  │  ← 封面 + 标题 + 均分 + 人数
  └──┘ └──┘ └──┘ └──┘ └──┘

📊 评分汇总表
  ┌────────┬────┬────┬────┬──────────┐
  │ 番剧名 │均分│推荐│人数│ 最新短评  │
  ├────────┼────┼────┼────┼──────────┤
  │ 番剧A  │ 8.5│ 9.0│ 6  │ "神作！"  │
  │ 番剧B  │ 7.2│ 8.5│ 4  │ "治愈系"  │
  │ 番剧C  │ 6.8│ 6.0│ 3  │ "节奏慢"  │
  └────────┴────┴────┴────┴──────────┘

搜索/筛选：按名称搜索、按类型/季度筛选
```

### 🎲 今天看什么

- 从**用户未评分的番剧**中随机选一部，以大封面卡片展示
- 封面图全屏作为背景，叠加渐变遮罩（from-black/65 via-black/40 to-black/20）确保文字可读
- 点击「换一个」刷新推荐
- 点击卡片任意位置打开该番的弹窗
- 无封面时：粉紫渐变纯色背景降级

### 👀 大家在看啥

- 展示最新的 5 条评分动态
- 使用图标：StarFilled（分数）+ GoldMedal（推荐度）
- 有评价时用 `·` 分隔评分与评论
- 点击跳转到对应番剧的弹窗

### 🎬 番剧列表（评分汇总表）

- 表格形式展示所有番剧的评分汇总
- 列：番剧名 | ★均分 | 🏅推荐 | 人数 | 最新评价（tooltip 预览全文）
- 可按均分排序 / 按评分人数排序
- 可搜索番剧名
- 表头图标使用 Element Plus 图标（StarFilled / GoldMedal）
- 添加番剧按钮 + 搜索框 + 排序下拉高度统一（h-7）

---

## 四、番剧弹窗（替代独立详情页）

所有番剧的详细信息、评分操作和评分列表都在弹窗中完成。

### 弹窗内容

```
┌───────────────────────────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░░░░░░  ← 封面取色渐变背景    │
│                                                │
│  ┌──────┐                                      │
│  │ 封面 │  中文名 / 日文名                       │
│  │      │  状态：已完结 · 24集 · 2025年春         │
│  │      │  类型：科幻 · 悬疑 · 催泪               │
│  │      │  简介：xxxxxxxxxxxxxxxxxxxx             │
│  │      │  ✏️ 编辑番剧信息（仅登录可见）           │
│  └──────┘                                      │
│  ──────────────────────────────────             │
│  │ 我的评分（仅登录可见）                         │
│  │ 番剧评分 [1~10]    补番推荐度 [1~10]          │
│  │ 评论输入框（支持长评）                         │
│  │ [保存评分]                                   │
│  ──────────────────────────────────             │
│  │ 大家的评分                                    │
│  │ alice  ★9 🏅10                              │
│  │        第6部～10分！                          │
└───────────────────────────────────────────────┘
```

### 弹窗特性

| 功能 | 说明 |
|------|------|
| 🎨 智能主题色 | 弹窗背景从封面图 Canvas 提取主色生成渐变（提取色 12%/6% 极淡版，CORS 失败降级默认极淡渐变） |
| 📝 评分 | StarFilled 番剧评分 1~10 + GoldMedal 补番推荐度 1~10 |
| 💬 评论 | 支持长评（textarea 4 行，`whitespace-pre-wrap` 保留换行） |
| 👥 评分列表 | 展示所有用户的评分、推荐度、评论，用户名与评分之间 `ml-1` 间距 |
| ✏️ 编辑番剧 | 仅登录用户可见（`v-if="isLoggedIn"`） |
| 🔒 我的评分 | 仅登录用户可见，未登录时完全隐藏该模块 |
| 🚪 关闭弹窗 | 点击右上角 × 或点击弹窗外遮罩均可关闭 |
| ✅ 背景采点击 | 渐变背景 div 加 `pointer-events-none`，不拦截关闭按钮和内容点击 |

### 双维度评分说明

> **番剧评分** = 作品本身的质量评价
> **补番推荐度** = 现在值不值得补/追
>
> 一部番可能质量很高（9分），但不适合现在补（6分）
> 一部轻松番可能质量平平（7分），但随时可补（9分）

---

## 五、番剧管理

| 功能 | 说明 |
|------|------|
| ✅ 添加番剧 | 任何已登录用户都可添加新番 |
| ✅ 数据来源 | Bangumi API 搜索导入 或 手动填写 |
| ✅ 编辑番剧 | 任何已登录用户都可修改 |
| ❌ 独立管理后台 | 不需要，在弹窗/列表页直接操作 |

### Bangumi API 集成方案

#### 架构决策：后端代理

```
浏览器                        FastAPI                          Bangumi API
  │                             │                                 │
  │  POST /api/bangumi/search   │                                 │
  │ ──────────────────────────> │                                 │
  │                             │  POST /v0/search/subjects       │
  │                             │ ──────────────────────────────> │
  │                             │  ← {total, data[...]}         │
  │                             │                                 │
  │                             │  ① 清洗 & 映射数据               │
  │                             │  ② 可选缓存结果到本地 DB         │
  │                             │                                 │
  │  ← {animes: [...], total}  │                                 │
  │ <────────────────────────── │                                 │
```

**为什么选后端代理？** Bangumi v0 API 虽然允许 CORS（`access-control-allow-origin: *`），但后端代理能更好地控制限流、缓存、数据映射和降级。

#### 后端接口

**`POST /api/bangumi/search`** — 搜索番剧
```
请求: { keyword, type: 2, limit: 10, offset: 0 }
返回: {
  total: 5,
  animes: [{
    bgm_id, title_cn, title_jp, cover_url,
    rating, rank, tags, episodes, air_date, platform, summary
  }]
}
```

**`POST /api/bangumi/import/{bgm_id}`** — 导入番剧到本地（需登录）
```
功能：调用 Bangumi API 拉详情 → 映射到本地 Anime 表 → 存入 SQLite
返回：{ anime_id: 1, status: "created" | "already_exists" }
```

#### 数据映射

```
GET /v0/subjects/{id} → Anime 表字段映射

bgm_id    → resp["id"]
title_cn  → resp.get("name_cn") or resp["name"]
title_jp  → resp["name"]
cover_url → resp.get("images", {}).get("large", "")
tags      → [t["name"] for t in resp.get("tags", [])]
air_date  → resp.get("date", "")
platform  → resp.get("platform", "")       # TV / WEB / 剧场版
rating    → resp.get("rating", {}).get("score")
rank      → resp.get("rating", {}).get("rank")

搜索接口额外映射（POST /v0/search/subjects）：
eps       → episodes    # 话数（详情仍需 infobox 解析）
```

**两个特殊字段需额外处理：**

1. **简介 (summary)** — v0 不返回，需调旧版 API：
   `GET /subject/{id}?responseGroup=medium` → 取 `summary`
2. **话数、放送状态** — 藏在 `infobox` 数组里，需写解析器提取：
   ```
   [{"key": "话数", "value": "28"}, {"key": "放送开始", "value": "2023年9月29日"}, ...]
   ```

#### 前端「添加番剧」交互

```
┌─────────────────────────────────────┐
│  ➕ 添加番剧                          │
│                                      │
│  ┌──────────────────────────┐        │
│  │ 🔍 搜索 Bangumi...       │ ← 输   │
│  │  葬送的芙莉莲             │   入关 │
│  └──────────────────────────┘   键字 │
│                                      │
│  ▼ 搜索结果（实时）                    │
│  ┌──────────────────────────┐        │
│  │ 🖼️ 葬送的芙莉莲          │  ← 点  │
│  │    评分 8.5 · TV · 28集  │    击  │
│  ├──────────────────────────┤    选  │
│  │ 🖼️ 葬送的芙莉莲 第二季   │    中  │
│  │    评分 7.5 · TV · 28集  │        │
│  ├──────────────────────────┤        │
│  │ 🖼️ 葬送的芙莉莲 ～●●～   │        │
│  └──────────────────────────┘        │
│                                      │
│  ─── 或手动填写 ───                   │
│  [中文名]  [日文名]                   │
│  [封面URL] [话数] [放送日期]          │
│  [简介...]                            │
│  [标签]                               │
│                                      │
│  [确认添加]                           │
└─────────────────────────────────────┘
```

- 输入防抖 300ms
- 下拉结果悬浮在输入框下方
- 选中后自动填充全部字段，用户可微调
- 底部「手动填写」作为降级方案
- 关闭对话框后表单自动重置

#### 边界情况

| 情况 | 策略 |
|------|------|
| 🔞 NSFW 条目 | 请求加 `filter: { nsfw: false }`，默认排除 |
| 🔌 Bangumi 挂了 | 搜索结果展示「搜索暂不可用」，降级到手动填写 |
| 🏷️ 搜索无结果 | 提示「未找到，试试手动填写」 |
| ⏱️ 限流 | 后端加 rate limiter，502 时自动降级 |
| 🔄 重复导入 | 按 `bgm_id` 去重，已存在时返回现有记录 |

#### 后端代码结构

```
backend/
├── main.py              # FastAPI 入口 + CORS + 注册路由
├── database.py          # SQLAlchemy 引擎 & 会话
├── models.py            # 数据模型（User / InviteCode / Anime / Rating）
├── schemas.py           # Pydantic 请求/响应模型
├── auth.py              # JWT 签发/验证 + 密码哈希（SECRET_KEY 支持环境变量）
├── utils.py             # 共享工具函数（rating_to_schema 等）
├── routers/
│   ├── auth.py          # 注册 / 登录 / 当前用户
│   ├── animes.py        # 番剧 CRUD + 列表（JOIN 聚合）+ 随机推荐
│   ├── ratings.py       # 评分 Upsert + 最近动态
│   └── bangumi.py       # 搜索代理 + 导入（需登录）
├── services/
│   ├── bangumi.py       # Bangumi API 客户端（模块级共享 httpx 连接池 + User-Agent）
│   └── infobox.py       # infobox 解析器（话数/状态/放送日期）
└── scripts/
    └── manage_codes.py  # 邀请码管理 CLI
```

**需要的 Bangumi API 端点（全部免认证）：**

| 端点 | 用途 | 集成方式 |
|------|------|---------|
| `POST /v0/search/subjects` | 搜索番剧 | 后端代理 |
| `GET /v0/subjects/{id}` | 拉详情（评分/封面/标签/信息框） | 后端调用 |
| `GET /subject/{id}?responseGroup=medium` (旧版) | 拉简介 `summary` | 后端额外调用 |

---

## 六、数据模型

```
┌──────────────┐    ┌──────────────────┐    ┌──────────────┐
│    Anime     │    │     Rating       │    │    User      │
├──────────────┤    ├──────────────────┤    ├──────────────┤
│ id           │←──→│ anime_id         │    │ id           │
│ title_cn     │    │ user_id          │←──→│ username     │
│ title_jp     │    │ anime_score(1-10)│    │ password_hash│
│ cover_url    │    │ recommend(1-10)  │    │ created_at   │
│ description  │    │ review           │    └──────────────┘
│ episodes     │    │ created_at       │
│ status       │    │ updated_at       │    ┌──────────────┐
│ tags (JSON)  │    └──────────────────┘    │ InviteCode   │
│ season       │                            ├──────────────┤
│ air_date     │                            │ code         │
│ platform     │                            │ created_at   │
│ bgm_id       │                            └──────────────┘
│ created_by   │
│ created_at   │
│ updated_at   │
└──────────────┘

唯一约束：Rating (anime_id, user_id) 联合唯一，一个用户对一部番只有一条评分
索引：User.username, InviteCode.code, Anime.bgm_id, Rating(anime_id, user_id)
```

---

## 七、技术规范（延续 Gleamory）

| 项目 | 规范 |
|------|------|
| 框架 | Vue 3 + Vite + Tailwind CSS v3 + Element Plus |
| 路由 | vue-router（登录守卫 + 路由级懒加载） |
| 状态管理 | composables 单例模式（useAuth + useApi），不引入 Pinia |
| 语言 | TypeScript + Composition API `<script setup>` |
| 类型检查 | vue-tsc（构建时检查） |
| 规范 | ESLint（flat config）+ Prettier（无分号 / 单引号 / 100 宽） |
| 颜色 | 沿用 Gleamory 色板（primary-pink / primary-purple / 等） |
| 字体 | Source Han Serif CN（思源宋体，本地加载三字重） |
| 包管理 | npm |
| 命令 | `npm run dev` / `build` / `preview` / `lint` / `format` |
| 后端 | Python FastAPI + SQLAlchemy + SQLite |
| 认证 | JWT（python-jose + passlib[bcrypt]），30 天过期；未登录可浏览，操作时弹窗登录 |
| 部署 | 待定（NAS / 云服务器） |
| 域名 | moreani.lovelysia.top |

---

## 八、视觉设计

| 项目 | 说明 |
|------|------|
| ☀️ 主题 | 浅色主题优先 |
| 🌙 暗色 | CSS 变量预留色板（`[data-theme='dark']`），后续一键切换 |
| 🎨 风格 | 粉紫渐变 + 毛玻璃（延续 Gleamory） |
| 📱 响应式 | 移动端自适应（弹窗 95% 宽 / 桌面 600px） |
| 🎬 弹窗取色 | 封面图 Canvas 取主色 → 弹窗渐变背景（提取色 12%/6% 极淡版，CORS 失败降级默认极淡渐变） |
| 🎯 间距体系 | 微距 4px / 近距 8px / 中距 12px / 标准 16px / 大距 24px，Tailwind `gap-1/2/3/4/6` 对应 |
| 🔤 图标规范 | 全局替换 emoji 为 Element Plus 图标，icon+text 必须 `inline-flex items-center gap-1` |
| 📐 高度统一 | 自定义按钮加 `h-7` 对齐 Element Plus `size="small"`，`h-8` 对齐 default |
| 🖼️ Header 滚动 | 内置白色 overlay，`opacity` 过渡 0→0.82，scrollY > 60 触发 |
| 🚪 弹窗关闭 | 默认 `close-on-click-modal=true`（未设），渐变背景加 `pointer-events-none` |

---

## 九、MVP 最终功能总表

### 已确认纳入

| # | 功能 | 分类 | 状态 |
|:-:|:----|:----|:----:|
| 1 | 注册（邀请码） | 用户 | ✅ |
| 2 | 登录（用户名+密码） | 用户 | ✅ |
| 3 | 🎲 今天看什么（封面卡片） | 首页 | ✅ |
| 4 | 👀 大家在看啥（5条动态） | 首页 | ✅ |
| 5 | 🎬 番剧列表（表格+搜索+排序） | 首页 | ✅ |
| 6 | 📊 评分汇总表 | 首页 | ✅ |
| 7 | 搜索/排序 | 首页 | ✅ |
| 8 | 番剧弹窗（基本信息+评分+评论） | 弹窗 | ✅ |
| 9 | 🌟 番剧评分 1~10 | 评分 | ✅ |
| 10 | 🏅 补番推荐度 1~10 | 评分 | ✅ |
| 11 | 💬 文字评论（支持长评） | 评分 | ✅ |
| 12 | 🎨 智能主题色弹窗背景（淡色版） | 视觉 | ✅ |
| 13 | 添加番剧（Bangumi API / 手动） | 管理 | ✅ |
| 14 | 编辑番剧（所有注册用户，登录可见） | 管理 | ✅ |
| 15 | ☀️ 浅色主题 + 粉紫渐变 + 毛玻璃 | 视觉 | ✅ |
| 16 | 📱 移动端响应式 | 视觉 | ✅ |
| 17 | 🗂️ CSS 变量 + Tailwind 色板系统 | 视觉 | ✅ |
| 18 | 🎯 统一间距体系（4/8/12/16/24px） | 规范 | ✅ |
| 19 | 🔤 全局 emoji→Element Plus 图标替换 | 规范 | ✅ |
| 20 | 🔲 图标+文字 flex 对齐规范 | 规范 | ✅ |
| 21 | 📐 按钮与输入框高度统一 | 规范 | ✅ |
| 22 | 🖼️ Header 滚动渐显 overlay | 视觉 | ✅ |
| 23 | 🚪 弹窗点击外部关闭 | UX | ✅ |
| 24 | 🔒 未登录隐藏编辑/评分模块 | UX | ✅ |

### 后续迭代箱

| # | 功能 | 优先级 |
|:-:|:----|:------:|
| 📦 | 品味契合度 | 中 |
| 📦 | 评分分布图 | 低 |
| 📦 | 看番足迹 | 低 |
| 📦 | 一句话日记 | 待定 |
| 📦 | 待补清单 | 待定 |
| 📦 | 补番路线图 | 待定 |
| 📦 | 季节推荐 | 待定 |
| 📦 | 番剧 BINGO | 待定 |
| 📦 | 分享卡片 | 待定 |

### 已淘汰

| # | 功能 | 原因 |
|:-:|:----|:-----|
| ❌ | 个人主页 | 不需要 |
| ❌ | 独立管理后台 | 不需要 |
| ❌ | 争议之番 | 不需要 |
| ❌ | 自定义标签 | 不需要 |

---

## 十、变更记录

| 版本 | 日期 | 变更 |
|:----:|:----:|:-----|
| V4 → V4.1 | 2026-05-05 | Bangumi API 集成方案：补充架构决策（后端代理）、后端接口设计、数据映射细节、前端交互流程、边界情况处理；实际测试确认三个端点全部可用且免认证 |
| V4.1 → V4.2 | 2026-05-05 | MVP 实现完成：<br>• 邀请码改为固定码可重复使用，CLI 脚本管理<br>• 认证方案确认为 JWT（python-jose + passlib）<br>• 状态管理采用 composables 单例，不引入 Pinia<br>• 番剧列表改为 JOIN + 聚合查询（消除 N+1）<br>• Bangumi import 添加认证依赖<br>• Canvas 取色增加 CORS 降级策略<br>• 前端表单增加验证逻辑<br>• 前端对话框关闭后自动重置表单 |
| V4.2 → V4.3 | 2026-05-06 | 两轮 Code Review 修正：<br>• SECRET_KEY 移除硬编码 fallback，未设置时生成随机密钥并警告<br>• 前端 `bg-bg-page` 添加到 Tailwind 色板<br>• Bangumi API 添加 User-Agent 请求头<br>• httpx 客户端改为模块级共享连接池<br>• 重复 `rating_to_schema` 抽取到 `utils.py`<br>• `setTimeout` 添加 `onUnmounted` 清理（HomeView / AddAnimeDialog）<br>• 首页添加 `loading` 加载状态，避免初始闪现空状态<br>• 图片加载失败改为 `opacity:0`（保留占位，不塌陷布局）<br>• 弹窗宽度从 `computed` 改为 `ref` + `resize` 事件监听 |
| V4.3 → V4.4 | 2026-05-06 | 第三轮 Code Review 修正：<br>• AnimeDetailModal 图片错误处理遗漏修复（`display:none` → `opacity:0`）<br>• AddAnimeDialog 合并重复 `onUnmounted`<br>• 首页 `loading` 状态接入模板（加载中 → 空状态分层显示） |
|| V4.4 → V4.5 | 2026-05-06 | 按需登录重构：<br>• 浏览番剧列表/详情/汇总/动态不再需要登录<br>• 登录/注册改为弹窗形式（AuthDialog），支持标签切换<br>• 评分/评论操作时若未登录，弹窗提示并引导登录<br>• 后端 random / detail 接口改为可选认证（`get_optional_user`）<br>• 删除独立 LoginView / RegisterView 页面，旧路由重定向到首页<br>• 导航栏：未登录显示「登录」按钮，已登录保持用户名 + 退出 |
|| V4.5 → V5.0 | 2026-05-06 | UI 设计系统与规范落地：<br>• **封面卡片**：封面图为全屏背景 + 渐变遮罩，Gleamory 风格<br>• **命名统一**：「朋友」→「大家」（大家在看啥 / 大家的评分）<br>• **图标系统**：全局 emoji 替换为 Element Plus 图标（StarFilled / GoldMedal / ChatDotRound / EditPen / Search 等）<br>• **图标对齐**：所有 icon+text 使用 `inline-flex items-center gap-1` 保证基线对齐<br>• **标题装饰**：板块标题前加粉紫渐变竖线（`w-0.5 h-4 bg-gradient-to-b from-primary-pink to-primary-purple`），间距 `gap-1`<br>• **页面间距**：统一间距体系（微距 4px / 近距 8px / 中距 12px / 标准 16px / 大距 24px）<br>• **高度统一**：按钮加 `h-7` 与 Element Plus `size="small"` 输入框对齐<br>• **Header 滚动**：采用 overlay opacity 过渡方案，IntersectionObserver 触发，滚动 >60px 渐显白色 overlay 至 82%<br>• **弹窗优化**：移除 `close-on-click-modal=false` 允许点击外部关闭；渐变背景加 `pointer-events-none` 修复关闭按钮被拦截；移除 `-m-6` 消除渐变边框<br>• **封面背景淡化**：提取色从 30%→12%，默认渐变改为极淡版<br>• **长评支持**：评论框 2→4 行，`whitespace-pre-wrap` 保留换行<br>• **隐藏未登录内容**：编辑按钮 + 我的评分模块 `v-if="isLoggedIn"`，未登录完全隐藏<br>• **弹窗装饰条**：我的评分 / 大家的评分 标题加渐变竖线 + 图标<br>• **Bangumi 封面更新**：通过 Bangumi 搜索 API 重新匹配并写入正确 bgm_id 和 cover_url |
