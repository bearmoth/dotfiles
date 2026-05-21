return {
  "akinsho/bufferline.nvim",
  opts = {
    options = {
      diagnostics = "nvim_lsp",
      diagnostics_indicator = function(_, _, diag)
        local icons = { error = " ", warning = " ", hint = " ", info = " " }
        local result = {}
        for level, n in pairs(diag) do
          if icons[level] and n and n > 0 then
            table.insert(result, icons[level] .. n)
          end
        end
        return table.concat(result, " ")
      end,
      always_show_bufferline = false,
      color_icons = true,
      separator_style = "thin",
    },
  },
}
