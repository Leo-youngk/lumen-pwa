import json
import shutil
import subprocess
from pathlib import Path

for script in ('patch-client.py', 'patch-worker.py'):
    subprocess.run(['python3', 'tools/' + script], check=True)

public = Path('public')
(public / 'assets').mkdir(parents=True, exist_ok=True)
for target, origin in {
    'index.html': 'built/index.html',
    'assets/lumen-editorial-v57.js': 'built/lumen-editorial-v57.js',
    'assets/lumen-features-v56.js': 'client/features.js',
    'assets/lumen-editorial-v57.css': 'client/redesign.css',
    'assets/lumen-orb-v56.svg': 'client/design-assets/lumen-orb.svg',
}.items():
    shutil.copyfile(origin, public / target)

sw = Path('base/sw.js').read_text().replace('lumen-shell-v21', 'lumen-shell-v57')
sw = sw.replace("key !== CACHE", "key.startsWith('lumen-shell-') && key !== CACHE")
(public / 'sw.js').write_text(sw)
manifest_path = public / 'manifest.webmanifest'
manifest = json.loads(manifest_path.read_text())
manifest['background_color'] = '#f7f5ee'
manifest['theme_color'] = '#f7f5ee'
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

subprocess.run(['node_modules/.bin/esbuild', 'worker/index.mjs', '--bundle', '--format=esm',
                '--platform=browser', '--minify', '--outfile=built/worker.mjs'], check=True)
