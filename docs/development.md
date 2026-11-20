# Development

## Project layout

```
adbcp                    the copy engine (one bash script)
README.md                overview, safety notes, disclaimer
docs/                    guides and specifications
mtp/                     adbcp-mtp: copies over MTP (Rust library and CLI)
  src/lib.rs             devices, listing, file operations, copies
  src/main.rs            the adbcp-mtp command-line tool
app/                     desktop app (Tauri 2)
  package.json           build scripts and the Tauri command-line tool
  src/                   the window: index.html, styles.css, main.js
  src-tauri/
    Cargo.toml           Rust dependencies
    tauri.conf.json      app name, version, window, bundled engine, signing
    capabilities/        what the window can call
    icons/               app icons
    src/main.rs          the Rust core
.github/workflows/       GitHub build workflow
```

The engine and the app are separate:

- The engine does all copying, measuring, and checking over adb.
- The app starts the engine with `--json` and shows the events it prints.
- For a phone without USB debugging, the app calls the `adbcp-mtp` library (in `mtp/`)
  in-process. The library sends the same events.

To test the MTP library on a phone in File transfer mode:

```bash
cd mtp
cargo test                                          # unit tests, no phone needed
cargo run --release -- devices
cargo run --release -- ls SERIAL /sdcard/Download
cargo run --release -- push SERIAL --verify ~/Movies/trip.mp4 /sdcard/Download/
```

`adbcp-mtp --help` lists the commands. Only one program can use a phone's MTP
connection at a time: quit the app before you run the CLI.

See the [Engine specification](engine-spec.md) and the [App specification](app-spec.md).

## Rules for the engine

- The engine must run on bash 3.2, which comes with macOS. Do not use bash 4 features,
  such as associative arrays or `mapfile`.
- The engine must use only tools that come with macOS, plus adb.
- New output for the app goes into a JSON event. Add the event to
  [Events](engine-spec.md#71-events).

To check the syntax with the macOS bash:

```bash
/bin/bash -n adbcp
```

## Build the app

You need:

- Rust, installed with [rustup](https://rustup.rs).
- Node.js, for the Tauri command-line tool.

Build for the Mac you use:

```bash
cd app
npm install
npm run build
open src-tauri/target/release/bundle/macos/adbcp.app
```

Build one app for Apple Silicon and Intel:

```bash
rustup target add x86_64-apple-darwin      # one time
npm run build -- --target universal-apple-darwin
open src-tauri/target/universal-apple-darwin/release/bundle/macos/adbcp.app
```

The build signs the app ad-hoc (`"signingIdentity": "-"` in `tauri.conf.json`). This is
not an Apple signature. It lets macOS offer **Open Anyway** for a downloaded copy.

| Build | Size |
|---|---|
| One architecture | about 3 MB |
| Apple Silicon and Intel | about 6.6 MB |

## Run during development

`npm run dev` starts the app from the source files.

Set `ADBCP_ENGINE` to use an engine from another path:

```bash
ADBCP_ENGINE="$PWD/../adbcp" npm run dev
```

## Test without clicking

The app reads a copy request from `ADBCP_APP_AUTORUN` at start. It then opens the
destination and starts the copy.

```bash
ADBCP_APP_AUTORUN='{"sources":["/Users/me/Movies"],"dest":"/sdcard/Movies/","verify":true}' \
  src-tauri/target/release/bundle/macos/adbcp.app/Contents/MacOS/adbcp-app
```

| Field | Meaning |
|---|---|
| `sources` | Paths to copy |
| `dest` | Destination folder |
| `verify` | Verify after the copy. The default is `true`. |
| `skipExisting` | Skip files that exist with the same size |
| `fixNames` | Copy with safe names |
| `pull` | Copy from the phone to the Mac |
| `downloadAdb` | Download adb without the dialog if none is found |

The test uses the normal window logic. It also writes the settings file. Make a copy of
`~/Library/Application Support/dev.adbcp.desktop/settings.json` before you test.

To test the app without adb, hide the usual adb folders:

```bash
env -i HOME="$(mktemp -d)" PATH=/usr/bin:/bin ADBCP_ADB_SEARCH_COMMON=0 \
  src-tauri/target/release/bundle/macos/adbcp.app/Contents/MacOS/adbcp-app
```

## GitHub build

The workflow `.github/workflows/build.yml` runs on GitHub's free macOS runner. It runs
only in these cases:

- **On demand:** open **Actions > Build > Run workflow**.
- **On a tag push:** push a tag that starts with `v`, for example `v0.3.0`.

Pushes to branches and pull requests do not start it.

Each run does these steps:

1. Checks that a tag points to a commit on `main`. If not, the run stops.
2. Checks the engine with the macOS bash 3.2.
3. Runs the unit tests of the MTP library.
4. Builds the app for Apple Silicon and Intel.
5. Verifies the signature and zips the app.
6. Keeps the zip as a workflow artifact for about 14 days.
7. For a tag, attaches the zip to a GitHub release.

## Make a release

1. Set the new version in these three files:
   - `app/package.json`
   - `app/src-tauri/Cargo.toml`
   - `app/src-tauri/tauri.conf.json`
2. Build and test the app locally.
3. Commit the changes on `main` and push them.
4. Make the tag and push it:

   ```bash
   git tag v0.4.0
   git push origin v0.4.0
   ```

5. Open **Actions** on GitHub and wait for the **Build** run to finish.
6. Open **Releases** and check the zip and the release notes.

The zip name comes from the version in `tauri.conf.json`. Use the same version in the tag.

## Before you commit

- Run `/bin/bash -n adbcp`.
- Run `node --check app/src/main.js`.
- Run `cargo test` in `mtp/`.
- Build the app once.
- Copy a test folder to a real phone and back, with `--verify`.
- Update the docs in `docs/` when you change options, events, or behavior.
