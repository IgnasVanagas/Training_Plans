"""Classified line counter for the Training_Plans repo.

Buckets:
    - backend_runtime : backend/app/** files statically reachable from backend/app/main.py
  - backend_tests   : backend/app/tests/**
    - frontend_runtime: frontend/src/** files statically reachable from frontend/src/main.tsx
                                            (excl. *.test.*, *.spec.*, __tests__/**), frontend/index.html,
                                            frontend/public/**
  - frontend_tests  : frontend/tests/**, frontend/src/**/__tests__/**, frontend/src/**/*.{test,spec}.*
    - non_runtime     : unreachable frontend/src/** and backend/app/** files, plus integration/**,
                                            scripts/**, frontend/scripts/**, deployment/**, docs/**, Dockerfile*,
                                            docker-compose*.yml, render.yaml, *.md, *.puml, frontend config files,
                                            package.json files, requirements.txt, env templates, mobile-expo/**

Excluded from all totals:
  node_modules, .venv, __pycache__, .pytest_cache, .git, htmlcov*, coverage*,
  uploads, backups, temp, integration-artifacts, test-results, lockfiles,
  binary/asset extensions.

For each file we report:
  total_lines, blank_lines, comment_lines (best-effort per-language), code_lines.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

try:
    from update_vscode_counter_used_files import (
        discover_backend_reachable_files,
        discover_frontend_reachable_files,
    )
except ImportError:
    from scripts.update_vscode_counter_used_files import (
        discover_backend_reachable_files,
        discover_frontend_reachable_files,
    )

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_INDEX_HTML = ROOT / "frontend" / "index.html"
FRONTEND_MAIN_ENTRY = ROOT / "frontend" / "src" / "main.tsx"
FRONTEND_SERVICE_WORKER_RE = re.compile(r"navigator\.serviceWorker\.register\(\s*[\"'](/[^\"']+)[\"']\s*\)")

# ---------------------------------------------------------------------------
# Exclusions
# ---------------------------------------------------------------------------
EXCLUDED_DIR_NAMES = {
    "node_modules",
    ".venv",
    "venv",
    ".git",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".vite",
    "dist",
    "build",
    ".next",
    ".turbo",
}

EXCLUDED_PATH_PREFIXES = [
    "backend/htmlcov",
    "backend/htmlcov-critical",
    "backend/coverage",
    "backend/uploads",
    "frontend/coverage",
    "frontend/coverage-critical",
    "frontend/coverage-scoped",
    "frontend/uploads",
    "frontend/public/assets",  # likely bundled assets if any
    "uploads",
    "backups",
    "temp",
    "integration-artifacts",
    "test-results",
    "docs/combined-coverage-report.html",
]

EXCLUDED_FILENAMES = {
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    ".coverage",
    "coverage.json",
    "coverage.xml",
    "coverage_full.txt",
    "coverage_out.txt",
    "_cov.txt",
}

# extensions we never want to count (binary / data / generated)
EXCLUDED_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
    ".pdf", ".zip", ".gz", ".tar", ".7z",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".mp3", ".mp4", ".mov", ".wav",
    ".pyc", ".pyo", ".pyd", ".so", ".dll", ".exe",
    ".db", ".sqlite", ".sqlite3",
    ".sql.gz",
    ".bin", ".dat",
    ".lock",
    ".min.js", ".min.css",  # handled separately below as suffix
    ".map",
}

# extensions to count
COUNTED_EXTENSIONS = {
    ".py", ".pyi",
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".html", ".htm",
    ".css", ".scss", ".sass", ".less",
    ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".md", ".rst", ".txt",
    ".sh", ".ps1", ".bat", ".cmd",
    ".sql",
    ".puml",
    ".dockerfile",
    ".conf",
    ".env",
    ".template",
}
# Files without extension we still count (by name)
COUNTED_FILENAMES = {"Dockerfile", "Dockerfile.prod", ".gitignore", ".coveragerc", ".env", "Makefile"}

# ---------------------------------------------------------------------------
# Comment detection per language
# ---------------------------------------------------------------------------
LINE_COMMENT_PREFIXES = {
    ".py": ("#",),
    ".pyi": ("#",),
    ".sh": ("#",),
    ".ps1": ("#",),
    ".bat": ("REM ", "::"),
    ".cmd": ("REM ", "::"),
    ".yml": ("#",),
    ".yaml": ("#",),
    ".toml": ("#",),
    ".ini": ("#", ";"),
    ".cfg": ("#", ";"),
    ".conf": ("#",),
    ".env": ("#",),
    ".template": ("#",),
    ".dockerfile": ("#",),
    ".sql": ("--",),
    ".puml": ("'",),
    ".js": ("//",),
    ".jsx": ("//",),
    ".ts": ("//",),
    ".tsx": ("//",),
    ".mjs": ("//",),
    ".cjs": ("//",),
    ".css": (),  # only block comments
    ".scss": ("//",),
    ".sass": ("//",),
    ".less": ("//",),
    ".html": (),
    ".htm": (),
    ".md": (),
    ".rst": (),
    ".txt": (),
    ".json": (),  # JSON has no comments
}

BLOCK_COMMENT_DELIMS = {
    "c_style": ("/*", "*/"),  # js/ts/css/scss/less/sql
    "html": ("<!--", "-->"),
    "py_doc": ('"""', '"""'),  # triple-quote (also ''')
}

C_STYLE_EXTS = {".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".css", ".scss", ".less", ".sql"}
HTML_EXTS = {".html", ".htm", ".md"}  # md often has html comments


def detect_dockerfile(path: Path) -> bool:
    name = path.name
    return name == "Dockerfile" or name.startswith("Dockerfile.")


def get_comment_kind(path: Path) -> tuple[tuple[str, ...], list[tuple[str, str]]]:
    """Return (line_comment_prefixes, block_comment_delim_pairs) for a file."""
    if detect_dockerfile(path):
        return ("#",), []
    ext = path.suffix.lower()
    line_prefixes = LINE_COMMENT_PREFIXES.get(ext, ())
    blocks: list[tuple[str, str]] = []
    if ext in C_STYLE_EXTS:
        blocks.append(BLOCK_COMMENT_DELIMS["c_style"])
    if ext in HTML_EXTS:
        blocks.append(BLOCK_COMMENT_DELIMS["html"])
    return line_prefixes, blocks


def count_file(path: Path) -> tuple[int, int, int, int]:
    """Return (total, blank, comment, code) line counts."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except (OSError, UnicodeError):
        return (0, 0, 0, 0)
    if not text:
        return (0, 0, 0, 0)
    lines = text.splitlines() or [""]
    total = len(lines)
    blank = 0
    comment = 0
    line_prefixes, blocks = get_comment_kind(path)

    in_block: str | None = None  # closing delimiter
    for raw in lines:
        stripped = raw.strip()
        if not stripped:
            blank += 1
            continue
        # block comment handling
        if in_block is not None:
            comment += 1
            if in_block in stripped:
                in_block = None
            continue
        matched_block_start = False
        for open_d, close_d in blocks:
            if stripped.startswith(open_d):
                comment += 1
                # Same line close?
                rest = stripped[len(open_d):]
                if close_d in rest:
                    in_block = None
                else:
                    in_block = close_d
                matched_block_start = True
                break
        if matched_block_start:
            continue
        if line_prefixes and any(stripped.startswith(p) for p in line_prefixes):
            comment += 1
            continue
    code = total - blank - comment
    if code < 0:
        code = 0
    return total, blank, comment, code


# ---------------------------------------------------------------------------
# Bucket assignment
# ---------------------------------------------------------------------------
def rel_posix(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def normalized_rel(value: str) -> str:
    return value.replace("\\", "/").casefold()


def discover_frontend_runtime_paths() -> tuple[set[str], set[str]]:
    frontend_graph = {
        normalized_rel(rel_posix(path))
        for path in discover_frontend_reachable_files()
    }
    frontend_runtime = set(frontend_graph)

    if FRONTEND_INDEX_HTML.exists():
        frontend_runtime.add(normalized_rel(rel_posix(FRONTEND_INDEX_HTML)))

    try:
        main_source = FRONTEND_MAIN_ENTRY.read_text(encoding="utf-8", errors="replace")
    except OSError:
        main_source = ""

    for match in FRONTEND_SERVICE_WORKER_RE.finditer(main_source):
        public_relative = match.group(1).lstrip("/")
        public_file = ROOT / "frontend" / "public" / Path(public_relative)
        if public_file.exists() and public_file.is_file() and not should_skip_file(public_file):
            frontend_runtime.add(normalized_rel(rel_posix(public_file)))

    return frontend_graph, frontend_runtime


def discover_reachable_runtime_paths() -> tuple[set[str], set[str], set[str]]:
    frontend_graph, frontend_runtime = discover_frontend_runtime_paths()
    backend_reachable = {
        normalized_rel(rel_posix(path))
        for path in discover_backend_reachable_files()
    }
    return frontend_graph, frontend_runtime, backend_reachable


def is_test_file(rel: str) -> bool:
    name = rel.rsplit("/", 1)[-1]
    if "/__tests__/" in rel or rel.startswith("__tests__/"):
        return True
    # *.test.*  *.spec.*
    if re.search(r"\.(test|spec)\.[a-zA-Z0-9]+$", name):
        return True
    return False


def classify(rel: str, frontend_reachable: set[str], backend_reachable: set[str]) -> str | None:
    """Return bucket name or None if file should be excluded from buckets."""
    rel_key = normalized_rel(rel)

    # Backend
    if rel.startswith("backend/app/tests/"):
        return "backend_tests"
    if rel.startswith("backend/app/"):
        return "backend_runtime" if rel_key in backend_reachable else "non_runtime"
    if rel.startswith("backend/"):
        # backend/Dockerfile, backend/requirements.txt → non_runtime
        return "non_runtime"

    # Frontend
    if rel.startswith("frontend/tests/"):
        return "frontend_tests"
    if rel.startswith("frontend/src/"):
        if is_test_file(rel):
            return "frontend_tests"
        return "frontend_runtime" if rel_key in frontend_reachable else "non_runtime"
    if rel_key in frontend_reachable:
        return "frontend_runtime"
    if rel.startswith("frontend/scripts/"):
        return "non_runtime"
    if rel.startswith("frontend/"):
        # configs, package.json, nginx.conf, Dockerfile, tsconfig, vite/vitest configs
        return "non_runtime"

    # Mobile
    if rel.startswith("mobile-expo/"):
        return "non_runtime"

    # Integration / e2e
    if rel.startswith("integration/") or rel == "playwright.config.js":
        return "non_runtime"

    # Tooling, infra, docs
    if rel.startswith(("scripts/", "deployment/", "docs/", ".github/", ".vscode/")):
        return "non_runtime"

    # Top-level config / manifests
    name = rel.rsplit("/", 1)[-1]
    if "/" not in rel:  # top-level file
        return "non_runtime"

    return "non_runtime"


# ---------------------------------------------------------------------------
# Walk
# ---------------------------------------------------------------------------
def should_skip_file(path: Path) -> bool:
    name = path.name
    if name in EXCLUDED_FILENAMES:
        return True
    # multi-suffix lockless
    if name.endswith(".min.js") or name.endswith(".min.css") or name.endswith(".map"):
        return True
    # extension-based
    suffixes = path.suffixes
    if suffixes:
        last = suffixes[-1].lower()
        if last in EXCLUDED_EXTENSIONS:
            return True
    rel = rel_posix(path)
    for prefix in EXCLUDED_PATH_PREFIXES:
        if rel == prefix or rel.startswith(prefix + "/") or rel.startswith(prefix):
            return True
    # Counted?
    if detect_dockerfile(path):
        return False
    ext = path.suffix.lower()
    if ext in COUNTED_EXTENSIONS:
        return False
    if name in COUNTED_FILENAMES:
        return False
    # Unknown extension → skip
    return True


def walk() -> list[Path]:
    files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        # prune excluded dirs in-place
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIR_NAMES]
        # also prune by relative path prefix
        rel_dir = Path(dirpath).relative_to(ROOT).as_posix()
        if rel_dir != "." and any(
            rel_dir == p or rel_dir.startswith(p + "/") for p in EXCLUDED_PATH_PREFIXES
        ):
            dirnames[:] = []
            continue
        for fn in filenames:
            p = Path(dirpath) / fn
            if should_skip_file(p):
                continue
            files.append(p)
    return files


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    files = walk()
    frontend_graph, frontend_reachable, backend_reachable = discover_reachable_runtime_paths()
    buckets: dict[str, dict[str, int]] = {
        b: {"files": 0, "total": 0, "blank": 0, "comment": 0, "code": 0}
        for b in ("backend_runtime", "backend_tests", "frontend_runtime", "frontend_tests", "non_runtime")
    }
    by_ext: dict[str, dict[str, int]] = {}
    per_file: list[tuple[str, str, int, int, int, int]] = []

    for p in files:
        rel = rel_posix(p)
        bucket = classify(rel, frontend_reachable, backend_reachable)
        if bucket is None:
            continue
        total, blank, comment, code = count_file(p)
        b = buckets[bucket]
        b["files"] += 1
        b["total"] += total
        b["blank"] += blank
        b["comment"] += comment
        b["code"] += code

        ext = p.suffix.lower() or p.name
        e = by_ext.setdefault(ext, {"files": 0, "code": 0, "total": 0})
        e["files"] += 1
        e["code"] += code
        e["total"] += total

        per_file.append((bucket, rel, total, blank, comment, code))

    # totals
    grand = {k: 0 for k in ("files", "total", "blank", "comment", "code")}
    for b in buckets.values():
        for k in grand:
            grand[k] += b[k]

    # ---- output ----
    print(f"\n=== Training_Plans line count (root: {ROOT}) ===\n")
    header = f"{'Bucket':<20}{'Files':>8}{'Total':>10}{'Blank':>10}{'Comment':>10}{'Code':>10}{'% Code':>9}"
    print(header)
    print("-" * len(header))
    for name, b in buckets.items():
        pct = (b["code"] / grand["code"] * 100) if grand["code"] else 0.0
        print(f"{name:<20}{b['files']:>8}{b['total']:>10}{b['blank']:>10}{b['comment']:>10}{b['code']:>10}{pct:>8.1f}%")
    print("-" * len(header))
    print(f"{'TOTAL':<20}{grand['files']:>8}{grand['total']:>10}{grand['blank']:>10}{grand['comment']:>10}{grand['code']:>10}{100.0:>8.1f}%")

    print("\nTop extensions by code lines:")
    sorted_ext = sorted(by_ext.items(), key=lambda kv: kv[1]["code"], reverse=True)[:20]
    print(f"{'Ext':<14}{'Files':>8}{'Code':>10}{'Total':>10}")
    for ext, e in sorted_ext:
        print(f"{ext:<14}{e['files']:>8}{e['code']:>10}{e['total']:>10}")

    # Optional: write JSON for further use
    out_json = ROOT / "temp" / "loc-report.json"
    out_json.parent.mkdir(exist_ok=True, parents=True)
    out_json.write_text(
        json.dumps(
            {
                "buckets": buckets,
                "grand": grand,
                "by_ext": by_ext,
                "reachability": {
                    "frontend_runtime_files": len(frontend_reachable),
                    "backend_runtime_files": len(backend_reachable),
                    "total_runtime_files": len(frontend_reachable) + len(backend_reachable),
                    "frontend_static_graph_files": len(frontend_graph),
                    "total_static_graph_files": len(frontend_graph) + len(backend_reachable),
                },
            },
            indent=2,
        )
    )
    print(f"\nJSON report → {out_json.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
