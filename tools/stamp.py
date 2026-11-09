#!/usr/bin/env python3
"""Stamp a new version on the site so phones load the newest files right away.

Run before every commit/push:   python3 tools/stamp.py
- adds ?v=<version> to local .js/.css/.webmanifest links in the HTML pages
- writes version.json (update.js compares it and reloads stale pages once)
- renames the service worker cache so installed apps refresh too
"""
import re, json, time, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
v = time.strftime('%Y%m%d%H%M%S', time.gmtime())
for page in ('index.html', 'admin.html', 'scanner.html', 'scoreboard.html', 'scorer.html', 'overlay.html', 'overlay-maker.html', 'mlbb-register.html', 'scene.html'):
    p = root / page
    s = p.read_text()
    s = re.sub(r'((?:src|href)=")((?!https?:)[\w./-]+\.(?:js|css|webmanifest))(?:\?v=\w+)?"', rf'\1\2?v={v}"', s)
    if 'name="app-version"' in s:
        s = re.sub(r'<meta name="app-version" content="\w*">', f'<meta name="app-version" content="{v}">', s)
    else:
        s = s.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n  <meta name="app-version" content="{v}">', 1)
    p.write_text(s)
(root / 'version.json').write_text(json.dumps({'v': v}) + '\n')
sw = root / 'sw.js'
sw.write_text(re.sub(r"const CACHE = '[^']*';", f"const CACHE = 'ssc-apps-{v}';", sw.read_text()))
print('version', v)
