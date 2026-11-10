-- @description Playhead for REAPER: analysis curves, markers, automation, processing tools and a strip view
-- @version 0.3.0
-- @author Daniel Sandner
-- @about
--   # Playhead for REAPER
--
--   Brings Playhead's analysis into REAPER: loudness, activity, harshness, tension, onsets, events, beats and
--   sections of the selected items, as take markers and regions, as automation curves (through the Playhead
--   Control effect, for parameter links and MIDI CC), as processed takes from Playhead's analysis-driven tools,
--   and as a strip window that draws the item in a chosen look. Editing tools built on it: arranging the layers
--   of a sound, splitting a recording into its sounds, a tempo map from a recording's beats, and levelling many
--   items from measured loudness and tag rules, without changing their files.
--
--   Needs the Playhead command line (the executable from the Playhead releases on GitHub, or
--   tools/playhead-cli.js from a Playhead checkout with Node.js). See README.md.
-- @links
--   Playhead https://github.com/eigensoundlab/playhead
-- @provides
--   [main] Playhead - Analyse selected items.lua
--   [main] Playhead - Add markers for selected items.lua
--   [main] Playhead - Write curves as automation.lua
--   [main] Playhead - Process selected items.lua
--   [main] Playhead - Arrange selected layers.lua
--   [main] Playhead - Split items at sounds.lua
--   [main] Playhead - Tempo map from item.lua
--   [main] Playhead - Strip window.lua
--   [main] Playhead - Settings.lua
--   [main] Playhead - Level items.lua
--   [main] Playhead - Levels settings.lua
--   [nomain] lib/playhead_core.lua
--   [nomain] lib/playhead_reaper.lua
--   [effect] Playhead Control.jsfx
-- @changelog
--   Levels (needs Playhead 0.4 or later, or a build from main with level measures): "Level items" brings the selected
--   items, or all, to relevant levels without touching their files. Measures come from a playhead-levels.json next
--   to the sounds (Kurator, SFX Workbench, `playhead levels`) or from Playhead's analysis; gains follow the project's
--   tag rules and settings ("Levels settings": measure, target, amount, depth, limits, rules from a file) and go to
--   take volume, with group offsets on take gain or on a track named like the group. Take volumes and track faders
--   changed by hand are left alone. A report of the groups, the sounds far from them and the gains a limit held back
--   goes to the console.
--   The strip window draws a selected track, or a folder with every track under it: its items combined from their
--   analyses (playhead combine) without rendering the mix.

-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
--
-- Analyses the selected items' audio files with the Playhead command line and keeps the results in REAPER's
-- resource folder (Data/Playhead/cache), where the other Playhead actions find them. A summary of each analysis is
-- printed to the ReaScript console. Items already analysed are analysed again only when you say so.

local source = debug.getinfo(1, "S").source
local dir = source:match("^@?(.*[/\\])") or ""
package.path = dir .. "lib/?.lua;" .. package.path
local ok, R = pcall(require, "playhead_reaper")
if not ok then
  reaper.ShowMessageBox("Playhead's library files could not be loaded from\n" .. dir .. "lib\n\n" .. tostring(R), "Playhead", 0)
  return
end
local core = R.core

local function main()
  local items = R.selected_items()
  if #items == 0 then R.message("Select one or more audio items first.") return end
  local cli = R.require_cli()
  if not cli then return end
  local profile = R.profile_for(cli.settings)
  local usable, cached = 0, 0
  for _, item in ipairs(items) do
    local info = R.take_info(item)
    if info then
      usable = usable + 1
      if R.cached_document(info, cli, profile) then cached = cached + 1 end
    end
  end
  local force = false
  if usable > 0 and cached == usable then
    force = R.ask(usable == 1 and "This item is already analysed. Analyse it again?"
      or ("All " .. usable .. " items are already analysed. Analyse them again?"))
  end
  R.with_documents(items, cli, { force = force, title = "Playhead: analysing" }, function(entries, problems)
    local seen = {}
    for _, e in ipairs(entries) do
      if not seen[e.info.file] then
        seen[e.info.file] = true
        R.log(table.concat(core.describe_document(e.doc, core.basename(e.info.file)), "\n"))
      end
    end
    if #entries > 0 then
      R.log(string.format("Playhead %s, profile %s. Analyses are kept in %s\n", cli.version, profile, R.cache_dir))
    end
    R.report_problems(problems, #entries > 0 and "Some items were not analysed" or "Nothing was analysed")
  end)
end

main()
