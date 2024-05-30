local wezterm = require("wezterm")

-- The colour scheme name
-- Second choice: "Catppuccin Mocha",
-- Third choice: "Afterglow",
local scheme = "Breeze (Gogh)"
-- temporarily set theme to Catppuccin until I find a way to make Breeze consistent across WezTerm, Nvim, Tmux, etc
scheme = "Catppuccin Mocha"

-- Obtain the definition of the color scheme
local scheme_def = wezterm.color.get_builtin_schemes()[scheme]

return {
	font = wezterm.font("JetBrains Mono", { weight = "DemiBold" }),
	color_scheme = scheme,

	colors = {
		tab_bar = {
			active_tab = {
				bg_color = scheme_def.background,
				fg_color = scheme_def.foreground,
			},
		},
	},

	hide_tab_bar_if_only_one_tab = true,
}
