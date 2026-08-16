# 1Password setup

## How settings are managed

1Password's config (`~/.config/1Password/settings/settings.json`) is
app-owned and integrity-signed: every security-relevant setting is paired
with an `authTags` entry keyed to the individual machine/install, so the
file can't be synced wholesale — deploying one machine's copy onto another
reads as tampering and the app rewrites it, leaving `chezmoi diff` never
converging.

Instead, a `modify_` script
(`dot_config/private_1Password/settings/modify_private_settings.json`)
enforces just the values we care about and passes `authTags` — and any
other app-owned key — through untouched. Verified empirically (metabox,
2026-08-17): the app accepts a value edited without its matching tag and
keeps it. The script currently enforces:

- SSH agent: enabled, authorize by *application*, **4 h** sessions,
  remember key titles
- CLI integration (shared lock state)
- Auto-lock after **60 minutes**; unlock via system authentication
- Browser extension integration

Change a setting by editing `DESIRED` in the modify_ script, not by
capturing the whole file with `chezmoi add`.

## New-machine steps (manual)

Installing the app and signing in can't be automated:

1. `chezmoi apply` installs 1Password + 1password-cli (packages) and
   pre-seeds the settings values above.
2. Open the app and sign in — fastest: scan the setup QR from 1Password on
   another device.
3. Verify from a **fresh shell** (fish only picks up the agent socket at
   startup):

   ```bash
   ssh-add -l          # should list keys served by 1Password
   ssh -T git@github.com
   ```

4. Run `chezmoi apply` once more — it clones anything that was skipped
   while SSH auth was missing (vaults, reference repos).
