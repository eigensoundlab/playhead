-- @noindex (a test, not a ReaPack package)
-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
--
-- A mock REAPER for the smoke tests: the part of the ReaScript API the Playhead scripts use, with a small project
-- (tracks, items, takes, sources, FX, envelopes, markers) behind it. Every call is checked against the documented
-- Lua signature (argument count and types); a wrong call, an unknown function and an unknown parameter name are
-- recorded as errors. The gfx window is simulated well enough to drive the scripts' defer loops.
--
-- Functions whose older signature took an extra output buffer (GetMediaSourceFileName, GetMediaSourceType,
-- TrackFX_GetFXName, TrackFX_GetParamName, GetProjectPathEx) accept it as an optional string, as REAPER does.

local Mock = {}

function Mock.new(T, opts)
  opts = opts or {}
  local env = {
    errors = {}, console = {}, messages = {}, dialogs = {}, menus = {}, calls = {}, deferred = {}, atexits = {},
    ext = {}, projext = {}, tracks = {}, items = {}, markers = {}, next_marker = 1, next_region = 1,
    cursor = 0, play_state = 0, play_pos = 0, refresh = 0, undo_depth = 0, undo_points = {},
    message_answers = {}, input_answers = {}, menu_choice = nil, getchar = function() return 0 end,
    toggles = {}, os = opts.os or "Other", resource = opts.resource, media = opts.media, jsfx = opts.jsfx,
  }
  local function err(msg) env.errors[#env.errors + 1] = msg end
  env.err = err

  local KIND_OK = {}
  local function check(name, types, ...)
    local n = select("#", ...)
    local args = { ... }
    local need = 0
    for i, t in ipairs(types) do if t:sub(1, 1) ~= "?" then need = i end end
    if n > #types then err(name .. ": called with " .. n .. " arguments; it takes " .. #types) end
    for i, t in ipairs(types) do
      local v = args[i]
      local optional = t:sub(1, 1) == "?"
      local ty = optional and t:sub(2) or t
      if v == nil then
        if not optional and i <= need then err(name .. ": argument " .. i .. " (" .. ty .. ") missing") end
      else
        local ok
        if ty == "number" then ok = type(v) == "number"
        elseif ty == "integer" then ok = type(v) == "number" and v == math.floor(v)
        elseif ty == "string" then ok = type(v) == "string"
        elseif ty == "boolean" then ok = type(v) == "boolean"
        elseif ty == "function" then ok = type(v) == "function"
        elseif ty == "ReaProject" then ok = v == 0 or (type(v) == "table" and v.kind == "ReaProject")
        else ok = type(v) == "table" and v.kind == ty end
        if not ok then err(string.format("%s: argument %d should be %s, got %s (%s)", name, i, ty, type(v), tostring(v))) end
      end
    end
    env.calls[name] = (env.calls[name] or 0) + 1
  end

  ----------------------------------------------------------------------------------------------------------------
  -- the project
  ----------------------------------------------------------------------------------------------------------------
  local guid_n = 0
  local function guid() guid_n = guid_n + 1; return string.format("{00000000-0000-0000-0000-%012d}", guid_n) end
  function env.add_track(name)
    local tr = { kind = "MediaTrack", name = name, fx = {}, selected = false }
    env.tracks[#env.tracks + 1] = tr
    return tr
  end
  function env.source(t)   -- { file, len, type, sr, parent, section = {offs, len, rev} }
    return { kind = "PCM_source", file = t.file or "", len = t.len or 0, type = t.type or "WAVE", sr = t.sr or 48000, parent = t.parent, section = t.section, qn = t.qn }
  end
  function env.add_item(track, t)
    local item = { kind = "MediaItem", track = track, pos = t.pos or 0, len = t.len or 1, loop = t.loop and 1 or 0, takes = {}, cur = 0,
      selected = t.selected ~= false, guid = guid(), vol = 1 }
    if t.source then
      item.takes[1] = { kind = "MediaItem_Take", item = item, src = t.source, offs = t.offs or 0, rate = t.rate or 1, name = t.name or "",
        midi = t.midi or false, markers = {}, vals = { D_VOL = 1, D_PAN = 0, D_PANLAW = -1, D_PITCH = 0, B_PPITCH = 0, I_CHANMODE = 0 }, stretch = t.stretch or 0 }
    end
    env.items[#env.items + 1] = item
    return item
  end
  function env.select(items)
    for _, it in ipairs(env.items) do it.selected = false end
    for _, it in ipairs(items) do it.selected = true end
  end
  local function selected() local out = {} for _, it in ipairs(env.items) do if it.selected then out[#out + 1] = it end end return out end
  local function active(item) return item.takes[item.cur + 1] end

  -- Playhead Control's parameters, read from the JSFX file itself (sliders in order, then REAPER's Wet and Bypass)
  local function jsfx_params()
    local out = {}
    local f = io.open(env.jsfx, "r")
    if not f then err("cannot read " .. tostring(env.jsfx)) return out end
    for line in f:lines() do
      local n, rest = line:match("^slider(%d+):(.*)$")
      if n then
        local default, lo, hi, desc = rest:match("^[%w_]*=?([%-%d%.]+)<([%-%d%.]+),([%-%d%.]+)[^>]*>(.*)$")
        out[#out + 1] = { name = desc or "", value = tonumber(default), min = tonumber(lo), max = tonumber(hi) }   -- hidden: "-name"
      end
    end
    f:close()
    out[#out + 1] = { name = "Wet", value = 1, min = 0, max = 1 }
    out[#out + 1] = { name = "Bypass", value = 0, min = 0, max = 1 }
    return out
  end

  ----------------------------------------------------------------------------------------------------------------
  -- the API
  ----------------------------------------------------------------------------------------------------------------
  local R = {}
  local ITEM_KEYS = { D_POSITION = "pos", D_LENGTH = "len", B_LOOPSRC = "loop", I_CURTAKE = "cur", D_VOL = "vol" }
  local TAKE_KEYS = { D_STARTOFFS = true, D_PLAYRATE = true, D_VOL = true, D_PAN = true, D_PANLAW = true, D_PITCH = true, B_PPITCH = true, I_CHANMODE = true }

  function R.APIExists(name) check("APIExists", { "string" }, name); return R[name] ~= nil end
  function R.GetOS() check("GetOS", {}); return env.os end
  function R.GetResourcePath() check("GetResourcePath", {}); return env.resource end
  function R.GetAppVersion() check("GetAppVersion", {}); return "7.27/linux-x86_64" end
  function R.RecursiveCreateDirectory(p, x) check("RecursiveCreateDirectory", { "string", "integer" }, p, x); T.mkdirs(p); return 1 end
  function R.file_exists(p) check("file_exists", { "string" }, p); return T.exists(p) and not T.isdir(p) end
  local listing = {}
  function R.EnumerateFiles(p, i)
    check("EnumerateFiles", { "string", "integer" }, p, i)
    if i < 0 or not listing[p] then listing[p] = {} for _, f in ipairs(T.listdir(p)) do if not T.isdir(p .. "/" .. f) then listing[p][#listing[p] + 1] = f end end end
    if i < 0 then return nil end
    return listing[p][i + 1]
  end
  function R.GetExtState(s, k) check("GetExtState", { "string", "string" }, s, k); return env.ext[s .. "/" .. k] or "" end
  function R.SetExtState(s, k, v, persist)
    check("SetExtState", { "string", "string", "string", "boolean" }, s, k, v, persist)
    if type(v) == "string" and v:find("[\r\n]") then err("SetExtState: value with a line break") end
    env.ext[s .. "/" .. k] = v
  end
  function R.GetProjExtState(p, e, k) check("GetProjExtState", { "ReaProject", "string", "string" }, p, e, k); local v = env.projext[e .. "/" .. k]; return v and #v or 0, v or "" end
  function R.SetProjExtState(p, e, k, v) check("SetProjExtState", { "ReaProject", "string", "string", "string" }, p, e, k, v); env.projext[e .. "/" .. k] = v; return #v end
  function R.time_precise() check("time_precise", {}); return T.now() end
  function R.defer(f) check("defer", { "function" }, f); env.deferred[#env.deferred + 1] = f end
  function R.atexit(f) check("atexit", { "function" }, f); env.atexits[#env.atexits + 1] = f end
  function R.ShowConsoleMsg(s) check("ShowConsoleMsg", { "string" }, s); env.console[#env.console + 1] = s end
  function R.ShowMessageBox(msg, title, ty)
    check("ShowMessageBox", { "string", "string", "integer" }, msg, title, ty)
    env.messages[#env.messages + 1] = { text = msg, title = title, type = ty }
    local a = table.remove(env.message_answers, 1)
    if a then return a end
    return (ty == 4 or ty == 3) and 7 or 1
  end
  function R.GetUserInputs(title, n, caps, vals)
    check("GetUserInputs", { "string", "integer", "string", "string" }, title, n, caps, vals)
    if n > 16 then err("GetUserInputs: more than 16 fields (" .. n .. ")") end
    local c = {}
    for x in (caps .. ","):gmatch("([^,]*),") do if not x:find("^extrawidth=") and not x:find("^separator=") then c[#c + 1] = x end end
    local v = {}
    for x in (vals .. ","):gmatch("([^,]*),") do v[#v + 1] = x end
    if #c ~= n then err("GetUserInputs \"" .. title .. "\": " .. #c .. " captions for " .. n .. " fields") end
    if n > 1 and #v ~= n then err("GetUserInputs \"" .. title .. "\": " .. #v .. " values for " .. n .. " fields") end
    env.dialogs[#env.dialogs + 1] = { title = title, captions = c, values = v }
    local a = table.remove(env.input_answers, 1)
    if a == false then return false, "" end
    if type(a) == "function" then a = a(v, c) end
    if type(a) == "table" then return true, table.concat(a, ",") end
    if type(a) == "string" then return true, a end
    return true, vals
  end
  function R.ExecProcess(cmd, timeout)
    check("ExecProcess", { "string", "integer" }, cmd, timeout)
    env.exec = env.exec or {}
    env.exec[#env.exec + 1] = cmd
    if env.os ~= "Win64" and not (cmd:find('^/bin/sh "[^"]+"$') or cmd:find('^cmd%.exe ')) then err("ExecProcess: unexpected command " .. cmd) end
    if timeout < 0 then T.run_detached(cmd); return "" end
    return T.run_wait(cmd, timeout)
  end
  function R.Undo_BeginBlock() check("Undo_BeginBlock", {}); env.undo_depth = env.undo_depth + 1 end
  function R.Undo_EndBlock(d, f) check("Undo_EndBlock", { "string", "integer" }, d, f); env.undo_depth = env.undo_depth - 1; env.undo_points[#env.undo_points + 1] = d end
  function R.PreventUIRefresh(n) check("PreventUIRefresh", { "integer" }, n); env.refresh = env.refresh + n end
  function R.UpdateArrange() check("UpdateArrange", {}) end
  function R.TrackList_AdjustWindows(isMinor) check("TrackList_AdjustWindows", { "boolean" }, isMinor) end
  function R.UpdateTimeline() check("UpdateTimeline", {}) end
  function R.GetMousePosition() check("GetMousePosition", {}); return 400, 300 end
  function R.GetThemeColor(k, f)
    check("GetThemeColor", { "string", "integer" }, k, f)
    local t = { col_main_bg2 = 0x333333, col_main_text2 = 0xdddddd, col_tr1_peaks = 0x55cc77, col_cursor = 0x2020dd, playcursor_color = 0xeeeeee }
    return t[k] or -1
  end
  function R.ColorFromNative(c) check("ColorFromNative", { "integer" }, c); return c & 255, (c >> 8) & 255, (c >> 16) & 255 end
  function R.Main_OnCommand(c, f) check("Main_OnCommand", { "integer", "integer" }, c, f) end
  function R.get_action_context() check("get_action_context", {}); return false, env.script or "", 0, 55555, -1, -1, -1, "" end
  function R.SetToggleCommandState(s, c, v) check("SetToggleCommandState", { "integer", "integer", "integer" }, s, c, v); env.toggles[c] = v; return true end
  function R.GetToggleCommandState(c) check("GetToggleCommandState", { "integer" }, c); return env.toggles[c] or (c == 40036 and 1 or -1) end
  function R.RefreshToolbar2(s, c) check("RefreshToolbar2", { "integer", "integer" }, s, c) end
  function R.GetProjectPathEx(p, buf) check("GetProjectPathEx", { "ReaProject", "?string" }, p, buf); return env.media end
  function R.GetProjectPath(buf) check("GetProjectPath", { "?string" }, buf); return env.media end
  function R.GetCursorPosition() check("GetCursorPosition", {}); return env.cursor end
  function R.SetEditCurPos(t, mv, seek) check("SetEditCurPos", { "number", "boolean", "boolean" }, t, mv, seek); env.cursor = t; env.seeks = (env.seeks or 0) + (seek and 1 or 0) end
  function R.GetPlayState() check("GetPlayState", {}); return env.play_state end
  function R.GetPlayPosition() check("GetPlayPosition", {}); return env.play_pos end

  -- items, takes, sources
  function R.CountSelectedMediaItems(p) check("CountSelectedMediaItems", { "ReaProject" }, p); return #selected() end
  function R.GetSelectedMediaItem(p, i) check("GetSelectedMediaItem", { "ReaProject", "integer" }, p, i); return selected()[i + 1] end
  function R.GetActiveTake(item) check("GetActiveTake", { "MediaItem" }, item); return active(item) end
  function R.CountTakes(item) check("CountTakes", { "MediaItem" }, item); return #item.takes end
  function R.TakeIsMIDI(take) check("TakeIsMIDI", { "MediaItem_Take" }, take); return take.midi end
  function R.GetMediaItem_Track(item) check("GetMediaItem_Track", { "MediaItem" }, item); return item.track end
  function R.GetMediaItemInfo_Value(item, k)
    check("GetMediaItemInfo_Value", { "MediaItem", "string" }, item, k)
    if not ITEM_KEYS[k] then err("GetMediaItemInfo_Value: parameter " .. k .. " not handled by the mock") return 0 end
    return item[ITEM_KEYS[k]]
  end
  function R.SetMediaItemInfo_Value(item, k, v)
    check("SetMediaItemInfo_Value", { "MediaItem", "string", "number" }, item, k, v)
    if not ITEM_KEYS[k] then err("SetMediaItemInfo_Value: parameter " .. k) return false end
    item[ITEM_KEYS[k]] = v
    return true
  end
  function R.GetMediaItemTakeInfo_Value(take, k)
    check("GetMediaItemTakeInfo_Value", { "MediaItem_Take", "string" }, take, k)
    if k == "D_STARTOFFS" then return take.offs elseif k == "D_PLAYRATE" then return take.rate end
    if not TAKE_KEYS[k] then err("GetMediaItemTakeInfo_Value: parameter " .. k) return 0 end
    return take.vals[k] or 0
  end
  function R.SetMediaItemTakeInfo_Value(take, k, v)
    check("SetMediaItemTakeInfo_Value", { "MediaItem_Take", "string", "number" }, take, k, v)
    if k == "D_STARTOFFS" then take.offs = v elseif k == "D_PLAYRATE" then take.rate = v
    elseif TAKE_KEYS[k] then take.vals[k] = v else err("SetMediaItemTakeInfo_Value: parameter " .. k) return false end
    return true
  end
  function R.GetSetMediaItemTakeInfo_String(take, k, v, set)
    check("GetSetMediaItemTakeInfo_String", { "MediaItem_Take", "string", "string", "boolean" }, take, k, v, set)
    if k ~= "P_NAME" then err("GetSetMediaItemTakeInfo_String: parameter " .. k) return false, "" end
    if set then take.name = v end
    return true, take.name
  end
  function R.GetSetMediaItemInfo_String(item, k, v, set)
    check("GetSetMediaItemInfo_String", { "MediaItem", "string", "string", "boolean" }, item, k, v, set)
    if k ~= "GUID" then err("GetSetMediaItemInfo_String: parameter " .. k) return false, "" end
    return true, item.guid
  end
  function R.GetTakeNumStretchMarkers(take) check("GetTakeNumStretchMarkers", { "MediaItem_Take" }, take); return take.stretch end
  function R.GetMediaItemTake_Source(take) check("GetMediaItemTake_Source", { "MediaItem_Take" }, take); return take.src end
  function R.GetMediaSourceParent(src) check("GetMediaSourceParent", { "PCM_source" }, src); return src.parent end
  function R.PCM_Source_GetSectionInfo(src)
    check("PCM_Source_GetSectionInfo", { "PCM_source" }, src)
    if not src.section then return false, 0, 0, false end
    return true, src.section.offs, src.section.len, src.section.rev
  end
  function R.GetMediaSourceType(src, buf) check("GetMediaSourceType", { "PCM_source", "?string" }, src, buf); return src.type end
  function R.GetMediaSourceSampleRate(src) check("GetMediaSourceSampleRate", { "PCM_source" }, src); return src.type == "MIDI" and 0 or src.sr end
  function R.GetMediaSourceFileName(src, buf) check("GetMediaSourceFileName", { "PCM_source", "?string" }, src, buf); return src.file end
  function R.GetMediaSourceLength(src) check("GetMediaSourceLength", { "PCM_source" }, src); return src.len, src.qn or false end
  function R.PCM_Source_CreateFromFile(f)
    check("PCM_Source_CreateFromFile", { "string" }, f)
    if not T.exists(f) then return nil end
    -- length of a float WAV written by playhead process: data bytes / (channels * 4) / rate
    local h = io.open(f, "rb")
    local head = h:read(44)
    h:close()
    local ch, sr, bits, size = string.unpack("<I2", head, 23), string.unpack("<I4", head, 25), string.unpack("<I2", head, 35), string.unpack("<I4", head, 41)
    return env.source({ file = f, len = size / (ch * bits / 8) / sr, sr = sr })
  end
  function R.PCM_Source_Destroy(src) check("PCM_Source_Destroy", { "PCM_source" }, src); src.destroyed = true end
  function R.AddTakeToMediaItem(item)
    check("AddTakeToMediaItem", { "MediaItem" }, item)
    local take = { kind = "MediaItem_Take", item = item, offs = 0, rate = 1, name = "", markers = {}, vals = {}, stretch = 0 }
    item.takes[#item.takes + 1] = take
    return take
  end
  function R.SetMediaItemTake_Source(take, src) check("SetMediaItemTake_Source", { "MediaItem_Take", "PCM_source" }, take, src); take.src = src; return true end
  function R.SetActiveTake(take)
    check("SetActiveTake", { "MediaItem_Take" }, take)
    for i, t in ipairs(take.item.takes) do if t == take then take.item.cur = i - 1 end end
  end
  function R.SplitMediaItem(item, pos)
    check("SplitMediaItem", { "MediaItem", "number" }, item, pos)
    if pos <= item.pos or pos >= item.pos + item.len then return nil end
    local right = env.add_item(item.track, { pos = pos, len = item.pos + item.len - pos })
    right.vol, right.loop, right.selected, right.cur = item.vol, item.loop, item.selected, item.cur
    for i, t in ipairs(item.takes) do
      right.takes[i] = { kind = "MediaItem_Take", item = right, src = t.src, offs = t.offs + (pos - item.pos) * t.rate, rate = t.rate, name = t.name,
        midi = t.midi, markers = {}, vals = t.vals, stretch = t.stretch }
    end
    item.len = pos - item.pos
    return right
  end
  function R.UpdateItemInProject(item) check("UpdateItemInProject", { "MediaItem" }, item) end

  -- take markers (source positions, kept in order)
  function R.GetNumTakeMarkers(take) check("GetNumTakeMarkers", { "MediaItem_Take" }, take); return #take.markers end
  function R.GetTakeMarker(take, idx)
    check("GetTakeMarker", { "MediaItem_Take", "integer" }, take, idx)
    local m = take.markers[idx + 1]
    if not m then return -1, "", 0 end
    return m.pos, m.name, m.color or 0
  end
  function R.SetTakeMarker(take, idx, name, pos, color)
    check("SetTakeMarker", { "MediaItem_Take", "integer", "string", "?number", "?integer" }, take, idx, name, pos, color)
    if idx < 0 then
      take.markers[#take.markers + 1] = { pos = pos or 0, name = name, color = color }
      table.sort(take.markers, function(a, b) return a.pos < b.pos end)
      for i, m in ipairs(take.markers) do if m.name == name and m.pos == pos then return i - 1 end end
    end
    local m = take.markers[idx + 1]
    if m then m.name = name; if pos then m.pos = pos end end
    return idx
  end
  function R.DeleteTakeMarker(take, idx) check("DeleteTakeMarker", { "MediaItem_Take", "integer" }, take, idx); return table.remove(take.markers, idx + 1) ~= nil end

  -- project markers and regions (separate numbering, enumerated by position)
  local function sorted_markers() table.sort(env.markers, function(a, b) return a.pos < b.pos end); return env.markers end
  function R.AddProjectMarker2(p, isrgn, pos, rgnend, name, want, color)
    check("AddProjectMarker2", { "ReaProject", "boolean", "number", "number", "string", "integer", "integer" }, p, isrgn, pos, rgnend, name, want, color)
    if isrgn and rgnend <= pos then err("AddProjectMarker2: region ends before it starts") end
    local id
    if isrgn then id = env.next_region; env.next_region = env.next_region + 1 else id = env.next_marker; env.next_marker = env.next_marker + 1 end
    env.markers[#env.markers + 1] = { isrgn = isrgn, pos = pos, rgnend = isrgn and rgnend or pos, name = name, id = id }
    return id
  end
  function R.CountProjectMarkers(p)
    check("CountProjectMarkers", { "ReaProject" }, p)
    local nm, nr = 0, 0
    for _, m in ipairs(env.markers) do if m.isrgn then nr = nr + 1 else nm = nm + 1 end end
    return nm + nr, nm, nr
  end
  function R.EnumProjectMarkers3(p, idx)
    check("EnumProjectMarkers3", { "ReaProject", "integer" }, p, idx)
    local m = sorted_markers()[idx + 1]
    if not m then return 0, false, 0, 0, "", 0, 0 end
    return idx + 1, m.isrgn, m.pos, m.rgnend, m.name, m.id, 0
  end
  function R.DeleteProjectMarker(p, id, isrgn)
    check("DeleteProjectMarker", { "ReaProject", "integer", "boolean" }, p, id, isrgn)
    for i, m in ipairs(env.markers) do if m.id == id and m.isrgn == isrgn then table.remove(env.markers, i) return true end end
    return false
  end

  -- tracks and FX
  function R.GetSelectedTrack(p, i)
    check("GetSelectedTrack", { "ReaProject", "integer" }, p, i)
    local k = 0
    for _, tr in ipairs(env.tracks) do if tr.selected then if k == i then return tr end k = k + 1 end end
    return nil
  end
  function R.TrackFX_GetCount(tr) check("TrackFX_GetCount", { "MediaTrack" }, tr); return #tr.fx end
  function R.TrackFX_GetFXName(tr, fx, buf)
    check("TrackFX_GetFXName", { "MediaTrack", "integer", "?string" }, tr, fx, buf)
    local f = tr.fx[fx + 1]
    if not f then return false, "" end
    return true, f.renamed or f.name
  end
  function R.TrackFX_GetNamedConfigParm(tr, fx, k)
    check("TrackFX_GetNamedConfigParm", { "MediaTrack", "integer", "string" }, tr, fx, k)
    local f = tr.fx[fx + 1]
    if not f then return false, "" end
    if k == "fx_ident" then return true, f.ident end
    if k == "renamed_name" then return true, f.renamed or "" end
    return false, ""
  end
  function R.TrackFX_SetNamedConfigParm(tr, fx, k, v)
    check("TrackFX_SetNamedConfigParm", { "MediaTrack", "integer", "string", "string" }, tr, fx, k, v)
    local f = tr.fx[fx + 1]
    if not f then return false end
    if k == "renamed_name" then f.renamed = v return true end
    return false
  end
  function R.TrackFX_AddByName(tr, name, rec, inst)
    check("TrackFX_AddByName", { "MediaTrack", "string", "boolean", "integer" }, tr, name, rec, inst)
    env.fx_names_tried = env.fx_names_tried or {}
    env.fx_names_tried[#env.fx_names_tried + 1] = name
    if not name:find("Playhead Control", 1, true) or not env.jsfx then return -1 end
    local f = { name = "JS: Playhead Control", ident = env.jsfx, params = jsfx_params(), env = {} }
    local pos = inst <= -1000 and (-1000 - inst) or #tr.fx
    table.insert(tr.fx, pos + 1, f)
    return pos
  end
  local function param(tr, fx, p)
    local f = tr.fx[fx + 1]
    return f and f.params[p + 1]
  end
  function R.TrackFX_GetNumParams(tr, fx) check("TrackFX_GetNumParams", { "MediaTrack", "integer" }, tr, fx); local f = tr.fx[fx + 1]; return f and #f.params or 0 end
  function R.TrackFX_GetParamName(tr, fx, p, buf)
    check("TrackFX_GetParamName", { "MediaTrack", "integer", "integer", "?string" }, tr, fx, p, buf)
    local q = param(tr, fx, p)
    return q ~= nil, q and q.name or ""
  end
  function R.TrackFX_GetParam(tr, fx, p)
    check("TrackFX_GetParam", { "MediaTrack", "integer", "integer" }, tr, fx, p)
    local q = param(tr, fx, p)
    if not q then return 0, 0, 0 end
    return q.value, q.min, q.max
  end
  function R.TrackFX_SetParam(tr, fx, p, v)
    check("TrackFX_SetParam", { "MediaTrack", "integer", "integer", "number" }, tr, fx, p, v)
    local q = param(tr, fx, p)
    if not q then return false end
    q.value = math.max(q.min, math.min(q.max, v))
    return true
  end

  -- envelopes
  function R.GetFXEnvelope(tr, fx, p, create)
    check("GetFXEnvelope", { "MediaTrack", "integer", "integer", "boolean" }, tr, fx, p, create)
    local f = tr.fx[fx + 1]
    if not f or not f.params[p + 1] then return nil end
    if not f.env[p] and create then f.env[p] = { kind = "TrackEnvelope", points = {}, info = {}, param = p } end
    return f.env[p]
  end
  function R.GetEnvelopeScalingMode(e) check("GetEnvelopeScalingMode", { "TrackEnvelope" }, e); return 0 end
  function R.ScaleToEnvelopeMode(m, v) check("ScaleToEnvelopeMode", { "integer", "number" }, m, v); return v end
  function R.CountEnvelopePoints(e) check("CountEnvelopePoints", { "TrackEnvelope" }, e); return #e.points end
  function R.GetEnvelopePoint(e, i)
    check("GetEnvelopePoint", { "TrackEnvelope", "integer" }, e, i)
    local p = e.points[i + 1]
    if not p then return false, 0, 0, 0, 0, false end
    return true, p.time, p.value, p.shape, p.tension, p.selected
  end
  function R.Envelope_Evaluate(e, t, sr, n)
    check("Envelope_Evaluate", { "TrackEnvelope", "number", "number", "integer" }, e, t, sr, n)
    local pts = e.points
    if #pts == 0 then return 0, 0, 0, 0, 0 end
    if t <= pts[1].time then return 1, pts[1].value, 0, 0, 0 end
    for i = 2, #pts do
      if t <= pts[i].time then
        local a, b = pts[i - 1], pts[i]
        local u = b.time > a.time and (t - a.time) / (b.time - a.time) or 1
        return 1, a.value + (b.value - a.value) * u, 0, 0, 0
      end
    end
    return 1, pts[#pts].value, 0, 0, 0
  end
  function R.DeleteEnvelopePointRange(e, a, b)
    check("DeleteEnvelopePointRange", { "TrackEnvelope", "number", "number" }, e, a, b)
    local keep = {}
    for _, p in ipairs(e.points) do if p.time < a or p.time >= b then keep[#keep + 1] = p end end
    e.points = keep
    return true
  end
  function R.InsertEnvelopePoint(e, t, v, shape, tension, sel, nosort)
    check("InsertEnvelopePoint", { "TrackEnvelope", "number", "number", "integer", "number", "boolean", "?boolean" }, e, t, v, shape, tension, sel, nosort)
    e.points[#e.points + 1] = { time = t, value = v, shape = shape, tension = tension, selected = sel }
    e.unsorted = nosort and true or false
    if not nosort then table.sort(e.points, function(a, b) return a.time < b.time end) end
    return true
  end
  function R.Envelope_SortPoints(e)
    check("Envelope_SortPoints", { "TrackEnvelope" }, e)
    table.sort(e.points, function(a, b) return a.time < b.time end)
    e.unsorted = false
    return true
  end
  function R.GetSetEnvelopeInfo_String(e, k, v, set)
    check("GetSetEnvelopeInfo_String", { "TrackEnvelope", "string", "string", "boolean" }, e, k, v, set)
    if set then e.info[k] = v end
    return true, e.info[k] or ""
  end

  env.missing = {}
  setmetatable(R, { __index = function(_, k) env.missing[k] = true; return nil end })

  ----------------------------------------------------------------------------------------------------------------
  -- gfx
  ----------------------------------------------------------------------------------------------------------------
  local G = { w = 0, h = 0, x = 0, y = 0, mouse_x = 0, mouse_y = 0, mouse_cap = 0, mouse_wheel = 0, mouse_hwheel = 0, ext_retina = 0, dest = -1, clear = 0, texth = 12, a = 1 }
  env.gfx_calls = {}
  local function gcount(k) env.gfx_calls[k] = (env.gfx_calls[k] or 0) + 1 end
  function G.init(name, w, h, dock, x, y)
    gcount("init")
    if type(name) ~= "string" then err("gfx.init: name should be a string") end
    -- (an empty name resizes an open window; env.retina: the display's scale, which on Windows does not make the
    -- window larger)
    G.w, G.h = math.floor(w or 0), math.floor(h or 0)
    if G.ext_retina == 1 then G.ext_retina = env.retina or 1 end
    if name ~= "" or not env.window then env.window = name end
    return 1
  end
  function G.quit() gcount("quit"); G.w, G.h = 0, 0; env.window = nil end
  function G.getchar() gcount("getchar"); if not env.window then return -1 end return env.getchar() end
  function G.update() gcount("update") end
  function G.set(r, g, b, a) gcount("set"); if type(r) ~= "number" or (g and type(g) ~= "number") then err("gfx.set: colours should be numbers") end end
  function G.rect(x, y, w, h, f) gcount("rect"); for _, v in ipairs({ x, y, w, h }) do if type(v) ~= "number" or v ~= v then err("gfx.rect: bad argument") end end end
  function G.line(x1, y1, x2, y2, aa) gcount("line"); for _, v in ipairs({ x1, y1, x2, y2 }) do if type(v) ~= "number" or v ~= v then err("gfx.line: bad argument") end end end
  function G.triangle(...) gcount("triangle"); if select("#", ...) < 6 then err("gfx.triangle: fewer than 6 coordinates") end end
  function G.circle(x, y, r, fill, aa) gcount("circle"); for _, v in ipairs({ x, y, r }) do if type(v) ~= "number" or v ~= v then err("gfx.circle: bad argument") end end end
  function G.drawstr(s) gcount("drawstr"); if type(s) ~= "string" then err("gfx.drawstr: not a string: " .. tostring(s)) end; env.texts = env.texts or {}; env.texts[#env.texts + 1] = s
    env.text_boxes = env.text_boxes or {}; env.text_boxes[#env.text_boxes + 1] = { s = s, x = G.x, y = G.y, h = G.texth, w = G.w, wh = G.h } end
  function G.measurestr(s) gcount("measurestr"); return #tostring(s) * 7, 12 end
  function G.setfont(i, face, size) gcount("setfont"); if size and (type(size) ~= "number" or size <= 0) then err("gfx.setfont: bad size") end; if size then G.texth = math.floor(size + 0.5) end end
  function G.setimgdim(i, w, h) gcount("setimgdim"); if type(w) ~= "number" or type(h) ~= "number" then err("gfx.setimgdim: bad size") end end
  function G.blit(src, scale, rot) gcount("blit"); if type(src) ~= "number" or type(scale) ~= "number" then err("gfx.blit: bad arguments") end end
  function G.dock(v, ...) gcount("dock"); return env.dock or 0, 100, 100, 900, 200 end
  function G.showmenu(s)
    gcount("showmenu")
    env.menus[#env.menus + 1] = s
    local c = env.menu_choice
    if type(c) == "function" then return c(s) end
    return c or 0
  end

  env.reaper, env.gfx = R, G

  --- Runs the deferred functions until none is left (or seconds pass); on_tick(i) runs before each round.
  function env.run_deferred(seconds, on_tick)
    local t0, i = T.now(), 0
    while #env.deferred > 0 do
      i = i + 1
      if on_tick then on_tick(i) end
      local list = env.deferred
      env.deferred = {}
      for _, f in ipairs(list) do
        local ok, e = xpcall(f, debug.traceback)
        if not ok then err("error in a deferred function: " .. tostring(e)) end
      end
      if T.now() - t0 > (seconds or 60) then err("deferred functions still running after " .. (seconds or 60) .. " s") break end
      T.sleep(0.005)
    end
    for _, f in ipairs(env.atexits) do local ok, e = pcall(f); if not ok then err("error in atexit: " .. tostring(e)) end end
    env.atexits = {}
    return i
  end

  --- Loads and runs an action script as REAPER does (fresh modules, globals reaper and gfx).
  function env.run_script(path, seconds, on_tick)
    package.loaded.playhead_core, package.loaded.playhead_reaper = nil, nil
    _G.reaper, _G.gfx = R, G
    env.script = path
    local chunk, lerr = loadfile(path)
    if not chunk then err("syntax: " .. tostring(lerr)) return false end
    local ok, e = xpcall(chunk, debug.traceback)
    if not ok then err("error running " .. path .. ": " .. tostring(e)) end
    env.run_deferred(seconds, on_tick)
    if env.undo_depth ~= 0 then err("undo blocks not balanced (" .. env.undo_depth .. ")") end
    if env.refresh ~= 0 then err("PreventUIRefresh not balanced (" .. env.refresh .. ")") end
    return ok
  end
  return env
end

return Mock
