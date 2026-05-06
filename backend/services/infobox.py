
def extract_episodes(infobox: list[dict]) -> int:
    for item in infobox:
        if item.get('key') == '话数':
            try:
                return int(item.get('value', '0'))
            except ValueError:
                pass
    return 0


def extract_status(infobox: list[dict]) -> str:
    # 优先：显式的状态字段
    for item in infobox:
        key = item.get('key', '')
        if key in ('放送状态', '播放状态'):
            value = item.get('value', '')
            if '完结' in value:
                return '已完结'
            elif '放送' in value or '连载' in value:
                return '连载中'
            elif '未' in value or '预定' in value or '予定' in value:
                return '未开播'
    # 兜底：从 放送开始/播放结束 推导
    has_start = False
    has_end = False
    for item in infobox:
        key = item.get('key', '')
        if key == '放送开始':
            has_start = True
        elif key == '播放结束':
            has_end = True
    if has_end:
        return '已完结'
    elif has_start:
        return '连载中'
    return ''


def extract_air_date(infobox: list[dict]) -> str:
    for item in infobox:
        if item.get('key') == '放送开始':
            return item.get('value', '')
    return ''


def extract_season(infobox: list[dict]) -> str:
    # 优先：显式的季度字段
    for item in infobox:
        key = item.get('key', '')
        if key in ('放送季度', '季度', '放送期'):
            return item.get('value', '')
    # 兜底：从 放送开始 日期推导季度
    import re
    for item in infobox:
        if item.get('key') == '放送开始':
            date_str = item.get('value', '')
            m = re.search(r'(\d{4})年(\d{1,2})月', date_str)
            if m:
                year = m.group(1)
                month = int(m.group(2))
                if 1 <= month <= 3:
                    season = '冬'
                elif 4 <= month <= 6:
                    season = '春'
                elif 7 <= month <= 9:
                    season = '夏'
                else:
                    season = '秋'
                return f'{year}年{season}'
    return ''
