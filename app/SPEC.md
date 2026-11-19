# adbcp desktop app

Specification for the window around the adbcp copy engine

| | |
|---|---|
| Status | Version 0.3.0 built: two-pane window. Copies in both directions work end to end. |
| Platform | macOS 11 or newer, Apple Silicon and Intel |
| Built with | *Tauri* 2: a small Rust program that shows a window drawn with HTML, CSS and JavaScript |
| Size | About 3 MB. Google's adb is not included (see 3.1). |
| Engine | The command-line tool described in [../SPEC.md](../SPEC.md). The app runs it and shows what it reports. |
| Last updated | 2026-11-19 |

Terms in *italics* are explained in the [Glossary](#glossary) at the end and in the
[engine glossary](../SPEC.md#glossary).

---

## 1. Purpose

The engine is fast but is used from the Terminal. The app gives the same copies a
window in the style of a two-pane file manager: this Mac on one side, the phone on the
other, and copying is moving things across.
All copying, measuring and checking is done by the engine. The app only collects
choices, starts the engine, and presents its reports.

## 2. The window

Two side-by-side file panes, like Finder windows: this Mac on the left, the phone on the
right. Copying is moving things from one pane to the other. A transfer bar at the bottom
shows the copy in progress; settings live in a sheet opened with the gear button.

```
┌ adbcp ───────────────────────────────────────────────────────────────────────────────┐
│ Phone [ SM-S918B · USB 5 Gb/s       ▾ ] [Refresh]                         [⚙ Settings] │
│ ┌ This Mac ──────────────────────────────┐ ┌ Phone ──────────────────────────────────┐ │
│ │ [↑] [/Users/surya/Movies          ] [▾]│ │ [↑] [/sdcard/Movies              ] [▾]  │ │
│ │ [New folder] [Rename] [Move to Trash] ⟳│ │ [New folder] [Rename] [Delete]       ⟳  │ │
│ │ Name                  Size    Modified │ │ Name                  Size    Modified  │ │
│ │ 📁 Holiday 2026          —   12 Oct    │ │ 📁 Camera                —   3 Nov      │ │
│ │ 📄 trip.mp4         1.2 GiB   4 Nov    │ │ 📄 clip.mp4         640 MiB   1 Nov     │ │
│ │ …                                      │ │ …                                       │ │
│ │ 2 selected · 1.2 GiB    [Copy to phone →]│ │ [← Copy to Mac]           1 selected   │ │
│ └────────────────────────────────────────┘ └─────────────────────────────────────────┘ │
│ Copying 2 items to /sdcard/Movies · 8 parallel transfers · zstd                         │
│ [==================>                ] 61% · 0.7 of 1.2 GiB · 398 MiB/s · 0:02 left      │
│ ▸ Problems  ▸ Details                  1 copy waiting   [Retry] [Safe names] [Cancel]   │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

The window follows the Mac's light or dark appearance.

## 3. Using the app

### 3.1 Phone

- **adb first:** the app needs Google's adb but does not include it (Google's license
  limits redistributing it). At launch it looks for one already on the Mac (PATH,
  Homebrew, Android Studio, or one it downloaded before). If there is none, it asks:
  "adbcp needs Google's adb", with **Not now**, **Google's terms…** (opens Google's
  Platform-Tools page) and **Download** (about 16 MB from Google, once, with its
  signature checked). After "Not now" the phone pane explains how to get adb, and
  **Refresh** asks again. Settings shows which adb is used and where it came from.
- The list at the top shows every phone adb can see, with its model and connection, for
  example "SM-S918B · USB 5 Gb/s". The first ready phone is selected. **Refresh** looks again.
- Phones that are not ready are listed but cannot be chosen, with the reason ("allow this
  computer on the phone", "offline", …).
- Without a ready phone, the phone pane explains what to do (cable, *USB debugging*,
  allowing the computer). A note warns when the phone is connected at USB 2.0 speed.

### 3.2 The two panes

Both panes work the same way:

- **Path bar:** **↑** goes up one folder; the path can be typed (Enter to go); the **▾**
  menu has common places. On the Mac: Home, Desktop, Documents, Downloads, Movies, Music,
  Pictures and external drives. On the phone: Internal storage, Download, DCIM, Pictures,
  Movies, Music, Documents, and the app folders (`Android/data`, `Android/obb`).
- **List:** folders first, then files, with size and date. Click a column title to sort
  by it. Double-click (or Enter) opens a folder. Hidden items (names starting with `.`)
  appear when **Show hidden** is ticked in Settings.
- **Selecting:** click selects one item, ⌘-click adds or removes one, Shift-click
  selects a range, ⌘A selects everything. The pane's footer shows how many items are
  selected and the size of the selected files.
- **Keyboard:** ⌘↑ goes up, Enter opens, ⌘A selects all, ⌘⌫ deletes (with
  confirmation), ⇧⌘N makes a new folder.
- **File operations:** **New folder**, **Rename** (one item) and **Delete**. On the Mac,
  Delete moves items to the Trash. On the phone, deleting is permanent (adb has no
  trash): the app always asks first and names what will be deleted. The phone's storage
  roots and standard folders (such as `/sdcard`, `Android`, `DCIM`, `Download`) cannot be
  deleted from the app. New names are checked for characters the phone does not allow.
- The phone pane opens at the last phone folder used, or `/sdcard/Download`; the Mac pane
  at the last Mac folder used, or Downloads.

### 3.3 Copying

- **Copy to phone →** copies what is selected in the Mac pane into the folder open in
  the phone pane; **← Copy to Mac** does the opposite.
- **Dragging:** drag selected items from one pane and drop them on the other pane to
  copy them there; dropping on a folder in the other pane copies into that folder. Files
  and folders dragged from Finder can be dropped on the phone pane. While something is
  dragged, the pane that would receive it is highlighted with "Drop to copy here"; the
  Mac pane does not accept drops from Finder (that would just copy within the Mac).
- **Names that already exist:** if items with the same names are already in the
  destination folder, the app asks **Replace**, **Skip existing** (leaves files that are
  already there with the same size) or **Cancel**. A setting can make this automatic.
- **Queue:** copies started while another one runs wait their turn; the transfer bar
  shows how many are waiting. **Cancel** stops the current copy and clears the waiting ones.
- When a copy finishes, both panes are refreshed.

### 3.4 The transfer bar

- While copying: what is being copied and where, the plan the engine chose (parallel
  transfers, compression, saved or new measurements), and a progress bar with
  percentage, amount, speed, time left and files done. During verification the bar shows
  activity. If the engine measures the phone first, the bar says so.
- **Problems** lists files that failed, as they fail, with the reason. **Details** shows
  everything the engine reported.
- After a copy: the result in one line ("Copied 2 files, 1.2 GiB in 0:04 (301 MiB/s).
  Verified: all 2 files match."), plus what went wrong if anything did.
- **Retry failed files** runs the same copy again with "skip existing" on. Files whose
  names the phone does not allow are left out of a retry and reported again.
- **Copy with safe names** appears when files have names the phone does not allow, and
  copies them with each disallowed character replaced by `_` (for example
  `sound:effects.bnk` becomes `sound_effects.bnk`). Problems shows the new names first.
- **Cancel** stops the copy within a second; finished files stay, partly copied ones are
  removed. Quitting the app during a copy stops it the same way.

### 3.5 Settings

The gear button opens a sheet:

| Setting | Default | Engine option |
|---|---|---|
| Verify after copying | On | `--verify` |
| When names already exist | Ask | (Replace: plain copy; Skip existing: `--skip-existing`) |
| Show hidden files | Off | — |
| Tuning: measurements and **Measure now** | — | `--show-profile`, `--measure` |
| Parallel transfers | Automatic (measured) | `-j N` |
| Compression | Automatic (tests the data) | `-z none\|zstd\|lz4` |
| Split very large files | Automatic | `--no-split` when off |
| Part size | 128 MiB | `--chunk`, only when changed |
| Split files from | 256 MiB | `--split-min`, only when changed |
| Replace characters the phone does not allow with `_` | Off | `--fix-names` |
| Burst mode (experimental) | Off | `--burst` |
| libusb connection (experimental) | Off | `--libusb` |
| Skip the free-space check | Off | `--force` |

**Tuning** shows what the engine knows about the selected phone, its connection and the
kind of folder open in the phone pane (shared storage, app folders, or `/data`), for
example "Measured 2026-11-05 for shared storage: 8 parallel transfers for large files,
up to 4 for small files", or that it is not measured yet. **Measure now** measures there
(about 10 seconds) and saves the result. Copies from the phone use fixed settings.

Part size and the split threshold are passed to the engine only when changed: an
explicit value keeps splitting on even where the engine would switch it off by itself
(on a USB 2.0 link). The experimental options restart adb, which briefly disconnects
other adb tools; burst mode was slower on real copies in testing.

All settings except "Skip the free-space check" are remembered, together with the last
folder of each pane and each pane's sort order, in
`~/Library/Application Support/dev.adbcp.desktop/settings.json`.

### 3.6 Messages

| Situation | What the app shows |
|---|---|
| No phone found | In the phone pane: how to connect (cable, USB debugging, allow this computer), then Refresh |
| Phone connected at USB 2.0 speed | A note that a USB 3 cable and port can be 5–10 times faster |
| Names already exist in the destination | Replace / Skip existing / Cancel |
| Deleting on the phone | "Delete N items from the phone? This cannot be undone." with the names |
| A name the phone does not allow | When naming: the characters to avoid. When copying: listed under Problems with the name it would get, and **Copy with safe names** |
| A copy that differs after verification | Listed under Problems: "The copy is different from the original." |
| The engine stops with an error | The error message, with Details opened |

## 4. How it is built

```
 ┌──────────────────────┐  commands   ┌─────────────────┐  starts   ┌───────────┐  adb  ┌───────┐
 │ Window               │ ──────────▶ │ Rust core        │ ────────▶ │ Engine    │ ────▶ │ Phone │
 │ HTML, CSS, JavaScript│ ◀────────── │ (src-tauri)      │ ◀──────── │ (adbcp)   │       │       │
 └──────────────────────┘   events    └─────────────────┘ JSON lines└───────────┘       └───────┘
```

- **Window** (`src/`): plain HTML, CSS and JavaScript, no framework and no build step.
  It is drawn by the Mac's built-in web engine (*WebView*), which is why the app is small.
- **Rust core** (`src-tauri/src/main.rs`) offers the window these commands:

  | Command | What it does |
  |---|---|
  | `adb_status` | Runs `adbcp --adb-status --json`: which adb would be used, without downloading |
  | `get_adb` | Runs `adbcp --get-adb --json`, after the user agreed to download Google's adb |
  | `open_adb_terms` | Opens Google's Platform-Tools page (a fixed address) in the browser |
  | `list_devices` | Runs `adbcp --devices --json` |
  | `list_dir` | Runs `adbcp -s SERIAL --ls PATH --json`, for the phone pane |
  | `list_local` | Lists a folder on the Mac, for the Mac pane |
  | `local_places` | Home, Desktop, Documents, Downloads, Movies, Music, Pictures and external drives |
  | `local_mkdir`, `local_rename` | New folder and rename on the Mac (rename never replaces anything) |
  | `local_trash` | Moves items on the Mac to the Trash |
  | `phone_op` | Runs `adbcp -s SERIAL --mkdir`, `--rename` or `--delete` for the phone pane |
  | `show_profile` | Runs `adbcp -s SERIAL --show-profile DEST --json`, for the Tuning row |
  | `measure` | Runs `adbcp -s SERIAL --measure DEST --json` (Measure now); refused during a copy |
  | `load_settings`, `save_settings` | Read and write the remembered settings file |
  | `start_copy` | Starts the engine with `--json` and the chosen options |
  | `cancel_copy` | Sends the engine the same stop signal as Ctrl-C |
  | `autorun` | Test hook (see 5.3) |

  It forwards the engine's output to the window as three events: `engine-event` (one per
  JSON line, see [engine events](../SPEC.md#71-events)), `engine-log` (readable messages)
  and `engine-exit` (the result code). Files dragged from Finder send `drag-hover`
  (whether something is over the window, and where) and `files-dropped` (the paths and
  where they were dropped), so the window can tell which pane they are over.
- **Dragging between the panes** is handled inside the window with mouse events rather
  than the browser's drag and drop, which competes with the window's own handling of
  files dropped from Finder.
- **The engine** is copied into the app (`Contents/Resources/engine/`); adb is not. Every
  engine run from the app has `ADBCP_NO_DOWNLOAD=1`, so the engine never downloads adb
  by itself: only `get_adb`, after the user agreed, does.
- **Safety details:**
  - The window cannot pass arbitrary options to the engine; the Rust core builds the
    command from typed fields.
  - The engine runs in its own *process group*, so that cancelling or quitting stops every
    transfer it started.
  - The window may only load its own files (a content security policy).

## 5. Building and testing

### 5.1 Folder layout

```
app/
  SPEC.md              this document
  package.json         build scripts and the Tauri command-line tool
  src/                 the window: index.html, styles.css, main.js
  src-tauri/
    Cargo.toml         Rust dependencies (tauri, serde, libc, trash)
    tauri.conf.json    app name, window size, bundled engine
    capabilities/      what the window is allowed to call
    icons/             app icons
    src/main.rs        the Rust core
```

### 5.2 Building

Needs Rust (installed with `rustup`) and Node.js (for the Tauri command-line tool).

```bash
cd app
npm install                                # once: the Tauri command-line tool
PATH="$HOME/.cargo/bin:$PATH" npm run build
open src-tauri/target/release/bundle/macos/adbcp.app
```

For Apple Silicon and Intel in one app, add the Intel target once and build for both:

```bash
rustup target add x86_64-apple-darwin
npm run build -- --target universal-apple-darwin
open src-tauri/target/universal-apple-darwin/release/bundle/macos/adbcp.app
```

The build signs the app ad-hoc (`signingIdentity: "-"`). This seals the bundle, so
macOS offers "Open Anyway" for a downloaded copy instead of saying it is damaged. It is
not an Apple signature and not notarized.

GitHub builds the universal app on its free macOS runner (`.github/workflows/build.yml`):

- It runs only on demand (Actions tab > Build > Run workflow) or when a tag such as
  `v0.3.0` is pushed. Pushes to branches and pull requests do not start it.
- Each run checks the engine with macOS's bash 3.2, builds the app and keeps a zip as
  a workflow artifact.
- For a tag, the tagged commit must be on `main`, otherwise the build stops. Then the
  zip is attached to a GitHub release.

`npm run dev` runs the app straight from the sources. Setting `ADBCP_ENGINE` to a path
makes the app use that engine instead of the bundled one.

### 5.3 Test hook

When the environment variable `ADBCP_APP_AUTORUN` holds a copy request in JSON, the
window opens the destination folder in its pane and starts the copy on launch, so a copy
can be tested without clicking:

```bash
ADBCP_APP_AUTORUN='{"sources":["/Users/me/Movies"],"dest":"/sdcard/Movies/","verify":true}' \
  src-tauri/target/release/bundle/macos/adbcp.app/Contents/MacOS/adbcp-app
```

Fields: `sources`, `dest`, `verify` (default true), `skipExisting`, `fixNames`, `pull`,
and `downloadAdb` (download Google's adb without asking, if none is found).
The test hook goes through the normal window logic, so it also writes the settings file.

### 5.4 What has been tested

| Test | Result |
|---|---|
| The built two-pane app copies a folder (two large files and 60 small ones) to the phone and back, with verify, through the test hook | All 62 files arrived; the copy back is identical to the original; no temporary files left |
| The built app writes the settings file (last folders, Verify, name-clash choice) | Written with the expected values |
| The built app without bundled adb, started with the limited PATH a Finder launch gets | Found Homebrew's adb; the copy arrived |
| The built app with no adb anywhere (empty home folder, usual places turned off), test hook accepting the download | Downloaded Google's adb (signature by Google, team EQHXZ8M8AV), then copied; the copy arrived |
| Rendered: the download dialog, the phone pane after "Not now", Settings showing the adb used | As intended after one fix (phone pane buttons before the check) |
| The window rendered in the Mac's web engine with simulated Mac and phone folders and engine events, light and dark: two panes with a selection; the name-clash dialog, then copying with a waiting copy; dragging across, with the drop target highlighted; a finished copy with a name problem and "Copy with safe names"; the phone delete confirmation; settings; Finder drops accepted on the phone pane and refused on the Mac pane; no phone | As intended after two fixes (the places menu; the refresh symbol) |
| Engine phone operations on the device: new folder, rename, delete; refusing an existing name, a missing item, a rename onto an existing name; the exact argument order the app uses | All correct |
| The delete guard: `/`, `/sdcard` (with and without a trailing `/`), DCIM, Download, `/storage/emulated/0` and its Download, Android, Android/data, `/data/local/tmp`, `/system`, a one-level path, a path with `..`, a relative path | All refused, before anything reaches the phone |
| Engine features from earlier versions: measurements, safe names, verify, resume, cancel | See earlier rows in the git history of this file; unchanged by this version |

Not yet tested by hand in the real window: clicking and keyboard use, dragging between
the panes and from Finder, the Trash on the Mac, Measure now, the Cancel button, and the
download dialog's buttons (including opening Google's terms). These need a person at the Mac.

## 6. Not built yet

- Copying within one side (Mac to Mac or phone to phone), and moving instead of copying.
- Reordering or removing copies that are waiting in the queue.
- Signing and notarization by Apple (needs a paid Apple Developer account).
- The Intel half of the universal build is not tested on an Intel Mac yet.
- A Linux build.

## 7. Decisions and open questions

Decided:

1. "Verify after copying" is on by default. It can be turned off, and that choice is
   remembered. It adds roughly 70–90% to the total time.
2. Files whose names the phone does not allow are left out of "Retry failed files" and
   reported at the end. **Copy with safe names** copies them with `_` in place of the
   disallowed characters; an Advanced setting does this for every copy.
3. Part size, the split threshold and the experimental connection modes are in
   Advanced settings.
4. The two-pane window replaced the single copy window (version 0.3.0). Rather than
   forking OpenMTP, the window was built on the existing engine and Tauri app, keeping
   the app small (about 3 MB without adb).
5. Deleting on the Mac moves items to the Trash; deleting on the phone is permanent and
   always asks first, and storage roots and standard folders cannot be deleted.
6. Copying onto existing names asks Replace / Skip existing / Cancel by default.
7. The app does not bundle Google's adb (version 0.3.0 onward). It uses an installed
   adb or asks before downloading Google's package, so the app can be shared without
   redistributing Google's software.

Open:

1. Should the replacement character for disallowed names be configurable (for example
   a look-alike character instead of `_`)?

---

## Glossary

**Process group.** A set of programs started together that the system can stop together.
The engine starts many transfers; putting them in one group lets a single stop signal
end all of them.

**Resources folder.** The part of a Mac app (`adbcp.app/Contents/Resources`) that holds
files the app needs, here the engine and adb.

**Tauri.** A toolkit for desktop apps whose window is a web page shown by the system's
own web engine, with a small native program (here in Rust) behind it.

**Test hook.** A setting that lets an automated test drive the app without clicking.

**WebView.** The web engine built into macOS (the one Safari uses), which other apps can
use to show HTML pages. Using it keeps the app small because no browser is bundled.

Other terms (adb, checksum, compression, parallel transfer, shared storage, USB debugging,
verify, and more) are explained in the [engine glossary](../SPEC.md#glossary).
