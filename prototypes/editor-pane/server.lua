-- PROTOTYPE — throwaway (dotfiles#74). Loaded with `-c luafile` (after LazyVim) by the
-- variant 1 server and the variant 2 nvim. Only server-mode guards; nothing about how nvim
-- looks or behaves in Ghostty changes, since this file is never loaded there.

-- Ctrl-Z under a client with no job-control shell detaches the UI and freezes the pane.
vim.keymap.set({ 'n', 'v' }, '<C-z>', '<Nop>', { desc = 'proto: no suspend in a space editor' })

-- Record focus events so `proto.sh peek` can show whether the pane forwards them
-- (FocusGained under --remote-ui is an open question: neovim#20082).
vim.g.pep_focus = {}
for _, ev in ipairs({ 'FocusGained', 'FocusLost', 'UIEnter', 'UILeave' }) do
  vim.api.nvim_create_autocmd(ev, {
    callback = function()
      local t = vim.g.pep_focus
      table.insert(t, ev .. '@' .. os.date('%H:%M:%S'))
      if #t > 12 then table.remove(t, 1) end
      vim.g.pep_focus = t
    end,
  })
end
