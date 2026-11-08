-- @noindex (for the download from the Playhead releases; ReaPack installs the package by itself)
-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
--
-- Installs Playhead for REAPER from the folder this script is in (an unpacked download, or a Playhead checkout):
-- copies the actions, their library and README into REAPER's resource folder (Scripts/Playhead), the Playhead
-- Control effect into Effects/Playhead and, when it is in the same folder, the Playhead executable; then adds the
-- actions (and "Playhead - Uninstall") to the action list. Run it again to update: settings and analyses are kept.
--
-- To run it: Actions > Show action list > New action > Load ReaScript..., choose this file, then Run.

local source = debug.getinfo(1, "S").source
local dir = source:match("^@?(.*[/\\])") or ""
package.path = dir .. "lib/?.lua;" .. package.path
local ok, R = pcall(require, "playhead_reaper")
if not ok then
  reaper.ShowMessageBox("The installer needs the lib folder next to it (" .. dir .. "lib).\nUnpack the whole download and run the installer from its folder.\n\n" .. tostring(R), "Playhead: install", 0)
  return
end
local core = R.core
local P = core.PACKAGE
local TITLE = "Playhead: install"

local here = dir:gsub("[/\\]$", "")
local scripts_dir = R.join(R.resource, "Scripts", "Playhead")
local effects_dir = R.join(R.resource, "Effects", "Playhead")
local function norm(p)
  p = tostring(p):gsub("\\", "/"):gsub("/+$", "")
  if R.os == "windows" or R.os == "macos" then p = p:lower() end
  return p
end
local in_place = norm(here) == norm(scripts_dir)          -- running the installed copy: only the action list is set up

local function main()
  -- what has to be here
  local missing = {}
  local files = {}
  for _, f in ipairs(P.actions) do files[#files + 1] = f end
  for _, f in ipairs(P.tools) do files[#files + 1] = f end
  for _, f in ipairs(files) do if not R.exists(R.join(here, f)) then missing[#missing + 1] = f end end
  for _, f in ipairs(P.lib) do if not R.exists(R.join(here, "lib", f)) then missing[#missing + 1] = "lib/" .. f end end
  local effect_here = R.exists(R.join(here, P.effect))
  if not effect_here and not in_place then missing[#missing + 1] = P.effect end
  if #missing > 0 then
    R.message("These files are missing next to the installer:\n  " .. table.concat(missing, "\n  ") ..
      "\n\nUnpack the whole download and run the installer from its folder.", TITLE)
    return
  end
  local exe
  for _, n in ipairs(P.executables) do if not exe and n ~= "playhead-cli.cjs" and R.exists(R.join(here, n)) then exe = n end end
  if exe and R.os == "windows" and exe ~= "playhead.exe" then exe = nil end
  if exe and R.os ~= "windows" and exe ~= "playhead" then exe = nil end

  local text = "Install Playhead for REAPER " .. core.VERSION .. "?\n\n" ..
    (in_place and "It is already in its place; this adds its actions to the action list.\n" or
      ("Actions, library and README into\n  " .. scripts_dir .. "\nThe Playhead Control effect into\n  " .. effects_dir .. "\n" ..
        (exe and ("The Playhead command line (" .. exe .. ") from this folder, too.\n") or ""))) ..
    "\nYour settings and analyses are kept."
  if reaper.ShowMessageBox(text, TITLE, 1) ~= 1 then return end

  local problems = {}
  local function put(from, to)
    local okc, err = R.copy_file(from, to)
    if not okc then problems[#problems + 1] = err end
  end
  if not in_place then
    R.mkdir(R.join(scripts_dir, "lib"))
    R.mkdir(effects_dir)
    for _, f in ipairs(files) do put(R.join(here, f), R.join(scripts_dir, f)) end
    for _, f in ipairs(P.docs) do if R.exists(R.join(here, f)) then put(R.join(here, f), R.join(scripts_dir, f)) end end
    for _, f in ipairs(P.lib) do put(R.join(here, "lib", f), R.join(scripts_dir, "lib", f)) end
    if exe then
      local to = R.join(scripts_dir, exe)
      put(R.join(here, exe), to)
      if R.os ~= "windows" then                           -- runnable, and (macOS) not held back as a download
        R.run_blocking({ "/bin/chmod", "+x", to }, 10)
        if R.os == "macos" then R.run_blocking({ "/usr/bin/xattr", "-d", "com.apple.quarantine", to }, 10) end
      end
    end
  end
  if effect_here and not in_place then put(R.join(here, P.effect), R.join(effects_dir, P.effect)) end
  if #problems > 0 then
    R.message("Playhead for REAPER could not be installed completely:\n  " .. table.concat(problems, "\n  ") ..
      "\n\nREAPER may need to be closed and opened again, or the folder may not be writable.", TITLE)
    return
  end

  -- the action list (once each: a script already in it keeps its command)
  local list, added = {}, {}
  for _, f in ipairs(P.actions) do list[#list + 1] = f end
  list[#list + 1] = "Playhead - Uninstall.lua"
  for i, f in ipairs(list) do
    local id = reaper.AddRemoveReaScript(true, 0, R.join(scripts_dir, f), i == #list)
    if id and id > 0 then added[#added + 1] = f:gsub("%.lua$", "") end
  end

  -- the command line: found and working?
  local cli, err = R.cli(nil, true)
  local cli_text = cli and ("The Playhead command line works (version " .. cli.version .. ", " .. cli.exe .. ").")
    or ("The Playhead command line is not set up yet. Download the executable for your system from the Playhead releases " ..
      "on GitHub into\n  " .. scripts_dir .. "\nor choose it in Playhead - Settings.\n\n(" .. tostring(err):match("^[^\n]*") .. ")")
  R.message("Playhead for REAPER " .. core.VERSION .. " is installed.\n\n" ..
    "In the action list (Actions > Show action list, search \"Playhead\"):\n  " .. table.concat(added, "\n  ") .. "\n\n" ..
    cli_text .. "\n\nTo start: select an audio item and run Playhead - Strip window. Bind keys or toolbar buttons to the " ..
    "actions as you like.", TITLE)
end

main()
