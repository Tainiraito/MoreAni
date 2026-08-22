#!/bin/bash
# MoreAni 自动更新脚本
# 用法: ./update.sh [分支名]
# 示例: ./update.sh main
#        ./update.sh dev

set -e

BRANCH="${1:-main}"
PROJECT_DIR="/vol2/1000/Docker/MoreAni"
COMPOSE_FILE="deploy/docker-compose.yml"
ENV_FILE="deploy/.env"
LOG_FILE="/vol2/1000/Docker/MoreAni/logs/app/update.log"

cd "$PROJECT_DIR"

echo "========================================" | tee -a "$LOG_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始更新 MoreAni (branch: $BRANCH)" | tee -a "$LOG_FILE"

# 1. 拉取最新代码
echo "[1/4] 拉取代码..." | tee -a "$LOG_FILE"
git fetch origin "$BRANCH"
BEFORE=$(git rev-parse HEAD)
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
    echo "  → 代码无变化，跳过构建" | tee -a "$LOG_FILE"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] 更新完成（无变化）" | tee -a "$LOG_FILE"
    exit 0
fi

echo "  → $BEFORE → $AFTER" | tee -a "$LOG_FILE"

# 2. 备份数据库
echo "[2/4] 备份数据库..." | tee -a "$LOG_FILE"
BACKUP_DIR="$PROJECT_DIR/data/backups"
mkdir -p "$BACKUP_DIR"
mkdir -p "$PROJECT_DIR/data/avatars"
cp "$PROJECT_DIR/data/moreani.db" "$BACKUP_DIR/moreani.db.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || echo "  → 数据库不存在，跳过备份" | tee -a "$LOG_FILE"

# 清理 7 天前的备份
find "$BACKUP_DIR" -name "moreani.db.*" -mtime +7 -delete 2>/dev/null
echo "  → 备份完成" | tee -a "$LOG_FILE"

# 3. 重新构建并部署
echo "[3/4] 构建并部署..." | tee -a "$LOG_FILE"
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --force-recreate 2>&1 | tee -a "$LOG_FILE"

# 4. 健康检查
echo "[4/4] 健康检查..." | tee -a "$LOG_FILE"
sleep 5
if docker exec moreani-app sh -c 'env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY curl -sf http://localhost:80/api/health' > /dev/null 2>&1; then
    echo "  → ✅ 服务正常" | tee -a "$LOG_FILE"
else
    echo "  → ❌ 健康检查失败，查看日志: docker compose --env-file $ENV_FILE -f $COMPOSE_FILE logs" | tee -a "$LOG_FILE"
    exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 更新完成 ✅" | tee -a "$LOG_FILE"
echo "========================================" | tee -a "$LOG_FILE"
