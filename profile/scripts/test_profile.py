import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name('profile.py')


class ProfileTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.settings = self.root / 'settings.json'
        self.installed = self.root / 'installed.json'
        self.state = self.root / 'state'
        self.original = {
            'enabledPlugins': {
                'effort-router@shon-mods': True,
                'prereg@shon-mods': True,
                'marketing@knowledge-work-plugins': True,
                'unrelated@x': True,
            },
            'otherSetting': {'kept': True},
        }
        self.settings.write_text(json.dumps(self.original), encoding='utf-8')
        self.installed.write_text(json.dumps({'plugins': {}}), encoding='utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def invoke(self, *args):
        return subprocess.run(['python3', str(SCRIPT), '--settings', str(self.settings), '--installed', str(self.installed), '--state-dir', str(self.state), *args], text=True, capture_output=True)

    def read_settings(self):
        return json.loads(self.settings.read_text(encoding='utf-8'))

    def test_switch_trading_preserves_other_settings_and_creates_backup(self):
        result = self.invoke('switch', 'trading')
        self.assertEqual(result.returncode, 0, result.stderr)
        settings = self.read_settings()
        self.assertTrue(settings['otherSetting']['kept'])
        enabled = settings['enabledPlugins']
        self.assertTrue(enabled['effort-router@shon-mods'])
        self.assertTrue(enabled['prereg@shon-mods'])
        self.assertFalse(enabled['marketing@knowledge-work-plugins'])
        self.assertFalse(enabled['unrelated@x'])
        self.assertTrue(list(self.state.glob('settings.backup-*.json')))

    def test_all_snapshot_is_created_once_and_all_restores_it_exactly(self):
        self.assertEqual(self.invoke('switch', 'trading').returncode, 0)
        snapshot = (self.state / 'all.json').read_bytes()
        self.assertEqual(self.invoke('switch', 'coding').returncode, 0)
        self.assertEqual((self.state / 'all.json').read_bytes(), snapshot)
        self.assertEqual(self.invoke('switch', 'all').returncode, 0)
        self.assertEqual(self.read_settings()['enabledPlugins'], self.original['enabledPlugins'])

    def test_bad_name_leaves_settings_identical(self):
        before = self.settings.read_bytes()
        result = self.invoke('switch', 'nope')
        self.assertEqual(result.returncode, 2)
        self.assertEqual(self.settings.read_bytes(), before)

    def test_measure_counts_fake_plugin_tree(self):
        plugin = self.root / 'fake'
        (plugin / 'commands').mkdir(parents=True)
        (plugin / 'agents').mkdir()
        (plugin / 'SKILL.md').write_text('---\ndescription: skill one\n---\n', encoding='utf-8')
        (plugin / 'nested').mkdir()
        (plugin / 'nested' / 'SKILL.md').write_text('---\ndescription: >\n  skill two\n---\n', encoding='utf-8')
        (plugin / 'commands' / 'x.md').write_text('---\ndescription: command\n---\n', encoding='utf-8')
        (plugin / 'agents' / 'y.md').write_text('---\ndescription: agent\n---\n', encoding='utf-8')
        self.settings.write_text(json.dumps({'enabledPlugins': {'fake@x': True}}), encoding='utf-8')
        self.installed.write_text(json.dumps({'plugins': {'fake@x': [{'installPath': str(plugin)}]}}), encoding='utf-8')
        result = self.invoke('measure')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('plugins 1 (unknown 0), skills 2, commands 1, agents 1, desc_chars 30, ~tokens 7', result.stdout)


if __name__ == '__main__':
    unittest.main()
