"""Focused Android GUI/core smoke test with a verified local HTTPS model endpoint."""
import json
import os
from pathlib import Path
import runpy
import ssl
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

assert hasattr(sys, 'getandroidapilevel')
runpy.run_path(os.environ['KAIPI_TEST_ENTRY'], run_name='android_test')
import certifi
from core_bridge import Application
from kaipi import providers

assert os.environ['SSL_CERT_FILE'] == certifi.where()
print('PASS: Android GUI entry loads bundled CA certificates', flush=True)
requests = []

class Endpoint(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        requests.append(body)
        if len(requests) == 1:
            message = {'role':'assistant', 'content':None, 'tool_calls':[{'id':'shell','type':'function','function':{'name':'bash','arguments':json.dumps({'command':'printf GUI_CORE_OK'})}}]}
            finish = 'tool_calls'
        else:
            message = {'role':'assistant','content':'ANDROID_GUI_OK'}
            finish = 'stop'
        data = json.dumps({'choices':[{'message':message,'finish_reason':finish}], 'usage':{'prompt_tokens':30,'completion_tokens':5}}).encode()
        self.send_response(200)
        self.send_header('Content-Type','application/json')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers(); self.wfile.write(data)

server = ThreadingHTTPServer(('127.0.0.1',0),Endpoint)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(Path(__file__).with_name('tls-cert.pem'),Path(__file__).with_name('tls-key.pem'))
server.socket = context.wrap_socket(server.socket,server_side=True)
threading.Thread(target=server.serve_forever,daemon=True).start()
try:
    with tempfile.TemporaryDirectory() as temporary:
        cwd = Path(temporary)
        os.environ['XDG_CONFIG_HOME'] = str(cwd / 'config')
        subprocess.run(['git','init','--template=','-q',str(cwd)],check=True)
        old_cwd = Path.cwd(); os.chdir(cwd)
        os.environ['KAIPI_ANDROID_GUI_TEST_KEY'] = 'local-test'
        cfg = providers.ProviderConfig(api='openai-chat',base_url=f'https://127.0.0.1:{server.server_port}/v1',api_key_env='KAIPI_ANDROID_GUI_TEST_KEY')
        with patch('certifi.where',return_value=str(Path(__file__).with_name('tls-cert.pem'))):
            model = providers.build('android-test/model',{'android-test':cfg})
        events = []
        app = Application(cwd,events.append)
        app.session.rename('GUI smoke')
        app.session._provider = app.session._cheap = model
        app.dispatch('turn',{'text':'verify Android GUI adapter'})
        app.worker.join(120)
        assert not app.worker.is_alive(), 'core turn did not settle'
        snapshot = app.snapshot()
        assert not snapshot['busy'] and snapshot['leaf'], [event for event in events if event.get('data', {}).get('kind') == 'error']
        assert snapshot['history'][-1]['content'][-1]['text'] == 'ANDROID_GUI_OK'
        assert any(item['kind']=='out' and 'GUI_CORE_OK' in item['text'] for item in snapshot['history'][-1]['content'])
        assert len(requests)==2
        assert any(message['role']=='tool' for message in requests[-1]['messages'])
        print('PASS: Android adapter → core → verified HTTPS → real shell → saved history',flush=True)
        app.dispatch('appearance',{'mode':'dark','color':'indigo'})
        restored = Application(cwd,lambda event:None)
        assert restored.snapshot()['appearance']=={'mode':'dark','color':'indigo'}
        assert not {'kaipi.cli','kaipi.tui','kaipi.server','kaipi.views','prompt_toolkit','typer'} & sys.modules.keys()
        assert app.session.cursor_path.is_file()
        model.client.close(); os.chdir(old_cwd)
        print('PASS: persisted theme/cursor, independent core without interface imports',flush=True)
finally:
    server.shutdown(); server.server_close()
