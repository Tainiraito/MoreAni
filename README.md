# MoreAni · 又看一集

> 一个小圈子的番剧评分站。看看朋友们在追什么，顺便决定今晚看哪部。

---

## 这是什么？

MoreAni 是给 5-10 人朋友小圈子用的内部工具。核心场景很简单：

- 朋友 A 看了一部番，打了 8 分，写了句「后半段封神」
- 你想知道他到底推荐不推荐，打开 MoreAni 一看便知
- 再也不用在群里问「最近有啥好看的」然后收获一堆沉默

它不是豆瓣，不是 MyAnimeList，不是给陌生人用的社交平台。它就是你和朋友们的一个小客厅，墙上贴着大家的观影笔记。

## 能做什么

**番剧管理**
- 从 Bangumi 一键导入番剧信息（封面、简介、标签、评分）
- 也支持手动添加，覆盖番剧、电影、游戏、书籍等类型
- 按季度、类型、标签浏览，搜索支持标题和标签

**评分与评论**
- 10 星半星精度评分（点击星星左半边 = x.5 分）
- 可以只打分不评论，也可以只评论不打分
- 朋友的评论以气泡列表展示，一眼看出谁说了什么

**双视图切换**
- **评论列表视图**（默认）：左边番剧信息，右边朋友评论瀑布流——适合「看看大家怎么说」
- **卡片网格视图**：封面大图 + 评分标签——适合「刷一刷有什么」

**个人空间**
- 我的评分、我的收藏、我的评论，按时间线展示
- 个人主页展示均分、评分数量、收藏数、评论数
- 支持头像上传和裁切

**智能推荐**
- 首页精选区随机推荐番剧，自动轮播
- 优先展示你评过分的内容，让你一眼看到自己的印记

**邀请制注册**
- 通过邀请码注册，适合小圈子使用
- 管理员可在后台管理用户和邀请码

## 在线体验

🔗 **[moreani.lovelysia.top](https://moreani.lovelysia.top)**

邀请码注册即可使用。如果你是这个小圈子的一员，找管理员要邀请码。

## 自己部署

MoreAni 是一个单容器应用（nginx + FastAPI），适合部署在 NAS、VPS 或任何有 Docker 的机器上。

### 环境要求

- Docker + Docker Compose
- 约 150MB 内存、200MB 磁盘
- SQLite，无需额外数据库服务

### 快速启动

```bash
# 1. 克隆仓库
git clone -b feat/v2-redesign https://github.com/Tainiraito/MoreAni.git
cd MoreAni

# 2. 创建配置文件
cp deploy/.env.example deploy/.env
# 编辑 deploy/.env，填入：
#   CF_TUNNEL_TOKEN（如果用 Cloudflare Tunnel）
#   SECRET_KEY（JWT 签名密钥，随机生成一个）

# 3. 构建并启动
docker compose -f deploy/docker-compose.yml up -d --build

# 4. 创建管理员
docker compose -f deploy/docker-compose.yml exec moreani-app \
  python3 scripts/manage_users.py init
```

启动后访问 `http://localhost:12555`。

### 环境变量

| 变量 | 必填 | 说明 |
|------|:----:|------|
| `SECRET_KEY` | ✅ | JWT 签名密钥，重启后不变否则所有登录失效 |
| `CF_TUNNEL_TOKEN` | — | Cloudflare Tunnel token，用于公网访问 |
| `ALLOWED_ORIGINS` | — | CORS 白名单，默认 `https://moreani.lovelysia.top` |
| `MOREANI_BANGUMI_PROXY` | — | Bangumi API 代理，格式 `http://host:port` |
| `DATABASE_URL` | — | 数据库路径，默认 `sqlite:////app/data/moreani.db` |

完整环境变量列表见 `deploy/docker-compose.yml`。

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui · Zustand |
| 后端 | Python FastAPI · SQLAlchemy 2.0 · SQLite |
| 部署 | Docker · supervisord · nginx · Cloudflare Tunnel |
| 数据源 | [Bangumi API](https://bangumi.github.io/api/) |

## 开发

```bash
# 后端
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8080

# 前端
cd frontend
npm install
npm run dev
```

前端默认 `http://localhost:5173`，API 通过 Vite 代理到后端 `8080`。

### 代码质量

```bash
# 后端
ruff check backend/
ruff format --check backend/

# 前端
cd frontend
npm run lint
npx tsc -b
npm run build
```

## 项目结构

```
MoreAni/
├── backend/                 # FastAPI 后端
│   ├── main.py              # 入口
│   ├── models.py            # SQLAlchemy 模型
│   ├── services/            # 业务逻辑
│   ├── routers/v1/          # API 路由（/api/v1/）
│   └── scripts/             # 管理脚本
├── frontend/                # React 前端
│   └── src/
│       ├── components/      # UI 组件
│       ├── pages/           # 页面
│       ├── stores/          # Zustand 状态
│       └── lib/             # 工具函数
├── deploy/                  # Docker 部署配置
├── docs/                    # 设计文档
└── AGENTS.md                # AI 协作规范
```

## 相关文档

- [`AGENTS.md`](AGENTS.md) — AI 助手协作指南（代码规范、Git 规范、分支策略）
- [`CHANGELOG.md`](CHANGELOG.md) — 版本更新记录
- [`docs/SECURITY.md`](docs/SECURITY.md) — 安全配置说明
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 系统架构

## License

MIT

---

*Made with ❤️ for anime lovers who share the joy of watching together.*
