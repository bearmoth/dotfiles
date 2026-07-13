return {
  "mfussenegger/nvim-lint",
  opts = function(_, opts)
    local cli2 = require("lint.linters.markdownlint-cli2")
    -- markdownlint-cli2 doesn't resolve config via directory walking in stdin
    -- mode, so we pass the global config explicitly
    cli2.args = { "--config", vim.fn.expand("~/.markdownlint-cli2.yaml"), "-" }
    return opts
  end,
}
