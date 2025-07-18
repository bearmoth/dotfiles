local wezterm = require("wezterm")

-- The colour scheme name
-- Alternative themes I like, "Breeze (Gogh)" "Afterglow", "Catppuccin Mocha"
local scheme = "nord"

-- Obtain the definition of the color scheme
-- local scheme_def = wezterm.color.get_builtin_schemes()[scheme]

local function is_vim(pane)
	-- this is set by the plugin, and unset on ExitPre in Neovim
	return pane:get_user_vars().IS_NVIM == "true"
end

-- Pane navigation key config
local direction_keys = {
	Left = "h",
	Down = "j",
	Up = "k",
	Right = "l",
	-- reverse lookup
	h = "Left",
	j = "Down",
	k = "Up",
	l = "Right",
}

local function split_nav(resize_or_move, key)
	return {
		key = key,
		mods = resize_or_move == "resize" and "META" or "CTRL",
		action = wezterm.action_callback(function(win, pane)
			if is_vim(pane) then
				-- pass the keys through to vim/nvim
				win:perform_action({
					SendKey = { key = key, mods = resize_or_move == "resize" and "META" or "CTRL" },
				}, pane)
			else
				if resize_or_move == "resize" then
					win:perform_action({ AdjustPaneSize = { direction_keys[key], 3 } }, pane)
				else
					win:perform_action({ ActivatePaneDirection = direction_keys[key] }, pane)
				end
			end
		end),
	}
end

return {
	-- Leader key
	--
	leader = { key = "a", mods = "CTRL", timeout_milliseconds = 1000 },

	-- Colour scheme
	--
	font = wezterm.font("JetBrains Mono", { weight = "DemiBold" }),
	color_scheme = scheme,

	macos_window_background_blur = 85,

	colors = {

		background = "rgba(59 64 79 35%)",
		foreground = "rgb(255, 255, 255)",

		tab_bar = {
			active_tab = {
				bg_color = "rgb(59 64 79)",
				fg_color = "rgb(220 220 220)",
			},
		},
	},

	-- Tabs
	hide_tab_bar_if_only_one_tab = true,

	-- Key maps
	keys = {
		-- Panes
		{
			mods = "LEADER",
			key = "-",
			action = wezterm.action.SplitVertical({ domain = "CurrentPaneDomain" }),
		},
		{
			mods = "LEADER",
			key = "|",
			action = wezterm.action.SplitHorizontal({ domain = "CurrentPaneDomain" }),
		},

		-- Pane navigation
		split_nav("move", "h"),
		split_nav("move", "j"),
		split_nav("move", "k"),
		split_nav("move", "l"),

		-- Pane resize
		split_nav("resize", "h"),
		split_nav("resize", "j"),
		split_nav("resize", "k"),
		split_nav("resize", "l"),

		-- Tabs
		{
			key = "E",
			mods = "CTRL|SHIFT",
			action = wezterm.action.PromptInputLine({
				description = "Enter new name for tab",
				action = wezterm.action_callback(function(window, pane, line)
					-- line will be `nil` if they hit escape without entering anything
					-- An empty string if they just hit enter
					-- Or the actual line of text they wrote
					if line then
						window:active_tab():set_title(line)
					end
				end),
			}),
		},
	},

	-- Window
	window_decorations = "RESIZE",
}
