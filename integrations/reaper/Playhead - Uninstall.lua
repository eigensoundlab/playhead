-- @noindex (for installs made with "Playhead - Install"; ReaPack removes its packages by itself)
-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
--
-- Removes Playhead for REAPER as "Playhead - Install" put it in place: the actions from the action list, the files
-- in REAPER's resource folder (Scripts/Playhead, with the Playhead executable there, and Effects/Playhead) and, if
-- you say so, the stored analyses (Data/Playhead) and Playhead's settings. Actions loaded from another folder (a
-- Playhead checkout) are taken off the action list too; their files there are left alone. Files Playhead rendered
-- into your projects, and the marks it keeps in projects, stay.

local source = debug.getinfo(1, "S").source
local dir = source:match("^@?(.*[/\\])") or ""
package.path = dir .. "lib/?.lua;" .. package.path
local ok, R = pcall(require, "playhead_reaper")
if not ok then
  reaper.ShowMessageBox("Playhead's library files could not be loaded from\n" .. dir .. "lib\n\n" .. tostring(R), "Playhead: uninstall", 0)
  return
end
local core = R.core
local P = core.PACKAGE
local TITLE = "Playhead: uninstall"

local here = dir:gsub("[/\\]$", "")
local scripts_dir = R.join(R.resource, "Scripts", "Playhead")
local effects_dir = R.join(R.resource, "Effects", "Playhead")
local function norm(p)
  p = tostring(p):gsub("\\", "/"):gsub("/+$", "")
  if R.os == "windows" or R.os == "macos" then p = p:lower() end
  return p
end

local function main()
  if not R.resource or R.resource == "" then R.message("REAPER's resource folder is not known; nothing was removed.", TITLE) return end
  local text = "Remove Playhead for REAPER?\n\n" ..
    "- its actions from the action list\n" ..
    "- its files in\n    " .. scripts_dir .. "\n  (with the Playhead command line there)\n" ..
    "- the Playhead Control effect in\n    " .. effects_dir .. "\n\n" ..
    "Projects that use the Playhead Control effect will show it as missing. Files Playhead rendered into your " ..
    "projects stay." .. (norm(here) ~= norm(scripts_dir) and ("\n\nThe actions loaded from this folder are taken off the action list too; " ..
      "its files stay:\n    " .. here) or "")
  if reaper.ShowMessageBox(text, TITLE, 1) ~= 1 then return end
  local n_cache = #R.list_files(R.cache_dir)
  local forget = reaper.ShowMessageBox("Also delete Playhead's stored analyses (" .. n_cache .. " in " .. R.data_dir ..
    ") and its settings?\n\nNo keeps them, for a later install.", TITLE, 4) == 6

  -- the action list: the installed copies, and copies loaded from this folder
  local names = {}
  for _, f in ipairs(P.actions) do names[#names + 1] = f end
  for _, f in ipairs(P.tools) do names[#names + 1] = f end
  local paths = {}
  for _, f in ipairs(names) do paths[#paths + 1] = R.join(scripts_dir, f) end
  if norm(here) ~= norm(scripts_dir) then for _, f in ipairs(names) do paths[#paths + 1] = R.join(here, f) end end
  local removed = 0
  for i, p in ipairs(paths) do
    if (reaper.AddRemoveReaScript(false, 0, p, i == #paths) or 0) > 0 then removed = removed + 1 end
  end

  -- the files (only where the installer puts them)
  local gone, left = 0, {}
  local function drop(p) if R.exists(p) then if os.remove(p) then gone = gone + 1 else left[#left + 1] = p end end end
  for _, f in ipairs(names) do drop(R.join(scripts_dir, f)) end
  for _, f in ipairs(P.docs) do drop(R.join(scripts_dir, f)) end
  for _, f in ipairs(P.executables) do drop(R.join(scripts_dir, f)) end
  for _, f in ipairs(P.lib) do drop(R.join(scripts_dir, "lib", f)) end
  drop(R.join(effects_dir, P.effect))
  R.remove_empty_dir(R.join(scripts_dir, "lib"))
  R.remove_empty_dir(scripts_dir)
  R.remove_empty_dir(effects_dir)
  for _, f in ipairs(R.list_files(scripts_dir)) do left[#left + 1] = R.join(scripts_dir, f) end

  local data = ""
  if forget then
    local n = R.remove_tree(R.data_dir)
    R.forget_settings()
    data = string.format("\nStored analyses and job files deleted (%d files), settings removed.", n)
  end
  R.message(string.format("Playhead for REAPER is removed: %d actions taken off the action list, %d files deleted.", removed, gone) .. data ..
    (#left > 0 and ("\n\nLeft in place (not part of the package, or in use):\n  " .. table.concat(left, "\n  ")) or "") ..
    "\n\nTo install it again, run Playhead - Install from the download.", TITLE)
end

main()
