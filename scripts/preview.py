#!/usr/bin/env python3
"""Local GUI development fixture. Never included in the APK.

Uses the real Android adapter, core, logs and Git with a deterministic test provider.
"""
import argparse
import json
import os
from pathlib import Path
import queue
import secrets
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'app/src/main/assets/runtime'))
from core_bridge import Application
from kaipi import providers, settings
from kaipi.model import Usage
from kaipi.providers import Reply

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=8765)
parser.add_argument('--seed', action='store_true', help='Seed a branching conversation for screenshots/tests')
parser.add_argument('--first-run', action='store_true')
parser.add_argument('--delay-ready', type=float, default=0)
parser.add_argument('--retry-fixture', action='store_true', help='Simulate retryable failures for GUI integration tests')
parser.add_argument('--queue-fixture', action='store_true', help='Slow deterministic turns and persistent failures for queue tests')
args = parser.parse_args()
temporary = tempfile.TemporaryDirectory(prefix='kaipi-preview-')
cwd = Path(temporary.name)
os.chdir(cwd)
os.environ['XDG_CONFIG_HOME'] = str(cwd / 'config')
os.environ['XDG_CACHE_HOME'] = str(cwd / 'cache')
import subprocess
subprocess.run(['git','init','-q'], check=True)
clients = []
gate = threading.Lock()
clients_lock = threading.Lock()
token = secrets.token_urlsafe(24)


def publish(event):
    with clients_lock:
        for client in clients:
            client.put_nowait(event)


class FixtureProvider:
    model = 'openai/gpt-5.6'
    def __init__(self): self.failed = set()
    def count_tokens(self, text): return len(text)//2
    def complete(self, system, messages, cache_points):
        time.sleep(1.8 if args.queue_fixture else .55)
        if args.retry_fixture or args.queue_fixture:
            question = next((b['text'] for m in reversed(messages) if m['role']=='user' for b in (m['content'] if isinstance(m['content'],list) else []) if b.get('type')=='text' and not b['text'].startswith('<kaipi:')), '')
            if args.queue_fixture and question.startswith('queue-fail'):
                raise ConnectionError('Queue fixture connection interrupted')
            tool_result = any(b.get('type')=='tool_result' for b in messages[-1]['content'])
            if question.startswith(('retry-tool','retry-stop')) and not tool_result:
                return Reply(content=[{'type':'tool_use','id':'fixture-tool','name':'bash','input':{'command':'printf PREVIOUS_TOOL_OUTPUT'}}],stop_reason='tool_use',usage=Usage(output=3))
            if question.startswith(('retry-once','retry-tool')) and question not in self.failed:
                self.failed.add(question)
                raise ConnectionError('Preview connection interrupted')
            if 'FROZEN_BROWSER_ATTACHMENT' in json.dumps(messages):
                return Reply(content=[{'type':'text','text':'RETRY_ATTACHMENT_OK'}],stop_reason='end_turn',usage=Usage(output=4))
        if 'xss-probe' in json.dumps(messages):
            return Reply(content=[{'type':'text','text':'<img src=x onerror="window.__injected=1"><button data-branch="a">bad</button> [unsafe](javascript:alert(1)) ![image](https://example.invalid/tracker)'}], stop_reason='end_turn', usage=Usage(output=50))
        return Reply(content=[{'type':'text','text': '可以。先把问题拆成清晰的步骤，再逐步实现。\n\n### 从当前思路继续\n\n- 保留已经验证的结论。\n- 为不确定的部分开启独立探索。\n- 把有价值的发现嫁接回来。\n\n这样既能保持上下文清晰，也能让每一步都可以回溯。'}], stop_reason='end_turn', usage=Usage(input_uncached=328,output=112))


app = Application(cwd, publish)
if not args.first_run:
    providers.save_auth('openai',api_key='local-preview-only',models=['gpt-5.6'])
    providers.use_model('openai','gpt-5.6')
    settings.save({'language':'zh','android_language_confirmed':True,'android_onboarding_complete':True})
app.session._provider = app.session._cheap = FixtureProvider()
app.session.rename('让一个想法，长成一个产品')
if args.seed:
    from kaipi.model import NodeCreated, NodeCompleted, new_id
    log = app.session.log
    def node(parent, question, answer, tokens=1250):
        nid = new_id()
        log.append(NodeCreated(id=nid,parent_id=parent,model='openai/gpt-5.6'))
        log.append(NodeCompleted(id=nid,payload=[{'role':'user','content':[{'type':'text','text':question}]},{'role':'assistant','content':[{'type':'text','text':answer}]}],usage=Usage(input_uncached=tokens,output=240),context_tokens=tokens))
        return nid
    root = node(None,'我想做一个让人愿意每天打开的阅读应用。','我们可以从「每天打开的理由」出发，而不是先列功能。\n\n一个好的阅读产品，应该让人觉得**又发现了一点有意思的东西**，而不是又完成了一项任务。')
    a = node(root,'先梳理一下产品最重要的体验原则。','### 三个体验原则\n\n1. **轻盈的开始**：打开就能读，没有选择负担。\n2. **自然的积累**：收藏与批注融入阅读过程。\n3. **安静的陪伴**：用内容邀请回访，不用数字制造焦虑。')
    side = node(a,'探索一下：如果用卡片来呈现内容呢？','卡片适合建立轻巧的节奏。每张卡片只承担一个完整的想法，翻页时保留一点上下文，让阅读有连贯感。')
    node(side,'卡片之间的动效可以怎样设计？','用短距离位移与淡入淡出。尊重系统的减少动态效果设置，避免自动播放或持续跳动。')
    b = node(a,'回到主线，给出一个可实现的首页方案。','可以把首页收敛为三个层次，让内容始终站在最前面。\n\n### 一个安静的首页\n\n**此刻想读**\n每天精选三篇内容，不必在无限列表里寻找起点。卡片用标题和一句引言建立期待。\n\n**继续上次的思路**\n把未读完的文章轻轻放在下方，保留阅读位置和最后一条批注。\n\n**慢慢积累的收藏**\n用主题聚合收藏，让内容之间的联系自然浮现。\n\n> 不是让人停留得更久，而是让每一次打开都有所得。\n\n接下来可以从首页的布局与组件开始，把这个方向变成一个可以触摸的原型。',2480)
    node(b,'探索深色模式下的阅读氛围。','深色模式采用偏暖的炭灰背景，降低纯白文字的对比，保留纸张感。')
    app.session.pin(b)
    app.session.save()


class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def json(self,value,status=200):
        body=json.dumps(value,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
    def authorised(self):
        parsed=urlparse(self.path)
        return secrets.compare_digest(self.headers.get('X-Preview-Token','') or parse_qs(parsed.query).get('t',[''])[0],token)
    def do_POST(self):
        if not self.authorised() or self.headers.get('Content-Type')!='application/json':return self.json({'error':'Forbidden'},403)
        body=json.loads(self.rfile.read(min(int(self.headers.get('Content-Length',0)),56*1024*1024)))
        try:
            with gate: result=app.dispatch(body['op'],body.get('body',{}))
            self.json({'id':body.get('id'),'result':result})
        except Exception as error:self.json({'id':body.get('id'),'error':str(error)})
    def do_GET(self):
        path=urlparse(self.path).path
        if path=='/events':
            if not self.authorised():return self.json({'error':'Forbidden'},403)
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Cache-Control','no-cache');self.end_headers()
            client=queue.Queue()
            with clients_lock:clients.append(client)
            try:
                self.wfile.write(b': connected\n\n');self.wfile.flush()
                while True:
                    try: message=client.get(timeout=10);data=('data: '+json.dumps(message,ensure_ascii=False)+'\n\n').encode()
                    except queue.Empty:data=b': ping\n\n'
                    self.wfile.write(data);self.wfile.flush()
            except (BrokenPipeError,ConnectionResetError):pass
            finally:
                with clients_lock:clients.remove(client)
            return
        if path=='/preview.js':
            content=('''window.Native={
ready(){const e=new EventSource('/events?t=TOKEN');e.onmessage=x=>kaipi.receive(x.data);e.onopen=async()=>{const r=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-Preview-Token':'TOKEN'},body:JSON.stringify({op:'state'})});const m=await r.json();setTimeout(()=>kaipi.receive({event:'ready',protocol:1,data:m.result}),DELAY);};},
async request(json){const r=await fetch('/rpc',{method:'POST',headers:{'Content-Type':'application/json','X-Preview-Token':'TOKEN'},body:json});kaipi.receive(await r.json());},
retry(){location.reload()},copy(text){navigator.clipboard.writeText(text)},pickFile(){document.getElementById('file-input').click()},workspaces(){kaipi.receive({event:'workspaces',data:[{id:'preview',name:'开发预览'}]})}
};'''.replace('TOKEN',token).replace('DELAY',str(int(args.delay_ready*1000)))).encode();mime='application/javascript'
        else:
            relative='index.html' if path=='/' else path.lstrip('/')
            file=(ROOT/'app/src/main/assets/ui'/relative).resolve()
            if not file.is_relative_to(ROOT/'app/src/main/assets/ui') or not file.is_file():return self.json({'error':'Not found'},404)
            content=file.read_bytes();mime='text/html' if file.suffix=='.html' else 'text/css' if file.suffix=='.css' else 'image/svg+xml' if file.suffix=='.svg' else 'application/javascript'
            if file.name=='index.html':content=content.replace(b'<script defer',b'<script src="/preview.js"></script><script defer',1)
        self.send_response(200);self.send_header('Content-Type',mime+'; charset=utf-8');self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)


server=ThreadingHTTPServer(('127.0.0.1',args.port),Handler)
print(f'GUI fixture: http://127.0.0.1:{server.server_port}',flush=True)
try:server.serve_forever()
finally:server.server_close();temporary.cleanup()
