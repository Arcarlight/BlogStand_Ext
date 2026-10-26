"""一次性迁移：把「写死的说话人名字」升级成「角色表」。

之前每一段都自带 speaker.name/color，改个名字要改十几处。
现在 data.characters 里放角色（名字 / 种族编号 / 颜色 / 头像），
段落里只写 {"speaker": {"char": "shinx"}}。

顺带写入 meta.colors：
  · name  角色名字可以选的几种颜色
  · emph  正文强调色 1..4（正面 / 普通 / 种族和地名 / 组织名）

幂等：已经有 characters 就跳过。
用法：python tools/migrate-characters.py
"""
import io
import json
import os
import shutil
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORY = os.path.join(ROOT, 'data', 'chapters.json')
BACKUP = os.path.join(ROOT, 'tools', 'backup')

NAME_COLORS = ['#f2f221', '#11f3ef', '#008f00', '#efa9ec']
EMPH = {
    '1': {'label': '正面强调', 'color': '#f4f824'},
    '2': {'label': '普通强调', 'color': '#00cdd0'},
    '3': {'label': '种族和地名强调', 'color': '#008f00'},
    '4': {'label': '组织名强调', 'color': '#efa9ec'},
}

# 已知的：名字 -> (id, 种族编号, 头像)
KNOWN = {
    'コリンク': ('shinx', 403, 'assets/img/portrait/0403-normal.png'),
    'リオル': ('riolu', 447, 'assets/img/portrait/0447-normal.png'),
}


def main():
    with io.open(STORY, encoding='utf-8') as f:
        story = json.load(f)

    if story.get('characters'):
        print('已经有 characters 了，跳过')
        return

    os.makedirs(BACKUP, exist_ok=True)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    shutil.copy2(STORY, os.path.join(BACKUP, 'chapters-before-characters-%s.json' % stamp))

    meta = story.setdefault('meta', {})
    meta['colors'] = {'name': NAME_COLORS, 'emph': EMPH}

    chars = []
    by_name = {}

    def ensure(jp, en, color):
        key = jp or en
        if not key:
            return None
        if key in by_name:
            return by_name[key]
        kid, species, portrait = KNOWN.get(jp, (None, None, None))
        kid = kid or ('c%d' % (len(chars) + 1))
        c = {'id': kid, 'name': {'jp': jp, 'en': en}, 'color': color or NAME_COLORS[len(chars) % len(NAME_COLORS)]}
        if species:
            c['species'] = species
        if portrait:
            c['portrait'] = portrait
        if species:
            c['portrait'] = 'assets/img/portrait/%04d-normal.png' % species
        chars.append(c)
        by_name[key] = kid
        return kid

    for ch in story['chapters']:
        for b in ch['blocks']:
            sp = b.get('speaker') or {}
            nm = sp.get('name') or {}
            jp, en = nm.get('jp', ''), nm.get('en', '')
            if jp or en:
                kid = ensure(jp, en, sp.get('color'))
                b['speaker'] = {'char': kid}
            else:
                b.pop('speaker', None)      # 旁白

    story['characters'] = chars
    with io.open(STORY, 'w', encoding='utf-8') as f:
        json.dump(story, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print('角色 %d 个：%s' % (len(chars), ', '.join(c['name']['jp'] + '#' + str(c.get('species', '?')) for c in chars)))
    print('备份：tools/backup/chapters-before-characters-%s.json' % stamp)


if __name__ == '__main__':
    main()
