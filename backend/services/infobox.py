
def extract_episodes(infobox: list[dict]) -> int:
    for item in infobox:
        if item.get('key') == '话数':
            try:
                return int(item.get('value', '0'))
            except ValueError:
                pass
    return 0


def extract_status(infobox: list[dict]) -> str:
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
    return ''


def extract_air_date(infobox: list[dict]) -> str:
    for item in infobox:
        if item.get('key') == '放送开始':
            return item.get('value', '')
    return ''
