-- @description Playhead: level items (measured loudness, tag rules, groups; the files are not changed)
-- @version 0.3.1
-- @author Daniel Sandner
-- @noindex
-- @about
--   Brings items to relevant levels from Playhead's measures and the project's tag rules, as take gain (and group
--   offsets on group tracks if wanted), and reports the groups and the sounds far from them.
--   Packaged by "Playhead - Analyse selected items.lua".

-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
--
-- Brings the selected items (or, with none selected, all audio items) to relevant levels without touching their
-- files (docs/LEVELS.md in the Playhead repository). Each sound's measures come from a playhead-levels.json next to
-- its file or up to three folders above it (written by Kurator, SFX Workbench or `playhead levels`), else from
-- Playhead's analysis. Its gain follows the project's settings and the tag rules (Playhead - Levels settings, else
-- the manifest's): amount x (target - measured) + depth x (group and modifier offsets) + trim, limited by the
-- true-peak ceiling. The gain goes to the take's volume; the item's volume stays yours. Group offsets go to the take
-- too, or, when the settings say so, to a track named like the group that holds the item (a folder track works).
-- A take or track volume changed since Playhead set it is left alone unless you say otherwise. Run again after
-- changing the settings: the measures are kept on each take, so nothing is analysed twice. A report of the groups,
-- the sounds far from their group, and gains a limit held back goes to the ReaScript console.

local source = debug.getinfo(1, "S").source
local dir = source:match("^@?(.*[/\\])") or ""
package.path = dir .. "lib/?.lua;" .. package.path
local ok, R = pcall(require, "playhead_reaper")
if not ok then
  reaper.ShowMessageBox("Playhead's library files could not be loaded from\n" .. dir .. "lib\n\n" .. tostring(R), "Playhead", 0)
  return
end
local core = R.core
local abs = math.abs

-- names a group tag can go by on a track: the tag, the part after "folder:", "track:" or "ucs:", its last level
local function group_names(tag)
  local t = core.trim(tag):lower()
  local names = { [t] = true }
  local bare = t:match("^[%a]+:(.+)$")
  if bare then names[bare] = true; t = bare end
  local last = t:match("([^/]+)$")
  if last then names[last] = true end
  return names
end

local function track_tags(info)
  local out = {}
  for _, tr in ipairs(R.track_chain(info.track)) do
    local n = core.trim(R.track_name(tr))
    if n ~= "" then out[#out + 1] = "track:" .. n end
  end
  return out
end

local function apply(rows, problems)
  local own = R.levels_project()
  local spread = own.checks and tonumber(own.checks.groupSpread) or 4
  local report_S
  -- the gain of each item, and where it goes
  local changed, before = {}, {}
  for _, r in ipairs(rows) do
    local spec = r.manifest or {}
    local S = core.levels_settings(spec, own.levels)
    report_S = report_S or S
    local rules = (type(own.rules) == "table" and #own.rules > 0) and own.rules or (type(spec.rules) == "table" and spec.rules or {})
    local tags, seen = {}, {}
    for _, list in ipairs({ r.entry.tags or {}, track_tags(r.info) }) do
      for _, t in ipairs(list) do if not seen[t] then seen[t] = true; tags[#tags + 1] = t end end
    end
    local g = core.levels_gain(S, rules, { tags = tags, measures = r.entry.measures, trim = r.entry.trim })
    r.g, r.S = g, S
    r.group_track = nil
    if S.place == "track" and g.group then
      local names = group_names(g.group)
      for _, tr in ipairs(R.track_chain(r.info.track)) do
        if names[core.trim(R.track_name(tr)):lower()] then r.group_track = tr break end
      end
      if not r.group_track then r.why = { "no track named like the group \"" .. g.group .. "\" holds it: the group's offset is in its take gain" } end
    end
    r.take_db = g.gain - (r.group_track and g.group_offset or 0)
    local vol = reaper.GetMediaItemTakeInfo_Value(r.info.take, "D_VOL")
    r.negative = vol < 0
    local cur = core.levels_to_db(vol)
    local state = R.levels_take_state(r.info.take)
    if state and type(state.applied) == "number" then
      if abs(cur - state.applied) > 0.01 then changed[#changed + 1] = r end
    elseif abs(cur) > 0.01 then before[#before + 1] = r end
    for _, c in ipairs(r.entry.checks or {}) do
      if type(c) == "table" and c.severity ~= "info" and c.text then r.why = r.why or {}; table.insert(r.why, c.text) end
    end
  end
  if #changed + #before > 0 then
    local n = #changed + #before
    local text = (#changed > 0 and (#changed .. (#changed == 1 and " item's" or " items'") .. " take volume was changed since Playhead levelled " .. (#changed == 1 and "it" or "them")) or "")
      .. (#changed > 0 and #before > 0 and ", and " or "")
      .. (#before > 0 and (#before .. (#before == 1 and " item has" or " items have") .. " a take volume already (from Normalize, or set by hand)") or "")
      .. ".\n\nReplace " .. (n == 1 and "it" or "them") .. " with Playhead's levels? No leaves " .. (n == 1 and "that item" or "those items") .. " as they are."
    if not R.ask(text) then
      for _, r in ipairs(changed) do r.skipped = "take volume changed since Playhead levelled it: left as it is" end
      for _, r in ipairs(before) do r.skipped = "had a take volume already: left as it is" end
    end
  end
  local moved_back, kept_tracks = {}, {}
  R.undoable("Playhead: level items", function()
    local tracks = {}
    for _, r in ipairs(rows) do
      if not r.skipped then
        reaper.SetMediaItemTakeInfo_Value(r.info.take, "D_VOL", core.levels_to_vol(r.take_db, r.negative))
        R.levels_set_take_state(r.info.take, { v = 1, applied = r.take_db, gain = r.g.gain, measure = r.g.used, measured = r.g.measured,
          group = r.g.group, modifiers = r.g.modifiers, track = r.group_track and R.track_name(r.group_track) or nil })
        reaper.UpdateItemInProject(r.info.item)
        if r.group_track and not tracks[r.group_track] then tracks[r.group_track] = { db = r.g.group_offset, group = r.g.group } end
      end
    end
    -- group offsets on tracks; a fader moved since Playhead set it is left alone
    for tr, t in pairs(tracks) do
      local state = R.levels_track_state(tr)
      local cur = core.levels_to_db(reaper.GetMediaTrackInfo_Value(tr, "D_VOL"))
      if state and type(state.applied) == "number" and abs(cur - state.applied) > 0.01 then
        kept_tracks[#kept_tracks + 1] = R.track_name(tr)
      else
        reaper.SetMediaTrackInfo_Value(tr, "D_VOL", core.levels_to_vol(t.db, false))
        R.levels_set_track_state(tr, { v = 1, applied = t.db, group = t.group })
      end
    end
    -- with groups on take gain, offsets Playhead put on tracks earlier go back to 0 dB (if nobody moved the fader)
    for i = 0, reaper.CountTracks(0) - 1 do
      local tr = reaper.GetTrack(0, i)
      local state = R.levels_track_state(tr)
      if state and type(state.applied) == "number" and not tracks[tr] then
        local placed_here = false
        for _, r in ipairs(rows) do if r.S.place == "track" and r.group_track == tr then placed_here = true end end
        if not placed_here and abs(core.levels_to_db(reaper.GetMediaTrackInfo_Value(tr, "D_VOL")) - state.applied) <= 0.01 then
          reaper.SetMediaTrackInfo_Value(tr, "D_VOL", 1)
          R.levels_set_track_state(tr, nil)
          moved_back[#moved_back + 1] = R.track_name(tr)
        end
      end
    end
  end)
  -- the report
  local lines = {}
  for _, r in ipairs(rows) do
    local why = r.why and { table.unpack(r.why) } or {}
    lines[#lines + 1] = { name = r.info.name, group = r.g.group, measured = r.g.measured, used = r.g.used, measure = r.g.measure, gain = r.g.gain,
      wanted = r.g.wanted, limited = r.g.limited, unmeasured = r.g.unmeasured, skipped = r.skipped, why = why }
  end
  local text = core.levels_report(lines, report_S, spread)
  local done = 0
  for _, r in ipairs(rows) do if not r.skipped then done = done + 1 end end
  text[#text + 1] = string.format("Levelled %d of %d item%s.%s", done, #rows, #rows == 1 and "" or "s",
    (#kept_tracks > 0 and (" Track faders moved by hand were left alone: " .. table.concat(kept_tracks, ", ") .. ".") or "")
    .. (#moved_back > 0 and (" Group offsets moved back from the tracks to the takes: " .. table.concat(moved_back, ", ") .. ".") or ""))
  R.log(table.concat(text, "\n") .. "\n")
  R.report_problems(problems, "Some items were not levelled")
end

local function main()
  local items = R.selected_items()
  if #items == 0 then
    items = R.all_items()
    if #items == 0 then R.message("There are no items to level.") return end
    if not R.ask("No items are selected. Level all " .. #items .. " items of the project?") then return end
  end
  R.levels_forget_manifests()
  local rows, need, problems = {}, {}, {}
  for _, item in ipairs(items) do
    local info, err = R.take_info(item)
    if not info then problems[#problems + 1] = err
    else
      local man, mdir = R.levels_manifest_for(info.file)
      local entry, rel
      if man then
        rel = core.levels_relative(mdir, info.file, R.os)
        entry = rel and core.levels_find_entry(man, rel, info.size, R.os)
      end
      local r = { item = item, info = info, manifest = man, rel = rel }
      if entry and type(entry.measures) == "table" and next(entry.measures) then
        r.entry = { tags = entry.tags or {}, measures = entry.measures, trim = entry.trim, checks = entry.checks }
      else
        r.entry_tags = entry and entry.tags or {}
        need[#need + 1] = r
      end
      rows[#rows + 1] = r
    end
  end
  if #need == 0 then return apply(rows, problems) end
  -- the rest are measured from Playhead's analysis (the cache, else the command line)
  local cli = R.require_cli()
  if not cli then return end
  local profile = R.profile_for(cli.settings)
  local function attach(entries)
    local by_item = {}
    for _, e in ipairs(entries) do by_item[e.info.item] = e.doc end
    local stale = {}
    for _, r in ipairs(need) do
      local doc = by_item[r.item]
      if doc and doc.summary and doc.summary.levels then
        local path = r.rel or r.info.file
        local e = core.levels_entry(doc, path, r.entry_tags, core.basename(core.dirname(r.info.file)))
        local checks = {}
        for _, i in ipairs(doc.issues ~= core.null and doc.issues or {}) do checks[#checks + 1] = i end
        r.entry = { tags = e.tags, measures = e.measures, trim = 0, checks = checks }
      elseif doc then stale[#stale + 1] = r end
    end
    return stale
  end
  local function finish()
    local ready = {}
    for _, r in ipairs(rows) do
      if r.entry then ready[#ready + 1] = r
      elseif not r.reported then problems[#problems + 1] = r.info.name .. ": not measured" end
    end
    if #ready == 0 then R.report_problems(problems, "Nothing was levelled") return end
    apply(ready, problems)
  end
  local list = {}
  for _, r in ipairs(need) do list[#list + 1] = r.item end
  R.with_documents(list, cli, { title = "Playhead: measuring" }, function(entries, probs)
    for _, p in ipairs(probs) do problems[#problems + 1] = p end
    local stale = attach(entries)
    if #stale == 0 then return finish() end
    -- analyses kept from a Playhead without the level measures: analysed again, once
    local again = {}
    for _, r in ipairs(stale) do R.forget_document(r.info, cli, profile); again[#again + 1] = r.item end
    R.with_documents(again, cli, { title = "Playhead: measuring" }, function(entries2, probs2)
      for _, p in ipairs(probs2) do problems[#problems + 1] = p end
      for _, r in ipairs(attach(entries2)) do
        r.reported = true
        problems[#problems + 1] = r.info.name .. ": the Playhead command line (" .. tostring(cli.version) .. ") gives no level measures; it needs a newer Playhead"
      end
      finish()
    end)
  end)
end

main()
