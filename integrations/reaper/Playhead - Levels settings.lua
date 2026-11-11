-- @description Playhead: levels settings for this project (measure, target, amount, depth, limits, rules)
-- @version 0.3.1
-- @author Daniel Sandner
-- @noindex
-- @about
--   The project's settings for "Playhead - Level items": the measure, the target, how much of the levelling to
--   apply, how deep the hierarchy of groups is, where group offsets go, the limits, and the tag rules.
--   Packaged by "Playhead - Analyse selected items.lua".

-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
--
-- Kept in the project file. A setting left as it is in the manifest (playhead-levels.json) is still the project's
-- choice: these override a manifest's levels. Rules come from a playhead-levels.json chosen here, or, when none is
-- chosen, from each sound's own manifest. Run "Playhead - Level items" afterwards: it recomputes every gain from the
-- measures kept on the takes.

local source = debug.getinfo(1, "S").source
local dir = source:match("^@?(.*[/\\])") or ""
package.path = dir .. "lib/?.lua;" .. package.path
local ok, R = pcall(require, "playhead_reaper")
if not ok then
  reaper.ShowMessageBox("Playhead's library files could not be loaded from\n" .. dir .. "lib\n\n" .. tostring(R), "Playhead", 0)
  return
end
local core = R.core

local function describe_rules(rules)
  local out = {}
  for i, r in ipairs(rules or {}) do
    if i > 12 then out[#out + 1] = "  ... " .. (#rules - 12) .. " more" break end
    out[#out + 1] = string.format("  %s %s%s%s", r.on == false and "(off)" or "", tostring(r.tag), r.role and r.role ~= "group" and (" (" .. r.role .. ")") or "",
      tonumber(r.offset) and string.format(" %+g dB", tonumber(r.offset)) or "")
  end
  return table.concat(out, "\n")
end

local function main()
  local own = R.levels_project()
  local S = core.levels_settings(nil, own.levels)
  local fields = {
    { caption = "Measure (e.g. momentaryMax@event)", default = S.measure },
    { caption = "Target (LUFS or dBFS)", default = core.num(S.target, 2) },
    { caption = "Amount of levelling (0 to 1)", default = core.num(S.amount, 3) },
    { caption = "Depth of the groups' offsets (0 to 2)", default = core.num(S.depth, 3) },
    { caption = "Group offsets on (take/track)", default = S.place },
    { caption = "Most boost (dB)", default = core.num(S.limits.boost, 2) },
    { caption = "Most cut (dB)", default = core.num(S.limits.cut, 2) },
    { caption = "True-peak ceiling (dBTP)", default = core.num(S.limits.truePeak, 2) },
  }
  local levels
  while true do
    local v = R.dialog("Playhead: levels settings", fields, 120)
    if not v then return end
    for i = 1, #fields do fields[i].default = v[i] end
    local measure, place = core.trim(v[1]), core.trim(v[5]):lower()
    local target, amount, depth = tonumber(v[2]), tonumber(v[3]), tonumber(v[4])
    local boost, cut, tp = tonumber(v[6]), tonumber(v[7]), tonumber(v[8])
    local bad = {}
    local _, merr = core.levels_parse_measure(measure)
    if merr then bad[#bad + 1] = merr end
    if not target or target < -70 or target > 0 then bad[#bad + 1] = "target: a number from -70 to 0" end
    if not amount or amount < 0 or amount > 1 then bad[#bad + 1] = "amount: a number from 0 to 1" end
    if not depth or depth < 0 or depth > 2 then bad[#bad + 1] = "depth: a number from 0 to 2" end
    if place ~= "take" and place ~= "track" then bad[#bad + 1] = "group offsets on: take or track" end
    if not boost or boost < 0 or boost > 60 then bad[#bad + 1] = "most boost: 0 to 60 dB" end
    if not cut or cut < 0 or cut > 100 then bad[#bad + 1] = "most cut: 0 to 100 dB" end
    if not tp or tp > 0 or tp < -30 then bad[#bad + 1] = "true-peak ceiling: -30 to 0 dBTP" end
    if #bad == 0 then
      levels = { measure = measure, target = target, amount = amount, depth = depth, place = place, limits = { boost = boost, cut = cut, truePeak = tp } }
      break
    end
    R.message("Please check:\n  " .. table.concat(bad, "\n  "), "Playhead: levels settings")
  end
  own.levels = levels
  -- the rules: from a file chosen here, or each sound's own manifest
  local now = (type(own.rules) == "table" and #own.rules > 0)
    and ("This project uses " .. #own.rules .. " rule" .. (#own.rules == 1 and "" or "s") .. " from " .. tostring(own.rules_from or "a file") .. ":\n" .. describe_rules(own.rules))
    or "This project uses the rules of each sound's own playhead-levels.json."
  local answer = reaper.ShowMessageBox(now .. "\n\nYes: take the rules from a playhead-levels.json file.\nNo: use each sound's own manifest.\nCancel: keep the rules as they are.",
    "Playhead: levels rules", 3)
  if answer == 6 then
    local okf, file = reaper.GetUserFileNameForRead("", "Rules for this project (playhead-levels.json)", "json")
    if okf and file and file ~= "" then
      local okj, spec = pcall(core.json_decode, R.read_file(file) or "")
      if not okj or type(spec) ~= "table" or spec.format ~= core.LEVELS_FORMAT then
        R.message("That file is not a playhead-levels.json file; the rules were not changed.")
      elseif type(spec.rules) ~= "table" or #spec.rules == 0 then
        R.message("That file has no rules; the rules were not changed.")
      else
        own.rules, own.rules_from = spec.rules, file
        if type(spec.checks) == "table" then own.checks = spec.checks end
      end
    end
  elseif answer == 7 then
    own.rules, own.rules_from = nil, nil
  end
  R.levels_set_project(own)
  R.log(string.format("Playhead levels settings for this project: measure %s, target %s, amount %s, depth %s, group offsets on %s, limits +%s / -%s dB, true peak %s dBTP. %s\n",
    levels.measure, core.num(levels.target, 2), core.num(levels.amount, 3), core.num(levels.depth, 3), levels.place, core.num(levels.limits.boost, 2),
    core.num(levels.limits.cut, 2), core.num(levels.limits.truePeak, 2),
    (type(own.rules) == "table" and #own.rules > 0) and (#own.rules .. " rules from " .. tostring(own.rules_from)) or "Rules: each sound's own manifest."))
end

main()
