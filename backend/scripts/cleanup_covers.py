#!/usr/bin/env python3
"""清理长期未使用的 Bangumi 封面资产。

默认 dry-run；确认输出无误后传入 ``--execute`` 才会删除文件和数据库记录。
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal  # noqa: E402
from services.covers import cleanup_orphan_cover_assets  # noqa: E402


def main() -> None:
    """Run an explicit cover cleanup operation."""
    parser = argparse.ArgumentParser(description='清理长期未使用的 Bangumi 封面资产')
    parser.add_argument('--execute', action='store_true', help='实际删除文件和数据库记录')
    parser.add_argument('--retention-days', type=int, default=None, help='覆盖默认保留天数')
    args = parser.parse_args()

    with SessionLocal() as db:
        result = cleanup_orphan_cover_assets(
            db,
            dry_run=not args.execute,
            retention_days=args.retention_days,
        )
    mode = '执行' if args.execute else '预览'
    print(f'[{mode}] 待处理封面: {result["count"]} 张，文件大小: {result["bytes"]} bytes')


if __name__ == '__main__':
    main()
