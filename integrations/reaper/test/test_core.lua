-- @noindex (a test, not a ReaPack package)
-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
--
-- Tests of lib/playhead_core.lua, run by run_tests.py through Lua 5.4. The fixtures are documents made by the
-- Playhead command line and reference values computed by src/playhead.js (test/make_fixtures.js), so the Lua port
-- is checked against the JavaScript it follows.
--
-- T: check(name, ok, detail), fixtures { robot, arc, reference } (texts), sh_argv(cmd) and win_argv(cmd) (how
-- /bin/sh and the Windows C runtime split a command line), run_sh(text, path) (absent without a POSIX sh),
-- run_bat(text, path) (on Windows: through cmd.exe), read(path), tmpdir.

return function(T)
  local M = require("playhead_core")
  local check = T.check
  local abs, floor, max, min = math.abs, math.floor, math.max, math.min
  local function near(a, b, tol) return type(a) == "number" and type(b) == "number" and abs(a - b) <= (tol or 1e-9) end
  local function errmsg(f) local ok, e = pcall(f); return (not ok) and tostring(e) or nil end
  local function list_eq(a, b, tol)
    if #a ~= #b then return false end
    for i = 1, #a do if type(a[i]) == "number" then if not near(a[i], b[i], tol) then return false end elseif a[i] ~= b[i] then return false end end
    return true
  end

  ------------------------------------------------------------------------------------------------------------------
  -- JSON
  ------------------------------------------------------------------------------------------------------------------
  do
    local v = M.json_decode(' { "a": [1, -2.5e-1, 3E2, null, true, false, "x"], "b": null, "c": {"d": []}, "e": {}, "s": "q\\"\\\\\\/\\n\\t\\u00e9\\ud83d\\ude00" } ')
    local ok = v.a[1] == 1 and math.type(v.a[1]) == "integer" and near(v.a[2], -0.25) and v.a[3] == 300 and v.a[4] == M.null
      and v.a[5] == true and v.a[6] == false and v.a[7] == "x" and #v.a == 7 and v.b == nil and type(v.c.d) == "table" and #v.c.d == 0
      and v.s == 'q"\\/\n\t\195\169\240\159\152\128'
    check("json: values, escapes, surrogate pairs, null in arrays kept, null members left out", ok)
    local errs = {
      errmsg(function() M.json_decode("[1,2,]") end), errmsg(function() M.json_decode('{"a":1}x') end),
      errmsg(function() M.json_decode('"abc') end), errmsg(function() M.json_decode("[tru]") end),
      errmsg(function() M.json_decode('{"a" 1}') end), errmsg(function() M.json_decode("\n\n  [1, @]") end),
      errmsg(function() M.json_decode(string.rep("[", 300) .. string.rep("]", 300)) end), errmsg(function() M.json_decode("") end)
    }
    local all = true
    for _, e in ipairs(errs) do if not (e and e:find("^JSON: ")) then all = false end end
    check("json: malformed text raises an error with line and column", all and errs[6]:find("line 3, column 7") ~= nil, errs[6])
    local t = { name = "a\"b\n", list = { 1, 2.5, "x", true }, nested = { k = false }, empty = {} }
    local back = M.json_decode(M.json_encode(t))
    check("json: encode and decode round trip", back.name == t.name and list_eq(back.list, t.list) and back.nested.k == false and type(back.empty) == "table",
      M.json_encode(t))
    check("json: byte order mark accepted", M.json_decode("\239\187\191[1]")[1] == 1)
  end

  ------------------------------------------------------------------------------------------------------------------
  -- documents
  ------------------------------------------------------------------------------------------------------------------
  local ref = M.json_decode(T.fixtures.reference)
  local robot, err1 = M.load_document(T.fixtures.robot)
  local arc, err2 = M.load_document(T.fixtures.arc)
  check("document: real command-line documents load (sfx and music)", robot ~= nil and arc ~= nil and robot.profile == "sfx" and arc.profile == "music",
    tostring(err1 or err2))
  if not (robot and arc) then return end
  do
    local n = #robot.curves.loudness
    local nulls = 0
    for _, x in ipairs(arc.curves.loudness) do if x == M.null then nulls = nulls + 1 end end
    check("document: curves keep their length and nulls", n == floor(robot.source.duration * robot.curves.rate + 0.5) and nulls > 0 and #arc.curves.tension == 1280,
      n .. " columns, " .. nulls .. " nulls")
    local bad1 = select(2, M.check_document({ schema = "other" }))
    local bad2 = select(2, M.check_document({ schema = "playhead-analysis", schemaVersion = 2, source = { duration = 1 }, curves = { rate = 100 }, wave = { min = {}, max = {} } }))
    local bad3 = select(2, M.load_document("{not json"))
    check("document: wrong schema, newer schema version and broken files are refused with a message",
      bad1 ~= nil and bad2 ~= nil and bad2:find("newer") ~= nil and bad3 ~= nil and bad3:find("could not be read") ~= nil, bad2)
    local names = M.curve_names(arc)
    check("document: curve names in menu order, structure curves for music only",
      names[1] == "loudness" and names[2] == "activity" and M.curve_names(robot)[9] == "onsetStrength"
        and (function() for _, k in ipairs(M.curve_names(robot)) do if k == "structureNovelty" then return false end end return true end)()
        and (function() for _, k in ipairs(names) do if k == "structureNovelty" then return true end end return false end)(),
      table.concat(names, ","))
    local k1 = M.find_curve(arc, "Impulsiveness")
    local k2 = M.find_curve(arc, "harsh")
    local k3 = M.find_curve(arc, "n1kurtosis")
    local k4, hits = M.find_curve(arc, "lo")
    check("document: curves found by key, label or a unique start, any case", k1 == "n1Kurtosis" and k2 == "harshness" and k3 == "n1Kurtosis" and k4 == nil and #hits >= 2,
      tostring(k1) .. " " .. tostring(k2) .. " " .. tostring(#(hits or {})))
    local worst, count = 0, 0
    for _, which in ipairs({ { robot, ref.robot }, { arc, ref.arc } }) do
      for _, c in ipairs(which[2].curveAt) do
        local v = M.curve_at(which[1], c.name, c.t, -1)
        worst = max(worst, abs(v - c.v)); count = count + 1
      end
    end
    check("document: curve_at equals Playhead.curveAt (interpolation, silence, ends)", worst < 1e-12 and count > 80, count .. " values, worst " .. worst)
    local lines = M.describe_document(arc, "cue arc")
    check("document: summary for the console (with the timing on the beat grid)", #lines >= 5 and lines[1]:find("music profile") ~= nil and table.concat(lines, "\n"):find("sections: A B B C D E A B A") ~= nil
      and table.concat(lines, "\n"):find("timing: tightness", 1, true) ~= nil,
      lines[1])
  end

  ------------------------------------------------------------------------------------------------------------------
  -- time mapping
  ------------------------------------------------------------------------------------------------------------------
  do
    local m = M.take_map({ pos = 10, len = 2, offs = 0.5, rate = 1, src_len = 3 })
    local a = M.project_to_file(m, 10.25)
    local b = M.file_to_project(m, 0.75)
    local outside = M.project_to_file(m, 9.9) == nil and #M.file_to_project(m, 0.2) == 0 and #M.file_to_project(m, 2.6) == 0
    check("mapping: offset into the source, outside the item", near(a, 0.75) and #b == 1 and near(b[1], 10.25) and outside)
    local r = M.take_map({ pos = 10, len = 2, offs = 0.5, rate = 2, src_len = 6 })
    check("mapping: playback rate", near(M.project_to_file(r, 10.25), 1.0) and near(M.file_to_project(r, 1.0)[1], 10.25) and near(M.file_to_project(r, 4.5)[1], 12))
    local l = M.take_map({ pos = 0, len = 3, offs = 0.2, rate = 1, loop = true, src_len = 1.2 })
    local ts = M.file_to_project(l, 0.5)
    check("mapping: looped source repeats inside a longer item", near(M.project_to_file(l, 1.5), 0.5) and #ts == 3 and near(ts[1], 0.3) and near(ts[2], 1.5) and near(ts[3], 2.7),
      #ts .. " times")
    local nl = M.take_map({ pos = 0, len = 3, offs = 0.2, rate = 1, loop = false, src_len = 1.2 })
    check("mapping: without loop, nothing past the end of the source", M.project_to_file(nl, 1.5) == nil and #M.file_to_project(nl, 0.5) == 1)
    local rv = M.take_map({ pos = 5, len = 1, offs = 0, rate = 1, src_len = 1.0, sections = { { offs = 0.1, len = 1.0, rev = true } } })
    check("mapping: reversed section reads the file backwards", rv.reversed and near(M.project_to_file(rv, 5.25), 0.85) and near(M.file_to_source(rv, 0.85), 0.25)
      and near(M.file_to_project(rv, 0.85)[1], 5.25) and M.file_to_source(rv, 0.05) == nil)
    local nest = M.take_map({ pos = 0, len = 1, offs = 0.1, rate = 1, src_len = 0.5, sections = { { offs = 0.2, len = 0.5, rev = true }, { offs = 1.0, len = 2.0, rev = false } } })
    -- take source 0.1 + 0.3 = 0.4 -> reversed in the first section: 0.2 + 0.5 - 0.4 = 0.3 -> second: 1.0 + 0.3 = 1.3
    check("mapping: nested sections", near(M.project_to_file(nest, 0.3), 1.3) and near(M.file_to_project(nest, 1.3)[1], 0.3) and not nest.reversed == false)
    -- random round trips: every project time maps to a file time that maps back to it
    local seed = 12345
    local function rnd() seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 end
    local fails, tried = 0, 0
    for _ = 1, 300 do
      local secs = {}
      if rnd() < 0.5 then secs[1] = { offs = rnd() * 2, len = 0.5 + rnd() * 3, rev = rnd() < 0.5 } end
      local mm = M.take_map({ pos = rnd() * 100, len = 0.2 + rnd() * 8, offs = rnd() * 2 - 0.5, rate = 0.25 + rnd() * 3, loop = rnd() < 0.5,
        src_len = secs[1] and secs[1].len or (0.5 + rnd() * 5), sections = secs })
      for _ = 1, 10 do
        local T = mm.pos + rnd() * mm.len
        local f = M.project_to_file(mm, T)
        if f then
          tried = tried + 1
          local found = false
          for _, t2 in ipairs(M.file_to_project(mm, f)) do if abs(t2 - T) < 1e-7 then found = true end end
          if not found then fails = fails + 1 end
        end
      end
    end
    check("mapping: project -> file -> project round trip (random takes: rate, offset, loop, reversed sections)", fails == 0 and tried > 1000, tried .. " times, " .. fails .. " failed")
    local iv = M.file_interval_to_project(m, 0.2, 0.6)
    local ivr = M.file_interval_to_project(rv, 0.3, 0.5)
    local ivl = M.file_interval_to_project(l, 0.6, 0.9)
    check("mapping: file intervals clipped to the item, reversed and looped",
      #iv == 1 and near(iv[1][1], 10) and near(iv[1][2], 10.1) and #ivr == 1 and near(ivr[1][1], 5.6) and near(ivr[1][2], 5.8)
        and #ivl == 3 and near(ivl[1][1], 0.4) and near(ivl[1][2], 0.7) and near(ivl[3][1], 2.8) and near(ivl[3][2], 3.0),
      #ivl .. " looped intervals")
    local col, to_x = M.item_columns(rv, 100)
    local fa, fb = col(25)
    local col2 = M.item_columns(nl, 300)
    check("mapping: strip columns follow the take (backwards where reversed, empty past the source)",
      fa > fb and near((fa + fb) / 2, 0.1 + 1.0 - 0.255) and col2(250) == nil and col2(10) ~= nil and near(to_x(0.85)[1], 25))
  end

  ------------------------------------------------------------------------------------------------------------------
  -- automation points
  ------------------------------------------------------------------------------------------------------------------
  do
    local m = M.take_map({ pos = 20, len = robot.source.duration, offs = 0, rate = 1, src_len = robot.source.duration })
    local pts = M.sample_curve(robot, "harshness", m, {})
    local worst = 0
    for _, p in ipairs(pts) do
      local f = p[1] - 20
      local v = M.curve_at(robot, "harshness", f, nil)
      worst = max(worst, abs(p[2] - (v and min(1, max(0, v)) or 0)))
    end
    check("automation: samples follow the curve in project time, silence as 0", worst < 1e-12 and #pts > 100 and near(pts[1][1], 20) and near(pts[#pts][1], 20 + robot.source.duration),
      #pts .. " samples")
    local item_scaled = M.sample_curve(robot, "n1Kurtosis", m, { scaling = "item" })
    local lo, hi = 1, 0
    for _, p in ipairs(item_scaled) do lo = min(lo, p[2]); hi = max(hi, p[2]) end
    check("automation: values stay in 0..1 (descriptor curves on their percentile range; item scaling)", lo >= 0 and hi <= 1 and hi > 0.9, lo .. " .. " .. hi)
    local line = {}
    for i = 0, 99 do line[#line + 1] = { i * 0.01, 0.2 + 0.5 * i / 99 } end
    local r1 = M.reduce_points(line, 0.001, 1000)
    local sine = {}
    for i = 0, 1999 do sine[#sine + 1] = { i * 0.005, 0.5 + 0.45 * math.sin(i * 0.02) + 0.004 * math.sin(i * 0.9) } end
    local function max_error(orig, red)
      local e, j = 0, 1
      for _, p in ipairs(orig) do
        while j < #red - 1 and red[j + 1][1] < p[1] do j = j + 1 end
        local a, b = red[j], red[j + 1] or red[j]
        local u = b[1] > a[1] and (p[1] - a[1]) / (b[1] - a[1]) or 0
        e = max(e, abs(p[2] - (a[2] + (b[2] - a[2]) * u)))
      end
      return e
    end
    local r2 = M.reduce_points(sine, 0.01, 100000)
    local r3 = M.reduce_points(sine, 0.0, 50)
    local hp = M.reduce_points(M.sample_curve(robot, "harshness", m, {}), 0.01, 2000)
    check("automation: point reduction keeps the curve within the tolerance",
      #r1 == 2 and max_error(sine, r2) <= 0.01 + 1e-12 and #r2 < #sine / 4 and max_error(pts, hp) <= 0.01 + 1e-12 and r2[1] == sine[1] and r2[#r2] == sine[#sine],
      string.format("line %d points; sine %d -> %d points", #r1, #sine, #r2))
    local sorted = true
    for i = 2, #r3 do if r3[i][1] <= r3[i - 1][1] then sorted = false end end
    check("automation: point count is bounded", #r3 <= 50 and #r3 >= 2 and sorted and r3[1] == sine[1] and r3[#r3] == sine[#sine], #r3 .. " points")
  end

  ------------------------------------------------------------------------------------------------------------------
  -- markers
  ------------------------------------------------------------------------------------------------------------------
  do
    local m = M.take_map({ pos = 100, len = arc.source.duration, offs = 0, rate = 1, src_len = arc.source.duration })
    local plan = M.marker_plan(arc, m, { events = true, onsets = true, downbeats = true, sections = true })
    local js = { region = 0, bar = 0, onset = 0, event = 0 }
    for _, x in ipairs(ref.arc.markers) do
      if x.kind == "region" then js.region = js.region + 1
      elseif x.name:find("^bar ") then js.bar = js.bar + 1
      elseif x.name == "onset" then js.onset = js.onset + 1
      else js.event = js.event + 1 end
    end
    local events, onsets = 0, 0
    for _, t in ipairs(plan.take) do if t.kind == "event" then events = events + 1 else onsets = onsets + 1 end end
    local first_region = plan.regions[1]
    local same_names = true
    for i, s in ipairs(arc.sections) do if not plan.regions[i] or plan.regions[i].name ~= s.label or not near(plan.regions[i].start, 100 + s.start, 1e-9) then same_names = false end end
    check("markers: the whole item gives what Playhead.toMarkers gives", #plan.regions == js.region and #plan.markers == js.bar and onsets == js.onset and events == js.event
      and same_names and plan.markers[1].name == "bar 1" and first_region ~= nil,
      string.format("%d regions, %d bars, %d events, %d onsets", #plan.regions, #plan.markers, events, onsets))
    local cut = M.take_map({ pos = 50, len = 10, offs = 10, rate = 1, src_len = arc.source.duration })
    local p2 = M.marker_plan(arc, cut, { downbeats = true, sections = true, events = true })
    local inside = true
    for _, r in ipairs(p2.regions) do if r.start < 50 - 1e-9 or r.stop > 60 + 1e-9 or r.stop <= r.start then inside = false end end
    for _, x in ipairs(p2.markers) do if x.pos < 50 or x.pos > 60 then inside = false end end
    for _, x in ipairs(p2.take) do if x.pos < 10 or x.pos > 20 then inside = false end end
    check("markers: clipped to the part of the file the item plays", inside and #p2.regions >= 2 and near(p2.regions[1].start, 50) and near(p2.regions[#p2.regions].stop, 60) and #p2.markers > 0,
      #p2.regions .. " regions, " .. #p2.markers .. " bars")
    local p3 = M.marker_plan(robot, M.take_map({ pos = 0, len = 1, offs = 0, rate = 1, src_len = robot.source.duration }), { downbeats = true, sections = true, events = true })
    check("markers: sound effects get events and a note that bars and sections need the music profile", #p3.take == #robot.events and #p3.notes == 2 and p3.notes[1]:find("music profile") ~= nil,
      p3.notes[1])
  end

  do
    -- builds, fills, breaks and pass-bys (Playhead 0.4): an item from 10 s playing the file from 2 s
    local doc = { builds = { { start = 4, ["end"] = 12, strength = 0.8, drop = true } },
      rhythm = { bars = { { start = 3, change = "fill" }, { start = 5, change = null }, { start = 7, change = "break" } } },
      glides = { { start = 5, ["end"] = 8, passBy = true, closest = 6.5, speed = 20 }, { start = 9, ["end"] = 10, passBy = false } } }
    local m = M.take_map({ pos = 10, len = 20, offs = 2, rate = 1, src_len = 30 })
    local p = M.marker_plan(doc, m, { changes = true })
    local names = {}; for _, k in ipairs(p.markers) do names[#names + 1] = k.name .. "@" .. M.num(k.pos, 2) end
    check("markers: builds as regions, fills, breaks and pass-bys as markers, placed from the file onto the item",
      #p.regions == 1 and near(p.regions[1].start, 12) and near(p.regions[1].stop, 20) and p.regions[1].name == "build to a drop"
        and table.concat(names, ", ") == "fill@11, pass-by (72 km/h or more)@14.5, break@15",
      table.concat(names, ", "))
  end

  ------------------------------------------------------------------------------------------------------------------
  -- editing tools: arranging layers, splitting at sounds, tempo maps
  ------------------------------------------------------------------------------------------------------------------
  do
    local RL = robot.source.duration
    local a = M.item_part(M.take_map({ pos = 10, len = 1, offs = 0.1, rate = 1, src_len = RL }))
    local b = M.item_part(M.take_map({ pos = 3, len = 2, offs = 1, rate = 1, src_len = 5, sections = { { offs = 2, len = 5 } } }))
    local c = M.item_part(M.take_map({ pos = 5, len = 2, offs = -0.5, rate = 1, src_len = RL }))
    local _, why_rev = M.item_part(M.take_map({ pos = 0, len = 1, offs = 0, rate = 1, src_len = RL, sections = { { offs = 0, len = RL, rev = true } } }))
    local _, why_rate = M.item_part(M.take_map({ pos = 0, len = 1, offs = 0, rate = 1.25, src_len = RL }))
    local _, why_loop = M.item_part(M.take_map({ pos = 0, len = 3, offs = 0, rate = 1, src_len = RL, loop = true }))
    local short_loop = M.item_part(M.take_map({ pos = 0, len = 1, offs = 0, rate = 1, src_len = RL, loop = true }))
    check("arrange: an item as a part (where its file's start would play, the file times heard); backwards, other rates and loops refused",
      near(a.offset, 9.9) and near(a.start, 0.1) and near(a.stop, 1.1) and near(b.offset, 0) and near(b.start, 3) and near(b.stop, 5)
        and near(c.offset, 5.5) and near(c.start, 0) and near(c.stop, RL) and why_rev:find("backwards") and why_rate:find("rate 1.25", 1, true)
        and why_loop:find("loops") and short_loop ~= nil, string.format("%.3f %.3f %.3f | %s", a.offset, a.start, a.stop, tostring(why_rate)))
    local parts = { { offset = 120, gain = 0 }, { offset = 119.95, gain = -2 } }
    local shift = M.arrange_axis(parts, 0.3)
    local mv = M.arrange_moves(parts, { parts = { { offset = 0.35, gain = 0 }, { offset = 0.312, gain = -3.5 } } })
    local txt = M.arrange_changes({ changes = { { part = 1, offset = 0.012, gain = -1.5 } } }, { "sub", "body" })
    check("arrange: parts moved onto one axis and back; a candidate's moves and its changes as text",
      near(shift, 119.65) and near(parts[1].offset, 0.35) and near(parts[2].offset, 0.3) and near(mv[1].dt, 0) and near(mv[2].dt, 0.012)
        and near(mv[2].db, -1.5) and txt == "body +12 ms -1.5 dB" and M.arrange_changes({ changes = {} }, {}) == "as it is", txt)

    local m = M.take_map({ pos = 10, len = 1, offs = 0.1, rate = 1, src_len = RL })
    local p = M.split_plan(robot, m, { kind = "events", pre = 0.005, min_gap = 0.05 })
    local p2 = M.split_plan(robot, m, { kind = "events", pre = 0.005, min_gap = 0.1 })
    local p3 = M.split_plan(robot, M.take_map({ pos = 0, len = RL, offs = 0, rate = 1, src_len = RL }), { kind = "onsets", pre = 0.005, min_gap = 0.05 })
    local _, why_split = M.split_plan(robot, M.take_map({ pos = 0, len = 1, offs = 0, rate = 1, src_len = RL, sections = { { offs = 0, len = RL, rev = true } } }), {})
    local e2, e3 = robot.events[2], robot.events[3]
    local s2, s3 = M.attack_time(robot, e2.start), M.attack_time(robot, e3.start)
    check("split: a cut before each event heard; pieces named by their first event, ending where their events have decayed",
      #p.cuts == 2 and near(p.cuts[1], 10 + s2 - 0.1 - 0.005) and near(p.cuts[2], 10 + s3 - 0.1 - 0.005) and #p.pieces == 3
        and p.pieces[1].sounds == 0 and p.pieces[2].name == e2.word and near(p.pieces[2].sound_end, 10 + math.max(s2, e2.decayEnd) - 0.1)
        and p.pieces[3].name == e3.word and near(p.pieces[3].sound_end, 10 + e3.decayEnd - 0.1) and near(p.pieces[3].stop, 11) and math.abs(s2 - e2.start) < 0.04,
      string.format("%d cuts, %d pieces", #p.cuts, #p.pieces))
    check("split: cuts closer than the shortest piece are left out (their sounds join the piece before); onsets; backwards refused",
      #p2.cuts == 1 and p2.pieces[2].sounds == 2 and near(p2.pieces[2].sound_end, 10 + e3.decayEnd - 0.1) and #p3.cuts == #robot.onsets - 1
        and p3.pieces[1].sounds == 1 and p3.pieces[1].sound_end == nil and why_split:find("backwards"), #p3.cuts .. " onset cuts")

    local whole = M.take_map({ pos = 100, len = arc.source.duration, offs = 0, rate = 1, src_len = arc.source.duration })
    local bars = M.tempo_plan(arc, whole, "bars")
    local beats = M.tempo_plan(arc, whole, "beats")
    local fast = M.tempo_plan(arc, M.take_map({ pos = 30, len = 20, offs = 5, rate = 1.25, src_len = arc.source.duration }), "bars")
    local _, why_tempo = M.tempo_plan(robot, M.take_map({ pos = 0, len = 1, offs = 0, rate = 1, src_len = RL }), "bars")
    local lands = true
    for i = 1, #bars.markers - 1 do
      local k = bars.markers[i]
      if not near(k.pos + bars.beats_per_bar * 60 / k.bpm, bars.markers[i + 1].pos, 1e-9) then lands = false end
    end
    local last = bars.markers[#bars.markers]
    if not near(last.pos + bars.beats_per_bar * 60 / last.bpm, 100 + arc.rhythm.downbeats[#arc.rhythm.downbeats], 1e-9) then lands = false end
    check("tempo map: a marker per bar from the first downbeat, each tempo putting the next bar on its downbeat; per beat; a faster take; needs beats",
      #bars.markers == #arc.rhythm.downbeats - 1 and near(bars.markers[1].pos, 100 + arc.rhythm.downbeats[1]) and bars.beats_per_bar == 4 and lands
        and math.abs(bars.mean_bpm - arc.rhythm.tempo) < 1 and #beats.markers > #bars.markers * 3 and math.abs(beats.mean_bpm - arc.rhythm.tempo) < 2
        and math.abs(fast.mean_bpm - 1.25 * arc.rhythm.tempo) < 1.5 and fast.start >= 30 and why_tempo:find("music profile"),
      string.format("%d bars at %.2f BPM (%d/4), %d beats at %.2f, %.2f faster", #bars.markers, bars.mean_bpm, bars.beats_per_bar, #beats.markers, beats.mean_bpm, fast.mean_bpm))
  end

  ------------------------------------------------------------------------------------------------------------------
  -- looks and the strip renderer, against Playhead.drawStrip
  ------------------------------------------------------------------------------------------------------------------
  do
    local ok_parse = true
    for _, p in ipairs(ref.parse) do
      local out = M.look_code(M.parse_look(p.code) or {})
      if out ~= p.out then ok_parse = false; T.note("parse " .. p.code .. ": " .. out .. " vs " .. p.out) end
    end
    check("looks: look codes parse and print as Playhead.parseLook and lookCode (views included)", ok_parse)
    local function recorder()
      local ops = { rects = {}, triangles = {}, texts = {}, lines = 0, polylines = 0, dashed = 0, circles = 0 }
      local function r4(v) return floor(v * 1e4 + 0.5) / 1e4 end
      local g = {}
      function g.rect(x, y, w, h, c, a) ops.rects[#ops.rects + 1] = { r4(x), r4(y), r4(w), r4(h), c[1] .. "," .. c[2] .. "," .. c[3], r4(a) } end
      function g.triangle(x1, y1, x2, y2, x3, y3) ops.triangles[#ops.triangles + 1] = { r4(x1), r4(y1), r4(x2), r4(y2), r4(x3), r4(y3) } end
      function g.text(x, y, s) ops.texts[#ops.texts + 1] = { s, r4(x), r4(y) } end
      function g.circle() ops.circles = ops.circles + 1 end     -- the raster's dots (arcs in drawStrip, not recorded there)
      function g.line() ops.lines = ops.lines + 1 end
      function g.polyline() ops.polylines = ops.polylines + 1 end
      function g.dashed() ops.dashed = ops.dashed + 1 end
      return g, ops
    end
    local function same_list(a, b, what)
      if #a ~= #b then return false, what .. ": " .. #a .. " vs " .. #b end
      for i = 1, #a do
        for k = 1, #b[i] do
          local x, y = a[i][k], b[i][k]
          if type(y) == "number" then if not near(x, y, 2e-4) then return false, string.format("%s %d.%d: %s vs %s", what, i, k, tostring(x), tostring(y)) end
          elseif x ~= y then return false, string.format("%s %d.%d: %s vs %s", what, i, k, tostring(x), tostring(y)) end
        end
      end
      return true
    end
    -- the views are compared at points (see make_fixtures.js): the last rectangle over each point, colour within 1 and
    -- alpha within 0.01 of drawStrip's
    local PROBE = ref.probe
    local function probe_ops(rects, W, H)
      local nx, ny = 0, 0
      while 0.5 + nx * PROBE.dx < W do nx = nx + 1 end
      while 0.5 + ny * PROBE.dy < H do ny = ny + 1 end
      local hit = {}
      for _, q in ipairs(rects) do
        local i0, i1 = math.ceil((q[1] - 0.5) / PROBE.dx), math.ceil((q[1] + q[3] - 0.5) / PROBE.dx) - 1
        local j0, j1 = math.ceil((q[2] - 0.5) / PROBE.dy), math.ceil((q[2] + q[4] - 0.5) / PROBE.dy) - 1
        for j = max(0, j0), min(ny - 1, j1) do for i = max(0, i0), min(nx - 1, i1) do hit[j * nx + i + 1] = q end end
      end
      return hit, nx * ny
    end
    local function same_probes(rects, jp, W, H, what)
      local hit, n = probe_ops(rects, W, H)
      if n ~= #jp.idx then return false, what .. ": " .. n .. " points vs " .. #jp.idx end
      local bad, first = 0, nil
      for k = 1, n do
        local want, q = jp.palette[jp.idx[k] + 1], hit[k]
        local ok
        if want == "" then ok = q == nil
        elseif q == nil then ok = false
        else
          local r, g2, b, a = want:match("^(%d+),(%d+),(%d+),([%d.]+)$")
          local c = M.split(q[5], ",")
          ok = abs(tonumber(c[1]) - tonumber(r)) <= 1 and abs(tonumber(c[2]) - tonumber(g2)) <= 1 and abs(tonumber(c[3]) - tonumber(b)) <= 1 and abs(q[6] - tonumber(a)) <= 0.011
        end
        if not ok then bad = bad + 1; first = first or string.format("%s point %d: %s vs %s", what, k, q and (q[5] .. "," .. q[6]) or "none", want) end
      end
      return bad == 0, first, n
    end
    local function same_rows(a, b)
      if not a or not b then return a == b end
      if #a ~= #b then return false end
      for i = 1, #a do if not (near(a[i][1], b[i][1], 2e-4) and near(a[i][2], b[i][2], 2e-4)) then return false end end
      return true
    end
    local view_strips, view_points, view_bad = 0, 0, {}
    local function compare_view(which, look, jv, W, H, from, to)
      local g, ops = recorder()
      local r = M.render_strip(which[2], g, { look = look, width = W, height = H, from = from, to = to, fill = false })
      local ok1, e1, n = same_probes(ops.rects, jv.probes, W, H, which[1] .. " " .. look .. " " .. W .. "x" .. H)
      local ok2, e2 = same_list(ops.texts, jv.texts, "texts")
      local ok3, e3 = same_list(ops.triangles, jv.triangles, "triangles")
      local ok4 = same_rows(r.raster and r.raster.rows, jv.raster)
      local ok5 = r.legend == jv.legend and r.code == jv.code
      view_strips, view_points = view_strips + 1, view_points + (n or 0)
      if not (ok1 and ok2 and ok3 and ok4 and ok5) then
        view_bad[#view_bad + 1] = e1 or (e2 and (look .. " " .. e2)) or (e3 and (look .. " " .. e3)) or (not ok4 and (look .. ": raster rows")) or (look .. " legend: " .. r.legend .. " | " .. jv.legend)
      end
    end
    local compared, mismatches, legends, fits, trips = 0, {}, true, true, true
    for _, which in ipairs({ { "robot", robot, ref.robot }, { "arc", arc, ref.arc } }) do
      for key, L in pairs(which[3].looks) do
        if M.look_fits(which[2], key) ~= L.fits then fits = false; T.note("fits " .. which[1] .. " " .. key) end
        if L.roundTrip and M.look_code(M.parse_look(M.LOOKS[key].code)) ~= L.roundTrip then trips = false end
        if L.views then
          for size, jv in pairs(L.views) do
            local W, H = size:match("(%d+)x(%d+)")
            compare_view(which, key, jv, tonumber(W), tonumber(H))
          end
        elseif L.ops then
          for size, jsops in pairs(L.ops) do
            local W, H = size:match("(%d+)x(%d+)")
            local g, ops = recorder()
            local r = M.render_strip(which[2], g, { look = key, width = tonumber(W), height = tonumber(H), fill = false })
            if r.legend ~= L.legend or r.code ~= L.code then legends = false; T.note(which[1] .. " " .. key .. " legend: " .. r.legend .. " | " .. L.legend) end
            local ok1, e1 = same_list(ops.rects, jsops.rects, "rects")
            local ok2, e2 = same_list(ops.triangles, jsops.triangles, "triangles")
            local ok3, e3 = same_list(ops.texts, jsops.texts, "texts")
            compared = compared + 1
            if not (ok1 and ok2 and ok3) then mismatches[#mismatches + 1] = which[1] .. " " .. key .. " " .. size .. ": " .. (e1 or e2 or e3) end
          end
        else
          local g = recorder()
          local r = M.render_strip(which[2], g, { look = key, width = 160, height = 60, fill = false })
          if r.legend ~= L.legend or r.code ~= L.code then legends = false; T.note(which[1] .. " " .. key .. " legend: " .. r.legend .. " | " .. L.legend) end
        end
      end
    end
    for _, which in ipairs({ { "robot", robot, ref.robot }, { "arc", arc, ref.arc } }) do
      local d = which[2].source.duration
      for _, z in ipairs(which[3].viewZoom) do compare_view(which, z.look, z, 220, 90, d / 3, 2 * d / 3) end
    end
    check("views: drawn as drawStrip draws them (every view look, two sizes, both documents, and zoomed): colours at points, texts, raster rows, legends",
      #view_bad == 0 and view_strips >= 26, view_strips .. " strips, " .. view_points .. " points; " .. (view_bad[1] or "all equal"))
    -- the views as numbers, as Playhead.view gives them
    local vn_bad, vn_n = {}, 0
    for _, which in ipairs({ { "robot", robot, ref.robot }, { "arc", arc, ref.arc } }) do
      for _, jv in ipairs(which[3].views) do
        local o = jv.opts or {}
        local v = M.view(which[2], jv.kind, { curve = o.curve, bars = o.bars, cyclic = o.cyclic, attacks = o.attacks })
        local name = which[1] .. " " .. jv.kind .. (o.curve and (" " .. o.curve) or "") .. (o.attacks and " attacks" or "") .. (o.bars and " 4 bars" or "") .. (o.cyclic and " cyclic" or "")
        local err
        if jv.none == "view" then if v then err = "a view where drawStrip has none" end
        elseif not v then err = "no view"
        else
          local sum, none = 0, 0
          for i = 1, v.rows * v.cols do local x = v.values[i]; if x < 0 then none = none + 1 else sum = sum + x end end
          if v.rows ~= jv.rows or v.cols ~= jv.cols then err = "size " .. v.rows .. "x" .. v.cols
          elseif none ~= jv.none or abs(sum - jv.sum) > 1e-3 * max(1, jv.sum) then err = string.format("sum %.3f vs %.3f, %d vs %d without data", sum, jv.sum, none, jv.none) end
          for _, p in ipairs(jv.at) do if not err and not near(v.values[p[1] + 1], p[2], 2e-4) then err = string.format("value %d: %.5f vs %.5f", p[1], v.values[p[1] + 1], p[2]) end end
          if not err and #v.yTicks ~= #jv.yTicks then err = "axis " .. #v.yTicks .. " vs " .. #jv.yTicks end
          for i, t in ipairs(jv.yTicks) do if not err and not (near(v.yTicks[i].row, t[1], 2e-4) and v.yTicks[i].text == t[2]) then err = "axis " .. v.yTicks[i].text .. " vs " .. t[2] end end
          for _, c in ipairs(jv.colAt or {}) do if not err and v.colAt(c[1]) ~= c[2] then err = string.format("column at %.3f s: %d vs %d", c[1], v.colAt(c[1]), c[2]) end end
          if not err and jv.timeRows and not (same_rows(v.timeRows, jv.timeRows) and v.beatsPerBar == jv.beatsPerBar) then err = "raster rows" end
          if not err and jv.rgb then local t = 0; for i = 1, 3 * v.rows * v.cols do t = t + v.rgb[i] end; if t ~= jv.rgb then err = "colours " .. t .. " vs " .. jv.rgb end end
          if not err and jv.faint then local f = 0; for i = 1, v.rows * v.cols do if v.faint[i] then f = f + 1 end end; if f ~= jv.faint then err = "faint " .. f .. " vs " .. jv.faint end end
        end
        vn_n = vn_n + 1
        if err then vn_bad[#vn_bad + 1] = name .. ": " .. err end
      end
    end
    check("views: bar raster, tempogram (and folded), lag view, modulation, scalogram, bar spectrum and metrical spectrogram as numbers equal Playhead.view's",
      #vn_bad == 0 and vn_n == 22, vn_n .. " views; " .. (vn_bad[1] or "all equal"))
    -- zooming a strip (as the strip window does): around a point, scrolling, paging after the play cursor
    do
      local v = M.zoom_view({ 0, 1 }, 0.25, 2, 0.01)
      local v2 = M.zoom_view(v, 0, 1e6, 0.01)                -- no narrower than the minimum
      local v3 = M.scroll_view(v, 10)                        -- no further than the end
      local v4 = M.follow_view({ 0.1, 0.3 }, 0.35)          -- paged: the play cursor at the left edge
      local v5 = M.zoom_view(v, 0.5, 0.01, 0.01)             -- zoomed out fully
      local m = M.take_map({ pos = 10, len = 8, offs = 2, rate = 2, src_len = 40 })
      local column = M.item_columns(m, 100, 12, 14)         -- 2 s of the item shown over 100 pixels
      local fa, fb, fm = column(49)
      local same = math.abs(fm - M.project_to_file(m, 12 + 49.5 / 100 * 2)) < 1e-9 and math.abs((fb - fa) - 2 / 100 * 2) < 1e-9
      check("strip zoom: around the mouse, within the item, no narrower than a minimum; paging; zoomed columns",
        near(v[1], 0.125, 1e-12) and near(v[2], 0.625, 1e-12) and near(v2[2] - v2[1], 0.01, 1e-12) and near(v3[2], 1, 1e-12) and near(v3[2] - v3[1], 0.5, 1e-12)
          and near(v4[1], 0.35, 1e-12) and near(v4[2], 0.55, 1e-12) and v5[1] == 0 and v5[2] == 1 and same and M.is_zoomed(v) and not M.is_zoomed(v5),
        string.format("%.3f-%.3f", v[1], v[2]))
    end
    -- colour palettes: on dark and light backgrounds, the waveform's tint stays apart from the peak outline drawn over
    -- it (the sculpted look) and from the lines; a REAPER peak colour close to the tint's blue does not matter
    do
      local function dist(a, b) return math.sqrt((a[1] - b[1]) ^ 2 + (a[2] - b[2]) ^ 2 + (a[3] - b[3]) ^ 2) end
      local worst, at = 1e9, ""
      for _, bg in ipairs({ { 51, 51, 51 }, { 236, 236, 236 } }) do
        for _, key in ipairs(M.PALETTE_ORDER) do
          local th = M.palette_theme(key, { background = bg, wave = { 120, 182, 230 } })
          local tint = th.waveRamp or { th.waveLow, th.waveHigh }
          for k = 0, 10 do
            local c = M.ramp_at(tint, k / 10)
            for _, other in ipairs({ th.outline or th.wave, th.line }) do
              local d = dist(c, other)
              if d < worst then worst, at = d, key .. " on " .. bg[1] end
            end
          end
        end
      end
      local g, ops = recorder()
      local r = M.render_strip(robot, g, { look = "sculpted", width = 160, height = 60, theme = M.palette_theme("safe", { background = { 51, 51, 51 } }), fill = false })
      check("palettes: the tint stays apart from the outline and the lines in every palette, on dark and light backgrounds",
        worst >= 45 and #ops.rects > 100 and #M.PALETTE_ORDER == 5, string.format("closest %.0f (%s)", worst, at))
    end
    -- the window says when a slow view is being worked out (a scalogram of a long curve), once
    do
      local c = {}
      for i = 1, 4000 do c[i] = math.sin(i / 7) end
      local long = { curves = { rate = 20, loudness = c }, source = { duration = 200 } }
      local before = M.slow_views(long, "scalogram:loudness,lane:loudness")
      local v = M.view(long, "scale", { curve = "loudness" })
      check("views: a scalogram of a long curve is announced before it is worked out, and not again",
        before == "the rhythms in loudness" and v ~= nil and M.slow_views(long, "scalogram:loudness") == nil and M.slow_views(arc, "rhythms") == nil, tostring(before))
    end
    -- a view the document cannot give leaves the plain waveform in its place (once); the legend says so
    do
      local g, ops = recorder()
      local r = M.render_strip(robot, g, { look = "spec:tempo~cyclic,raster:loudness,ticks:onsets", width = 120, height = 40, fill = false })
      local g2, ops2 = recorder()
      M.render_strip(robot, g2, { look = "wave,ticks:onsets", width = 120, height = 40, fill = false })
      check("views: one a sound effect cannot give falls back to its waveform, and the legend says why",
        r.code == "spec:tempo~cyclic,raster:loudness,ticks:onsets" and #ops.rects == #ops2.rects and #ops.rects > 100 and r.legend:find("music only; not in this analysis", 1, true) ~= nil
          and r.legend:find("needs a beat", 1, true) ~= nil and r.raster == nil, r.legend)
    end
    -- the raster in an item: the strip window maps the cursor and clicks through the rows
    do
      local d = arc.source.duration
      local m = M.take_map({ pos = 10, len = d / 2, offs = d / 4, rate = 1, src_len = d })
      local column, to_x = M.item_columns(m, 300)
      local g, ops = recorder()
      local r = M.render_strip(arc, g, { look = "raster:onsetStrength,sections,ticks:onsets", width = 300, height = 120, column = column, to_x = to_x, fill = false })
      local rows = r.raster and r.raster.rows or {}
      local trips2, inside = 0, 0
      for k = 0, 40 do
        local T = 10 + k / 40 * d / 2 * 0.999
        local f = M.project_to_file(m, T)
        local x, y, rh = M.raster_xy(rows, f, 300, 120)
        if x then
          inside = inside + 1
          local f2 = M.raster_time(rows, x, y + rh / 2, 300, 120)
          local Ts = M.file_to_project(m, f2)
          if Ts[1] and abs(Ts[1] - T) < 1e-6 then trips2 = trips2 + 1 end
        end
      end
      check("views: a bar raster in an item shows the bars the item plays; cursor and clicks map through its rows",
        #rows >= 16 and #rows <= 18 and rows[1][1] <= d / 4 and rows[#rows][2] >= 3 * d / 4 and inside == 41 and trips2 == 41 and ops.circles > 20 and #ops.texts >= 3,
        #rows .. " rows, " .. trips2 .. " of " .. inside .. " times back, " .. ops.circles .. " onsets")
    end
    check("looks: legends and codes equal drawStrip's for every ready-made look", legends and trips)
    check("looks: lookFits as Playhead.lookFits", fits)
    check("strip: rectangles, triangles and texts equal drawStrip's (every look without a spectrogram, two sizes, both documents)",
      #mismatches == 0 and compared >= 50, compared .. " strips; " .. (mismatches[1] or "all equal"))
    for _, which in ipairs({ { "robot", robot, ref.robot }, { "arc", arc, ref.arc } }) do
      local g, ops = recorder()
      local d = which[2].source.duration
      M.render_strip(which[2], g, { look = "wave:harshness,lane:activity~signed,lane:loudness,ticks:events+onsets+novelty", width = 200, height = 70, from = d / 3, to = 2 * d / 3, fill = false })
      local ok1, e1 = same_list(ops.rects, which[3].zoom.ops.rects, "rects")
      local ok2, e2 = same_list(ops.triangles, which[3].zoom.ops.triangles, "triangles")
      check("strip: zoomed view (from, to) equals drawStrip's (" .. which[1] .. ")", ok1 and ok2, e1 or e2 or (#ops.rects .. " rectangles"))
    end
    -- the spectrogram: one rectangle per band over the pixels that show one column, colours from the ramp
    local g, ops = recorder()
    M.render_strip(robot, g, { look = "spec", width = 160, height = 80, fill = false })
    local bytes = M.from_base64(robot.spectrum.data)
    local px = 0
    for _, r in ipairs(ops.rects) do px = px + r[3] end
    check("strip: spectrogram from the document's base64 bytes", #bytes == robot.spectrum.bands * robot.spectrum.columns and #ops.rects % 40 == 0 and px == 160 * 40,
      #ops.rects .. " rectangles")
    -- an item played backwards draws its waveform mirrored in time
    local m1 = M.take_map({ pos = 0, len = robot.source.duration, offs = 0, rate = 1, src_len = robot.source.duration })
    local m2 = M.take_map({ pos = 0, len = robot.source.duration, offs = 0, rate = 1, src_len = robot.source.duration, sections = { { offs = 0, len = robot.source.duration, rev = true } } })
    local ga, oa = recorder()
    local gb, ob = recorder()
    local c1, x1 = M.item_columns(m1, 120)
    local c2, x2 = M.item_columns(m2, 120)
    M.render_strip(robot, ga, { look = "plain", width = 120, height = 50, column = c1, to_x = x1, fill = false })
    M.render_strip(robot, gb, { look = "plain", width = 120, height = 50, column = c2, to_x = x2, fill = false })
    -- (a column may differ where its edge falls exactly on a boundary of the waveform overview, from rounding)
    local same, differ = 0, 0
    for i = 1, math.min(#oa.rects, #ob.rects) do
      if near(oa.rects[i][2], ob.rects[121 - i][2], 1e-6) and near(oa.rects[i][4], ob.rects[121 - i][4], 1e-6) then same = same + 1 else differ = differ + 1 end
    end
    local forward_differs = 0
    for i = 1, 120 do if not near(oa.rects[i][2], oa.rects[121 - i][2], 1e-6) then forward_differs = forward_differs + 1 end end
    check("strip: a reversed take is drawn reversed", #oa.rects == 120 and #ob.rects == 120 and differ <= 6 and forward_differs > 60,
      same .. " columns mirrored, " .. differ .. " differ at overview boundaries")
    -- layout: overlaid lanes stay in the waveform band, stacked lanes below it, curves alone fill the strip
    local L1 = M.strip_layout(M.parse_look("form:overlay,shape:mirror,wave,lane:activity"), robot, 200, 100)
    local L2 = M.strip_layout(M.parse_look("wave,lane:activity,lane:harshness"), robot, 200, 100)
    local L3 = M.strip_layout(M.parse_look("shape:mirror,lane:activity"), robot, 200, 100)
    check("strip: layout of main band and lanes", L1.mainH == 100 and L1.laneH == 0 and L2.laneH == 22 and L2.mainH == 56 and L3.mainH == 0 and L3.laneH == 100)
    local th = M.theme_for({ 30, 30, 30 }, { wave = { 1, 2, 3 } })
    check("strip: dark backgrounds get the dark palette, theme colours override it", th.text[1] > 200 and th.wave[3] == 3 and M.theme_for({ 250, 250, 250 }).text[1] < 50)
  end

  ------------------------------------------------------------------------------------------------------------------
  -- command lines and job scripts
  ------------------------------------------------------------------------------------------------------------------
  do
    local tricky = { "plain", "with space", "it's", 'say "hi"', "$HOME", "`date`", "a\\b", "100%", "semi;colon", "amp&er", "pipe|x",
      "tab\there", "", "-dash", "~tilde", "*glob?", "unicode é ü", "back\\slash\\", "ends with \\\\", "(paren)", "!bang", "^caret", "<lt>gt" }
    local posix = { "printf", "%s\\n" }
    for _, a in ipairs(tricky) do posix[#posix + 1] = a end
    if T.sh_argv then
      local got = T.sh_argv(M.command_line(posix, "posix"))
      check("command line: POSIX quoting survives /bin/sh", list_eq(got, tricky), #got .. " arguments")
    else
      T.note("no POSIX sh here: the POSIX quoting is checked where there is one (macOS, Linux, GitHub Actions)")
    end
    local win_ok, bad = true, nil
    for _, a in ipairs(tricky) do
      local q = M.quote_windows(a)
      local back = T.win_argv(q)
      if not (#back == 1 and back[1] == a) then win_ok = false; bad = a .. " -> " .. q end
    end
    check("command line: Windows quoting survives the C runtime's argument rules", win_ok, bad)
    local batch_ok = true
    for _, a in ipairs(tricky) do
      if not a:find('"') then
        local q = M.quote_batch(a)
        -- cmd.exe turns %% back into %; nothing it treats as an operator may be outside quotes
        local unq = q:gsub("%%%%", "%%")
        local outside = unq:gsub('"[^"]*"', "")
        if outside:find("[%s&|<>%^(),;=!%%]") then batch_ok = false; bad = a .. " -> " .. q end
        local back = T.win_argv(unq)
        if not (#back == 1 and back[1] == a) then batch_ok = false; bad = a .. " -> " .. q end
      end
    end
    local refused = M.quote_batch('a"b') == nil and M.quote_batch("line\nbreak") == nil
    check("command line: batch quoting (operators quoted, % doubled, quotes refused)", batch_ok and refused and M.quote_batch("100%") == '"100%%"', bad)
    check("command line: the command REAPER starts", M.exec_command("/x/y z.sh", "linux") == '/bin/sh "/x/y z.sh"'
      and M.exec_command([[C:\a b\j.bat]], "windows") == [[cmd.exe /D /V:OFF /S /C ""C:\a b\j.bat""]]
      and M.safe_script_path([[C:\Users\me\AppData\Roaming\REAPER\Data\Playhead\jobs]], "windows") and not M.safe_script_path([[C:\100%\jobs]], "windows")
      and not M.safe_script_path('/home/a"b', "linux"))
    check("command line: Playhead executable or Node with playhead-cli.js",
      list_eq(M.cli_argv("/opt/playhead", "node", { "version" }), { "/opt/playhead", "version" })
        and list_eq(M.cli_argv("/src/tools/playhead-cli.js", "/usr/bin/node", { "tools" }), { "/usr/bin/node", "/src/tools/playhead-cli.js", "tools" }))
    local dir = T.tmpdir
    if T.run_sh then
      -- a real POSIX job: output to files, result moved into place, status written last
      local part, final = dir .. "/result.part", dir .. "/result.json"
      local spec = { os = "linux", argv = { "sh", "-c", 'printf "%s" "$1" > "$2"; echo out; echo err >&2', "x", "it's \"done\"", part },
        stdout = dir .. "/job.out", stderr = dir .. "/job.err", status = dir .. "/job.status", move_from = part, move_to = final, path_extra = { "/nonexistent dir" } }
      T.run_sh(M.job_script(spec), dir .. "/job.sh")
      local okjob = T.read(spec.status) == "0\n" and T.read(final) == "it's \"done\"" and T.read(spec.stdout) == "out\n" and T.read(spec.stderr) == "err\n" and T.read(part) == nil
      local spec2 = { os = "linux", argv = { "sh", "-c", "exit 3" }, stdout = dir .. "/j2.out", stderr = dir .. "/j2.err", status = dir .. "/j2.status",
        move_from = dir .. "/nothing", move_to = dir .. "/never" }
      T.run_sh(M.job_script(spec2), dir .. "/j2.sh")
      check("job script (sh): output to files, result moved after success, exit code written last", okjob and T.read(spec2.status) == "3\n" and T.read(dir .. "/never") == nil,
        tostring(T.read(spec.status)))
    end
    if T.run_bat then
      -- on Windows, a real batch job through cmd.exe, in a folder whose name has a space and a %
      local wdir = dir .. [[\job 100% here]]
      os.execute('mkdir "' .. wdir .. '" 2>nul')
      local src, part, final = wdir .. [[\source.txt]], wdir .. [[\result.part]], wdir .. [[\result.json]]
      local h = io.open(src, "wb"); h:write("done"); h:close()
      -- certutil (in every Windows) writes the source, encoded, to the part file and reports on stdout
      local spec = { os = "windows", argv = { "certutil", "-f", "-encode", src, part },
        stdout = wdir .. [[\job.out]], stderr = wdir .. [[\job.err]], status = wdir .. [[\job.status]], move_from = part, move_to = final }
      T.run_bat(M.job_script(spec), dir .. [[\job.bat]])
      local spec2 = { os = "windows", argv = { "certutil", "-f", "-encode", wdir .. [[\missing.txt]], wdir .. [[\r2.part]] },
        stdout = wdir .. [[\j2.out]], stderr = wdir .. [[\j2.err]], status = wdir .. [[\j2.status]], move_from = wdir .. [[\r2.part]], move_to = wdir .. [[\never.json]] }
      T.run_bat(M.job_script(spec2), dir .. [[\j2.bat]])
      local status, status2 = (T.read(spec.status) or ""):gsub("%s+$", ""), (T.read(spec2.status) or ""):gsub("%s+$", "")
      check("job script (batch, run by cmd.exe): output to files, result moved after success, exit code written last",
        status == "0" and (T.read(final) or ""):find("CERTIFICATE", 1, true) ~= nil and (T.read(spec.stdout) or "") ~= "" and T.read(part) == nil
          and status2 ~= "" and status2 ~= "0" and T.read(wdir .. [[\never.json]]) == nil,
        "status " .. status .. ", failing job " .. status2)
    end
    local bat = M.job_script({ os = "windows", argv = { [[C:\Program Files\Playhead\playhead.exe]], "analyze", [[D:\Sounds\100% wet.wav]], "--out", [[C:\c\x.part]] },
      stdout = [[C:\j\1.out]], stderr = [[C:\j\1.err]], status = [[C:\j\1.status]], move_from = [[C:\c\x.part]], move_to = [[C:\c\x.json]], path_extra = { [[C:\ffmpeg\bin]] } })
    check("job script (batch): UTF-8 code page, quoted arguments, % doubled, exit code captured safely",
      bat:find("chcp 65001 >nul\r\n", 1, true) ~= nil and bat:find([["C:\Program Files\Playhead\playhead.exe" analyze "D:\Sounds\100%% wet.wav"]], 1, true) ~= nil
        and bat:find([[>"C:\j\1.status.tmp" echo %PH_CODE%]], 1, true) ~= nil and bat:find('set "PATH=%PATH%;C:\\ffmpeg\\bin"', 1, true) ~= nil
        and bat:find('if "%PH_CODE%"=="0" (move /Y', 1, true) ~= nil and not bat:find("[^\r]\n"), bat:sub(1, 60))
  end

  ------------------------------------------------------------------------------------------------------------------
  -- cache keys
  ------------------------------------------------------------------------------------------------------------------
  do
    local vectors = M.fnv1a64("") == "cbf29ce484222325" and M.fnv1a64("a") == "af63dc4c8601ec8c" and M.fnv1a64("foobar") == "85944171f73967e8"
    local base = { path = "/s/Door Slam (take 2).wav", size = 1000, length = 2.5, profile = "auto", version = "0.2.0", os = "linux" }
    local function key(changes) local t = {} for k, v in pairs(base) do t[k] = v end for k, v in pairs(changes or {}) do t[k] = v end return M.cache_key(t) end
    local k0 = key()
    local differ = k0 ~= key({ size = 1001 }) and k0 ~= key({ length = 2.6 }) and k0 ~= key({ profile = "music" }) and k0 ~= key({ version = "0.3.0" }) and k0 ~= key({ path = "/s/other.wav" })
    local win = M.cache_key({ path = [[C:\S\Door.WAV]], size = 1, length = 1, os = "windows" }) == M.cache_key({ path = "c:/s/door.wav", size = 1, length = 1, os = "windows" })
    check("cache: keys from path, size, length, profile and version; safe file names; Windows paths compare without case",
      vectors and differ and win and k0 == key() and k0:find("^[%w%-_]+$") ~= nil and k0:find("^Door_Slam_take_2%-") ~= nil, k0)
  end

  ------------------------------------------------------------------------------------------------------------------
  -- processing tools and dialogs
  ------------------------------------------------------------------------------------------------------------------
  do
    local tools, err = M.parse_tools(T.tools_json)
    check("tools: the command line's tool list is read", tools ~= nil and #tools >= 10, tostring(err))
    if tools then
      local by = {}
      for _, t in ipairs(tools) do by[t.id] = t end
      local d = M.tool_dialog(by.deharsh, {})
      local caps_ok = true
      for _, f in ipairs(d.fields) do if f.caption:find(",") or tostring(f.default):find(",") then caps_ok = false end end
      local defaults = {}
      for i, f in ipairs(d.fields) do defaults[i] = f.default end
      local params, problems = M.parse_tool_inputs(d, defaults)
      local same = true
      for _, p in ipairs(by.deharsh.params) do
        local want = type(p.value) == "boolean" and tostring(p.value) or (type(p.value) == "number" and M.num(p.value, 6) or tostring(p.value))
        if params[p.id] ~= want then same = false; T.note("deharsh " .. p.id .. ": " .. tostring(params[p.id]) .. " vs " .. want) end
      end
      check("tools: a dialog from the parameter specs (numbers with range and unit, yes/no, choices) gives back the defaults",
        #d.fields == #by.deharsh.params and caps_ok and #problems == 0 and same and d.fields[1].caption:find("relative/absolute/always", 1, true) ~= nil,
        d.fields[1].caption .. " | " .. d.fields[3].caption)
      local answers = {}
      for i, f in ipairs(d.fields) do answers[i] = f.default end
      answers[1] = "only"; answers[3] = "5"; answers[6] = "maybe"
      local p2, prob2 = M.parse_tool_inputs(d, answers)
      answers[1] = "2"; answers[3] = "0.5"; answers[6] = "off"
      local p3, prob3 = M.parse_tool_inputs(d, answers)
      check("tools: answers checked (range, yes/no, choice by name, label or number)", #prob2 == 2 and p2.mode == "absolute" and #prob3 == 0 and p3.mode == "absolute"
        and p3.amount == "0.5" and p3.match == "false", table.concat(prob2, "; "))
      local lay = M.tool_dialog(by.layers, {}, robot)
      local lp = M.parse_tool_inputs(lay, { "-12 0;3" })
      local args = M.tool_args(lay, lp)
      check("tools: layer gains named after the item's layers", #lay.fields == 1 and lay.fields[1].caption:find(robot.layers[1].name, 1, true) ~= nil
        and args[1] == "--param" and args[2] == "gains=-12,0,3", lay.fields[1].caption)
      check("tools: take names and output suffixes",
        M.take_name(by.deharsh, "deharsh", 2) == "De-harsh" and M.take_name(by.deharsh, "deharsh-removed", 2) == "De-harsh (removed)"
          and M.take_name(by.vars, "var2", 4) == "Variations (var 2)" and M.take_name(by.widen, "wide", 1) == "Widen the tails"
          and M.output_suffix("/x/Door Slam_deharsh-removed.wav", "/s/Door Slam.wav") == "deharsh-removed"
          and list_eq(M.written_files("wrote /a/b c.wav\nwrote /a/d.wav\n"), { "/a/b c.wav", "/a/d.wav" }))
    end
    local caps, vals = M.dialog_csv({ { caption = "A, b", default = "1,2" }, { caption = "C", default = "x" } }, 100)
    check("dialogs: commas kept out of captions and answers; answers split back", caps == "A; b,C,extrawidth=100" and vals == "1 2,x"
      and list_eq(M.dialog_values("1,2", 2), { "1", "2" }) and M.dialog_values("1,2,3", 2) == nil)
    local f1 = M.explain_failure(2, "playhead: cannot read /a/b.flac: needs ffmpeg to decode .flac (only WAV is read without ffmpeg)\n", { file = "/a/b.flac" })
    local f2 = M.explain_failure(127, "sh: 1: /x/playhead: not found", { exe = "/x/playhead" })
    local f3 = M.explain_failure(1, "playhead: Error: boom\n    at x (y.js:1)\n", {})
    check("messages: missing ffmpeg, missing executable and other errors explained", f1:find("ffmpeg") and f1:find("%.flac") and f2:find("could not be started")
      and f3 == "Playhead stopped with an error (exit code 1): Error: boom", f3)
  end
  ------------------------------------------------------------------------------------------------------------------
  -- levels: the same entries and gains as src/levels.js
  ------------------------------------------------------------------------------------------------------------------
  do
    local L = ref.levels
    local bad = {}
    local docs = { robot = robot, arc = arc }
    -- entries from the documents: measures, class and tags as Playhead.levels.entryOf makes them
    for _, je in ipairs(L.entries) do
      if je.from then
        local own = {}
        for _, t in ipairs(je.tags) do if not t:find(":") then own[#own + 1] = t end end
        local le = M.levels_entry(docs[je.from], je.path, own)
        if le.class ~= je.class then bad[#bad + 1] = je.path .. ": class " .. tostring(le.class) .. " vs " .. tostring(je.class) end
        if table.concat(le.tags, "|") ~= table.concat(je.tags, "|") then bad[#bad + 1] = je.path .. ": tags " .. table.concat(le.tags, "|") .. " vs " .. table.concat(je.tags, "|") end
        local n = 0
        for k, v in pairs(je.measures) do n = n + 1; if not near(le.measures[k], v, 1e-9) then bad[#bad + 1] = je.path .. ": " .. k end end
        for k in pairs(le.measures) do if je.measures[k] == nil then bad[#bad + 1] = je.path .. ": extra " .. k end end
        if n < 10 then bad[#bad + 1] = je.path .. ": only " .. n .. " measures" end
      end
    end
    local compared = 0
    for ci, case in ipairs(L.cases) do
      local S = M.levels_settings(case.spec)
      for i, je in ipairs(L.entries) do
        local g, want = M.levels_gain(S, case.spec.rules, je), case.gains[i]
        compared = compared + 1
        local same = near(g.gain, want.gain, 1e-9) and near(g.wanted, want.wanted, 1e-9) and near(g.offset, want.offset, 1e-9)
          and (g.used or "") == (want.used or "") and (g.group or "") == (want.group or "") and (g.limited or "") == (want.limitedBy or "")
          and table.concat(g.modifiers, "|") == table.concat(want.modifiers, "|") and table.concat(g.notes, "|") == table.concat(want.notes, "|")
        if not same then bad[#bad + 1] = string.format("case %d, %s: %s dB (%s, %s) vs %s dB (%s, %s)", ci, je.path, tostring(g.gain), tostring(g.used), tostring(g.limited), tostring(want.gain), tostring(want.used), tostring(want.limitedBy)) end
      end
    end
    check("levels: entries from the documents (measures, class, automatic tags) and the gains under two specs are those of src/levels.js (" .. compared .. " gains)", #bad == 0, bad[1])
    local p1, e1 = M.levels_parse_measure("momentaryMax@event")
    local _, e2 = M.levels_parse_measure("loudest@event")
    local _, e3 = M.levels_parse_measure("peak@event")
    check("levels: measure names are checked", p1 and p1.scope == "event" and e1 == nil and e2 and e3 and e3:find("whole file"), tostring(e2))
    local rel_w = M.levels_relative("C:\\Sounds\\Lib", "c:/sounds/lib/Guns/Shot 1.wav", "windows")
    local rel_l = M.levels_relative("/s/lib/", "/s/lib/a/b.wav", "linux")
    local out = M.levels_relative("/s/lib", "/s/library/b.wav", "linux")
    local man = { files = { { path = "Guns/Shot 1.wav", size = 10 }, { path = "a/b.wav" } } }
    local found = M.levels_find_entry(man, "guns/shot 1.wav", 10, "windows")
    local nosize = M.levels_find_entry(man, "Guns/Shot 1.wav", 11, "linux")
    check("levels: paths relative to a manifest's folder (case ignored on Windows), entries matched by path and size",
      rel_w == "Guns/Shot 1.wav" and rel_l == "a/b.wav" and out == nil and found == man.files[1] and nosize == nil and M.levels_find_entry(man, "a/b.wav", 99, "linux") == man.files[2],
      tostring(rel_w) .. " / " .. tostring(rel_l))
    local S1 = M.levels_settings(nil, { place = "track", target = -23, limits = { boost = 6 } })
    local S2 = M.levels_settings({ levels = { target = -20, depth = 2 } }, { target = -23 })
    check("levels: settings: the defaults, then a manifest's, then the project's own (also without a manifest)",
      S1.place == "track" and S1.target == -23 and S1.limits.boost == 6 and S1.limits.cut == 40 and S2.target == -23 and S2.depth == 2 and S2.measure == "momentaryMax@event",
      tostring(S1.place) .. " " .. tostring(S1.target))
    check("levels: take volume and dB keep the polarity", near(M.levels_to_vol(-6.0206, true), -0.5, 1e-4) and near(M.levels_to_db(-0.5), -6.0206, 1e-3), "")
  end

end
