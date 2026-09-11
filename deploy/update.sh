#!/usr/bin/env bash
# MoreAni NAS 更新脚本。
# 镜像必须先在构建机执行 deploy/build-image.sh 构建、导出并在 NAS docker load。
# 用法: MOREANI_IMAGE_TAG=<完整Git SHA> ./deploy/update.sh [分支名]

set -Eeuo pipefail

BRANCH="${1:-main}"
PROJECT_DIR="${MOREANI_PROJECT_DIR:-/vol2/1000/Docker/MoreAni}"
COMPOSE_FILE="deploy/docker-compose.yml"
ENV_FILE="deploy/.env"
LOG_FILE="${MOREANI_UPDATE_LOG_FILE:-$PROJECT_DIR/logs/app/update.log}"

cd "$PROJECT_DIR"
mkdir -p "$(dirname "$LOG_FILE")"

log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"
}

compose() {
    MOREANI_IMAGE_TAG="$IMAGE_TAG" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

health_check() {
    local attempt
    for attempt in $(seq 1 30); do
        if docker exec moreani-app sh -c 'env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY curl -sf http://localhost:80/api/health' >/dev/null 2>&1 \
            && curl -fsS --max-time 5 http://127.0.0.1:12555/api/health >/dev/null 2>&1; then
            return 0
        fi
        sleep 2
    done
    return 1
}

verify_database() {
    if [ ! -f "$PROJECT_DIR/data/moreani.db" ]; then
        log '数据库不存在，跳过完整性检查（首次初始化）'
        return 0
    fi

    if docker ps --format '{{.Names}}' | grep -qx 'moreani-app'; then
        docker exec moreani-app python -c \
            "import sqlite3,sys; c=sqlite3.connect('/app/data/moreani.db'); r=c.execute('PRAGMA integrity_check').fetchone()[0]; c.close(); print(r); sys.exit(0 if r == 'ok' else 1)" \
            | tee -a "$LOG_FILE" | grep -qx 'ok'
        return
    fi

    log '应用容器未运行，使用待发布镜像的临时只读容器检查数据库'
    docker run --rm --read-only \
        --mount "type=bind,src=$PROJECT_DIR/data,dst=/app/data,readonly" \
        --entrypoint python "$IMAGE" -c \
        "import sqlite3,sys; c=sqlite3.connect('file:/app/data/moreani.db?mode=ro', uri=True); r=c.execute('PRAGMA integrity_check').fetchone()[0]; c.close(); print(r); sys.exit(0 if r == 'ok' else 1)" \
        | tee -a "$LOG_FILE" | grep -qx 'ok'
}

backup_database() {
    local backup_name="$1"
    local backup_path="$PROJECT_DIR/data/backups/$backup_name"
    mkdir -p "$PROJECT_DIR/data/backups" "$PROJECT_DIR/data/avatars"

    if [ ! -f "$PROJECT_DIR/data/moreani.db" ]; then
        log '数据库不存在，跳过备份（首次初始化）'
        return 0
    fi

    # 使用 SQLite online backup API，避免直接复制活动数据库时漏掉事务状态。
    if docker ps --format '{{.Names}}' | grep -qx 'moreani-app'; then
        docker exec moreani-app python -c \
            "import sqlite3; source=sqlite3.connect('/app/data/moreani.db'); target=sqlite3.connect('/app/data/backups/$backup_name'); source.backup(target); target.close(); source.close()"
    else
        cp "$PROJECT_DIR/data/moreani.db" "$backup_path"
    fi
    test -s "$backup_path"
    log "数据库备份完成: $backup_path"
}

rollback() {
    if [ -z "$PREVIOUS_TAG" ]; then
        log '没有可用的上一版镜像，无法自动回滚；保留当前数据库备份供人工处理'
        return 1
    fi
    if ! docker image inspect "moreani-app:$PREVIOUS_TAG" >/dev/null 2>&1; then
        log "上一版镜像不存在: moreani-app:$PREVIOUS_TAG"
        return 1
    fi

    log "开始回滚到镜像: moreani-app:$PREVIOUS_TAG"
    IMAGE_TAG="$PREVIOUS_TAG" compose up -d --force-recreate 2>&1 | tee -a "$LOG_FILE"
    if health_check; then
        log '应用镜像回滚成功；未自动覆盖数据库，避免丢失回滚期间的新写入'
        return 0
    fi
    log '应用镜像回滚后的健康检查仍失败'
    return 1
}

log "开始更新 MoreAni (branch: $BRANCH)"

CURRENT_IMAGE_REF="$(docker inspect --format '{{.Config.Image}}' moreani-app 2>/dev/null || true)"
PREVIOUS_TAG=''
if [[ "$CURRENT_IMAGE_REF" == moreani-app:* ]]; then
    PREVIOUS_TAG="${CURRENT_IMAGE_REF#moreani-app:}"
fi

log '拉取代码...'
git fetch origin "$BRANCH"
BEFORE="$(git rev-parse HEAD)"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
AFTER="$(git rev-parse HEAD)"

IMAGE_TAG="${MOREANI_IMAGE_TAG:-$AFTER}"
if [[ ! "$IMAGE_TAG" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
    log "非法镜像标签: $IMAGE_TAG"
    exit 1
fi

if [ "$BEFORE" = "$AFTER" ] && [ "$CURRENT_IMAGE_REF" = "moreani-app:$IMAGE_TAG" ]; then
    log '代码和运行镜像均无变化，跳过部署'
    exit 0
fi

IMAGE="moreani-app:$IMAGE_TAG"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    log "缺少预构建镜像: $IMAGE；请先执行 docker load"
    exit 1
fi

IMAGE_REVISION="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE" 2>/dev/null || true)"
if [ "$IMAGE_REVISION" != "$AFTER" ]; then
    log "镜像提交不匹配: image=$IMAGE_REVISION git=$AFTER"
    exit 1
fi

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
log "发布镜像: $IMAGE"
verify_database
backup_database "moreani.db.$TIMESTAMP"
find "$PROJECT_DIR/data/backups" -name 'moreani.db.*' -mtime +14 -delete 2>/dev/null || true

log '切换容器...'
if ! compose up -d --force-recreate 2>&1 | tee -a "$LOG_FILE"; then
    log 'Compose 切换失败，尝试回滚'
    rollback || true
    exit 1
fi

log '执行容器内和宿主机端口健康检查...'
if ! health_check; then
    log '健康检查失败，尝试回滚'
    rollback || true
    exit 1
fi

log '更新完成 ✅'
