-- @description Playhead: tempo map from item (the project grid follows a recording's bars or beats)
-- @version 0.4.0
-- @author Daniel Sandner
-- @noindex
-- @about
--   Makes REAPER's tempo follow a recording that was not played to a click: a tempo marker at each of its bars (or
--   beats), as Playhead's beat tracking finds them, so the grid, snapping, MIDI and tempo-synced effects line up with
--   it. The item itself is set to time base Time, so it stays where it is. Packaged by
--   "Playhead - Analyse selected items.lua".

-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
--
-- Each marker's tempo puts the next bar (or beat) exactly on its time; the first one also sets the time signature
-- (beats per bar as found, over 4), so a bar line falls on the first downbeat. Beats are found by the music profile
-- (sounds over 10 s, or profile music in Playhead - Settings) and only where the beat is steady. Items on another
-- time base than Time move with the new tempo: REAPER's undo takes all of it back.

local source = debug.getinfo(1, "S").source
local dir = source:match("^@?(.*[/\\])") or ""
package.path = dir .. "lib/?.lua;" .. package.path
local ok, R = pcall(require, "playhead_reaper")
if not ok then
  reaper.ShowMessageBox("Playhead's library files could not be loaded from\n" .. dir .. "lib\n\n" .. tostring(R), "Playhead", 0)
  return
end
local core = R.core
local TITLE = "Playhead: tempo map from item"

local function ask()
  return R.form("tempo", TITLE, {
    { key = "per", caption = "A tempo marker at each", default = "bars", kind = "choice", choices = { "bars", "beats" } },
    { key = "replace", caption = "Remove tempo markers already in the item's range", default = true, kind = "bool" },
  })
end

local function apply(e, plan, choices)
  local m = e.info.map
  local removed = 0
  R.undoable("Playhead: tempo map from " .. e.info.name, function()
    reaper.SetMediaItemInfo_Value(e.info.item, "C_BEATATTACHMODE", 0)       -- time base Time: the item stays
    if choices.replace then
      for i = reaper.CountTempoTimeSigMarkers(0) - 1, 0, -1 do
        local okm, t = reaper.GetTempoTimeSigMarker(0, i)
        if okm and t >= m.pos - 1e-6 and t <= m.pos + m.len + 1e-6 then
          if reaper.DeleteTempoTimeSigMarker(0, i) then removed = removed + 1 end
        end
      end
    end
    for i, k in ipairs(plan.markers) do
      local num, den = 0, 0
      if i == 1 then num, den = plan.beats_per_bar, 4 end
      reaper.SetTempoTimeSigMarker(0, -1, k.pos, -1, -1, k.bpm, num, den, false)
    end
    reaper.UpdateTimeline()
  end)
  return removed
end

local function main()
  local items = R.selected_items()
  if #items == 0 then R.message("Select the item whose beat the project should follow.", TITLE) return end
  local choices = ask()
  if not choices then return end
  local cli = R.require_cli()
  if not cli then return end
  R.with_documents({ items[1] }, cli, { title = "Playhead: finding the beat" }, function(entries, problems)
    if #items > 1 then problems[#problems + 1] = "the tempo follows the first selected item only" end
    local e = entries[1]
    if not e then return R.report_problems(problems, "No tempo markers were added") end
    local plan, why = core.tempo_plan(e.doc, e.info.map, choices.per)
    if not plan then
      problems[#problems + 1] = e.info.name .. ": " .. why
      return R.report_problems(problems, "No tempo markers were added")
    end
    local lo, hi = math.huge, 0
    for _, k in ipairs(plan.markers) do lo, hi = math.min(lo, k.bpm), math.max(hi, k.bpm) end
    local text = string.format("Add %d tempo markers (one per %s) from %s to %s, %d/4, %.1f BPM on average (%.1f to %.1f)?\n\n" ..
      "\"%s\" is set to time base Time, so it stays. Items whose time base is Beats move with the new tempo; " ..
      "Undo takes all of it back.", #plan.markers, choices.per == "beats" and "beat" or "bar",
      reaper.format_timestr(plan.start, ""), reaper.format_timestr(plan.stop, ""), plan.beats_per_bar, plan.mean_bpm or 0, lo, hi, e.info.name)
    if not R.ask_cancel(text, TITLE) then return end
    local removed = apply(e, plan, choices)
    R.log(string.format("Playhead tempo map: %s, %d markers, %d/4, %.2f BPM on average%s\n", e.info.name, #plan.markers, plan.beats_per_bar,
      plan.mean_bpm or 0, removed > 0 and (", " .. removed .. " earlier markers removed") or ""))
    R.report_problems(problems, "Tempo map added, with notes")
  end)
end

main()
