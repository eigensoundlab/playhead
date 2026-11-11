-- @description Playhead: process selected items with a Playhead tool (each result as a new take)
-- @version 0.4.0
-- @author Daniel Sandner
-- @noindex
-- @about
--   Runs one of Playhead's analysis-driven tools (de-harsh, layer remix, attack and body, reverb on the tails,
--   drive the hits, ring time, level the events, fold to mono, widen the tails, ...) on the selected items' files
--   and adds each result as a new take in the same item, named after the tool; the original take is kept. The
--   tools and their parameters come from the command line itself, so new tools appear here without an update.
--   Packaged by "Playhead - Analyse selected items.lua".

-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
--
-- Results are written to the project's media folder, in a folder called Playhead. Each tool's report is printed
-- to the ReaScript console. Switch between the original and the processed takes to compare them.

local source = debug.getinfo(1, "S").source
local dir = source:match("^@?(.*[/\\])") or ""
package.path = dir .. "lib/?.lua;" .. package.path
local ok, R = pcall(require, "playhead_reaper")
if not ok then
  reaper.ShowMessageBox("Playhead's library files could not be loaded from\n" .. dir .. "lib\n\n" .. tostring(R), "Playhead", 0)
  return
end
local core = R.core

local function choose_tool(tools)
  local last = R.get("last_tool", "")
  local kinds, order = {}, {}
  for _, t in ipairs(tools) do
    local k = t.kind ~= "" and t.kind or "Other"
    if not kinds[k] then kinds[k] = {}; order[#order + 1] = k end
    table.insert(kinds[k], t)
  end
  local entries = {}
  for i, k in ipairs(order) do
    if i > 1 then entries[#entries + 1] = { separator = true } end
    entries[#entries + 1] = { label = k, disabled = true }
    for _, t in ipairs(kinds[k]) do entries[#entries + 1] = { label = "   " .. t.name, checked = t.id == last, value = t } end
  end
  local menu, by_number = R.build_menu(entries)
  local n = R.menu(menu)
  local e = by_number[n]
  if not e or not e.value then return nil end
  R.set("last_tool", e.value.id)
  return e.value
end

local function ask_params(tool, doc)
  local remembered = R.get_json("tool:" .. tool.id, {})
  local dialog = core.tool_dialog(tool, remembered, doc)
  if #dialog.fields == 0 then return dialog, {} end
  while true do
    local v = R.dialog(dialog.title, dialog.fields, 100)
    if not v then return nil end
    local params, problems = core.parse_tool_inputs(dialog, v)
    for i, f in ipairs(dialog.fields) do f.default = v[i] end
    if #problems == 0 then
      R.set_json("tool:" .. tool.id, params)
      return dialog, params
    end
    R.message("Please check:\n- " .. table.concat(problems, "\n- "))
  end
end

--- Adds the rendered files as new takes of every item that plays this file; the first becomes the active take. A tool
--- that changes the length (Stretch keeping the attacks) scales the take's start and the item's length with it, so the
--- item plays the same part of the sound, stretched.
local function add_takes(tool, files, infos, notes)
  local count = #files
  for _, info in ipairs(infos) do
    local stretch = tool.id == "stretch" and files[1].len and info.file_len and info.file_len > 0 and files[1].len / info.file_len or nil
    local item, old = info.item, info.take
    local m = info.map
    local offs = m.offs
    if #m.sections > 0 then
      -- the new take plays the file forwards: start it at the earlier file end of the part the take plays (for a
      -- reversed take that is where its playback ends)
      local a, z = core.source_to_file(m, m.offs), core.source_to_file(m, m.offs + m.len * m.rate)
      offs = math.max(0, math.min(a, z))
      if m.reversed then notes[#notes + 1] = info.name .. ": the take plays its file reversed; the new takes play the same part forwards" end
    end
    if tool.id == "loop" then offs = 0 end
    if stretch then offs = offs * stretch end
    local first
    for k, f in ipairs(files) do
      local take = reaper.AddTakeToMediaItem(item)
      local src = reaper.PCM_Source_CreateFromFile(f.path)
      if take and src then
        reaper.SetMediaItemTake_Source(take, src)
        reaper.GetSetMediaItemTakeInfo_String(take, "P_NAME", core.take_name(tool, f.suffix, count), true)
        for _, key in ipairs({ "D_VOL", "D_PAN", "D_PANLAW", "D_PLAYRATE", "D_PITCH", "B_PPITCH", "I_CHANMODE" }) do
          reaper.SetMediaItemTakeInfo_Value(take, key, reaper.GetMediaItemTakeInfo_Value(old, key))
        end
        reaper.SetMediaItemTakeInfo_Value(take, "D_STARTOFFS", offs)
        first = first or take
      else
        notes[#notes + 1] = info.name .. ": could not add " .. core.basename(f.path)
      end
    end
    if first then
      if reaper.SetActiveTake then reaper.SetActiveTake(first)
      else reaper.SetMediaItemInfo_Value(item, "I_CURTAKE", reaper.CountTakes(item) - count) end
      if stretch then
        local len = reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
        reaper.SetMediaItemInfo_Value(item, "D_LENGTH", len * stretch)
        notes[#notes + 1] = string.format("%s: the item is now %.2f s long (x%.2f), to play the stretched takes; the other takes keep their timing",
          info.name, len * stretch, stretch)
      end
    end
    reaper.UpdateItemInProject(item)
  end
end

local function main()
  local items = R.selected_items()
  if #items == 0 then R.message("Select one or more audio items first.") return end
  local cli = R.require_cli()
  if not cli then return end
  local tools, terr = R.tools(cli)
  if not tools then R.message("The list of Playhead's tools could not be read.\n\n" .. tostring(terr)) return end
  local by_file, files, problems = {}, {}, {}
  for _, item in ipairs(items) do
    local info, err = R.take_info(item)
    if not info then problems[#problems + 1] = err
    else
      if not by_file[info.file] then by_file[info.file] = {}; files[#files + 1] = info.file end
      table.insert(by_file[info.file], info)
    end
  end
  if #files == 0 then R.report_problems(problems, "Nothing to process") return end
  local tool = choose_tool(tools)
  if not tool then return end
  local first = by_file[files[1]][1]
  local doc = R.cached_document(first, cli, R.profile_for(cli.settings))
  local dialog, params = ask_params(tool, doc)
  if not dialog then return end
  local args = core.tool_args(dialog, params)
  local final_dir = R.render_dir()
  R.mkdir(final_dir)
  local specs = {}
  for i, file in ipairs(files) do
    local info = by_file[file][1]
    local out_dir = R.join(final_dir, ".render-" .. os.time() .. "-" .. i .. "-" .. math.random(0, 99999))
    local a = { "process", file, "--tool", tool.id }
    for _, x in ipairs(args) do a[#a + 1] = x end
    a[#a + 1] = "--out-dir"; a[#a + 1] = out_dir
    specs[i] = { argv = cli.argv(a), extra_path = cli.extra_path, timeout = cli.settings.timeout,
      label = tool.name .. ": " .. core.basename(file), estimate = core.estimate_seconds(info.file_len, "sfx", "process"),
      file = file, out_dir = out_dir }
  end
  R.run_queue(specs, { title = "Playhead: " .. tool.name, on_done = function(results, cancelled)
    local notes, added = {}, 0
    R.undoable("Playhead: " .. tool.name, function()
      for i, spec in ipairs(specs) do
        local res = results[i] or { ok = false, cancelled = true }
        local name = core.basename(spec.file)
        if res.ok then
          local outs = {}
          for _, p in ipairs(core.written_files(res.stderr)) do
            local final = R.unique_path(final_dir, core.basename(p))
            local moved, merr = R.move(p, final)
            if moved then outs[#outs + 1] = { path = final, suffix = core.output_suffix(p, spec.file) }
            else problems[#problems + 1] = name .. ": " .. tostring(merr) end
          end
          R.remove_empty_dir(spec.out_dir)
          if #outs == 0 then problems[#problems + 1] = name .. ": the tool wrote no files"
          else
            local src_len = by_file[spec.file][1].file_len
            for _, o in ipairs(outs) do
              local s = reaper.PCM_Source_CreateFromFile(o.path)
              if s then
                o.len = reaper.GetMediaSourceLength(s)
                reaper.PCM_Source_Destroy(s)
                if tool.id ~= "stretch" and o.len and src_len and o.len > src_len + 0.01 then
                  notes[#notes + 1] = string.format("%s is %.2f s longer than the original; lengthen the item to hear all of it", core.basename(o.path), o.len - src_len)
                end
              end
            end
            add_takes(tool, outs, by_file[spec.file], notes)
            added = added + #outs
            local report = core.trim(res.stdout)
            R.log("Playhead " .. tool.name .. " on " .. name .. " (" .. table.concat(args, " ") .. ")\n  " ..
              report:gsub("\n", "\n  ") .. "\n  new takes: " .. #outs .. " in " .. final_dir .. "\n")
          end
        elseif res.cancelled then
          problems[#problems + 1] = name .. ": stopped waiting (a result that arrives later is not added)"
        elseif res.timed_out then
          problems[#problems + 1] = name .. ": did not finish within " .. math.floor(cli.settings.timeout) .. " s"
        else
          problems[#problems + 1] = name .. ": " .. core.explain_failure(res.code, res.stderr, { file = spec.file, os = R.os, exe = cli.exe })
        end
      end
    end)
    if tool.id == "loop" and added > 0 then notes[#notes + 1] = "Loop maker: the new takes start at the loop's start (offset 0)" end
    for _, n in ipairs(notes) do problems[#problems + 1] = n end
    R.report_problems(problems, added > 0 and (tool.name .. ": done, with notes") or (tool.name .. ": no takes were added"))
  end })
end

main()
