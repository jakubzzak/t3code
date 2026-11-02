import importlib.util
import tempfile
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('incidents', str(Path(__file__).with_name('incidents.py')))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class IncidentSearchTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);(self.root/'entries').mkdir()
    def tearDown(self): self.tmp.cleanup()
    def add(self, name, project='team/app', status='fixed', body='Historical false default', ident=None):
        path=self.root/'entries'/f'{name}.md'
        path.write_text(f'---\nid: {ident or name}\nproject: {project}\nstatus: {status}\nevidence: confirmed\nobserved: 2026-11-01\ntags: documents\nsummary: Published file hidden\ncontext: Legacy false default\ntrigger: Visibility predicate change\ncheck: Preserve published access\nsource: test fixture\n---\n# {name}\n{body}\n')
        return path
    def test_fixed_lessons_and_body_match(self):
        self.add('incident');out=m.search(self.root,'team/app','false default')
        self.assertEqual([r['metadata']['id'] for r in out['records']],['incident'])
    def test_scope_and_general(self):
        self.add('local');self.add('shared','general');self.add('other','other/app')
        self.assertEqual({r['metadata']['id'] for r in m.search(self.root,'team/app')['records']},{'local','shared'})
    def test_manual_entry_immediately_found_without_index(self):
        self.assertEqual(m.search(self.root)['records'],[])
        self.add('manual')
        self.assertEqual(len(m.search(self.root)['records']),1)
    def test_incomplete_entries_are_not_lost_to_filters(self):
        (self.root/'entries'/'manual.md').write_text('# Action reset\nExplicit empty array was overwritten.')
        out=m.search(self.root,'team/app','something-else')
        self.assertEqual(len(out['records']),1);self.assertTrue(out['warnings'])
    def test_retracted_not_current(self):
        self.add('outdated',status='retracted')
        out=m.search(self.root);self.assertEqual(out['records'],[]);self.assertTrue(out['warnings'])
        self.assertEqual(len(m.search(self.root,include_inactive=True)['records']),1)
    def test_duplicate_id_reported(self):
        self.add('a',ident='same');self.add('b',ident='same')
        self.assertTrue(any('duplicate' in w for w in m.search(self.root)['warnings']))
    def test_missing_root_fails_without_creating_it(self):
        missing=self.root/'absent'
        with self.assertRaises(ValueError): m.search(missing)
        self.assertFalse(missing.exists())
    def test_external_file_symlink_not_read(self):
        (self.root/'secret.md').write_text('private')
        (self.root/'entries'/'linked.md').symlink_to(self.root/'secret.md')
        out=m.search(self.root);self.assertEqual(out['records'],[]);self.assertTrue(out['warnings'])
    def test_search_does_not_mutate_registry(self):
        self.add('a');self.add('b',status='superseded')
        before={str(p):p.read_bytes() for p in self.root.rglob('*.md')}
        m.search(self.root,'team/app','false',True)
        self.assertEqual(before,{str(p):p.read_bytes() for p in self.root.rglob('*.md')})

    def test_index_contains_context_and_source_link(self):
        path=self.add('incident')
        m.refresh_index(self.root)
        text=(self.root/'Database.md').read_text()
        self.assertIn('Legacy false default',text)
        self.assertIn('Published file hidden',text)
        self.assertIn('(entries/incident.md)',text)
        self.assertIn('Preserve published access',text)
        self.assertTrue(m.check_index(self.root))
    def test_index_staleness_after_any_record_edit(self):
        path=self.add('incident');m.refresh_index(self.root)
        path.write_text(path.read_text()+'New evidence not present in the compact metadata.')
        self.assertFalse(m.check_index(self.root))
        m.refresh_index(self.root);self.assertTrue(m.check_index(self.root))
    def test_index_staleness_on_addition_and_deletion(self):
        first=self.add('first');m.refresh_index(self.root)
        second=self.add('second');self.assertFalse(m.check_index(self.root))
        m.refresh_index(self.root);first.unlink();self.assertFalse(m.check_index(self.root))
        m.refresh_index(self.root);self.assertNotIn('entries/first.md',(self.root/'Database.md').read_text())
    def test_refresh_preserves_records_and_is_idempotent(self):
        path=self.add('incident');before=path.read_bytes()
        self.assertTrue(m.refresh_index(self.root)['changed'])
        self.assertFalse(m.refresh_index(self.root)['changed'])
        self.assertEqual(path.read_bytes(),before)
    def test_freshness_check_does_not_write(self):
        self.add('incident')
        self.assertFalse(m.check_index(self.root));self.assertFalse((self.root/'Database.md').exists())
    def test_index_does_not_replace_manual_content(self):
        self.add('incident');index=self.root/'Database.md';index.write_text('My manually authored notes')
        with self.assertRaises(ValueError):m.refresh_index(self.root)
        self.assertEqual(index.read_text(),'My manually authored notes')
    def test_inactive_records_remain_visibly_labelled_in_index(self):
        self.add('old',status='superseded');m.refresh_index(self.root)
        self.assertIn('**Status:** superseded',(self.root/'Database.md').read_text())
    def test_index_escapes_metadata_markup(self):
        self.add('unsafe',body='body')
        p=self.root/'entries/unsafe.md';p.write_text(p.read_text().replace('Legacy false default','<script>alert(1)</script> [injected](x)'))
        m.refresh_index(self.root);text=(self.root/'Database.md').read_text()
        self.assertNotIn('<script>',text);self.assertNotIn('[injected](x)',text)
    def test_index_refuses_symlink(self):
        self.add('incident');other=self.root/'other.md';other.write_text('preserve')
        (self.root/'Database.md').symlink_to(other)
        with self.assertRaises(ValueError):m.refresh_index(self.root)
        self.assertEqual(other.read_text(),'preserve')

if __name__=='__main__': unittest.main()
