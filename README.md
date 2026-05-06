# MoreAni

大家的番剧评分网站。

记录看过的番，看看朋友的评价，解决「今天看什么」的难题。

## 技术栈

Vue 3 + TypeScript + Tailwind CSS + Element Plus（前端） · Python FastAPI + SQLite（后端）
JWT 认证 · Bangumi API 集成

## 快速开始

### 启动后端

```bash
cd backend
pip install -r requirements.txt --break-system-packages
python3 scripts/manage_codes.py init    # 首次初始化邀请码
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8080
```

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

---

*Made with ❤️ for anime lovers.*
