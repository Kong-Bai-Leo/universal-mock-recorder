"""S3 bundler for 3ds Max platform bundles (mirrors build_acad_bundle.py).

Reads  <vault>/families/*_io.json + <vault>/families/*_io_fixture.json
Writes <task>/input/{fixture,manifest,tests_visible}.json
       <vault>/tests_hidden.json   (secure vault, outside repo and HOME)

Manifest is de-identified: op ids + family only.

Usage: py -3 build_max_bundle.py --vault <vault_dir> --task <task_dir>
"""
import argparse
import glob
import json
import os


def canon(o):
    return json.dumps(o, sort_keys=True)


def build_test(rec):
    return {
        "case_id": rec["case_id"],
        "op": rec["op"],
        "params": rec.get("params", {}),
        "ms_call": rec["ms_call"],
        "tier": rec["tier"],
        "expected": {
            "objects_added": rec.get("objects_added", []),
            "objects_removed": rec.get("objects_removed", []),
            "objects_changed": rec.get("objects_changed", []),
            "counts_after": rec["after"]["counts"],
        },
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault", required=True)
    ap.add_argument("--task", required=True)
    ap.add_argument("--workspace", required=True)
    args = ap.parse_args()

    fixture = None
    families = {}
    for p in sorted(glob.glob(os.path.join(args.vault, "families", "*_io.json"))):
        fam = os.path.basename(p).replace("_io.json", "")
        with open(p) as f:
            families[fam] = json.load(f)
        fx = p.replace("_io.json", "_io_fixture.json")
        if fixture is None and os.path.exists(fx):
            with open(fx) as f:
                fixture = json.load(f)

    visible, hidden, ops = [], [], {}
    dropped = []
    for fam, records in families.items():
        for rec in records:
            op = rec["op"]
            ent = ops.setdefault(op, {"op": op, "family": fam})
            if not rec.get("ok") or rec["tier"] in ("T3_fail", "T3_nondet"):
                dropped.append({"case_id": rec["case_id"],
                                "reason": rec.get("error", rec["tier"])})
                continue
            if rec["tier"] == "T2_noop":
                continue
            t = build_test(rec)
            if not any(v["op"] == op for v in visible):
                visible.append(t)
            else:
                hidden.append(t)

    manifest = {
        "workspace": args.workspace,
        "software": "3ds Max 2027",
        "ops": sorted(ops.values(), key=lambda x: (x["family"], x["op"])),
        "n_ops": len(ops),
        "snapshot_kinds": ["objects", "counts"],
        "tolerance": 2e-3,
    }

    inp = os.path.join(args.task, "input")
    os.makedirs(inp, exist_ok=True)
    with open(os.path.join(inp, "fixture.json"), "w") as f:
        json.dump(fixture, f, indent=1)
    with open(os.path.join(inp, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    with open(os.path.join(inp, "tests_visible.json"), "w") as f:
        json.dump(visible, f, indent=1)
    with open(os.path.join(args.vault, "tests_hidden.json"), "w") as f:
        json.dump(hidden, f, indent=1)

    print("ops:", len(ops), "visible:", len(visible), "hidden:", len(hidden),
          "dropped:", len(dropped))
    for d in dropped[:10]:
        print("  dropped:", d["case_id"], "-", str(d["reason"])[:70])


if __name__ == "__main__":
    main()
