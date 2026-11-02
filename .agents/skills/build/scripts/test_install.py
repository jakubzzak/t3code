import importlib.util
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('install',str(Path(__file__).with_name('install.py')))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class InstallationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.home=self.root/'home';self.source=self.root/'source'
        for name in m.NAMES:
            (self.source/name).mkdir(parents=True);(self.source/name/'SKILL.md').write_text(name)
    def tearDown(self):self.tmp.cleanup()
    def test_all_providers_share_one_source(self):
        m.install(self.home,self.source)
        for provider in ('.agents','.codex','.claude'):
            for name in m.NAMES:self.assertEqual((self.home/provider/'skills'/name).resolve(),(self.source/name).resolve())
    def test_rerun_is_noop(self):
        m.install(self.home,self.source)
        self.assertFalse(m.install(self.home,self.source)['changed'])
    def test_retire_preserves_symlink_target(self):
        root=self.home/'.agents/skills';root.mkdir(parents=True)
        old=self.root/'old';old.mkdir();(old/'SKILL.md').write_text('original')
        (root/'testit').symlink_to(old)
        result=m.install(self.home,self.source,True)
        self.assertFalse((root/'testit').exists())
        self.assertTrue((Path(result['backup'])/'.agents/skills/testit').is_symlink())
        self.assertEqual((old/'SKILL.md').read_text(),'original')
    def test_conflicting_new_directory_aborts_before_any_link(self):
        conflict=self.home/'.agents/skills/build';conflict.mkdir(parents=True)
        (conflict/'custom').write_text('preserved')
        with self.assertRaises(ValueError):m.install(self.home,self.source)
        self.assertFalse((self.home/'.agents/skills/shape').exists())
        self.assertEqual((conflict/'custom').read_text(),'preserved')
    def test_default_does_not_retire_legacy(self):
        old=self.home/'.claude/skills/reviewit';old.mkdir(parents=True)
        m.install(self.home,self.source)
        self.assertTrue(old.is_dir())
    def test_missing_source_has_no_side_effects(self):
        (self.source/'ship/SKILL.md').unlink()
        with self.assertRaises(ValueError):m.install(self.home,self.source)
        self.assertFalse(self.home.exists())

if __name__=='__main__':unittest.main()
