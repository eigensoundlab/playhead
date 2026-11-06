-- @description Playhead: write curves as automation (Playhead Control envelopes over each selected item)
-- @version 0.1.0
-- @author Daniel Sandner
-- @noindex
-- @about
--   Writes Playhead curves of the selected items (harshness, tension, onset strength, ...) as envelope points on
--   the eight curve parameters of the Playhead Control effect, over each item's time range only, following the
--   take's start offset, playback rate, loop and reversed sections. The effect is inserted first on the track when
--   it is missing. Link any effect parameter to a curve with REAPER's parameter modulation, or send it as MIDI CC.
--   Packaged by "Playhead - Analyse selected items.lua".

-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
--
-- Curves are 0..1: the curves Playhead keeps on fixed library-wide scales as they are, the descriptor curves
-- (n1..n8) on their 5th-95th percentile in the file, loudness in LUFS from -60 to 0. "Scaling: item" stretches each
-- curve so that its 5th-95th percentile inside the item spans 0..1 instead. Silence (no value) is written as 0.
-- Points are thinned to stay within the tolerance of the full curve, and to at most the given number per curve.

local source = debug.getinfo(1, "S").source
local dir = source:match("^@?(.*[/\\])") or ""
package.path = dir .. "lib/?.lua;" .. package.path
local ok, R = pcall(require, "playhead_reaper")
if not ok then
  reaper.ShowMessageBox("Playhead's library files could not be loaded from\n" .. dir .. "lib\n\n" .. tostring(R), "Playhead", 0)
  return
end
local core = R.core

local DEFAULT_SLOTS = { "harshness", "tension", "onsetStrength", "", "", "", "", "" }

--- The curves available in all entries' documents, for messages.
local function available(entries)
  local seen, list = {}, {}
  for _, e in ipairs(entries) do
    for _, k in ipairs(core.curve_names(e.doc)) do
      if not seen[k] then seen[k] = true; list[#list + 1] = k .. " (" .. core.curve_label(k) .. ")" end
    end
  end
  return list
end

local function ask(entries)
  local c = R.get_json("curves", {})
  local slots = c.slots or DEFAULT_SLOTS
  local fields = {}
  for i = 1, 8 do fields[i] = { caption = "Curve for slot " .. i .. " (empty = leave the slot)", default = slots[i] or "" } end
  fields[9] = { caption = "Scaling (fixed or item)", default = c.scaling or "fixed" }
  fields[10] = { caption = "Point tolerance (0 to 0.2)", default = core.num(c.tolerance or 0.01) }
  fields[11] = { caption = "Most points per curve", default = core.num(c.max_points or 2000) }
  fields[12] = { caption = "Write on track (item or selected)", default = c.target or "item" }
  local doc = entries[1].doc
  while true do
    local v = R.dialog("Playhead: write curves as automation", fields, 120)
    if not v then return nil end
    for i = 1, #fields do fields[i].default = v[i] end
    local out = { slots = {}, keys = {} }
    local bad = {}
    for i = 1, 8 do
      local text = core.trim(v[i])
      out.slots[i] = text
      if text ~= "" then
        local key, hits = core.find_curve(doc, text)
        if not key then
          -- not in the first item's analysis: accept any curve some selected item has
          for _, e in ipairs(entries) do key = core.find_curve(e.doc, text); if key then break end end
        end
        if key then out.keys[i] = key
        elseif hits and #hits > 1 then bad[#bad + 1] = "slot " .. i .. ": \"" .. text .. "\" fits several curves (" .. table.concat(hits, ", ") .. ")"
        else bad[#bad + 1] = "slot " .. i .. ": no curve called \"" .. text .. "\"" end
      end
    end
    out.scaling = core.trim(v[9]):lower()
    if out.scaling ~= "fixed" and out.scaling ~= "item" then bad[#bad + 1] = "scaling: fixed or item" end
    out.tolerance = tonumber(v[10])
    if not out.tolerance or out.tolerance < 0 or out.tolerance > 0.2 then bad[#bad + 1] = "point tolerance: a number from 0 to 0.2" end
    out.max_points = math.floor(tonumber(v[11]) or 0)
    if out.max_points < 2 or out.max_points > 100000 then bad[#bad + 1] = "most points per curve: a number from 2 to 100000" end
    out.target = core.trim(v[12]):lower()
    if out.target ~= "item" and out.target ~= "selected" then bad[#bad + 1] = "track: item or selected" end
    if next(out.keys) == nil and #bad == 0 then bad[#bad + 1] = "choose at least one curve" end
    if #bad == 0 then
      R.set_json("curves", { slots = out.slots, scaling = out.scaling, tolerance = out.tolerance, max_points = out.max_points, target = out.target })
      return out
    end
    R.message("Please check:\n- " .. table.concat(bad, "\n- ") .. "\n\nCurves in the selected items:\n" .. table.concat(available(entries), ", "))
  end
end

local function write(entries, choice, problems)
  local target_track
  if choice.target == "selected" then
    target_track = reaper.GetSelectedTrack(0, 0)
    if not target_track then problems[#problems + 1] = "no track is selected (\"Write on track: selected\")" return 0 end
  end
  local lines, written = {}, 0
  local function write_entry(e)
    local info, doc = e.info, e.doc
    local track = target_track or info.track
    local fx, err = R.ensure_control(track)
    if not fx then problems[#problems + 1] = err return end
    local m = info.map
    local parts = {}
    for slot = 1, 8 do
      local key = choice.keys[slot]
      if key then
        if not core.curve_live(doc, key) then
          problems[#problems + 1] = info.name .. ": " .. core.curve_label(key) .. " is not in its analysis or is empty (slot " .. slot .. " left as it was)"
        else
          local pts = core.sample_curve(doc, key, m, { scaling = choice.scaling })
          local reduced = core.reduce_points(pts, choice.tolerance, choice.max_points)
          local param = R.control_param(track, fx, "curve " .. slot, slot - 1)
          local n, werr = R.write_envelope(track, fx, param, m.pos, m.pos + m.len, reduced)
          if n then
            R.label_control(track, fx, slot, key)
            parts[#parts + 1] = string.format("%d %s (%d points)", slot, core.curve_label(key), n)
            written = written + 1
          else problems[#problems + 1] = info.name .. ": slot " .. slot .. ": " .. tostring(werr) end
        end
      end
    end
    if #parts > 0 then lines[#lines + 1] = info.name .. ": " .. table.concat(parts, ", ") end
  end
  R.undoable("Playhead: write curves as automation", function()
    for _, e in ipairs(entries) do write_entry(e) end
  end)
  if #lines > 0 then
    R.log("Playhead curves written to Playhead Control\n  " .. table.concat(lines, "\n  ") ..
      "\n  Link an effect parameter to a curve: Param > Parameter modulation/MIDI link > Link from MIDI or FX parameter.\n")
  end
  return written
end

local function main()
  local items = R.selected_items()
  if #items == 0 then R.message("Select one or more audio items first.") return end
  local cli = R.require_cli()
  if not cli then return end
  R.with_documents(items, cli, { title = "Playhead: analysing for curves" }, function(entries, problems)
    if #entries == 0 then R.report_problems(problems, "No curves were written") return end
    local choice = ask(entries)
    if not choice then return end
    local n = write(entries, choice, problems)
    R.report_problems(problems, n > 0 and "Curves written, with notes" or "No curves were written")
  end)
end

main()
