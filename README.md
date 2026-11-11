# my-herdr-mods

Community mods for [Herdr](https://herdr.dev), built natively with `gpui-kit` and `gpui-base`.

Each mod folder is laid out like `~/.config/herdr-app` (without a `layouts/` folder) so your coding agent can install it directly or rebuild it from its `RECIPE.md`.

## Mods

| Mod | Description | Install Prompt |
| --- | --- | --- |
| [**my-files**](my-files/) | Lazy file browser for the focused pane's folder with native GPUI Markdown (`TextView.markdown`) rendering, a `Preview \| Raw` toggle, live reload on disk changes, and clickable relative/external links. | `Read ~/.config/herdr-app/AGENTS.md, then add this mod: herdr.dev/mods/latuannetnam/my-herdr-mods--my-files` |
| [**agent-quota**](agent-quota/) | Compact multi-agent quota status bar pills and a unified tabbed Quota Hub popup (`All \| AGY \| Codex`) for Antigravity (`agy`) and OpenAI Codex (`codex`), backed by a pluggable zero-token provider registry. | `Read ~/.config/herdr-app/AGENTS.md, then add this mod: herdr.dev/mods/latuannetnam/my-herdr-mods--agent-quota` |

## Structure

```
my-herdr-mods/
├── my-files/
│   ├── RECIPE.md
│   ├── preview.png
│   └── mods/my-files/
└── agent-quota/
    ├── RECIPE.md
    ├── preview.png
    └── mods/agent-quota/
```

## Testing

Both mods include zero-dependency Node.js (`node:test`) unit test suites:

```sh
node --test my-files/mods/my-files/helpers.test.js agent-quota/mods/agent-quota/helpers.test.js
herdr-app check my-files/mods/my-files
herdr-app check agent-quota/mods/agent-quota
```
