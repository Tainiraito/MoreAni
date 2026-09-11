#!/usr/bin/env bash
# 在可访问 Docker Hub 的构建机上构建并导出 MoreAni 发布镜像。
# 用法: ./deploy/build-image.sh [镜像标签] [导出目录]

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VCS_REF="$(git -C "$ROOT_DIR" rev-parse HEAD)"

if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
  echo '工作区存在未提交修改，拒绝构建发布镜像；请先提交后再构建。' >&2
  exit 1
fi

# 默认使用完整提交 SHA，与 deploy/update.sh 和生产 .env 的约定一致。
IMAGE_TAG="${1:-$VCS_REF}"
OUTPUT_DIR="${2:-/tmp/moreani-release}"
IMAGE="moreani-app:${IMAGE_TAG}"

mkdir -p "$OUTPUT_DIR"
cd "$ROOT_DIR"

docker build \
  --build-arg "VCS_REF=$VCS_REF" \
  --tag "$IMAGE" \
  .

docker image inspect "$IMAGE" >/dev/null
ARCHIVE="$OUTPUT_DIR/moreani-app-${IMAGE_TAG}.tar.gz"
docker save "$IMAGE" | gzip -c > "$ARCHIVE"
sha256sum "$ARCHIVE" > "$ARCHIVE.sha256"

echo "镜像: $IMAGE"
echo "提交: $VCS_REF"
echo "产物: $ARCHIVE"
echo "校验: $ARCHIVE.sha256"
