# divenv

Before each prompt, **direnv** checks for the existence of a `.envrc` file (and optionally a `.env` file) in the current and parent directories. if the file exists (and is authorized), it is loaded into a **bash** sub-shell and all exported variables are then captured by direnv and then made available to the current shell.

When combined with **nix-shell**, **direnv** becomes a powerful tool for managing project development dependencies and configurations.

## Resources

- https://divenv.net
