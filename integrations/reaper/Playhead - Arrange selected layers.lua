-- @description Playhead: arrange selected layers (punchier, bigger or cleaner)
-- @version 0.4.0
-- @author Daniel Sandner
-- @noindex
-- @about
--   For a sound built from layers (sub, body, transient, tail on items of their own): Playhead searches small moves
--   and gain changes of the layers for a punchier, bigger or cleaner whole, from the layers' analyses alone, and
--   offers the best few. Each is applied and played as you pick it; keep one, or go back to how it was.
--   Packaged by "Playhead - Analyse selected items.lua".

-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
--
-- The search is `playhead arrange` (Playhead.arrange): about 500 arrangements of the layers' documents, scored by the
-- measures of the combined sound (peak and rise, contrast, focus, low end, coverage, harshness), kept apart from
-- each other. A locked item (Item properties: Lock) stays where it is; without one, the loudest layer stays.
-- Items that play backwards, at another rate or loop their source are left out (with a note).

local source = debug.getinfo(1, "S").source
local dir = source:match("^@?(.*[/\\])") or ""
package.path = dir .. "lib/?.lua;" .. package.path
local ok, R = pcall(require, "playhead_reaper")
if not ok then
  reaper.ShowMessageBox("Playhead's library files could not be loaded from\n" .. dir .. "lib\n\n" .. tostring(R), "Playhead", 0)
  return
end
local core = R.core
local TITLE = "Playhead: arrange layers"
local PLAY, STOP = 1007, 1016                             -- Transport: Play, Transport: Stop

local function ask()
  return R.form("arrange", TITLE, {
    { key = "goal", caption = "Goal", default = "punch", kind = "choice", choices = { "punch", "big", "clean" } },
    { key = "range", caption = "Move each layer by up to (ms)", default = 250, kind = "number", min = 5, max = 2000 },
    { key = "lo", caption = "Lower its gain by up to (dB)", default = 6, kind = "number", min = 0, max = 24 },
    { key = "hi", caption = "Raise its gain by up to (dB)", default = 3, kind = "number", min = 0, max = 12 },
    { key = "play", caption = "Play each one as you pick it", default = true, kind = "bool" },
  })
end

-- the layers as parts: what each item plays of its analysed file, on one axis
local function layers(entries, cli, problems)
  local list, names, seen = {}, {}, {}
  local profile = R.profile_for(cli.settings)
  for _, e in ipairs(entries) do
    local info = e.info
    local part, why = core.item_part(info.map)
    if not part then problems[#problems + 1] = info.name .. " is left out: " .. why
    else
      local vol = math.abs(reaper.GetMediaItemInfo_Value(info.item, "D_VOL") * reaper.GetMediaItemTakeInfo_Value(info.take, "D_VOL"))
      part.gain = vol > 0 and 20 * math.log(vol, 10) or -150
      part.lock = (math.floor(reaper.GetMediaItemInfo_Value(info.item, "C_LOCK") or 0) & 1) == 1
      part.doc = R.cache_path(info, cli, profile)
      local name = info.name
      seen[name] = (seen[name] or 0) + 1
      if seen[name] > 1 then name = name .. " (" .. seen[name] .. ")" end
      list[#list + 1] = { info = info, part = part, pos = info.map.pos, vol = reaper.GetMediaItemInfo_Value(info.item, "D_VOL") }
      names[#names + 1] = name
    end
  end
  return list, names
end

local function set_layers(list, moves)
  for k, l in ipairs(list) do
    local mv = moves and moves[k] or { dt = 0, db = 0 }
    reaper.SetMediaItemInfo_Value(l.info.item, "D_POSITION", l.pos + mv.dt)
    reaper.SetMediaItemInfo_Value(l.info.item, "D_VOL", l.vol * 10 ^ (mv.db / 20))
  end
  reaper.UpdateArrange()
end

-- where the layers are heard, in project time, for one candidate's moves
local function span(list, moves)
  local a, b = math.huge, -math.huge
  for k, l in ipairs(list) do
    local dt = moves and moves[k] and moves[k].dt or 0
    a = math.min(a, l.pos + dt)
    b = math.max(b, l.pos + l.info.map.len + dt)
  end
  return a, b
end

local function audition(list, names, sent, result, choices)
  local cands = result.candidates or {}
  local base = result.baseline or {}
  local current, playing_until, wait_from = 0, nil, nil
  local cursor = reaper.GetCursorPosition()
  local function moves_of(i) return i > 0 and core.arrange_moves(sent, cands[i]) or nil end
  local function play(i)
    if not choices.play then return end
    local a, b = span(list, moves_of(i))
    reaper.Main_OnCommand(STOP, 0)
    reaper.SetEditCurPos(math.max(0, a - 0.05), false, false)
    reaper.Main_OnCommand(PLAY, 0)
    playing_until, wait_from = math.min(b, a + 6) + 0.15, reaper.time_precise()
  end
  local function finish(keep)
    if playing_until then reaper.Main_OnCommand(STOP, 0) end
    if choices.play then reaper.SetEditCurPos(cursor, false, false) end
    set_layers(list, nil)                                  -- as it was; the kept one is applied in one undo block
    if keep and keep > 0 then
      local mv = moves_of(keep)
      R.undoable("Playhead: arrange layers (" .. choices.goal .. ")", function() set_layers(list, mv) end)
      R.log(string.format("Playhead arrange (%s): kept %d of %d, score %.2f (rough %.2f): %s\n", choices.goal, keep, #cands,
        cands[keep].score or 0, base.score or 0, core.arrange_changes(cands[keep], names)))
    end
  end
  local function menu()
    local entries = { { label = string.format("Goal: %s. Rough placement scores %.2f", choices.goal, base.score or 0), disabled = true }, { separator = true } }
    for i, c in ipairs(cands) do
      entries[#entries + 1] = { label = string.format("%d.  %.2f  %s", i, c.score or 0, core.arrange_changes(c, names)), checked = i == current, value = i }
    end
    entries[#entries + 1] = { separator = true }
    entries[#entries + 1] = { label = "Play again", value = "again", disabled = not choices.play }
    entries[#entries + 1] = { label = "Keep this one", value = "keep", disabled = current == 0 }
    entries[#entries + 1] = { label = "Back to how it was", value = "back" }
    local text, by_number = R.build_menu(entries)
    local e = by_number[R.menu(text)]
    return e and e.value
  end
  local function step()
    -- let the arrangement play before asking again
    if playing_until and (reaper.GetPlayState() or 0) & 1 == 1 and reaper.GetPlayPosition() < playing_until
      and reaper.time_precise() - wait_from < 8 then return reaper.defer(step) end
    if playing_until then reaper.Main_OnCommand(STOP, 0); playing_until = nil end
    local v = menu()
    if v == nil or v == "back" then return finish(nil) end
    if v == "keep" then return finish(current) end
    if v ~= "again" then current = v; set_layers(list, moves_of(current)) end
    play(current)
    reaper.defer(step)
  end
  reaper.defer(step)
end

local function search(entries, cli, choices, problems)
  local list, names = layers(entries, cli, problems)
  if #list < 2 then
    problems[#problems + 1] = "arranging needs two layers or more"
    return R.report_problems(problems, "Nothing to arrange")
  end
  local range = choices.range / 1000
  local sent = {}
  for k, l in ipairs(list) do sent[k] = l.part end
  core.arrange_axis(sent, range + 0.05)
  local json = {}
  for k, p in ipairs(sent) do json[k] = { doc = p.doc, offset = p.offset, gain = p.gain, start = p.start, ["end"] = p.stop, lock = p.lock } end
  local file = R.join(R.jobs_dir(), string.format("arrange-%d-%04d.json", os.time(), math.random(0, 9999)))
  if not R.write_file(file, core.json_encode(json)) then return R.message("Could not write " .. file, TITLE) end
  local spec = {
    argv = cli.argv({ "arrange", "--parts", file, "--goal", choices.goal, "--range", core.num(range, 4),
      "--gains", core.num(-choices.lo, 2) .. "," .. core.num(choices.hi, 2), "--count", "6" }),
    label = "Searching arrangements of " .. #list .. " layers", estimate = 2, timeout = 120, extra_path = cli.extra_path
  }
  R.run_queue({ spec }, { title = TITLE, on_done = function(results, cancelled)
    os.remove(file)
    local res = results[1] or {}
    if cancelled then return end
    local result = res.ok and core.json_decode(res.stdout or "")
    if type(result) ~= "table" then
      problems[#problems + 1] = "the search did not work: " .. core.explain_failure(res.code, res.stderr or "", { os = R.os, exe = spec.argv[1] })
      return R.report_problems(problems, "No arrangements")
    end
    if #(result.candidates or {}) == 0 then
      problems[#problems + 1] = "no arrangement within these limits scores better for " .. choices.goal .. " than the layers as they are"
      return R.report_problems(problems, "No better arrangement")
    end
    if #problems > 0 then R.report_problems(problems, "Arranging, with notes") end
    audition(list, names, sent, result, choices)
  end })
end

local function main()
  local items = R.selected_items()
  if #items < 2 then R.message("Select the layers of one sound (two items or more) first.", TITLE) return end
  local choices = ask()
  if not choices then return end
  local cli = R.require_cli()
  if not cli then return end
  R.with_documents(items, cli, { title = "Playhead: analysing the layers" }, function(entries, problems)
    search(entries, cli, choices, problems)
  end)
end

main()
