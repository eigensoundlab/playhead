#!/usr/bin/env python3
# @noindex (a test, not a ReaPack package)
# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Daniel Sandner
#
# Tests of Playhead for REAPER, outside REAPER, in Lua 5.4 (the Lua of REAPER 6 and 7) through lupa:
#   pip install lupa
#   python3 integrations/reaper/test/run_tests.py                    # all tests (on Windows: python or py, not python3)
#   python3 integrations/reaper/test/run_tests.py --update-fixtures  # first rewrite the fixtures (needs Node)
#
# On Windows the core tests run, with a real batch job through cmd.exe in place of the POSIX shell checks. The action
# scripts' tests simulate REAPER on macOS and Linux (they start the command line through POSIX job scripts), so they
# are skipped there unless --actions is given and a POSIX sh is found (Git for Windows has one); GitHub Actions runs
# them on every push.
#
# 1. test_core.lua: lib/playhead_core.lua against documents made by the Playhead command line and against what
#    src/playhead.js computes from them (fixtures/, written by make_fixtures.js).
# 2. test_actions.lua: every action script loaded and run in a mock REAPER (mock_reaper.lua) that checks the
#    API calls against their documented signatures. With Node available, the scripts run the real command line
#    (tools/playhead-cli.js) through their job scripts, as they would in REAPER on macOS or Linux.
import argparse, json, os, shutil, subprocess, sys, tempfile, time

WINDOWS = os.name == "nt"
if hasattr(sys.stdout, "reconfigure"):   # names with arrows and accents, in any console code page
    sys.stdout.reconfigure(errors="replace")


def find_sh():
    """A POSIX shell: on the PATH, or Git for Windows' own."""
    sh = shutil.which("sh")
    if sh or not WINDOWS:
        return sh
    for base in [os.environ.get("ProgramFiles", r"C:\Program Files"), os.environ.get("ProgramFiles(x86)", ""), os.environ.get("LOCALAPPDATA", "")]:
        for rel in [r"Git\bin\sh.exe", r"Git\usr\bin\sh.exe", r"Programs\Git\bin\sh.exe"]:
            p = os.path.join(base, rel) if base else ""
            if p and os.path.exists(p):
                return p
    return None


SH = find_sh()

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
        out = subprocess.run([SH, "-c", cmd], capture_output=True).stdout
        return L.table_from(out.split(b"\n")[:-1])

    def run_sh(text, path):
        with open(path, "w", newline="") as f:
            f.write(text)
        subprocess.run([SH, path], capture_output=True)

    def run_bat(text, path):
        with open(path, "w", newline="") as f:
            f.write(text)
        subprocess.run(["cmd.exe", "/D", "/V:OFF", "/S", "/C", '"' + path + '"'], capture_output=True)

    entries = {
        "check": lambda name, ok, detail=None: res.check(name, ok, detail),
        "note": res.note,
        "fixtures": L.table_from(fixtures),
        "tools_json": read(os.path.join(FIX, "tools.json")) or b"[]",
        "win_argv": lambda s: L.table_from(win_argv(s)),
        "read": read,
        "tmpdir": tmp.replace("\\", "/") if not WINDOWS else tmp,
        "windows": WINDOWS,
    }
    if SH:
        entries.update({"sh_argv": sh_argv, "run_sh": run_sh})
    if WINDOWS:
        entries["run_bat"] = run_bat
    T = L.table_from(entries)
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


def run_index(res, tmp):
    """The ReaPack index (tools/reapack-index.js): every file of the package, pinned to one commit, with its hash."""
    import hashlib, urllib.parse
    import xml.etree.ElementTree as ET
    node, _ = node_cli()
    if not node:
        res.note("ReaPack index: needs Node (skipped)")
        return
    out = os.path.join(tmp, "index.xml")
    p = subprocess.run([node, os.path.join(ROOT, "tools", "reapack-index.js"), "--ref", "0123456789abcdef0123456789abcdef01234567", "--out", out], capture_output=True)
    if p.returncode != 0:
        res.check("ReaPack index: written", False, p.stderr.decode("utf-8", "replace")[-300:])
        return
    root = ET.parse(out).getroot()
    packs = root.findall("./category/reapack")
    sources = root.findall(".//source")
    want = ["Playhead - Analyse selected items.lua", "Playhead - Add markers for selected items.lua", "Playhead - Write curves as automation.lua",
            "Playhead - Process selected items.lua", "Playhead - Arrange selected layers.lua", "Playhead - Split items at sounds.lua",
            "Playhead - Tempo map from item.lua", "Playhead - Strip window.lua", "Playhead - Settings.lua",
            "lib/playhead_core.lua", "lib/playhead_reaper.lua", "Playhead Control.jsfx"]
    bad = []
    got = []
    for s in sources:
        f = s.get("file") or packs[0].get("name")
        got.append(f)
        prefix = "https://raw.githubusercontent.com/eigensoundlab/playhead/0123456789abcdef0123456789abcdef01234567/integrations/reaper/"
        if not s.text.startswith(prefix) or urllib.parse.unquote(s.text[len(prefix):]) != f:
            bad.append("url of " + f)
        data = read(os.path.join(PKG, f)) or b""
        if s.get("hash") != "1220" + hashlib.sha256(data).hexdigest():
            bad.append("hash of " + f)
        is_action = f.startswith("Playhead - ")
        if (s.get("main") == "main") != is_action:
            bad.append("main section of " + f)
        if (s.get("type") == "effect") != f.endswith(".jsfx"):
            bad.append("type of " + f)
    version = packs[0].find("version").get("name") if packs else None
    header = (read(os.path.join(PKG, "Playhead - Analyse selected items.lua")) or b"").decode("utf-8")
    res.check("ReaPack index: one package with every action, the library and the effect, pinned to a commit, with hashes; "
              "the scripts' version", root.get("version") == "1" and root.get("name") == "Playhead" and len(packs) == 1 and sorted(got) == sorted(want)
              and not bad and version and ("@version " + version) in header,
              "; ".join(bad) or "%d files, version %s" % (len(got), version))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--update-fixtures", action="store_true", help="rewrite fixtures/ with make_fixtures.js (needs Node)")
    ap.add_argument("--core-only", action="store_true", help="skip the action scripts")
    ap.add_argument("--actions", action="store_true", help="on Windows, run the action scripts' tests too (needs a POSIX sh)")
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
        run_index(res, tmp)
        if a.core_only:
            pass
        elif WINDOWS and not (a.actions and SH):
            res.note("action scripts: skipped on Windows (they are tested in a mock REAPER on macOS or Linux, where they "
                     "start the command line through POSIX job scripts; GitHub Actions runs them on every push). "
                     "Run with --actions to try them with Git for Windows' sh" + (" (none found)" if not SH else "") + ".")
        elif not SH:
            res.note("action scripts: skipped (no POSIX sh found)")
        else:
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
