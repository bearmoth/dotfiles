local M = {}
local cache = {}

local function normalize_url(url)
  url = url:gsub("%s+$", "")  -- trim trailing newline before anchored patterns
  url = url:gsub("^https?://", "")
  url = url:gsub("^ssh://", "")
  url = url:gsub("^git@", "")
  url = url:gsub(":", "-", 1)
  url = url:gsub("%.git$", "")
  url = url:gsub("/", "-")
  return url:lower()
end

function M.slug_for(path)
  if cache[path] ~= nil then
    return cache[path] ~= false and cache[path] or nil
  end
  local out = vim.fn.system({ "git", "-C", path, "remote", "get-url", "origin" })
  if vim.v.shell_error ~= 0 then
    cache[path] = false
    return nil
  end
  local slug = normalize_url(out)
  cache[path] = slug
  return slug
end

function M.entries_for(path)
  local slug = M.slug_for(path)
  if not slug then return { names = {}, patterns = {} } end
  local list_path = vim.fn.expand("~/.config/nvim-ignores/" .. slug .. ".list")
  local f = io.open(list_path, "r")
  if not f then return { names = {}, patterns = {} } end
  local names, patterns = {}, {}
  for line in f:lines() do
    line = line:match("^%s*(.-)%s*$")
    if line ~= "" and not line:match("^#") then
      if line:match("[/*]") then
        table.insert(patterns, (line:gsub("/$", "")))  -- neo-tree paths never have trailing /
      else
        table.insert(names, line)
      end
    end
  end
  f:close()
  return { names = names, patterns = patterns }
end

return M
