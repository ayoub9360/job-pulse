"""Offline Docker integration: lifecycle, persistence, permissions, exit status."""
import http.server
import json
import os
import pathlib
import subprocess
import tempfile
import threading
import time
import uuid

image = os.environ.get("SMOKE_IMAGE", "job-watcher-community:verify")
name = "job-watcher-smoke-" + uuid.uuid4().hex[:12]
volume = name + "-data"
notifications = []
request_started = threading.Event()
slow = False


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        if self.path.startswith("/fail"):
            self.send_response(503)
            self.end_headers()
            return
        if slow:
            request_started.set()
            time.sleep(1)
        self.send_response(200)
        self.end_headers()
        identifier = "second" if slow else "first"
        self.wfile.write((f'<a href="/fr/tech-it/job-mission/example/{identifier}">'
                         '<h3>TypeScript developer</h3><header><span class="tag">Freelance</span>'
                         '</header><div>500 €</div></a>').encode())

    def do_POST(self):
        notifications.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        self.send_response(204)
        self.end_headers()


def docker(*args, check=True):
    result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=90)
    if check and result.returncode:
        raise RuntimeError(result.stderr + result.stdout)
    return result


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
threading.Thread(target=server.serve_forever, daemon=True).start()
origin = f"http://127.0.0.1:{server.server_port}"
try:
    docker("volume", "create", volume)
    with tempfile.TemporaryDirectory(prefix="job-watcher-smoke-") as folder:
        os.chmod(folder, 0o755)
        config_path = pathlib.Path(folder) / "config.yaml"
        config = {
            "providers": {"freeWork": {"baseUrl": origin + "/jobs"}},
            "watchers": [{"name": "synthetic", "provider": "free-work", "queries": ["typescript"],
                          "webhookEnv": "TEST_WEBHOOK"}],
            "schedule": {"cron": "* * * * * *", "timezone": "UTC"},
            "runtime": {"userAgent": "JobWatcher/test", "retryCount": 0},
        }
        config_path.write_text(json.dumps(config))
        args = ["--network", "host", "-v", f"{config_path}:/app/config/config.yaml:ro",
                "-v", f"{volume}:/app/data", "-e", f"TEST_WEBHOOK={origin}/webhook"]
        assert docker("run", "--rm", image, "id", "-u").stdout.strip() == "1000"
        docker("run", "--rm", image, "sh", "-c", "test ! -e .env && test ! -e config/config.yaml && test ! -e .git")
        docker("run", "--rm", *args, image, "node", "dist/main.js", "--once")
        assert len(notifications) == 1, notifications
        docker("run", "--rm", *args, image, "node", "dist/main.js", "--once")
        assert len(notifications) == 1, "Restart resent persisted offers"
        config["providers"]["freeWork"]["baseUrl"] = origin + "/fail"
        config_path.write_text(json.dumps(config))
        failed = docker("run", "--rm", *args, image, "node", "dist/main.js", "--once", check=False)
        assert failed.returncode == 1 and "All provider searches failed" in failed.stdout
        config["providers"]["freeWork"]["baseUrl"] = origin + "/jobs"
        config_path.write_text(json.dumps(config))
        slow = True
        docker("run", "-d", "--name", name, *args, image)
        assert request_started.wait(15), "Scheduled run never started"
        docker("stop", "--time", "35", name)
        assert docker("inspect", "--format", "{{.State.ExitCode}}", name).stdout.strip() == "0"
        assert len(notifications) == 2, "Graceful stop interrupted active notification"
        docker("run", "--rm", *args, image, "node", "dist/main.js", "--once")
        assert len(notifications) == 2, "Graceful stop did not persist the active batch"
        assert all(n["allowed_mentions"]["parse"] == [] for n in notifications)
    print("Container smoke passed: non-root, clean image, offline delivery, restart deduplication, failure exit, graceful shutdown.")
finally:
    docker("rm", "-f", name, check=False)
    docker("volume", "rm", volume, check=False)
    server.shutdown()
    server.server_close()
