#!/usr/bin/env python3
"""Search private Markdown incidents; explicitly refresh or check their compact index."""
import argparse
import hashlib
import tempfile
from urllib.parse import quote
import json
import os
from pathlib import Path
import re
import sys

DEFAULT = Path("~/.agents/personal-memory/engineering-incidents").expanduser()
REQUIRED = ("id", "project", "status", "evidence", "observed", "tags", "summary", "context", "trigger", "check", "source")
INACTIVE = {"superseded", "retracted"}

def read_record(path):
    content = path.read_text(encoding="utf-8")
    metadata = {}
    warnings = []
    if content.startswith("---\n"):
        end = content.find("\n---", 4)
        if end >= 0:
            for line in content[4:end].splitlines():
                if not line.strip() or line.lstrip().startswith("#"):
                    continue
                key, sep, value = line.partition(":")
                if not sep:
                    warnings.append("unparsed metadata line")
                    continue
                metadata[key.strip()] = value.strip().strip('"').strip("'")
        else:
            warnings.append("unterminated frontmatter")
    else:
        warnings.append("no frontmatter")
    missing = [key for key in REQUIRED if not metadata.get(key)]
    if missing:
        warnings.append("missing metadata: " + ", ".join(missing))
    title = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    return {"path": str(path), "title": title.group(1) if title else path.stem,
            "metadata": metadata, "warnings": warnings, "content": content}

def search(root, project=None, query="", include_inactive=False):
    root = Path(root).expanduser()
    if not root.is_dir() or not (root / "entries").is_dir():
        raise ValueError("Incident registry unavailable: " + str(root))
    terms = set(re.findall(r"[\w/-]+", query.casefold()))
    records, warnings, seen = [], [], set()
    for path in sorted((root / "entries").rglob("*.md")):
        # Do not follow a file symlink into an unrelated private source.
        if path.is_symlink() or not path.resolve().is_relative_to((root / "entries").resolve()):
            warnings.append(str(path) + ": skipped external/symlink record")
            continue
        try:
            record = read_record(path)
        except (OSError, UnicodeError) as exc:
            warnings.append(str(path) + ": unreadable (" + type(exc).__name__ + ")")
            continue
        meta = record["metadata"]
        ident = meta.get("id")
        if ident and ident in seen:
            record["warnings"].append("duplicate incident ID: " + ident)
        if ident:
            seen.add(ident)
        for warning in record["warnings"]:
            warnings.append(str(path) + ": " + warning)
        # Incomplete manual entries remain candidates instead of disappearing.
        incomplete = bool(record["warnings"])
        scope = meta.get("project", "").casefold()
        if project and scope not in {project.casefold(), "general", "*"} and not incomplete:
            continue
        inactive = meta.get("status", "").casefold() in INACTIVE
        if inactive and not include_inactive:
            warnings.append(str(path) + ": inactive; use --include-inactive to inspect")
            continue
        haystack = record["content"].casefold()
        record["score"] = sum(1 for term in terms if term in haystack)
        if terms and not record["score"] and not incomplete:
            continue
        records.append(record)
    records.sort(key=lambda item: (-item["score"], item["path"]))
    return {"records": records, "warnings": warnings,
            "note": "Search candidates are not an applicability verdict. Inspect the project inventory and full records."}

INDEX_MARKER = "<!-- generated-incident-index:v1 -->"

def compact(value):
    """Keep index fields on one line and prevent metadata becoming active Markdown."""
    value = " ".join(str(value).split())
    value = value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    for char in ("\\", "`", "*", "_", "[", "]", "|", "#"):
        value = value.replace(char, "\\" + char)
    return value or "MISSING — inspect full record"

def render_index(root):
    root = Path(root).expanduser()
    result = search(root, include_inactive=True)
    snapshot = [{"path": str(Path(r["path"]).relative_to(root)), "content": r["content"]}
                for r in result["records"]]
    digest = hashlib.sha256(json.dumps([snapshot, result["warnings"]], sort_keys=True).encode()).hexdigest()
    lines = [INDEX_MARKER, "# Incident database index", "",
             "Generated from entries; edit the individual records, then refresh. Full records are the source of truth.",
             "Use project AND failure-mechanism matches. Fixed incidents remain regression cases; superseded/retracted records are historical only.",
             "", "Source fingerprint: `" + digest + "`", "", "Records: " + str(len(snapshot)), ""]
    for record in result["records"]:
        meta = record["metadata"]
        relative = Path(record["path"]).relative_to(root).as_posix()
        label = compact(meta.get("id", Path(relative).stem) + " · " + record["title"])
        lines.extend(["## [" + label + "](" + quote(relative, safe="/") + ")",
            "", "**Project:** " + compact(meta.get("project", "")) +
            " · **Status:** " + compact(meta.get("status", "")) +
            " · **Evidence:** " + compact(meta.get("evidence", "")),
            "- **Summary:** " + compact(meta.get("summary", "")),
            "- **Context:** " + compact(meta.get("context", "")),
            "- **Recognize when:** " + compact(meta.get("trigger", "")),
            "- **Check:** " + compact(meta.get("check", "")),
            "- **Tags:** " + compact(meta.get("tags", "")),
            "- **Source:** " + compact(meta.get("source", "")), ""])
    if result["warnings"]:
        lines.extend(["## Incomplete or skipped records", ""])
        lines.extend("- " + compact(w) for w in result["warnings"])
        lines.append("")
    return "\n".join(lines)

def check_index(root):
    path = Path(root).expanduser() / "Database.md"
    if not path.is_file() or path.is_symlink():
        return False
    return path.read_text(encoding="utf-8") == render_index(root)

def refresh_index(root):
    root = Path(root).expanduser()
    expected = render_index(root)
    path = root / "Database.md"
    if path.is_symlink():
        raise ValueError("Refusing to replace a symlink index: " + str(path))
    if path.exists() and not path.read_text(encoding="utf-8").startswith(INDEX_MARKER + "\n"):
        raise ValueError("Refusing to overwrite a manually authored index: " + str(path))
    if path.exists() and path.read_text(encoding="utf-8") == expected:
        return {"changed": False, "path": str(path)}
    temp = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=root,
                                         prefix=".incident-index-", delete=False) as stream:
            temp = Path(stream.name)
            stream.write(expected)
        # A racing record edit must not silently produce a fresh-looking index.
        if render_index(root) != expected:
            raise ValueError("Incident records changed during index generation; retry refresh")
        os.replace(temp, path)
    finally:
        if temp is not None and temp.exists():
            temp.unlink()
    return {"changed": True, "path": str(path)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=os.environ.get("WORKFLOW_INCIDENTS_DIR", str(DEFAULT)))
    parser.add_argument("--project")
    parser.add_argument("--query", default="")
    parser.add_argument("--include-inactive", action="store_true")
    parser.add_argument("--full", action="store_true")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--refresh-index", action="store_true", help="Explicitly write Database.md; never modify incident entries")
    mode.add_argument("--check-index", action="store_true", help="Read-only freshness check; exit 3 if stale/missing")
    args = parser.parse_args()
    if (args.refresh_index or args.check_index) and (args.project or args.query or args.full or args.include_inactive):
        parser.error("Index modes cover the whole registry and cannot use search filters")
    try:
        if args.refresh_index:
            result = refresh_index(args.root)
        elif args.check_index:
            current = check_index(args.root)
            print(json.dumps({"current": current, "action": "Scan Database.md" if current else "Use live search or refresh; do not trust the stale index"}))
            return 0 if current else 3
        else:
            result = search(args.root, args.project, args.query, args.include_inactive)
            if not args.full:
                for record in result["records"]:
                    record.pop("content")
    except (ValueError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0

if __name__ == "__main__":
    sys.exit(main())
