return {
  "nvim-lualine/lualine.nvim",
  opts = function(_, opts)
    opts.winbar = {}
    opts.inactive_winbar = {}

    opts.options = vim.tbl_deep_extend("force", opts.options or {}, {
      globalstatus = false,
    })

    opts.sections = {
      lualine_a = { { "mode", fmt = function(s) return s:sub(1, 1) end } },
      lualine_b = { "branch", "diff" },
      lualine_c = {
        { "filename", path = 1, symbols = { modified = "●", readonly = "", unnamed = "[No Name]" } },
        "diagnostics",
      },
      lualine_x = {},
      lualine_y = { "progress" },
      lualine_z = { "location" },
    }

    opts.inactive_sections = {
      lualine_a = {},
      lualine_b = {},
      lualine_c = { { "filename", path = 1 } },
      lualine_x = {},
      lualine_y = {},
      lualine_z = {},
    }

    return opts
  end,
}
