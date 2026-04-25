# Publishing checklist

Run from inside this folder.

```sh
# 1. init the repo
git init
git add .
git commit -m "Initial release: 2026-04-25.7"
git branch -M main

# 2. create the repo on GitHub (CLI: brew install gh first if needed)
gh repo create cameronsjo/osrs-leagues-task-filters --public --source=. --remote=origin --description "OSRS Wiki Leagues task page filter, search, and stats userscript"
git push -u origin main
```

If you don't use the `gh` CLI, instead create the repo manually at <https://github.com/new> with the name `osrs-leagues-task-filters`, then:

```sh
git remote add origin git@github.com:cameronsjo/osrs-leagues-task-filters.git
git push -u origin main
```

After the first push, the install link in the README — `https://raw.githubusercontent.com/cameronsjo/osrs-leagues-task-filters/main/osrs-leagues-task-filters.user.js` — is live. The `@updateURL` in the script header points at the same URL, so existing installs auto-update on Tampermonkey's next polling pass.

## Subsequent releases

Edit `osrs-leagues-task-filters.user.js`, bump `@version` (e.g. `2026-04-25.8` → `2026-04-26.1`), update `CHANGELOG.md`, regenerate the minified bundle if you want, then:

```sh
git add osrs-leagues-task-filters.user.js osrs-leagues-task-filters.min.js CHANGELOG.md
git commit -m "Bump to <new version>: <one-line summary>"
git push
```

That's the entire release flow — no GitHub Actions, no tags, no releases page needed. Tampermonkey watches `main` directly.

## Optional: also list on Greasy Fork

Greasy Fork gives you discoverability inside the OSRS userscript community. Sign in at <https://greasyfork.org>, click "Submit a new script", paste the full `.user.js` content. Greasy Fork hosts its own copy at `update.greasyfork.org/scripts/<id>/...` and treats GitHub as upstream — when you `git push` here, Greasy Fork pulls the new version on next refresh.

If you list there, change the `@updateURL` and `@downloadURL` in this file to the Greasy Fork URLs (`https://update.greasyfork.org/scripts/<id>/<slug>.user.js` and `.meta.js`) so updates flow through their CDN rather than GitHub raw — Greasy Fork is more aggressively cached and has higher uptime than `raw.githubusercontent.com`.
