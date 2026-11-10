-- @noindex (a test, not a ReaPack package)
-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
--
-- Smoke tests of the action scripts in a mock REAPER (mock_reaper.lua), run by run_tests.py. Every script is
-- loaded (syntax), then run on a small project: a sound effect item with a start offset, a music item with a
-- playback rate whose analysis is already cached, the sound effect reversed (a section of its file), a MIDI item
-- and an empty item. With Node, the scripts start the real command line (tools/playhead-cli.js) through their job
-- scripts and wait for it with defer, as in REAPER on macOS and Linux.

return function(T)
  local Mock = require("mock_reaper")
  local core = require("playhead_core")
  local check = T.check

  local resource = T.tmp .. "/resource"
  T.mkdirs(resource .. "/Scripts/Playhead")
  local media = T.media .. "/project media"
  T.mkdirs(media)
  local env = Mock.new(T, { resource = resource, media = media, jsfx = T.pkg .. "/Playhead Control.jsfx" })
  local have_cli = T.node ~= "" and T.cli ~= ""
  if not have_cli then
    check("action scripts: Node and tools/playhead-cli.js are needed to run them (skipped)", true, "no Node")
  end
  env.ext["Playhead/exe"] = T.cli
  env.ext["Playhead/node"] = T.node
  local function script(name) return T.pkg .. "/Playhead - " .. name .. ".lua" end
  local SCRIPTS = { "Analyse selected items", "Add markers for selected items", "Write curves as automation", "Process selected items",
    "Arrange selected layers", "Split items at sounds", "Tempo map from item", "Strip window", "Settings", "Level items", "Levels settings" }

  -- every file loads (syntax) and carries its licence and ReaPack header
  do
    local bad = {}
    for _, f in ipairs({ T.pkg .. "/lib/playhead_core.lua", T.pkg .. "/lib/playhead_reaper.lua" }) do
      local chunk, e = loadfile(f)
      if not chunk then bad[#bad + 1] = e end
    end
    for _, n in ipairs(SCRIPTS) do
      local f = script(n)
      local chunk, e = loadfile(f)
      if not chunk then bad[#bad + 1] = e end
      local text = T.read(f) or ""
      for _, tag in ipairs({ "@description", "@version 0.3.0", "@author Daniel Sandner", "SPDX%-License%-Identifier: Apache%-2%.0", "Copyright 2026 Daniel Sandner" }) do
        if not text:find(tag) then bad[#bad + 1] = n .. ": no " .. tag end
      end
    end
    local main = T.read(script("Analyse selected items")) or ""
    for _, n in ipairs(SCRIPTS) do if not main:find("%[main%] Playhead %- " .. n:gsub("%p", "%%%0") .. "%.lua") then bad[#bad + 1] = "@provides lacks " .. n end end
    if not main:find("[effect] Playhead Control.jsfx", 1, true) then bad[#bad + 1] = "@provides lacks the JSFX" end
    -- the installer and uninstaller: loadable, licensed, kept out of ReaPack (which installs and removes by itself)
    for _, n in ipairs({ "Install", "Uninstall" }) do
      local f = script(n)
      local chunk, e = loadfile(f)
      if not chunk then bad[#bad + 1] = e end
      local text = T.read(f) or ""
      if not (text:find("^%-%- @noindex") and text:find("SPDX%-License%-Identifier: Apache%-2%.0")) then bad[#bad + 1] = n .. ": no @noindex or licence" end
      if main:find("Playhead - " .. n, 1, true) then bad[#bad + 1] = "@provides should not list " .. n end
    end
    check("scripts: every file loads and has its licence and ReaPack header; the package provides all of them", #bad == 0, bad[1])
  end
  if not have_cli then return end

  -- finding and checking the command line (settings, then <resource>/Scripts/Playhead, then the PATH)
  do
    _G.reaper, _G.gfx = env.reaper, env.gfx
    package.loaded.playhead_reaper = nil
    local R = require("playhead_reaper")
    local own = resource .. "/Scripts/Playhead/playhead"
    local s = R.settings()
    s.exe = ""
    local saved_path = env.ext["Playhead/exe"]
    local found0 = R.find_executable(s)
    local missing = select(2, R.cli({ exe = T.tmp .. "/nothing/playhead", node = "node", extra_path = "", timeout = 30, profile = "auto" }, true))
    local h = io.open(own, "w"); h:write("#!/bin/sh\necho 9.8.7\n"); h:close()
    local found1 = R.find_executable(s)
    local not_exec = select(2, R.cli({ exe = own, node = "node", extra_path = "", timeout = 30, profile = "auto" }, true))
    T.run_wait("chmod +x " .. core.quote_posix(own), 5000)
    local works = R.cli({ exe = own, node = "node", extra_path = "", timeout = 30, profile = "auto" }, true)
    local h2 = io.open(own, "w"); h2:write("#!/bin/sh\necho 'playhead: cannot read x.mp3: needs ffmpeg to decode .mp3 (only WAV is read without ffmpeg)' >&2\nexit 2\n"); h2:close()
    local fails = select(2, R.cli({ exe = own, node = "node", extra_path = "", timeout = 30, profile = "auto" }, true))
    os.remove(own)
    env.ext["Playhead/exe"] = saved_path
    reaper.SetExtState("Playhead", "checked_exe", "", false)
    check("command line: found in Scripts/Playhead, checked with version; missing, not executable and failing executables explained",
      found0 ~= own and found1 == own and works and works.version == "9.8.7" and missing:find("not found", 1, true) and not_exec:find("not allowed to run", 1, true)
        and fails:find("ffmpeg", 1, true), tostring(not_exec):sub(1, 90))
  end

  local function version()
    local out = T.run_wait(core.quote_posix(T.node) .. " " .. core.quote_posix(T.cli) .. " version", 30000) or ""
    return out:match("\n(%S+)")
  end
  local cli_version = version()

  -- the project
  local robot_file = T.media .. "/robot hit (steel).wav"
  local robot_doc = core.load_document(T.fixtures.robot)
  local robot_len = robot_doc.source.duration
  local arc_file = T.media .. "/cue arc.wav"
  local tr1, tr2 = env.add_track("Track 1"), env.add_track("Track 2")
  local rsrc = env.source({ file = robot_file, len = robot_len })
  local A = env.add_item(tr1, { source = rsrc, pos = 10, len = 1.0, offs = 0.1, name = "robot hit (steel).wav" })
  local B = env.add_item(tr1, { source = env.source({ file = arc_file, len = 64, sr = 44100 }), pos = 30, len = 20, offs = 5, rate = 1.25, name = "cue arc" })
  local C = env.add_item(tr2, { source = env.source({ file = "", len = robot_len, parent = rsrc, section = { offs = 0, len = robot_len, rev = true } }), pos = 50, len = robot_len, name = "robot reversed" })
  local D = env.add_item(tr2, { source = env.source({ file = "", type = "MIDI", len = 4 }), pos = 0, len = 4, midi = true, name = "MIDI item" })
  local E = env.add_item(tr2, { pos = 70, len = 2 })

  local cache = resource .. "/Data/Playhead/cache"
  local function size(f) local h = io.open(f, "rb"); if not h then return 0 end local n = h:seek("end"); h:close(); return n end
  local function cache_file(file, len) return cache .. "/" .. core.cache_key({ path = file, size = size(file), length = len, profile = "auto", version = cli_version, os = "linux" }) .. ".json" end
  -- the music item's analysis is in the cache already (the fixture document, for a stand-in file)
  T.mkdirs(cache)
  do local h = io.open(cache_file(arc_file, 64), "wb"); h:write(T.fixtures.arc); h:close() end

  local function scenario(name, path, opts, after)
    env.errors, env.messages, env.console, env.dialogs, env.menus = {}, {}, {}, {}, {}
    env.missing = {}
    local ok = env.run_script(path, opts and opts.seconds or 120, opts and opts.on_tick)
    local missing = {}
    for k in pairs(env.missing) do missing[#missing + 1] = k end
    local ok2, detail = after()
    local errs = {}
    for i = 1, math.min(3, #env.errors) do errs[i] = env.errors[i] end
    check(name, ok and ok2 and #env.errors == 0 and #missing == 0,
      #env.errors > 0 and table.concat(errs, " | ") or (#missing > 0 and ("unknown API: " .. table.concat(missing, ", ")) or detail))
  end
  local function console() return table.concat(env.console) end
  local function last_message() return env.messages[#env.messages] and env.messages[#env.messages].text or "" end

  ------------------------------------------------------------------------------------------------------------------
  -- Analyse
  ------------------------------------------------------------------------------------------------------------------
  env.select({ A, B, C, D, E })
  scenario("analyse: the sound effect is analysed by the real command line, the music item comes from the cache, MIDI and empty items are explained",
    script("Analyse selected items"), nil, function()
      local c = console()
      local msg = last_message()
      local ok = c:find("robot hit %(steel%)%.wav: 1%.21 s, sfx profile") and c:find("cue arc%.wav: 64 s, music profile") and T.exists(cache_file(robot_file, robot_len))
        and msg:find("MIDI item", 1, true) and msg:find("empty", 1, true) and (env.gfx_calls.init or 0) >= 1 and env.window == nil
      return ok, c:sub(1, 120)
    end)
  local exec_before = #(env.exec or {})
  env.select({ A, B })
  scenario("analyse: items already analysed are not analysed again unless asked", script("Analyse selected items"), nil, function()
    return #(env.exec or {}) == exec_before and env.messages[1] and env.messages[1].text:find("already analysed") and console():find("sfx profile"), #(env.exec or {}) - exec_before .. " runs"
  end)

  -- on a display scaled to 150 % (Windows does not make the window larger): the progress window is made larger,
  -- and its note stays clear of the bottom edge
  do
    local copy = T.media .. "/robot copy for the progress window.wav"
    local hi, ho = io.open(robot_file, "rb"), nil
    local bytes = hi:read("a"); hi:close(); ho = io.open(copy, "wb"); ho:write(bytes); ho:close()
    local P = env.add_item(tr2, { source = env.source({ file = copy, len = robot_len }), pos = 140, len = 1, name = "robot copy" })
    env.select({ P })
    env.retina, env.text_boxes = 1.5, {}
    scenario("analyse: the progress window fits its text on a display scaled to 150 %", script("Analyse selected items"), nil, function()
      local note
      for _, b in ipairs(env.text_boxes) do if b.s:find("Close this window", 1, true) then note = b end end
      local ok = note and note.wh >= 132 * 1.5 * 0.9 and note.y + note.h <= note.wh - 16 and note.x >= 16
      return ok, note and string.format("window %d high, note at %d-%d", note.wh, note.y, note.y + note.h) or "no progress note drawn"
    end)
    env.retina = nil
  end

  ------------------------------------------------------------------------------------------------------------------
  -- Markers
  ------------------------------------------------------------------------------------------------------------------
  local robot_cached = core.load_document(T.read(cache_file(robot_file, robot_len)))
  local arc_doc = core.load_document(T.fixtures.arc)
  local function map_of(item, len, sections, file_len)
    local tk = item.takes[1]
    return core.take_map({ pos = item.pos, len = item.len, offs = tk.offs, rate = tk.rate, loop = false, src_len = len, sections = sections, file_len = file_len })
  end
  local kinds = { events = true, sections = true, downbeats = true, changes = true }
  local planA = core.marker_plan(robot_cached, map_of(A, robot_len), kinds)
  local planB = core.marker_plan(arc_doc, map_of(B, 64), kinds)
  local planC = core.marker_plan(robot_cached, map_of(C, robot_len, { { offs = 0, len = robot_len, rev = true } }, robot_len), kinds)
  local function project_counts()
    local m, r = 0, 0
    for _, x in ipairs(env.markers) do if x.isrgn then r = r + 1 else m = m + 1 end end
    return m, r
  end
  env.select({ A, B, C })
  scenario("markers: events as take markers, sections as regions, bars as markers, clipped to each item", script("Add markers for selected items"), nil, function()
    local m, r = project_counts()
    local inside = true
    for _, x in ipairs(env.markers) do
      if x.isrgn and (x.pos < 30 - 1e-9 or x.rgnend > 50 + 1e-9) then inside = false end
      if not x.isrgn and (x.pos < 30 or x.pos > 50) then inside = false end
    end
    local ok = #A.takes[1].markers == #planA.take and #C.takes[1].markers == #planC.take and #planA.take > 0 and m == #planB.markers and r == #planB.regions and r > 0 and inside
    return ok, string.format("%d + %d take markers, %d bars, %d regions", #A.takes[1].markers, #C.takes[1].markers, m, r)
  end)
  scenario("markers: running again replaces them instead of adding more", script("Add markers for selected items"), nil, function()
    local m, r = project_counts()
    return #A.takes[1].markers == #planA.take and m == #planB.markers and r == #planB.regions and console():find("earlier ones replaced"), m .. " bars, " .. r .. " regions"
  end)

  ------------------------------------------------------------------------------------------------------------------
  -- Curves as automation
  ------------------------------------------------------------------------------------------------------------------
  env.select({ A, B })
  local function control(tr) for i, f in ipairs(tr.fx) do if f.name:find("Playhead Control", 1, true) then return f, i end end end
  scenario("curves: Playhead Control inserted first on the track, curves written over each item's range, slots labelled",
    script("Write curves as automation"), nil, function()
      local f, idx = control(tr1)
      if not f then return false, "no Playhead Control on the track" end
      local okp, n = true, 0
      for p = 0, 2 do
        local e = f.env[p]
        if not e or #e.points < 3 then okp = false
        else
          for _, pt in ipairs(e.points) do
            n = n + 1
            local inA, inB = pt.time >= 10 - 1e-9 and pt.time <= 11 + 1e-9, pt.time >= 30 - 1e-9 and pt.time <= 50 + 1e-9
            if not (inA or inB) or pt.value < 0 or pt.value > 1 then okp = false end
          end
          if e.unsorted or e.info.VISIBLE ~= "1" then okp = false end
        end
      end
      local codes = f.params[18].value == core.CURVE_CODES.harshness and f.params[19].value == core.CURVE_CODES.tension and f.params[20].value == core.CURVE_CODES.onsetStrength
      return idx == 1 and okp and codes and (f.renamed or ""):find("1 harshness", 1, true) ~= nil, n .. " points; " .. tostring(f.renamed)
    end)
  do -- points outside the items stay, and the envelope keeps its value at the item's edges
    local f = control(tr1)
    local e = f.env[0]
    e.points[#e.points + 1] = { time = 5, value = 0.3, shape = 0, tension = 0, selected = false }
    e.points[#e.points + 1] = { time = 60, value = 0.7, shape = 0, tension = 0, selected = false }
    table.sort(e.points, function(a, b) return a.time < b.time end)
  end
  env.select({ A })
  scenario("curves: writing again replaces points only inside the item; points outside and the value at its edges stay",
    script("Write curves as automation"), nil, function()
      local e = control(tr1).env[0]
      local at5, at60, before, edge = false, false, 0, nil
      for _, pt in ipairs(e.points) do
        if pt.time == 5 and pt.value == 0.3 then at5 = true end
        if pt.time == 60 and pt.value == 0.7 then at60 = true end
        if pt.time > 11 + 1e-9 and pt.time < 30 - 1e-9 then before = before + 1 end
        if pt.time == 10 then edge = pt.value end
      end
      local inB = 0
      for _, pt in ipairs(e.points) do if pt.time >= 30 and pt.time <= 50 then inB = inB + 1 end end
      return at5 and at60 and before == 0 and edge ~= nil and inB > 2 and #control(tr1).params > 0, "edge value " .. tostring(edge)
    end)
  env.input_answers = { function(v) v[1] = "nonsense"; return v end, function(v) v[1] = "harsh"; v[12] = "selected"; return v end }
  scenario("curves: an unknown curve name is explained with the list of curves; no selected track is reported",
    script("Write curves as automation"), nil, function()
      local first = env.messages[1] and env.messages[1].text or ""
      return first:find('no curve called "nonsense"', 1, true) and first:find("onsetStrength", 1, true) and last_message():find("no track is selected", 1, true), first:sub(1, 80)
    end)
  env.input_answers = {}

  ------------------------------------------------------------------------------------------------------------------
  -- Process
  ------------------------------------------------------------------------------------------------------------------
  local function pick(label)
    return function(menu)
      local n = 0
      for field in (menu .. "|"):gmatch("([^|]*)|") do
        if field ~= "" and field:sub(1, 1) ~= ">" then       -- (a submenu's title is not numbered)
          n = n + 1
          if field:gsub("^[#!<]+", ""):gsub("^%s+", "") == label then return n end
        end
      end
      return 0
    end
  end
  env.select({ A })
  env.menu_choice = pick("De-harsh")
  local takes_before = #A.takes
  scenario("process: De-harsh from the tool list, parameters from its specs, both results added as named takes after the original",
    script("Process selected items"), nil, function()
      local names = {}
      for i = takes_before + 1, #A.takes do names[#names + 1] = A.takes[i].name end
      local first = A.takes[takes_before + 1]
      local files_ok = first and first.src and T.exists(first.src.file) and first.src.file:find("/Playhead/", 1, true)
      local leftover = false
      for _, f in ipairs(T.listdir(media .. "/Playhead")) do if f:find("^%.render") then leftover = true end end
      local d = env.dialogs[1]
      return #A.takes == takes_before + 2 and names[1] == "De-harsh" and names[2] == "De-harsh (removed)" and A.cur == takes_before and files_ok
        and math.abs(first.offs - 0.1) < 1e-9 and not leftover and console():find("Loudness matched", 1, true) and d and d.captions[1]:find("relative/absolute/always", 1, true),
        table.concat(names, ", ")
    end)
  A.cur = 0                                                -- the original take again (the processed one is active now)
  scenario("process: processing the same file again keeps the earlier results (new file names)", script("Process selected items"), nil, function()
    local a, b = A.takes[#A.takes - 1].src.file, A.takes[takes_before + 1].src.file
    return a ~= b and T.exists(a) and T.exists(b) and a:find("_deharsh_2%.wav$") ~= nil, a:match("[^/]*$")
  end)
  A.cur = takes_before + 2                                 -- a processed take: processing it again chains the tools
  scenario("process: the active take is what is processed (a processed take can be processed again)", script("Process selected items"), nil, function()
    local f = A.takes[#A.takes - 1].src.file
    return f:find("_deharsh_2_deharsh%.wav$") ~= nil, f:match("[^/]*$")
  end)
  -- a tool that changes the length: the new takes start at the same moment of the sound, and the item is lengthened
  local S = env.add_item(tr2, { source = rsrc, pos = 120, len = 1.0, offs = 0.1, name = "robot to stretch" })
  env.select({ S })
  env.menu_choice = pick("Stretch keeping the attacks")
  env.input_answers = { function(v) v[1] = "2"; return v end }
  scenario("process: Stretch keeping the attacks: the takes start at the same moment of the sound, the item is lengthened to play them",
    script("Process selected items"), nil, function()
      local t1, t2 = S.takes[2], S.takes[3]
      local ok = #S.takes == 3 and t1.name == "Stretch keeping the attacks" and t2.name == "Stretch keeping the attacks (plain)"
        and math.abs(t1.offs - 0.2) < 0.002 and math.abs(t2.offs - 0.2) < 0.002 and math.abs(S.len - 2.0) < 0.002 and S.cur == 1 and last_message():find("x2.00", 1, true)
      return ok, string.format("%s; start %.4f s, item %.4f s", t1 and t1.name or "?", t1 and t1.offs or -1, S.len)
    end)
  env.input_answers = {}
  env.menu_choice = nil

  ------------------------------------------------------------------------------------------------------------------
  -- Arrange selected layers
  ------------------------------------------------------------------------------------------------------------------
  -- menu answers in turn: a label, or the start of one ending in "*"; 0 (closed) when the list runs out
  local function menu_sequence(list)
    local i = 0
    return function(menu)
      i = i + 1
      local want = list[i]
      if not want then return 0 end
      local n = 0
      for field in (menu .. "|"):gmatch("([^|]*)|") do
        if field ~= "" and field:sub(1, 1) ~= ">" then
          n = n + 1
          local label = field:gsub("^[#!<]+", ""):gsub("^%s+", "")
          if label == want or (want:sub(-1) == "*" and label:sub(1, #want - 1) == want:sub(1, -2)) then return n end
        end
      end
      return 0
    end
  end
  local L1 = env.add_item(tr1, { source = rsrc, pos = 200, len = robot_len, offs = 0, name = "robot body" })
  local L2 = env.add_item(tr2, { source = rsrc, pos = 200.04, len = 1.0, offs = 0.1, vol = 0.5, name = "robot click" })
  env.select({ L1, L2, B, C })
  env.menu_choice = menu_sequence({ "2.*", "Play again", "1.*", "Keep this one" })
  local undo_before = #env.undo_points
  scenario("arrange: candidates from the command line, each applied and played as picked; the kept one in one undo step; the loudest layer stays; other rates and backwards items left out",
    script("Arrange selected layers"), nil, function()
      local db = 20 * math.log(L2.vol / 0.5, 10)
      local moved = math.abs(L2.pos - 200.04) > 1e-6 or math.abs(db) > 0.01
      local msg = env.messages[1] and env.messages[1].text or ""
      local ok = L1.pos == 200 and L1.vol == 1 and moved and math.abs(L2.pos - 200.04) <= 0.25 + 1e-6 and db >= -6 - 1e-6 and db <= 3 + 1e-6
        and #env.undo_points == undo_before + 1 and env.undo_points[#env.undo_points] == "Playhead: arrange layers (punch)" and #env.menus >= 4
        and msg:find("cue arc is left out: it plays at rate 1.25", 1, true) and msg:find("robot reversed is left out: it plays backwards", 1, true)
        and console():find("kept 1 of", 1, true) and env.cursor ~= nil
      return ok, string.format("click at %.4f s, %+.2f dB; %d menus; %s", L2.pos, db, #env.menus, console():match("Playhead arrange[^\n]*") or msg:sub(1, 80))
    end)
  L2.pos, L2.vol = 200.04, 0.5
  local kept_pos, kept_vol = L2.pos, L2.vol
  env.select({ L1, L2 })
  env.menu_choice = menu_sequence({ "1.*", "Back to how it was" })
  undo_before = #env.undo_points
  env.input_answers = { function(v) v[5] = "no"; return v end }
  scenario("arrange: going back leaves the layers as they were, with no undo step", script("Arrange selected layers"), nil, function()
    return L2.pos == kept_pos and L2.vol == kept_vol and #env.undo_points == undo_before and #env.messages == 0, string.format("%.4f s", L2.pos)
  end)
  env.input_answers, env.menu_choice = {}, nil

  ------------------------------------------------------------------------------------------------------------------
  -- Split items at sounds
  ------------------------------------------------------------------------------------------------------------------
  local S2 = env.add_item(tr2, { source = rsrc, pos = 300, len = 1.0, offs = 0.1, name = "robot hit (steel).wav" })
  local n_items, n_regions = #env.items, 0
  for _, x in ipairs(env.markers) do if x.isrgn then n_regions = n_regions + 1 end end
  env.select({ S2, C })
  env.input_answers = { function(v) v[3] = "50"; v[7] = "yes"; return v end }
  scenario("split: a cut before each event, the pieces named after their sounds, the last shortened to its decay and faded, a region each; backwards items explained",
    script("Split items at sounds"), nil, function()
      local pieces = {}
      for _, it in ipairs(env.items) do if it.pos >= 300 - 1e-9 and it.pos < 301 and it.track == tr2 then pieces[#pieces + 1] = it end end
      table.sort(pieces, function(a, b) return a.pos < b.pos end)
      local regs = {}
      for _, x in ipairs(env.markers) do if x.isrgn and x.pos >= 300 then regs[#regs + 1] = x end end
      table.sort(regs, function(a, b) return a.pos < b.pos end)
      local e2, e3 = robot_doc.events[2], robot_doc.events[3]
      local p2, p3 = pieces[2], pieces[3]
      local ok = #env.items == n_items + 2 and #pieces == 3 and p2 and math.abs(p2.pos - (300 + core.attack_time(robot_doc, e2.start) - 0.1 - 0.005)) < 1e-9
        and p2.takes[1].name == "robot hit (steel) 01 " .. e2.word and p3.takes[1].name == "robot hit (steel) 02 " .. e3.word
        and math.abs(p3.pos + p3.len - (300 + e3.decayEnd - 0.1 + 0.06)) < 1e-9 and math.abs(p3.fadeout - 0.06) < 1e-9 and pieces[1].takes[1].name == "robot hit (steel).wav"
        and #regs == 2 and regs[2].name == p3.takes[1].name and math.abs(regs[2].rgnend - (p3.pos + p3.len)) < 1e-9
        and last_message():find("robot reversed: it plays backwards", 1, true)
      return ok, string.format("%d pieces, %d regions: %s", #pieces, #regs, p3 and p3.takes[1].name or "?")
    end)
  env.input_answers = {}

  ------------------------------------------------------------------------------------------------------------------
  -- Tempo map from item
  ------------------------------------------------------------------------------------------------------------------
  env.tempo[1] = { time = 0, bpm = 120, num = 4, den = 4, linear = false }
  env.tempo[2] = { time = 35, bpm = 100, num = 0, den = 0, linear = false }
  local planT = core.tempo_plan(arc_doc, map_of(B, 64), "bars")
  env.select({ B })
  scenario("tempo map: markers at the bars of the music item (played 1.25 times faster), the first with 4/4; the item set to time base Time; markers in its range replaced",
    script("Tempo map from item"), nil, function()
      local at0, old, new = false, false, {}
      for _, k in ipairs(env.tempo) do
        if k.time == 0 and k.bpm == 120 then at0 = true elseif k.bpm == 100 then old = true else new[#new + 1] = k end
      end
      local lands = #new == #planT.markers
      for i, k in ipairs(new) do if not planT.markers[i] or math.abs(k.time - planT.markers[i].pos) > 1e-9 or math.abs(k.bpm - planT.markers[i].bpm) > 1e-9 then lands = false end end
      local ok = at0 and not old and lands and new[1].num == 4 and new[1].den == 4 and new[2] and new[2].num == 0 and B.timebase == 0
        and math.abs(planT.mean_bpm - 1.25 * arc_doc.rhythm.tempo) < 1.5 and env.undo_points[#env.undo_points] == "Playhead: tempo map from cue arc"
        and env.messages[1] and env.messages[1].text:find("set to time base Time", 1, true)
      return ok, string.format("%d markers (plan %d), %.2f BPM on average", #new, #planT.markers, planT.mean_bpm)
    end)
  local tempo_before = #env.tempo
  env.select({ A })
  scenario("tempo map: a sound effect has no beat; nothing is added and the music profile is explained", script("Tempo map from item"), nil, function()
    return #env.tempo == tempo_before and last_message():find("music profile", 1, true), last_message():sub(1, 90)
  end)

  ------------------------------------------------------------------------------------------------------------------
  -- Settings
  ------------------------------------------------------------------------------------------------------------------
  env.input_answers = { function(v) v[3] = "loud"; return v end, function(v) v[3] = "auto"; return v end }
  scenario("settings: answers are checked, saved, and the command line is checked", script("Settings"), nil, function()
    return env.messages[1].text:find("profile: auto, fast, sfx or music", 1, true) and last_message():find("Playhead " .. tostring(cli_version) .. " works", 1, true)
      and env.ext["Playhead/exe"] == T.cli, last_message():sub(1, 60)
  end)
  env.input_answers = {}

  ------------------------------------------------------------------------------------------------------------------
  -- Strip window
  ------------------------------------------------------------------------------------------------------------------
  local G = env.gfx
  env.select({ B })
  local closing = false
  env.getchar = function() return closing and -1 or 0 end
  env.dock = 0
  local seen_look, cursor = nil, nil
  scenario("strip window: draws the selected item, a click moves the edit cursor, the menu changes the look, the toggle state follows the window",
    script("Strip window"), { seconds = 60, on_tick = function(i)
      if i == 4 then G.mouse_x, G.mouse_y, G.mouse_cap = 450, 80, 1 end
      if i == 5 then G.mouse_cap = 0; cursor = env.cursor end
      if i == 7 then env.menu_choice = pick("Structure"); G.mouse_cap = 2 end
      if i == 8 then G.mouse_cap = 0; env.menu_choice = nil end
      if i == 10 then seen_look = env.ext["Playhead/look"]; env.select({ A }) end
      if i == 16 then env.play_state = 1; env.play_pos = 10.5 end
      if i >= 20 then closing = true end
    end }, function()
      local drew = (env.gfx_calls.setimgdim or 0) >= 1 and (env.gfx_calls.blit or 0) >= 3 and (env.gfx_calls.rect or 0) > 500
      local expected = 30 + 450 / 900 * 20
      return drew and cursor and math.abs(cursor - expected) < 0.05 and seen_look == "structure" and env.toggles[55555] == 0,
        string.format("cursor %.2f s (expected %.2f), look %s", cursor or -1, expected, tostring(seen_look))
    end)
  -- the bar raster: the strip is a row per bar; a click in a row moves the edit cursor to that point of that bar
  env.select({ B })
  closing = false
  local rcursor, rlook = nil, nil
  scenario("strip window: on the bar raster a click moves the edit cursor to that point of the bar in its row",
    script("Strip window"), { seconds = 60, on_tick = function(i)
      if i == 3 then env.menu_choice = pick("Bar raster"); G.mouse_cap = 2 end
      if i == 4 then G.mouse_cap = 0; env.menu_choice = nil end
      if i == 6 then G.mouse_x, G.mouse_y, G.mouse_cap = 300, 22 + 100, 1 end
      if i == 7 then G.mouse_cap = 0; rcursor, rlook = env.cursor, env.ext["Playhead/look"] end
      if i >= 9 then closing = true end
    end }, function()
      -- expected: as the window maps it, from the same rows (the strip is 900 x 160 under a 22-pixel header)
      local m = core.take_map({ pos = 30, len = 20, offs = 5, rate = 1.25, src_len = 64, file_len = 64 })
      local column, to_x = core.item_columns(m, 900)
      local nop = setmetatable({}, { __index = function() return function() end end })
      local r = core.render_strip(core.load_document(T.fixtures.arc), nop, { look = "raster", width = 900, height = 160, column = column, to_x = to_x })
      local rows = r.raster and r.raster.rows or {}
      local f = core.raster_time(rows, 300, 100, 900, 160)
      local want = f and core.file_to_project(m, f)[1]
      return rlook == "raster" and rcursor and want and math.abs(rcursor - want) < 1e-6 and #rows >= 12 and #rows <= 15,
        string.format("cursor %.3f s (expected %.3f) in a raster of %d bars", rcursor or -1, want or -1, #rows)
    end)
  -- zoom as in REAPER: the wheel zooms around the mouse, Shift and the wheel scrolls, the menu shows the whole item;
  -- a click moves the edit cursor to the time under the mouse in the zoomed view
  env.select({ B })
  closing = false
  local zc = {}
  scenario("strip window: the wheel zooms around the mouse, Shift + wheel scrolls, clicks follow the zoomed view; the menu zooms out",
    script("Strip window"), { seconds = 60, on_tick = function(i)
      if i == 3 then env.menu_choice = pick(core.LOOKS.plain.name); G.mouse_cap = 2 end
      if i == 4 then G.mouse_cap = 0; env.menu_choice = nil end
      if i == 5 then G.mouse_x, G.mouse_y, G.mouse_wheel = 450, 22 + 80, 240 end
      if i == 7 then G.mouse_x, G.mouse_cap = 0, 1 end
      if i == 8 then G.mouse_cap = 0; zc[1] = env.cursor end
      if i == 9 then G.mouse_x, G.mouse_cap, G.mouse_wheel = 450, 8, 120 end
      if i == 10 then G.mouse_cap = 0 end
      if i == 11 then G.mouse_x, G.mouse_cap = 0, 1 end
      if i == 12 then G.mouse_cap = 0; zc[2] = env.cursor end
      if i == 13 then env.menu_choice = pick("Show the whole item (zoom out)"); G.mouse_cap = 2 end
      if i == 14 then G.mouse_cap = 0; env.menu_choice = nil end
      if i == 15 then G.mouse_x, G.mouse_cap = 0, 1 end
      if i == 16 then G.mouse_cap = 0; zc[3] = env.cursor end
      if i >= 18 then closing = true end
    end }, function()
      local v1 = core.zoom_view({ 0, 1 }, 0.5, 1.25 ^ 2, 0.05 / 20)
      local v2 = core.scroll_view(v1, -0.15)
      local want = { 30 + v1[1] * 20, 30 + v2[1] * 20, 30 }
      local ok = true
      for k = 1, 3 do if not zc[k] or math.abs(zc[k] - want[k]) > 1e-6 then ok = false end end
      return ok, string.format("cursor %.3f, %.3f, %.3f s (expected %.3f, %.3f, %.3f)", zc[1] or -1, zc[2] or -1, zc[3] or -1, want[1], want[2], want[3])
    end)
  -- the Colours submenu: a palette is chosen and kept
  env.select({ B })
  closing = false
  scenario("strip window: a palette chosen in the Colours submenu is used and kept",
    script("Strip window"), { seconds = 60, on_tick = function(i)
      if i == 3 then env.menu_choice = pick("Colour-blind safe"); G.mouse_cap = 2 end
      if i == 4 then G.mouse_cap = 0; env.menu_choice = nil end
      if i >= 7 then closing = true end
    end }, function()
      local menu = env.menus[#env.menus] or ""
      return env.ext["Playhead/palette"] == "safe" and menu:find("|>Colours|", 1, true) ~= nil and menu:find("|<Greyscale", 1, true) ~= nil,
        tostring(env.ext["Playhead/palette"])
    end)
  env.ext["Playhead/palette"] = nil
  -- an item that has not been analysed: the window analyses it in the background and then draws it
  local copy = T.media .. "/robot copy.wav"
  do local h = io.open(copy, "wb"); h:write(T.read(robot_file)); h:close() end
  local F = env.add_item(tr2, { source = env.source({ file = copy, len = robot_len }), pos = 80, len = robot_len, name = "robot copy" })
  env.select({ F })
  closing = false
  local ticks = 0
  env.texts = {}
  scenario("strip window: an item without an analysis is analysed in the background, then drawn", script("Strip window"), { seconds = 60, on_tick = function(i)
      ticks = i
      if T.exists(cache_file(copy, robot_len)) and i > 3 then closing = closing or i > 30 end
      if i > 3000 then closing = true end
    end }, function()
      local said = false
      for _, s in ipairs(env.texts or {}) do if s:find("^Analysing robot copy%.wav") then said = true end end
      return T.exists(cache_file(copy, robot_len)) and said, ticks .. " rounds"
    end)
  env.getchar = function() return 0 end

  ------------------------------------------------------------------------------------------------------------------
  -- the example script in README.md (per-event gain), run as a user would: saved next to the actions
  ------------------------------------------------------------------------------------------------------------------
  do
    local readme = T.read(T.pkg .. "/README.md") or ""
    local block = readme:match("<!%-%- example: per%-event gain %-%->%s*```lua\n(.-)\n%s*```")
    local dir = T.tmp .. "/example"
    T.mkdirs(dir .. "/lib")
    for _, f in ipairs({ "playhead_core.lua", "playhead_reaper.lua" }) do
      local h = io.open(dir .. "/lib/" .. f, "wb"); h:write(T.read(T.pkg .. "/lib/" .. f)); h:close()
    end
    if block then
      local code = block:gsub("\n   ", "\n"):gsub("^   ", "")
      local h = io.open(dir .. "/Playhead experiment - per-event gain.lua", "wb"); h:write(code); h:close()
    end
    local G2 = core.load_document(T.read(cache_file(robot_file, robot_len)))
    local item = env.add_item(tr2, { source = rsrc, pos = 200, len = robot_len, offs = 0, name = "robot for levelling" })
    env.select({ item })
    local before = #env.items
    scenario("README example (per-event gain): splits the item at its events and sets one volume per piece",
      dir .. "/Playhead experiment - per-event gain.lua", nil, function()
        if not block then return false, "no example block in README.md" end
        local pieces = { item }
        for i = before + 1, #env.items do pieces[#pieces + 1] = env.items[i] end
        table.sort(pieces, function(a, b) return a.pos < b.pos end)
        local ok = #pieces == #G2.events
        for k, ev in ipairs(G2.events) do
          local want = 10 ^ ((-12 - ev.peakDb) / 20)
          if not pieces[k] or math.abs(pieces[k].vol - want) > 1e-9 or math.abs(pieces[k].pos - (200 + ev.start)) > 1e-6 then ok = false end
        end
        return ok, #pieces .. " pieces for " .. #G2.events .. " events"
      end)
  end

  ------------------------------------------------------------------------------------------------------------------
  -- Levels
  ------------------------------------------------------------------------------------------------------------------
  do
    local trL = env.add_track("SFX")
    local L1 = env.add_item(trL, { source = env.source({ file = robot_file, len = robot_len }), pos = 300, len = robot_len, name = "robot for levels" })
    local L2 = env.add_item(trL, { source = env.source({ file = arc_file, len = 64, sr = 44100 }), pos = 310, len = 20, name = "arc for levels" })
    local S0 = core.levels_settings(nil, nil)
    local function expected(doc, file) return core.levels_gain(S0, {}, core.levels_entry(doc, file, {})).gain end
    local function db_of(item) return core.levels_to_db(item.takes[1].vals.D_VOL) end
    env.select({ L1, L2 })
    scenario("levels: items measured from Playhead's analysis get their gain as take volume (default settings), and the report goes to the console",
      script("Level items"), nil, function()
        local want1, want2 = expected(robot_cached, robot_file), expected(arc_doc, arc_file)
        local ok = math.abs(db_of(L1) - want1) < 0.01 and math.abs(db_of(L2) - want2) < 0.01 and L1.takes[1].ext and L1.takes[1].ext["P_EXT:playhead_levels"]
          and console():find("Playhead levels: 2 items", 1, true) and L1.vol == 1
        return ok, string.format("robot %.2f dB (want %.2f), arc %.2f dB (want %.2f)", db_of(L1), want1, db_of(L2), want2)
      end)
    env.projext["Playhead/levels"] = core.json_encode({ levels = { target = -23 } })
    env.select({ L2 })
    scenario("levels: the project's own target applies to items without a manifest", script("Level items"), nil, function()
      local want = core.levels_gain(core.levels_settings(nil, { target = -23 }), {}, core.levels_entry(arc_doc, arc_file, {})).gain
      return math.abs(db_of(L2) - want) < 0.01 and math.abs(want - (expected(arc_doc, arc_file) - 5)) < 0.01, string.format("arc %.2f dB (want %.2f)", db_of(L2), want)
    end)
    env.projext["Playhead/levels"] = nil
    env.select({ L1, L2 })
    L1.takes[1].vals.D_VOL = 0.5
    env.message_answers = { 7 }
    scenario("levels: a take volume changed by hand since Playhead set it is left alone when you say so", script("Level items"), nil, function()
      local m = env.messages[1] and env.messages[1].text or ""
      return L1.takes[1].vals.D_VOL == 0.5 and m:find("changed since Playhead levelled", 1, true) and console():find("left as it is", 1, true), m:sub(1, 80)
    end)
    -- a manifest next to the files (as Kurator writes it): the sound's measures and tags, the rules; the group's
    -- offset on a folder track named like the group
    local ldir = T.media .. "/levels lib"
    T.mkdirs(ldir)
    local lfile = ldir .. "/EXPLReal_Robot hit.wav"
    do local hi = io.open(robot_file, "rb"); local bytes = hi:read("a"); hi:close(); local ho = io.open(lfile, "wb"); ho:write(bytes); ho:close() end
    local lsize = size(lfile)
    local manifest = { format = "playhead-levels", version = 1, levels = { target = -18 }, rules = { { tag = "Explosions", role = "group", offset = 4 }, { tag = "subtle", role = "modifier", offset = -3, on = false } },
      files = { { path = "EXPLReal_Robot hit.wav", size = lsize, tags = { "Explosions", "subtle" }, measures = { ["momentaryMax@event"] = -20, truePeak = -10 } } } }
    do local h = io.open(ldir .. "/playhead-levels.json", "wb"); h:write(core.json_encode(manifest)); h:close() end
    local fold = env.add_track("Explosions")
    local child = env.add_track("Layer 1", fold)
    local L3 = env.add_item(child, { source = env.source({ file = lfile, len = robot_len }), pos = 330, len = robot_len, name = "explosion layer" })
    env.projext["Playhead/levels"] = core.json_encode({ levels = { place = "track" } })
    local runs = #(env.exec or {})
    env.select({ L3 })
    scenario("levels: from a manifest (no analysis run): the take gets the levelling (+2 dB), the folder track named like the group its offset (+4 dB)",
      script("Level items"), nil, function()
        local ok = math.abs(db_of(L3) - 2) < 0.01 and math.abs(core.levels_to_db(fold.vol) - 4) < 0.01 and child.vol == 1 and #(env.exec or {}) == runs
          and console():find("Explosions: 1 item", 1, true)
        return ok, string.format("take %.2f dB, folder %.2f dB, %d runs", db_of(L3), core.levels_to_db(fold.vol), #(env.exec or {}) - runs)
      end)
    env.projext["Playhead/levels"] = core.json_encode({ levels = { place = "take", depth = 0.5 } })
    scenario("levels: with group offsets on take gain and half the depth, the take carries +4 dB and the folder track goes back to 0 dB",
      script("Level items"), nil, function()
        return math.abs(db_of(L3) - 4) < 0.01 and fold.vol == 1 and console():find("moved back", 1, true), string.format("take %.2f dB, folder %.2f", db_of(L3), fold.vol)
      end)
    env.projext["Playhead/levels"] = nil
    env.input_answers = { function(v) v[2] = "-20"; v[5] = "take"; return v end }
    env.message_answers = { 6 }
    env.file_answers = { ldir .. "/playhead-levels.json" }
    scenario("levels settings: kept in the project, the rules taken from a manifest chosen in the dialog", script("Levels settings"), nil, function()
      local t = core.json_decode(env.projext["Playhead/levels"] or "{}")
      local ok = t.levels and t.levels.target == -20 and t.levels.place == "take" and type(t.rules) == "table" and #t.rules == 2 and console():find("2 rules from", 1, true)
      return ok, tostring(env.projext["Playhead/levels"]):sub(1, 100)
    end)
    env.input_answers, env.message_answers, env.file_answers = {}, {}, {}
  end

  ------------------------------------------------------------------------------------------------------------------
  -- Install and uninstall (last: they change the resource folder)
  ------------------------------------------------------------------------------------------------------------------
  do
    local P = core.PACKAGE
    local dl = T.tmp .. "/Downloads/Playhead for REAPER"           -- an unpacked download, with the executable
    T.mkdirs(dl .. "/lib")
    local function copy(from, to) local h = io.open(from, "rb"); local b = h:read("a"); h:close(); h = io.open(to, "wb"); h:write(b); h:close() end
    for _, f in ipairs(P.actions) do copy(T.pkg .. "/" .. f, dl .. "/" .. f) end
    for _, f in ipairs(P.tools) do copy(T.pkg .. "/" .. f, dl .. "/" .. f) end
    for _, f in ipairs(P.lib) do copy(T.pkg .. "/lib/" .. f, dl .. "/lib/" .. f) end
    copy(T.pkg .. "/" .. P.effect, dl .. "/" .. P.effect)
    copy(T.pkg .. "/README.md", dl .. "/README.md")
    do local h = io.open(dl .. "/playhead", "wb"); h:write("#!/bin/sh\necho 9.9.9\n"); h:close() end
    local sd, ed = resource .. "/Scripts/Playhead", resource .. "/Effects/Playhead"
    env.actions, env.action_commits = {}, 0
    env.message_answers = { 1 }
    scenario("install: copies the package (and the executable) into the resource folder and adds its actions and the uninstaller in one commit",
      dl .. "/Playhead - Install.lua", nil, function()
        local all = T.exists(ed .. "/" .. P.effect) and T.exists(sd .. "/playhead") and T.exists(sd .. "/README.md")
        for _, f in ipairs(P.actions) do all = all and T.exists(sd .. "/" .. f) and env.actions[sd .. "/" .. f] ~= nil end
        for _, f in ipairs(P.lib) do all = all and T.exists(sd .. "/lib/" .. f) end
        local n = 0
        for _ in pairs(env.actions) do n = n + 1 end
        local msg = last_message()
        return all and n == #P.actions + 1 and env.actions[sd .. "/Playhead - Uninstall.lua"] and env.action_commits == 1 and msg:find("is installed", 1, true)
          and msg:find("Playhead - Strip window", 1, true), n .. " actions; " .. msg:sub(1, 60)
      end)
    env.message_answers = { 1 }
    scenario("install: running it again updates in place, with no second set of actions", dl .. "/Playhead - Install.lua", nil, function()
      local n = 0
      for _ in pairs(env.actions) do n = n + 1 end
      return n == #P.actions + 1 and last_message():find("is installed", 1, true), n .. " actions"
    end)
    env.message_answers = { 2 }
    scenario("install: Cancel changes nothing", dl .. "/Playhead - Install.lua", nil, function()
      return #env.messages == 1 and env.action_commits == 2, #env.messages .. " messages"
    end)
    -- uninstall, keeping analyses and settings
    local cached = #T.listdir(cache)
    env.ext["Playhead/look"] = "structure"
    env.message_answers = { 1, 7 }
    scenario("uninstall: removes the actions and the files, keeps analyses and settings when asked to",
      sd .. "/Playhead - Uninstall.lua", nil, function()
        local n = 0
        for _ in pairs(env.actions) do n = n + 1 end
        local files_gone = not T.exists(sd .. "/Playhead - Strip window.lua") and not T.exists(sd .. "/lib/playhead_core.lua") and not T.exists(ed .. "/" .. P.effect)
          and not T.exists(sd .. "/playhead")
        return n == 0 and files_gone and #T.listdir(cache) == cached and cached > 0 and env.ext["Playhead/look"] == "structure" and last_message():find("is removed", 1, true),
          n .. " actions left; " .. last_message():sub(1, 80)
      end)
    -- install again, then uninstall with the analyses and settings
    env.message_answers = { 1 }
    env.run_script(dl .. "/Playhead - Install.lua", 30)
    env.message_answers = { 1, 6 }
    scenario("uninstall: with the analyses and settings, nothing of Playhead is left in the resource folder or the settings",
      sd .. "/Playhead - Uninstall.lua", nil, function()
        local keys = {}
        for k in pairs(env.ext) do if k:find("^Playhead/") then keys[#keys + 1] = k end end
        return not T.exists(sd) and not T.exists(ed) and not T.exists(resource .. "/Data/Playhead") and #keys == 0,
          (#keys > 0 and ("settings left: " .. table.concat(keys, ", ")) or "") .. (T.exists(sd) and (" left in Scripts/Playhead: " .. table.concat(T.listdir(sd), ", ")) or "")
      end)
  end
end
