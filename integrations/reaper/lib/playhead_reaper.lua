-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
-- @noindex
--
-- Playhead for REAPER: the REAPER layer. Settings, finding and checking the Playhead command line, the analysis
-- cache, runs that do not block REAPER (a job script started with ExecProcess, polled with defer), a small progress
-- window, takes and their time mapping, the Playhead Control effect and its envelopes, and messages.
-- Everything that can be done without REAPER lives in playhead_core.lua.

local core = require("playhead_core")
local R = { core = core }
local fmt = string.format

R.SECTION = core.SETTINGS_SECTION
R.TITLE = "Playhead"
R.CONTROL_NAME = "Playhead Control"
-- the path relative to the Effects folder (the form ReaTeam scripts use) first, then the effect's name, which REAPER
-- 6.70 and later also find where ReaPack installed it (Effects/<repository>/<category>/)
R.CONTROL_FX_NAMES = { "Playhead/Playhead Control.jsfx", "JS:Playhead Control", "JS: Playhead Control", "Playhead Control",
  "JS:Playhead/Playhead Control.jsfx", "JS:Playhead Control.jsfx" }

local function api(name) return reaper[name] ~= nil and (not reaper.APIExists or reaper.APIExists(name) or type(reaper[name]) == "function") end
R.api = api

------------------------------------------------------------------------------------------------------------------------
-- environment and files
------------------------------------------------------------------------------------------------------------------------
R.os = core.os_kind(reaper.GetOS())
R.sep = core.path_sep(R.os)
function R.join(...) return core.path_join(R.os, ...) end
R.resource = reaper.GetResourcePath()
R.data_dir = R.join(R.resource, "Data", "Playhead")
R.cache_dir = R.join(R.data_dir, "cache")

function R.mkdir(dir) if dir and dir ~= "" then reaper.RecursiveCreateDirectory(dir, 0) end end
function R.exists(p) return p ~= nil and p ~= "" and reaper.file_exists(p) end
function R.read_file(p)
  local f = io.open(p, "rb")
  if not f then return nil end
  local s = f:read("a")
  f:close()
  return s
end
function R.write_file(p, text)
  local f, err = io.open(p, "wb")
  if not f then return nil, err end
  f:write(text)
  f:close()
  return true
end
function R.file_size(p)
  local f = io.open(p, "rb")
  if not f then return nil end
  local n = f:seek("end")
  f:close()
  return n
end
function R.remove(p) if p and p ~= "" then os.remove(p) end end
--- Moves a file, replacing the target; copies when a rename is not possible (another drive).
function R.move(src, dst)
  if R.exists(dst) then os.remove(dst) end
  if os.rename(src, dst) then return true end
  local fi = io.open(src, "rb")
  if not fi then return nil, "cannot read " .. src end
  local fo, err = io.open(dst, "wb")
  if not fo then fi:close(); return nil, "cannot write " .. dst .. " (" .. tostring(err) .. ")" end
  while true do
    local chunk = fi:read(1 << 20)
    if not chunk then break end
    fo:write(chunk)
  end
  fi:close(); fo:close()
  os.remove(src)
  return true
end
function R.list_files(dir)
  local out, i = {}, 0
  if not reaper.EnumerateFiles then return out end
  reaper.EnumerateFiles(dir, -1)
  while true do
    local f = reaper.EnumerateFiles(dir, i)
    if not f then break end
    out[#out + 1] = f
    i = i + 1
  end
  return out
end

--- The folder for job scripts: under REAPER's resource path unless that path has characters the command REAPER
--- starts cannot carry; then the system's temporary folder.
local jobs_dir_cache
function R.jobs_dir()
  if jobs_dir_cache then return jobs_dir_cache end
  local candidates = { R.join(R.data_dir, "jobs") }
  local tmp = os.getenv("TEMP") or os.getenv("TMP") or os.getenv("TMPDIR") or (R.os ~= "windows" and "/tmp" or nil)
  if tmp then candidates[#candidates + 1] = R.join(tmp, "playhead-reaper-jobs") end
  for _, d in ipairs(candidates) do
    if core.safe_script_path(d, R.os) then
      R.mkdir(d)
      jobs_dir_cache = d
      return d
    end
  end
  jobs_dir_cache = candidates[1]
  R.mkdir(jobs_dir_cache)
  return jobs_dir_cache
end

------------------------------------------------------------------------------------------------------------------------
-- settings (ExtState section "Playhead", kept between sessions)
------------------------------------------------------------------------------------------------------------------------
function R.get(key, default)
  local v = reaper.GetExtState(R.SECTION, key)
  if v == nil or v == "" then
    if default ~= nil then return default end
    return core.DEFAULTS[key] or ""
  end
  return v
end
function R.set(key, value)
  local text = tostring(value or ""):gsub("[\r\n]", " ")   -- ExtState values may not contain line breaks
  reaper.SetExtState(R.SECTION, key, text, true)
end
function R.settings()
  local s = {}
  for k, v in pairs(core.DEFAULTS) do s[k] = R.get(k, v) end
  if not core.PROFILES[s.profile] then s.profile = "auto" end
  s.timeout = math.max(10, tonumber(s.timeout) or 600)
  return s
end
--- A value remembered as JSON (choices in dialogs).
function R.get_json(key, default)
  local v = reaper.GetExtState(R.SECTION, key)
  if v == nil or v == "" then return default end
  local ok, t = pcall(core.json_decode, v)
  if ok and t ~= nil then return t end
  return default
end
function R.set_json(key, value) R.set(key, core.json_encode(value)) end

------------------------------------------------------------------------------------------------------------------------
-- messages
------------------------------------------------------------------------------------------------------------------------
function R.log(...)
  local parts = {}
  for i = 1, select("#", ...) do parts[#parts + 1] = tostring(select(i, ...)) end
  reaper.ShowConsoleMsg(table.concat(parts, " ") .. "\n")
end
function R.message(text, title) reaper.ShowMessageBox(tostring(text), title or R.TITLE, 0) end
function R.ask(text, title) return reaper.ShowMessageBox(tostring(text), title or R.TITLE, 4) == 6 end
function R.ask_cancel(text, title) return reaper.ShowMessageBox(tostring(text), title or R.TITLE, 1) == 1 end

--- A dialog of fields { caption, default } (GetUserInputs). Returns the answers, or nil when cancelled. With more
--- than one field, answers may not contain commas (the dialog separates them with commas); the dialog is shown
--- again if one does. A single field may contain commas.
function R.dialog(title, fields, extrawidth)
  local caps, vals = core.dialog_csv(fields, extrawidth)
  while true do
    local ok, csv = reaper.GetUserInputs(title, #fields, caps, vals)
    if not ok then return nil end
    if #fields == 1 then return { csv } end
    local v = core.dialog_values(csv, #fields)
    if v then return v end
    R.message("Please do not type commas in these fields (the dialog uses them to separate the fields).")
    vals = csv:gsub(",", " ")
    local parts = core.split(csv, ",")
    if #parts > #fields then
      local merged = {}
      for i = 1, #fields - 1 do merged[i] = parts[i] end
      merged[#fields] = table.concat(parts, " ", #fields)
      vals = table.concat(merged, ",")
    end
  end
end

--- A popup menu (gfx.showmenu) at the mouse. When no gfx window is open, a tiny one is opened for it. Returns the
--- chosen item's number (1-based, counting only selectable items) or 0.
function R.menu(items)
  local own = (gfx.w or 0) == 0 and (gfx.h or 0) == 0
  if own then
    local x, y = 200, 200
    if reaper.GetMousePosition then x, y = reaper.GetMousePosition() end
    gfx.init("Playhead", 0, 0, 0, x, y)
    gfx.x, gfx.y = 0, 0
  else
    gfx.x, gfx.y = gfx.mouse_x or 0, gfx.mouse_y or 0
  end
  local choice = gfx.showmenu(items)
  if own then gfx.quit() end
  return choice or 0
end
--- Text safe for a menu item (no separators, no leading control characters).
function R.menu_text(s) return (tostring(s):gsub("|", "/"):gsub("^[!#<>]+", "")) end

--- A flat menu from entries { label, checked, disabled, value } and { separator = true }. Returns the string for
--- gfx.showmenu and the entries by the number showmenu returns (separators are not counted, greyed items are).
function R.build_menu(entries)
  local parts, by_number = {}, {}
  for _, e in ipairs(entries) do
    if e.separator then parts[#parts + 1] = ""
    else
      parts[#parts + 1] = (e.disabled and "#" or "") .. (e.checked and "!" or "") .. R.menu_text(e.label)
      by_number[#by_number + 1] = e
    end
  end
  return table.concat(parts, "|"), by_number
end

--- The project's media folder (where REAPER records), with a folder for Playhead's rendered files.
function R.render_dir()
  local media = ""
  if reaper.GetProjectPathEx then media = reaper.GetProjectPathEx(0, "") or "" end
  if media == "" and reaper.GetProjectPath then media = reaper.GetProjectPath("") or "" end
  if media == "" then media = R.join(R.data_dir, "renders") end
  return R.join(media, "Playhead")
end

--- Removes an empty folder (os.remove does not on Windows; cmd's rmdir is used there).
function R.remove_empty_dir(dir)
  if os.remove(dir) then return true end
  if R.os == "windows" and core.safe_script_path(dir, "windows") then
    reaper.ExecProcess('cmd.exe /D /C rmdir "' .. dir .. '"', 5000)
  end
end

--- A file name in dir that is not taken yet: name.ext, name_2.ext, name_3.ext, ...
function R.unique_path(dir, name)
  local stem, ext = name:match("^(.*)(%.[^.]+)$")
  if not stem then stem, ext = name, "" end
  local p = R.join(dir, name)
  local k = 2
  while R.exists(p) do p = R.join(dir, stem .. "_" .. k .. ext); k = k + 1 end
  return p
end

------------------------------------------------------------------------------------------------------------------------
-- undo
------------------------------------------------------------------------------------------------------------------------
--- Runs fn inside one undo block with the UI refresh held; errors are reported and the block is still closed.
function R.undoable(description, fn)
  reaper.PreventUIRefresh(1)
  reaper.Undo_BeginBlock()
  local ok, err = xpcall(fn, debug.traceback)
  reaper.Undo_EndBlock(description, -1)
  reaper.PreventUIRefresh(-1)
  reaper.UpdateArrange()
  if reaper.UpdateTimeline then reaper.UpdateTimeline() end
  if not ok then R.message("Something went wrong: " .. tostring(err):match("^[^\n]*") .. "\n\nDetails are in the ReaScript console."); R.log(err) end
  return ok
end

------------------------------------------------------------------------------------------------------------------------
-- jobs: Playhead runs that do not block REAPER
--
-- A job is a script (sh or batch, see core.job_script) that runs the command line with its output sent to files and
-- writes its exit code last. ExecProcess starts it without waiting (-1; -2 minimises the console on Windows), and
-- R.poll() checks for the status file. Blocking runs use the same script with ExecProcess waiting up to a timeout.
------------------------------------------------------------------------------------------------------------------------
local job_counter = 0
local function new_job_id()
  job_counter = job_counter + 1
  local frac = math.floor(((reaper.time_precise and reaper.time_precise() or os.clock()) % 1) * 1e6)
  return fmt("%d-%06d-%d-%04d", os.time(), frac, job_counter, math.random(0, 9999))
end

--- Deletes job files, and unfinished analyses in the cache, left over from runs over a day old.
function R.clean_jobs()
  local dir = R.jobs_dir()
  local now = os.time()
  for _, f in ipairs(R.list_files(dir)) do
    local t = tonumber(f:match("^(%d+)%-"))
    if t and now - t > 86400 then os.remove(R.join(dir, f)) end
  end
  for _, f in ipairs(R.list_files(R.cache_dir)) do
    local t = tonumber(f:match("%.part%-(%d+)%-"))
    if t and now - t > 86400 then os.remove(R.join(R.cache_dir, f)) end
  end
end

local function job_files(id)
  local dir = R.jobs_dir()
  local base = R.join(dir, id)
  return {
    script = base .. (R.os == "windows" and ".bat" or ".sh"),
    stdout = base .. ".out", stderr = base .. ".err", status = base .. ".status"
  }
end

--- Starts a job. spec: argv (full command), label, timeout (s), move_from, move_to, estimate (s), extra_path.
--- Returns the job, or nil and a message.
function R.start_job(spec)
  local id = new_job_id()
  local files = job_files(id)
  local ok, text = pcall(core.job_script, {
    os = R.os, argv = spec.argv, stdout = files.stdout, stderr = files.stderr, status = files.status,
    move_from = spec.move_from, move_to = spec.move_to, path_extra = spec.extra_path
  })
  if not ok then return nil, "the command could not be prepared: " .. tostring(text) end
  local wrote, err = R.write_file(files.script, text)
  if not wrote then return nil, "the job file could not be written in " .. R.jobs_dir() .. " (" .. tostring(err) .. ")" end
  local cmd = core.exec_command(files.script, R.os)
  local job = { id = id, spec = spec, files = files, started = reaper.time_precise(), label = spec.label or "Playhead",
    timeout = spec.timeout or 600, estimate = spec.estimate or 2 }
  if spec.blocking then
    reaper.ExecProcess(cmd, math.floor(job.timeout * 1000))
    return job
  end
  local r = reaper.ExecProcess(cmd, R.os == "windows" and -2 or -1)
  if r == nil and R.os ~= "windows" then
    -- nil means "total failure" (the shell did not start); give it a moment in case the status appears anyway
    job.start_failed = true
  end
  return job
end

local function finish(job, result)
  result.elapsed = reaper.time_precise() - job.started
  result.stdout = R.read_file(job.files.stdout) or ""
  result.stderr = R.read_file(job.files.stderr) or ""
  job.result = result
  for _, k in ipairs({ "script", "stdout", "stderr", "status" }) do R.remove(job.files[k]) end
  R.remove(job.files.status .. ".tmp")
  return result
end

--- Checks a job. Returns its result once finished ({ ok, code, stdout, stderr, elapsed, timed_out }), else nil.
function R.poll(job)
  if job.result then return job.result end
  if R.exists(job.files.status) then
    local code = tonumber((R.read_file(job.files.status) or ""):match("%-?%d+"))
    return finish(job, { ok = code == 0, code = code or -1 })
  end
  local elapsed = reaper.time_precise() - job.started
  if job.start_failed and elapsed > 5 then return finish(job, { ok = false, code = -1, start_failed = true }) end
  if elapsed > job.timeout then return finish(job, { ok = false, code = -1, timed_out = true }) end
  return nil
end

--- Stops waiting for a job (the process itself cannot be stopped from a script and may still finish; an analysis
--- that finishes later still lands in the cache).
function R.abandon(job)
  if not job.result then job.result = { ok = false, code = -1, cancelled = true, stdout = "", stderr = "" } end
end

--- Runs a command and waits for it (for quick commands: version, tools). Returns the result.
function R.run_blocking(argv, timeout, extra_path)
  local job, err = R.start_job({ argv = argv, timeout = timeout or 30, blocking = true, extra_path = extra_path })
  if not job then return { ok = false, code = -1, stdout = "", stderr = err or "" } end
  local res = R.poll(job)
  if not res then
    R.abandon(job)
    res = finish(job, { ok = false, code = -1, timed_out = true })
  end
  return res
end

------------------------------------------------------------------------------------------------------------------------
-- the Playhead command line: discovery and check
------------------------------------------------------------------------------------------------------------------------
local function exe_names()
  if R.os == "windows" then return { "playhead.exe" } end
  return { "playhead" }
end

--- Finds the command line: the path in the settings, then <resource>/Scripts/Playhead/playhead[.exe] (or
--- playhead-cli.cjs there, run with Node), then the PATH. Returns path, or nil and the places looked at.
function R.find_executable(settings)
  settings = settings or R.settings()
  local tried = {}
  if settings.exe ~= "" then
    if R.exists(settings.exe) then return settings.exe end
    return nil, { settings.exe .. " (from Playhead - Settings; not found)" }
  end
  local own = R.join(R.resource, "Scripts", "Playhead")
  for _, n in ipairs(exe_names()) do
    local p = R.join(own, n)
    tried[#tried + 1] = p
    if R.exists(p) then return p end
  end
  local cjs = R.join(own, "playhead-cli.cjs")
  tried[#tried + 1] = cjs
  if R.exists(cjs) then return cjs end
  local path_sep = R.os == "windows" and ";" or ":"
  local dirs = {}
  for d in (os.getenv("PATH") or ""):gmatch("[^" .. path_sep .. "]+") do dirs[#dirs + 1] = d end
  for _, d in ipairs(core.extra_path_dirs(settings.extra_path, R.os)) do dirs[#dirs + 1] = d end
  for _, d in ipairs(dirs) do
    for _, n in ipairs(exe_names()) do
      local p = R.join(d:gsub('^"', ""):gsub('"$', ""), n)
      if R.exists(p) then return p end
    end
  end
  tried[#tried + 1] = "the folders on the PATH"
  return nil, tried
end

local function not_found_message(tried)
  return "The Playhead command line was not found.\n\nLooked for:\n  " .. table.concat(tried or {}, "\n  ") ..
    "\n\nDownload the executable for your system from the Playhead releases on GitHub and put it in\n  " ..
    R.join(R.resource, "Scripts", "Playhead") ..
    "\nor choose it (or tools/playhead-cli.js from a Playhead checkout, run with Node) in Playhead - Settings."
end

--- The command line, checked once per session with `playhead version`. Returns cli { exe, version, argv(args),
--- extra_path, settings }, or nil and a message for the user.
function R.cli(settings, force_check)
  settings = settings or R.settings()
  local exe, tried = R.find_executable(settings)
  if not exe then return nil, not_found_message(tried) end
  local extra = core.extra_path_dirs(settings.extra_path, R.os)
  local cli = { exe = exe, settings = settings, extra_path = extra }
  function cli.argv(args) return core.cli_argv(exe, settings.node, args) end
  local key = exe .. "|" .. settings.node
  if not force_check and reaper.GetExtState(R.SECTION, "checked_exe") == key then
    cli.version = reaper.GetExtState(R.SECTION, "checked_version")
    if cli.version ~= "" then return cli end
  end
  local res = R.run_blocking(cli.argv({ "version" }), 30, extra)
  local version = core.trim(res.stdout):match("^(%d+%.%d+[%w%.%-]*)")
  if not res.ok or not version then
    local why
    if res.timed_out then why = "It did not answer within 30 s."
    else why = core.explain_failure(res.code, res.stderr ~= "" and res.stderr or res.stdout, { exe = exe, os = R.os }) end
    return nil, "The Playhead command line did not work:\n  " .. table.concat(cli.argv({ "version" }), " ") .. "\n\n" .. why
  end
  cli.version = version
  reaper.SetExtState(R.SECTION, "checked_exe", key, false)
  reaper.SetExtState(R.SECTION, "checked_version", version, false)
  return cli
end

--- As R.cli, but tells the user what is wrong. Returns cli or nil.
function R.require_cli(settings)
  local cli, err = R.cli(settings)
  if not cli then R.message(err) end
  return cli
end

--- The processing tools (`playhead tools`), cached per Playhead version.
function R.tools(cli)
  R.mkdir(R.cache_dir)
  local path = R.join(R.cache_dir, "tools-" .. core.safe_name(cli.version, 20) .. "-" .. core.fnv1a64(cli.exe):sub(1, 8) .. ".json")
  local text = R.read_file(path)
  local list = text and core.parse_tools(text)
  if list then return list end
  local res = R.run_blocking(cli.argv({ "tools" }), 60, cli.extra_path)
  if not res.ok then return nil, core.explain_failure(res.code, res.stderr, { exe = cli.exe, os = R.os }) end
  local parsed, err = core.parse_tools(res.stdout)
  if not parsed then return nil, err end
  R.write_file(path, res.stdout)
  return parsed
end

------------------------------------------------------------------------------------------------------------------------
-- items and takes
------------------------------------------------------------------------------------------------------------------------
function R.selected_items()
  local out = {}
  for i = 0, reaper.CountSelectedMediaItems(0) - 1 do out[#out + 1] = reaper.GetSelectedMediaItem(0, i) end
  return out
end

local function take_name(take)
  local ok, name = reaper.GetSetMediaItemTakeInfo_String(take, "P_NAME", "", false)
  return ok and name or ""
end
R.take_name = take_name

--- Everything about an item's active take that the analysis needs: its file and the time mapping.
--- Returns info { item, take, track, file, size, file_len, map, name, warnings }, or nil and a message.
function R.take_info(item)
  if not item then return nil, "no item" end
  local take = reaper.GetActiveTake(item)
  if not take then return nil, "the item is empty (it has no take)" end
  local name = take_name(take)
  if reaper.TakeIsMIDI and reaper.TakeIsMIDI(take) then return nil, "\"" .. name .. "\" is a MIDI item; Playhead analyses audio" end
  local src = reaper.GetMediaItemTake_Source(take)
  if not src then return nil, "\"" .. name .. "\" has no source" end
  local sections, s = {}, src
  for _ = 1, 16 do
    local parent = reaper.GetMediaSourceParent(s)
    if not parent then break end
    local ok, offs, len, rev = reaper.PCM_Source_GetSectionInfo(s)
    if ok then sections[#sections + 1] = { offs = offs or 0, len = len or 0, rev = rev and true or false } end
    s = parent
  end
  local root = s
  local stype = reaper.GetMediaSourceType(root, "") or ""
  if stype:upper():find("MIDI") or (reaper.GetMediaSourceSampleRate and reaper.GetMediaSourceSampleRate(root) == 0) then
    return nil, "\"" .. name .. "\" is a MIDI item; Playhead analyses audio"
  end
  local file = reaper.GetMediaSourceFileName(root, "") or ""
  if file == "" then return nil, "\"" .. name .. "\" has no audio file on disk (for example a generated or in-project source)" end
  if not R.exists(file) then return nil, "the file of \"" .. name .. "\" was not found (offline media): " .. file end
  local src_len, is_qn = reaper.GetMediaSourceLength(src)
  if is_qn then return nil, "\"" .. name .. "\" has a beat-based source, which Playhead cannot map to time" end
  local file_len = reaper.GetMediaSourceLength(root)
  local warnings = {}
  if reaper.GetTakeNumStretchMarkers and reaper.GetTakeNumStretchMarkers(take) > 0 then
    warnings[#warnings + 1] = "\"" .. name .. "\" has stretch markers; Playhead follows only the take's start offset and playback rate"
  end
  local m = core.take_map({
    pos = reaper.GetMediaItemInfo_Value(item, "D_POSITION"), len = reaper.GetMediaItemInfo_Value(item, "D_LENGTH"),
    offs = reaper.GetMediaItemTakeInfo_Value(take, "D_STARTOFFS"), rate = reaper.GetMediaItemTakeInfo_Value(take, "D_PLAYRATE"),
    loop = reaper.GetMediaItemInfo_Value(item, "B_LOOPSRC") ~= 0, src_len = src_len, sections = sections, file_len = file_len
  })
  return { item = item, take = take, track = reaper.GetMediaItem_Track(item), file = file, size = R.file_size(file) or 0,
    file_len = file_len, map = m, name = name ~= "" and name or core.basename(file), warnings = warnings, source = src }
end

--- A short signature of what the strip window shows for an item (redraw when it changes).
function R.take_signature(info)
  local m = info.map
  local secs = {}
  for _, s in ipairs(m.sections) do secs[#secs + 1] = fmt("%.6f/%.6f/%s", s.offs, s.len, tostring(s.rev)) end
  return table.concat({ info.file, fmt("%.6f", m.pos), fmt("%.6f", m.len), fmt("%.6f", m.offs), fmt("%.6f", m.rate),
    tostring(m.loop), fmt("%.6f", m.src_len or 0), table.concat(secs, ";") }, "|")
end

function R.item_guid(item)
  local ok, g = reaper.GetSetMediaItemInfo_String(item, "GUID", "", false)
  return ok and g or tostring(item)
end

------------------------------------------------------------------------------------------------------------------------
-- analysis documents and the cache (<resource>/Data/Playhead/cache, keyed by file path, size and length)
------------------------------------------------------------------------------------------------------------------------
local doc_memory = {}

function R.profile_for(settings) return settings.profile or "auto" end

function R.cache_path(info, cli, profile)
  local key = core.cache_key({ path = info.file, size = info.size, length = info.file_len, profile = profile,
    version = cli and cli.version or "", os = R.os })
  return R.join(R.cache_dir, key .. ".json")
end

--- The cached document for a take, or nil. A cache file that cannot be read is deleted.
function R.cached_document(info, cli, profile)
  local path = R.cache_path(info, cli, profile)
  local mem = doc_memory[path]
  if mem then return mem end
  if not R.exists(path) then return nil end
  local doc, err = core.load_document(R.read_file(path) or "")
  if not doc then os.remove(path); return nil, err end
  doc_memory[path] = doc
  return doc
end
function R.forget_document(info, cli, profile)
  local path = R.cache_path(info, cli, profile)
  doc_memory[path] = nil
  os.remove(path)
end

--- A job spec that analyses a take's file into the cache.
function R.analysis_spec(info, cli, profile)
  R.mkdir(R.cache_dir)
  local final = R.cache_path(info, cli, profile)
  local part = final .. ".part-" .. new_job_id()
  return {
    argv = cli.argv({ "analyze", info.file, "--profile", profile, "--out", part }),
    move_from = part, move_to = final, extra_path = cli.extra_path, timeout = cli.settings.timeout,
    label = "Analysing " .. core.basename(info.file), estimate = core.estimate_seconds(info.file_len, profile, "analyze"),
    file = info.file, cache = final, kind = "analyze"
  }
end

--- After an analysis job: the document, or nil and a message.
function R.analysis_result(spec, res)
  if res.cancelled then return nil, "stopped waiting" end
  if res.timed_out then
    return nil, fmt("Playhead did not finish within %d s (%s). Long files may need a longer timeout in Playhead - Settings.",
      math.floor(spec.timeout or 0), core.basename(spec.file))
  end
  if not res.ok then
    R.remove(spec.move_from)
    return nil, core.explain_failure(res.code, res.stderr, { file = spec.file, os = R.os, exe = spec.argv[1] })
  end
  local doc, err = core.load_document(R.read_file(spec.cache) or "")
  if not doc then os.remove(spec.cache); return nil, err end
  doc_memory[spec.cache] = doc
  return doc
end

------------------------------------------------------------------------------------------------------------------------
-- a queue of jobs with a small progress window
------------------------------------------------------------------------------------------------------------------------
local function theme_rgb(key)
  if not reaper.GetThemeColor then return nil end
  local ok, c = pcall(reaper.GetThemeColor, key, 0)
  if not ok or not c or c < 0 then return nil end
  local r, g, b = reaper.ColorFromNative(c)
  return { r, g, b }
end
R.theme_rgb = theme_rgb

--- Colours of the current REAPER theme for Playhead's windows: background, text, waveform, cursors.
function R.theme_colours()
  local bg = theme_rgb("col_main_bg2") or theme_rgb("col_arrangebg") or { 51, 51, 51 }
  local text = theme_rgb("col_main_text2") or theme_rgb("col_main_text")
  if text and math.abs(core.luminance(text) - core.luminance(bg)) < 0.25 then text = nil end
  return {
    background = bg, text = text, wave = theme_rgb("col_tr1_peaks"),
    edit_cursor = theme_rgb("col_cursor") or { 220, 60, 60 }, play_cursor = theme_rgb("playcursor_color") or { 230, 230, 230 }
  }
end

local function set_colour(c, a) gfx.set(c[1] / 255, c[2] / 255, c[3] / 255, a or 1) end
R.set_colour = set_colour

--- The strip renderer's sink (see core.render_strip) drawing with gfx at offset ox, oy; text sizes times text_scale.
function R.gfx_sink(ox, oy, text_scale)
  ox, oy, text_scale = ox or 0, oy or 0, text_scale or 1
  local floor, max = math.floor, math.max
  local s = {}
  function s.rect(x, y, w, h, c, a)
    set_colour(c, a)
    local y0, y1 = floor(y + 0.5), floor(y + max(1, h) + 0.5)
    gfx.rect(ox + floor(x + 0.5), oy + y0, max(1, floor(w + 0.5)), max(1, y1 - y0), 1)
  end
  function s.line(x1, y1, x2, y2, c, a) set_colour(c, a); gfx.line(ox + x1, oy + y1, ox + x2, oy + y2, 0) end
  function s.polyline(xs, ys, c, a, width)
    set_colour(c, a)
    local w = max(1, floor((width or 1) + 0.5))
    if #xs == 1 then gfx.rect(ox + floor(xs[1]), oy + floor(ys[1]), 1, w, 1) return end
    for k = 0, w - 1 do
      local d = k - (w - 1) / 2
      for i = 2, #xs do gfx.line(ox + xs[i - 1], oy + ys[i - 1] + d, ox + xs[i], oy + ys[i] + d, 1) end
    end
  end
  function s.triangle(x1, y1, x2, y2, x3, y3, c, a)
    set_colour(c, a)
    gfx.triangle(ox + x1, oy + y1, ox + x2, oy + y2, ox + x3, oy + y3)
  end
  function s.dashed(x, y1, y2, c, a)
    set_colour(c, a)
    local y = y1
    while y < y2 do gfx.line(ox + x, oy + y, ox + x, oy + math.min(y2, y + 1), 0); y = y + 5 end
  end
  function s.text(x, y, str, c, a, size, align, valign)
    set_colour(c, a)
    gfx.setfont(2, "Arial", math.max(6, floor(size * text_scale + 0.5)))
    local w, h = gfx.measurestr(str)
    gfx.x = ox + (align == "right" and (x - w) or x)
    gfx.y = oy + (valign == "middle" and (y - h / 2) or valign == "top" and y or (y - h * 0.8))
    gfx.drawstr(str)
  end
  function s.circle(x, y, r, c, a)
    set_colour(c, a)
    gfx.circle(ox + x, oy + y, r, 1, 1)
  end
  return s
end

--- Runs job specs one after another with a progress window. Closing the window stops waiting.
--- opts: title, on_each(spec, result) (optional), on_done(results, cancelled) (results in the order of specs).
function R.run_queue(specs, opts)
  opts = opts or {}
  local results, index, job = {}, 0, nil
  local cancelled = false
  if #specs == 0 then if opts.on_done then opts.on_done(results, false) end return end
  local mx, my = 300, 300
  if reaper.GetMousePosition then mx, my = reaper.GetMousePosition() end
  gfx.ext_retina = 1
  gfx.init(opts.title or "Playhead", 440, 110, 0, math.max(0, mx - 220), math.max(0, my - 55))
  gfx.clear = -1
  local colours = R.theme_colours()
  local th = core.theme_for(colours.background, { text = colours.text })
  local last_draw = 0
  local function draw(spec, elapsed)
    local s = math.max(1, gfx.ext_retina or 1)
    set_colour(th.background); gfx.rect(0, 0, gfx.w, gfx.h, 1)
    gfx.setfont(1, "Arial", 15 * s)
    set_colour(th.text)
    gfx.x, gfx.y = 14 * s, 12 * s
    gfx.drawstr(fmt("%s (%d of %d)", spec.label or "Working", index, #specs))
    local frac = math.min(0.97, elapsed / math.max(0.5, spec.estimate or 2))
    local bx, by, bw, bh = 14 * s, 42 * s, gfx.w - 28 * s, 10 * s
    set_colour(th.rule, 0.35); gfx.rect(bx, by, bw, bh, 1)
    set_colour(th.line); gfx.rect(bx, by, math.floor(bw * frac), bh, 1)
    gfx.setfont(1, "Arial", 13 * s)
    set_colour(th.text, 0.8)
    gfx.x, gfx.y = 14 * s, 64 * s
    gfx.drawstr(fmt("%.1f s (usually about %.0f s). Close this window to stop waiting.", elapsed, math.max(1, spec.estimate or 2)))
    gfx.update()
  end
  local function done()
    gfx.quit()
    if opts.on_done then opts.on_done(results, cancelled) end
  end
  local function step()
    local ch = gfx.getchar()
    if ch < 0 or ch == 27 then
      cancelled = true
      if job then R.abandon(job) end
      for i = index, #specs do if not results[i] then results[i] = { ok = false, cancelled = true, stdout = "", stderr = "" } end end
      return done()
    end
    if not job then
      index = index + 1
      if index > #specs then return done() end
      local err
      job, err = R.start_job(specs[index])
      if not job then
        results[index] = { ok = false, code = -1, stdout = "", stderr = err or "", start_failed = true }
        if opts.on_each then opts.on_each(specs[index], results[index]) end
        job = nil
        return reaper.defer(step)
      end
    end
    local res = R.poll(job)
    if res then
      results[index] = res
      if opts.on_each then opts.on_each(specs[index], res) end
      job = nil
    end
    local now = reaper.time_precise()
    if job and now - last_draw > 0.1 then last_draw = now; draw(specs[index], now - job.started) end
    reaper.defer(step)
  end
  R.clean_jobs()
  reaper.defer(step)
end

--- Makes sure every take has an analysis document, analysing what is not cached (unless every take is cached),
--- then calls on_ready(entries, problems): entries { info, doc } for the takes that have one, problems a list of
--- messages. opts: force (analyse again), title.
function R.with_documents(items, cli, opts, on_ready)
  opts = opts or {}
  local profile = R.profile_for(cli.settings)
  local entries, problems, todo, by_file = {}, {}, {}, {}
  for _, item in ipairs(items) do
    local info, err = R.take_info(item)
    if not info then problems[#problems + 1] = err
    else
      for _, w in ipairs(info.warnings) do problems[#problems + 1] = w end
      local doc = (not opts.force) and R.cached_document(info, cli, profile) or nil
      local e = { info = info, doc = doc }
      entries[#entries + 1] = e
      if not doc then
        local key = R.cache_path(info, cli, profile)
        if not by_file[key] then by_file[key] = { spec = R.analysis_spec(info, cli, profile), entries = {} }; todo[#todo + 1] = by_file[key] end
        table.insert(by_file[key].entries, e)
      end
    end
  end
  if #todo == 0 then
    local ready = {}
    for _, e in ipairs(entries) do if e.doc then ready[#ready + 1] = e end end
    return on_ready(ready, problems)
  end
  local specs = {}
  for i, t in ipairs(todo) do specs[i] = t.spec end
  R.run_queue(specs, { title = opts.title or "Playhead: analysing", on_done = function(results, cancelled)
    for i, t in ipairs(todo) do
      local res = results[i] or { ok = false, cancelled = true }
      local doc, err = R.analysis_result(t.spec, res)
      for _, e in ipairs(t.entries) do e.doc = doc end
      if not doc and not res.cancelled then problems[#problems + 1] = core.basename(t.spec.file) .. ": " .. tostring(err) end
    end
    if cancelled then problems[#problems + 1] = "Stopped waiting for the analysis. A run that is still going will finish in the background and be used next time." end
    local ready = {}
    for _, e in ipairs(entries) do if e.doc then ready[#ready + 1] = e end end
    on_ready(ready, problems)
  end })
end

--- Shows problems (if any) in one message.
function R.report_problems(problems, heading)
  if not problems or #problems == 0 then return end
  local seen, list = {}, {}
  for _, p in ipairs(problems) do if not seen[p] then seen[p] = true; list[#list + 1] = "- " .. p end end
  R.message((heading or "Playhead") .. ":\n\n" .. table.concat(list, "\n"))
end

------------------------------------------------------------------------------------------------------------------------
-- Playhead Control (the JSFX whose eight sliders carry curves)
------------------------------------------------------------------------------------------------------------------------
local function fx_name(track, fx)
  local ok, name = reaper.TrackFX_GetFXName(track, fx, "")
  return ok and name or ""
end
local function fx_ident(track, fx)
  if not reaper.TrackFX_GetNamedConfigParm then return "" end
  local ok, v = reaper.TrackFX_GetNamedConfigParm(track, fx, "fx_ident")
  return ok and v or ""
end

--- Index of the first Playhead Control on the track, or nil.
function R.find_control(track)
  for fx = 0, reaper.TrackFX_GetCount(track) - 1 do
    if fx_name(track, fx):find(R.CONTROL_NAME, 1, true) or fx_ident(track, fx):find(R.CONTROL_NAME, 1, true) then return fx end
  end
  return nil
end

--- Index of Playhead Control on the track, inserting it first in the chain if it is missing. Returns fx, inserted
--- (bool); or nil and a message.
function R.ensure_control(track)
  local fx = R.find_control(track)
  if fx then return fx, false end
  for _, name in ipairs(R.CONTROL_FX_NAMES) do
    fx = reaper.TrackFX_AddByName(track, name, false, -1000)     -- -1000: always add, at position 0
    if fx and fx >= 0 then return fx, true end
  end
  return nil, "The Playhead Control effect was not found. Copy \"Playhead Control.jsfx\" into REAPER's Effects folder (" ..
    R.join(R.resource, "Effects", "Playhead") .. "), or install the package with ReaPack, then try again. If it is " ..
    "installed and still not found, add it to the track once from the FX browser (JS: Playhead Control)."
end

--- Parameter index of a Playhead Control slider by its name ("curve 3"; hidden sliders may be reported with their
--- leading "-"), falling back to its position.
function R.control_param(track, fx, name, fallback)
  local n = reaper.TrackFX_GetNumParams(track, fx)
  for p = 0, n - 1 do
    local ok, pn = reaper.TrackFX_GetParamName(track, fx, p, "")
    pn = ok and core.trim(pn) or ""
    if pn == name or pn == "-" .. name then return p end
  end
  return fallback
end

--- Records which curve feeds a slot (the effect shows it) and names the effect after its curves where REAPER allows.
function R.label_control(track, fx, slot, curve)
  local p = R.control_param(track, fx, "curve " .. slot .. " source", 16 + slot)
  if p then reaper.TrackFX_SetParam(track, fx, p, core.CURVE_CODES[curve] or 0) end
  if reaper.TrackFX_SetNamedConfigParm then
    local names = {}
    for k = 1, 8 do
      local pk = R.control_param(track, fx, "curve " .. k .. " source", 16 + k)
      local code = pk and math.floor(reaper.TrackFX_GetParam(track, fx, pk) + 0.5) or 0
      local cname = core.CURVE_ORDER[code]
      if cname then names[#names + 1] = k .. " " .. core.curve_label(cname) end
    end
    if #names > 0 then
      reaper.TrackFX_SetNamedConfigParm(track, fx, "renamed_name", R.CONTROL_NAME .. " (" .. table.concat(names, ", ") .. ")")
    end
  end
end

--- Writes points { {T, v} } (v in 0..1) over [t0, t1] of an FX parameter's envelope, replacing only the points in
--- that range; the envelope outside keeps its shape (a point at each end holds its old value).
function R.write_envelope(track, fx, param, t0, t1, points)
  local env = reaper.GetFXEnvelope(track, fx, param, true)
  if not env then return nil, "the envelope could not be created" end
  local _, pmin, pmax = reaper.TrackFX_GetParam(track, fx, param)
  if not pmin or not pmax or pmax <= pmin then pmin, pmax = 0, 1 end
  local mode = reaper.GetEnvelopeScalingMode and reaper.GetEnvelopeScalingMode(env) or 0
  local function raw(v)
    local x = pmin + (pmax - pmin) * v
    if mode ~= 0 and reaper.ScaleToEnvelopeMode then x = reaper.ScaleToEnvelopeMode(mode, x) end
    return x
  end
  -- points outside the range: keep the envelope's value at both ends
  local outside = false
  local n = reaper.CountEnvelopePoints(env)
  for i = 0, n - 1 do
    local _, t = reaper.GetEnvelopePoint(env, i)
    if t < t0 - 1e-9 or t > t1 + 1e-9 then outside = true break end
  end
  local before, after
  if outside and reaper.Envelope_Evaluate then
    local _, vb = reaper.Envelope_Evaluate(env, t0, 48000, 1)
    local _, va = reaper.Envelope_Evaluate(env, t1, 48000, 1)
    before, after = vb, va
  end
  reaper.DeleteEnvelopePointRange(env, t0 - 1e-7, t1 + 1e-7)
  local eps = math.min(0.001, (t1 - t0) / 1000)
  if before then reaper.InsertEnvelopePoint(env, t0, before, 0, 0, false, true) end
  for i, p in ipairs(points) do
    local t = p[1]
    if before and i == 1 then t = math.max(t, t0 + eps) end
    if after and i == #points then t = math.min(t, t1 - eps) end
    reaper.InsertEnvelopePoint(env, t, raw(p[2]), 0, 0, false, true)
  end
  if after then reaper.InsertEnvelopePoint(env, t1, after, 0, 0, false, true) end
  reaper.Envelope_SortPoints(env)
  if reaper.GetSetEnvelopeInfo_String then
    reaper.GetSetEnvelopeInfo_String(env, "ACTIVE", "1", true)
    reaper.GetSetEnvelopeInfo_String(env, "VISIBLE", "1", true)   -- REAPER 7.19 and later; ignored before
    if reaper.TrackList_AdjustWindows then reaper.TrackList_AdjustWindows(false) end   -- show the new lane now
  end
  return #points
end

------------------------------------------------------------------------------------------------------------------------
-- markers added by Playhead, remembered so that adding them again replaces them
------------------------------------------------------------------------------------------------------------------------
function R.remembered_marks(item)
  local ok, v = reaper.GetProjExtState(0, R.SECTION, "marks:" .. R.item_guid(item))
  if ok == 0 or not v or v == "" then return { take = {}, project = {} } end
  local okj, t = pcall(core.json_decode, v)
  if not okj or type(t) ~= "table" then return { take = {}, project = {} } end
  t.take = t.take or {}; t.project = t.project or {}
  return t
end
function R.remember_marks(item, marks)
  reaper.SetProjExtState(0, R.SECTION, "marks:" .. R.item_guid(item), core.json_encode(marks))
end

--- Removes the take markers and project markers/regions an earlier run added for this item (those still at the
--- same place with the same name). Returns the number removed.
function R.remove_remembered_marks(item, take)
  local marks = R.remembered_marks(item)
  local removed = 0
  if take and reaper.GetNumTakeMarkers then
    for idx = reaper.GetNumTakeMarkers(take) - 1, 0, -1 do
      local pos, name = reaper.GetTakeMarker(take, idx)
      for _, m in ipairs(marks.take) do
        if pos and math.abs(pos - m.pos) < 1e-6 and name == m.name then reaper.DeleteTakeMarker(take, idx); removed = removed + 1 break end
      end
    end
  end
  if #marks.project > 0 then
    local _, nm, nr = reaper.CountProjectMarkers(0)
    for idx = (nm + nr) - 1, 0, -1 do
      local ok, isrgn, pos, rgnend, name, id = reaper.EnumProjectMarkers3(0, idx)
      if ok and ok > 0 then
        for _, m in ipairs(marks.project) do
          local same_end = not m.rgn or (m.stop and math.abs(rgnend - m.stop) < 1e-6)
          if (m.rgn and true or false) == isrgn and math.abs(pos - m.pos) < 1e-6 and name == m.name and same_end then
            reaper.DeleteProjectMarker(0, id, isrgn); removed = removed + 1 break
          end
        end
      end
    end
  end
  R.remember_marks(item, { take = {}, project = {} })
  return removed
end

return R
