-- SPDX-License-Identifier: Apache-2.0
-- Copyright 2026 Daniel Sandner
-- @noindex
--
-- Playhead for REAPER: the core. Pure Lua 5.4 with no REAPER API, so every part is tested outside REAPER
-- (test/run_tests.py). The REAPER layer (playhead_reaper.lua) and the action scripts call into it.
--
--   JSON decoder               M.json_decode(text), M.json_encode(value), M.null
--   document model             M.load_document(text), M.curve_names(doc), M.curve_at(doc, name, t, fallback)
--   time mapping (take)        M.take_map{...}, M.project_to_file(m, T), M.file_to_project(m, f), ...
--   automation                 M.sample_curve(doc, name, m, opts), M.reduce_points(points, tol, max)
--   markers                    M.marker_plan(doc, m, kinds)
--   looks and strip            M.parse_look(code), M.describe_look(layers, doc), M.render_strip(doc, sink, opts)
--   command lines              M.quote_posix(arg), M.quote_windows(arg), M.quote_batch(arg), M.job_script(spec)
--   cache keys                 M.cache_key{ path, size, length, profile, version, os }
--   processing tools           M.parse_tools(text), M.tool_dialog(tool, remembered), M.parse_tool_inputs(...)

local M = { VERSION = "0.1.0", SCHEMA = "playhead-analysis", SCHEMA_VERSION = 1 }

local floor, ceil, abs, max, min, huge = math.floor, math.ceil, math.abs, math.max, math.min, math.huge
local byte, sub, find, fmt, rep = string.byte, string.sub, string.find, string.format, string.rep
local concat, insert, sort = table.concat, table.insert, table.sort

------------------------------------------------------------------------------------------------------------------------
-- small helpers
------------------------------------------------------------------------------------------------------------------------
local function trim(s) return (tostring(s or ""):gsub("^%s+", ""):gsub("%s+$", "")) end
M.trim = trim
local function clamp(v, lo, hi) if v < lo then return lo elseif v > hi then return hi else return v end end
M.clamp = clamp
local function round(v) return floor(v + 0.5) end           -- like JavaScript's Math.round
M.round = round

--- Splits s at every occurrence of the plain separator sep (empty fields kept).
function M.split(s, sep)
  local out, i = {}, 1
  s = tostring(s or "")
  if sep == "" then return { s } end
  while true do
    local a, b = find(s, sep, i, true)
    if not a then out[#out + 1] = sub(s, i); return out end
    out[#out + 1] = sub(s, i, a - 1)
    i = b + 1
  end
end

function M.parse_bool(s, default)
  local v = trim(s):lower()
  if v == "yes" or v == "y" or v == "true" or v == "on" or v == "1" then return true end
  if v == "no" or v == "n" or v == "false" or v == "off" or v == "0" then return false end
  return default
end
function M.yesno(b) return b and "yes" or "no" end

--- A number as short text: up to `digits` decimals, trailing zeros dropped.
function M.num(v, digits)
  if type(v) ~= "number" then return tostring(v) end
  if v == floor(v) and abs(v) < 1e15 then return fmt("%d", floor(v)) end
  local s = fmt("%." .. (digits or 4) .. "f", v):gsub("0+$", ""):gsub("%.$", "")
  if s == "-0" then s = "0" end
  return s
end

------------------------------------------------------------------------------------------------------------------------
-- paths
------------------------------------------------------------------------------------------------------------------------
function M.os_kind(os_string)
  local s = tostring(os_string or "")
  if s:find("^Win") then return "windows" end
  if s:find("^OSX") or s:find("^macOS") then return "macos" end
  return "linux"
end
function M.path_sep(os) return os == "windows" and "\\" or "/" end
function M.path_join(os, ...)
  local sep, out = M.path_sep(os), nil
  for _, p in ipairs({ ... }) do
    p = tostring(p)
    if p ~= "" then
      if not out then out = p
      else out = out:gsub("[/\\]+$", "") .. sep .. p:gsub("^[/\\]+", "") end
    end
  end
  return out or ""
end
function M.basename(p) return (tostring(p):match("([^/\\]*)$")) end
function M.dirname(p) local d = tostring(p):match("^(.*)[/\\][^/\\]*$"); return d or "" end
function M.stem(p) local b = M.basename(p); return (b:gsub("%.[^.]*$", "")) end
function M.extension(p) local e = M.basename(p):match("%.([^.]+)$"); return e and e:lower() or "" end
function M.is_absolute(p)
  p = tostring(p or "")
  return p:sub(1, 1) == "/" or p:find("^%a:[/\\]") ~= nil or p:sub(1, 2) == "\\\\"
end
--- A file name made of safe characters only (letters, digits, - and _), at most n bytes.
function M.safe_name(s, n)
  local out = tostring(s or ""):gsub("[^%w%-_]+", "_"):gsub("^_+", ""):gsub("_+$", "")
  if out == "" then out = "sound" end
  return out:sub(1, n or 40)
end

------------------------------------------------------------------------------------------------------------------------
-- JSON (RFC 8259). Objects become tables, arrays become sequences. A null inside an array becomes M.null, so arrays
-- keep their length and positions; a null object member is left out (doc.rhythm == nil when the document has null).
------------------------------------------------------------------------------------------------------------------------
local NULL = setmetatable({}, { __tostring = function() return "null" end, __name = "playhead.null" })
M.null = NULL
function M.is_null(v) return v == nil or v == NULL end

local function json_error(str, pos, msg)
  local line, col, i = 1, 1, 1
  while true do
    local a = find(str, "\n", i, true)
    if not a or a >= pos then break end
    line = line + 1; i = a + 1
  end
  col = pos - i + 1
  error(fmt("JSON: %s at line %d, column %d", msg, line, col), 0)
end

local ESCAPES = { [34] = '"', [92] = "\\", [47] = "/", [98] = "\b", [102] = "\f", [110] = "\n", [114] = "\r", [116] = "\t" }
local decode_value

local function skip_ws(str, pos)
  local _, e = find(str, "^[ \t\r\n]*", pos)
  return e + 1
end

local function decode_string(str, pos)
  local i = pos + 1
  local a, b = find(str, '^[^"\\]*"', i)                  -- fast path: no escapes
  if a then return sub(str, i, b - 1), b + 1 end
  local parts, n = {}, 0
  while true do
    local q = find(str, '["\\]', i)
    if not q then json_error(str, pos, "unterminated string") end
    if q > i then n = n + 1; parts[n] = sub(str, i, q - 1) end
    if byte(str, q) == 34 then return concat(parts), q + 1 end
    local c = byte(str, q + 1)
    if c == 117 then                                      -- \uXXXX, with surrogate pairs
      local hex = sub(str, q + 2, q + 5)
      if not find(hex, "^%x%x%x%x$") then json_error(str, q, "bad \\u escape") end
      local cp, nexti = tonumber(hex, 16), q + 6
      if cp >= 0xD800 and cp <= 0xDBFF then
        if find(str, "^\\u[dD][c-fC-F]%x%x", nexti) then
          cp = 0x10000 + (cp - 0xD800) * 0x400 + (tonumber(sub(str, nexti + 2, nexti + 5), 16) - 0xDC00)
          nexti = nexti + 6
        else cp = 0xFFFD end
      elseif cp >= 0xDC00 and cp <= 0xDFFF then cp = 0xFFFD end
      n = n + 1; parts[n] = utf8.char(cp); i = nexti
    else
      local r = ESCAPES[c]
      if not r then json_error(str, q, "bad escape") end
      n = n + 1; parts[n] = r; i = q + 2
    end
  end
end

local function decode_number(str, pos)
  local a, b = find(str, "^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
  if not a then json_error(str, pos, "unexpected character '" .. sub(str, pos, pos) .. "'") end
  local v = tonumber(sub(str, a, b))
  if not v then json_error(str, pos, "bad number") end
  return v, b + 1
end

local function decode_array(str, pos, depth)
  local arr, n = {}, 0
  pos = skip_ws(str, pos + 1)
  if byte(str, pos) == 93 then return arr, pos + 1 end
  while true do
    local v
    v, pos = decode_value(str, pos, depth)
    n = n + 1
    if v == nil then arr[n] = NULL else arr[n] = v end
    pos = skip_ws(str, pos)
    local c = byte(str, pos)
    if c == 44 then pos = skip_ws(str, pos + 1)
    elseif c == 93 then return arr, pos + 1
    else json_error(str, pos, "expected ',' or ']'") end
  end
end

local function decode_object(str, pos, depth)
  local obj = {}
  pos = skip_ws(str, pos + 1)
  if byte(str, pos) == 125 then return obj, pos + 1 end
  while true do
    if byte(str, pos) ~= 34 then json_error(str, pos, "expected a member name") end
    local k
    k, pos = decode_string(str, pos)
    pos = skip_ws(str, pos)
    if byte(str, pos) ~= 58 then json_error(str, pos, "expected ':'") end
    local v
    v, pos = decode_value(str, skip_ws(str, pos + 1), depth)
    obj[k] = v                                            -- null members are left out
    pos = skip_ws(str, pos)
    local c = byte(str, pos)
    if c == 44 then pos = skip_ws(str, pos + 1)
    elseif c == 125 then return obj, pos + 1
    else json_error(str, pos, "expected ',' or '}'") end
  end
end

decode_value = function(str, pos, depth)
  local c = byte(str, pos)
  if c == 34 then return decode_string(str, pos) end
  if c == 123 or c == 91 then
    depth = (depth or 0) + 1
    if depth > 200 then json_error(str, pos, "nested too deeply") end
    if c == 123 then return decode_object(str, pos, depth) end
    return decode_array(str, pos, depth)
  end
  if c == 116 then if sub(str, pos, pos + 3) == "true" then return true, pos + 4 end
  elseif c == 102 then if sub(str, pos, pos + 4) == "false" then return false, pos + 5 end
  elseif c == 110 then if sub(str, pos, pos + 3) == "null" then return nil, pos + 4 end
  elseif c == nil then json_error(str, pos, "unexpected end of text") end
  return decode_number(str, pos)
end

--- Decodes JSON text. Raises an error with line and column on malformed input.
function M.json_decode(str)
  if type(str) ~= "string" then error("JSON: expected text, got " .. type(str), 0) end
  if sub(str, 1, 3) == "\239\187\191" then str = sub(str, 4) end   -- UTF-8 byte order mark
  local pos = skip_ws(str, 1)
  local v
  v, pos = decode_value(str, pos, 0)
  pos = skip_ws(str, pos)
  if pos <= #str then json_error(str, pos, "unexpected text after the value") end
  return v
end

local function encode_string(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    local r = ({ ['"'] = '\\"', ["\\"] = "\\\\", ["\b"] = "\\b", ["\f"] = "\\f", ["\n"] = "\\n", ["\r"] = "\\r", ["\t"] = "\\t" })[c]
    return r or fmt("\\u%04x", byte(c))
  end) .. '"'
end
--- Encodes plain values (tables with string keys become objects, sequences become arrays). Compact, one line.
function M.json_encode(v)
  local t = type(v)
  if v == nil or v == NULL then return "null" end
  if t == "boolean" then return tostring(v) end
  if t == "number" then
    if v ~= v or v == huge or v == -huge then return "null" end
    if math.type(v) == "integer" then return tostring(v) end
    return M.num(v, 10)
  end
  if t == "string" then return encode_string(v) end
  if t == "table" then
    local n = #v
    if n > 0 or next(v) == nil then
      local out = {}
      for i = 1, n do out[i] = M.json_encode(v[i]) end
      return "[" .. concat(out, ",") .. "]"
    end
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = tostring(k) end
    sort(keys)
    local out = {}
    for _, k in ipairs(keys) do out[#out + 1] = encode_string(k) .. ":" .. M.json_encode(v[k]) end
    return "{" .. concat(out, ",") .. "}"
  end
  error("JSON: cannot encode a " .. t, 0)
end

------------------------------------------------------------------------------------------------------------------------
-- the document (schema playhead-analysis, version 1)
------------------------------------------------------------------------------------------------------------------------
-- readable names of the curves, in menu order (as Playhead.curveLabels)
M.CURVE_ORDER = { "loudness", "activity", "arousal", "harshness", "tension", "harmonicTension", "surprise", "lufs",
  "onsetStrength", "structureNovelty", "localPulse", "n1Kurtosis", "n2RepetitionHz", "n4Velocity", "n5Cpp",
  "n5Coherence", "n6Arrow", "n7Surprisal", "n8Recurrence" }
M.CURVE_LABELS = {
  loudness = "loudness", activity = "activity", arousal = "arousal", harshness = "harshness", tension = "tension",
  harmonicTension = "harmonic tension", surprise = "novelty (spectral surprise)", lufs = "loudness (LUFS)",
  structureNovelty = "structural change", localPulse = "local pulse", onsetStrength = "onset strength (hits)",
  n1Kurtosis = "impulsiveness", n2RepetitionHz = "repetition rate", n4Velocity = "spectral motion", n5Cpp = "periodicity",
  n5Coherence = "phase coherence", n6Arrow = "time arrow", n7Surprisal = "surprisal", n8Recurrence = "recurrence"
}
-- the number each curve is known by in Playhead Control.jsfx (its hidden "source" sliders); 0 = another curve
M.CURVE_CODES = {}
for i, k in ipairs(M.CURVE_ORDER) do M.CURVE_CODES[k] = i end

function M.curve_label(name) return M.CURVE_LABELS[name] or tostring(name) end

--- Checks a decoded document. Returns doc, or nil and a message for the user.
function M.check_document(doc)
  if type(doc) ~= "table" or doc.schema ~= M.SCHEMA then return nil, "this is not a Playhead analysis document" end
  if type(doc.schemaVersion) ~= "number" then return nil, "the analysis document has no schema version" end
  if doc.schemaVersion > M.SCHEMA_VERSION then
    return nil, fmt("the analysis was made by a newer Playhead (schema version %s); update the REAPER scripts", M.num(doc.schemaVersion))
  end
  local src = doc.source
  if type(src) ~= "table" or type(src.duration) ~= "number" or src.duration <= 0 then return nil, "the analysis document has no duration" end
  local c = doc.curves
  if type(c) ~= "table" or type(c.rate) ~= "number" or c.rate <= 0 then return nil, "the analysis document has no curves" end
  if type(doc.wave) ~= "table" or type(doc.wave.min) ~= "table" or type(doc.wave.max) ~= "table" then return nil, "the analysis document has no waveform overview" end
  return doc
end

--- Decodes and checks a document. Returns doc, or nil and a message.
function M.load_document(text)
  local ok, doc = pcall(M.json_decode, text)
  if not ok then return nil, "the analysis file could not be read (" .. tostring(doc) .. ")" end
  return M.check_document(doc)
end

local function is_curve(v) return type(v) == "table" and v ~= NULL and #v > 0 end
--- Whether a curve has at least one value that is not null and not 0 (Playhead.lookFits uses the same test).
function M.curve_live(doc, name)
  local c = doc and doc.curves and doc.curves[name]
  if not is_curve(c) then return false end
  for i = 1, #c do local v = c[i]; if v ~= NULL and v ~= 0 then return true end end
  return false
end

--- The curves in a document, known ones in menu order, others after them alphabetically.
function M.curve_names(doc, live_only)
  local out, seen = {}, {}
  local curves = doc and doc.curves or {}
  for _, k in ipairs(M.CURVE_ORDER) do
    if is_curve(curves[k]) and (not live_only or M.curve_live(doc, k)) then out[#out + 1] = k; seen[k] = true end
  end
  local extra = {}
  for k, v in pairs(curves) do
    if not seen[k] and type(k) == "string" and is_curve(v) and (not live_only or M.curve_live(doc, k)) then extra[#extra + 1] = k end
  end
  sort(extra)
  for _, k in ipairs(extra) do out[#out + 1] = k end
  return out
end

--- Finds a curve by key ("n1Kurtosis") or label ("impulsiveness"), any case, or by a unique start of either.
function M.find_curve(doc, text)
  local q = trim(text):lower()
  if q == "" then return nil end
  local names, hits = M.curve_names(doc), {}
  for _, k in ipairs(names) do
    if k:lower() == q or M.curve_label(k):lower() == q then return k end
  end
  for _, k in ipairs(names) do
    if k:lower():sub(1, #q) == q or M.curve_label(k):lower():sub(1, #q) == q then hits[#hits + 1] = k end
  end
  if #hits == 1 then return hits[1] end
  return nil, hits
end

--- A curve's value at document time t (seconds), linearly interpolated; fallback where it is silent (null).
--- The same as Playhead.curveAt.
function M.curve_at(doc, name, t, fallback)
  local c = doc and doc.curves and doc.curves[name]
  if not is_curve(c) then return fallback end
  local n = #c
  local x = max(0, min(n - 1, t * doc.curves.rate - 0.5))
  local i = floor(x)
  local f = x - i
  local a, b = c[i + 1], c[min(n - 1, i + 1) + 1]
  if a == NULL and b == NULL then return fallback end
  if a == NULL then if f >= 0.5 then return b end return fallback end
  if b == NULL then if f < 0.5 then return a end return fallback end
  return a + (b - a) * f
end

local function sorted_values(arr, from, to)
  local v = {}
  for i = from or 1, to or #arr do local x = arr[i]; if x ~= NULL and x ~= nil then v[#v + 1] = x end end
  sort(v)
  return v
end
local function pct(v, p) return v[floor(p * (#v - 1)) + 1] end

--- The value range a curve is shown on: [0, 1] for the curves on fixed library-wide scales; the 5th-95th
--- percentile for the descriptor curves n1-n8 (as the strip); the 99th percentile for structural change and local
--- pulse; -60..0 LUFS for lufs.
function M.curve_scale(doc, name)
  local c = doc.curves[name]
  if not is_curve(c) then return 0, 1 end
  if name == "lufs" then return -60, 0 end
  local v = sorted_values(c)
  if #v == 0 then return 0, 1 end
  local lo, hi
  if name:find("^n%d") then lo, hi = pct(v, 0.05), pct(v, 0.95)
  elseif name == "structureNovelty" or name == "localPulse" then lo, hi = 0, max(0.05, pct(v, 0.99))
  else return 0, 1 end
  if hi - lo < 1e-9 then lo, hi = lo - 1, lo + 1 end
  return lo, hi
end

--- Short summary of a document, as lines of text for the console.
function M.describe_document(doc, label)
  local L = {}
  local s = doc.source or {}
  local head = fmt("%s: %s s, %s profile", label or s.name or "sound", M.num(s.duration or 0, 2), tostring(doc.profile))
  if doc.assetClass then head = head .. " (class " .. tostring(doc.assetClass) .. ")" end
  if doc.summary and type(doc.summary.peakLufs) == "number" then head = head .. fmt(", peak %.1f LUFS", doc.summary.peakLufs) end
  if doc.summary and type(doc.summary.loudnessRange) == "number" then head = head .. fmt(", range %.1f LU", doc.summary.loudnessRange) end
  L[#L + 1] = head
  if type(doc.events) == "table" then
    local ev = {}
    for i, e in ipairs(doc.events) do
      if i > 8 then ev[#ev + 1] = "..." break end
      ev[#ev + 1] = fmt("%s s %s %s", M.num(e.start or 0, 2), tostring(e.tag or ""), tostring(e.word or ""))
    end
    L[#L + 1] = fmt("  %d events%s%s", #doc.events, #ev > 0 and ": " or "", concat(ev, "; "))
  end
  if type(doc.onsets) == "table" then L[#L + 1] = fmt("  %d onsets", #doc.onsets) end
  if type(doc.rhythm) == "table" then
    L[#L + 1] = fmt("  tempo %s BPM (%s), %d beats, %d bars", M.num(doc.rhythm.tempo or 0, 1),
      doc.rhythm.reliable and "steady" or "no steady beat", #(doc.rhythm.beats or {}), #(doc.rhythm.downbeats or {}))
  end
  if type(doc.sections) == "table" and #doc.sections > 0 then
    local labs = {}
    for _, sec in ipairs(doc.sections) do labs[#labs + 1] = tostring(sec.label) end
    L[#L + 1] = "  sections: " .. concat(labs, " ")
  end
  if type(doc.issues) == "table" then
    for _, i in ipairs(doc.issues) do L[#L + 1] = fmt("  check (%s): %s", tostring(i.severity), tostring(i.text)) end
  end
  L[#L + 1] = "  curves: " .. concat(M.curve_names(doc, true), ", ")
  return L
end

------------------------------------------------------------------------------------------------------------------------
-- time mapping between the analysed file and the project, for one take
--
-- A take plays its source from D_STARTOFFS (source seconds) at D_PLAYRATE; the item sits at D_POSITION for D_LENGTH
-- project seconds. With "loop source" the source repeats when the item is longer than it. The take's source may be a
-- section of its parent (Item properties: section, or a reversed copy), possibly nested; sections are listed from the
-- take's source towards the file, each { offs, len, rev }. Times:
--   project time T  ->  take source time s = offs + (T - pos) * rate  (wrapped by the source length when looped)
--   take source s   ->  file time f, through the sections (a reversed section reads from its end)
-- Stretch markers are not followed (the REAPER layer warns about them).
------------------------------------------------------------------------------------------------------------------------
local EPS = 1e-9

--- Builds a mapping. t: pos, len (project s), offs (source s), rate, loop (bool), src_len (length of the take's own
--- source, after sections; nil or 0 = unknown), sections (list), file_len (length of the file, optional).
function M.take_map(t)
  local m = {
    pos = tonumber(t.pos) or 0, len = tonumber(t.len) or 0, offs = tonumber(t.offs) or 0, rate = tonumber(t.rate) or 1,
    loop = t.loop and true or false, src_len = tonumber(t.src_len), sections = {}, file_len = tonumber(t.file_len)
  }
  if not (m.rate > 0) then m.rate = 1 end
  if m.src_len and m.src_len <= 0 then m.src_len = nil end
  local rev = false
  for _, s in ipairs(t.sections or {}) do
    local sec = { offs = tonumber(s.offs) or 0, len = tonumber(s.len) or 0, rev = s.rev and true or false }
    m.sections[#m.sections + 1] = sec
    if sec.rev then rev = not rev end
  end
  m.reversed = rev
  return m
end

--- Take source time at project time T, or nil outside the item or the source.
function M.project_to_source(m, T)
  if T < m.pos - EPS or T > m.pos + m.len + EPS then return nil end
  local s = m.offs + (T - m.pos) * m.rate
  local L = m.src_len
  if L then
    if m.loop then s = s % L
    elseif s < -EPS or s > L + EPS then return nil end
  end
  return s
end

--- File time for a take source time (through the sections).
function M.source_to_file(m, s)
  local f = s
  for _, sec in ipairs(m.sections) do
    local L = sec.len
    if L <= 0 then L = (m.file_len or huge) - sec.offs end
    if sec.rev then f = sec.offs + (L - f) else f = sec.offs + f end
  end
  return f
end

--- File time at project time T, or nil.
function M.project_to_file(m, T)
  local s = M.project_to_source(m, T)
  if s == nil then return nil end
  return M.source_to_file(m, s)
end

--- Take source time for a file time, or nil when the take's sections do not include it.
function M.file_to_source(m, f)
  local s = f
  for i = #m.sections, 1, -1 do
    local sec = m.sections[i]
    local L = sec.len
    if L <= 0 then L = (m.file_len or huge) - sec.offs end
    local u = s - sec.offs
    if u < -EPS or u > L + EPS then return nil end
    s = sec.rev and (L - u) or u
  end
  return s
end

--- Project times (sorted) at which the take plays take source time s, inside the item: none, one, or one per loop.
function M.source_to_project(m, s, limit)
  local out, L = {}, m.src_len
  if m.loop and L then
    local kmin = ceil((m.offs - s) / L - 1e-9)
    local kmax = floor((m.offs + m.len * m.rate - s) / L + 1e-9)
    for k = kmin, min(kmax, kmin + (limit or 10000) - 1) do
      local T = m.pos + (s + k * L - m.offs) / m.rate
      if T >= m.pos - EPS and T <= m.pos + m.len + EPS then out[#out + 1] = T end
    end
    return out
  end
  if L and (s < -EPS or s > L + EPS) then return out end
  local T = m.pos + (s - m.offs) / m.rate
  if T >= m.pos - EPS and T <= m.pos + m.len + EPS then out[1] = T end
  return out
end

--- Project times at which the file time f is heard inside the item.
function M.file_to_project(m, f, limit)
  local s = M.file_to_source(m, f)
  if s == nil then return {} end
  return M.source_to_project(m, s, limit)
end

--- Project intervals { {t0, t1}, ... } in which the file interval [fa, fb] is heard, clipped to the item.
function M.file_interval_to_project(m, fa, fb, limit)
  local a, b = min(fa, fb), max(fa, fb)
  for i = #m.sections, 1, -1 do                           -- into take source time, clamped to each section
    local sec = m.sections[i]
    local L = sec.len
    if L <= 0 then L = (m.file_len or huge) - sec.offs end
    a, b = max(a, sec.offs), min(b, sec.offs + L)
    if b - a <= EPS then return {} end
    local ua, ub = a - sec.offs, b - sec.offs
    if sec.rev then a, b = L - ub, L - ua else a, b = ua, ub end
  end
  local L, out = m.src_len, {}
  if L then a, b = max(a, 0), min(b, L) end
  if b - a <= EPS then return out end
  local ks = { 0 }
  if m.loop and L then
    ks = {}
    local kmin = ceil((m.offs - b) / L - 1e-9)
    local kmax = floor((m.offs + m.len * m.rate - a) / L + 1e-9)
    for k = kmin, min(kmax, kmin + (limit or 10000) - 1) do ks[#ks + 1] = k end
  end
  for _, k in ipairs(ks) do
    local t0 = m.pos + (a + k * (L or 0) - m.offs) / m.rate
    local t1 = m.pos + (b + k * (L or 0) - m.offs) / m.rate
    t0, t1 = max(t0, m.pos), min(t1, m.pos + m.len)
    if t1 - t0 > EPS then out[#out + 1] = { t0, t1 } end
  end
  return out
end

--- For the strip of an item W pixels wide: column(x) returns the file interval heard in pixel column x (fa > fb where
--- the take plays backwards), or nil where nothing is heard; to_x(f) returns the pixel positions of file time f.
function M.item_columns(m, W)
  local px = m.len / W
  local function column(x)
    local Tc = m.pos + (x + 0.5) * px
    local fc = M.project_to_file(m, Tc)
    if fc == nil then return nil end
    local half = 0.5 * px * m.rate
    if m.reversed then return fc + half, fc - half end
    return fc - half, fc + half
  end
  local function to_x(f)
    local xs = {}
    for _, T in ipairs(M.file_to_project(m, f, 2000)) do xs[#xs + 1] = (T - m.pos) / m.len * W end
    return xs
  end
  return column, to_x
end

------------------------------------------------------------------------------------------------------------------------
-- curves as automation
------------------------------------------------------------------------------------------------------------------------
--- Samples a curve over the item in project time. Returns points { {T, v}, ... } with v in 0..1 and the range used.
--- opts: step (project s; default one curve sample, at most 4000 points), silence (value where the curve is null or
--- the take is silent; default 0), scaling ("fixed": as the strip, see curve_scale; "item": stretched so the item's
--- own 5th-95th percentile spans 0..1), invert (bool).
function M.sample_curve(doc, name, m, opts)
  opts = opts or {}
  local silence = opts.silence or 0
  local rate = doc.curves.rate
  local step = opts.step or (1 / (rate * m.rate))
  local n = max(1, ceil(m.len / step))
  if n > (opts.max_samples or 4000) then n = opts.max_samples or 4000 end
  step = m.len / n
  local raw = {}
  for i = 0, n do
    local T = m.pos + i * step
    if i == n then T = m.pos + m.len end
    local f = M.project_to_file(m, T)
    local v = f and M.curve_at(doc, name, f, nil) or nil
    raw[#raw + 1] = { T, v }
  end
  local lo, hi
  if opts.scaling == "item" then
    local vals = {}
    for _, p in ipairs(raw) do if p[2] ~= nil then vals[#vals + 1] = p[2] end end
    sort(vals)
    if #vals > 0 then lo, hi = pct(vals, 0.05), pct(vals, 0.95) end
    if not lo or hi - lo < 1e-9 then lo, hi = M.curve_scale(doc, name) end
  else
    lo, hi = M.curve_scale(doc, name)
  end
  local pts = {}
  for i, p in ipairs(raw) do
    local v
    if p[2] == nil then v = silence else v = clamp((p[2] - lo) / (hi - lo), 0, 1) end
    if opts.invert and p[2] ~= nil then v = 1 - v end
    pts[i] = { p[1], v }
  end
  return pts, lo, hi
end

--- Keeps the points needed to stay within tol (vertical distance) of the linear interpolation of all points
--- (Ramer-Douglas-Peucker on the value axis), then raises tol until at most max_points remain. First and last kept.
function M.reduce_points(pts, tol, max_points)
  local n = #pts
  if n <= 2 then local out = {}; for i = 1, n do out[i] = pts[i] end; return out, tol end
  max_points = max(2, max_points or huge)
  tol = max(0, tol or 0)
  local function run(tl)
    local keep = { [1] = true, [n] = true }
    local count, stack = 2, { 1, n }
    while #stack > 0 do
      local j = stack[#stack]; stack[#stack] = nil
      local i = stack[#stack]; stack[#stack] = nil
      if j > i + 1 then
        local t1, v1, t2, v2 = pts[i][1], pts[i][2], pts[j][1], pts[j][2]
        local dt = t2 - t1
        local worst, at = -1, nil
        for k = i + 1, j - 1 do
          local p = pts[k]
          local u = dt > 0 and (p[1] - t1) / dt or 0
          local d = abs(p[2] - (v1 + (v2 - v1) * u))
          if d > worst then worst, at = d, k end
        end
        if worst > tl then
          keep[at] = true; count = count + 1
          stack[#stack + 1] = i; stack[#stack + 1] = at
          stack[#stack + 1] = at; stack[#stack + 1] = j
        end
      end
    end
    return keep, count
  end
  local keep, count = run(tol)
  local tries = 0
  while count > max_points and tries < 60 do
    tol = tol > 0 and tol * 1.4 or 1e-4
    keep, count = run(tol)
    tries = tries + 1
  end
  local out = {}
  for i = 1, n do if keep[i] then out[#out + 1] = pts[i] end end
  if #out > max_points then                               -- cannot happen with a finite curve; bound it anyway
    local even, stepk = {}, (#out - 1) / (max_points - 1)
    for k = 0, max_points - 1 do even[#even + 1] = out[round(k * stepk) + 1] end
    out = even
  end
  return out, tol
end

------------------------------------------------------------------------------------------------------------------------
-- markers and regions
------------------------------------------------------------------------------------------------------------------------
--- What to add for one take. kinds: set of "events", "onsets" (take markers, in take source time), "downbeats"
--- (project markers) and "sections" (project regions); everything clipped to what the item plays.
--- Returns { take = { {pos, name, kind} }, markers = { {pos, name} }, regions = { {start, stop, name} }, notes = {...} }.
function M.marker_plan(doc, m, kinds)
  local plan = { take = {}, markers = {}, regions = {}, notes = {} }
  local function take_marker(t, name, kind)
    local s = M.file_to_source(m, t)
    if s ~= nil and #M.source_to_project(m, s, 1) > 0 then plan.take[#plan.take + 1] = { pos = s, name = name, kind = kind } end
  end
  if kinds.events then
    if type(doc.events) ~= "table" then plan.notes[#plan.notes + 1] = "no events in this analysis (the fast profile leaves them out)"
    else for _, e in ipairs(doc.events) do take_marker(e.start, trim(tostring(e.tag or "") .. " " .. tostring(e.word or "event")), "event") end end
  end
  if kinds.onsets then
    if type(doc.onsets) ~= "table" then plan.notes[#plan.notes + 1] = "no onsets in this analysis"
    else for _, t in ipairs(doc.onsets) do take_marker(t, "onset", "onset") end end
  end
  if kinds.downbeats then
    local r = doc.rhythm
    if type(r) ~= "table" then plan.notes[#plan.notes + 1] = "no downbeats: they are found by the music profile (sounds over 10 s, or profile music in Playhead - Settings)"
    elseif not r.reliable then plan.notes[#plan.notes + 1] = "no downbeats: no steady beat was found"
    else
      for i, t in ipairs(r.downbeats or {}) do
        for _, T in ipairs(M.file_to_project(m, t, 1000)) do plan.markers[#plan.markers + 1] = { pos = T, name = "bar " .. i } end
      end
    end
  end
  if kinds.sections then
    if type(doc.sections) ~= "table" then plan.notes[#plan.notes + 1] = "no sections: they are found by the music profile (sounds over 10 s, or profile music in Playhead - Settings)"
    else
      for _, s in ipairs(doc.sections) do
        for _, iv in ipairs(M.file_interval_to_project(m, s.start, s.stop or s["end"], 1000)) do
          plan.regions[#plan.regions + 1] = { start = iv[1], stop = iv[2], name = tostring(s.label or "") }
        end
      end
    end
  end
  sort(plan.take, function(a, b) return a.pos < b.pos end)
  sort(plan.markers, function(a, b) return a.pos < b.pos end)
  sort(plan.regions, function(a, b) return a.start < b.start end)
  return plan
end

------------------------------------------------------------------------------------------------------------------------
-- looks: look codes, ready-made looks and legends (as Playhead.parseLook, lookCode, describeLook, lookFits)
------------------------------------------------------------------------------------------------------------------------
M.TICK_KINDS = { events = true, onsets = true, beats = true, downbeats = true, novelty = true }
M.FORMS = { lanes = true, overlay = true }
M.SHAPES = { base = true, mirror = true, horizon = true, line = true }
M.LOOK_ORDER = { "auto", "plain", "spectrum", "structure", "rhythm", "tension", "events", "lanes", "shapes", "overlay",
  "horizon", "specstructure", "overview", "character", "surprise", "hits", "sculpted" }
M.LOOKS = {
  auto = { name = "Automatic", desc = "Sound effects: harshness as colour, activity as the line, events. Music: activity as colour, tension as the line, sections, downbeats.", code = nil },
  plain = { name = "Waveform only", desc = "The waveform without analysis, for comparison.", code = "wave" },
  spectrum = { name = "Spectrogram", desc = "A standard spectrogram (mel scale, 40 Hz to 16 kHz), for comparison.", code = "spec" },
  structure = { name = "Structure", desc = "Sections, structural change (up: entry, down: fall or break) and the local pulse under a plain waveform.", code = "wave,sections,lane:structureNovelty~signed,lane:localPulse,ticks:downbeats" },
  rhythm = { name = "Rhythm", desc = "Activity as colour, the local pulse, beats and downbeats.", code = "wave:activity,lane:localPulse,ticks:beats+downbeats" },
  tension = { name = "Tension", desc = "Harshness as colour, tension as the line, sections.", code = "wave:harshness,sections,line:tension,ticks:downbeats" },
  events = { name = "Events", desc = "Harshness as colour, activity in a lane, events marked.", code = "wave:harshness,lane:activity,ticks:events" },
  lanes = { name = "Separate lanes", desc = "Plain waveform with loudness, activity and harshness each in its own lane (no colour mixing).", code = "wave,lane:loudness,lane:activity,lane:harshness" },
  shapes = { name = "Curves as waveforms", desc = "No waveform: loudness, activity and harshness each drawn like a waveform, mirrored around its middle.", code = "shape:mirror,lane:loudness,lane:activity,lane:harshness" },
  overlay = { name = "Curves over the waveform", desc = "Activity and harshness drawn like waveforms on top of the waveform itself, to compare their shapes directly.", code = "form:overlay,shape:mirror,wave,lane:activity,lane:harshness" },
  horizon = { name = "Horizon lanes", desc = "Loudness, activity and harshness as horizon charts: compact lanes that keep detail at small heights.", code = "shape:horizon,wave,lane:loudness,lane:activity,lane:harshness" },
  specstructure = { name = "Spectrogram and structure", desc = "The spectrogram with sections, structural change and downbeats.", code = "spec,sections,lane:structureNovelty~signed,ticks:downbeats" },
  overview = { name = "Music overview", desc = "Curves only, overlaid and mirrored like a waveform: local pulse, activity and recurrence, with sections, bar lines and novelty marks.", code = "form:overlay,shape:mirror,sections,lane:localPulse,lane:activity,lane:n8Recurrence,ticks:downbeats+novelty" },
  character = { name = "Sound character", desc = "For sound effects. Curves only, overlaid and mirrored like a waveform: where the hits are (onset strength), harshness and impulsiveness (clicks, cracks, crackle), with onsets marked.", code = "form:overlay,shape:mirror,lane:onsetStrength,lane:harshness,lane:n1Kurtosis,ticks:onsets" },
  surprise = { name = "Hits and surprise", desc = "For sound effects. As Sound character, with spectral surprise (where the sound turns into something new) in place of impulsiveness.", code = "form:overlay,shape:mirror,lane:onsetStrength,lane:harshness,lane:n7Surprisal,ticks:onsets" },
  hits = { name = "Hits and pulse", desc = "The waveform with onset strength (where the hits are) and the local pulse as lanes, beats and bar lines.", code = "wave,lane:onsetStrength,lane:localPulse,ticks:beats+downbeats" },
  sculpted = { name = "Waveform as loud as it sounds", desc = "The waveform's envelope follows perceived loudness (a dB-like scale) while its detail stays; colour shows harshness, with the ordinary peak outline for comparison.", code = "sculpt:loudness,wave:harshness,outline,ticks:events+novelty" }
}

local function is_sfx_doc(doc) return doc and (doc.profile == "sfx" or doc.assetClass == "sfx") end
--- The automatic look's layers (the strip renderer's default): by profile.
function M.auto_layers(doc)
  local sfx = is_sfx_doc(doc)
  return {
    { type = "wave", colour = sfx and "harshness" or "activity" },
    { type = "sections" },
    { type = "line", curve = sfx and "activity" or "tension" },
    { type = "ticks", of = { "downbeats", "events" }, small = true }
  }
end

--- Look code or look name -> layers (nil for the automatic look). Unknown parts are skipped.
function M.parse_look(code)
  if type(code) == "table" then return code end
  local c = trim(code)
  if M.LOOKS[c] then return M.LOOKS[c].code and M.parse_look(M.LOOKS[c].code) or nil end
  local out = {}
  for _, raw in ipairs(M.split(c, ",")) do
    local tok = trim(raw)
    if tok ~= "" then
      local parts = M.split(tok, "~")
      local main = parts[1]
      local flags = {}
      for k = 2, #parts do flags[parts[k]] = true end
      local i = find(main, ":", 1, true)
      local ty = i and sub(main, 1, i - 1) or main
      local arg = i and sub(main, i + 1) or ""
      if ty == "wave" then out[#out + 1] = { type = "wave", colour = arg ~= "" and arg or nil }
      elseif (ty == "spec" and (arg == "" or arg == "mel")) or ty == "outline" then out[#out + 1] = { type = ty }
      elseif ty == "spec" or ty == "raster" or ty == "scalogram" then
        -- the views of rhythm and form (tempogram, lag view, modulation, bar raster, scalogram) are drawn by the
        -- JavaScript library only; here the plain waveform stands in for them, as it does there for a sound without them
        local has = false
        for _, l in ipairs(out) do if l.type == "wave" then has = true end end
        if not has then out[#out + 1] = { type = "wave" } end
      elseif ty == "sculpt" and arg ~= "" then out[#out + 1] = { type = ty, curve = arg }
      elseif ty == "line" and arg ~= "" then out[#out + 1] = { type = ty, curve = arg }
      elseif ty == "lane" and arg ~= "" then out[#out + 1] = { type = ty, curve = arg, signed = flags.signed or false }
      elseif ty == "sections" then out[#out + 1] = { type = ty }
      elseif ty == "ticks" then
        local of = {}
        for _, k in ipairs(M.split(arg, "+")) do if M.TICK_KINDS[k] then of[#of + 1] = k end end
        if #of > 0 then out[#out + 1] = { type = ty, of = of } end
      elseif ty == "form" and M.FORMS[arg] then out[#out + 1] = { type = ty, value = arg }
      elseif ty == "shape" and M.SHAPES[arg] then out[#out + 1] = { type = ty, value = arg }
      end
    end
  end
  return out
end

--- Layers -> look code.
function M.look_code(layers)
  local out = {}
  for _, l in ipairs(layers or {}) do
    local s
    if l.type == "wave" then s = "wave" .. (l.colour and (":" .. l.colour) or "")
    elseif l.type == "line" then s = "line:" .. l.curve
    elseif l.type == "lane" then s = "lane:" .. l.curve .. (l.signed and "~signed" or "")
    elseif l.type == "ticks" then s = (l.of and #l.of > 0) and ("ticks:" .. concat(l.of, "+")) or ""
    elseif l.type == "form" or l.type == "shape" then s = l.type .. ":" .. l.value
    elseif l.type == "sculpt" then s = "sculpt:" .. l.curve
    else s = l.type end
    if s ~= "" then out[#out + 1] = s end
  end
  return concat(out, ",")
end

local function option_of(layers, ty, dflt)
  for _, l in ipairs(layers or {}) do if l.type == ty then return l.value end end
  return dflt
end
local function has_type(layers, pred)
  for _, l in ipairs(layers or {}) do if pred(l) then return true end end
  return false
end
local function contains(list, v) for _, x in ipairs(list or {}) do if x == v then return true end end return false end

--- Plain-language legend for layers (as Playhead.describeLook).
function M.describe_look(layers, doc)
  local lab = M.curve_label
  local function has(k) return not doc or (doc.curves and is_curve(doc.curves[k])) end
  local parts, form, shape = {}, option_of(layers, "form", "lanes"), option_of(layers, "shape", "base")
  local lanes = 0
  for _, l in ipairs(layers or {}) do if l.type == "lane" then lanes = lanes + 1 end end
  local has_main = has_type(layers, function(x) return x.type == "wave" or x.type == "spec" end)
  local has_wave = has_type(layers, function(x) return x.type == "wave" end)
  for _, l in ipairs(layers or {}) do
    local t = l.type
    if t == "wave" then parts[#parts + 1] = (l.colour and has(l.colour)) and ("colour: " .. lab(l.colour)) or "waveform"
    elseif t == "spec" then parts[#parts + 1] = (not doc or doc.spectrum) and "spectrogram (mel, low at the bottom)" or "spectrogram (not in this analysis)"
    elseif t == "outline" then parts[#parts + 1] = "outline: peak waveform"
    elseif t == "sculpt" then
      if not has_wave then parts[#parts + 1] = "height: " .. lab(l.curve) .. " (shapes the waveform; add it to see)"
      elseif has(l.curve) then parts[#parts + 1] = "height: " .. lab(l.curve)
      else parts[#parts + 1] = "height: " .. lab(l.curve) .. " (not in this analysis)" end
    elseif t == "line" and has(l.curve) then parts[#parts + 1] = "line: " .. lab(l.curve)
    elseif t == "lane" then
      local pre = form == "overlay" and (has_main and "over the waveform: " or "overlaid: ") or "lane: "
      local post = has(l.curve) and (l.signed and " (up: entry, down: fall or break, centred: same level)" or "") or " (not in this analysis)"
      parts[#parts + 1] = pre .. lab(l.curve) .. post
    elseif t == "sections" and (not doc or doc.sections) then parts[#parts + 1] = "letters: sections"
    elseif t == "ticks" and l.of then
      local function ok(r)
        if not doc then return true end
        if r == "events" then return doc.events ~= nil end
        if r == "onsets" then return doc.onsets ~= nil end
        if r == "novelty" then return type(doc.noveltyTicks) == "table" and #doc.noveltyTicks > 0 end
        return doc.rhythm ~= nil
      end
      local shown, missing, rhythmic, miss_rh = {}, {}, false, false
      for _, r in ipairs(l.of) do
        local name = r == "downbeats" and "bar lines" or r
        if r == "beats" or r == "downbeats" then rhythmic = true end
        if ok(r) then shown[#shown + 1] = name else missing[#missing + 1] = name; if r == "beats" or r == "downbeats" then miss_rh = true end end
      end
      if #shown > 0 then
        parts[#parts + 1] = "marks: " .. concat(shown, ", ") .. ((doc and type(doc.rhythm) == "table" and not doc.rhythm.reliable and rhythmic) and " (no steady beat: beats faint)" or "")
      end
      if #missing > 0 then parts[#parts + 1] = concat(missing, ", ") .. ": not in this analysis" .. (miss_rh and " (music only)" or "") end
    end
  end
  if lanes > 0 and shape ~= "base" then
    parts[#parts + 1] = shape == "mirror" and "curves mirrored like a waveform" or shape == "horizon" and "horizon charts (darker = higher)" or "curves as lines"
  end
  return concat(parts, " · ")
end

--- Whether a look shows something for this document (as Playhead.lookFits).
function M.look_fits(doc, look)
  local layers = M.parse_look(look) or M.auto_layers(doc)
  for _, l in ipairs(layers) do
    if (l.type == "lane" or l.type == "line" or l.type == "sculpt") and not M.curve_live(doc, l.curve) then return false end
    if l.type == "wave" and l.colour and not M.curve_live(doc, l.colour) then return false end
    if l.type == "spec" and not doc.spectrum then return false end
  end
  return true
end

------------------------------------------------------------------------------------------------------------------------
-- the strip renderer: a Lua port of a subset of Playhead.drawStrip that draws through a small sink, so the REAPER
-- window (gfx) and the tests (a recorder) share it. All layer types are supported: wave (plain or tinted), spec, line,
-- lane (base, mirror, horizon, line shapes; signed; lanes or overlay form), sections, ticks (events, onsets, beats,
-- downbeats, novelty), outline and sculpt.
--
-- sink: rect(x, y, w, h, rgb, alpha); line(x1, y1, x2, y2, rgb, alpha); polyline(xs, ys, rgb, alpha, width);
--       triangle(x1, y1, x2, y2, x3, y3, rgb, alpha); dashed(x, y1, y2, rgb, alpha);
--       text(x, y, str, rgb, alpha, size, align ("left"|"right"), valign ("baseline"|"middle"))
-- Colours are { r, g, b } with 0..255.
------------------------------------------------------------------------------------------------------------------------
function M.rgb(hex)
  local h = tostring(hex):gsub("^#", "")
  if #h == 3 then h = h:gsub(".", "%0%0") end
  return { tonumber(h:sub(1, 2), 16) or 0, tonumber(h:sub(3, 4), 16) or 0, tonumber(h:sub(5, 6), 16) or 0 }
end
local SPEC_RAMP = { { 0, 0, 4 }, { 66, 10, 104 }, { 147, 38, 103 }, { 221, 81, 58 }, { 252, 165, 10 }, { 252, 255, 164 } }
M.THEMES = {
  light = {   -- Playhead's own theme (Playhead.theme), for light backgrounds
    background = M.rgb("#ffffff"), wave = M.rgb("#9aa5ac"), waveLow = { 214, 226, 240 }, waveHigh = { 24, 79, 149 },
    line = M.rgb("#eb6834"), tick = M.rgb("#13181b"), text = M.rgb("#13181b"), rule = M.rgb("#4e5960"),
    series = { M.rgb("#2f9378"), M.rgb("#7e60c4") }, specRamp = SPEC_RAMP
  },
  dark = {    -- the same roles for dark backgrounds
    background = M.rgb("#1e2327"), wave = M.rgb("#7d8a93"), waveLow = { 44, 58, 78 }, waveHigh = { 120, 182, 255 },
    line = M.rgb("#f07a45"), tick = M.rgb("#e4e8ea"), text = M.rgb("#e4e8ea"), rule = M.rgb("#a3adb4"),
    series = { M.rgb("#3fc29c"), M.rgb("#a78bf0") }, specRamp = SPEC_RAMP
  }
}
local function luminance(c) return (0.2126 * c[1] + 0.7152 * c[2] + 0.0722 * c[3]) / 255 end
M.luminance = luminance
--- A theme for a background colour: Playhead's light or dark palette, with the given colours put over it.
--- overrides: { background, wave, text, ... } (any may be nil).
function M.theme_for(background, overrides)
  local base = (background and luminance(background) < 0.5) and M.THEMES.dark or M.THEMES.light
  local th = {}
  for k, v in pairs(base) do th[k] = v end
  if background then th.background = background end
  for k, v in pairs(overrides or {}) do th[k] = v end
  return th
end

local function mix(a, b, u) return { round(a[1] + (b[1] - a[1]) * u), round(a[2] + (b[2] - a[2]) * u), round(a[3] + (b[3] - a[3]) * u) } end
local function ramp_at(ramp, u)
  local x = clamp(u, 0, 1) * (#ramp - 1)
  local i = min(#ramp - 2, floor(x))
  return mix(ramp[i + 1], ramp[i + 2], x - i)
end
M.ramp_at = ramp_at

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local B64I = {}
for i = 1, 64 do B64I[byte(B64, i)] = i - 1 end
--- base64 -> byte string
function M.from_base64(s)
  s = tostring(s or ""):gsub("[^%w%+/]", "")
  local out, n = {}, #s
  for i = 1, n, 4 do
    local a, b = B64I[byte(s, i)] or 0, B64I[byte(s, i + 1) or 65] or 0
    local c3, c4 = byte(s, i + 2), byte(s, i + 3)
    local c, d = c3 and B64I[c3] or nil, c4 and B64I[c4] or nil
    if not c then d = nil end
    local v = (a << 18) | (b << 12) | ((c or 0) << 6) | (d or 0)
    out[#out + 1] = string.char((v >> 16) & 255)
    if c then out[#out + 1] = string.char((v >> 8) & 255) end
    if d then out[#out + 1] = string.char(v & 255) end
  end
  return concat(out)
end

--- Geometry of a strip: how the main band (waveform or spectrogram) and the lanes share the height.
function M.strip_layout(layers, doc, W, H)
  local curves = doc.curves
  local form, shape = option_of(layers, "form", "lanes"), option_of(layers, "shape", "base")
  local has_main = has_type(layers, function(l) return l.type == "wave" or (l.type == "spec" and doc.spectrum ~= nil) end)
  local lanes = {}
  for _, l in ipairs(layers) do if l.type == "lane" and is_curve(curves[l.curve]) then lanes[#lanes + 1] = l end end
  local stacked = form == "lanes" and #lanes > 0
  local laneH = 0
  if stacked then
    if has_main then laneH = max(6, round(H * (#lanes == 1 and 0.28 or #lanes == 2 and 0.22 or 0.18)))
    else laneH = H / #lanes end
  end
  local mainH
  if has_main then mainH = max(4, H - laneH * (stacked and #lanes or 0)) else mainH = stacked and 0 or H end
  return { W = W, H = H, form = form, shape = shape, has_main = has_main, lanes = lanes, stacked = stacked, laneH = laneH, mainH = mainH }
end

--- Draws a document's strip through sink. opts: width, height, look (name or code) or layers, theme, and either
--- from/to (document seconds) or column(x) and to_x(t) (see item_columns). Returns { code, layers, legend, layout, items }.
function M.render_strip(doc, g, opts)
  opts = opts or {}
  local th = {}
  for k, v in pairs(M.THEMES.light) do th[k] = v end
  for k, v in pairs(opts.theme or {}) do th[k] = v end
  th.lane = th.lane or th.line; th.laneDown = th.laneDown or th.rule; th.laneFlat = th.laneFlat or th.wave
  th.outline = th.outline or th.wave
  local series = { th.lane, (th.series or {})[1] or M.rgb("#2f9378"), (th.series or {})[2] or M.rgb("#7e60c4") }
  local layers
  if opts.layers then layers = M.parse_look(opts.layers)
  elseif opts.look then layers = M.parse_look(opts.look) or M.auto_layers(doc)
  else layers = M.auto_layers(doc) end
  local W, H = floor(opts.width or 600), opts.height or 64
  local dur = doc.source.duration
  local curves, rate = doc.curves, doc.curves.rate
  local column, to_x = opts.column, opts.to_x
  if not column then
    local t0 = max(0, opts.from or 0)
    local t1 = min(dur, opts.to or dur)
    local span = max(1e-6, t1 - t0)
    column = function(x) return t0 + x / W * span, t0 + (x + 1) / W * span end
    to_x = function(t) if t < t0 or t > t1 then return {} end return { (t - t0) / span * W } end
  end
  local cols = {}                                         -- per pixel column: lo, hi (document seconds), direction
  for x = 0, W - 1 do
    local fa, fb = column(x)
    if fa ~= nil and fb ~= nil then
      local lo, hi = min(fa, fb), max(fa, fb)
      if hi > 0 and lo < dur then cols[x] = { max(0, lo), min(dur, hi), fb >= fa and 1 or -1 } end
    end
  end
  local L = M.strip_layout(layers, doc, W, H)
  local mainH, laneH, lanes, stacked, form, shape, has_main = L.mainH, L.laneH, L.lanes, L.stacked, L.form, L.shape, L.has_main
  local items = {}
  if th.background and opts.fill ~= false then g.rect(0, 0, W, H, th.background, 1) end

  local function val_at(arr, ta, tb)
    if not is_curve(arr) then return nil end
    local ia, ib, n = ta * rate, tb * rate, #arr
    if ib - ia >= 1 then
      local s, k = 0, 0
      for i = max(0, floor(ia)), min(n, ceil(ib)) - 1 do local v = arr[i + 1]; if v ~= NULL then s = s + v; k = k + 1 end end
      if k > 0 then return s / k end
      return nil
    end
    local x = max(0, min(n - 1, (ia + ib) / 2 - 0.5))
    local i = floor(x)
    local f = x - i
    local a, b = arr[i + 1], arr[min(n - 1, i + 1) + 1]
    if a == NULL then if f > 0.5 and b ~= NULL then return b end return nil end
    if b == NULL then if f < 0.5 then return a end return nil end
    return a + (b - a) * f
  end
  local function auto_range(name, arr)
    if name == "lufs" then return -60, 0 end
    local v = sorted_values(arr)
    if #v == 0 then return 0, 1 end
    local lo, hi
    if name:find("^n%d") then lo, hi = pct(v, 0.05), pct(v, 0.95)
    elseif name == "structureNovelty" or name == "localPulse" then lo, hi = 0, max(0.05, pct(v, 0.99))
    else return 0, 1 end
    if hi - lo < 1e-9 then lo, hi = lo - 1, lo + 1 end
    return lo, hi
  end
  local function index_of(l) for i, x in ipairs(layers) do if x == l then return i end end return 0 end
  local function spec_before(l)
    if not doc.spectrum then return false end
    local idx = index_of(l)
    for j = 1, idx - 1 do if layers[j].type == "spec" then return true end end
    return false
  end
  local wv = doc.wave
  local wc = wv.columns or #wv.max
  local peak = 1e-9
  for c = 1, wc do
    local a, b = wv.min[c], wv.max[c]
    if a ~= NULL and a then peak = max(peak, abs(a)) end
    if b ~= NULL and b then peak = max(peak, abs(b)) end
  end
  local function wave_range(lo_t, hi_t)
    local ca = max(0, floor(lo_t / dur * wc))
    local cb = max(ca + 1, ceil(hi_t / dur * wc))
    local lo, hi = 0, 0
    for c = ca, min(cb, wc) - 1 do
      local a, b = wv.min[c + 1], wv.max[c + 1]
      if a ~= NULL and a and a < lo then lo = a end
      if b ~= NULL and b and b > hi then hi = b end
    end
    return lo, hi
  end
  local sculpt_l
  for _, l in ipairs(layers) do if l.type == "sculpt" and is_curve(curves[l.curve]) then sculpt_l = l break end end
  local sculpt = sculpt_l and curves[sculpt_l.curve] or nil
  local cols_cache
  local function wave_cols()                              -- per pixel column [top, bottom] as fractions of the half-height
    if cols_cache then return cols_cache end
    local hi, lo = {}, {}
    for x = 0, W - 1 do
      local c = cols[x]
      if c then local a, b = wave_range(c[1], c[2]); hi[x] = b / peak; lo[x] = a / peak else hi[x] = 0; lo[x] = 0 end
    end
    if sculpt then
      local r = max(2, round(W / 100))
      local env = {}
      for x = 0, W - 1 do
        local mm = 0
        for k = max(0, x - r), min(W - 1, x + r) do mm = max(mm, hi[k], -lo[k]) end
        env[x] = mm
      end
      for x = 0, W - 1 do
        local c = cols[x]
        local v = c and val_at(sculpt, c[1], c[2]) or nil
        local gk = (v == nil or env[x] < 1e-4) and 0 or clamp(v, 0, 1) / env[x]
        hi[x] = hi[x] * gk; lo[x] = lo[x] * gk
      end
    end
    cols_cache = { hi = hi, lo = lo }
    return cols_cache
  end
  local function runs(ys, dx)                             -- polyline runs over the columns that have a value
    local out, xs, yy = {}, nil, nil
    for x = 0, W - 1 do
      local y = ys[x]
      if y == nil then if xs then out[#out + 1] = { xs, yy }; xs = nil end
      else
        if not xs then xs, yy = {}, {} end
        xs[#xs + 1] = x + (dx or 0); yy[#yy + 1] = y
      end
    end
    if xs then out[#out + 1] = { xs, yy } end
    return out
  end

  local draw = {}
  function draw.wave(l)
    if mainH <= 0 then return end
    local Hm, mid = mainH, mainH / 2
    local colour = (l.colour and is_curve(curves[l.colour])) and curves[l.colour] or nil
    local sc = sculpt and wave_cols() or nil
    local outline = spec_before(l)
    if colour then items[#items + 1] = { label = M.curve_label(l.colour), ramp = { th.waveLow, th.waveHigh } } end
    local top, bot = {}, {}
    for x = 0, W - 1 do
      local c = cols[x]
      if c then
        local lo, hi = wave_range(c[1], c[2])
        if sc then hi = sc.hi[x] * peak; lo = sc.lo[x] * peak end
        local yTop, yBot = mid - hi / peak * (mid - 1), mid - lo / peak * (mid - 1)
        if outline then top[x] = yTop; bot[x] = yBot
        else
          local u = colour and val_at(colour, c[1], c[2]) or nil
          g.rect(x, yTop, 1, max(1, yBot - yTop), u == nil and th.wave or mix(th.waveLow, th.waveHigh, clamp(u, 0, 1)), 1)
        end
      end
    end
    if outline then
      for _, ys in ipairs({ top, bot }) do for _, r in ipairs(runs(ys, 0.5)) do g.polyline(r[1], r[2], th.wave, 0.8, 1) end end
    end
  end
  function draw.outline()
    local Hm = mainH > 0 and mainH or H
    local mid = Hm / 2
    local top, bot = {}, {}
    for x = 0, W - 1 do
      local c = cols[x]
      if c then local lo, hi = wave_range(c[1], c[2]); top[x] = mid - hi / peak * (mid - 1); bot[x] = mid - lo / peak * (mid - 1) end
    end
    for _, ys in ipairs({ top, bot }) do for _, r in ipairs(runs(ys, 0.5)) do g.polyline(r[1], r[2], th.outline, 0.85, 1) end end
    items[#items + 1] = { label = "peak waveform", colour = th.outline }
  end
  function draw.spec()
    local sp = doc.spectrum
    if type(sp) ~= "table" or not sp.data or mainH <= 0 then return end
    if not sp._bytes then sp._bytes = M.from_base64(sp.data) end
    local u8, B, C = sp._bytes, sp.bands or 40, sp.columns or 0
    if C <= 0 then return end
    local x = 0
    while x < W do                                        -- one rectangle per band over the pixels showing one column
      local c = cols[x]
      if not c then x = x + 1
      else
        local col = clamp(floor((c[1] + c[2]) / 2 / dur * C), 0, C - 1)
        local x2 = x + 1
        while x2 < W do
          local c2 = cols[x2]
          if not c2 or clamp(floor((c2[1] + c2[2]) / 2 / dur * C), 0, C - 1) ~= col then break end
          x2 = x2 + 1
        end
        for b = 0, B - 1 do
          local v = byte(u8, col * B + b + 1) or 0
          g.rect(x, (B - 1 - b) / B * mainH, x2 - x, mainH / B + 0.5, ramp_at(th.specRamp, v / 255), 1)
        end
        x = x2
      end
    end
    if mainH >= 48 and W >= 200 then
      local function mel(f) return 2595 * math.log(1 + f / 700, 10) end
      local lo, hi = sp.fmin or 40, sp.fmax or 16000
      local mlo, mhi = mel(lo), mel(hi)
      for _, ft in ipairs({ { 100, "100" }, { 1000, "1k" }, { 10000, "10k" } }) do
        local f = ft[1]
        if f > lo and f < hi then
          local k = (mel(f) - mlo) / (mhi - mlo) * (B + 1) - 1
          local y = (1 - (k + 0.5) / B) * mainH
          if y > 6 and y < mainH - 6 then g.text(W - 3, y, ft[2], th.text, 0.65, 9, "right", "middle") end
        end
      end
    end
  end
  function draw.sections()
    if type(doc.sections) ~= "table" then return end
    local size = max(9, round((mainH > 0 and mainH or H) / 6))
    for _, s in ipairs(doc.sections) do
      for _, xx in ipairs(to_x(s.start)) do
        local x = round(xx) + 0.5
        if s.start > 0.05 then g.dashed(x, 0, H, th.rule, 1) end
        g.text(x + 3, size, tostring(s.label or ""), th.text, 1, size, "left", "baseline")
      end
    end
  end
  function draw.line(l)
    local line = curves[l.curve]
    if not is_curve(line) then return end
    local lr0, lr1
    if l.range then lr0, lr1 = l.range[1], l.range[2] else lr0, lr1 = auto_range(l.curve, line) end
    local Hm = mainH > 0 and mainH or H
    items[#items + 1] = { label = M.curve_label(l.curve), colour = th.line }
    local ys = {}
    for x = 0, W - 1 do
      local c = cols[x]
      local v = c and val_at(line, c[1], c[2]) or nil
      if v ~= nil then ys[x] = Hm - 2 - clamp((v - lr0) / (lr1 - lr0), 0, 1) * (Hm - 4) end
    end
    for _, r in ipairs(runs(ys)) do g.polyline(r[1], r[2], th.line, 1, max(1, Hm / 40)) end
  end
  function draw.lane(l)
    local arr = curves[l.curve]
    local k = 0
    for i, x in ipairs(lanes) do if x == l then k = i - 1 end end
    if not is_curve(arr) or not contains(lanes, l) then return end
    local colour, over = series[(k % #series) + 1], not stacked
    local y0 = over and 0 or (mainH + k * laneH)
    local bandH = over and (mainH > 0 and mainH or H) or laneH
    local lr0, lr1
    if l.range then lr0, lr1 = l.range[1], l.range[2] else lr0, lr1 = auto_range(l.curve, arr) end
    local function norm(v) return clamp((v - lr0) / (lr1 - lr0), 0, 1) end
    items[#items + 1] = { label = M.curve_label(l.curve), colour = colour, down = l.signed and th.laneDown or nil }
    local sep = (not over) and (has_main or k > 0)
    if sep then g.rect(0, y0, W, 1, th.rule, 0.35) end
    local top = y0 + (sep and 1 or 0)
    local h = bandH - (sep and 1 or 0)
    local mid = top + h / 2
    local loud = is_curve(curves.loudness) and curves.loudness or nil
    local win = max(0.25, min(3, dur * 0.04))
    local function lvl(a, b)
      local s, n = 0, 0
      local i0, i1 = max(0, floor(a * rate)), min(loud and #loud or 0, ceil(b * rate))
      for i = i0, i1 - 1 do local v = loud[i + 1]; s = s + ((v == NULL) and 0 or v); n = n + 1 end
      return n > 0 and s / n or 0
    end
    local alpha = over and (l.signed and 0.55 or 0.2) or 1
    if not l.signed and shape == "line" then
      local ys = {}
      for x = 0, W - 1 do
        local c = cols[x]
        local v = c and val_at(arr, c[1], c[2]) or nil
        if v ~= nil then ys[x] = top + h - 1 - norm(v) * (h - 2) end
      end
      for _, r in ipairs(runs(ys)) do g.polyline(r[1], r[2], colour, 1, max(1.25, h / 30)) end
    else
      local edge_top, edge_bot = {}, {}
      for x = 0, W - 1 do
        local c = cols[x]
        local v = c and val_at(arr, c[1], c[2]) or nil
        if v ~= nil then
          local u = norm(v)
          if u > 0 and not (l.signed and u < 0.12) then
            if l.signed then
              local tm = (c[1] + c[2]) / 2
              local d = loud and (lvl(tm, tm + win) - lvl(tm - win, tm)) * c[3] or 0
              local half = h / 2
              if d > 0.03 then g.rect(x, mid - u * half, 1, max(1, u * half), colour, alpha)
              elseif d < -0.03 then g.rect(x, mid, 1, max(1, u * half), th.laneDown, alpha)
              else g.rect(x, mid - u * half / 2, 1, max(1, u * half), th.laneFlat, alpha) end
            else
              if over then
                edge_top[x] = shape == "mirror" and (mid - u * h / 2) or (top + h - u * h)
                if shape == "mirror" then edge_bot[x] = mid + u * h / 2 end
              end
              if shape == "mirror" then g.rect(x, mid - u * h / 2, 1, max(1, u * h), colour, alpha)
              elseif shape == "horizon" then
                for j = 0, 2 do
                  local a = clamp(u * 3 - j, 0, 1)
                  if a <= 0 then break end
                  g.rect(x, top + h - a * h, 1, max(1, a * h), colour, alpha * (0.35 + 0.3 * j))
                end
              else g.rect(x, top + h - u * h, 1, max(1, u * h), colour, alpha) end
            end
          end
        end
      end
      if over and not l.signed and shape ~= "horizon" then
        for _, e in ipairs({ edge_top, edge_bot }) do for _, r in ipairs(runs(e, 0.5)) do g.polyline(r[1], r[2], colour, 1, 1.25) end end
      end
    end
    if not over and h >= 11 and W >= 160 then
      local size = min(10, h - 2)
      g.text(3, top + size, M.curve_label(l.curve), th.text, 0.7, size, "left", "baseline")
    end
  end
  function draw.ticks(l)
    local of = l.of or {}
    local Hm = mainH > 0 and mainH or H
    local r = type(doc.rhythm) == "table" and doc.rhythm or nil
    local ok = r and r.reliable
    local fade = ok and 1 or 0.35
    local function vl(ts, h, alpha, y_from)
      for _, t in ipairs(ts or {}) do
        for _, xx in ipairs(to_x(t)) do
          local x = round(xx) + 0.5
          g.line(x, y_from or (Hm - h), x, Hm, th.tick, alpha or 1)
        end
      end
    end
    local small = l.small == true
    if contains(of, "beats") and r then vl(r.beats, max(3, round(Hm * 0.06)), 0.55 * fade) end
    if contains(of, "onsets") and type(doc.onsets) == "table" then vl(doc.onsets, 3, 0.6) end
    if contains(of, "downbeats") and r then
      if small then if ok then vl(r.downbeats, 4) end
      else vl(r.downbeats, 0, 0.2 * fade, 0); vl(r.downbeats, max(4, round(Hm * 0.1)), fade) end
    end
    if contains(of, "novelty") and type(doc.noveltyTicks) == "table" then
      for _, t in ipairs(doc.noveltyTicks) do
        for _, x in ipairs(to_x(t)) do g.triangle(x, 1, x - 3, 7, x + 3, 7, th.tick, 1) end
      end
    end
    if contains(of, "events") and type(doc.events) == "table" then
      for _, e in ipairs(doc.events) do
        for _, x in ipairs(to_x(e.start)) do g.triangle(x, Hm - 1, x - 3, Hm - 6, x + 3, Hm - 6, th.tick, 1) end
      end
    end
  end
  for _, l in ipairs(layers) do if draw[l.type] then draw[l.type](l) end end
  return { code = M.look_code(layers), layers = layers, legend = M.describe_look(layers, doc), layout = L, items = items }
end

------------------------------------------------------------------------------------------------------------------------
-- command lines
--
-- The REAPER layer never hands arguments to a shell directly: it writes a small job script (sh on macOS and Linux, a
-- batch file on Windows) that runs Playhead with every argument quoted for that interpreter, sends the output to
-- files, moves a finished result into place and writes the exit code last. REAPER then starts only
-- `/bin/sh "<script>"` or `cmd.exe /D /V:OFF /S /C ""<script>""`, whose single path is checked to need no escaping.
------------------------------------------------------------------------------------------------------------------------
--- One argument for a POSIX shell: bare when it is made of safe characters, otherwise in single quotes.
function M.quote_posix(arg)
  arg = tostring(arg)
  if arg ~= "" and not find(arg, "[^%w%._/:,+%-@%%]") then return arg end
  return "'" .. arg:gsub("'", "'\\''") .. "'"
end

--- One argument for a Windows program (the CommandLineToArgvW / C runtime rules): quoted when it has spaces, tabs or
--- quotes or is empty (or always, with force); backslashes before a quote, and before the closing quote, are doubled.
function M.quote_windows(arg, force)
  arg = tostring(arg)
  if not force and arg ~= "" and not find(arg, '[ \t\n\v"]') then return arg end
  local out, bs = { '"' }, 0
  for i = 1, #arg do
    local c = sub(arg, i, i)
    if c == "\\" then bs = bs + 1
    elseif c == '"' then out[#out + 1] = rep("\\", bs * 2 + 1) .. '"'; bs = 0
    else out[#out + 1] = rep("\\", bs) .. c; bs = 0 end
  end
  out[#out + 1] = rep("\\", bs * 2) .. '"'
  return concat(out)
end

--- One argument inside a batch file: quoted as for quote_windows, always in quotes when cmd.exe would read anything
--- in it as an operator, and with % doubled (batch files expand %...%). Returns nil and a message for arguments a
--- batch file cannot carry safely (quotes or line breaks; Windows file names cannot contain either).
function M.quote_batch(arg)
  arg = tostring(arg)
  if find(arg, '["\r\n]') then return nil, "an argument contains a quote or a line break: " .. arg end
  local q
  if arg ~= "" and not find(arg, "[%s&|<>%^%%(),;=!'\\]") then q = arg
  else q = M.quote_windows(arg, true) end
  return (q:gsub("%%", "%%%%"))
end

--- A full command line for display or for a job script. os: "windows" (batch quoting) or anything else (POSIX).
function M.command_line(argv, os)
  local out = {}
  for i, a in ipairs(argv) do
    if os == "windows" then
      local q, err = M.quote_batch(a)
      if not q then return nil, err end
      out[i] = q
    else out[i] = M.quote_posix(a) end
  end
  return concat(out, " ")
end

--- Characters a job script path may contain: the command REAPER starts is built without escaping.
function M.safe_script_path(p, os)
  if os == "windows" then return not find(p, '[%%"%^&|<>!\r\n]') end
  return not find(p, '["%$`\\\r\n]')
end

--- The command REAPER runs to start a job script.
function M.exec_command(script, os)
  if os == "windows" then return 'cmd.exe /D /V:OFF /S /C ""' .. script .. '""' end
  return '/bin/sh "' .. script .. '"'
end

--- Text of a job script. spec: os, argv, stdout, stderr, status (paths), path_extra (list of folders added to PATH),
--- move_from, move_to (renamed after a successful run). The exit code is written to status last, through a
--- temporary file, so a reader that sees the status file sees a finished job.
function M.job_script(spec)
  local os = spec.os
  local L = {}
  if os == "windows" then
    local function q(p) local r, err = M.quote_batch(p); if not r then error(err, 0) end; return r end
    L[#L + 1] = "@echo off"
    L[#L + 1] = "rem Playhead job, written by the Playhead REAPER scripts (safe to delete)"
    L[#L + 1] = "chcp 65001 >nul"
    if spec.path_extra and #spec.path_extra > 0 then
      local dirs = {}
      for _, d in ipairs(spec.path_extra) do
        if find(d, '["\r\n]') then error("a PATH folder contains a quote or a line break", 0) end
        dirs[#dirs + 1] = d:gsub("%%", "%%%%")
      end
      L[#L + 1] = 'set "PATH=%PATH%;' .. concat(dirs, ";") .. '"'
    end
    local cmd = M.command_line(spec.argv, "windows")
    if not cmd then error(select(2, M.command_line(spec.argv, "windows")), 0) end
    L[#L + 1] = cmd .. " >" .. q(spec.stdout) .. " 2>" .. q(spec.stderr) .. " <nul"
    L[#L + 1] = "set PH_CODE=%ERRORLEVEL%"
    if spec.move_from and spec.move_to then
      L[#L + 1] = 'if "%PH_CODE%"=="0" (move /Y ' .. q(spec.move_from) .. " " .. q(spec.move_to) .. " >nul || set PH_CODE=70)"
    end
    L[#L + 1] = ">" .. q(spec.status .. ".tmp") .. " echo %PH_CODE%"
    L[#L + 1] = "move /Y " .. q(spec.status .. ".tmp") .. " " .. q(spec.status) .. " >nul"
    return concat(L, "\r\n") .. "\r\n"
  end
  local q = M.quote_posix
  L[#L + 1] = "#!/bin/sh"
  L[#L + 1] = "# Playhead job, written by the Playhead REAPER scripts (safe to delete)"
  if spec.path_extra and #spec.path_extra > 0 then
    L[#L + 1] = 'PATH="$PATH"' .. q(":" .. concat(spec.path_extra, ":"))
    L[#L + 1] = "export PATH"
  end
  L[#L + 1] = M.command_line(spec.argv, "posix") .. " >" .. q(spec.stdout) .. " 2>" .. q(spec.stderr) .. " </dev/null"
  L[#L + 1] = "code=$?"
  if spec.move_from and spec.move_to then
    L[#L + 1] = 'if [ "$code" -eq 0 ]; then mv -f ' .. q(spec.move_from) .. " " .. q(spec.move_to) .. " || code=70; fi"
  end
  L[#L + 1] = 'echo "$code" >' .. q(spec.status .. ".tmp")
  L[#L + 1] = "mv -f " .. q(spec.status .. ".tmp") .. " " .. q(spec.status)
  return concat(L, "\n") .. "\n"
end

--- argv for the command line: the executable, or node and the script for playhead-cli.js / playhead-cli.cjs.
function M.cli_argv(exe, node, args)
  local argv = {}
  local e = M.extension(exe)
  if e == "js" or e == "cjs" or e == "mjs" then argv[1] = (node and node ~= "") and node or "node"; argv[2] = exe
  else argv[1] = exe end
  for _, a in ipairs(args or {}) do argv[#argv + 1] = a end
  return argv
end

--- A message for the user from a failed run: exit code and the error output.
function M.explain_failure(code, stderr, ctx)
  ctx = ctx or {}
  local err = trim(stderr)
  local last = ""
  for line in err:gmatch("[^\r\n]+") do if trim(line) ~= "" then last = trim(line) end end
  local first = trim((err:match("^[^\r\n]*")))
  local msg = first ~= "" and first or last
  msg = msg:gsub("^playhead:%s*", "")
  local ext = ctx.file and M.extension(ctx.file) or ""
  if err:find("only WAV is read without ffmpeg", 1, true) or err:find("needs ffmpeg", 1, true) then
    return "Playhead reads WAV files itself; " .. (ext ~= "" and ("." .. ext) or "this format") ..
      " files need ffmpeg. Install ffmpeg and make sure REAPER can find it (add its folder under \"Extra folders\" in Playhead - Settings), or glue or render the item to WAV first."
  end
  if err:find("not a RIFF/WAVE file", 1, true) or err:find("unsupported WAV encoding", 1, true) or err:find("missing fmt or data chunk", 1, true) then
    return "Playhead cannot read this WAV file without ffmpeg (" .. msg .. "). Install ffmpeg and make sure REAPER can find it, or render the item to an ordinary PCM or float WAV first."
  end
  if code == 127 or code == 9009 or err:find("command not found", 1, true) or err:find("not recognized as an internal or external command", 1, true) or err:find("No such file or directory", 1, true) and err:find(ctx.exe or "\0", 1, true) then
    return "The Playhead executable could not be started (" .. tostring(ctx.exe or "playhead") .. "). Choose it in Playhead - Settings."
  end
  if code == 126 or err:find("Permission denied", 1, true) then
    return "The Playhead executable is not allowed to run (" .. tostring(ctx.exe or "playhead") .. "). On macOS and Linux run: chmod +x on it."
  end
  if ctx.os == "macos" and (code == 137 or code == 9 or err:find("Killed", 1, true)) then
    return "macOS stopped the Playhead executable. If it was downloaded from the web, clear its quarantine flag once: xattr -d com.apple.quarantine <path to playhead>, then try again."
  end
  if code == 70 then return "Playhead finished, but its result could not be moved into place (" .. msg .. ")." end
  if msg == "" then return fmt("Playhead stopped with exit code %s and no message.", tostring(code)) end
  return fmt("Playhead stopped with an error (exit code %s): %s", tostring(code), msg)
end

--- A rough duration in seconds for a run, for the progress bar. kind: "analyze" or "process".
function M.estimate_seconds(duration, profile, kind)
  local d = max(0, tonumber(duration) or 0)
  local t
  if profile == "fast" then t = 0.4 + 0.04 * d
  elseif d <= 10 and profile ~= "music" then t = 0.6 + 0.25 * d
  else t = 1.2 + 0.03 * d end
  if kind == "process" then t = t * 1.6 + 0.05 * d end
  return t
end

------------------------------------------------------------------------------------------------------------------------
-- cache keys
------------------------------------------------------------------------------------------------------------------------
--- FNV-1a, 64 bits, as 16 hexadecimal digits.
function M.fnv1a64(s)
  local h = -3750763034362895579                          -- 0xcbf29ce484222325
  for i = 1, #s do h = (h ~ byte(s, i)) * 1099511628211 end
  return fmt("%016x", h)
end

--- Cache key of an analysis: the source file (path, size in bytes, length in seconds) and what was asked for
--- (profile, Playhead version). Paths compare without case and with either slash on Windows.
function M.cache_key(t)
  local p = tostring(t.path or "")
  if t.os == "windows" then p = p:gsub("\\", "/"):lower() end
  local size = type(t.size) == "number" and (math.tointeger(t.size) or t.size) or t.size or ""
  local id = concat({ p, tostring(size), fmt("%.4f", tonumber(t.length) or 0),
    tostring(t.profile or "auto"), tostring(t.version or "") }, "|")
  return M.safe_name(M.stem(t.os == "windows" and p or (t.path or "sound")), 40) .. "-" .. M.fnv1a64(id)
end

------------------------------------------------------------------------------------------------------------------------
-- processing tools (playhead tools) and their parameter dialogs
------------------------------------------------------------------------------------------------------------------------
--- Parses the output of `playhead tools`. Returns a list of tools, or nil and a message.
function M.parse_tools(text)
  local ok, list = pcall(M.json_decode, text)
  if not ok or type(list) ~= "table" then return nil, "the list of tools could not be read" end
  local out = {}
  for _, t in ipairs(list) do
    if type(t) == "table" and type(t.id) == "string" and t.id ~= "" then
      local params = t.params
      if params ~= "layers" and type(params) ~= "table" then params = {} end
      out[#out + 1] = { id = t.id, name = tostring(t.name or t.id), kind = tostring(t.kind or ""), description = tostring(t.description or ""), params = params }
    end
  end
  if #out == 0 then return nil, "Playhead listed no tools" end
  return out
end

local function caption_safe(s) return (tostring(s):gsub(",", ";"):gsub("[\r\n]", " ")) end
local function value_safe(s) return (tostring(s):gsub(",", " "):gsub("[\r\n]", " ")) end

--- The fields of a tool's parameter dialog (at most 16, as GetUserInputs allows).
--- remembered: { [param id] = value } from an earlier run; doc (optional): the item's analysis, which names the
--- layers for Layer remix. Returns { title, fields = { {id, kind, caption, default, spec} } }.
function M.tool_dialog(tool, remembered, doc)
  remembered = remembered or {}
  local fields = {}
  if tool.params == "layers" then
    local names, zeros = {}, {}
    if doc and type(doc.layers) == "table" then
      for _, l in ipairs(doc.layers) do names[#names + 1] = caption_safe(l.name or "layer"); zeros[#zeros + 1] = "0" end
    end
    local caption = #names > 0 and ("Layer gains in dB: " .. concat(names, " ") .. " (spaces between)")
      or "Layer gains in dB (lowest layer first; spaces between)"
    local dflt = remembered.gains and tostring(remembered.gains):gsub(",", " ") or (#zeros > 0 and concat(zeros, " ") or "0 0 0")
    fields[1] = { id = "gains", kind = "gains", caption = caption, default = value_safe(dflt) }
  else
    for _, p in ipairs(tool.params) do
      if #fields >= 16 then break end
      local ty = p.type or "number"
      local f = { id = p.id, spec = p }
      local label = caption_safe(p.label or p.id)
      local rv = remembered[p.id]
      if ty == "bool" then
        f.kind = "bool"; f.caption = label .. " (yes/no)"
        local v = p.value
        if rv ~= nil then v = (rv == true or rv == "true") end
        f.default = M.yesno(v)
      elseif ty == "select" and type(p.options) == "table" then
        f.kind = "select"
        local ids = {}
        for _, o in ipairs(p.options) do ids[#ids + 1] = caption_safe(type(o) == "table" and o[1] or o) end
        f.caption = label .. " (" .. concat(ids, "/") .. ")"
        f.default = value_safe(rv ~= nil and rv or p.value or ids[1] or "")
      elseif ty == "number" then
        f.kind = "number"
        local range = ""
        if type(p.min) == "number" and type(p.max) == "number" then range = M.num(p.min) .. " to " .. M.num(p.max) end
        local unit = (type(p.unit) == "string" and p.unit ~= "") and caption_safe(p.unit) or ""
        local extra = trim(range .. (unit ~= "" and (" " .. unit) or ""))
        f.caption = label .. (extra ~= "" and (" (" .. extra .. ")") or "")
        f.default = value_safe(rv ~= nil and rv or (type(p.value) == "number" and M.num(p.value) or tostring(p.value or "")))
      else
        f.kind = "text"; f.caption = label
        f.default = value_safe(rv ~= nil and rv or p.value or "")
      end
      fields[#fields + 1] = f
    end
  end
  return { title = "Playhead: " .. tostring(tool.name), fields = fields }
end

--- Reads the dialog's answers (a list of strings, one per field). Returns params { [id] = text for --param } and
--- a list of problems (empty when all is well).
function M.parse_tool_inputs(dialog, values)
  local params, problems = {}, {}
  for i, f in ipairs(dialog.fields) do
    local v = trim(values[i] or "")
    local name = f.spec and (f.spec.label or f.id) or f.id
    if f.kind == "gains" then
      local g = {}
      for tok in v:gmatch("[^%s;,]+") do
        local x = tonumber(tok)
        if not x then problems[#problems + 1] = "layer gains: \"" .. tok .. "\" is not a number" else g[#g + 1] = M.num(x) end
      end
      params.gains = concat(g, ",")
    elseif f.kind == "bool" then
      local b = M.parse_bool(v)
      if b == nil then problems[#problems + 1] = name .. ": answer yes or no" else params[f.id] = b and "true" or "false" end
    elseif f.kind == "select" then
      local hit
      for k, o in ipairs(f.spec.options) do
        local id, lab = type(o) == "table" and o[1] or o, type(o) == "table" and o[2] or o
        if v:lower() == tostring(id):lower() or v == tostring(k) then hit = id break end
        if not hit and v ~= "" and tostring(lab):lower():sub(1, #v) == v:lower() then hit = id end
      end
      if not hit then
        local ids = {}
        for _, o in ipairs(f.spec.options) do ids[#ids + 1] = type(o) == "table" and o[1] or o end
        problems[#problems + 1] = name .. ": choose one of " .. concat(ids, ", ")
      else params[f.id] = tostring(hit) end
    elseif f.kind == "number" then
      local x = tonumber(v)
      local p = f.spec
      if not x then problems[#problems + 1] = name .. ": \"" .. v .. "\" is not a number"
      elseif (type(p.min) == "number" and x < p.min - 1e-9) or (type(p.max) == "number" and x > p.max + 1e-9) then
        problems[#problems + 1] = fmt("%s: %s is outside %s to %s", name, M.num(x), M.num(p.min), M.num(p.max))
      else params[f.id] = M.num(x, 6) end
    else
      params[f.id] = v
    end
  end
  return params, problems
end

--- --param arguments, in the dialog's order.
function M.tool_args(dialog, params)
  local out = {}
  for _, f in ipairs(dialog.fields) do
    if params[f.id] ~= nil and params[f.id] ~= "" then out[#out + 1] = "--param"; out[#out + 1] = f.id .. "=" .. params[f.id] end
  end
  return out
end

--- Take name for a tool's output: the tool's name, and, when the tool rendered several files, what this one is
--- (from the file's suffix: "deharsh-removed" -> "De-harsh (removed)", "var2" -> "Variations (var 2)").
function M.take_name(tool, suffix, count)
  local name = tostring(tool.name or tool.id)
  suffix = tostring(suffix or "")
  if (count or 1) > 1 and suffix ~= "" and suffix ~= tool.id then
    local s = suffix:gsub("^" .. tostring(tool.id):gsub("%p", "%%%0") .. "[-_]?", "")
    if s == "" then s = suffix end
    s = s:gsub("[-_]", " "):gsub("(%a)(%d)", "%1 %2")
    name = name .. " (" .. s .. ")"
  end
  return name
end

--- The suffix of an output file written by `playhead process` (<stem>_<suffix>.wav).
function M.output_suffix(path, source_path)
  local b = M.stem(path)
  local st = M.stem(source_path or "")
  if st ~= "" and b:sub(1, #st + 1) == st .. "_" then return b:sub(#st + 2) end
  return b:match("_([^_]+)$") or b
end

--- Output files named in the process command's error output ("wrote <path>" lines), in order.
function M.written_files(stderr)
  local out = {}
  for line in tostring(stderr or ""):gmatch("[^\r\n]+") do
    local p = line:match("^wrote (.+)$")
    if p then out[#out + 1] = trim(p) end
  end
  return out
end

------------------------------------------------------------------------------------------------------------------------
-- dialogs (GetUserInputs): captions and answers, comma-separated
------------------------------------------------------------------------------------------------------------------------
--- captions_csv and retvals_csv for GetUserInputs. Commas inside captions and defaults are replaced, because the
--- dialog separates fields with commas.
function M.dialog_csv(fields, extrawidth)
  local caps, vals = {}, {}
  for i, f in ipairs(fields) do caps[i] = caption_safe(f.caption); vals[i] = value_safe(f.default or "") end
  local c = concat(caps, ",")
  if extrawidth then c = c .. ",extrawidth=" .. floor(extrawidth) end
  return c, concat(vals, ",")
end
--- Splits GetUserInputs' answer. Returns the list, or nil when a field contained a comma (more fields than asked).
function M.dialog_values(csv, n)
  local v = M.split(csv or "", ",")
  if #v ~= n then return nil end
  return v
end

------------------------------------------------------------------------------------------------------------------------
-- settings
------------------------------------------------------------------------------------------------------------------------
M.SETTINGS_SECTION = "Playhead"
M.DEFAULTS = {
  exe = "",              -- the playhead executable, or playhead-cli.js / playhead-cli.cjs (run with node)
  node = "node",         -- Node.js, for the .js command line
  profile = "auto",      -- analysis profile: auto, fast, sfx or music
  timeout = "600",       -- seconds before a run is given up
  extra_path = "",       -- folders added to PATH for Playhead's own use of ffmpeg and node, separated by ;
  look = "auto"          -- the strip window's look (name or code)
}
M.PROFILES = { auto = true, fast = true, sfx = true, music = true }

--- Folders from the "extra folders" setting, plus the usual places for ffmpeg and node on macOS.
function M.extra_path_dirs(setting, os)
  local out = {}
  for d in tostring(setting or ""):gmatch("[^;]+") do d = trim(d); if d ~= "" then out[#out + 1] = d end end
  if os == "macos" then out[#out + 1] = "/opt/homebrew/bin"; out[#out + 1] = "/usr/local/bin" end
  if os == "linux" then out[#out + 1] = "/usr/local/bin" end
  return out
end

return M
