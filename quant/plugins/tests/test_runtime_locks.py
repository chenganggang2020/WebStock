import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]


class RuntimeLocks(unittest.TestCase):
    def test_all_registry_pins_have_hashes_and_vcs_has_full_commits(self):
        recipes=json.loads((ROOT/'runtime/recipes.json').read_text(encoding='utf-8'))['recipes']
        self.assertEqual(len(recipes),16)
        normalize=lambda s:re.sub('[-_.]+','-',s).lower()
        for name,recipe in recipes.items():
            with self.subTest(recipe=name):
                original=(ROOT/'runtime'/recipe['requirements']).read_text(encoding='utf-8')
                expected={normalize(re.split(r'==| @ ',line)[0]) for line in original.splitlines() if line.strip() and not line.startswith('#') and 'git+' not in line}
                hashed=(ROOT/'runtime'/recipe['hashedRequirements']).read_text(encoding='utf-8')
                self.assertEqual(hashlib.sha256(hashed.encode('utf-8')).hexdigest(),recipe['hashedRequirementsSha256'])
                logical=hashed.replace('\\\n',' ').splitlines();observed=set()
                for line in logical:
                    if not line.strip() or line.startswith('#'):continue
                    self.assertRegex(line,r'--hash=sha256:[0-9a-f]{64}')
                    observed.add(normalize(re.split(r'==| @ ',line)[0]))
                self.assertEqual(observed,expected)
                for line in original.splitlines():
                    if 'git+' in line:self.assertRegex(line,r'git\+https://github.com/[^ ]+@[0-9a-f]{40}$')

    def test_changed_lock_rejected_before_runtime_creation(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);shutil.copyfile(ROOT/'setup_runtime.py',root/'setup_runtime.py')
            (root/'runtime').mkdir();recipes=json.loads((ROOT/'runtime/recipes.json').read_text(encoding='utf-8'))
            recipe=recipes['recipes']['data-tools'];recipes['recipes']={'data-tools':recipe}
            (root/'runtime/recipes.json').write_text(json.dumps(recipes),encoding='utf-8')
            shutil.copyfile(ROOT/'runtime'/recipe['requirements'],root/'runtime'/recipe['requirements'])
            original=(ROOT/'runtime'/recipe['hashedRequirements']).read_text(encoding='utf-8')
            (root/'runtime'/recipe['hashedRequirements']).write_text(original+'# changed\n',encoding='utf-8')
            dest=root/'must-not-exist'
            # Python is a harmless existing executable for --uv; hash validation
            # must reject before any external executable is launched.
            r=subprocess.run([sys.executable,'-X','utf8',str(root/'setup_runtime.py'),'--recipe','data-tools','--destination',str(dest),'--uv',sys.executable],capture_output=True,text=True,encoding='utf-8')
            self.assertNotEqual(r.returncode,0);self.assertIn('Hashed runtime requirements changed',r.stderr);self.assertFalse(dest.exists())


if __name__=='__main__':unittest.main()
