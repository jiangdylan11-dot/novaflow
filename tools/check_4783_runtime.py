from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import asdict, dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


RUNTIME_URL = "http://127.0.0.1:4783/"
UPSTREAM_URL = "http://127.0.0.1:8188/"
DIST_RENDERER_DIR = Path("particle-editor-desktop/dist/win-unpacked/resources/app/renderer")
SOURCE_RENDERER_DIR = Path("particle-editor-desktop/renderer")
PARTICLE_EDITOR_DIR = Path("particle-editor")
PARTICLE_EDITOR_INDEX = Path("particle-editor/index.html")
WORKSPACE_PACKAGE_JSON = Path("package.json")
ENTRY_LOCK_DOC = Path("ENTRY_LOCK.md")
PROJECT_ENTRY_LOCK = Path("particle-editor/PROJECT_ENTRY_LOCK.md")
RUNTIME_SURFACE_HASH_SNAPSHOT = Path("RUNTIME_SURFACE_HASH_SNAPSHOT.json")
DEFAULT_TIMEOUT = 3.0
TAKEOVER_SCRIPT = "aifx-repaint-runtime.js"
# The AIFX generation workflow modules were retired on 2026-09-16; only the UI shell is served.
REQUIRED_AIFX_SCRIPTS = (TAKEOVER_SCRIPT,)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def relative_url_to_path(url: str) -> str | None:
    parsed = urlparse(url)
    if parsed.scheme or parsed.netloc:
        return None
    if url.startswith("//"):
        return None
    path = parsed.path.strip()
    if not path or path.startswith("/"):
        return None
    return path.lstrip("./")


class LocalAssetParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.local_assets: list[str] = []
        self.module_scripts: list[str] = []
        self.script_refs: list[str] = []
        self._seen: set[str] = set()
        self._seen_scripts: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = {key.lower(): value for key, value in attrs}
        candidate: str | None = None
        if tag.lower() == "script":
            candidate = attrs_map.get("src")
            if candidate:
                local_path = relative_url_to_path(candidate)
                script_type = (attrs_map.get("type") or "").lower()
                if local_path and script_type == "module":
                    self.module_scripts.append(local_path)
                if local_path and local_path not in self._seen_scripts:
                    self._seen_scripts.add(local_path)
                    self.script_refs.append(local_path)
        elif tag.lower() == "link":
            candidate = attrs_map.get("href")

        if not candidate:
            return

        local_path = relative_url_to_path(candidate)
        if not local_path or local_path in self._seen:
            return
        self._seen.add(local_path)
        self.local_assets.append(local_path)


@dataclass
class HttpCheck:
    ok: bool
    url: str
    status: int | None
    body_preview: str | None
    error: str | None
    sha256: str | None = None


@dataclass
class FileComparison:
    path: str
    dist_exists: bool
    source_exists: bool
    match: bool
    dist_sha256: str | None
    source_sha256: str | None
    note: str | None = None


@dataclass
class BundleContentCheck:
    label: str
    path: str
    exists: bool
    match_runtime: bool
    sha256: str | None
    note: str | None = None


@dataclass
class IndexInspection:
    script_refs: list[str]
    local_assets: list[str]
    module_scripts: list[str]
    main_bundle: str | None
    references_takeover_script: bool
    required_aifx_scripts: dict[str, bool]


@dataclass
class VerificationReport:
    runtime_url: str
    upstream_url: str
    runtime_index: HttpCheck
    runtime_health: HttpCheck
    upstream_probe: HttpCheck
    runtime_index_matches: dict[str, bool]
    active_runtime_root: str | None
    runtime_script_refs: list[str]
    dist_index_script_refs: list[str]
    source_index_script_refs: list[str]
    active_runtime_assets: list[str]
    surface_sync: list[FileComparison]
    particle_editor_bundle_match: bool | None
    particle_editor_bundle_runtime: str | None
    particle_editor_bundle_source: str | None
    main_bundle_content_match: bool
    main_bundle_content_sync: list[BundleContentCheck]
    takeover_script: str
    required_aifx_scripts: list[str]
    takeover_checks: dict[str, bool]
    takeover_failures: list[str]
    policy_checks: dict[str, bool]
    policy_failures: list[str]
    ok: bool
    notes: list[str] = field(default_factory=list)


def fetch_url(url: str, timeout: float = DEFAULT_TIMEOUT) -> HttpCheck:
    request = Request(url, headers={"Accept": "text/html,application/json;q=0.9,*/*;q=0.8"}, method="GET")
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read()
            preview = body[:240].decode("utf-8", errors="replace")
            return HttpCheck(
                ok=200 <= response.status < 400,
                url=url,
                status=response.status,
                body_preview=preview,
                error=None,
                sha256=sha256_bytes(body),
            )
    except HTTPError as exc:
        body = exc.read()
        preview = body[:240].decode("utf-8", errors="replace")
        return HttpCheck(
            ok=False,
            url=url,
            status=exc.code,
            body_preview=preview,
            error=f"HTTP {exc.code}",
            sha256=sha256_bytes(body),
        )
    except URLError as exc:
        return HttpCheck(ok=False, url=url, status=None, body_preview=None, error=str(exc.reason), sha256=None)
    except Exception as exc:  # pragma: no cover
        return HttpCheck(ok=False, url=url, status=None, body_preview=None, error=str(exc), sha256=None)


def probe_reachability(url: str, timeout: float = DEFAULT_TIMEOUT) -> HttpCheck:
    request = Request(url, headers={"Accept": "*/*"}, method="GET")
    try:
        with urlopen(request, timeout=timeout) as response:
            body = response.read()
            preview = body[:240].decode("utf-8", errors="replace")
            return HttpCheck(
                ok=True,
                url=url,
                status=response.status,
                body_preview=preview,
                error=None,
                sha256=sha256_bytes(body),
            )
    except HTTPError as exc:
        body = exc.read()
        preview = body[:240].decode("utf-8", errors="replace")
        return HttpCheck(
            ok=True,
            url=url,
            status=exc.code,
            body_preview=preview,
            error=f"HTTP {exc.code}",
            sha256=sha256_bytes(body),
        )
    except URLError as exc:
        return HttpCheck(ok=False, url=url, status=None, body_preview=None, error=str(exc.reason), sha256=None)
    except Exception as exc:  # pragma: no cover
        return HttpCheck(ok=False, url=url, status=None, body_preview=None, error=str(exc), sha256=None)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def load_runtime_surface_hash_snapshot() -> dict[str, dict]:
    if not RUNTIME_SURFACE_HASH_SNAPSHOT.is_file():
        return {}
    try:
        snapshot = read_json(RUNTIME_SURFACE_HASH_SNAPSHOT)
    except Exception:
        return {}
    entries = snapshot.get("entries")
    if not isinstance(entries, list):
        return {}
    result: dict[str, dict] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        relative_path = entry.get("path")
        if isinstance(relative_path, str) and relative_path:
            result[relative_path] = entry
    return result


def inspect_index_text(index_text: str) -> IndexInspection:
    parser = LocalAssetParser()
    parser.feed(index_text)
    main_bundle = parser.module_scripts[0] if parser.module_scripts else None
    return IndexInspection(
        script_refs=parser.script_refs,
        local_assets=parser.local_assets,
        module_scripts=parser.module_scripts,
        main_bundle=main_bundle,
        references_takeover_script=(TAKEOVER_SCRIPT in parser.script_refs) or (TAKEOVER_SCRIPT in index_text),
        required_aifx_scripts={
            script: (script in parser.script_refs) or (script in index_text)
            for script in REQUIRED_AIFX_SCRIPTS
        },
    )


def compare_surface_files(root_a: Path, root_b: Path, relative_paths: list[str], hash_snapshot: dict[str, dict]) -> list[FileComparison]:
    comparisons: list[FileComparison] = []
    for relative_path in relative_paths:
        dist_path = root_a / relative_path
        source_path = root_b / relative_path
        dist_exists = dist_path.is_file()
        source_exists = source_path.is_file()
        match = False
        dist_digest = sha256_file(dist_path) if dist_exists else None
        source_digest = sha256_file(source_path) if source_exists else None
        note: str | None = None
        if dist_exists and source_exists:
            match = dist_digest == source_digest
            if not match:
                note = "sha256 differs"
                snapshot_entry = hash_snapshot.get(relative_path)
                if (
                    isinstance(snapshot_entry, dict)
                    and snapshot_entry.get("owner") == "dist_renderer"
                    and snapshot_entry.get("acceptActiveSurfaceDistHash") is True
                    and snapshot_entry.get("distSha256") == dist_digest
                    and snapshot_entry.get("sourceSha256") == source_digest
                ):
                    match = True
                    note = "accepted by runtime surface hash snapshot: dist_renderer owner"
        elif not dist_exists and not source_exists:
            note = "missing in both roots"
        elif not dist_exists:
            note = "missing in dist renderer"
        else:
            note = "missing in source renderer"
        comparisons.append(
            FileComparison(
                path=relative_path,
                dist_exists=dist_exists,
                source_exists=source_exists,
                match=match,
                dist_sha256=dist_digest,
                source_sha256=source_digest,
                note=note,
            )
        )
    return comparisons


def compare_main_bundle_content(relative_path: str | None) -> tuple[bool, list[BundleContentCheck]]:
    if not relative_path:
        return False, [
            BundleContentCheck(
                label="runtime served",
                path="(missing main bundle reference)",
                exists=False,
                match_runtime=False,
                sha256=None,
                note="runtime index did not expose a module bundle",
            )
        ]

    runtime_url = urljoin(RUNTIME_URL, relative_path)
    runtime_asset = fetch_url(runtime_url)
    runtime_sha = runtime_asset.sha256 if runtime_asset.ok else None
    checks: list[BundleContentCheck] = [
        BundleContentCheck(
            label="runtime served",
            path=runtime_url,
            exists=runtime_asset.ok,
            match_runtime=runtime_asset.ok,
            sha256=runtime_sha,
            note=runtime_asset.error,
        )
    ]

    for label, root in (
        ("particle-editor", PARTICLE_EDITOR_DIR),
        ("desktop renderer", SOURCE_RENDERER_DIR),
        ("dist renderer", DIST_RENDERER_DIR),
    ):
        path = root / relative_path
        exists = path.is_file()
        digest = sha256_file(path) if exists else None
        match_runtime = bool(runtime_sha and digest == runtime_sha)
        note: str | None = None
        if not exists:
            note = "missing"
        elif not match_runtime:
            note = "sha256 differs from runtime served bundle"
        checks.append(
            BundleContentCheck(
                label=label,
                path=path.as_posix(),
                exists=exists,
                match_runtime=match_runtime,
                sha256=digest,
                note=note,
            )
        )

    return bool(runtime_sha and all(item.exists and item.match_runtime for item in checks)), checks


def determine_active_root(runtime_index_sha: str | None, dist_index: Path, source_index: Path) -> tuple[dict[str, bool], str | None]:
    matches = {"dist_renderer": False, "source_renderer": False}
    if runtime_index_sha is None:
        return matches, None

    if dist_index.is_file():
        matches["dist_renderer"] = runtime_index_sha == sha256_file(dist_index)
    if source_index.is_file():
        matches["source_renderer"] = runtime_index_sha == sha256_file(source_index)

    if matches["dist_renderer"] and matches["source_renderer"]:
        return matches, "both"
    if matches["dist_renderer"]:
        return matches, "dist_renderer"
    if matches["source_renderer"]:
        return matches, "source_renderer"
    return matches, None


def verify_locked_policy() -> tuple[dict[str, bool], list[str]]:
    checks: dict[str, bool] = {}
    failures: list[str] = []

    if not WORKSPACE_PACKAGE_JSON.is_file():
        failures.append(f"Missing {WORKSPACE_PACKAGE_JSON.as_posix()}.")
        return checks, failures

    try:
        workspace_package = read_json(WORKSPACE_PACKAGE_JSON)
    except Exception as exc:  # pragma: no cover
        failures.append(f"Could not parse {WORKSPACE_PACKAGE_JSON.as_posix()}: {exc}")
        return checks, failures

    scripts = workspace_package.get("scripts")
    if not isinstance(scripts, dict):
        failures.append("Root package.json does not contain a usable scripts object.")
        return checks, failures

    dev_script = str(scripts.get("dev", ""))
    dev_runtime_script = str(scripts.get("dev:runtime", ""))
    dev_source_script = str(scripts.get("dev:source", ""))
    build_script = str(scripts.get("build", ""))
    check_entry_script = str(scripts.get("check:entry", ""))

    checks["workspace_dev_locked_4783"] = "--port 4783" in dev_script and "dist/win-unpacked/resources/app/renderer" in dev_script
    checks["workspace_dev_runtime_locked_4783"] = "--port 4783" in dev_runtime_script and "dist/win-unpacked/resources/app/renderer" in dev_runtime_script
    checks["workspace_dev_source_retired"] = "4783" in dev_source_script and "5173" not in dev_source_script and "retired" in dev_source_script.lower()
    checks["workspace_build_uses_renderer_pipeline"] = "build:renderer" in build_script and "particle-editor run build" not in build_script
    checks["workspace_check_entry_uses_locked_verifier"] = "tools/check_4783_runtime.py" in check_entry_script

    if ENTRY_LOCK_DOC.is_file():
        entry_lock_text = read_text(ENTRY_LOCK_DOC)
        checks["entry_lock_names_4783_only"] = "http://127.0.0.1:4783/" in entry_lock_text
        checks["entry_lock_retires_alt_ports"] = "retired validation paths" in entry_lock_text and "5173" in entry_lock_text and "4173" in entry_lock_text
    else:
        failures.append(f"Missing {ENTRY_LOCK_DOC.as_posix()}.")

    if PROJECT_ENTRY_LOCK.is_file():
        project_entry_lock_text = read_text(PROJECT_ENTRY_LOCK)
        checks["project_lock_names_4783_only"] = "http://127.0.0.1:4783/" in project_entry_lock_text
        checks["project_lock_retires_source_lane"] = "retired by design" in project_entry_lock_text and "5173" in project_entry_lock_text and "4173" in project_entry_lock_text
    else:
        failures.append(f"Missing {PROJECT_ENTRY_LOCK.as_posix()}.")

    for check_name, passed in checks.items():
        if not passed:
            failures.append(f"Policy check failed: {check_name}")

    return checks, failures


def verify() -> VerificationReport:
    runtime_index = fetch_url(RUNTIME_URL)
    runtime_health = fetch_url(urljoin(RUNTIME_URL, "__runtime_health"))
    upstream_probe = probe_reachability(UPSTREAM_URL, timeout=1.5)
    policy_checks, policy_failures = verify_locked_policy()

    dist_index = DIST_RENDERER_DIR / "index.html"
    source_index = SOURCE_RENDERER_DIR / "index.html"
    runtime_index_matches, active_runtime_root = determine_active_root(runtime_index.sha256, dist_index, source_index)

    notes: list[str] = []
    surface_hash_snapshot = load_runtime_surface_hash_snapshot()
    runtime_index_text: str | None = None
    runtime_script_refs: list[str] = []
    dist_index_script_refs: list[str] = []
    source_index_script_refs: list[str] = []
    active_runtime_assets: list[str] = []
    surface_sync: list[FileComparison] = []
    particle_editor_bundle_match: bool | None = None
    particle_editor_bundle_runtime: str | None = None
    particle_editor_bundle_source: str | None = None
    main_bundle_content_match = False
    main_bundle_content_sync: list[BundleContentCheck] = []
    takeover_checks: dict[str, bool] = {}
    takeover_failures: list[str] = []
    dist_index_inspection: IndexInspection | None = None
    source_index_inspection: IndexInspection | None = None
    particle_editor_index_inspection: IndexInspection | None = None

    if runtime_index.ok:
        try:
            runtime_index_text = fetch_full_text(RUNTIME_URL)
        except Exception as exc:  # pragma: no cover
            notes.append(f"Runtime index re-fetch failed: {exc}")
    else:
        notes.append("Runtime index was not reachable; bundle and surface checks fall back to failure reporting.")

    if dist_index.is_file():
        dist_index_inspection = inspect_index_text(read_text(dist_index))
        dist_index_script_refs = dist_index_inspection.script_refs
    else:
        notes.append(f"Missing {dist_index.as_posix()}.")

    if source_index.is_file():
        source_index_inspection = inspect_index_text(read_text(source_index))
        source_index_script_refs = source_index_inspection.script_refs
    else:
        notes.append(f"Missing {source_index.as_posix()}.")

    if runtime_index_text:
        runtime_index_inspection = inspect_index_text(runtime_index_text)
        runtime_script_refs = runtime_index_inspection.script_refs
        active_runtime_assets = runtime_index_inspection.local_assets
        particle_editor_bundle_runtime = runtime_index_inspection.main_bundle
        surface_paths = ["index.html", *active_runtime_assets]
        surface_sync = compare_surface_files(DIST_RENDERER_DIR, SOURCE_RENDERER_DIR, surface_paths, surface_hash_snapshot)
    else:
        runtime_index_inspection = None
        surface_sync = [
            FileComparison(
                path="index.html",
                dist_exists=dist_index.is_file(),
                source_exists=source_index.is_file(),
                match=False,
                dist_sha256=sha256_file(dist_index) if dist_index.is_file() else None,
                source_sha256=sha256_file(source_index) if source_index.is_file() else None,
                note="runtime index unavailable",
            )
        ]

    if PARTICLE_EDITOR_INDEX.is_file():
        particle_editor_text = read_text(PARTICLE_EDITOR_INDEX)
        particle_editor_index_inspection = inspect_index_text(particle_editor_text)
        particle_editor_bundle_source = particle_editor_index_inspection.main_bundle
        if particle_editor_bundle_runtime and particle_editor_bundle_source:
            particle_editor_bundle_match = particle_editor_bundle_runtime == particle_editor_bundle_source
        else:
            particle_editor_bundle_match = False
            notes.append("Could not extract a module bundle reference from runtime or particle-editor index.html.")
    else:
        notes.append(f"Missing {PARTICLE_EDITOR_INDEX.as_posix()}.")

    main_bundle_content_match, main_bundle_content_sync = compare_main_bundle_content(particle_editor_bundle_runtime)

    takeover_checks = {
        "dist_takeover_script_exists": (DIST_RENDERER_DIR / TAKEOVER_SCRIPT).is_file(),
        "source_takeover_script_exists": (SOURCE_RENDERER_DIR / TAKEOVER_SCRIPT).is_file(),
        "dist_index_references_takeover_script": bool(dist_index_inspection and dist_index_inspection.references_takeover_script),
        "source_index_references_takeover_script": bool(source_index_inspection and source_index_inspection.references_takeover_script),
        "runtime_served_html_references_takeover_script": bool(
            runtime_index_inspection and runtime_index_inspection.references_takeover_script
        ),
    }
    for script in REQUIRED_AIFX_SCRIPTS:
        check_prefix = script.replace(".", "_").replace("-", "_")
        particle_path = PARTICLE_EDITOR_DIR / script
        desktop_path = SOURCE_RENDERER_DIR / script
        dist_path = DIST_RENDERER_DIR / script
        particle_exists = particle_path.is_file()
        desktop_exists = desktop_path.is_file()
        dist_exists = dist_path.is_file()
        source_digest = sha256_file(particle_path) if particle_exists else None
        desktop_digest = sha256_file(desktop_path) if desktop_exists else None
        dist_digest = sha256_file(dist_path) if dist_exists else None
        runtime_asset = fetch_url(urljoin(RUNTIME_URL, script))
        takeover_checks.update({
            f"{check_prefix}_particle_source_exists": particle_exists,
            f"{check_prefix}_desktop_renderer_exists": desktop_exists,
            f"{check_prefix}_dist_renderer_exists": dist_exists,
            f"{check_prefix}_three_way_hash_match": bool(
                source_digest
                and source_digest == desktop_digest
                and source_digest == dist_digest
            ),
            f"{check_prefix}_particle_index_reference": bool(
                particle_editor_index_inspection
                and particle_editor_index_inspection.required_aifx_scripts.get(script)
            ),
            f"{check_prefix}_desktop_index_reference": bool(
                source_index_inspection
                and source_index_inspection.required_aifx_scripts.get(script)
            ),
            f"{check_prefix}_dist_index_reference": bool(
                dist_index_inspection
                and dist_index_inspection.required_aifx_scripts.get(script)
            ),
            f"{check_prefix}_runtime_index_reference": bool(
                runtime_index_inspection
                and runtime_index_inspection.required_aifx_scripts.get(script)
            ),
            f"{check_prefix}_runtime_get_200": runtime_asset.ok and runtime_asset.status == 200,
            f"{check_prefix}_runtime_hash_matches_source": bool(
                runtime_asset.ok
                and source_digest
                and runtime_asset.sha256 == source_digest
            ),
        })
    takeover_failures = [f"Takeover check failed: {check_name}" for check_name, passed in takeover_checks.items() if not passed]

    if runtime_health.status is not None:
        if runtime_health.ok:
            notes.append("`/__runtime_health` returned success, which means the preview server could reach its configured upstream.")
        else:
            notes.append("`/__runtime_health` responded with a non-success status, which still reports upstream state through the preview server.")
    else:
        notes.append("`/__runtime_health` did not respond, so upstream reachability is not available through the preview server.")

    if upstream_probe.ok:
        notes.append("Direct probe to `127.0.0.1:8188` succeeded.")
    else:
        notes.append("Direct probe to `127.0.0.1:8188` did not succeed.")

    if policy_failures:
        notes.append("Locked 4783-only policy drift was detected in scripts or lock files.")
    else:
        notes.append("Locked 4783-only policy checks passed.")

    if takeover_failures:
        notes.append(f"AI effects takeover integration is incomplete for `{TAKEOVER_SCRIPT}`.")
    else:
        notes.append(f"AI effects takeover integration is present for `{TAKEOVER_SCRIPT}`.")

    surface_ok = all(item.match for item in surface_sync)
    overall_ok = bool(
        runtime_index.ok
        and runtime_health.status is not None
        and surface_ok
        and particle_editor_bundle_match
        and main_bundle_content_match
        and not takeover_failures
        and not policy_failures
    )

    return VerificationReport(
        runtime_url=RUNTIME_URL,
        upstream_url=UPSTREAM_URL,
        runtime_index=runtime_index,
        runtime_health=runtime_health,
        upstream_probe=upstream_probe,
        runtime_index_matches=runtime_index_matches,
        active_runtime_root=active_runtime_root,
        runtime_script_refs=runtime_script_refs,
        dist_index_script_refs=dist_index_script_refs,
        source_index_script_refs=source_index_script_refs,
        active_runtime_assets=active_runtime_assets,
        surface_sync=surface_sync,
        particle_editor_bundle_match=particle_editor_bundle_match,
        particle_editor_bundle_runtime=particle_editor_bundle_runtime,
        particle_editor_bundle_source=particle_editor_bundle_source,
        main_bundle_content_match=main_bundle_content_match,
        main_bundle_content_sync=main_bundle_content_sync,
        takeover_script=TAKEOVER_SCRIPT,
        required_aifx_scripts=list(REQUIRED_AIFX_SCRIPTS),
        takeover_checks=takeover_checks,
        takeover_failures=takeover_failures,
        policy_checks=policy_checks,
        policy_failures=policy_failures,
        ok=overall_ok,
        notes=notes,
    )


def fetch_full_text(url: str, timeout: float = DEFAULT_TIMEOUT) -> str:
    request = Request(url, headers={"Accept": "text/html,*/*;q=0.8"}, method="GET")
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def print_text_report(report: VerificationReport) -> None:
    print(f"Locked runtime URL: {report.runtime_url}")
    print(f"Locked upstream URL: {report.upstream_url}")
    print()
    print("Runtime index")
    print(f"  ok: {report.runtime_index.ok}")
    print(f"  status: {report.runtime_index.status}")
    print(f"  error: {report.runtime_index.error}")
    print(f"  sha256: {report.runtime_index.sha256}")
    print()
    print("Runtime health")
    print(f"  ok: {report.runtime_health.ok}")
    print(f"  status: {report.runtime_health.status}")
    print(f"  error: {report.runtime_health.error}")
    print(f"  body: {report.runtime_health.body_preview}")
    print()
    print("Direct upstream probe")
    print(f"  ok: {report.upstream_probe.ok}")
    print(f"  status: {report.upstream_probe.status}")
    print(f"  error: {report.upstream_probe.error}")
    print()
    print("Runtime index match")
    print(f"  dist renderer: {report.runtime_index_matches['dist_renderer']}")
    print(f"  source renderer: {report.runtime_index_matches['source_renderer']}")
    print(f"  active root: {report.active_runtime_root}")
    print()
    print("Runtime scripts")
    print(f"  served page scripts: {', '.join(report.runtime_script_refs) if report.runtime_script_refs else '(none)'}")
    print(f"  dist index scripts: {', '.join(report.dist_index_script_refs) if report.dist_index_script_refs else '(none)'}")
    print(f"  source index scripts: {', '.join(report.source_index_script_refs) if report.source_index_script_refs else '(none)'}")
    print()
    print("Active surface sync")
    for item in report.surface_sync:
        state = "OK" if item.match else "MISMATCH"
        print(f"  [{state}] {item.path}")
        if item.note:
            print(f"    note: {item.note}")
    print()
    print("Main bundle drift")
    print(f"  runtime bundle: {report.particle_editor_bundle_runtime}")
    print(f"  particle-editor bundle: {report.particle_editor_bundle_source}")
    print(f"  match: {report.particle_editor_bundle_match}")
    print()
    print("Main bundle content sync")
    print(f"  match: {report.main_bundle_content_match}")
    for item in report.main_bundle_content_sync:
        state = "OK" if item.match_runtime else "MISMATCH"
        print(f"  [{state}] {item.label}: {item.path}")
        print(f"    exists: {item.exists}")
        print(f"    sha256: {item.sha256}")
        if item.note:
            print(f"    note: {item.note}")
    print()
    print("AI effects takeover")
    print(f"  expected scripts: {', '.join(report.required_aifx_scripts)}")
    for check_name, passed in report.takeover_checks.items():
        state = "OK" if passed else "MISMATCH"
        print(f"  [{state}] {check_name}")
    if report.takeover_failures:
        print("  failures:")
        for failure in report.takeover_failures:
            print(f"    - {failure}")
    print()
    print("Locked policy")
    for check_name, passed in report.policy_checks.items():
        state = "OK" if passed else "MISMATCH"
        print(f"  [{state}] {check_name}")
    if report.policy_failures:
        print("  failures:")
        for failure in report.policy_failures:
            print(f"    - {failure}")
    print()
    print(f"Overall: {'GO' if report.ok else 'NO-GO'}")
    if report.notes:
        print("Notes")
        for note in report.notes:
            print(f"  - {note}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify the locked 4783 preview runtime assumptions.")
    parser.add_argument("--json", action="store_true", help="Emit the verification result as JSON.")
    args = parser.parse_args(argv)

    report = verify()
    if args.json:
        json.dump(asdict(report), sys.stdout, indent=2)
        sys.stdout.write("\n")
    else:
        print_text_report(report)
    return 0 if report.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
