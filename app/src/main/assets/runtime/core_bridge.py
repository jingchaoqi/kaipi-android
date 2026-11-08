"""Android data adapter: core owns all session rules; private pipes carry JSON lines.

Event callbacks only enqueue data, since core can hold its lock while emitting.
No terminal, CLI, browser server or rendering module is imported here.
"""
from __future__ import annotations

import json
import queue
import signal
import sys
import threading
from dataclasses import asdict
from pathlib import Path
from typing import Any

from kaipi import attachments, catalog, context, core, graph, providers, settings
from kaipi.model import blocks, text_of
from kaipi.store import Log, list_sessions

PROTOCOL = 1
MAX_REQUEST = 56 * 1024 * 1024


def transcript(node: Any) -> list[dict[str, Any]]:
    result = []
    for message in node.payload:
        for block in blocks(message['content']):
            kind = block.get('type')
            if kind == 'text' and message['role'] == 'assistant':
                result.append({'kind': 'text', 'text': block['text']})
            elif kind == 'tool_use':
                result.append({'kind': 'cmd', 'text': str(block.get('input', {}).get('command', ''))})
            elif kind == 'tool_result':
                result.append({'kind': 'out', 'text': text_of(block.get('content', ''))})
    return result


class Application:
    def __init__(self, cwd: Path, publish: Any) -> None:
        self.session = core.Session(cwd)
        self.publish = publish
        self.worker: threading.Thread | None = None
        self.turn_error = ''

    def event(self, event: core.Event) -> None:
        if event.kind == 'start':
            self.turn_error = ''
        if event.kind == 'error':
            self.turn_error = event.text
        self.publish({'event': 'turn', 'data': asdict(event)})

    def snapshot(self) -> dict[str, Any]:
        s = self.session
        with s.lock:
            data = s.state()
            state, leaf = s.log.state, s.leaf
            data['name'] = core.session_title(state)
            data['history'] = [
                {'id': n.id, 'label': state.label(n.id), 'input': context.user_input(n),
                 'status': n.status, 'content': transcript(n), 'usage': n.usage.model_dump(),
                 'cost': s.pricing.price(n.model).cost(n.usage)}
                for n in graph.lineage(state, leaf) if n.payload
            ] if leaf else []
            data['sessions'] = []
            for path in reversed(list_sessions(s.cwd)):
                log = s.log if path == s.log.path else Log(path)
                data['sessions'].append({'id': path.stem, 'name': core.session_title(log.state),
                                         'turns': len(log.state.nodes), 'current': path == s.log.path})
            data['configured'] = bool(providers.configured_models())
            data['turn_error'] = self.turn_error
            data['appearance'] = settings.read().get('appearance', {'mode': 'system', 'color': 'forest'})
            return data

    def configuration(self) -> dict[str, Any]:
        auth = providers.auth()
        pricing = self.session.pricing
        return {
            'active': providers.active_model(),
            'models': [{'provider': p, 'id': m} for p, m in providers.configured_models()],
            'providers': [
                {'id': name, 'url': auth.get('providers', {}).get(name, {}).get('base_url', preset.base_url),
                 'configured': bool(auth.get('providers', {}).get(name)),
                 'has_key': bool(auth.get('providers', {}).get(name, {}).get('api_key')),
                 'needs_key': preset.needs_key,
                 'models': auth.get('providers', {}).get(name, {}).get('models', []),
                 'suggested': [key.removeprefix(f'{price.provider}/') for key, price in pricing.models.items()
                               if price.provider in {name, preset.model_catalog or name}]}
                for name, preset in providers.BUILTIN.items()
            ],
            'preferences': settings.read(),
        }

    def dispatch(self, op: str, body: dict[str, Any]) -> Any:
        s = self.session
        if op == 'state':
            return self.snapshot()
        if op == 'configuration':
            return self.configuration()
        if op == 'appearance':
            if body.get('mode') not in ('system', 'light', 'dark') or body.get('color') not in ('forest', 'indigo', 'clay'):
                raise ValueError('无效的主题设置')
            settings.save({'appearance': {'mode': body['mode'], 'color': body['color']}})
            return body
        if op == 'stop':
            s.stop()
            return {'stopping': s.busy}
        if op == 'turn':
            s.require_idle()
            plain = str(body.get('text', ''))
            items = body.get('attachments', [])
            if not plain.strip() and items:
                plain = '请查看这些附件。'
            text = core.input_text(plain, items)
            if not text.strip() and not body.get('attachments'):
                raise ValueError('写下问题，再发送。')
            entered = threading.Event()

            def forward(event: core.Event) -> None:
                if event.kind == 'start':
                    entered.set()
                self.event(event)

            def work() -> None:
                try:
                    core.run_input(s, text, forward, explore=bool(body.get('explore')))
                except Exception as error:
                    from kaipi.agent import Interrupted
                    if not isinstance(error, Interrupted):
                        self.event(core.Event('error', providers.redact(str(error))))
                finally:
                    entered.set()
                    self.publish({'event': 'settled', 'data': self.snapshot()})

            # core.run_input claims the core's busy state before emitting start.
            # Wait for that reservation before accepting another pipe request.
            self.worker = threading.Thread(target=work, daemon=True)
            self.worker.start()
            entered.wait()
            return {'accepted': True}
        if op == 'node':
            with s.lock:
                node = s.log.state.nodes[s.resolve(str(body['id']))]
                return {'id': node.id, 'input': context.user_input(node), 'content': transcript(node),
                        'status': node.status, 'paths': core.rewind_paths(s.log.state, node.id),
                        'has_snapshot': bool(node.tree), 'model': node.model,
                        'usage': node.usage.model_dump()}
        if op == 'preview':
            return s.preview(str(body['id']), [])
        if op == 'attachments':
            items = [attachments.Attachment.model_validate(item) for item in body['attachments']]
            attachments.validate(items)
            return [item.describe() for item in items]
        with s.lock:
            s.require_idle()
            if op == 'new':
                s.new()
                self.turn_error = ''
            elif op == 'resume':
                s.resume(str(body['id']))
                self.turn_error = ''
            elif op == 'rename':
                s.rename(str(body['name']))
            elif op == 'go':
                s.go(str(body['id']))
            elif op == 'pin':
                s.pin(str(body['id']))
            elif op in ('archive', 'restore'):
                s.set_status(str(body['id']), restore=op == 'restore')
            elif op == 'graft':
                depth = str(body.get('depth', 'leaf+summary'))
                if depth not in ('leaf', 'leaf+summary', 'branch'):
                    raise ValueError('无效的嫁接深度')
                s.graft(str(body['id']), depth, [])
            elif op == 'unstage':
                s.stage([e for e in s.pending if e.src_id != str(body['id'])])
            elif op == 'rewind':
                s.rewind(str(body['id']), str(body['mode']))
            elif op == 'provider.save':
                name = str(body['provider'])
                if name not in providers.BUILTIN:
                    raise ValueError('未知服务商')
                url = str(body.get('url', '')).strip()
                if url and not url.startswith(('https://', 'http://')):
                    raise ValueError('服务地址需要以 https:// 或 http:// 开头')
                models = providers.parse_models(str(body.get('models', '')))
                if not models:
                    raise ValueError('至少填写一个模型 ID')
                if providers.BUILTIN[name].needs_key and not (body.get('key') or providers.auth().get('providers', {}).get(name, {}).get('api_key')):
                    raise ValueError('请填写 API key')
                providers.save_auth(name, base_url=url, api_key=str(body.get('key', '')).strip(), models=models)
                if not providers.active_model():
                    providers.use_model(name, models[0])
                s.refresh_configuration()
            elif op == 'provider.remove':
                providers.remove_auth(str(body['provider']))
                s.refresh_configuration()
            elif op == 'model':
                pair = str(body['provider']), str(body['model'])
                if pair not in providers.configured_models():
                    raise ValueError('请先配置这个模型')
                providers.use_model(*pair)
                s.refresh_configuration()
            elif op == 'catalog.preview':
                name = str(body['provider'])
                saved = providers.auth().get('providers', {}).get(name, {}).get('models', [])
                prices, models = catalog.preview(name, saved)
                return {'provider': name, 'models': models,
                        'prices': {key: value.model_dump() for key, value in prices.items()}}
            elif op == 'catalog.save':
                from kaipi.ledger import Price
                catalog.save(str(body['provider']), list(body['models']),
                             {key: Price.model_validate(value) for key, value in body['prices'].items()})
                s.refresh_configuration()
            else:
                raise ValueError('不支持的操作')
        return self.snapshot()


def run(cwd: Path) -> None:
    protocol = sys.stdout
    sys.stdout = sys.stderr
    outgoing: queue.Queue[Any] = queue.Queue()

    def writer() -> None:
        while True:
            message = outgoing.get()
            try:
                if message is None:
                    return
                protocol.write(json.dumps(message, ensure_ascii=False) + '\n')
                protocol.flush()
            except (BrokenPipeError, OSError):
                return
            finally:
                outgoing.task_done()

    output = threading.Thread(target=writer, daemon=True)
    output.start()
    if core.lock_holder(cwd):
        outgoing.put({'event': 'fatal', 'error': '此工作目录已被另一个 kaipi 进程打开。'})
        outgoing.join()
        return
    core.set_lock(cwd, 'android')
    app = Application(cwd, outgoing.put)

    def stop(*_: Any) -> None:
        app.session.stop()
        raise SystemExit

    signal.signal(signal.SIGTERM, stop)
    try:
        outgoing.put({'event': 'ready', 'protocol': PROTOCOL, 'data': app.snapshot()})
        while True:
            line = sys.stdin.buffer.readline(MAX_REQUEST + 1)
            if not line:
                break
            request: dict[str, Any] = {}
            try:
                if len(line) > MAX_REQUEST:
                    raise ValueError('请求过大')
                request = json.loads(line)
                if not isinstance(request, dict):
                    request = {}
                    raise ValueError('无效请求')
                if request.get('op') == 'shutdown':
                    break
                result = app.dispatch(str(request.get('op', '')), request.get('body', {}))
                outgoing.put({'id': request.get('id'), 'result': result})
            except Exception as error:
                outgoing.put({'id': request.get('id'), 'error': providers.redact(str(error)),
                              'code': 'busy' if isinstance(error, core.BusyError) else 'invalid'})
    finally:
        app.session.stop()
        app.session.idle.wait(5)
        app.session.save()
        core.release_lock(cwd)
        outgoing.put(None)
        output.join(2)
