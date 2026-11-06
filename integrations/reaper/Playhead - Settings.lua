-- @description Playhead: settings (command line, analysis profile, timeout, cache)
-- @version 0.1.0
-- @author Daniel Sandner
-- @noindex
-- @about
--   Where the Playhead command line is, which analysis profile to use, how long to wait, extra folders for ffmpeg
--   and Node, and the analysis cache. Checks the command line after saving.
--   Packaged by "Playhead - Analyse selected items.lua".

-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
--
-- An empty executable field means: look in <REAPER resource folder>/Scripts/Playhead (playhead, playhead.exe or
-- playhead-cli.cjs), then on the PATH. A path to playhead-cli.js or playhead-cli.cjs is run with Node.
-- Paths cannot contain commas here (the dialog separates fields with commas).

local source = debug.getinfo(1, "S").source
local dir = source:match("^@?(.*[/\\])") or ""
package.path = dir .. "lib/?.lua;" .. package.path
local ok, R = pcall(require, "playhead_reaper")
if not ok then
  reaper.ShowMessageBox("Playhead's library files could not be loaded from\n" .. dir .. "lib\n\n" .. tostring(R), "Playhead", 0)
  return
end
local core = R.core

local function cache_summary()
  local n, bytes = 0, 0
  for _, f in ipairs(R.list_files(R.cache_dir)) do
    if f:match("%.json$") then n = n + 1; bytes = bytes + (R.file_size(R.join(R.cache_dir, f)) or 0) end
  end
  return n, bytes
end

local function clear_cache()
  local n = 0
  for _, f in ipairs(R.list_files(R.cache_dir)) do
    if f:match("%.json$") or f:match("%.part%-") then os.remove(R.join(R.cache_dir, f)); n = n + 1 end
  end
  return n
end

local function main()
  local s = R.settings()
  local function safe(v) return (tostring(v):find(",", 1, true)) and "" or tostring(v) end
  local fields = {
    { caption = "Playhead executable or playhead-cli.js (empty = search)", default = safe(s.exe) },
    { caption = "Node.js for playhead-cli.js", default = safe(s.node) },
    { caption = "Analysis profile (auto/fast/sfx/music)", default = s.profile },
    { caption = "Timeout in seconds", default = core.num(s.timeout) },
    { caption = "Extra folders for ffmpeg and node (separated by ;)", default = safe(s.extra_path) },
    { caption = "Strip window: analyse items when selected (yes/no)", default = R.get("strip_auto", "yes") },
    { caption = "Empty the analysis cache now (yes/no)", default = "no" },
  }
  while true do
    local v = R.dialog("Playhead: settings", fields, 260)
    if not v then return end
    for i = 1, #fields do fields[i].default = v[i] end
    local exe, node, profile = core.trim(v[1]), core.trim(v[2]), core.trim(v[3]):lower()
    local timeout, extra = tonumber(v[4]), core.trim(v[5])
    local auto, clear = core.parse_bool(v[6]), core.parse_bool(v[7])
    local bad = {}
    if exe ~= "" and not core.is_absolute(exe) then bad[#bad + 1] = "the executable needs a full path (or leave it empty to search)" end
    if exe ~= "" and core.is_absolute(exe) and not R.exists(exe) then bad[#bad + 1] = "no file at " .. exe end
    if not core.PROFILES[profile] then bad[#bad + 1] = "profile: auto, fast, sfx or music" end
    if not timeout or timeout < 10 then bad[#bad + 1] = "timeout: at least 10 seconds" end
    if auto == nil then bad[#bad + 1] = "strip window: yes or no" end
    if clear == nil then bad[#bad + 1] = "empty the cache: yes or no" end
    if #bad == 0 then
      R.set("exe", exe); R.set("node", node ~= "" and node or "node"); R.set("profile", profile)
      R.set("timeout", core.num(timeout)); R.set("extra_path", extra); R.set("strip_auto", core.yesno(auto))
      break
    end
    R.message("Please check:\n- " .. table.concat(bad, "\n- "))
  end
  local lines = {}
  if core.parse_bool(fields[7].default) then lines[#lines + 1] = "Removed " .. clear_cache() .. " cached analyses." end
  local cli, err = R.cli(R.settings(), true)
  if cli then
    lines[#lines + 1] = "Playhead " .. cli.version .. " works:\n  " .. table.concat(cli.argv({}), " ")
  else
    lines[#lines + 1] = err
  end
  local n, bytes = cache_summary()
  lines[#lines + 1] = string.format("Analysis cache: %d documents, %.1f MB in\n  %s", n, bytes / 1048576, R.cache_dir)
  R.message(table.concat(lines, "\n\n"), "Playhead settings")
end

main()
