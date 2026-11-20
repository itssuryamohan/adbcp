# adbcp desktop app

App specification: the window for the adbcp copy engine

| | |
|---|---|
| Status | Version 0.4.0: two-pane window, Wi-Fi setup, and copies without USB debugging (MTP). Copies in both directions work end to end. |
| Platform | macOS 11 or later, Apple Silicon and Intel |
| Built with | *Tauri* 2: a small Rust program that shows a window made with HTML, CSS, and JavaScript |
| Size | About 3 MB for one architecture, about 6.6 MB for Apple Silicon and Intel. The app does not include Google's adb (see 3.1). |
| Engine | The command-line tool in [engine-spec.md](engine-spec.md). The app runs it and shows its reports. |
| Last updated | 2026-11-19 |

The [Glossary](#glossary) at the end and the [engine glossary](engine-spec.md#glossary)
explain the terms in *italics*. For a short user guide, see [app.md](app.md).

---

## 1. Purpose

The engine is fast, but it runs in the Terminal. The app gives it a two-pane window,
like a file manager. This Mac is on one side and the phone is on the other side. To
copy, the user moves items from one side to the other.

The engine does all copying, measuring, and checking. The app does only these things:

- It collects the user's choices.
- It starts the engine.
- It shows the engine's reports.

## 2. The window

The window has two file panes side by side, like Finder windows. This Mac is on the left.
The phone is on the right. A transfer bar at the bottom shows the current copy. The gear
button opens the settings.

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

The window uses the light or dark appearance of the Mac.

## 3. Using the app

### 3.1 Phone

**adb first.** The app needs Google's adb, but it does not include it. Google's license
limits redistribution.

1. At start, the app looks for an adb that is already on the Mac. It looks on the `PATH`, in Homebrew, in Android Studio, and for an adb that it downloaded before.
2. If there is none, the app shows "adbcp needs Google's adb" with three buttons:
   - **Not now** closes the message.
   - **Google's terms…** opens Google's Platform-Tools page.
   - **Download** downloads about 16 MB from Google, one time. The engine checks Google's signature.
3. After **Not now**, the phone pane tells the user how to get adb. **Refresh** shows the message again.

Settings shows which adb the app uses and where it came from.

**Phone list.**

- The list at the top shows each phone that adb finds, with its model and connection. Example: "SM-S918B · USB 5 Gb/s".
- The app selects the first ready phone.
- **Refresh** looks for phones again.
- A phone that is not ready shows in the list with the reason, such as "allow this computer on the phone" or "offline". The user cannot select it.
- Without a ready phone, the phone pane tells the user what to do: the cable, *USB debugging*, and allowing the computer.
- A note shows when the phone uses a USB 2.0 connection.
- A phone on Wi-Fi shows as "SM-S918B · Wi-Fi".
- A phone without USB debugging, in File transfer mode, shows as "SM-S918B · USB (no debugging)". See **MTP** below.
- A phone in File transfer mode that another program holds shows as "· in use by another app". The phone pane then names the usual cause: macOS's `ptpcamerad`, or Android File Transfer.

**MTP (no USB debugging).** The app lists the phones that adb reaches, then the phones in
MTP mode that adb does not reach. A phone that adb lists but cannot use yet
(unauthorized, offline) and that MTP reaches is listed once, as the MTP phone. For an MTP
phone:

- Listing, copies, new folder, rename, and delete go through the `adbcp-mtp` library (`mtp/`), in-process. It sends the same events as the engine.
- **Calibrate & copy** and **Measure now** are off, and Tuning explains why. The note next to the Phone list says that USB debugging makes copies 2 to 3 times faster.
- Verify compares sizes only (`verify_done` has `"method": "size"`), and the transfer bar says so.
- The app works without adb: it lists MTP phones first and asks to download adb only when there is none.
- Only internal storage (`/sdcard/...`) is reachable. The library maps `/sdcard` and `/storage/emulated/0` to the phone's first storage.

**Wi-Fi (Wireless debugging).** **Wi-Fi…** next to **Refresh** opens a sheet:

1. The sheet shows a QR code with the text `WIFI:T:ADB;S:<name>;P:<password>;;`. The window makes a random name (`adbcp-` and 8 characters) and a random 12-character password each time.
2. The user turns on **Developer options > Wireless debugging** on the phone, taps **Pair device with QR code**, and scans the code.
3. The phone then offers a pairing service with that name on the network. The window looks for it every 1.5 seconds (`wifi_scan`).
4. When the service appears, the window pairs with the password (`wifi_op pair`).
5. The phone then offers its connect service on the same IP address. adb often connects by itself. If it has not after about 3 seconds, the window connects (`wifi_op connect`).
6. The window selects the phone and opens it in the phone pane. It makes a new QR code for the next phone.

**Pair with a code instead** takes the IP address and port, and the 6-digit code, from
the phone's **Pair device with pairing code** screen. The window fills in the address
when it finds the phone's pairing service.

**Phones on this network** lists each phone that offers Wireless debugging, and each
phone connected over Wi-Fi. Each row has **Connect** or **Disconnect**. Connect works only
for a phone that was paired with this Mac before.

### 3.2 The two panes

The two panes work in the same way.

**Path bar.**

- **↑** goes up one folder.
- The user can type a path and press Return.
- The **▾** menu (Places) has common folders:
  - On the Mac: Home, Desktop, Documents, Downloads, Movies, Music, Pictures, and external drives.
  - On the phone: Internal storage, Download, DCIM, Pictures, Movies, Music, Documents, `Android/data`, and `Android/obb`.

**List.**

- Folders come first, then files. Each item shows its size and date.
- A click on a column title sorts by that column.
- A double-click or Return opens a folder.
- Hidden items (names that start with `.`) show when **Show hidden files** is on in Settings.

**Selection.**

- A click selects one item.
- Command-click adds or removes one item.
- Shift-click selects a range.
- Command-A selects all items.
- The footer of the pane shows the number of selected items and the size of the selected files.

**Keyboard.** Command-↑ goes up. Return opens. Command-A selects all. Command-Delete
deletes, after a confirmation. Shift-Command-N makes a new folder.

**File operations.** Each pane has **New folder**, **Rename** (one item), and **Delete**.

- On the Mac, Delete moves the items to the Trash.
- On the phone, Delete is permanent, because adb has no trash. The app always asks first and shows the names.
- The app does not delete the phone's storage roots or standard folders, such as `/sdcard`, `Android`, `DCIM`, and `Download`.
- The app checks new names for characters that the phone does not allow.

**Start folders.** The phone pane opens at the last phone folder used, or at
`/sdcard/Download`. The Mac pane opens at the last Mac folder used, or at Downloads.

### 3.3 Copying

- **Copy to phone →** copies the items selected in the Mac pane into the folder open in the phone pane. It never measures first (`--no-calibrate`): it uses the saved measurement, or built-in settings. Its tooltip names the measurement it uses.
- **Calibrate & copy →** does the same, but measures first (`--recalibrate`, about 10 seconds) and saves the result. The Tuning row then shows the new measurement.
- **← Copy to Mac** copies in the other direction.

**Dragging.**

- The user can drag selected items from one pane to the other pane.
- A drop on a folder in the other pane copies into that folder.
- The user can drop files and folders from Finder on the phone pane.
- During a drag, the pane that receives the items shows "Drop to copy here".
- The Mac pane does not accept drops from Finder. Such a drop would only copy within the Mac.

**Names that already exist.** If items with the same names exist in the destination
folder, the app asks:

- **Replace** copies over them.
- **Skip existing** keeps files that exist with the same size.
- **Cancel** stops.

A setting can select one of these answers for all copies.

**Queue.** A copy that the user starts during another copy waits in a queue. The transfer
bar shows the number of waiting copies. **Cancel** stops the current copy and clears the
queue.

When a copy is complete, the app refreshes both panes.

### 3.4 The transfer bar

**During a copy,** the bar shows:

- What the engine copies, and to where.
- The plan that the engine selected: parallel transfers, compression, and saved or new measurements.
- "Resuming N files" when the engine continues large files from an earlier copy (the `resume` event).
- A progress bar with the percentage, amount, speed, time left, and files done.
- A message when the engine measures the phone first.
- An activity bar during verification.

**Problems** lists the files that failed, with the reason, as they fail. **Details**
shows all reports from the engine.

**After a copy,** the bar shows the result in one line, and the errors if there are any.
Example: "Copied 2 files, 1.2 GiB in 0:04 (301 MiB/s). Verified: all 2 files match."

**Buttons.**

- **Retry failed files** runs the same copy again with "skip existing" on. This retry leaves out files with names that the phone does not allow, and reports them again.
- **Copy with safe names** shows when some names are not allowed on the phone. It copies these files with `_` in place of each character that is not allowed. Example: `sound:effects.bnk` becomes `sound_effects.bnk`. Problems shows the new names first.
- **Cancel** stops the copy in less than one second. Finished files stay. Large files sent in parts stay as `NAME.adbcp-part`. The next copy of the same items continues them. The engine removes the other partial files.

When the user quits the app during a copy, the app stops the copy in the same way.

### 3.5 Settings

The gear button opens the settings.

| Setting | Default | Engine option |
|---|---|---|
| Verify after copying | On | `--verify` |
| When names already exist | Ask | Replace: no option. Skip existing: `--skip-existing`. |
| Show hidden files | Off | — |
| Tuning: measurements and **Measure now** | — | `--show-profile`, `--measure` |
| (button) **Copy to phone →** / **Calibrate & copy →** | Copy | `--no-calibrate` / `--recalibrate` |
| Parallel transfers | Automatic (measured) | `-j N` |
| Compression | Automatic (tests the data) | `-z none\|zstd\|lz4` |
| Split very large files | Automatic | `--no-split` when off |
| Part size | 128 MiB | `--chunk`, only when changed |
| Split files from | 256 MiB | `--split-min`, only when changed |
| Replace characters the phone does not allow with `_` | Off | `--fix-names` |
| Burst mode (experimental) | Off | `--burst` |
| libusb connection (experimental) | Off | `--libusb` |
| Skip the free-space check | Off | `--force` |

**Tuning** shows what the engine knows about the selected phone, its connection, and the
kind of folder open in the phone pane. The kinds are shared storage, app folders, and
`/data`.

- Example: "Measured 2026-11-05 for shared storage: 8 parallel transfers for large files, up to 4 for small files".
- If no measurement exists, Tuning says so.
- **Measure now** measures for this folder (about 10 seconds) and saves the result.
- Copies from the phone use fixed values.

**Part size and split threshold.** The app gives these options to the engine only when the
user changes them. An explicit value keeps splitting on, also on a USB 2.0 connection,
where the engine otherwise turns it off.

**Experimental options.** Both restart adb. This disconnects other adb tools for a moment.
Burst mode was slower on real copies in tests.

**Saved settings.** The app saves all settings except "Skip the free-space check". It also
saves the last folder and the sort order of each pane. The file is
`~/Library/Application Support/dev.adbcp.desktop/settings.json`.

### 3.6 Messages

| Situation | What the app shows |
|---|---|
| No phone found | In the phone pane: how to connect (cable, USB debugging, allow this computer), then Refresh |
| Phone connected at USB 2.0 speed | A note that a USB 3 cable and port can be 5–10 times faster |
| Names already exist in the destination | Replace / Skip existing / Cancel |
| Delete on the phone | "Delete N items from the phone? This cannot be undone." with the names |
| A name that the phone does not allow | When the user types a name: the characters to avoid. During a copy: the file under Problems with its safe name, and **Copy with safe names** |
| A copy differs after verification | Under Problems: "The copy is different from the original." |
| The engine stops with an error | The error message, with Details open |

## 4. How it is built

```
 ┌──────────────────────┐  commands   ┌─────────────────┐  starts   ┌───────────┐  adb  ┌───────┐
 │ Window               │ ──────────▶ │ Rust core        │ ────────▶ │ Engine    │ ────▶ │ Phone │
 │ HTML, CSS, JavaScript│ ◀────────── │ (src-tauri)      │ ◀──────── │ (adbcp)   │       │       │
 └──────────────────────┘   events    └─────────────────┘ JSON lines└───────────┘       └───────┘
```

### 4.1 Window

The window (`src/`) is plain HTML, CSS, and JavaScript. It has no framework and no build
step. The built-in web engine of the Mac (*WebView*) draws it. Thus the app is small.

The window handles drags between the panes with mouse events. It does not use the
browser's drag and drop, because that conflicts with drops from Finder.

### 4.2 Rust core

The Rust core (`src-tauri/src/main.rs`) gives the window these commands:

| Command | What it does |
|---|---|
| `adb_status` | Runs `adbcp --adb-status --json`. Shows which adb the engine uses. It downloads nothing. |
| `get_adb` | Runs `adbcp --get-adb --json`. The window calls it only after the user agrees to the download. |
| `open_adb_terms` | Opens Google's Platform-Tools page (a fixed address) in the browser |
| `list_devices` | Runs `adbcp --devices --json` |
| `wifi_scan` | Runs `adbcp --wifi-scan --json`: phones that offer Wireless debugging on the network |
| `wifi_op` | Runs `adbcp --wifi-pair`, `--wifi-connect`, or `--wifi-disconnect` |
| `qr_svg` | Makes the pairing QR code as an SVG image (the `qrcode` Rust crate) |
| `list_dir` | Runs `adbcp -s SERIAL --ls PATH --json`, for the phone pane |
| `list_local` | Lists a folder on the Mac, for the Mac pane |
| `local_places` | Returns Home, Desktop, Documents, Downloads, Movies, Music, Pictures, and external drives |
| `local_mkdir`, `local_rename` | Make a folder or rename an item on the Mac. Rename never replaces an item. |
| `local_trash` | Moves items on the Mac to the Trash |
| `phone_op` | Runs `adbcp -s SERIAL --mkdir`, `--rename`, or `--delete` for the phone pane |
| `show_profile` | Runs `adbcp -s SERIAL --show-profile DEST --json`, for the Tuning row |
| `measure` | Runs `adbcp -s SERIAL --measure DEST --json` (Measure now). It refuses during a copy. |
| `load_settings`, `save_settings` | Read and write the settings file |
| `start_copy` | Starts the engine with `--json` and the selected options |
| `cancel_copy` | Sends the engine the same stop signal as Ctrl-C |
| `autorun` | Test hook (see 5.3) |

The Rust core sends these events to the window:

| Event | Contents |
|---|---|
| `engine-event` | One JSON line from the engine. See [engine events](engine-spec.md#71-events). |
| `engine-log` | Readable messages from the engine |
| `engine-exit` | The result code of the engine |
| `drag-hover` | Whether a Finder drag is over the window, and where |
| `files-dropped` | The paths dropped from Finder, and where they were dropped |

The positions in `drag-hover` and `files-dropped` let the window find the pane under the
pointer.

### 4.3 MTP library

The Rust core links the `adbcp-mtp` library (`mtp/`), built on the `mtp-rs` crate (pure
Rust, no libusb). It keeps the set of MTP phones from the last `list_devices`, and sends
`list_dir`, `phone_op`, and `start_copy` for those phones to the library. `show_profile`
returns `{"event":"profile","saved":false,"kind":"mtp"}`, and `measure` refuses. A copy
runs as an async task. **Cancel** sets its stop flag, the same way Ctrl-C does in the CLI.

The library keeps one MTP session per phone, because a phone allows one at a time. It:

- Uploads a file that replaces another under a temporary name (`NAME.adbcp-part`), deletes the old file, then renames the new one.
- Downloads to `NAME.adbcp-part` and renames when complete.
- Leaves nothing on the phone when an upload is cancelled.
- Refuses to delete storage roots and standard folders, with the same rules as the engine.

### 4.4 Engine

The build copies the engine into the app, in `Contents/Resources/engine/`. It does not
copy adb.

The app sets `ADBCP_NO_DOWNLOAD=1` for every engine run. Thus the engine never downloads
adb by itself. Only `get_adb` downloads adb, after the user agrees.

### 4.5 Safety

- The window cannot give arbitrary options to the engine. The Rust core makes the command from typed fields.
- The engine runs in its own *process group*. Cancel or quit stops every transfer that the engine started.
- A content security policy lets the window load only its own files.
- The app's `Info.plist` has `NSLocalNetworkUsageDescription` and `NSBonjourServices`
  (`_adb-tls-pairing._tcp`, `_adb-tls-connect._tcp`, `_adb._tcp`). macOS asks the user
  before adb, started by the app, can look for phones on the local network.

## 5. Building and testing

[development.md](development.md) has the steps to build, test, and release the app.

### 5.1 Folder layout

```
app/
  package.json         build scripts and the Tauri command-line tool
  src/                 the window: index.html, styles.css, main.js
  src-tauri/
    Cargo.toml         Rust dependencies (tauri, serde, libc, trash)
    tauri.conf.json    app name, window size, bundled engine, signing
    capabilities/      what the window can call
    icons/             app icons
    src/main.rs        the Rust core
```

### 5.2 Building

The build needs Rust (installed with `rustup`) and Node.js (for the Tauri command-line tool).

```bash
cd app
npm install                                # one time: the Tauri command-line tool
PATH="$HOME/.cargo/bin:$PATH" npm run build
open src-tauri/target/release/bundle/macos/adbcp.app
```

To build one app for Apple Silicon and Intel, add the Intel target one time, then build:

```bash
rustup target add x86_64-apple-darwin
npm run build -- --target universal-apple-darwin
open src-tauri/target/universal-apple-darwin/release/bundle/macos/adbcp.app
```

The build signs the app ad-hoc (`signingIdentity: "-"`). This seals the bundle. Then macOS
offers "Open Anyway" for a downloaded copy. Without it, macOS says that the app is
damaged. The ad-hoc signature is not an Apple signature, and the app is not notarized.

GitHub builds the app for Apple Silicon and Intel on its free macOS runner
(`.github/workflows/build.yml`):

- The workflow runs only on demand (Actions > Build > Run workflow) or for a pushed tag such as `v0.3.0`. Branch pushes and pull requests do not start it.
- Each run checks the engine with the bash 3.2 of macOS, builds the app, and keeps a zip as a workflow artifact.
- For a tag, the tagged commit must be on `main`. If not, the build stops.
- For a tag, the workflow attaches the zip to a GitHub release.

`npm run dev` runs the app from the source files. `ADBCP_ENGINE` set to a path makes the
app use that engine instead of the bundled engine.

### 5.3 Test hook

`ADBCP_APP_AUTORUN` can hold a copy request in JSON. At start, the window then opens the
destination folder in its pane and starts the copy. Thus a test can run a copy without
clicks.

```bash
ADBCP_APP_AUTORUN='{"sources":["/Users/me/Movies"],"dest":"/sdcard/Movies/","verify":true}' \
  src-tauri/target/release/bundle/macos/adbcp.app/Contents/MacOS/adbcp-app
```

| Field | Meaning |
|---|---|
| `sources` | Paths to copy |
| `dest` | Destination folder |
| `verify` | Verify after the copy. The default is true. |
| `skipExisting` | Skip files that exist with the same size |
| `fixNames` | Copy with safe names |
| `pull` | Copy from the phone to the Mac |
| `downloadAdb` | Download Google's adb without the dialog, if no adb is found |

The test hook uses the normal window logic. Thus it also writes the settings file.

### 5.4 What was tested

| Test | Result |
|---|---|
| The built two-pane app copies a folder (two large files and 60 small ones) to the phone and back, with verify, through the test hook | All 62 files arrived. The copy back is the same as the original. No temporary files remained. |
| The built app writes the settings file (last folders, Verify, name-clash choice) | The file has the expected values. |
| The built app without bundled adb, started with the limited `PATH` of a Finder launch | The app found Homebrew's adb. The copy arrived. |
| The built app with no adb (empty home folder, usual folders turned off), with the test hook accepting the download | The app downloaded Google's adb (signed by Google, team EQHXZ8M8AV), then copied. The copy arrived. |
| Rendered: the download dialog, the phone pane after "Not now", and Settings with the adb in use | Correct after one fix (phone pane buttons before the check) |
| The window rendered in the Mac's web engine, with test Mac and phone folders and engine events, in light and dark mode. States: two panes with a selection; the name-clash dialog; a copy with a waiting copy; a drag with the drop target highlighted; a finished copy with a name problem and "Copy with safe names"; the phone delete confirmation; settings; Finder drops accepted on the phone pane and refused on the Mac pane; no phone | Correct after two fixes (the Places menu, the refresh symbol) |
| Engine phone operations on the device: new folder, rename, delete. Refusals: an existing name, a missing item, a rename onto an existing name. The exact argument order of the app | All correct |
| The delete guard: `/`, `/sdcard` (with and without a trailing `/`), DCIM, Download, `/storage/emulated/0` and its Download, Android, Android/data, `/data/local/tmp`, `/system`, a one-level path, a path with `..`, a relative path | All refused before anything reached the phone |
| Engine Wi-Fi commands on the S23 Ultra: scan found the phone's connect service; `--wifi-connect` connected; `--wifi-disconnect` disconnected; a bad address was refused before it reached adb | All correct |
| Copy over Wi-Fi, both directions, with verify (300 MiB file and 100 small files) | Identical. 16.0 MiB/s with Wi-Fi splitting, against 8.2 MiB/s before |
| Rendered: the Wi-Fi sheet with the QR code, the code fallback with a connected phone, the window after **Done** with "SM-S918B · Wi-Fi" selected | As intended |
| Engine features from earlier versions: measurements, safe names, verify, resume, cancel | See the git history of this file. This version did not change them. |

These items need a person at the Mac. Nobody has tested them by hand in the real window yet:

- Clicks and keyboard use.
- QR code pairing on a real phone, and the macOS local-network prompt.
- Drags between the panes and from Finder.
- The Trash on the Mac.
- Measure now.
- The Cancel button.
- The buttons of the download dialog, including **Google's terms…**.

## 6. Not built yet

- Copies within one side (Mac to Mac, or phone to phone).
- Move instead of copy.
- Changing the order of waiting copies, or removing them from the queue.
- Signing and notarization by Apple. This needs a paid Apple Developer account.
- A test of the Intel part of the universal build on an Intel Mac.
- A Linux build.

## 7. Decisions and open questions

Decided:

1. "Verify after copying" is on by default. The user can turn it off, and the app remembers the choice. Verify adds about 70–90% to the total time.
2. "Retry failed files" leaves out files with names that the phone does not allow. The app reports them at the end. **Copy with safe names** copies them with `_` in place of each character that is not allowed. An Advanced setting does this for every copy.
3. Part size, the split threshold, and the experimental connection modes are in the Advanced settings.
4. The two-pane window replaced the single copy window in version 0.3.0. The window uses the existing engine and Tauri app instead of a fork of OpenMTP. This keeps the app small.
5. Delete on the Mac moves items to the Trash. Delete on the phone is permanent and always asks first. The app does not delete storage roots or standard folders.
6. Copies onto existing names ask Replace / Skip existing / Cancel by default.
7. From version 0.3.0, the app does not include Google's adb. It uses an installed adb, or asks before it downloads Google's package. Thus the app can be shared without passing on Google's software.
8. The user chooses when to measure: **Copy** or **Calibrate & copy**. The app never lets the engine measure by itself. The user decides when to spend the 10 seconds or more that measuring takes.
9. Phones without USB debugging are reached over MTP, as a slower fallback (version 0.4.0). MTP code is a Rust library linked into the app, not a second program, so universal builds and the CI stay simple. Rust was chosen over Go for `mtp-rs`: pure Rust (no libusb), MIT or Apache-2.0, and the same language as the app core.

Open:

1. Should the user be able to select the replacement character for names that are not allowed? An example is a look-alike character instead of `_`.

---

## Glossary

**Process group.** A set of programs that the system can stop together. The engine
starts many transfers. One group lets one stop signal end all of them.

**Resources folder.** The part of a Mac app (`adbcp.app/Contents/Resources`) that holds
files the app needs. Here it holds the engine.

**Tauri.** A toolkit for desktop apps. The window is a web page that the system's own web
engine shows. A small native program, here in Rust, runs behind it.

**Test hook.** A setting that lets an automated test control the app without clicks.

**WebView.** The web engine built into macOS (the engine that Safari uses). Other apps
can use it to show HTML pages. The app uses it and thus does not include a browser,
which keeps it small.

The [engine glossary](engine-spec.md#glossary) explains other terms, such as adb,
checksum, compression, parallel transfer, shared storage, USB debugging, and verify.
