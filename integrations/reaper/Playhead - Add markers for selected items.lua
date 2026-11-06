-- @description Playhead: add markers for selected items (events, onsets, downbeats, sections)
-- @version 0.1.0
-- @author Daniel Sandner
-- @noindex
-- @about
--   Adds Playhead's analysis of the selected items as markers: events and onsets as take markers (they move with
--   the take), downbeats as project markers and sections as project regions, all clipped to what each item plays.
--   Packaged by "Playhead - Analyse selected items.lua".

-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
--
-- Your choices are remembered. "Replace" removes the markers this action added to the same items before (those
-- still at the same place with the same name), so it can be run again after editing without piling up markers.

local source = debug.getinfo(1, "S").source
local dir = source:match("^@?(.*[/\\])") or ""
package.path = dir .. "lib/?.lua;" .. package.path
local ok, R = pcall(require, "playhead_reaper")
if not ok then
  reaper.ShowMessageBox("Playhead's library files could not be loaded from\n" .. dir .. "lib\n\n" .. tostring(R), "Playhead", 0)
  return
end
local core = R.core

local DEFAULTS = { events = true, onsets = false, sections = true, downbeats = true, replace = true }

local function ask_choices()
  local c = R.get_json("markers", {})
  for k, v in pairs(DEFAULTS) do if c[k] == nil then c[k] = v end end
  local fields = {
    { caption = "Events as take markers (yes/no)", default = core.yesno(c.events) },
    { caption = "Onsets as take markers (yes/no)", default = core.yesno(c.onsets) },
    { caption = "Sections as project regions (yes/no)", default = core.yesno(c.sections) },
    { caption = "Downbeats as project markers (yes/no)", default = core.yesno(c.downbeats) },
    { caption = "Replace markers added here before (yes/no)", default = core.yesno(c.replace) },
  }
  while true do
    local v = R.dialog("Playhead: add markers", fields, 60)
    if not v then return nil end
    local out, bad = {}, {}
    for i, key in ipairs({ "events", "onsets", "sections", "downbeats", "replace" }) do
      local b = core.parse_bool(v[i])
      if b == nil then bad[#bad + 1] = fields[i].caption:gsub(" %(yes/no%)", "") end
      out[key] = b
      fields[i].default = v[i]
    end
    if #bad == 0 then
      R.set_json("markers", out)
      return out
    end
    R.message("Please answer yes or no for: " .. table.concat(bad, ", ") .. ".")
  end
end

local function add_markers(entries, choices, problems)
  local kinds = { events = choices.events, onsets = choices.onsets, sections = choices.sections, downbeats = choices.downbeats }
  local lines, total = {}, 0
  local take_markers_ok = reaper.SetTakeMarker ~= nil
  if (kinds.events or kinds.onsets) and not take_markers_ok then
    problems[#problems + 1] = "take markers need REAPER 6 or later; events and onsets were skipped"
    kinds.events, kinds.onsets = false, false
  end
  R.undoable("Playhead: add markers", function()
    local done_items = {}
    for _, e in ipairs(entries) do
      local info, doc = e.info, e.doc
      if not done_items[info.item] then
        done_items[info.item] = true
        local removed = choices.replace and R.remove_remembered_marks(info.item, info.take) or 0
        local plan = core.marker_plan(doc, info.map, kinds)
        local marks = R.remembered_marks(info.item)
        for _, m in ipairs(plan.take) do
          reaper.SetTakeMarker(info.take, -1, m.name, m.pos)
          marks.take[#marks.take + 1] = { pos = m.pos, name = m.name }
        end
        for _, m in ipairs(plan.markers) do
          local idx = reaper.AddProjectMarker2(0, false, m.pos, 0, m.name, -1, 0)
          if idx and idx >= 0 then marks.project[#marks.project + 1] = { id = idx, rgn = false, pos = m.pos, name = m.name } end
        end
        for _, r in ipairs(plan.regions) do
          local idx = reaper.AddProjectMarker2(0, true, r.start, r.stop, r.name, -1, 0)
          if idx and idx >= 0 then marks.project[#marks.project + 1] = { id = idx, rgn = true, pos = r.start, stop = r.stop, name = r.name } end
        end
        R.remember_marks(info.item, marks)
        local n = #plan.take + #plan.markers + #plan.regions
        total = total + n
        local parts = {}
        if kinds.events or kinds.onsets then parts[#parts + 1] = #plan.take .. " take markers" end
        if kinds.downbeats then parts[#parts + 1] = #plan.markers .. " bar markers" end
        if kinds.sections then parts[#parts + 1] = #plan.regions .. " regions" end
        lines[#lines + 1] = info.name .. ": " .. table.concat(parts, ", ") .. (removed > 0 and (" (" .. removed .. " earlier ones replaced)") or "")
        for _, note in ipairs(plan.notes) do problems[#problems + 1] = info.name .. ": " .. note end
      end
    end
  end)
  if #lines > 0 then R.log("Playhead markers\n  " .. table.concat(lines, "\n  ") .. "\n") end
  if total == 0 and #problems == 0 then problems[#problems + 1] = "nothing to add for the chosen kinds in the parts of the items that play" end
  R.report_problems(problems, total > 0 and "Markers added, with notes" or "No markers were added")
end

local function main()
  local items = R.selected_items()
  if #items == 0 then R.message("Select one or more audio items first.") return end
  local choices = ask_choices()
  if not choices then return end
  if not (choices.events or choices.onsets or choices.sections or choices.downbeats) then
    R.message("Nothing chosen to add.")
    return
  end
  local cli = R.require_cli()
  if not cli then return end
  R.with_documents(items, cli, { title = "Playhead: analysing for markers" }, function(entries, problems)
    if #entries == 0 then R.report_problems(problems, "No markers were added") return end
    add_markers(entries, choices, problems)
  end)
end

main()
