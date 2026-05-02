from __future__ import annotations

import ast
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FRONTEND_SRC = ROOT / "frontend" / "src"
BACKEND_ROOT = ROOT / "backend"
BACKEND_APP = BACKEND_ROOT / "app"
SETTINGS_PATH = ROOT / ".vscode" / "settings.json"
REPORT_PATH = ROOT / "temp" / "used-code-counter-report.json"

FRONTEND_ENTRY_POINTS = [
    FRONTEND_SRC / "main.tsx",
]

BACKEND_ENTRY_POINTS = [
    BACKEND_APP / "main.py",
]

FRONTEND_SUFFIXES = (".ts", ".tsx", ".css", ".pcss")
CSS_SUFFIXES = (".css", ".pcss")
COUNTABLE_SUFFIXES = {".py", ".ts", ".tsx", ".css", ".pcss"}

TS_IMPORT_RE = re.compile(
    r"(?:import|export)\s+(?:type\s+)?(?:[^\"']*?\s+from\s+)?[\"']([^\"']+)[\"']",
    re.MULTILINE,
)
TS_DYNAMIC_IMPORT_RE = re.compile(r"import\(\s*[\"']([^\"']+)[\"']\s*\)")
CSS_IMPORT_RE = re.compile(r"@import\s+(?:url\()?\s*[\"']([^\"']+)[\"']\s*\)?")

DEFAULT_EXCLUDE = [
    "**/.gitignore",
    "**/.vscode/**",
    "**/.VSCodeCounter/**",
    "**/node_modules/**",
    "**/.venv/**",
    "**/venv/**",
    "**/__pycache__/**",
    "**/.pytest_cache/**",
    "**/coverage/**",
    "**/coverage-critical/**",
    "**/htmlcov/**",
    "**/htmlcov-critical/**",
    "**/uploads/**",
    "**/dist/**",
    "**/backups/**",
]


def workspace_relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def resolve_frontend_import(source_file: Path, specifier: str) -> Path | None:
    if not specifier.startswith("."):
        return None

    base_path = (source_file.parent / specifier).resolve()
    candidates: list[Path] = []

    if base_path.suffix:
        candidates.append(base_path)
    else:
        for suffix in FRONTEND_SUFFIXES:
            candidates.append(base_path.with_suffix(suffix))
        for suffix in FRONTEND_SUFFIXES:
            candidates.append(base_path / f"index{suffix}")

    for candidate in candidates:
        if candidate.exists() and candidate.is_file() and candidate.suffix in COUNTABLE_SUFFIXES:
            return candidate
    return None


def parse_frontend_dependencies(source_file: Path) -> set[Path]:
    try:
        content = source_file.read_text(encoding="utf-8")
    except OSError:
        return set()

    specifiers: set[str] = set()
    if source_file.suffix in CSS_SUFFIXES:
        specifiers.update(CSS_IMPORT_RE.findall(content))
    else:
        specifiers.update(TS_IMPORT_RE.findall(content))
        specifiers.update(TS_DYNAMIC_IMPORT_RE.findall(content))

    resolved: set[Path] = set()
    for specifier in specifiers:
        dependency = resolve_frontend_import(source_file, specifier)
        if dependency and dependency.is_relative_to(FRONTEND_SRC):
            resolved.add(dependency)
    return resolved


def discover_frontend_reachable_files() -> set[Path]:
    reachable: set[Path] = set()
    pending = [entry for entry in FRONTEND_ENTRY_POINTS if entry.exists()]

    while pending:
        current = pending.pop()
        if current in reachable:
            continue
        reachable.add(current)
        pending.extend(sorted(parse_frontend_dependencies(current)))

    return reachable


def python_module_name(source_file: Path) -> str:
    relative = source_file.relative_to(BACKEND_ROOT)
    parts = list(relative.parts)
    if parts[-1] == "__init__.py":
        parts = parts[:-1]
    else:
        parts[-1] = source_file.stem
    return ".".join(parts)


def resolve_python_module(module_name: str) -> set[Path]:
    if not module_name or not module_name.startswith("app"):
        return set()

    parts = module_name.split(".")
    module_base = BACKEND_ROOT.joinpath(*parts)
    file_candidate = module_base.with_suffix(".py")
    package_candidate = module_base / "__init__.py"

    resolved: set[Path] = set()

    if package_candidate.exists():
        for index in range(1, len(parts) + 1):
            package_init = BACKEND_ROOT.joinpath(*parts[:index], "__init__.py")
            if package_init.exists():
                resolved.add(package_init)
        return resolved

    if file_candidate.exists():
        package_depth = len(parts) - 1
        for index in range(1, package_depth + 1):
            package_init = BACKEND_ROOT.joinpath(*parts[:index], "__init__.py")
            if package_init.exists():
                resolved.add(package_init)
        resolved.add(file_candidate)
        return resolved

    return set()


def resolve_import_from_base(source_file: Path, module: str | None, level: int) -> str | None:
    current_module = python_module_name(source_file)
    current_parts = current_module.split(".")
    if source_file.name != "__init__.py":
        current_parts = current_parts[:-1]

    if level > 0:
        climb = level - 1
        if climb > len(current_parts):
            return None
        base_parts = current_parts[: len(current_parts) - climb]
    else:
        base_parts = []

    if module:
        base_parts.extend(module.split("."))

    if not base_parts:
        return None
    return ".".join(base_parts)


def parse_backend_dependencies(source_file: Path) -> set[Path]:
    try:
        content = source_file.read_text(encoding="utf-8")
        tree = ast.parse(content, filename=str(source_file))
    except (OSError, SyntaxError):
        return set()

    dependencies: set[Path] = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                dependencies.update(resolve_python_module(alias.name))
        elif isinstance(node, ast.ImportFrom):
            base_module = resolve_import_from_base(source_file, node.module, node.level)
            if not base_module:
                continue

            base_paths = resolve_python_module(base_module)
            dependencies.update(base_paths)

            for alias in node.names:
                if alias.name == "*":
                    continue
                submodule_name = f"{base_module}.{alias.name}"
                submodule_paths = resolve_python_module(submodule_name)
                if submodule_paths:
                    dependencies.update(submodule_paths)

    return {path for path in dependencies if path.is_relative_to(BACKEND_APP)}


def discover_backend_reachable_files() -> set[Path]:
    reachable: set[Path] = set()
    pending = [entry for entry in BACKEND_ENTRY_POINTS if entry.exists()]

    while pending:
        current = pending.pop()
        if current in reachable:
            continue
        reachable.add(current)
        pending.extend(sorted(parse_backend_dependencies(current)))

    return reachable


def all_countable_files(root: Path, suffixes: tuple[str, ...]) -> set[Path]:
    return {
        path
        for path in root.rglob("*")
        if path.is_file() and path.suffix in suffixes
    }


def summarize_paths(paths: set[Path]) -> list[str]:
    return [workspace_relative(path) for path in sorted(paths)]


def load_settings() -> dict:
    if not SETTINGS_PATH.exists():
        return {}
    return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))


def write_settings(include_paths: list[str]) -> None:
    settings = load_settings()
    settings["VSCodeCounter.useGitignore"] = True
    settings["VSCodeCounter.useFilesExclude"] = True
    settings["VSCodeCounter.include"] = include_paths
    settings["VSCodeCounter.exclude"] = settings.get("VSCodeCounter.exclude", DEFAULT_EXCLUDE) or DEFAULT_EXCLUDE
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_PATH.write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")


def write_report(
    frontend_reachable: set[Path],
    backend_reachable: set[Path],
    frontend_unreachable: set[Path],
    backend_unreachable: set[Path],
) -> None:
    report = {
        "mode": "static-reachable-runtime-files",
        "entry_points": {
            "frontend": summarize_paths(set(FRONTEND_ENTRY_POINTS)),
            "backend": summarize_paths(set(BACKEND_ENTRY_POINTS)),
        },
        "summary": {
            "frontend_reachable_count": len(frontend_reachable),
            "backend_reachable_count": len(backend_reachable),
            "total_reachable_count": len(frontend_reachable) + len(backend_reachable),
            "frontend_unreachable_count": len(frontend_unreachable),
            "backend_unreachable_count": len(backend_unreachable),
            "total_unreachable_count": len(frontend_unreachable) + len(backend_unreachable),
        },
        "reachable_files": {
            "frontend": summarize_paths(frontend_reachable),
            "backend": summarize_paths(backend_reachable),
        },
        "unreachable_files": {
            "frontend": summarize_paths(frontend_unreachable),
            "backend": summarize_paths(backend_unreachable),
        },
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    frontend_reachable = discover_frontend_reachable_files()
    backend_reachable = discover_backend_reachable_files()

    frontend_all = all_countable_files(FRONTEND_SRC, FRONTEND_SUFFIXES)
    backend_all = all_countable_files(BACKEND_APP, (".py",))

    frontend_unreachable = frontend_all - frontend_reachable
    backend_unreachable = backend_all - backend_reachable

    include_paths = summarize_paths(frontend_reachable | backend_reachable)
    write_settings(include_paths)
    write_report(frontend_reachable, backend_reachable, frontend_unreachable, backend_unreachable)

    print(
        "Updated VS Code Counter include list with "
        f"{len(include_paths)} statically reachable files "
        f"({len(frontend_reachable)} frontend, {len(backend_reachable)} backend)."
    )
    print(
        "Excluded from counting as unreachable/non-runtime under the current roots: "
        f"{len(frontend_unreachable)} frontend files and {len(backend_unreachable)} backend files."
    )
    print(f"Report written to {workspace_relative(REPORT_PATH)}")


if __name__ == "__main__":
    main()