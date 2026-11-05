# adbcp: Fast File Copy to Android Phones

High-level specification

| | |
|---|---|
| Status | Copy engine: working (command-line tool `adbcp`). Desktop app: planned, not built. |
| Platform | macOS (Apple Silicon and Intel). Linux mostly works for the engine. Windows is not supported. |
| Last updated | 2026-11-05 |

Words shown in *italics* the first time are explained in the [Glossary](#glossary) at the end.

---

## 1. Purpose

Copying large amounts of data from a Mac to an Android phone over a USB cable is slow
with the standard tools. A 60 GB game folder with 15,000 files can take many minutes,
gives little feedback, and leaves half-copied files behind if something goes wrong.

adbcp copies files and folders to a connected phone as fast as the cable and phone
allow, shows clear progress, can check that every file arrived intact, and can resume
an interrupted copy. It has two parts:

- **The copy engine** (`adbcp`): a command-line tool that does the actual work. It exists today.
- **The desktop app**: a window for choosing files, a destination on the phone, and
  options, with a progress bar. It is planned and runs the engine behind the scenes.

## 2. Goals and non-goals

**Goals**

1. Copy large files and large folders to a phone as fast as the hardware allows.
2. Work out good settings automatically for each phone, cable and destination, with no tuning needed by the user.
3. Show honest progress: amount copied, speed, and time left, including while big files are still in transit.
4. Never leave broken files at the destination. A file is either fully copied or absent.
5. Make it easy to resume an interrupted copy and to check a finished copy.
6. Need nothing pre-installed beyond macOS itself.

**Non-goals (for the first version)**

- Copying from the phone to the computer.
- Keeping two folders in sync (deleting files on the phone that were removed on the computer).
- Copying to several phones at once.
- Windows support.
- Setting up wireless (Wi-Fi) connections to the phone.

## 3. Typical use

| Situation | What the user does | What happens |
|---|---|---|
| Copy a big folder (for example a game) | Choose the folder, choose a destination such as `/sdcard/Games/`, press Start | The first time with this phone, a short measurement runs (about 10 seconds), then the copy |
| The cable came loose halfway | Run the same copy again with "Skip files already on the phone" on | Only missing or incomplete files are copied |
| Make sure nothing is corrupted | Turn on "Verify after copying" | Every file is checked on both sides and any differences are listed |
| The copy is slower than expected | Read the warning shown at the start | If the phone is on a slow (USB 2.0) cable or port, the app says so |

## 4. How it works

```
 ┌───────────────┐   options    ┌───────────────┐   adb over USB   ┌─────────┐
 │  Desktop app  │ ───────────▶ │  Copy engine  │ ───────────────▶ │  Phone  │
 │  (planned)    │ ◀─────────── │   (adbcp)     │                  │         │
 └───────────────┘   progress   └───────────────┘                  └─────────┘
                     events
```

The app turns the user's choices into engine options, starts the engine, and reads the
progress *events* it reports. The engine talks to the phone through *adb*, Google's
standard tool for this, which it brings along or downloads by itself.

## 5. The desktop app (planned)

### 5.1 Main window

```
┌ adbcp ──────────────────────────────────────────────────────┐
│ Phone:   [ SM-S918B · USB 3 · 5 Gb/s              ▾ ]        │
│                                                              │
│ Copy:    ┌───────────────────────────────────────┐ [ Add… ]  │
│          │ Uncharted…PS4/       15,177 files  58.5 GB│ [Remove]│
│          └───────────────────────────────────────┘           │
│ To:      [ /sdcard/Games/                 ] [ Browse phone… ] │
│                                                              │
│ [x] Verify after copying   [ ] Skip files already on phone   │
│ ▸ Advanced settings                                          │
│ Settings: measured on 2026-11-05 · 8 transfers [Measure now] │
│                                                              │
│ [==============>          ]  62%  36.1 of 58.5 GB            │
│ 398 MB/s · about 1 min left · 9,410 of 15,177 files          │
│                                                              │
│                                   [ Start ]   [ Cancel ]     │
└──────────────────────────────────────────────────────────────┘
```

### 5.2 Choosing what to copy

- Add files and folders with the Add button or by dragging them onto the list.
- Folders are copied with everything inside them, keeping the folder structure.
- The list shows the number of files and total size for each item, and the grand total.
- macOS housekeeping files (`.DS_Store` and files starting with `._`) are left out automatically.

### 5.3 Choosing the phone and destination

- **Phone** lists every connected phone that has *USB debugging* turned on, with its model
  name and connection speed. With one phone connected it is selected automatically.
- If no phone appears, the app explains the three usual causes: cable not connected,
  USB debugging off, or "Allow USB debugging" not yet accepted on the phone.
- **To** is a folder on the phone. The default is `/sdcard/Download/`. "Browse phone…"
  shows the phone's folders to pick from.
- If the phone is connected at USB 2.0 speed, a notice suggests a USB 3 cable and port,
  which can be 5 to 10 times faster.

### 5.4 Settings

Basic settings are always visible; the rest sit under "Advanced settings".

| Setting | Default | What it does | Engine option |
|---|---|---|---|
| Verify after copying | On | After copying, compares a *checksum* of every file on the computer and the phone | `--verify` |
| Skip files already on the phone | Off | Leaves out files that already exist on the phone with the same size. Used to resume | `--skip-existing` |
| Parallel transfers | Automatic | How many files are sent at the same time. Automatic uses the measured best | `-j N` |
| Compression | Automatic | Shrinks data while it travels. Automatic tests the actual data and picks the fastest option, or none | `-z none\|zstd\|lz4` |
| Split very large files | Automatic | Sends one large file as several parts at once | `--no-split` to turn off |
| Part size / minimum file size to split | 128 MB / 256 MB | Fine-tuning for splitting | `--chunk`, `--split-min` |
| Skip the free-space check | Off | Starts even if the phone seems to lack space | `--force` |
| Measure now | (button) | Measures this phone, cable and destination again | `--recalibrate` |
| Experimental connection modes | Off | Alternative adb settings. Measured slower on real copies so far | `--burst`, `--libusb` |

### 5.5 Measuring (automatic settings)

The best number of parallel transfers depends on the phone, the cable, and where the
files go on the phone. The engine measures this itself:

- **When:** the first time a large copy (2 GB or more, or 1,000 files or more) goes to a
  phone over a given connection and to a given kind of destination. Smaller copies use
  built-in defaults until then. "Measure now" repeats it at any time.
- **How long:** about 10 seconds. The app shows "Measuring your phone (one time)…".
- **What:** test copies of medium-size files with 2, 4 and 8 parallel transfers; test
  copies of many tiny files; and the number of processor cores in the phone.
- **Saved:** the results are kept on the computer and reused for later copies. The app
  shows when they were measured.
- **Compression** depends on the data, not the phone, so for large copies a short
  test with a sample of the data runs each time (about 2 seconds).

### 5.6 During the copy

- A progress bar with the percentage, amount copied, speed, time left, and files done.
- Progress moves smoothly, including while very large files are in transit.
- Files that fail appear in a list as soon as they fail, with the reason.
- **Cancel** stops the copy within a moment. Files that were fully copied stay on the
  phone; partly copied files are removed. The app offers to resume later.
- The Mac is kept awake (no sleep) while copying.

### 5.7 After the copy

- A summary: files copied, total size, time taken, and average speed.
- If files failed: the list with reasons and a **Retry failed files** button, which
  runs the same copy again with "Skip files already on the phone" on.
- If verification ran: "All files match", or a list of files that differ, are missing,
  or could not be read.

### 5.8 Messages users may see

| Message | Meaning | Advice shown |
|---|---|---|
| Phone connected at USB 2.0 speed | The cable or port limits speed to about 40 MB/s | Use a USB 3 data cable and a USB 3 port |
| Names the phone does not allow | Android's shared storage refuses `" * : < > ? \| \` in names | Rename those files, then copy again |
| Names with tabs or line breaks | Such files are skipped | Rename them |
| Not enough space on the phone | The copy would not fit | Free space, or choose another destination |
| Copy differs from the original | Verification found a difference | Copy again; if it repeats, check the cable |

## 6. The copy engine

### 6.1 Why it is fast

In plain terms, the engine combines several techniques. Each one was measured on a real phone.

1. **Several files at once.** A single adb transfer waits for the phone to confirm each
   piece before sending the next. Running several transfers in parallel keeps the cable busy.
2. **Small files in groups, alongside large ones.** Creating a file in the phone's shared
   storage takes the phone about 5–10 milliseconds no matter how small the file is.
   Small files are therefore sent in groups of 200, on their own transfers, at the same
   time as the large files. That way their cost hides behind the large files.
3. **Large files in parts.** Very large files that do not compress well (video,
   archives) can be sent as several parts at once, written straight into place.
4. **Compression only where it helps.** Video, photos, music and archives are already
   compressed and are sent as they are. Other data is compressed in transit when a quick
   test shows it helps.
5. **Measured settings.** The number of parallel transfers is measured per phone, cable
   and destination (see 5.5).
6. **Quick bulk checks.** Resume and verify each check all files in one pass instead of
   one request per file.

### 6.2 Safety

- **No half-written files.** Files sent in parts are assembled under a temporary name
  and renamed only when complete. A whole file that fails part-way is removed.
- **Retries.** Each file or group is retried up to three times before it counts as failed.
- **Free space** is checked before starting.
- **Names the phone does not allow** are reported before the copy starts instead of failing later.
- **Cancel and interruption** stop all transfers and remove temporary files from the phone.
- **Verification** uses SHA-1 checksums computed separately on the computer and on the phone.

### 6.3 Resuming

Running the same copy with "Skip files already on the phone" leaves out every file that
already exists on the phone with the same size. A file whose copy was cut off is either
absent or has the wrong size, so it is copied again. Adding "Verify" to a resumed copy
checks every file, including the skipped ones.

### 6.4 Getting adb

The engine looks for adb in this order and uses the first one it finds:

1. A specific adb chosen by the user (the `ADB` environment variable).
2. A copy bundled next to the engine (made with `adbcp --bundle`).
3. adb already installed on the computer.
4. A copy it downloaded earlier.
5. Otherwise it downloads Google's official package once (about 16 MB) and checks that
   Google's digital signature is valid before using it.

### 6.5 Measured performance

Galaxy S23 Ultra over USB 3 (5 Gb/s), copying real game data to `/sdcard`. "Before"
is the first version of the engine, which sent one file per request.

| Task | Before | Now |
|---|---|---|
| 12.6 GB, 1,881 files | 42 s | 32 s |
| 24.2 GB, 8,885 files | 129 s | 64 s |
| 1,472 small files only | 12.4 s | 5.1 s |
| Resume check of 8,885 files | about 220 s | 1.2 s |
| Verify 12.6 GB | about 40 s | 23–29 s |

On a USB 2.0 cable the same phone reached about 34 MB/s without compression, and up to
about 108 MB/s of effective speed on data that compresses well.

## 7. How the app talks to the engine

The app starts the engine as a separate program with command-line options (see 5.4)
and the `--json` option. With `--json`, the engine writes one *JSON* object per line to
its standard output. Each object has an `event` field naming what happened. Warnings and
errors are also written as readable text to the error output, which the app can keep as
a log.

### 7.1 Events

Events arrive roughly in this order. `progress` repeats about once a second during the copy.

| Event | When | Fields |
|---|---|---|
| `warning` | Something the user should know, not fatal | `message` |
| `start` | Files found, copy about to be planned | `version`, `serial`, `model`, `connection` (`usb` or `network`), `link_mbps` (or null), `destination`, `files`, `bytes` |
| `skip` | Files left out because they are already on the phone | `files`, `bytes` |
| `calibration` | Measuring finished | `large_mib_per_second` and `small_files_per_second` (each by number of transfers, for example `{"2":158,"4":218,"8":294}`), `cores`, `streams`, `small_streams`, `hash_workers` |
| `compression_test` | Compression test finished | `mib_per_second` (by method), `choice` |
| `plan` | Settings decided | `tuning`, `compression`, `large_files`, `large_jobs`, `streams`, `split_files`, `small_files`, `small_jobs`, `small_streams`, `dry_run` |
| `progress` | About every second while copying | `bytes_done`, `bytes_total`, `files_done`, `files_total`, `files_failed`, `bytes_per_second`, `seconds_left` (null until known), `seconds_elapsed` |
| `file_failed` | A file could not be copied | `path` (on the phone), `error` |
| `done` | Copying finished | `files_copied`, `files_failed`, `bytes`, `seconds`, `bytes_per_second` |
| `verify_start` | Verification starting | `files` |
| `verify_problem` | A file failed verification | `problem` (`missing`, `unreadable` or `different`), `path` |
| `verify_done` | Verification finished | `files`, `problems`, `seconds` |
| `error` | The copy cannot continue (also sent when cancelled, with message `interrupted`) | `message` |

Example:

```json
{"event":"progress","bytes_done":38654705664,"bytes_total":62813896704,"files_done":9410,"files_total":15177,"files_failed":0,"bytes_per_second":417333248,"seconds_left":58,"seconds_elapsed":96.4}
```

### 7.2 Result codes

| Code | Meaning |
|---|---|
| 0 | Everything copied (and verified, if requested) |
| 1 | Some files failed, verification found problems, or a fatal error occurred |
| 130 | Cancelled by the user |

### 7.3 Cancelling

To cancel, the app sends the engine a stop signal (the same as pressing Ctrl-C). The
engine must be started in its own process group so it can stop all of its transfers
and clean up. Tested: the engine stops in under a second, and no partly copied file
or leftover process remains.

### 7.4 Still needed from the engine

The app also needs a few small engine commands that do not exist yet:

- list connected phones with model and connection speed;
- list folders on the phone, for "Browse phone…";
- show the saved measurements for a phone and destination.

## 8. Requirements

- **Computer:** a Mac running a current version of macOS. The engine uses only tools
  that come with macOS.
- **Phone:** Android with *USB debugging* turned on, and this computer allowed when the
  phone asks. Compression needs a recent phone (Android 11 or newer).
- **Cable:** any USB data cable works; a USB 3 cable and port are much faster.

## 9. Packaging and distribution

- The app is a standard macOS application containing the engine.
- For personal use, Google's adb can be bundled inside. Google's license limits
  redistributing adb, so a copy shared with other people should instead download adb
  on first use, which the engine already does.
- An app shared with others must be signed and *notarized* by Apple, or macOS will refuse to open it.

## 10. Open questions

1. **Toolkit for the app:** Qt for Python (PySide6) is quickest to build and can also run
   on Linux; SwiftUI gives a smaller, native-looking Mac-only app.
2. Should "Verify after copying" be on by default? It adds roughly 70–90% to the total
   time (measured: 32 s to copy 12.6 GB, then 23–29 s to verify).
3. Is copying from the phone to the computer needed in a later version?
4. Measurements so far come from one phone (Galaxy S23 Ultra). Other phones, USB 2.0
   cables and Wi-Fi connections still need testing.

---

## Glossary

**adb (Android Debug Bridge).** Google's official tool for talking to an Android phone
from a computer. It is part of Google's "platform-tools" package.

**App-specific folder.** The folders `Android/data` and `Android/obb` in the phone's
storage, which belong to individual apps. Copying many small files there is much faster
than into shared storage (measured: about 10 times faster).

**Checksum (SHA-1).** A short code computed from a file's contents. If the codes for the
original and the copy match, the copy is identical. SHA-1 is the method used here.

**Compression (zstd, lz4).** Making data smaller while it travels, then restoring it on
the phone. zstd and lz4 are two common methods: zstd usually shrinks more, lz4 uses less
processing power. Files that are already compressed, such as video, do not shrink further.

**Destination.** The folder on the phone that files are copied into.

**Dry run.** Showing what would be copied, and how, without copying anything (`--dry-run`).

**Event.** One progress or status report from the engine to the app, written as a line of JSON.

**GB, MB, GiB, MiB.** Units of size. The engine reports binary units: 1 MiB is
1,048,576 bytes and 1 GiB is 1,024 MiB (about 7% more than a GB). Speeds are shown in
MiB per second (MiB/s).

**Group (batch).** A set of up to 200 small files sent together in one transfer.

**JSON.** A standard text format for structured data that programs can read easily.

**Measurement (calibration).** The short test the engine runs to find the best settings
for a phone, connection and destination. The saved results are sometimes called a *profile*.

**Notarization.** Apple's check of an app before it can be opened on other people's Macs
without a warning.

**Parallel transfer (stream).** One file transfer running at the same time as others.
More parallel transfers keep the cable busier, up to a point.

**Part (split file).** A piece of a very large file. The pieces are sent at the same time
and joined into the complete file on the phone.

**Resume.** Continuing an interrupted copy by skipping files that already arrived
(`--skip-existing`).

**Shared storage.** The main user storage on the phone, shown as `/sdcard` (also
`/storage/emulated/0`). It holds Download, DCIM, Music, and similar folders. Android
checks every file created here, which makes creating many small files slow, and it
does not allow certain characters in names.

**USB 2.0 / USB 3.** Generations of USB. USB 2.0 runs at up to 480 Mb/s (about 40 MB/s
in practice); USB 3 at 5 Gb/s or more. Both the cable and the port must support USB 3 to
get its speed.

**USB debugging.** A setting under the phone's Developer options that allows adb
connections. The phone asks once to allow each new computer.

**Verify.** Checking after the copy that every file on the phone is identical to the
original, using checksums.
