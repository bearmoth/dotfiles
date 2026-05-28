return {
  "nvim-neo-tree/neo-tree.nvim",
  opts = function(_, opts)
    local ok, repo_ignore = pcall(require, "util.repo_ignore")
    if not ok then return opts end

    local entries = repo_ignore.entries_for(vim.fn.getcwd())
    if #entries.names == 0 and #entries.patterns == 0 then return opts end

    opts.filesystem = opts.filesystem or {}
    opts.filesystem.filtered_items = opts.filesystem.filtered_items or {}
    local fi = opts.filesystem.filtered_items
    fi.hide_by_name = fi.hide_by_name or {}
    fi.hide_by_pattern = fi.hide_by_pattern or {}
    vim.list_extend(fi.hide_by_name, entries.names)
    vim.list_extend(fi.hide_by_pattern, entries.patterns)

    return opts
  end,
}
