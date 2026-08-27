# ===== Stage 1: 构建前端 =====
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock* ./
RUN npm ci --prefer-offline
COPY frontend/ ./
RUN npm run build

# ===== Stage 2: 运行时 =====
FROM python:3.11-slim

# 安装 supervisord + nginx
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx supervisor curl && \
    rm -rf /var/lib/apt/lists/* && \
    rm -f /etc/nginx/sites-enabled/default

# 后端依赖（利用 Docker 缓存层）
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 复制后端代码
COPY backend/ ./

# 复制前端构建产物到 nginx 目录
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html

# 复制配置文件
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY deploy/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# 创建数据、日志和 Nginx 缓存目录；即使未挂载持久化缓存卷，镜像也能独立启动。
RUN mkdir -p /app/data /var/cache/nginx/moreani /var/log/nginx /var/log/app

EXPOSE 80 8000

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
