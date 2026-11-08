"""Run with the APK's Python under adb run-as. Uses isolated data and a local TLS model endpoint."""
import json
import os
from pathlib import Path
import subprocess
import sys
import runpy
import ssl
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

assert hasattr(sys, "getandroidapilevel"), "This test must run on Android"
import certifi
import httpx2
import anthropic

print("Android OpenSSL default CA paths:", ssl.get_default_verify_paths(), flush=True)
runpy.run_path(os.environ["KAIPI_TEST_ENTRY"], run_name="android_test")
assert os.environ.get("SSL_CERT_FILE") == certifi.where(), "Android entry must configure its bundled CA certificates"
tls = httpx2.create_ssl_context()
assert tls.cert_store_stats()["x509_ca"] > 0
assert tls.check_hostname and tls.verify_mode == ssl.CERT_REQUIRED
print("PASS: Android entry loads bundled CA certificates and keeps TLS verification enabled", flush=True)
from importlib.metadata import version
import jiter
from pydantic import BaseModel
from kaipi import agent, guard, providers
from kaipi.core import Session
from core_bridge import Application


class Record(BaseModel):
    text: str


assert Record.model_validate_json('{"text":"你好"}').text == "你好"
assert jiter.from_json(b'{"ok":true}') == {"ok": True}
print("PASS: Android CPython, native dependencies and upstream kaipi", version("kaipi"), flush=True)

with tempfile.TemporaryDirectory() as directory:
    cwd = Path(directory)
    os.environ["XDG_CONFIG_HOME"] = str(cwd / "config")
    subprocess.run(["git", "init", "--template=", "-q", str(cwd)], check=True)
    assert agent.run_bash("printf core-ok", cwd) == "core-ok"
    file = cwd / "sample.txt"
    file.write_text("before")
    snapshot = guard.snapshot(cwd)
    assert snapshot
    file.write_text("after")
    guard.restore(cwd, snapshot, ["sample.txt"])
    assert file.read_text() == "before"
    session = Session(cwd, new=True)
    session.save()
    restored = Session(cwd)
    assert restored.log.path == session.log.path
    print("PASS: shell, Git snapshot/restore, session persistence", flush=True)

    requests = []

    class Endpoint(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append((self.path, body))
            if self.path == "/anthropic/v1/messages":
                events = [
                    {"type": "message_start", "message": {"id": "msg_test", "type": "message", "role": "assistant", "model": "model", "content": [], "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 3, "output_tokens": 0}}},
                    {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
                    {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "ANDROID_TLS_OK"}},
                    {"type": "content_block_stop", "index": 0},
                    {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 2}},
                    {"type": "message_stop"},
                ]
                payload = "".join(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n" for event in events).encode()
                mime = "text/event-stream"
            else:
                payload = json.dumps({"choices": [{"message": {"role": "assistant", "content": "ANDROID_OK"}, "finish_reason": "stop"}],
                                      "usage": {"prompt_tokens": 3, "completion_tokens": 2}}).encode()
                mime = "application/json"
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Endpoint)
    server_tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    server_tls.load_cert_chain(Path(__file__).with_name("tls-cert.pem"), Path(__file__).with_name("tls-key.pem"))
    server.socket = server_tls.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        os.environ["KAIPI_ANDROID_TEST_KEY"] = "local-test"
        endpoint = f"https://127.0.0.1:{server.server_port}"
        config = providers.ProviderConfig(api="anthropic", base_url=endpoint + "/anthropic", api_key_env="KAIPI_ANDROID_TEST_KEY")
        untrusted = providers.build("android-test/model", {"android-test": config})
        untrusted.client = untrusted.client.with_options(max_retries=0, timeout=10)
        try:
            untrusted.complete("test", [{"role": "user", "content": "hello"}], [])
            raise AssertionError("An untrusted TLS certificate was accepted")
        except anthropic.APIConnectionError as error:
            # httpcore2 suppresses the original ssl exception, but preserves its error code.
            cause = error.__cause__
            assert isinstance(cause, httpx2.ConnectError) and "CERTIFICATE_VERIFY_FAILED" in str(cause)
            print("PASS: invalid TLS certificate rejected; SDK wraps it as APIConnectionError", flush=True)
        finally:
            untrusted.client.close()

        os.environ["SSL_CERT_FILE"] = str(Path(__file__).with_name("tls-cert.pem"))
        runpy.run_path(os.environ["KAIPI_TEST_ENTRY"], run_name="android_test")
        assert os.environ["SSL_CERT_FILE"].endswith("tls-cert.pem"), "Explicit CA configuration must be preserved"
        trusted = providers.build("android-test/model", {"android-test": config})
        trusted.client = trusted.client.with_options(max_retries=0, timeout=10)
        try:
            reply = trusted.complete("test", [{"role": "user", "content": "hello"}], [])
            assert any(block.get("text") == "ANDROID_TLS_OK" for block in reply.content)
            assert requests[-1][0] == "/anthropic/v1/messages"
            print("PASS: upstream Anthropic-compatible provider over verified HTTPS with streaming reply", flush=True)
        finally:
            trusted.client.close()

        requests.clear()
        config = providers.ProviderConfig(api="openai-chat", base_url=endpoint + "/v1", api_key_env="KAIPI_ANDROID_TEST_KEY")
        # Upstream intentionally ignores environment settings for loopback OpenAI endpoints.
        # Substitute the test CA at the bundle lookup, keeping certificate verification intact.
        with patch("certifi.where", return_value=os.environ["SSL_CERT_FILE"]):
            provider = providers.build("android-test/model", {"android-test": config})
        reply = provider.complete("test", [{"role": "user", "content": "hello"}], [])
        assert any(block.get("text") == "ANDROID_OK" for block in reply.content)
        assert requests[0][0] == "/v1/chat/completions"
        assert requests[0][1]["model"] == "model"
        print("PASS: upstream OpenAI-compatible provider over verified HTTPS (mock model)", flush=True)
        app = Application(cwd, lambda event: None)
        app.session._provider = app.session._cheap = provider
        app.session.rename('Android GUI bridge test')
        app.dispatch('turn', {'text':'verify the Android core adapter'})
        app.worker.join(30)
        snapshot = app.snapshot()
        assert not snapshot['busy'] and snapshot['leaf']
        assert snapshot['history'][-1]['content'][-1]['text'] == 'ANDROID_OK'
        assert not {'kaipi.cli', 'kaipi.tui', 'kaipi.server', 'kaipi.views', 'prompt_toolkit', 'typer'} & sys.modules.keys()
        app.dispatch('appearance', {'mode':'dark','color':'indigo'})
        assert app.snapshot()['appearance'] == {'mode':'dark','color':'indigo'}
        print('PASS: Android adapter → core → HTTPS model → saved history, headless imports, theme preferences', flush=True)
        provider.client.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
