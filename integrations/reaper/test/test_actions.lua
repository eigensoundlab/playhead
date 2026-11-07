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
  local SCRIPTS = { "Analyse selected items", "Add markers for selected items", "Write curves as automation", "Process selected items", "Strip window", "Settings" }

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
      for _, tag in ipairs({ "@description", "@version 0.2.0", "@author Daniel Sandner", "SPDX%-License%-Identifier: Apache%-2%.0", "Copyright 2026 Daniel Sandner" }) do
        if not text:find(tag) then bad[#bad + 1] = n .. ": no " .. tag end
      end
    end
    local main = T.read(script("Analyse selected items")) or ""
    for _, n in ipairs(SCRIPTS) do if not main:find("%[main%] Playhead %- " .. n:gsub("%p", "%%%0") .. "%.lua") then bad[#bad + 1] = "@provides lacks " .. n end end
    if not main:find("[effect] Playhead Control.jsfx", 1, true) then bad[#bad + 1] = "@provides lacks the JSFX" end
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
  local kinds = { events = true, sections = true, downbeats = true }
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
end
