"""Run with the APK's Python under adb run-as. Uses isolated temp data and a local mock HTTP endpoint."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

assert hasattr(sys, "getandroidapilevel"), "This test must run on Android"
from importlib.metadata import version
import jiter
from pydantic import BaseModel
from kaipi import agent, guard, providers
from kaipi.cli import Session


class Record(BaseModel):
    text: str


assert Record.model_validate_json('{"text":"你好"}').text == "你好"
assert jiter.from_json(b'{"ok":true}') == {"ok": True}
print("PASS: Android CPython, native dependencies and upstream kaipi", version("kaipi"), flush=True)

with tempfile.TemporaryDirectory() as directory:
    cwd = Path(directory)
    os.environ["XDG_CONFIG_HOME"] = str(cwd / "config")
    subprocess.run(["git", "init", "--template=", "-q", str(cwd)], check=True)
    assert agent.run_bash("printf terminal-ok", cwd) == "terminal-ok"
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
            payload = json.dumps({"choices": [{"message": {"role": "assistant", "content": "ANDROID_OK"}, "finish_reason": "stop"}],
                                  "usage": {"prompt_tokens": 3, "completion_tokens": 2}}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Endpoint)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        os.environ["KAIPI_ANDROID_TEST_KEY"] = "local-test"
        config = providers.ProviderConfig(api="openai-chat", base_url=f"http://127.0.0.1:{server.server_port}/v1", api_key_env="KAIPI_ANDROID_TEST_KEY")
        provider = providers.build("android-test/model", {"android-test": config})
        reply = provider.complete("test", [{"role": "user", "content": "hello"}], [])
        assert any(block.get("text") == "ANDROID_OK" for block in reply.content)
        assert requests[0][0] == "/v1/chat/completions"
        assert requests[0][1]["model"] == "model"
        print("PASS: upstream provider using real Android HTTP (mock model, no external API claim)", flush=True)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
