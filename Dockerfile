# ===== Stage 1: 构建前端 =====
# 使用多架构 manifest digest，避免同名基础标签被重新指向其他镜像。
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock* ./
RUN npm ci --prefer-offline
COPY frontend/ ./
RUN npm run build && npm run check:bundle

# ===== Stage 2: 运行时 =====
FROM python:3.12-slim-bookworm@sha256:782412e85d0f0984994c290652577d4018aff08145c85b262bb63dc0c7522254

ARG VCS_REF=unknown
LABEL org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.title="MoreAni"

# 安装 supervisord + nginx
RUN set -eux; \
    for attempt in 1 2 3 4 5; do \
      if apt-get update; then break; fi; \
      if [ "$attempt" -eq 5 ]; then exit 1; fi; \
      sleep $((attempt * 5)); \
    done; \
    for attempt in 1 2 3 4 5; do \
      if apt-get -o Acquire::Retries=3 install -y --no-install-recommends nginx supervisor curl; then break; fi; \
      if [ "$attempt" -eq 5 ]; then exit 1; fi; \
      sleep $((attempt * 5)); \
    done; \
    rm -rf /var/lib/apt/lists/* && \
    rm -f /etc/nginx/sites-enabled/default

# 后端依赖（利用 Docker 缓存层）
WORKDIR /app/backend
COPY backend/requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock

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
