# MoreAni

大家的番剧评分网站 — 记录看过的番 + 看看大家的评价 + 解决「今天看什么」的难题。

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | Vue 3 + Vite + TypeScript + Tailwind CSS v3 + Element Plus |
| 后端 | Python FastAPI + SQLAlchemy + SQLite |
| 认证 | JWT (python-jose + passlib) |
| 外部 API | Bangumi (bgm.tv) — 搜索/导入番剧信息 |

## 快速开始

### 1. 启动后端

```bash
cd backend

# 安装依赖
pip install -r requirements.txt --break-system-packages

# （生产环境）设置密钥
export SECRET_KEY=*** -c 'import secrets; print(secrets.token_hex(32))')

# 初始化邀请码（只需一次）
python3 scripts/manage_codes.py init

# 启动 API 服务器
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8080
```

### 2. 启动前端

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器（自动代理 /api → localhost:8080）
npm run dev
```

### 3. 打开浏览器

访问 `http://localhost:5173`，使用以下邀请码注册：

| 邀请码 |
|--------|
| `MOREANI2026` |
| `ANIME-FRIEND` |
| `BANGUMI-FAN` |

## 测试账号

| 用户名 | 密码 | 角色 |
|:------|:-----|:-----|
| alice | test123 | 资深宅，长评为主 |
| bob | test123 | 普通观众，简评为主 |
| carol | test123 | 挑剔型，偶尔长评 |
| david | test123 | 技术向，关注制作 |
| erika | test123 | 热情休闲型 |
| felix | test123 | 分析型，结构化评分 |

## 项目结构

```
MoreAni/
├── frontend/                  # Vue 3 前端
│   ├── src/
│   │   ├── components/        # 组件
│   │   │   ├── anime/         # 番剧弹窗 / 添加对话框
│   │   │   ├── auth/          # 登录/注册弹窗
│   │   │   ├── RatingsHistoryDialog.vue  # 个人评分历史
│   │   │   └── EmptyState.vue # 空状态占位
│   │   ├── composables/       # useAuth / useApi
│   │   ├── router/            # vue-router 配置
│   │   ├── views/             # 页面（首页）
│   │   ├── types/             # TypeScript 类型
│   │   └── assets/fonts/      # 思源宋体
│   └── [config files]         # Vite / Tailwind / ESLint / Prettier
│
├── backend/                   # FastAPI 后端
│   ├── main.py                # 应用入口
│   ├── models.py              # 数据模型
│   ├── schemas.py             # Pydantic 模型
│   ├── auth.py                # JWT + 密码
│   ├── routers/               # API 路由
│   ├── services/              # Bangumi 客户端 / infobox 解析
│   └── scripts/               # 邀请码管理
│
└── product-design.md          # 产品设计文档
```

## 常用命令

```bash
# 前端
cd frontend
npm run dev         # 开发服务器
npm run build       # 生产构建
npm run typecheck   # 类型检查
npm run lint        # 代码检查
npm run format      # 代码格式化

# 后端
cd backend
python3 scripts/manage_codes.py list           # 查看邀请码
python3 scripts/manage_codes.py add CODE1 CODE2 # 添加邀请码
python3 scripts/seed_users.py                  # 测试用户数据（可选）
```

## API 端点

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|:--:|
| `POST` | `/api/auth/register` | 注册 | - |
| `POST` | `/api/auth/login` | 登录 | - |
| `GET` | `/api/auth/me` | 当前用户 | ✅ |
| `GET` | `/api/animes` | 番剧列表（搜索/筛选/排序/分页） | - |
| `GET` | `/api/animes/{id}` | 番剧详情 + 评分列表（含 `my_rating`） | - |
| `POST` | `/api/animes` | 添加番剧 | ✅ |
| `PUT` | `/api/animes/{id}` | 编辑番剧 | ✅ |
| `DELETE` | `/api/animes/{id}` | 删除番剧 | ✅ |
| `GET` | `/api/animes/random` | 随机推荐番剧 | - |
| `POST` | `/api/bangumi/search` | Bangumi 搜索 | - |
| `GET` | `/api/bangumi/detail/{bgm_id}` | Bangumi 番剧详情 | - |
| `POST` | `/api/ratings` | 创建/更新评分 | ✅ |
| `GET` | `/api/ratings/recent` | 最近评分动态 | - |
| `GET` | `/api/ratings` | 当前用户的评分历史 | ✅ |

## 设计文档

完整产品设计见 [product-design.md](./product-design.md)。
