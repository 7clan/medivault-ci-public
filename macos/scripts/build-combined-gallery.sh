#!/usr/bin/env bash
# build-combined-gallery.sh — aggregate the parallel-wave shard evidence into
# the POST-RUN QA EVIDENCE GALLERY the user actually sees.
#
# Inputs (env):
#   SOURCE_RUN_ID  the frozen GREEN patients run (DMG source)
#   SOURCE_SHA     its public head SHA
#   PARALLEL_RUN_ID this parallel wave run id
#   GITHUB_TOKEN   (optional) used to fetch per-shard job conclusions
# Working dir: repo root; expects shards/qa-evidence-shard-{A..E}/
# (each containing gui-evidence*/ trees from macos/scripts/exploratory-qa.sh)
# Output: combined-gallery/ (index.html, gallery-manifest.json,
#         qa-capability-report.md, BUG-REGISTER.md, screenshots/)
#
# This is QA INFRASTRUCTURE ONLY — it never touches MediVault product code.

set -euo pipefail

OUT="combined-gallery"
SHOTS="$OUT/screenshots"
mkdir -p "$OUT" "$SHOTS"

SOURCE_RUN_ID="${SOURCE_RUN_ID:-unknown}"
SOURCE_SHA="${SOURCE_SHA:-unknown}"
PARALLEL_RUN_ID="${PARALLEL_RUN_ID:-unknown}"
REPO="${GITHUB_REPOSITORY:-7clan/medivault-ci-public}"

python3 - "$@" <<'PYEOF'
import json, os, re, sys, html, urllib.request, datetime

out = "combined-gallery"
shots = os.path.join(out, "screenshots")
repo = os.environ.get("GITHUB_REPOSITORY", "7clan/medivault-ci-public")
source_run = os.environ.get("SOURCE_RUN_ID", "unknown")
source_sha = os.environ.get("SOURCE_SHA", "unknown")
parallel_run = os.environ.get("PARALLEL_RUN_ID", "unknown")

SHARDS = [
    ("A", "Search + Settings + Persistence", "search, settings, persistence"),
    ("B", "Documents + Scan + File Management", "documents"),
    ("C", "Clinical (Visits/Notes/Prescriptions/Reports)", "clinical"),
    ("D", "Data-IO + Dashboard + Analytics + Notifications + Global", "dataio"),
    ("E", "macOS Save/Print + Error/Recovery", "desktop"),
]

# 1. shard job conclusions from the API (best effort)
job_conclusions = {}
token = os.environ.get("GITHUB_TOKEN")
if token and parallel_run not in ("", "unknown"):
    try:
        req = urllib.request.Request(
            f"https://api.github.com/repos/{repo}/actions/runs/{parallel_run}/jobs?per_page=50",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.load(r)
        for j in data.get("jobs", []):
            name = j.get("name", "")
            m = re.search(r"Shard ([A-E])", name)
            if m:
                job_conclusions[m.group(1)] = j.get("conclusion") or j.get("status") or "unknown"
    except Exception as e:
        print(f"gallery: job-conclusion lookup failed: {e}", file=sys.stderr)

# 2. walk shard artifacts (directive §9 names → shard letters)
ART_DIRS = {
    "qa-evidence-search": "A",
    "qa-evidence-settings-persistence": "A",
    "qa-evidence-documents-scan": "B",
    "qa-evidence-clinical": "C",
    "qa-evidence-data-io": "D",
    "qa-evidence-desktop-print": "E",
}

def find_files(root, pattern):
    found = []
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            if pattern in f:
                found.append(os.path.join(dirpath, f))
    return found

manifest = {
    "gallery": "POST-RUN QA EVIDENCE GALLERY",
    "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "source_run_id": source_run,
    "source_sha": source_sha,
    "parallel_run_id": parallel_run,
    "repo": repo,
    "shards": [],
    "artifacts": [],
}

combined_cap = ["# Combined QA Capability Report",
                "",
                f"- SOURCE RUN: {source_run} @ `{source_sha}`",
                f"- PARALLEL RUN: {parallel_run}",
                f"- Generated: {manifest['generated_at']}",
                ""]
combined_bugs = ["# Combined Bug Register (parallel wave)",
                 "",
                 f"- SOURCE RUN: {source_run} @ `{source_sha}`",
                 f"- PARALLEL RUN: {parallel_run}",
                 ""]

# artifact-name-first walk (each downloaded artifact dir maps to a shard;
# sibling-merged dirs are named <artifact-name>-sibling<runid> — matched by prefix)
def shard_for(dirname):
    for name, shard in ART_DIRS.items():
        if dirname == name or dirname.startswith(name + "-"):
            return shard
    return None

shard_arts = {"A": [], "B": [], "C": [], "D": [], "E": []}
if os.path.isdir("shards"):
    for d in sorted(os.listdir("shards")):
        shard = shard_for(d)
        if shard:
            shard_arts[shard].append(os.path.join("shards", d))
            manifest["artifacts"].append({"artifact": d, "shard": shard, "present": True})

for shard, label, focuses in SHARDS:
    arts = [a for a in shard_arts.get(shard, []) if os.path.isdir(a)]
    entry = {"shard": shard, "label": label, "focuses": focuses,
             "present": bool(arts), "screenshots": 0,
             "result": job_conclusions.get(shard, "unknown"),
             "bug_counts": {}}
    for art in arts:
        # copy screenshots
        n = 0
        for src in find_files(art, ".png"):
            rel = os.path.relpath(src, art).replace(os.sep, "_")
            dst = os.path.join(shots, f"shard{shard}-{rel}")
            try:
                with open(src, "rb") as f_in, open(dst, "wb") as f_out:
                    while True:
                        chunk = f_in.read(65536)
                        if not chunk:
                            break
                        f_out.write(chunk)
                n += 1
            except OSError:
                pass
        entry["screenshots"] += n
        # count bug classes
        for reg in find_files(art, "BUG-REGISTER.md"):
            try:
                with open(reg, encoding="utf-8", errors="replace") as f:
                    text = f.read()
            except OSError:
                continue
            entry["bug_counts"]["lines"] = entry["bug_counts"].get("lines", 0) + text.count("\n")
            for cls in ("P0", "P1", "P2", "P3", "D-class", "ENV"):
                c = len(re.findall(rf"\[?{re.escape(cls)}", text))
                if c:
                    entry["bug_counts"][cls] = entry["bug_counts"].get(cls, 0) + c
        # append reports
        for rep in find_files(art, "qa-capability-report.md"):
            combined_cap.append(f"\n## Shard {shard} — {label}\n")
            try:
                combined_cap.append(open(rep, encoding="utf-8", errors="replace").read())
            except OSError:
                pass
        for reg in find_files(art, "BUG-REGISTER.md"):
            combined_bugs.append(f"\n## Shard {shard} — {label}\n")
            try:
                combined_bugs.append(open(reg, encoding="utf-8", errors="replace").read())
            except OSError:
                pass
    manifest["shards"].append(entry)

with open(os.path.join(out, "gallery-manifest.json"), "w") as f:
    json.dump(manifest, f, indent=2)

with open(os.path.join(out, "qa-capability-report.md"), "w") as f:
    f.write("\n".join(combined_cap) + "\n")
with open(os.path.join(out, "BUG-REGISTER.md"), "w") as f:
    f.write("\n".join(combined_bugs) + "\n")

# 3. index.html — the thing the user actually sees
rows = []
for e in manifest["shards"]:
    state = e["result"] if e["present"] or e["result"] != "unknown" else "not-run"
    present = "yes" if e["present"] else "no"
    badge = {"success": "#16a34a", "failure": "#dc2626", "cancelled": "#d97706"}.get(state, "#64748b")
    rows.append(f"""
    <tr>
      <td><strong>SHARD {html.escape(e['shard'])}</strong></td>
      <td>{html.escape(e['label'])}</td>
      <td><code>{html.escape(e['focuses'])}</code></td>
      <td><span style="background:{badge};color:#fff;padding:2px 10px;border-radius:9999px;font-size:12px">{html.escape(str(state))}</span></td>
      <td>{e['screenshots']}</td>
      <td>{html.escape(json.dumps(e['bug_counts']))}</td>
      <td>{present}</td>
    </tr>""")

total_shots = sum(e["screenshots"] for e in manifest["shards"])
index = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MediVault — Post-Run QA Evidence Gallery</title>
<style>
 body {{ font-family: -apple-system, system-ui, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }}
 header {{ background: #0f172a; color: #fff; padding: 28px 36px; }}
 header h1 {{ margin: 0 0 6px; font-size: 22px; }}
 header p {{ margin: 2px 0; color: #94a3b8; font-size: 13px; }}
 main {{ padding: 28px 36px; max-width: 1200px; margin: 0 auto; }}
 table {{ border-collapse: collapse; width: 100%; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }}
 th, td {{ text-align: left; padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }}
 th {{ background: #f1f5f9; text-transform: uppercase; font-size: 11px; letter-spacing: .04em; color: #475569; }}
 .cards {{ display: grid; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); gap: 14px; margin: 18px 0 26px; }}
 .card {{ background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }}
 .card .num {{ font-size: 26px; font-weight: 700; }}
 .card .lbl {{ font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }}
 .meta {{ display: flex; flex-wrap: wrap; gap: 18px; margin-top: 10px; font-size: 12px; color: #475569; }}
 .meta code {{ background: #e2e8f0; padding: 1px 7px; border-radius: 6px; }}
 h2 {{ font-size: 16px; margin: 30px 0 10px; }}
 .shotwall {{ display: grid; grid-template-columns: repeat(auto-fill,minmax(210px,1fr)); gap: 10px; }}
 .shotwall img {{ width: 100%; border-radius: 8px; border: 1px solid #e2e8f0; }}
 .note {{ background: #fefce8; border: 1px solid #fde68a; border-radius: 10px; padding: 10px 14px; font-size: 12px; margin: 16px 0; }}
 footer {{ padding: 18px 36px; color: #94a3b8; font-size: 12px; }}
</style></head>
<body>
<header>
  <h1>MediVault — POST-RUN QA EVIDENCE GALLERY</h1>
  <p>Post-run evidence aggregation. Not a live video feed. Synthetic data only — no real PHI.</p>
</header>
<main>
 <div class="cards">
  <div class="card"><div class="num">{source_run}</div><div class="lbl">Source (patients GREEN) run</div></div>
  <div class="card"><div class="num">{source_sha[:8]}</div><div class="lbl">Source public SHA</div></div>
  <div class="card"><div class="num">{parallel_run}</div><div class="lbl">Parallel wave run</div></div>
  <div class="card"><div class="num">{len([e for e in manifest['shards'] if e['present']])}/5</div><div class="lbl">Shards with evidence</div></div>
  <div class="card"><div class="num">{total_shots}</div><div class="lbl">Screenshots</div></div>
 </div>
 <h2>Shards</h2>
 <table>
  <tr><th>Shard</th><th>Scope</th><th>Focus</th><th>Result</th><th>Screenshots</th><th>Bug counts (raw)</th><th>Evidence</th></tr>
  {''.join(rows)}
 </table>
 <div class="note">Result values reflect the GitHub job conclusion per shard (success = battery completed to its designed end;
 failure = honest first-red stop per the campaign discipline — see BUG-REGISTER.md).</div>
 <h2>Reports</h2>
 <ul>
  <li><a href="qa-capability-report.md">qa-capability-report.md</a> (combined)</li>
  <li><a href="BUG-REGISTER.md">BUG-REGISTER.md</a> (combined)</li>
  <li><a href="gallery-manifest.json">gallery-manifest.json</a></li>
 </ul>
</main>
<footer>MediVault QA campaign — parallel completion wave. Gallery rebuilt deterministically from GitHub Actions artifacts by run ID.</footer>
</body></html>
"""
with open(os.path.join(out, "index.html"), "w") as f:
    f.write(index)

print(f"gallery: wrote {out}/index.html with {len(manifest['shards'])} shards, {total_shots} screenshots")
PYEOF
