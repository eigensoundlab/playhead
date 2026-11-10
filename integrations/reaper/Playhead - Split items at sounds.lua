-- @description Playhead: split items at sounds (events or onsets), named, trimmed, with regions
-- @version 0.3.0
-- @author Daniel Sandner
-- @noindex
-- @about
--   Splits each selected item into its sounds: a cut a few milliseconds before each event (or onset), so no attack
--   is cut. Each piece can be named after its sound ("robot 03 tonal hit"), shortened to where its sound has
--   decayed, with a short fade, and given a region of the same name, ready for the region render matrix: one file
--   per sound. Packaged by "Playhead - Analyse selected items.lua".

-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
--
-- Events are Playhead's sound objects (an attack and its decay; a word such as "tonal hit" or "noise burst"); onsets
-- are every attack, closer together. Shortening uses the events' decay, so onsets split without shortening. Pieces
-- before the first sound (the item starts during an earlier one) are left as they are. Items that play backwards
-- are not split.

local source = debug.getinfo(1, "S").source
local dir = source:match("^@?(.*[/\\])") or ""
package.path = dir .. "lib/?.lua;" .. package.path
local ok, R = pcall(require, "playhead_reaper")
if not ok then
  reaper.ShowMessageBox("Playhead's library files could not be loaded from\n" .. dir .. "lib\n\n" .. tostring(R), "Playhead", 0)
  return
end
local core = R.core
local TITLE = "Playhead: split items at sounds"

local function ask()
  return R.form("split", TITLE, {
    { key = "kind", caption = "Split at", default = "events", kind = "choice", choices = { "events", "onsets" } },
    { key = "pre", caption = "Cut before each sound (ms)", default = 5, kind = "number", min = 0, max = 200 },
    { key = "gap", caption = "Shortest piece (ms)", default = 60, kind = "number", min = 5, max = 10000 },
    { key = "trim", caption = "End each piece where its sound has decayed", default = true, kind = "bool" },
    { key = "tail", caption = "Keep after the decay, faded (ms)", default = 60, kind = "number", min = 0, max = 2000 },
    { key = "names", caption = "Name the pieces after their sounds", default = true, kind = "bool" },
    { key = "regions", caption = "A region for each piece", default = false, kind = "bool" },
  })
end

local function split(entries, choices, problems)
  local lines, pieces_made, regions = {}, 0, 0
  R.undoable("Playhead: split items at sounds", function()
    local done = {}
    for _, e in ipairs(entries) do
      local info = e.info
      if not done[info.item] then
        done[info.item] = true
        local plan, why = core.split_plan(e.doc, info.map, { kind = choices.kind, pre = choices.pre / 1000, min_gap = choices.gap / 1000 })
        if not plan then problems[#problems + 1] = info.name .. ": " .. why
        elseif #plan.cuts == 0 and plan.sounds <= 1 then problems[#problems + 1] = info.name .. ": one sound or none, nothing to split"
        else
          -- split from the last cut back, so the item to split is always the left one
          local items = { info.item }
          for i = #plan.cuts, 1, -1 do
            local right = reaper.SplitMediaItem(info.item, plan.cuts[i])
            if right then table.insert(items, 2, right) end
          end
          if #items ~= #plan.pieces then problems[#problems + 1] = info.name .. ": " .. (#items - 1) .. " of " .. #plan.cuts .. " splits made" end
          local base = info.name:gsub("%.[%w]+$", "")
          local n, digits = 0, #plan.pieces >= 100 and 3 or 2
          for k, item in ipairs(items) do
            local p = plan.pieces[k]
            if p and p.sounds > 0 then
              n = n + 1
              local stop = p.stop
              if choices.trim and p.sound_end then
                local want = p.sound_end + choices.tail / 1000
                if want < p.stop - 1e-4 then
                  stop = want
                  reaper.SetMediaItemInfo_Value(item, "D_LENGTH", stop - p.start)
                  reaper.SetMediaItemInfo_Value(item, "D_FADEOUTLEN", math.min(choices.tail / 1000, (stop - p.start) / 2))
                end
              end
              local name = string.format("%s %0" .. digits .. "d %s", base, n, p.name or "sound")
              if choices.names then
                local take = reaper.GetActiveTake(item)
                if take then reaper.GetSetMediaItemTakeInfo_String(take, "P_NAME", name, true) end
              end
              if choices.regions and reaper.AddProjectMarker2(0, true, p.start, stop, name, -1, 0) >= 0 then regions = regions + 1 end
            end
            reaper.UpdateItemInProject(item)
          end
          pieces_made = pieces_made + #items
          lines[#lines + 1] = string.format("%s: %d pieces, %d with a sound of their own%s", info.name, #items, n,
            choices.regions and (", " .. n .. " regions") or "")
        end
      end
    end
  end)
  if #lines > 0 then R.log("Playhead split (" .. choices.kind .. ")\n  " .. table.concat(lines, "\n  ") .. "\n") end
  if pieces_made == 0 and #problems == 0 then problems[#problems + 1] = "nothing to split" end
  R.report_problems(problems, pieces_made > 0 and "Split, with notes" or "Nothing was split")
end

local function main()
  local items = R.selected_items()
  if #items == 0 then R.message("Select one or more audio items first.", TITLE) return end
  local choices = ask()
  if not choices then return end
  local cli = R.require_cli()
  if not cli then return end
  R.with_documents(items, cli, { title = "Playhead: analysing to split" }, function(entries, problems)
    if #entries == 0 then return R.report_problems(problems, "Nothing was split") end
    split(entries, choices, problems)
  end)
end

main()
