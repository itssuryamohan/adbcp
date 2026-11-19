# adbcp: Fast File Copy to Android Phones

High-level specification

| | |
|---|---|
| Status | Copy engine: working in both directions (command-line tool `adbcp`). Desktop app: first version built; specified separately in [app/SPEC.md](app/SPEC.md). |
| Platform | macOS (Apple Silicon and Intel). Linux mostly works for the engine. Windows is not supported. |
| Last updated | 2026-11-05 |

Words shown in *italics* the first time are explained in the [Glossary](#glossary) at the end.

---

## 1. Purpose

Copying large amounts of data between a Mac and an Android phone over a USB cable is
slow with the standard tools. A 60 GB game folder with 15,000 files can take many minutes,
gives little feedback, and leaves half-copied files behind if something goes wrong.

adbcp copies files and folders to a connected phone, or from the phone back to the Mac,
as fast as the cable and phone allow, shows clear progress, can check that every file arrived intact, and can resume
an interrupted copy. It has two parts:

- **The copy engine** (`adbcp`): a command-line tool that does the actual work. It exists today.
- **The desktop app**: a window for choosing files, a destination, and options, with a
  progress bar. It runs the engine behind the scenes and has its own specification:
  [app/SPEC.md](app/SPEC.md).

This document covers the engine and the interface the app uses to drive it.

## 2. Goals and non-goals

**Goals**

1. Copy large files and large folders to a phone, and from a phone, as fast as the hardware allows.
2. Work out good settings automatically for each phone, cable and destination, with no tuning needed by the user.
3. Show honest progress: amount copied, speed, and time left, including while big files are still in transit.
4. Never leave broken files at the destination. A file is either fully copied or absent.
5. Make it easy to resume an interrupted copy and to check a finished copy.
6. Need nothing pre-installed beyond macOS itself.

**Non-goals (for the first version)**

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
| Back up photos from the phone | Switch the direction to "Phone to computer", choose `/sdcard/DCIM/Camera` and a folder on the Mac | The same fast, checked copy, in the other direction |

## 4. How it works

```
 ┌───────────────┐   options    ┌───────────────┐   adb over USB   ┌─────────┐
 │  Desktop app  │ ───────────▶ │  Copy engine  │ ───────────────▶ │  Phone  │
 │   (app/)      │ ◀─────────── │   (adbcp)     │                  │         │
 └───────────────┘   progress   └───────────────┘                  └─────────┘
                     events
```

The app turns the user's choices into engine options, starts the engine, and reads the
progress *events* it reports. The engine talks to the phone through *adb*, Google's
standard tool for this, which it brings along or downloads by itself.

## 5. Measuring (automatic settings)

The best number of parallel transfers depends on the phone, the cable, and where the
files go on the phone. The engine measures this itself:

- **Only for copies to the phone.** Copies from the phone use fixed settings that were
  measured once (8 parallel transfers, small files in groups on 4), because reading from
  a phone behaves more evenly than writing to it.
- **When:** the first time a large copy (2 GB or more, or 1,000 files or more) goes to a
  phone over a given connection and to a given kind of destination. Smaller copies use
  built-in defaults until then. `--recalibrate` (in the app: "Measure this phone again")
  repeats it at any time.
- **How long:** about 10 seconds, reported as a `calibration` event.
- **What:** test copies of medium-size files with 2, 4 and 8 parallel transfers; test
  copies of many tiny files; and the number of processor cores in the phone.
- **Saved:** the results are kept on the computer (`~/Library/Caches/adbcp/profiles`)
  and reused for later copies.
- **Compression** depends on the data, not the phone, so for large copies a short
  test with a sample of the data runs each time (about 2 seconds).

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
   and destination (see section 5).
6. **Quick bulk checks.** Resume and verify each check all files in one pass instead of
   one request per file.

The same techniques apply when copying from the phone. There the phone compresses the
data, the parts of a split file are read on the phone and written into place on the
Mac, and the list of files on the phone is read in a single request.

### 6.2 Safety

- **No half-written files.** Files sent in parts are assembled under a temporary name
  and renamed only when complete. A whole file that fails part-way is removed. When
  copying from the phone, every file is written under a temporary name and renamed
  when complete.
- **Retries.** Each file or group is retried up to three times before it counts as failed.
- **Free space** is checked before starting.
- **Names the phone does not allow** are reported before the copy starts instead of failing
  later. With `--fix-names` they are copied with each disallowed character replaced by
  `_`; a name that then clashes with another file gets `_2`, `_3`, … before its extension.
- **Cancel and interruption** stop all transfers and remove temporary files from the
  destination (the phone, or the Mac when copying from the phone).
- **Verification** uses SHA-1 checksums computed separately on the computer and on the phone.

### 6.3 Resuming

Running the same copy with "Skip files already on the phone" leaves out every file that
already exists at the destination with the same size (on the phone, or on the Mac when
copying from the phone). A file whose copy was cut off is either
absent or has the wrong size, so it is copied again. Adding "Verify" to a resumed copy
checks every file, including the skipped ones.

### 6.4 Getting adb

The engine looks for adb in this order and uses the first one it finds:

1. A specific adb chosen by the user (the `ADB` environment variable).
2. A copy bundled next to the engine (made with `adbcp --bundle`, for personal use).
3. adb on the `PATH`.
4. The usual install places, which apps started from Finder cannot see through `PATH`:
   Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`) and Android Studio's SDK
   (`$ANDROID_HOME` or `~/Library/Android/sdk`).
5. A copy it downloaded earlier (in `~/Library/Caches/adbcp`).
6. Otherwise it downloads Google's official package once (about 16 MB) and checks that
   Google's digital signature is valid before using it. With `ADBCP_NO_DOWNLOAD=1` it
   stops with an error instead; the desktop app sets this and asks the user first.

`adbcp --adb-status` shows which adb would be used, without downloading anything, and
`adbcp --get-adb` downloads Google's package on request.

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
| Copy 12.6 GB, 1,881 files **from** the phone | 68–76 s (standard `adb pull`) | 32 s |

On a USB 2.0 cable the same phone reached about 34 MB/s without compression, and up to
about 108 MB/s of effective speed on data that compresses well.

## 7. How the app talks to the engine

The app starts the engine as a separate program with command-line options (listed by
`adbcp --help`; the app's settings are mapped in [app/SPEC.md](app/SPEC.md#36-settings))
and the `--json` option. With `--json`, the engine writes one *JSON* object per line to
its standard output. Each object has an `event` field naming what happened. Warnings and
errors are also written as readable text to the error output, which the app can keep as
a log.

### 7.1 Events

Events arrive roughly in this order. `progress` repeats about once a second during the copy.

| Event | When | Fields |
|---|---|---|
| `warning` | Something the user should know, not fatal | `message` |
| `start` | Files found, copy about to be planned | `version`, `serial`, `model`, `connection` (`usb` or `network`), `link_mbps` (or null), `direction` (`to_phone` or `from_phone`), `destination`, `files`, `bytes` |
| `skip` | Files left out because they are already on the phone | `files`, `bytes` |
| `calibration` | Measuring finished | `large_mib_per_second` and `small_files_per_second` (each by number of transfers, for example `{"2":158,"4":218,"8":294}`), `cores`, `streams`, `small_streams`, `hash_workers` |
| `compression_test` | Compression test finished | `mib_per_second` (by method), `choice` |
| `plan` | Settings decided | `tuning`, `compression`, `large_files`, `large_jobs`, `streams`, `split_files`, `small_files`, `small_jobs`, `small_streams`, `dry_run` |
| `progress` | About every second while copying | `bytes_done`, `bytes_total`, `files_done`, `files_total`, `files_failed`, `bytes_per_second`, `seconds_left` (null until known), `seconds_elapsed` |
| `file_failed` | A file could not be copied | `path` (where the copy should have gone), `reason` (`name_not_allowed`, `copy_failed` or `assemble_failed`), `error` |
| `renamed` | With `--fix-names`: a file got a name the phone allows | `from`, `to` |
| `done` | Copying finished | `files_copied`, `files_failed`, `bytes`, `seconds`, `bytes_per_second` |
| `verify_start` | Verification starting | `files` |
| `verify_problem` | A file failed verification | `problem` (`missing`: the copy is missing or unreadable; `unreadable`: the original cannot be read; `different`), `path` |
| `verify_done` | Verification finished | `files`, `problems`, `seconds` |
| `error` | The copy cannot continue (also sent when cancelled, with message `interrupted`) | `message` |
| `device` | One per phone, from `adbcp --devices --json` | `serial`, `state` (`device` when ready, or `unauthorized`, `offline`, …), `model`, `connection`, `link_mbps` |
| `entry` | One per file or folder, from `adbcp --ls PATH --json` | `name`, `path`, `type` (`dir`, `file` or `other`), `size`, `mtime` |
| `op_done` | After `--mkdir`, `--rename` or `--delete` succeeded | `op`, `count` (paths given) |
| `adb` | From `--adb-status` and after `--get-adb` | `found`, `path`, `source` (`environment`, `bundled`, `path`, `homebrew`, `android-sdk` or `downloaded`), `version` |
| `profile` | From `--show-profile PATH` and after `--measure PATH` | `saved` (false: built-in defaults apply), `kind` (`media`, `appdir` or `data`), `date`, `connection`, `link_mbps`, `streams`, `small_streams`, `small_kib`, `hash_workers`, `cores`, `large_mib_per_second`, `small_files_per_second` |

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

### 7.4 Helper commands

- `adbcp --devices` lists connected phones with model and connection speed.
- `adbcp -s SERIAL --ls PATH` lists one folder on the phone, for the app's phone browser.
- `adbcp -s SERIAL --show-profile PATH` shows the saved measurements for that phone,
  its connection and the kind of destination PATH is.
- `adbcp -s SERIAL --measure PATH` measures now, without copying, and saves the result.
- `adbcp -s SERIAL --mkdir PATH`, `--rename OLD NEW` and `--delete PATH...` make a folder,
  rename, and delete on the phone, for the app's phone pane. Deleting is permanent (adb
  has no trash). `--delete` refuses storage roots, system areas, the standard top-level
  folders (such as DCIM, Download, Android), one-level paths and paths containing `..`.

## 8. Requirements

- **Computer:** a Mac running a current version of macOS. The engine uses only tools
  that come with macOS.
- **Phone:** Android with *USB debugging* turned on, and this computer allowed when the
  phone asks. Compression needs a recent phone (Android 11 or newer).
- **Cable:** any USB data cable works; a USB 3 cable and port are much faster.

## 9. Packaging and distribution

- The app is a standard macOS application containing the engine
  (see [app/SPEC.md](app/SPEC.md#5-building-and-testing)).
- The app does not include Google's adb, because Google's license limits redistributing
  it. It uses an adb already on the Mac, or asks the user before downloading Google's
  package from Google (see 6.4). The app is about 3 MB.
- An app shared with others must be signed and *notarized* by Apple, or macOS will refuse to open it.

## 10. Open questions

1. Measurements so far come from one phone (Galaxy S23 Ultra). Other phones, USB 2.0
   cables and Wi-Fi connections still need testing.

Questions about the app are listed in [app/SPEC.md](app/SPEC.md#7-open-questions).

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
