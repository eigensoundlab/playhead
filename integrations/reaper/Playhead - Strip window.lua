-- @description Playhead: strip window (the selected item drawn in a Playhead look, dockable)
-- @version 0.2.0
-- @author Daniel Sandner
-- @noindex
-- @about
--   A dockable window that draws the selected item as a Playhead strip: waveform, curves in lanes or over the
--   waveform, events, onsets, beats, bar lines, sections and novelty marks, or a view of rhythm and form (bar raster,
--   tempogram, repetition, modulation spectrogram, curve rhythms), in a ready-made look or your own look code, with
--   the edit and play cursors. Click to move the edit cursor; right-click for looks and options.
--   Packaged by "Playhead - Analyse selected items.lua".

-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
--
-- The strip follows the take: its start offset, playback rate, loop and reversed sections. Items without an
-- analysis are analysed in the background when selected (switch this off in the menu or in Playhead - Settings).
-- The strip is drawn once into an image and redrawn only when the item, the look, the window size or the theme
-- changes; cursors are drawn over it. On the bar raster (a row per bar, top to bottom) the cursors are drawn in the
-- row of the bar they are in, and a click moves the edit cursor to that point of that bar.

local source = debug.getinfo(1, "S").source
local dir = source:match("^@?(.*[/\\])") or ""
package.path = dir .. "lib/?.lua;" .. package.path
local ok, R = pcall(require, "playhead_reaper")
if not ok then
  reaper.ShowMessageBox("Playhead's library files could not be loaded from\n" .. dir .. "lib\n\n" .. tostring(R), "Playhead", 0)
  return
end
local core = R.core

local TITLE = "Playhead strip"
local IMG = 1                                              -- offscreen image holding the rendered strip

local st = {
  look = R.get("look", "auto"),
  auto = core.parse_bool(R.get("strip_auto", "yes"), true),
  sig = nil, item = nil, info = nil, doc = nil, message = "Select an audio item.", count = 0,
  job = nil, job_spec = nil, failed = {},
  cli = nil, cli_error = nil, profile = "auto",
  render = true, screen = true, w = 0, h = 0,
  theme = nil, theme_key = nil, colours = nil,
  next_theme = 0, next_selection = 0, next_cache = 0, next_status = 0,
  edit = nil, play = nil, left = false, right = false, legend = "",
  raster = nil                                             -- the rows of the bar raster drawn ({ {start, stop}, ... }), if one is
}

local function scale() return math.max(1, gfx.ext_retina or 1) end
local function header_h() return math.floor(22 * scale()) end
local function footer_h() return math.floor(18 * scale()) end
local function strip_box()
  local top = header_h()
  return 0, top, math.max(1, math.min(8192, gfx.w)), math.max(8, gfx.h - top - footer_h())
end

------------------------------------------------------------------------------------------------------------------------
-- the command line, checked once (and again only when asked: a failing check can take a while)
------------------------------------------------------------------------------------------------------------------------
local function ensure_cli(force)
  if st.cli and not force then return st.cli end
  if st.cli_error and not force then return nil end
  local cli, err = R.cli(nil, force)
  st.cli, st.cli_error = cli, err
  if cli then st.profile = R.profile_for(cli.settings) end
  return cli
end

------------------------------------------------------------------------------------------------------------------------
-- following the selection
------------------------------------------------------------------------------------------------------------------------
local function quick_signature(item)
  if not item then return "none" end
  local take = reaper.GetActiveTake(item)
  if not take then return "empty|" .. tostring(item) end
  local src = reaper.GetMediaItemTake_Source(take)
  local sec = ""
  if src then
    local ok_s, offs, len, rev = reaper.PCM_Source_GetSectionInfo(src)
    if ok_s then sec = string.format("%.9f/%.9f/%s", offs or 0, len or 0, tostring(rev)) end
  end
  return table.concat({ tostring(item), tostring(take), tostring(src), sec,
    string.format("%.9f", reaper.GetMediaItemInfo_Value(item, "D_POSITION")),
    string.format("%.9f", reaper.GetMediaItemInfo_Value(item, "D_LENGTH")),
    string.format("%.9f", reaper.GetMediaItemTakeInfo_Value(take, "D_STARTOFFS")),
    string.format("%.9f", reaper.GetMediaItemTakeInfo_Value(take, "D_PLAYRATE")),
    tostring(reaper.GetMediaItemInfo_Value(item, "B_LOOPSRC")) }, "|")
end

local function start_analysis(info)
  local cli = ensure_cli()
  if not cli or st.job then return end
  st.job_spec = R.analysis_spec(info, cli, st.profile)
  local job, err = R.start_job(st.job_spec)
  if not job then st.failed[info.file] = err; st.message = err; st.job_spec = nil return end
  st.job = job
  st.screen = true
end

local function look_up_document(allow_analysis)
  local info = st.info
  if not info then return end
  local cli = ensure_cli()
  if not cli then st.message = "The Playhead command line is not set up. Right-click for options, or run Playhead - Settings." return end
  local doc = R.cached_document(info, cli, st.profile)
  if doc then
    st.doc, st.message = doc, nil
    st.render, st.screen = true, true
    return
  end
  st.doc = nil
  if st.failed[info.file] then st.message = "Analysis failed: " .. st.failed[info.file]
  elseif st.job then st.message = "Waiting for the analysis of another item..."
  elseif allow_analysis and st.auto then start_analysis(info)
  else st.message = "Not analysed yet. Right-click and choose Analyse this item, or run Playhead - Analyse selected items." end
  st.screen = true
end

local function check_selection()
  local item = reaper.GetSelectedMediaItem(0, 0)
  local sig = quick_signature(item)
  st.count = reaper.CountSelectedMediaItems(0)
  if sig == st.sig then return end
  st.sig = sig
  st.item = item
  st.render, st.screen = true, true
  if not item then st.info, st.doc, st.message = nil, nil, "Select an audio item." return end
  local info, err = R.take_info(item)
  st.info = info
  if not info then st.doc, st.message = nil, err return end
  look_up_document(true)
end

local function poll_job()
  if not st.job then return end
  local res = R.poll(st.job)
  if not res then return end
  local spec = st.job_spec
  st.job, st.job_spec = nil, nil
  local doc, err = R.analysis_result(spec, res)
  if not doc then st.failed[spec.file] = err end
  if st.info and st.info.file == spec.file then
    if doc then st.doc, st.message = doc, nil else st.doc, st.message = nil, "Analysis failed: " .. tostring(err) end
    st.render, st.screen = true, true
  elseif st.info and not st.doc then
    look_up_document(true)                                 -- the selection moved on meanwhile
  end
end

------------------------------------------------------------------------------------------------------------------------
-- theme
------------------------------------------------------------------------------------------------------------------------
local function check_theme()
  local c = R.theme_colours()
  local key = core.json_encode(c)
  if key == st.theme_key then return end
  st.theme_key, st.colours = key, c
  local over = { text = c.text }
  if c.wave and math.abs(core.luminance(c.wave) - core.luminance(c.background)) > 0.2 then over.wave = c.wave end
  st.theme = core.theme_for(c.background, over)
  st.render, st.screen = true, true
end

------------------------------------------------------------------------------------------------------------------------
-- drawing
------------------------------------------------------------------------------------------------------------------------
local function look_title()
  local L = core.LOOKS[st.look]
  if L then return L.name end
  return "custom look"
end

local function draw_text(x, y, text, colour, alpha, size, max_w)
  R.set_colour(colour, alpha)
  gfx.setfont(1, "Arial", math.floor(size * scale() + 0.5))
  local t = text
  if max_w then
    while #t > 4 and gfx.measurestr(t) > max_w do t = t:sub(1, #t - 5) .. "..." end
  end
  gfx.x, gfx.y = x, y
  gfx.drawstr(t)
end

local function render_strip()
  local _, _, W, H = strip_box()
  gfx.setimgdim(IMG, W, H)                                 -- contents are undefined after a resize: filled below
  gfx.dest = IMG
  R.set_colour(st.theme.background)
  gfx.rect(0, 0, W, H, 1)
  if st.doc and st.info then
    local slow = core.slow_views(st.doc, st.look)
    if slow then                                           -- the window cannot redraw while this is worked out: say so first
      local x0, top = strip_box()
      gfx.dest = -1
      R.set_colour(st.theme.background)
      gfx.rect(x0, top, W, H, 1)
      draw_text(x0 + 8 * scale(), top + 8 * scale(), "Working out " .. slow .. " (once for this item)...", st.theme.text, 0.85, 13, W - 16 * scale())
      gfx.update()
      gfx.dest = IMG
    end
    local column, to_x = core.item_columns(st.info.map, W)
    local ok_r, r = pcall(core.render_strip, st.doc, R.gfx_sink(0, 0, scale()),
      { width = W, height = H, look = st.look, theme = st.theme, column = column, to_x = to_x, fill = false })
    if ok_r then st.legend, st.raster = r.legend, r.raster and r.raster.rows or nil
    else st.legend, st.raster = "", nil; st.message = "Could not draw this look: " .. tostring(r) end
  else
    st.raster = nil
  end
  gfx.dest = -1
  st.render = false
end

-- where a cursor at project time T is drawn: a vertical line { x, y0, y1, key }, or nil outside the item (or, on the
-- bar raster, outside the bars drawn)
local function cursor_mark(T)
  if not st.info or not T then return nil end
  local m = st.info.map
  if T < m.pos or T > m.pos + m.len then return nil end
  local _, top, W, H = strip_box()
  if st.raster then
    local x, y, rh = core.raster_xy(st.raster, core.project_to_file(m, T), W, H)
    if not x then return nil end
    x = math.floor(x + 0.5)
    local y0, y1 = top + math.floor(y + 0.5), top + math.floor(y + rh + 0.5)
    return { x = x, y0 = y0, y1 = y1, key = x .. "/" .. y0 }
  end
  local x = math.floor((T - m.pos) / m.len * W + 0.5)
  return { x = x, y0 = top, y1 = top + H, key = tostring(x) }
end
local function mark_key(c) return c and c.key or "" end

local function draw_screen()
  local th = st.theme
  local s = scale()
  local x0, top, W, H = strip_box()
  R.set_colour(th.background)
  gfx.rect(0, 0, gfx.w, gfx.h, 1)
  local name = st.info and st.info.name or "Playhead"
  if st.count > 1 then name = name .. string.format(" (first of %d selected)", st.count) end
  draw_text(8 * s, 4 * s, name .. "  -  " .. look_title(), th.text, 1, 13, gfx.w - 16 * s)
  if st.doc and st.info and not st.message then
    gfx.x, gfx.y = x0, top
    gfx.blit(IMG, 1, 0)
    local ec = st.colours and st.colours.edit_cursor or { 220, 60, 60 }
    local pc = st.colours and st.colours.play_cursor or th.text
    if st.edit then R.set_colour(ec, 1); gfx.line(st.edit.x, st.edit.y0, st.edit.x, st.edit.y1, 0) end
    if st.play then R.set_colour(pc, 0.9); gfx.line(st.play.x, st.play.y0, st.play.x, st.play.y1, 0) end
    draw_text(8 * s, top + H + 2 * s, st.legend or "", th.text, 0.75, 11, gfx.w - 16 * s)
  else
    local msg = st.message or ""
    if st.job then
      msg = string.format("Analysing %s ... %.1f s", core.basename(st.job_spec.file), reaper.time_precise() - st.job.started)
    end
    draw_text(8 * s, top + 8 * s, msg, th.text, 0.85, 13, gfx.w - 16 * s)
  end
  gfx.update()
  st.screen = false
end

------------------------------------------------------------------------------------------------------------------------
-- menu
------------------------------------------------------------------------------------------------------------------------
local function custom_look()
  local current = st.look
  if core.LOOKS[current] then current = core.LOOKS[current].code or core.look_code(core.auto_layers(st.doc)) end
  local v = R.dialog("Playhead: look code", { { caption = "Look code (parts separated by spaces)", default = current:gsub(",", " ") } }, 420)
  if not v then return end
  local code = core.trim(v[1]):gsub("[%s;,]+", ",")
  local layers = core.parse_look(code)
  if not layers or #layers == 0 then
    R.message("No layer was recognised in \"" .. v[1] .. "\".\n\nExample: wave:harshness lane:activity ticks:events\n" ..
      "Parts: wave or wave:<curve>, spec, line:<curve>, lane:<curve> (add ~signed for change curves), sections, " ..
      "ticks:events+onsets+beats+downbeats+novelty, outline, sculpt:<curve>, form:lanes or form:overlay, " ..
      "shape:base, shape:mirror, shape:horizon or shape:line.\n" ..
      "Views: spec:tempo (add ~cyclic to fold the octaves), spec:lag, spec:mod, scalogram:<curve>, " ..
      "raster:<curve> (add ~4bars for a row per 4 bars).")
    return
  end
  st.look = core.look_code(layers)
  R.set("look", st.look)
  st.render, st.screen = true, true
end

local function show_menu()
  local entries = {}
  for _, key in ipairs(core.LOOK_ORDER) do
    local L = core.LOOKS[key]
    local fits = not st.doc or key == "auto" or core.look_fits(st.doc, key)
    entries[#entries + 1] = { label = L.name, checked = st.look == key, disabled = not fits, value = { look = key } }
  end
  entries[#entries + 1] = { separator = true }
  entries[#entries + 1] = { label = "Custom look code...", checked = core.LOOKS[st.look] == nil, value = { action = "custom" } }
  entries[#entries + 1] = { separator = true }
  entries[#entries + 1] = { label = st.doc and "Analyse this item again" or "Analyse this item", disabled = st.info == nil or st.job ~= nil, value = { action = "again" } }
  entries[#entries + 1] = { label = "Analyse items automatically when selected", checked = st.auto, value = { action = "auto" } }
  if st.cli_error then entries[#entries + 1] = { label = "Look for the Playhead command line again", value = { action = "cli" } } end
  entries[#entries + 1] = { separator = true }
  local docked = math.floor(gfx.dock(-1) or 0) & 1 == 1
  entries[#entries + 1] = { label = docked and "Undock window" or "Dock window", value = { action = "dock" } }
  local menu, by_number = R.build_menu(entries)
  gfx.x, gfx.y = gfx.mouse_x, gfx.mouse_y
  local e = by_number[gfx.showmenu(menu)]
  if not e then return end
  local v = e.value
  if v.look then st.look = v.look; R.set("look", v.look); st.render = true
  elseif v.action == "custom" then custom_look()
  elseif v.action == "again" and st.info then
    local cli = ensure_cli()
    if cli then
      R.forget_document(st.info, cli, st.profile)
      st.failed[st.info.file] = nil
      st.doc = nil
      start_analysis(st.info)
    end
  elseif v.action == "auto" then
    st.auto = not st.auto
    R.set("strip_auto", core.yesno(st.auto))
    if st.auto and st.info and not st.doc then look_up_document(true) end
  elseif v.action == "cli" then
    ensure_cli(true)
    if st.cli_error then R.message(st.cli_error) end
    st.sig = nil
  elseif v.action == "dock" then
    if docked then gfx.dock(0) else gfx.dock(tonumber(R.get("strip_dockstate", "1")) or 1) end
  end
  st.screen = true
end

------------------------------------------------------------------------------------------------------------------------
-- the loop
------------------------------------------------------------------------------------------------------------------------
local function handle_mouse()
  local cap = math.floor(gfx.mouse_cap or 0)
  local x0, top, W, H = strip_box()
  local inside = gfx.mouse_x >= x0 and gfx.mouse_x < x0 + W and gfx.mouse_y >= top and gfx.mouse_y < top + H
  local left = cap & 1 == 1
  if left and not st.left then st.drag = inside end        -- a press inside the strip starts moving the cursor
  if left and st.drag and st.info then
    local m = st.info.map
    local T
    if st.raster then                                      -- the bar raster: that point of the bar in that row
      local f = core.raster_time(st.raster, gfx.mouse_x - x0, gfx.mouse_y - top, W, H)
      local cur = reaper.GetCursorPosition()
      for _, t in ipairs(f and core.file_to_project(m, f, 2000) or {}) do     -- (looped: the time nearest the cursor)
        if not T or math.abs(t - cur) < math.abs(T - cur) then T = t end
      end
    else
      T = m.pos + math.max(0, math.min(1, (gfx.mouse_x - x0) / W)) * m.len
    end
    if T then reaper.SetEditCurPos(T, false, not st.left) end     -- seek playback on the press, not while dragging
  end
  if not left then st.drag = false end
  st.left = left
  local right = cap & 2 == 2
  if right and not st.right then show_menu() end
  st.right = right
end

local function loop()
  local ch = gfx.getchar()
  if ch < 0 then return end                                -- window closed
  if ch == 32 then reaper.Main_OnCommand(40044, 0) end     -- space: Transport: Play/stop
  local now = reaper.time_precise()
  if now >= st.next_theme then st.next_theme = now + 1; check_theme() end
  if gfx.w ~= st.w or gfx.h ~= st.h then st.w, st.h = gfx.w, gfx.h; st.render, st.screen = true, true end
  if now >= st.next_selection then st.next_selection = now + 0.1; check_selection() end
  poll_job()
  if st.info and not st.doc and not st.job and now >= st.next_cache then
    st.next_cache = now + 1
    look_up_document(st.failed[st.info.file] == nil)        -- another action may have analysed it meanwhile
  end
  if st.job and now >= st.next_status then st.next_status = now + 0.25; st.screen = true end
  handle_mouse()
  if st.render and st.theme then render_strip(); st.screen = true end
  local ec = cursor_mark(reaper.GetCursorPosition())
  local pc = (math.floor(reaper.GetPlayState()) & 1 == 1) and cursor_mark(reaper.GetPlayPosition()) or nil
  if mark_key(ec) ~= mark_key(st.edit) or mark_key(pc) ~= mark_key(st.play) then st.edit, st.play, st.screen = ec, pc, true end
  if st.screen and st.theme then draw_screen() end
  reaper.defer(loop)
end

local function start()
  local _, _, sec, cmd = reaper.get_action_context()
  if sec and cmd and cmd > 0 then reaper.SetToggleCommandState(sec, cmd, 1); reaper.RefreshToolbar2(sec, cmd) end
  reaper.atexit(function()
    local d, x, y, w, h = gfx.dock(-1, 0, 0, 0, 0)
    if d then
      d = math.floor(d)
      R.set("strip_dock", d)
      if d & 1 == 1 then R.set("strip_dockstate", d) end
      if w and w > 0 and h and h > 0 then R.set("strip_x", x); R.set("strip_y", y); R.set("strip_w", w); R.set("strip_h", h) end
    end
    if sec and cmd and cmd > 0 then reaper.SetToggleCommandState(sec, cmd, 0); reaper.RefreshToolbar2(sec, cmd) end
  end)
  gfx.ext_retina = 1
  gfx.init(TITLE, tonumber(R.get("strip_w", "900")) or 900, tonumber(R.get("strip_h", "200")) or 200,
    tonumber(R.get("strip_dock", "0")) or 0, tonumber(R.get("strip_x", "120")) or 120, tonumber(R.get("strip_y", "120")) or 120)
  gfx.clear = -1
  R.clean_jobs()
  loop()
end

start()
