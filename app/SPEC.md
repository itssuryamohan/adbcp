# adbcp desktop app

Specification for the window around the adbcp copy engine

| | |
|---|---|
| Status | Version 0.2.0 built. Copies in both directions work end to end. |
| Platform | macOS 11 or newer, Apple Silicon and Intel |
| Built with | *Tauri* 2: a small Rust program that shows a window drawn with HTML, CSS and JavaScript |
| Size | About 22 MB: the app itself is 3.3 MB; the rest is Google's adb (18 MB) and the engine |
| Engine | The command-line tool described in [../SPEC.md](../SPEC.md). The app runs it and shows what it reports. |
| Last updated | 2026-11-05 |

Terms in *italics* are explained in the [Glossary](#glossary) at the end and in the
[engine glossary](../SPEC.md#glossary).

---

## 1. Purpose

The engine is fast but is used from the Terminal. The app gives the same copies a
window: pick a phone, pick what to copy and where, press Start, and watch the progress.
All copying, measuring and checking is done by the engine. The app only collects
choices, starts the engine, and presents its reports.

## 2. The window

```
┌ adbcp ─────────────────────────────────────────────────────────────┐
│ Phone      [ SM-S918B · USB 5 Gb/s                    ▾ ] [Refresh] │
│ Direction  (•) Computer to phone   ( ) Phone to computer            │
│ Copy                         [Add files…] [Add folder…] [Remove]    │
│ ┌────────────────────────────────────────────────────────────────┐  │
│ │ Uncharted…PS4    /Users/surya/Documents/Games/Uncharted…        │  │
│ │ trip.mp4         /Users/surya/Movies/trip.mp4                   │  │
│ └────────────────────────────────────────────────────────────────┘  │
│ To         [ /sdcard/Games/                          ] [Browse…]    │
│            [x] Verify after copying   [ ] Skip files already there  │
│ Tuning     Measured 2026-11-05 for shared storage: 8 …  [Measure now]│
│ ▸ Advanced settings                                                 │
│ 15,177 files, 58.5 GiB → /sdcard/Games                              │
│ 3,024 large files on 8 parallel transfers, 12,153 small files …     │
│ [==================>              ]                                 │
│ 61% · 36.0 GiB of 58.5 GiB · 398 MiB/s · about 0:58 left · 9,410 …  │
│ ▸ Problems (1)                                                      │
│ ▸ Details                                                           │
│ [Retry failed files] [Copy with safe names]        [Cancel] [Start] │
└─────────────────────────────────────────────────────────────────────┘
```

The window follows the Mac's light or dark appearance. When the content does not fit
(for example with Advanced settings open), it scrolls while Start and Cancel stay visible.

## 3. Using the app

### 3.1 Phone

- The list shows every phone adb can see, with its model and connection, for example
  "SM-S918B · USB 5 Gb/s". The first ready phone is selected. **Refresh** looks again.
- Phones that are not ready are listed but cannot be chosen, with the reason: "allow this
  computer on the phone", "offline", and so on.
- A note under the list explains what to do when no phone is found (cable, *USB debugging*,
  allowing the computer), or warns when the phone is connected at USB 2.0 speed.

### 3.2 Direction

- **Computer to phone** (the default) or **Phone to computer**.
- Switching clears the list of things to copy, because they are on the other side, and
  switches the destination to the one last used for that direction.
  The default destination is `/sdcard/Download/` on the phone, or the Mac's Downloads folder.

### 3.3 What to copy

- **Computer to phone:** **Add files…** and **Add folder…** open the standard Mac
  pickers; files and folders can also be dragged from Finder onto the window. While
  something is dragged over the window, the list shows "Drop to add to the list". When
  copying from the phone, or during a copy, it explains instead why dropping is not possible.
- **Phone to computer:** **Add from phone…** opens the phone browser (3.5) with tick
  boxes; ticked files and folders are added.
- Click items in the list to select them, then **Remove**.
- Folders are copied with everything inside. macOS housekeeping files are left out by the engine.

### 3.4 Destination

- **Computer to phone:** type a phone folder starting with `/`, or use **Browse…** to pick
  one in the phone browser.
- **Phone to computer:** type a folder on the Mac, or use **Browse…** for the standard
  Mac folder picker.

### 3.5 Phone browser

A panel over the window that lists one phone folder at a time, folders first. Click a
folder name to open it, **↑** to go up. Hidden files (names starting with `.`) are
hidden unless **Show hidden** is ticked. When choosing a destination, files are dimmed
and the button reads **Choose this folder**; when adding things to copy, each entry has
a tick box and the button reads **Add N items**. Esc or **Cancel** closes it.

### 3.6 Settings

| Setting | Where | Default | Remembered | Engine option |
|---|---|---|---|---|
| Verify after copying | Main window | On | Yes | `--verify` |
| Skip files already there | Main window | Off | No | `--skip-existing` |
| Parallel transfers | Advanced | Automatic (measured) | Yes | `-j N` |
| Compression | Advanced | Automatic (tests the data) | Yes | `-z none\|zstd\|lz4` |
| Split very large files | Advanced | Automatic | Yes | `--no-split` when off |
| Part size | Advanced | 128 MiB | Yes | `--chunk`, only when changed |
| Split files from | Advanced | 256 MiB | Yes | `--split-min`, only when changed |
| Replace characters the phone does not allow with `_` | Advanced | Off | Yes | `--fix-names` |
| Burst mode (experimental) | Advanced | Off | Yes | `--burst` |
| libusb connection (experimental) | Advanced | Off | Yes | `--libusb` |
| Skip the free-space check | Advanced | Off | No | `--force` |

Part size and the split threshold are passed to the engine only when changed: an
explicit value keeps splitting on even where the engine would switch it off by itself
(on a USB 2.0 link, where it does not help). Both are greyed out when splitting is off.
The experimental options restart adb, which briefly disconnects other adb tools; burst
mode was slower on real copies in testing.

### 3.7 Measurements (Tuning)

The **Tuning** row shows what the engine knows about the selected phone, its connection
and the kind of destination (shared storage, app folders, or `/data`):

- "Measured 2026-11-05 for shared storage: 8 parallel transfers for large files, up to 4
  for small files." Hovering shows the measured speeds.
- "Not measured yet for this phone and app folders. It is measured automatically before
  the first large copy (about 10 seconds), or now."
- When copying from the phone: "Copies from the phone use fixed settings …", and no button.

**Measure now** measures the phone at the current destination (about 10 seconds) and
saves the result; the row says "Measuring …" meanwhile and other controls are locked.
The row updates when the phone, direction or kind of destination changes, and after
every copy (a large copy may have measured the phone by itself).

### 3.8 Remembered settings

Direction, the last destination for each direction, Verify, everything under Advanced
settings except the free-space check, and whether Advanced settings is open are saved
on every change and restored at the next launch. What to copy, "Skip files already
there" and "Skip the free-space check" are deliberately not remembered: they belong to
one copy. The file is `~/Library/Application Support/dev.adbcp.desktop/settings.json`.

### 3.9 During a copy

- All controls except **Cancel** are locked.
- Two summary lines show what is being copied and the plan the engine chose: number of
  large and small files, parallel transfers, compression, and whether saved measurements
  or new ones are used. If the engine measures the phone first, the status line says so.
- The progress bar and status line update about once a second: percentage, amount, speed,
  time left, and files done or failed. During verification the bar shows activity.
- Files that fail appear under **Problems** as they fail, with the reason.
- **Details** shows everything the engine reported, including warnings.
- **Cancel** asks the engine to stop. It stops within a second; finished files stay,
  partly copied ones are removed, and "Skip files already there" is ticked so that
  Start continues where it stopped.
- Quitting the app during a copy stops the copy the same way.

### 3.10 After a copy

- The status line ends with the result, for example "Copied 15,176 files, 58.5 GiB in
  2:34 (389 MiB/s). Verified: all 15,176 files match."
- A line below it says plainly whether everything worked, and if not, what failed.
- **Retry failed files** appears when files could not be copied or failed verification.
  It runs the same copy again with "Skip files already there" on. Files whose names the
  phone does not allow are left out of a retry and reported again at the end.
- **Copy with safe names** appears when files have names the phone does not allow. It
  copies them with each disallowed character replaced by `_` (for example
  `sound:effects.bnk` becomes `sound_effects.bnk`), skipping everything already there.
  Problems lists the new name for each file before you press it. This applies to that
  one copy; the Advanced setting does the same for every copy.

### 3.11 Messages

| Situation | What the app shows |
|---|---|
| No phone found | How to connect: cable, USB debugging, allow this computer, then Refresh |
| Phone connected at USB 2.0 speed | A note that a USB 3 cable and port can be 5–10 times faster |
| Destination on the phone does not start with `/` | Asks for a full phone path such as `/sdcard/Download/` |
| A name the phone does not allow | Listed under Problems with the name it would get with safe names; **Copy with safe names** is offered |
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
  | `list_devices` | Runs `adbcp --devices --json` |
  | `list_dir` | Runs `adbcp -s SERIAL --ls PATH --json`, for the phone browser |
  | `show_profile` | Runs `adbcp -s SERIAL --show-profile DEST --json`, for the Tuning row |
  | `measure` | Runs `adbcp -s SERIAL --measure DEST --json` (Measure now); refused during a copy |
  | `load_settings`, `save_settings` | Read and write the remembered settings file |
  | `pick_local` | Shows the standard Mac file or folder picker |
  | `start_copy` | Starts the engine with `--json` and the chosen options |
  | `cancel_copy` | Sends the engine the same stop signal as Ctrl-C |
  | `autorun` | Test hook (see 5.3) |

  It forwards the engine's output to the window as three events: `engine-event` (one per
  JSON line, see [engine events](../SPEC.md#71-events)), `engine-log` (readable messages)
  and `engine-exit` (the result code). Dragging over the window sends `drag-hover`
  (true or false); dropped files arrive as `files-dropped`.
- **Engine and adb** are copied into the app (`Contents/Resources/engine/`). The engine
  finds the bundled adb next to itself.
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
    Cargo.toml         Rust dependencies (tauri, tauri-plugin-dialog, serde, libc)
    tauri.conf.json    app name, window size, bundled engine and adb
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

`npm run dev` runs the app straight from the sources. Setting `ADBCP_ENGINE` to a path
makes the app use that engine instead of the bundled one.

### 5.3 Test hook

When the environment variable `ADBCP_APP_AUTORUN` holds a copy request in JSON, the
window fills it in and starts it on launch, so a copy can be tested without clicking:

```bash
ADBCP_APP_AUTORUN='{"sources":["/Users/me/Movies"],"dest":"/sdcard/Movies/","verify":true}' \
  src-tauri/target/release/bundle/macos/adbcp.app/Contents/MacOS/adbcp-app
```

Fields: `sources`, `dest`, `verify` (default true), `skipExisting`, `fixNames`, `pull`.
The test hook goes through the normal window logic, so it also writes the settings file.

### 5.4 What has been tested

| Test | Result |
|---|---|
| The built app copies a folder (two large files and 50 small ones) to the phone, with verify, through the test hook | All 52 files arrived; their checksums match the originals |
| The built app copies the same folder back from the phone | Identical to the original; no temporary files left |
| The window rendered in the Mac's web engine with simulated phone data: ready, copying, finished with a problem, problems open, phone browser; light and dark | Layout and texts as intended (two texts fixed after review) |
| The engine's phone and folder listings (`--devices`, `--ls`) | Correct, valid JSON, clear error for a missing folder |
| Cancelling through the engine's process group, the same mechanism the app uses | Stops in under a second, nothing left behind (tested with the engine) |
| The built app copies files named `what?.txt` and `lev:el/map.dat` with safe names, with verify | Arrived as `what_.txt` and `lev_el/map.dat` with the right contents |
| The built app writes the settings file | Written with the expected values |
| Rendered states for this version: measurements shown, not measured yet, measuring, Advanced settings open, drag accepted and refused, name problems with "Copy with safe names"; light and dark | As intended after two layout fixes (buttons hidden by Advanced settings; the phone browser's buttons) |
| Engine: `--show-profile` (including a profile saved by an older version), `--measure`, `--fix-names` with clashing names, failure reasons in JSON | All correct |

Not yet tested by hand in the real window: clicking through the controls, dragging
files from Finder (including the drop hint), the Mac file pickers, Measure now, and the
Cancel button itself. These need a person at the Mac.

## 6. Not built yet

- Renaming individual files by hand before copying (today: automatic safe names).
- Distribution to other people: signing and notarization by Apple, and downloading adb
  on first use instead of bundling it (see the engine spec, section 9).
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
