"""Integration tests for Android's core adapter using real logs, Git and local endpoints."""
import json
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / 'app/src/main/assets/runtime'
sys.path.insert(0, str(RUNTIME))
from core_bridge import Application
from kaipi import core, providers, graph
from kaipi.model import Usage
from kaipi.providers import Reply


class Echo:
    model = 'test/model'
    def count_tokens(self, text):
        return len(text) // 4
    def complete(self, system, messages, cache_points):
        return Reply(content=[{'type': 'text', 'text': 'A useful answer.'}], stop_reason='end_turn', usage=Usage(input_uncached=30, output=10))


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.cwd = Path(self.temp.name)
        self.old_cwd = Path.cwd()
        os.chdir(self.cwd)
        self.env = patch.dict(os.environ, {'XDG_CONFIG_HOME': str(self.cwd / 'config'), 'XDG_CACHE_HOME': str(self.cwd / 'cache')})
        self.env.start()
        subprocess.run(['git', 'init', '-q', self.cwd], check=True)
        self.events = queue.Queue()
        self.app = Application(self.cwd, self.events.put)
        self.app.session._provider = self.app.session._cheap = Echo()
        self.app.session.rename('Adapter test')
    def tearDown(self):
        self.app.session.stop()
        if self.app.worker:
            self.app.worker.join(5)
        self.env.stop()
        os.chdir(self.old_cwd)
        self.temp.cleanup()
    def turn(self, text='hello', explore=False):
        self.app.dispatch('turn', {'text': text, 'explore': explore})
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            event = self.events.get(timeout=10)
            if event.get('event') == 'settled':
                self.assertFalse(event['data']['busy'])
                return event['data']
        self.fail('turn did not settle')
    def test_tree_operations_are_core_operations_and_survive_reload(self):
        root = self.turn()['leaf']
        main = self.turn('main path')['leaf']
        self.app.dispatch('go', {'id': root})
        side = self.turn('different approach', True)['leaf']
        self.app.dispatch('go', {'id': main})
        self.app.dispatch('graft', {'id': side, 'depth': 'leaf'})
        state = self.app.snapshot()
        self.assertEqual([root, main], [n['id'] for n in state['history']])
        self.assertEqual(side, state['pending'][0]['src_id'])
        restored = core.Session(self.cwd)
        self.assertEqual(restored.pending, self.app.session.pending)
        self.assertEqual(main, graph.trunk(restored.log.state))
        self.app.dispatch('unstage', {'id': side})
        self.app.dispatch('archive', {'id': side})
        self.assertEqual('archived', self.app.session.log.state.nodes[side].status)
        self.app.dispatch('restore', {'id': side})
        self.app.dispatch('pin', {'id': side})
        self.assertEqual(side, self.app.snapshot()['trunk'])
        old = self.app.snapshot()['session']
        self.app.dispatch('new', {})
        self.app.dispatch('resume', {'id': old})
        self.assertEqual(side, self.app.snapshot()['leaf'])
    def test_stop_and_provider_failure_are_delivered_after_persistence(self):
        entered, release = threading.Event(), threading.Event()
        class Blocked(Echo):
            def complete(self, *args):
                entered.set(); release.wait(5)
                return Reply(content=[{'type':'tool_use','id':'t1','name':'bash','input':{'command':'touch must-not-exist'}}], stop_reason='tool_use', usage=Usage(output=4))
        self.app.session._provider = Blocked()
        self.app.dispatch('turn', {'text':'work'})
        self.assertTrue(entered.wait(5))
        with self.assertRaises(core.BusyError): self.app.dispatch('new', {})
        self.app.dispatch('stop', {})
        release.set()
        self.app.worker.join(5)
        self.assertFalse((self.cwd / 'must-not-exist').exists())
        events = []
        while not self.events.empty(): events.append(self.events.get())
        final = next(e for e in events if e['event'] == 'settled')
        self.assertFalse(final['data']['busy'])
        self.assertEqual('aborted', final['data']['nodes'][0]['status'])
        class Failed(Echo):
            def complete(self, *args): raise ValueError('endpoint failed')
        self.app.session._provider = Failed()
        self.app.dispatch('turn', {'text':'try again'})
        self.app.worker.join(5)
        events = []
        while not self.events.empty(): events.append(self.events.get())
        self.assertTrue(any(e.get('data', {}).get('kind') == 'error' and 'endpoint failed' in e['data']['text'] for e in events))
    def test_configuration_never_returns_credentials(self):
        state = self.app.dispatch('provider.save', {'provider':'openai','url':'https://example.com/v1','key':'synthetic-test-secret','models':'first, second'})
        config = self.app.dispatch('configuration', {})
        self.assertNotIn('synthetic-test-secret', json.dumps(config))
        self.assertTrue(state['configured'])
        self.app.dispatch('model', {'provider':'openai','model':'second'})
        self.assertEqual('openai/second', providers.active_model())
        with self.assertRaises(ValueError): self.app.dispatch('model', {'provider':'openai','model':'missing'})
    def test_language_is_required_before_completing_onboarding(self):
        with self.assertRaises(ValueError):
            self.app.dispatch('preferences', {'language':'en','android_onboarding_complete':True})
        for invalid in ('fr', '', None):
            with self.assertRaises(ValueError):
                self.app.dispatch('preferences', {'language':invalid})
        with self.assertRaises(ValueError):
            self.app.dispatch('preferences', {'language':'en','android_language_confirmed':'yes'})
        before = self.app.session.log.path.read_bytes()
        self.app.session.claim()
        try:
            self.app.dispatch('preferences', {'language':'en','android_language_confirmed':True,'android_onboarding_complete':False})
            self.app.dispatch('preferences', {'language':'en','android_onboarding_complete':True})
        finally:
            self.app.session.idle.set()
        saved = Application(self.cwd,self.events.put).snapshot()['preferences']
        self.assertEqual('en',saved['language'])
        self.assertTrue(saved['android_language_confirmed'] and saved['android_onboarding_complete'])
        self.assertEqual(before,self.app.session.log.path.read_bytes())
    def test_appearance_is_validated_saved_and_available_while_executing(self):
        self.app.session.claim()
        try:
            self.app.dispatch('appearance', {'mode':'dark','color':'indigo'})
            self.assertEqual({'mode':'dark','color':'indigo'}, self.app.snapshot()['appearance'])
            with self.assertRaises(ValueError):
                self.app.dispatch('appearance', {'mode':'invalid','color':'clay'})
        finally:
            self.app.session.idle.set()
        restored = Application(self.cwd, self.events.put)
        self.assertEqual('indigo', restored.snapshot()['appearance']['color'])
    def test_code_rewind_uses_core_checkpoint(self):
        file = self.cwd / 'example.txt'
        file.write_text('before')
        root = self.turn()['leaf']
        class Write(Echo):
            calls = 0
            def complete(self, *args):
                self.calls += 1
                if self.calls == 1:
                    return Reply(content=[{'type':'tool_use','id':'t','name':'bash','input':{'command':"printf after > example.txt"}}], stop_reason='tool_use', usage=Usage(output=3))
                return super().complete(*args)
        self.app.session._provider = Write()
        self.turn('change file')
        self.assertEqual('after', file.read_text())
        detail = self.app.dispatch('node', {'id':root})
        self.assertEqual(['example.txt'], detail['paths'])
        self.app.dispatch('rewind', {'id':root,'mode':'both'})
        self.assertEqual('before', file.read_text())
        self.assertEqual(root, self.app.snapshot()['leaf'])
    def test_plain_text_attachment_is_validated_and_frozen(self):
        import base64
        attachment = {'name':'notes.txt','data':base64.b64encode(b'project notes').decode()}
        description = self.app.dispatch('attachments', {'attachments':[attachment]})
        self.assertEqual('file', description[0]['kind'])
        self.app.dispatch('turn', {'text':'', 'attachments':[attachment]})
        self.app.worker.join(5)
        payload = self.app.session.log.state.nodes[self.app.session.leaf].payload
        self.assertIn('project notes', json.dumps(payload))
        with self.assertRaises(ValueError): self.app.dispatch('attachments', {'attachments':[attachment]*9})


class PipeTests(unittest.TestCase):
    def test_real_process_protocol_remains_valid_and_never_imports_cli(self):
        with tempfile.TemporaryDirectory() as temporary:
            env = dict(os.environ, XDG_CONFIG_HOME=temporary+'/config', XDG_CACHE_HOME=temporary+'/cache', PYTHONPATH=str(RUNTIME))
            child = subprocess.Popen([sys.executable, '-u', str(RUNTIME/'main.py')], cwd=temporary, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                ready = json.loads(child.stdout.readline())
                self.assertEqual('ready', ready['event'])
                for i, (op, body) in enumerate([('rename', {'name':'你好 Android'}), ('configuration', {}), ('state', {})]):
                    child.stdin.write(json.dumps({'id':str(i),'op':op,'body':body})+'\n'); child.stdin.flush()
                    response = json.loads(child.stdout.readline())
                    self.assertEqual(str(i), response['id'])
                    self.assertNotIn('error', response)
                self.assertEqual('你好 Android', response['result']['name'])
                child.stdin.write('{"op":"shutdown"}\n'); child.stdin.flush()
                child.wait(timeout=10)
                self.assertEqual(0, child.returncode, child.stderr.read())
                self.assertFalse((Path(temporary)/'.kaipi/lock.json').exists())
            finally:
                if child.poll() is None: child.kill(); child.wait()
                for stream in [child.stdin,child.stdout,child.stderr]: stream.close()
        result = subprocess.run([sys.executable, '-c', "import core_bridge,sys; assert not {'kaipi.cli','kaipi.tui','kaipi.server','kaipi.views','prompt_toolkit','typer'} & sys.modules.keys()"], env=dict(os.environ,PYTHONPATH=str(RUNTIME)), capture_output=True, text=True)
        self.assertEqual(0,result.returncode,result.stderr)


if __name__ == '__main__': unittest.main()
