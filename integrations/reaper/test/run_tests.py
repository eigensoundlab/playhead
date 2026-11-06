#!/usr/bin/env python3
# @noindex (a test, not a ReaPack package)
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
#
# Tests of Playhead for REAPER, outside REAPER, in Lua 5.4 (the Lua of REAPER 6 and 7) through lupa:
#   pip install lupa
#   python3 integrations/reaper/test/run_tests.py                    # all tests
#   python3 integrations/reaper/test/run_tests.py --update-fixtures  # first rewrite the fixtures (needs Node)
#
# 1. test_core.lua: lib/playhead_core.lua against documents made by the Playhead command line and against what
#    src/playhead.js computes from them (fixtures/, written by make_fixtures.js).
# 2. test_actions.lua: every action script loaded and run in a mock REAPER (mock_reaper.lua) that checks the
#    API calls against their documented signatures. With Node available, the scripts run the real command line
#    (tools/playhead-cli.js) through their job scripts, as they would in REAPER on macOS or Linux.
import argparse, json, os, shutil, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(PKG))
FIX = os.path.join(HERE, "fixtures")

try:
    from lupa import lua54
except ImportError:
    sys.exit("These tests need lupa with Lua 5.4: pip install lupa")
try:
    from lupa import lua53
except ImportError:
    lua53 = None


def win_argv(s):
    """How the Microsoft C runtime (and CommandLineToArgvW) splits a command line."""
    args, i, n = [], 0, len(s)
    while True:
        while i < n and s[i] in " \t":
            i += 1
        if i >= n:
            break
        arg, inq = [], False
        while i < n and (inq or s[i] not in " \t"):
            c = s[i]
            if c == "\\":
                j = i
                while j < n and s[j] == "\\":
                    j += 1
                nb = j - i
                if j < n and s[j] == '"':
                    arg.append("\\" * (nb // 2))
                    if nb % 2:
                        arg.append('"')
                        i = j + 1
                    else:
                        i = j
                else:
                    arg.append("\\" * nb)
                    i = j
            elif c == '"':
                if inq and i + 1 < n and s[i + 1] == '"':
                    arg.append('"')
                    i += 2
                else:
                    inq = not inq
                    i += 1
            else:
                arg.append(c)
                i += 1
        args.append("".join(arg))
    return args


class Results:
    def __init__(self):
        self.items = []

    def check(self, name, ok, detail=None):
        ok = bool(ok)
        self.items.append((name, ok))
        line = ("PASS " if ok else "FAIL ") + str(name)
        if isinstance(detail, bytes):
            detail = detail.decode("utf-8", "replace")
        if detail is not None and str(detail) != "":
            line += "  [" + " | ".join(str(detail).splitlines()) + "]"
        print(line)

    def note(self, msg):
        print("     note: " + str(msg))


class Quiet:
    """Collects checks without printing them (the Lua 5.3 pass prints only a summary and its failures)."""
    def __init__(self):
        self.items = []

    def check(self, name, ok, detail=None):
        self.items.append((name, bool(ok), detail))

    def note(self, msg):
        pass


def new_runtime(lua=None):
    L = (lua or lua54).LuaRuntime(unpack_returned_tuples=True)
    lib = os.path.join(PKG, "lib").replace("\\", "/")
    L.execute('package.path = "%s/?.lua;%s/?.lua;" .. package.path' % (lib, HERE.replace("\\", "/")))
    return L


def read(path):
    """A file's bytes (Lua strings are bytes), or None."""
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def run_core(res, tmp, lua=None):
    L = new_runtime(lua)
    fixtures = {k: read(os.path.join(FIX, f)) for k, f in
                [("robot", "robot-hit-steel.playhead.json"), ("arc", "cue-arc.playhead.json"), ("reference", "reference.json")]}
    if any(v is None for v in fixtures.values()):
        res.check("fixtures present (run with --update-fixtures)", False)
        return

    def sh_argv(cmd):
        out = subprocess.run(["sh", "-c", cmd], capture_output=True).stdout
        return L.table_from(out.split(b"\n")[:-1])

    def run_sh(text, path):
        with open(path, "w", newline="") as f:
            f.write(text)
        subprocess.run(["sh", path], capture_output=True)

    T = L.table_from({
        "check": lambda name, ok, detail=None: res.check(name, ok, detail),
        "note": res.note,
        "fixtures": L.table_from(fixtures),
        "tools_json": read(os.path.join(FIX, "tools.json")) or b"[]",
        "sh_argv": sh_argv,
        "win_argv": lambda s: L.table_from(win_argv(s)),
        "run_sh": run_sh,
        "read": read,
        "tmpdir": tmp,
    })
    L.eval('(require("test_core"))')(T)


def node_cli():
    node = shutil.which("node")
    cli = os.path.join(ROOT, "tools", "playhead-cli.js")
    if node and os.path.exists(cli):
        return node, cli
    return None, None


def run_actions(res, tmp):
    L = new_runtime()
    node, cli = node_cli()
    wavs = os.path.join(tmp, "media")
    os.makedirs(wavs, exist_ok=True)
    robot = os.path.join(ROOT, "experiments", "paper", "robot-hit-steel.wav")
    shutil.copy(robot, os.path.join(wavs, "robot hit (steel).wav"))
    # a stand-in file for the music fixture: the cache entry is written by the test, so only its size matters
    with open(os.path.join(wavs, "cue arc.wav"), "wb") as f:
        f.write(b"RIFF" + b"\0" * 1000)

    def listdir(path):
        try:
            return L.table_from(sorted(os.listdir(path)))
        except OSError:
            return L.table_from([])

    def run_detached(cmd):
        subprocess.Popen(["sh", "-c", cmd], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True

    def run_wait(cmd, timeout_ms):
        try:
            p = subprocess.run(["sh", "-c", cmd], capture_output=True, timeout=max(0.1, timeout_ms / 1000.0) if timeout_ms > 0 else None)
            return "%d\n%s" % (p.returncode, p.stdout.decode("utf-8", "replace"))
        except subprocess.TimeoutExpired:
            return None

    T = L.table_from({
        "check": lambda name, ok, detail=None: res.check(name, ok, detail),
        "note": res.note,
        "pkg": PKG, "root": ROOT, "tmp": tmp, "media": wavs,
        "node": node or "", "cli": cli or "",
        "fixtures": L.table_from({"robot": read(os.path.join(FIX, "robot-hit-steel.playhead.json")),
                                  "arc": read(os.path.join(FIX, "cue-arc.playhead.json")),
                                  "tools": read(os.path.join(FIX, "tools.json"))}),
        "now": time.time, "sleep": time.sleep, "listdir": listdir, "exists": os.path.exists,
        "isdir": os.path.isdir, "mkdirs": lambda p: os.makedirs(p, exist_ok=True) or True,
        "run_detached": run_detached, "run_wait": run_wait, "read": read,
    })
    L.eval('(require("test_actions"))')(T)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--update-fixtures", action="store_true", help="rewrite fixtures/ with make_fixtures.js (needs Node)")
    ap.add_argument("--core-only", action="store_true", help="skip the action scripts")
    a = ap.parse_args()
    if a.update_fixtures:
        node, _ = node_cli()
        if not node:
            sys.exit("--update-fixtures needs Node.js")
        subprocess.run([node, os.path.join(HERE, "make_fixtures.js")], check=True)
    res = Results()
    t0 = time.time()
    tmp = tempfile.mkdtemp(prefix="playhead-reaper-test-")
    try:
        print("Lua core (lib/playhead_core.lua), Lua 5.4")
        run_core(res, tmp)
        if lua53 is not None:
            q = Quiet()
            try:
                run_core(q, tmp, lua53)
                bad = [(n, d) for n, ok, d in q.items if not ok]
            except Exception as e:
                bad = [("tests ran to the end", str(e).strip()[:500])]
            for n, d in bad:
                res.note("Lua 5.3: " + n + ("  [" + str(d) + "]" if d else ""))
            res.check("Lua 5.3: the same %d core checks pass (older REAPER versions)" % len(q.items), q.items and not bad,
                      "%d failed" % len(bad) if bad else "")
        if not a.core_only:
            print("\nAction scripts in a mock REAPER")
            run_actions(res, tmp)
    except Exception as e:  # a Lua error ends the run as a failure with its message
        res.check("tests ran to the end", False, str(e).strip().replace("\n", " | ")[:2000])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    failed = [n for n, ok in res.items if not ok]
    print("\n%d of %d checks passed in %.0f s" % (len(res.items) - len(failed), len(res.items), time.time() - t0))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
