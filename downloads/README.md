# downloads/

What the landing page (`/`, also `/landing` and `/download`) hands out.

## The Android package

The server serves the **newest `.apk` it finds** in `downloads/` first, then in
`apk/` — so a new build can simply be dropped next to the old one and it takes
over. The current build is `apk/Ailexity-1.0.1.apk`.

It is always served from the same address, `/download/ailexity-retail.apk`,
with the right content type and as an attachment, so Android treats it as an
install file and the browser saves it under its real file name.

Nothing needs restarting: the folders are scanned per request.

Until a package exists the page does **not** show a broken download — the
button becomes "Ask for the APK" (a mailto link) and says the package has not
been published on this server yet.

## `apk.json`

Optional metadata shown under the download button, read from this folder and
then from the folder the package was found in (the closer file wins). Every
field may be left out.

| Field | Shown as | Default |
|---|---|---|
| `version` | `v1.0.1` | taken from the file name (`Ailexity-1.0.1.apk`) |
| `minAndroid` | `Android 8.0 and newer` | `Android 8.0 and newer` |
| `notes` | not shown — kept for release records | — |

The size and the "updated" date always come from the file itself.

## Building the package

The app is a PWA, so the package is a thin wrapper around the store address:

- **Bubblewrap** (`npm i -g @bubblewrap/cli`, then `bubblewrap init --manifest
  https://your-address/manifest.webmanifest`) produces a Trusted Web Activity.
  It needs the app served over **HTTPS** and a Digital Asset Links file, so use
  it with the Option B / Option C deployments in the main README.
- **PWABuilder** (pwabuilder.com) does the same from a URL, in a browser.

Sign the release build with your own keystore and keep that keystore safe —
Android will refuse an update signed with a different key.

Packages are git-ignored (`downloads/*.apk`, `apk/*.apk`); ship them with the
deployment rather than the repository.
