return {
  "catppuccin/nvim",
  lazy = false,
  name = "catppuccin",
  priority = 1000,
  config = function()
    require("catppuccin").setup({
      flavour = "mocha",
      transparent_background = true,
      custom_highlights = function(c)
        -- fg-only overrides: no bg changes so chrome stays transparent.
        -- Three focus states for names; indicator gets the accent color.
        local selected = { fg = c.text, bold = true }
        local visible = { fg = c.subtext1 }
        local hidden = { fg = c.overlay0 }

        return {
          -- Clear focus states
          BufferLineBufferSelected = selected,
          BufferLineBufferVisible = visible,
          BufferLineBackground = hidden,
          BufferLineIndicatorSelected = { fg = c.blue },

          -- Decouple diagnostic state from name color; icons remain
          -- colored via the BufferLineDiagnostic* groups (untouched).
          BufferLineHint = hidden,
          BufferLineHintVisible = visible,
          BufferLineHintSelected = selected,
          BufferLineInfo = hidden,
          BufferLineInfoVisible = visible,
          BufferLineInfoSelected = selected,
          BufferLineWarning = hidden,
          BufferLineWarningVisible = visible,
          BufferLineWarningSelected = selected,
          BufferLineError = hidden,
          BufferLineErrorVisible = visible,
          BufferLineErrorSelected = selected,

          -- Inactive statusline gets a surface background so horizontal split
          -- boundaries are as visible as vertical split separators.
          StatusLineNC = { bg = c.surface0, fg = c.overlay1 },

          -- Current line number brighter than relative numbers above/below.
          LineNr = { fg = c.overlay2 },
          LineNrAbove = { fg = c.overlay1 },
          LineNrBelow = { fg = c.overlay1 },
        }
      end,
    })
    vim.cmd.colorscheme("catppuccin")
  end,
}
