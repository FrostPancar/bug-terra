# Pushing this to GitHub manually

The cloud sandbox can't push — its git proxy only issues credentials for repos
in the session's authorized set, and Cowork has no GitHub connector to add one.
So the history travels as a **git bundle**: a single file containing all seven
commits, byte-identical to what a push would have produced.

You need `git` and about a minute.

---

## 1. Unpack the bundle

Put `bug-terra.bundle` somewhere convenient, then:

```bash
git clone bug-terra.bundle bug-terra
cd bug-terra
```

You now have the full repo on branch `main`, with all seven commits and their
messages intact — not a snapshot, the real history.

## 2. Point it at your repo

`git clone` sets `origin` to the bundle file, so replace it:

```bash
git remote set-url origin https://github.com/FrostPancar/bug-terra.git
```

## 3. Push

```bash
git push -u origin main
```

`FrostPancar/bug-terra` already exists and is empty, so this is a clean
fast-forward — nothing to overwrite, no force needed.

---

## Verify it worked

```bash
git log --oneline        # 7 commits, newest: "Diversify the gene pool..."
npm install && npm test  # 20 passing
```

---

## Then connect Netlify

The Netlify project already exists — I created it earlier via the connector:

- **Project:** `bug-terrarium`
- **Site ID:** `8cc55161-f8d8-43ec-942f-46149c7a0fb8`
- **Dashboard:** https://app.netlify.com/projects/bug-terrarium
- **URL once deployed:** https://bug-terrarium.netlify.app

In that project: **Site configuration → Build & deploy → Link repository**, pick
`FrostPancar/bug-terra`. Your GitHub account is already connected to Netlify, so
there's no extra authorization.

Settings — these match the committed `netlify.toml`, so Netlify should
pre-fill them:

| Field | Value |
|---|---|
| Branch | `main` |
| Build command | *(leave empty)* |
| Publish directory | `deploy` |

No environment variables, no functions. It's a static folder.

Every push to `main` redeploys from then on.

---

## If you change the source later

`deploy/` is generated, not hand-edited. After changing anything in `src/`:

```bash
npm run release     # rebuilds dist/terrarium.html AND restages deploy/
git commit -am "..." && git push
```

Skipping that means `src/` and the deployed site drift apart.

---

## Don't want to use git at all?

`bugsim-prototype.zip` is the same tree without history. Upload it through
GitHub's web UI, or drag the `deploy` folder straight onto
https://app.netlify.com/drop for an instant URL with no repo at all.
