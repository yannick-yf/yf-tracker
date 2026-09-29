# AGENTS.md — yf-tracker (training-log PWA)

This repo is **app code only** — `index.html`, `sw.js`, `manifest.json`, icons. It is a **public**
GitHub repo hosted on GitHub Pages. **Never** add health data, CSVs, or anything from the
`health_dasboard` repo here.

**Full context (Yannick's profile, goals, active program, nutrition protocol, medical notes,
recent history) lives in the sibling repo:**
`~/PersoProject/health_dasboard/AGENTS.md` and `~/PersoProject/health_dasboard/docs/context/`.
Read that before making any change here that isn't purely mechanical (a CSS tweak, a bug fix in the
export/import logic, etc.) — in particular `02_training_program.md` for why the location-tagging
feature exists and how program versioning works, and `05_app_and_data_pipeline.md` for the full
sync pipeline this app is one half of.

## What this app does

A single-file, offline-capable PWA for logging Yannick's gym sessions on his phone:
- IndexedDB storage, service worker (stale-while-revalidate) for true offline use at the gym.
- A **location picker** per session (Home / Basic Fit / ToTheLimitGym / Hotel / Other) — because cable/machine
  weights aren't comparable across venues (see the training-program context doc), the app shows
  both "↩ last time at THIS location" and "↔ most recent anywhere" for each exercise.
- Export → JSON (full history every time) → the user saves it to iCloud Drive, where
  `health_dasboard/scripts/merge_tracker_export.py` picks it up.
- Import → lets Yannick push a new program version (`yf-tracker-program-vX.json`) without a code
  deploy, and restore full history onto a fresh install.

## Deploying a change

Yannick runs git himself (not you, unless asked): his global gpg config is broken, so any commit
needs `--no-gpg-sign`, e.g. `git add . && git commit --no-gpg-sign -m "..." && git push`. A logic
change (not just program data) needs the cache name bumped in `sw.js` so the service worker
actually picks it up on next load — bump the version string, e.g. `yf-tracker-vN`.

## Versioning convention

Displayed in-app as `app-vX.Y · program YF-UL5 vA.B` — these are two independent version numbers
(app code vs. program data). Don't conflate them; check the current values in `index.html` rather
than assuming.
