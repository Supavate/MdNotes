from __future__ import annotations

import json
import errno
import os
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, urlparse


if getattr(sys, "frozen", False):
    ROOT = Path(sys.executable).resolve().parent
    SOURCE_DIR = Path(getattr(sys, "_MEIPASS")) / "src"
else:
    ROOT = Path(__file__).resolve().parent.parent
    SOURCE_DIR = ROOT / "src"
DATA_DIR = (ROOT / "data").resolve()
ORDER_FILE = ROOT / ".notes-order.json"
EXTERNAL_CONFIG_FILE = ROOT / "config.json"
CONFIG_FILE = (
    EXTERNAL_CONFIG_FILE
    if getattr(sys, "frozen", False) and EXTERNAL_CONFIG_FILE.is_file()
    else SOURCE_DIR / "config.json"
)
MAX_BODY_SIZE = 5 * 1024 * 1024
TEXT_EXTENSIONS = {".md", ".markdown", ".txt"}


def load_server_config() -> dict[str, object]:
    try:
        config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not read server configuration at {CONFIG_FILE}: {exc}") from exc
    if not isinstance(config, dict):
        raise RuntimeError("The application configuration must be a JSON object.")
    server_config = config.get("server")
    if not isinstance(server_config, dict):
        raise RuntimeError("The application configuration must include a server object.")
    default_port = server_config.get("defaultPort")
    search_attempts = server_config.get("portSearchAttempts")
    open_browser = server_config.get("openBrowser")
    if not isinstance(default_port, int) or isinstance(default_port, bool) or not 1 <= default_port <= 65535:
        raise RuntimeError("server.defaultPort must be an integer from 1 to 65535.")
    if not isinstance(search_attempts, int) or isinstance(search_attempts, bool) or not 1 <= search_attempts <= 65535:
        raise RuntimeError("server.portSearchAttempts must be an integer from 1 to 65535.")
    if not isinstance(open_browser, bool):
        raise RuntimeError("server.openBrowser must be true or false.")
    return server_config


def create_server(config: dict[str, object]) -> ThreadingHTTPServer:
    default_port = config["defaultPort"]
    search_attempts = config["portSearchAttempts"]
    if not isinstance(default_port, int) or not isinstance(search_attempts, int):
        raise RuntimeError("Server port configuration is invalid.")
    last_port = min(65535, default_port + search_attempts - 1)
    for port in range(default_port, last_port + 1):
        try:
            return ThreadingHTTPServer(("127.0.0.1", port), NotesHandler)
        except OSError as exc:
            if exc.errno not in {errno.EADDRINUSE, errno.EACCES, 10013, 10048}:
                raise
    raise RuntimeError(
        f"No available port found from {default_port} through {last_port}. "
        "Change server.defaultPort or server.portSearchAttempts in the configuration."
    )


def safe_path(relative_path: str) -> Path:
    if not relative_path:
        return DATA_DIR
    if "\\" in relative_path:
        raise ValueError("Backslashes are not allowed in paths.")
    parsed = PurePosixPath(relative_path)
    if parsed.is_absolute() or any(part in {"", ".", ".."} for part in parsed.parts):
        raise ValueError("Invalid path.")
    target = DATA_DIR.joinpath(*parsed.parts).resolve()
    if os.path.commonpath((str(DATA_DIR), str(target))) != str(DATA_DIR):
        raise ValueError("Path is outside the data folder.")
    return target


def relative_path(path: Path) -> str:
    return path.relative_to(DATA_DIR).as_posix()


def load_order() -> dict[str, list[str]]:
    if not ORDER_FILE.exists():
        return {}
    try:
        order = json.loads(ORDER_FILE.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise OSError(f"Could not read saved note ordering: {exc}") from exc
    if not isinstance(order, dict) or any(
        not isinstance(parent, str)
        or not isinstance(names, list)
        or any(not isinstance(name, str) for name in names)
        for parent, names in order.items()
    ):
        raise OSError("Saved note ordering has an invalid format.")
    return order


def save_order(order: dict[str, list[str]]) -> None:
    temporary_file = ORDER_FILE.with_suffix(".tmp")
    try:
        temporary_file.write_text(json.dumps(order, indent=2), encoding="utf-8")
        temporary_file.replace(ORDER_FILE)
    except OSError:
        if temporary_file.exists():
            temporary_file.unlink()
        raise


def tree_for(folder: Path, order: dict[str, list[str]] | None = None) -> list[dict[str, object]]:
    if order is None:
        order = load_order()
    items: list[dict[str, object]] = []
    for entry in sorted(folder.iterdir(), key=lambda item: (not item.is_dir(), item.name.casefold())):
        if entry.is_symlink():
            continue
        if entry.is_dir():
            items.append(
                {
                    "name": entry.name,
                    "path": relative_path(entry),
                    "type": "folder",
                    "children": tree_for(entry, order),
                }
            )
        elif entry.is_file() and entry.suffix.lower() in TEXT_EXTENSIONS:
            items.append(
                {"name": entry.name, "path": relative_path(entry), "type": "file"}
            )
    folder_path = "" if folder == DATA_DIR else relative_path(folder)
    saved_names = order.get(folder_path, [])
    saved_positions = {name: index for index, name in enumerate(saved_names)}
    items.sort(
        key=lambda item: (
            0 if item["name"] in saved_positions else 1,
            saved_positions.get(item["name"], 0),
            not item["type"] == "folder",
            str(item["name"]).casefold(),
        )
    )
    return items


class NotesHandler(BaseHTTPRequestHandler):
    def _send_json(self, status: int, payload: object) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, object]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Invalid request body size.") from exc
        if length <= 0 or length > MAX_BODY_SIZE:
            raise ValueError("Request body must be between 1 byte and 5 MB.")
        try:
            payload = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Request body must contain valid JSON.") from exc
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload

    def _path_from_query(self) -> Path:
        query = parse_qs(urlparse(self.path).query)
        values = query.get("path", [""])
        return safe_path(values[0])

    def do_GET(self) -> None:
        try:
            request = urlparse(self.path)
            if request.path == "/api/tree":
                self._send_json(200, tree_for(DATA_DIR))
                return
            if request.path == "/api/order":
                self._send_json(200, load_order())
                return
            if request.path == "/api/file":
                path = self._path_from_query()
                if not path.is_file() or path.suffix.lower() not in TEXT_EXTENSIONS:
                    self._send_json(404, {"error": "Note not found."})
                    return
                self._send_json(
                    200, {"path": relative_path(path), "content": path.read_text(encoding="utf-8")}
                )
                return
            static_files = {
                "/": ("index.html", "text/html; charset=utf-8"),
                "/index.html": ("index.html", "text/html; charset=utf-8"),
                "/styles.css": ("styles.css", "text/css; charset=utf-8"),
                "/config.json": ("config.json", "application/json; charset=utf-8"),
                "/app.bundle.js": ("app.bundle.js", "text/javascript; charset=utf-8"),
            }
            if request.path in static_files:
                filename, content_type = static_files[request.path]
                self._send_static(filename, content_type)
                return
            self._send_json(404, {"error": "Not found."})
        except (ValueError, OSError, UnicodeError) as exc:
            self._send_json(400, {"error": str(exc)})

    def _send_static(self, filename: str, content_type: str) -> None:
        source = CONFIG_FILE if filename == "config.json" and CONFIG_FILE.is_file() else SOURCE_DIR / filename
        body = source.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        try:
            payload = self._read_json()
            path_value = payload.get("path")
            if not isinstance(path_value, str):
                raise ValueError("A path is required.")
            path = safe_path(path_value)
            if self.path == "/api/file":
                content = payload.get("content")
                if not isinstance(content, str):
                    raise ValueError("Note content must be text.")
                if path.suffix.lower() not in TEXT_EXTENSIONS:
                    raise ValueError("Use a .md, .markdown, or .txt file.")
                if path.exists():
                    self._send_json(409, {"error": "That path already exists."})
                    return
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
                self._send_json(201, {"path": relative_path(path)})
                return
            if self.path == "/api/folder":
                if path.exists():
                    self._send_json(409, {"error": "That path already exists."})
                    return
                path.mkdir(parents=True, exist_ok=False)
                self._send_json(201, {"path": relative_path(path)})
                return
            self._send_json(404, {"error": "Not found."})
        except (ValueError, OSError) as exc:
            self._send_json(400, {"error": str(exc)})

    def do_PUT(self) -> None:
        try:
            request_path = urlparse(self.path).path
            if request_path == "/api/order":
                payload = self._read_json()
                folder_value = payload.get("folder")
                names = payload.get("items")
                if not isinstance(folder_value, str) or not isinstance(names, list):
                    raise ValueError("A folder path and ordered item list are required.")
                if any(not isinstance(name, str) or not name or "/" in name or "\\" in name for name in names):
                    raise ValueError("Ordered item names must be direct children of the folder.")
                if len(names) != len(set(names)):
                    raise ValueError("An item can appear only once in an order.")
                folder = safe_path(folder_value)
                if not folder.is_dir():
                    self._send_json(404, {"error": "Folder not found."})
                    return
                actual_names = {
                    entry.name
                    for entry in folder.iterdir()
                    if not entry.is_symlink()
                    and (
                        entry.is_dir()
                        or (entry.is_file() and entry.suffix.lower() in TEXT_EXTENSIONS)
                    )
                }
                if set(names) != actual_names:
                    raise ValueError("The ordered items must match the folder's current notes and subfolders.")
                order = load_order()
                order[folder_value] = names
                save_order(order)
                self._send_json(200, {"folder": folder_value, "items": names})
                return
            if request_path != "/api/file":
                self._send_json(404, {"error": "Not found."})
                return
            payload = self._read_json()
            path_value = payload.get("path")
            content = payload.get("content")
            if not isinstance(path_value, str) or not isinstance(content, str):
                raise ValueError("A note path and text content are required.")
            path = safe_path(path_value)
            if not path.is_file() or path.suffix.lower() not in TEXT_EXTENSIONS:
                self._send_json(404, {"error": "Note not found."})
                return
            path.write_text(content, encoding="utf-8")
            self._send_json(200, {"path": relative_path(path)})
        except (ValueError, OSError) as exc:
            self._send_json(400, {"error": str(exc)})

    def do_PATCH(self) -> None:
        try:
            if self.path != "/api/item":
                self._send_json(404, {"error": "Not found."})
                return
            payload = self._read_json()
            source_value = payload.get("source")
            destination_value = payload.get("destination")
            if not isinstance(source_value, str) or not isinstance(destination_value, str):
                raise ValueError("Source and destination paths are required.")
            source = safe_path(source_value)
            destination = safe_path(destination_value)
            if not source.exists() or source == DATA_DIR:
                self._send_json(404, {"error": "Item not found."})
                return
            if source.is_file() and source.suffix.lower() not in TEXT_EXTENSIONS:
                raise ValueError("Only text notes can be moved or renamed.")
            if source.is_file() and destination.suffix.lower() not in TEXT_EXTENSIONS:
                raise ValueError("Notes must keep a .md, .markdown, or .txt extension.")
            if destination.exists():
                self._send_json(409, {"error": "That destination already exists."})
                return
            if source.is_dir() and os.path.commonpath((str(source), str(destination))) == str(source):
                raise ValueError("A folder cannot be moved inside itself.")
            if not destination.parent.is_dir():
                raise ValueError("The destination folder does not exist.")
            source_parent = "" if source.parent == DATA_DIR else relative_path(source.parent)
            destination_parent = "" if destination.parent == DATA_DIR else relative_path(destination.parent)
            source_relative = relative_path(source)
            destination_relative = relative_path(destination)
            order = load_order()
            source.rename(destination)
            if source.is_dir() or destination.is_dir():
                updated_order: dict[str, list[str]] = {}
                for parent, names in order.items():
                    if parent == source_relative or parent.startswith(f"{source_relative}/"):
                        parent = f"{destination_relative}{parent[len(source_relative):]}"
                    updated_order[parent] = names
                order = updated_order
            if source_parent == destination_parent:
                names = order.get(source_parent, [])
                order[source_parent] = [
                    destination.name if name == source.name else name for name in names
                ]
            else:
                order[source_parent] = [
                    name for name in order.get(source_parent, []) if name != source.name
                ]
                destination_order = order.get(destination_parent, [])
                if destination.name not in destination_order:
                    destination_order.append(destination.name)
                order[destination_parent] = destination_order
            save_order(order)
            self._send_json(200, {"path": relative_path(destination)})
        except (ValueError, OSError) as exc:
            self._send_json(400, {"error": str(exc)})

    def log_message(self, format_string: str, *args: object) -> None:
        print("%s - %s" % (self.address_string(), format_string % args))


def main() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    config = load_server_config()
    server = create_server(config)
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"Markdown Notes is running at {url}")
    if config["openBrowser"]:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Markdown Notes.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
