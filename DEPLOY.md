# Deploying to Netlify

The Netlify project already exists:

- **Project:** `bug-terrarium`
- **Site ID:** `8cc55161-f8d8-43ec-942f-46149c7a0fb8`
- **Team:** Synergy (`frostpancar`)
- **URL once deployed:** https://bug-terrarium.netlify.app
- **Dashboard:** https://app.netlify.com/projects/bug-terrarium

It has no deploy yet — the files still need to be uploaded.

## Option 1 — one command (needs a computer)

Unzip the deploy folder, then from inside it:

```bash
npx netlify-cli deploy --prod --dir . --site 8cc55161-f8d8-43ec-942f-46149c7a0fb8
```

First run opens a browser to authorize. After that it's a one-liner for every redeploy.

## Option 2 — drag and drop (no install)

Open https://app.netlify.com/projects/bug-terrarium/deploys in a desktop browser
and drag the unzipped `deploy` folder onto the drop zone.

## What's in the deploy folder

```
index.html            self-contained build — Phaser inlined, zero external requests
dev.html              ES-module version, reads /src/*, Phaser from /vendor
src/                  the actual source modules
vendor/phaser.min.js  vendored so the site has no third-party dependency
netlify.toml          publish dir + headers, no build step
README.md
```

No build command, no environment variables, no functions. It's a static folder.
