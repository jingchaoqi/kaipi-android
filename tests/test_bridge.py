"""Integration tests for Android's core adapter using real logs, Git and local endpoints."""
import json
import os
from pathlib import Path
import queue
import shlex
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
from core_bridge import Application, android_instructions
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
    def operation(self, op, body):
        self.app.dispatch(op, body)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            event = self.events.get(timeout=10)
            if event.get('event') == 'settled':
                self.assertFalse(event['data']['busy'])
                return event['data']
        self.fail('turn did not settle')
    def turn(self, text='hello', explore=False):
        return self.operation('turn', {'text': text, 'explore': explore})
    def retry(self):
        return self.operation('retry', {})

    def test_android_environment_is_injected_only_for_new_android_sessions(self):
        self.assertEqual('', android_instructions(self.cwd))
        original = self.turn('before upgrading')['session']
        old_path = self.app.session.log.path
        original_prompt, old_log = self.app.session.log.state.system_prompt, old_path.read_bytes()
        with patch('core_bridge.sys.getandroidapilevel', return_value=34, create=True):
            self.app = Application(self.cwd, self.events.put)
            self.assertEqual(original_prompt, self.app.session.log.state.system_prompt)
            self.assertEqual(old_log, old_path.read_bytes())
            self.app.dispatch('new', {})
            self.app.session.rename('Android environment')
            prompt = self.app.session.log.state.system_prompt
            self.assertIn('kaipi for Android', prompt)
            self.assertIn('API 34', prompt)
            self.assertIn('/system/bin/sh', prompt)
            self.assertIn('[Open page](./index.html)', prompt)
            self.assertIn('HTML previews are offline', prompt)
            self.assertIn(str(self.cwd.resolve()), prompt)
            self.assertIn(str(Path.home()), prompt)
            self.assertIn(self.app.app_instructions, prompt)
            self.assertEqual(self.app.app_instructions, self.app.session.log.state.app_instructions)
            systems = []
            class AndroidCapture(Echo):
                def complete(self, system, *args):
                    systems.append(system)
                    return super().complete(system, *args)
            self.app.session._provider = self.app.session._cheap = AndroidCapture()
            self.turn('run on Android')
            self.retry()
            self.assertEqual([prompt, prompt], systems)
            saved = self.app.session.log.path.read_bytes()
            self.app = Application(self.cwd, self.events.put)
            self.assertEqual(prompt, self.app.session.log.state.system_prompt)
            self.assertEqual(saved, self.app.session.log.path.read_bytes())
            self.app.dispatch('resume', {'id': original})
            self.assertEqual(original_prompt, self.app.session.log.state.system_prompt)
            self.assertEqual(old_log, old_path.read_bytes())
            empty = self.cwd / 'fresh-workspace'
            empty.mkdir()
            subprocess.run(['git', 'init', '-q', str(empty)], check=True)
            fresh = Application(empty, lambda event: None)
            self.assertIn('kaipi for Android', fresh.session.log.state.system_prompt)
            self.assertIn(str(empty.resolve()), fresh.session.log.state.app_instructions)

    def test_legacy_session_reopens_without_rewriting_its_prompt_or_log(self):
        original = self.turn('legacy question')
        path = self.app.session.log.path
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        for row in rows:
            if row['type'] == 'session_started': row.pop('app_instructions', None)
        path.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows))
        frozen = self.app.session.log.state.system_prompt
        before = path.read_bytes()
        (self.cwd / 'AGENTS.md').write_text('NEW PROJECT INSTRUCTIONS')
        self.app = Application(self.cwd, self.events.put)
        self.assertEqual(original['history'], self.app.snapshot()['history'])
        self.assertEqual('', self.app.session.log.state.app_instructions)
        self.assertEqual(frozen, self.app.session.log.state.system_prompt)
        self.assertEqual(before, path.read_bytes())
        self.app.session._provider = self.app.session._cheap = Echo()
        continued = self.turn('continue the legacy session')
        self.assertEqual(2, len(continued['history']))
        self.assertEqual(frozen, self.app.session.log.state.system_prompt)

    def test_shared_application_instructions_survive_android_new_retry_and_resume(self):
        shared = core.Session(self.cwd, new=True, app_instructions='SHARED APPLICATION RULE')
        shared.rename('Shared application')
        shared._provider = shared._cheap = Echo()
        core.run_input(shared, 'shared question')
        path, frozen = shared.log.path, shared.log.state.system_prompt
        before = path.read_bytes()
        self.app = Application(self.cwd, self.events.put)
        self.assertEqual(frozen, self.app.session.log.state.system_prompt)
        self.assertEqual(before, path.read_bytes())
        self.app.dispatch('new', {})
        self.app.session.rename('Android continuation')
        self.assertEqual('SHARED APPLICATION RULE', self.app.session.log.state.app_instructions)
        systems = []
        class Capture(Echo):
            def complete(self, system, *args):
                systems.append(system)
                return super().complete(system, *args)
        self.app.session._provider = self.app.session._cheap = Capture()
        self.turn('new question')
        self.retry()
        self.assertEqual(2, len(systems))
        self.assertTrue(all('SHARED APPLICATION RULE' in system for system in systems))
        self.app.dispatch('resume', {'id': path.stem})
        self.assertEqual(frozen, self.app.session.log.state.system_prompt)
        self.assertEqual(before, path.read_bytes())

    def test_retry_success_uses_core_and_preserves_old_attempt(self):
        from copy import deepcopy
        class Recording(Echo):
            def __init__(self): self.requests = []
            def complete(self, system, messages, points):
                self.requests.append(deepcopy(messages))
                return super().complete(system, messages, points)
        first = Recording()
        self.app.session._provider = first
        original = self.turn('original question')['leaf']
        before = self.app.session.log.state.nodes[original].model_dump()
        replacement = Recording()
        replacement.model = 'test/selected-model'
        self.app.session._provider = replacement
        state = self.retry()
        self.assertEqual(first.requests[0], replacement.requests[0])
        self.assertNotEqual(original, state['leaf'])
        self.assertIsNone(state['latest_attempt']['parent_id'])
        self.assertEqual('test/selected-model',state['latest_attempt']['model'])
        self.assertEqual(before,self.app.session.log.state.nodes[original].model_dump())
        self.assertEqual(state['leaf'],state['trunk'])
        self.assertTrue(state['retryable'])

    def test_retry_failed_turn_restores_attachments_graft_and_exploration(self):
        import base64
        from copy import deepcopy
        parent = self.turn('parent')['leaf']
        source = self.turn('source',True)['leaf']
        self.app.dispatch('go',{'id':parent})
        self.app.dispatch('graft',{'id':source,'depth':'leaf'})
        class Offline(Echo):
            def __init__(self): self.requests = []
            def complete(self, system, messages, points):
                self.requests.append(deepcopy(messages))
                if len(self.requests)==1:
                    return Reply(content=[{'type':'tool_use','id':'old','name':'bash','input':{'command':'printf OLD_TOOL_RESULT'}}],stop_reason='tool_use',usage=Usage(output=2))
                raise TimeoutError('model read timeout')
        original = Offline()
        self.app.session._provider = original
        attachment = {'name':'note.txt','data':base64.b64encode(b'FROZEN_ATTACHMENT').decode()}
        failed = self.operation('turn',{'text':'read [file1]','attachments':[attachment],'explore':True})
        attempt = failed['latest_attempt']
        self.assertTrue(failed['retryable'] and attempt['attachments'] and attempt['has_tools'])
        self.assertEqual('aborted',attempt['status'])
        self.assertIn('model read timeout',failed['turn_error'])
        self.assertNotIn(attempt['id'],[turn['id'] for turn in failed['history']])
        before = self.app.session.log.state.nodes[attempt['id']].model_dump()
        class Replacement(Echo):
            def complete(self, system, messages, points):
                self.messages = deepcopy(messages)
                return super().complete(system, messages, points)
        replacement = Replacement()
        self.app.session._provider = replacement
        state = self.retry()
        self.assertEqual(original.requests[0],replacement.messages)
        self.assertIn('FROZEN_ATTACHMENT',str(replacement.messages))
        self.assertNotIn('OLD_TOOL_RESULT',str(replacement.messages))
        self.assertEqual(parent,state['latest_attempt']['parent_id'])
        self.assertEqual(parent,state['trunk'])
        self.assertEqual([],state['pending'])
        self.assertEqual(before,self.app.session.log.state.nodes[attempt['id']].model_dump())

    def test_retry_is_reserved_synchronously_and_can_stop(self):
        old = self.turn()['leaf']
        entered, release = threading.Event(), threading.Event()
        class Blocked(Echo):
            def complete(self, *args):
                entered.set(); release.wait(5)
                return Reply(content=[{'type':'tool_use','id':'stopped','name':'bash','input':{'command':'touch retry-must-not-exist'}}],stop_reason='tool_use',usage=Usage(output=2))
        self.app.session._provider = Blocked()
        self.app.dispatch('retry',{})
        try:
            self.assertTrue(self.app.session.busy and entered.wait(5))
            with self.assertRaises(core.BusyError): self.app.dispatch('retry',{})
            with self.assertRaises(core.BusyError): self.app.dispatch('new',{})
            self.app.dispatch('stop',{})
        finally:
            release.set(); self.app.worker.join(5)
        state = self.app.snapshot()
        self.assertFalse(state['busy'])
        self.assertEqual(old,state['trunk'])
        self.assertEqual('aborted',state['latest_attempt']['status'])
        self.assertTrue(state['retryable'])
        self.assertFalse((self.cwd/'retry-must-not-exist').exists())

    def test_retry_rejects_node_arguments_or_changed_context_without_mutation(self):
        parent = self.turn('parent')['leaf']
        latest = self.turn('latest')['leaf']
        with self.assertRaises(ValueError): self.app.dispatch('retry',{'id':parent})
        self.app.dispatch('go',{'id':parent})
        self.assertFalse(self.app.snapshot()['retryable'])
        before = self.app.session.log.path.read_bytes(),self.app.session.cursor_path.read_bytes()
        with self.assertRaises(ValueError): self.app.dispatch('retry',{})
        self.assertEqual(before,(self.app.session.log.path.read_bytes(),self.app.session.cursor_path.read_bytes()))
        self.assertFalse(self.app.session.busy)
        self.assertEqual(latest,self.app.snapshot()['latest_attempt']['id'])

    def test_retry_survives_reload_after_preparation_failure(self):
        providers.use_model('missing-provider','missing-model')
        self.app.session._provider = None
        state = self.turn('NEW ORIGINAL QUESTION')
        self.assertEqual('NEW ORIGINAL QUESTION',state['latest_attempt']['input'])
        self.assertEqual('aborted',state['latest_attempt']['status'])
        self.app = Application(self.cwd,self.events.put)
        self.app.session._provider = self.app.session._cheap = Echo()
        self.assertTrue(self.app.snapshot()['retryable'])
        self.assertEqual('NEW ORIGINAL QUESTION',self.app.snapshot()['latest_attempt']['input'])
        state = self.retry()
        self.assertEqual('NEW ORIGINAL QUESTION',state['history'][-1]['input'])
        self.assertEqual('',state['turn_error'])
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
        self.assertTrue(any(e.get('data', {}).get('kind') == 'aborted' and 'endpoint failed' in e['data']['text'] for e in events))
    def test_configuration_never_returns_credentials(self):
        state = self.app.dispatch('provider.save', {'provider':'openai','url':'https://example.com/v1','key':'synthetic-test-secret','models':'first, second'})
        config = self.app.dispatch('configuration', {})
        self.assertNotIn('synthetic-test-secret', json.dumps(config))
        self.assertTrue(state['configured'])
        self.app.dispatch('model', {'provider':'openai','model':'second'})
        self.assertEqual('openai/second', providers.active_model())
        with self.assertRaises(ValueError): self.app.dispatch('model', {'provider':'openai','model':'missing'})
    def test_non_utf8_tool_output_completes_and_survives_reload(self):
        raw = b'12345678901234567890123456\x82 ' + '正常文本'.encode()
        command = shlex.join([sys.executable, '-c', f"import os; os.write(1,{raw!r}); os.write(2,b'error\\xff')"])
        class Binary(Echo):
            calls = 0
            def complete(self, *args):
                self.calls += 1
                if self.calls == 1:
                    return Reply(content=[{'type':'tool_use','id':'binary','name':'bash','input':{'command':command}}], stop_reason='tool_use', usage=Usage(output=3))
                return super().complete(*args)
        self.app.session._provider = Binary()
        state = self.turn('read non-UTF-8 output')
        self.assertEqual('', state['turn_error'])
        output = next(item['text'] for item in state['history'][-1]['content'] if item['kind']=='out')
        self.assertIn('12345678901234567890123456\ufffd 正常文本', output)
        self.assertIn('error\ufffd', output)
        self.assertEqual(state['history'], Application(self.cwd,self.events.put).snapshot()['history'])
        state = self.turn('continue')
        self.assertEqual(2, len(state['history']))
        self.assertEqual('', state['turn_error'])
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
