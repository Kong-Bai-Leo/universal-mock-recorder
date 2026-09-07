"""Batch element-IO generator for 3ds Max (S1 stage).

cases.json: [{case_id, op, params, ms_call}]  — ms_call is one or more
MaxScript statements executed on the fixture scene (objects B1,S1,C1,
SP_CIRCLE,SP_PROFILE,P1(top face selected),T1).

Per run (default 3): ONE 3dsmaxbatch process executes every case
(resetMaxFile + buildFixture between cases) — startup cost is amortized.
Snapshots land per-case; python side does 3-run determinism check + diff vs
fixture + tier classification.

Usage:
  py -3 gen_max_element_io.py --cases cases.json --out io.json
        [--runs 3] [--keep-tmp]
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

MAXBATCH = r"C:\Program Files\Autodesk\3ds Max 2027\3dsmaxbatch.exe"
SCRIPTS = os.path.dirname(os.path.abspath(__file__))
RUN_TIMEOUT = 3600  # one process runs every case
FIXTURE_MS = os.path.join(SCRIPTS, "max_fixture.ms")


def safe(cid):
    return "".join(c if c.isalnum() else "_" for c in cid)


def write_runner(cases, rundir, run_idx):
    lines = []
    lines.append('fileIn @"%s"' % os.path.join(SCRIPTS, "max_snap.ms"))
    lines.append('fileIn @"%s"' % FIXTURE_MS)
    lines.append('resetMaxFile #noPrompt')
    lines.append('buildFixture()')
    lines.append('snapSceneToFile @"%s"' % os.path.join(rundir, "_fixture.json"))
    for c in cases:
        cid = safe(c["case_id"])
        out = os.path.join(rundir, cid + ".json")
        err = os.path.join(rundir, cid + ".err.txt")
        lines.append('resetMaxFile #noPrompt')
        lines.append('buildFixture()')
        lines.append('try (')
        lines.append(c["ms_call"])
        lines.append('snapSceneToFile @"%s"' % out)
        lines.append(') catch (')
        lines.append('ef = createFile @"%s"' % err)
        # single % placeholder; a stray %% raises inside catch and aborts fileIn
        lines.append('format "%s" (getCurrentException()) to:ef' % "%")
        lines.append('close ef')
        lines.append(')')
    lines.append('quitMax #noPrompt')
    scr = os.path.join(rundir, "_runner.ms")
    with open(scr, "w", encoding="ascii", errors="replace") as f:
        f.write("\n".join(lines) + "\n")
    return scr


def canon(o):
    return json.dumps(o, sort_keys=True)


def load_snap(path):
    with open(path) as f:
        return json.load(f)


def diff_objects(before, after):
    b = {o["name"]: o for o in before["objects"]}
    a = {o["name"]: o for o in after["objects"]}
    added = [a[n] for n in a if n not in b]
    removed = [b[n] for n in b if n not in a]
    changed = [a[n] for n in a if n in b and canon(a[n]) != canon(b[n])]
    return added, removed, changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cases", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--keep-tmp", action="store_true")
    ap.add_argument("--fixture", default=None, help="Override fixture .ms (default max_fixture.ms)")
    args = ap.parse_args()
    global FIXTURE_MS
    if args.fixture:
        FIXTURE_MS = os.path.abspath(args.fixture)

    with open(args.cases) as f:
        cases = json.load(f)

    base = tempfile.mkdtemp(prefix="max_io_")
    print("tmp:", base, flush=True)

    for r in range(args.runs):
        rundir = os.path.join(base, "run%d" % r)
        os.makedirs(rundir, exist_ok=True)
        scr = write_runner(cases, rundir, r)
        log = os.path.join(rundir, "_batch_log.txt")
        try:
            subprocess.run([MAXBATCH, scr], stdout=open(log, "wb"),
                           stderr=subprocess.STDOUT, timeout=RUN_TIMEOUT)
        except subprocess.TimeoutExpired:
            print("run %d TIMEOUT" % r, flush=True)
        print("run %d finished" % r, flush=True)

    results = []
    fixture = None
    fx_path = os.path.join(base, "run0", "_fixture.json")
    if os.path.exists(fx_path):
        fixture = load_snap(fx_path)
        shutil.copyfile(fx_path, os.path.splitext(args.out)[0] + "_fixture.json")

    for c in cases:
        cid = safe(c["case_id"])
        snaps, err = [], None
        for r in range(args.runs):
            p = os.path.join(base, "run%d" % r, cid + ".json")
            e = os.path.join(base, "run%d" % r, cid + ".err.txt")
            if os.path.exists(p):
                try:
                    snaps.append(load_snap(p))
                except Exception as ex:  # noqa: BLE001
                    err = "bad json: %s" % ex
            elif os.path.exists(e):
                err = open(e, errors="replace").read()[:300]
        rec = {"case_id": c["case_id"], "op": c["op"],
               "params": c.get("params", {}), "ms_call": c["ms_call"]}
        if len(snaps) < args.runs:
            rec.update(ok=False, tier="T3_fail",
                       error=err or "missing snapshots (%d/%d)" % (len(snaps), args.runs))
        else:
            det = all(canon(s) == canon(snaps[0]) for s in snaps[1:])
            added, removed, changed = diff_objects(fixture, snaps[0])
            tier = ("T1" if (added or removed or changed) else "T2_noop")
            rec.update(ok=True, deterministic=det,
                       tier=tier if det else "T3_nondet",
                       objects_added=added, objects_removed=removed,
                       objects_changed=changed, after=snaps[0])
        results.append(rec)
        print("[%s] %s" % (rec["tier"], rec["case_id"]), flush=True)

    with open(args.out, "w") as f:
        json.dump(results, f, indent=1)
    tiers = {}
    for rec in results:
        tiers[rec["tier"]] = tiers.get(rec["tier"], 0) + 1
    print("\nSummary:", json.dumps(tiers))
    if not args.keep_tmp:
        shutil.rmtree(base, ignore_errors=True)


if __name__ == "__main__":
    main()
