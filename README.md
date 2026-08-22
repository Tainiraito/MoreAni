# MoreAni

大家的番剧评分网站。

记录看过的番，看看朋友的评价，解决「今天看什么」的难题。

## 技术栈

React 19 + TypeScript + Tailwind CSS v4（前端） · Python FastAPI + SQLite（后端）
JWT 认证 · Bangumi API 集成 · 图片代理（绕过 CORP 限制）

## 快速开始

### 启动后端

```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8080
```

首次创建管理员前，需在当前终端安全输入至少 12 位的初始化密码：

```bash
cd backend
read -rsp '初始化管理员密码: ' MOREANI_BOOTSTRAP_ADMIN_PASSWORD
echo
export MOREANI_BOOTSTRAP_ADMIN_PASSWORD
python scripts/manage_users.py init
unset MOREANI_BOOTSTRAP_ADMIN_PASSWORD
```

脚本对已存在的管理员会幂等跳过。真实密码不得写入 `.env.example`、部署文档、镜像构建参数或仓库。

### 启动前端

```bash
cd frontend
npm install
npm run dev
```

访问 `http://localhost:5173`。

### 生产构建

```bash
cd frontend
npm run build     # 产物在 frontend/dist/
```

### 质量检查

```bash
backend/venv/bin/ruff check backend
backend/venv/bin/ruff format --check backend
backend/venv/bin/pytest backend/tests

cd frontend
npm run lint
npm run typecheck
npm test
npm run build
```

## 权限边界与已接受风险

- 公开内容详情继续允许匿名读取；私有内容详情 JSON 仅创建者、管理员和超级管理员可读，其他请求统一返回 404。
- 本轮不实现分享链接与游客会话模型。
- `/api/covers/{id}` 本地封面和公开评分接口暂不根据内容私有状态鉴权；这意味着知道封面地址或内容 ID 的访问者仍可能取得相关静态资源或评分信息。该项为本轮明确接受的剩余风险。

## 公网安全基线

- 生产 CORS 默认仅允许 `https://moreani.lovelysia.top`，本地开发来源通过 `ALLOWED_ORIGINS` 单独配置。
- 登录、注册、写入和读取接口分别使用分级限流；登录失败达到阈值时只冻结当前账号标识与 IP 的组合。
- 生产部署使用单个 Uvicorn worker，以保证 SQLite 和进程内限流状态一致。
- 详细阈值、代理信任和安全响应头说明见 [`docs/SECURITY.md`](docs/SECURITY.md)。

---

*Made with ❤️ for anime lovers.*
