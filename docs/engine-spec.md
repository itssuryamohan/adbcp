# adbcp: Fast File Copy to Android Phones

Engine specification

| | |
|---|---|
| Status | The copy engine (command-line tool `adbcp`) works in both directions. The desktop app is at version 0.4.0. See [app-spec.md](app-spec.md). |
| Platform | macOS on Apple Silicon and Intel. The engine mostly works on Linux. Windows is not supported. |
| Last updated | 2026-11-19 |

The [Glossary](#glossary) at the end explains the terms in *italics*.

---

## 1. Purpose

Standard tools copy data slowly between a Mac and an Android phone over USB. A 60 GB
game folder with 15,000 files can take many minutes. The standard tools show little
progress. They can also leave half-copied files when something goes wrong.

adbcp copies files and folders between the Mac and a connected phone, in both
directions. It does these things:

- It copies as fast as the cable and the phone allow.
- It shows clear progress.
- It can check that every file arrived without changes.
- It can continue an interrupted copy.

adbcp has two parts:

- **The copy engine** (`adbcp`) is a command-line tool. It does the copying.
- **The desktop app** is a two-pane window for the Mac and the phone. It runs the engine
  and shows its progress. [app-spec.md](app-spec.md) specifies it.

This document specifies the engine and the interface that the app uses to control it.

## 2. Goals and non-goals

**Goals**

1. Copy large files and large folders to and from a phone as fast as the hardware allows.
2. Find good settings for each phone, cable, and destination. The user does not tune anything.
3. Show correct progress: amount copied, speed, and time left. This includes large files that are still in transit.
4. Never leave broken files at the destination. A file is either complete or absent.
5. Make it easy to continue an interrupted copy and to check a finished copy.
6. Need nothing except macOS and Google's adb. The engine can download adb.

**Non-goals (first version)**

- Keep two folders in sync. The engine does not delete phone files that were removed on the Mac.
- Copy to several phones at the same time.
- Support Windows.
- Set up wireless (Wi-Fi) connections to the phone.

## 3. Typical use

| Situation | What the user does | What happens |
|---|---|---|
| Copy a big folder, for example a game | Choose the folder and a destination such as `/sdcard/Games/`. Start the copy. | With a new phone, a short measurement runs first (about 10 seconds). Then the copy starts. |
| The cable came loose during the copy | Run the same copy again with "Skip existing" on. | The engine copies only missing or incomplete files. |
| Make sure that no file is corrupted | Turn on "Verify after copying". | The engine checks every file on both sides and lists all differences. |
| The copy is slower than expected | Read the warning at the start. | If the phone uses a slow (USB 2.0) cable or port, the engine says so. |
| Back up photos from the phone | Copy `/sdcard/DCIM/Camera` to a folder on the Mac. | The engine makes the same fast, checked copy in the other direction. |

## 4. How it works

```
 ┌───────────────┐   options    ┌───────────────┐   adb over USB   ┌─────────┐
 │  Desktop app  │ ───────────▶ │  Copy engine  │ ───────────────▶ │  Phone  │
 │   (app/)      │ ◀─────────── │   (adbcp)     │                  │         │
 └───────────────┘   progress   └───────────────┘                  └─────────┘
                     events
```

1. The app changes the user's choices into engine options.
2. The app starts the engine.
3. The engine talks to the phone through *adb*, Google's standard tool. It uses an installed adb or downloads one (see 6.4).
4. The engine reports progress as *events*. The app reads them.

## 5. Measuring (automatic settings)

The best number of parallel transfers depends on the phone, the cable, and the
destination on the phone. The engine measures this itself.

- **Direction:** the engine measures only for copies to the phone. Reading from a phone is more even than writing to it. Thus copies from the phone use fixed values: 8 parallel transfers, and groups of small files on 4.
- **When:** the engine measures the first time that a large copy goes to a phone. A large copy has 2 GB or more, or 1,000 files or more. The engine measures again for each new connection type and each new kind of destination. Smaller copies use built-in values until a measurement exists.
- **On request:** `--recalibrate` measures again before a copy. In the app, **Calibrate & copy** and **Measure now** do this.
- **Never:** `--no-calibrate` turns off the automatic measurement for this copy. The engine uses the saved measurement, or built-in values. The app always passes `--no-calibrate` or `--recalibrate`, so the user chooses.
- **Duration:** about 10 seconds. The engine reports the result in a `calibration` event.
- **Tests:** the engine copies medium-size test files with 2, 4, and 8 parallel transfers. It copies many tiny test files. It also reads the number of processor cores in the phone.
- **Storage:** the engine saves the results on the Mac in `~/Library/Caches/adbcp/profiles`. Later copies use them.
- **Compression:** the best compression depends on the data, not on the phone. Thus the engine tests a sample of the data for each large copy (about 2 seconds).

## 6. The copy engine

### 6.1 Why it is fast

The engine uses these methods. Each one was measured on a real phone.

1. **Several files at the same time.** One adb transfer waits for the phone to confirm each piece before it sends the next piece. Several parallel transfers keep the cable busy.
2. **Small files in groups, next to large files.** The phone needs about 5–10 ms to create each file in shared storage. The file size does not change this. Thus the engine sends small files in groups of 200, on their own transfers. These transfers run at the same time as the large files. The large files hide the cost of the small files.
3. **Large files in parts.** The engine splits large files into parts of 128 MiB. It sends the parts at the same time and writes them directly into place. It splits these files:
   - Files of 256 MiB or more that do not compress. The extension tells for video, photos, music, and archives. For other files, the engine compresses a 3 MiB sample (three slices of 1 MiB) with gzip. If the sample does not get at least 3% smaller, the file counts as incompressible. Encrypted game packages are an example.
   - Files of 4 GiB or more, also when they compress. Parts cannot use adb's compression, but they make the file resumable (see 6.3). On the test phone, compressible game files in parts took 32–34 s against 26 s with zstd. Thus smaller compressible files keep zstd.
   - `--no-resume` turns off the 4 GiB rule. The engine then records no parts, and a cancel removes all partial files. Measured with 5.5 GB compressible game files (S23 Ultra, USB 3): one file took 20 s in parts and 29 s whole with zstd (one stream), but three files took 62 s in parts and 53 s whole (three streams with zstd).
4. **Compression only where it helps.** Video, photos, music, and archives are already compressed. The engine sends them as they are. It compresses other data in transit when a quick test shows a gain.
5. **Measured settings.** The engine measures the number of parallel transfers for each phone, cable, and destination (see section 5).
6. **Fast bulk checks.** Resume and verify check all files in one pass. They do not send one request for each file.

The same methods apply to copies from the phone. In that direction:

- The phone compresses the data.
- The engine reads the parts of a split file on the phone and writes them into place on the Mac.
- The engine reads the list of files on the phone in one request.

### 6.2 Safety

- **No half-written files.** The engine writes a file sent in parts under a temporary name. It renames the file only when it is complete. When a whole-file transfer fails, the engine removes the partial file. For copies from the phone, the engine writes every file under a temporary name and renames it when it is complete.
- **Retries.** The engine tries each file or group up to three times. Then it reports the file as failed.
- **Free space.** The engine checks the free space before it starts.
- **Names that the phone does not allow.** The engine reports these names before the copy starts. With `--fix-names`, it copies these files and replaces each character that is not allowed with `_`. If the new name is already in use, the engine adds `_2`, `_3`, and so on before the extension.
- **Cancel and interruption.** The engine stops all transfers. It keeps the part files of files sent in parts that have at least one part recorded (see 6.3). It removes all other temporary files from the destination, on the phone or on the Mac.
- **Part checks.** For a copy to the phone, the phone's `dd` must report the exact byte count of each part. Otherwise the part counts as failed.
- **Verification.** The engine calculates SHA-1 checksums on the Mac and on the phone separately, then compares them.

### 6.3 Resuming

The engine continues a stopped copy at two levels.

**Inside large files.** This applies to files sent in parts (see 6.1).

1. Before the copy, the engine writes a record for each such file in `~/Library/Caches/adbcp/parts/`. The first line names the source: path, size, modification time, and part size.
2. When a part arrives, the engine adds the part number to the record.
3. When the file is complete, the engine renames `NAME.adbcp-part` to `NAME` and deletes the record.
4. If the copy stops, the part file and the record stay. This applies to cancel, failed parts, a cut cable, and a crash.
5. The next run of the same copy reads the record. It sends only the parts that are not recorded.

The engine starts the file again in these cases:

- `--no-resume` is set. The engine then ignores and removes old records.
- The first line of the record does not match the source or the part size.
- The part file is missing, or it is shorter than the end of the last recorded part.

The engine finds the record from the direction, the phone's serial number, and the
destination path. It deletes records that are older than 30 days. A file is never
visible under its real name until it is complete.

**Whole files.** "Skip existing" (`--skip-existing`) leaves out every file that exists
at the destination with the same size. This applies in both directions. An interrupted
file is absent or has the wrong size. Thus the engine copies it again, or resumes it if
it went in parts.

If you also turn on "Verify", the engine checks every file, including the skipped files.

Tested on the S23 Ultra with a 3 GiB file, in both directions: cancel after 8 s, a hard
kill (no clean-up), and part uploads that fail like a cut cable. Each next run showed
"Resuming", sent only the missing parts, and passed verification. After a change of the
source file, the next run started over.

### 6.4 Getting adb

The engine looks for adb in this order. It uses the first adb that it finds.

1. The adb in the `ADB` environment variable.
2. A copy next to the engine, in `platform-tools/`. `adbcp --bundle` makes this copy. Use it only for personal copies.
3. adb on the `PATH`.
4. The usual install folders. Apps started from Finder do not see these folders through `PATH`.
   - Homebrew: `/opt/homebrew/bin` and `/usr/local/bin`.
   - Android Studio's SDK: `$ANDROID_HOME` or `~/Library/Android/sdk`.
5. A copy that the engine downloaded before, in `~/Library/Caches/adbcp`.
6. If none exists, the engine downloads Google's official package one time (about 16 MB). It checks Google's digital signature before it uses the package.

With `ADBCP_NO_DOWNLOAD=1`, step 6 stops with an error and downloads nothing. The desktop
app always sets this variable. The app asks the user before it downloads adb.

- `adbcp --adb-status` shows which adb the engine uses. It downloads nothing.
- `adbcp --get-adb` downloads Google's package on request.

### 6.5 Measured performance

Galaxy S23 Ultra over USB 3 (5 Gb/s), with real game data copied to `/sdcard`. "Before"
is the first engine version, which sent one file for each request.

| Task | Before | Now |
|---|---|---|
| 12.6 GB, 1,881 files | 42 s | 32 s |
| 24.2 GB, 8,885 files | 129 s | 64 s |
| 1,472 small files only | 12.4 s | 5.1 s |
| Resume check of 8,885 files | about 220 s | 1.2 s |
| Verify 12.6 GB | about 40 s | 23–29 s |
| Copy 12.6 GB, 1,881 files **from** the phone | 68–76 s (standard `adb pull`) | 32 s |

A rerun on 2026-11-19, with the phone's storage 64% full: plain `adb push` of the 12.6 GB
folder took 70 s (185 MiB/s). adbcp took 36–37 s (349–354 MiB/s) to the phone and 34 s
(377.5 MiB/s) from the phone.

On a USB 2.0 cable, the same phone reached about 34 MB/s without compression. With data
that compresses well, the effective speed reached about 108 MB/s.

**MTP (no USB debugging).** The desktop app copies over MTP when USB debugging is off,
through the `adbcp-mtp` library (`mtp/`), not this engine. Same S23 Ultra, same 12.6 GB
folder, on 2026-11-20:

| Task | MTP | Plain `adb` | adbcp |
|---|---|---|---|
| Copy to the phone | 97.5 s (132 MiB/s; files of 1 MiB or more 196 MiB/s) | 70 s | 32–37 s |
| Copy from the phone | 86.5 s (149 MiB/s) | 68–76 s | 32–34 s |
| One 1.37 GiB file, to / from the phone | 6.1 s / 7.2 s (232 / 195 MiB/s) | — | — |

MTP allows one operation at a time and has no compression, and each file costs several
round trips. Large files are fast, but many small files are slow.

Galaxy S21 Ultra (SM-G998B, Exynos 2100, Android 15, One UI 7) over USB 3 (5 Gb/s), the
same 12.6 GB folder (1,881 files), on 2026-11-19:

| Task | Plain `adb` | adbcp |
|---|---|---|
| Copy to the phone | 160 s (80 MiB/s) | 65 s (199.7 MiB/s); 61 s (212.9 MiB/s) on a second run |
| Verify | — | 23 s |
| Copy from the phone | 104 s (124 MiB/s) | 48 s (266.7 MiB/s) |

The measurement chose 8 parallel transfers (88, 147, and 173 MiB/s on 2, 4, and 8) and
4 checksum workers. The S21 Ultra is slower than the S23 Ultra, which fits its older
chip and storage. adbcp was still about 2.2 to 2.6 times faster than plain adb.

Over Wi-Fi (Wireless debugging), 300 MiB of video to the same phone:

| Plan | Speed |
|---|---|
| 1 stream (the old rule: no splitting on a network link) | 9.9 MiB/s |
| 3 parts of 128 MiB | 11.6 MiB/s |
| 10 parts of 32 MiB on 8 streams (the rule now) | 14.7 MiB/s |

Each adb stream waits for the phone to confirm every packet. Wi-Fi latency makes this
wait long, so parallel streams help more than on USB. On a network link, the engine
thus splits files as on USB 3, in 32 MiB parts, unless `--chunk` sets the part size.
A copy that stops on Wi-Fi and continues over USB starts its split files again, because
the part size is different.

## 7. How the app talks to the engine

The app starts the engine as a separate program.

- The app gives command-line options. `adbcp --help` and [cli.md](cli.md) list them. [app-spec.md](app-spec.md#35-settings) maps the app settings to options.
- The app also gives the `--json` option. With it, the engine writes one *JSON* object per line to its standard output.
- Each object has an `event` field. This field names what happened.
- The engine also writes warnings and errors as readable text to its error output. The app can keep this text as a log.

### 7.1 Events

Events arrive approximately in this order. `progress` repeats about once each second
during the copy.

| Event | When | Fields |
|---|---|---|
| `warning` | Something that the user must know. The copy continues. | `message` |
| `start` | The engine found the files. It is about to plan the copy. | `version`, `serial`, `model`, `connection` (`usb` or `network`), `link_mbps` (or null), `direction` (`to_phone` or `from_phone`), `destination`, `files`, `bytes` |
| `skip` | Files that the engine leaves out because they already exist | `files`, `bytes` |
| `resume` | Files sent in parts that an earlier run left unfinished. The engine sends only their missing parts. `bytes_total` in `progress` does not include `bytes`. | `files`, `bytes` (already at the destination) |
| `calibration` | The measurement is complete | `large_mib_per_second` and `small_files_per_second` (each by number of transfers, for example `{"2":158,"4":218,"8":294}`), `cores`, `streams`, `small_streams`, `hash_workers` |
| `compression_test` | The compression test is complete | `mib_per_second` (by method), `choice` |
| `plan` | The engine selected its settings | `tuning`, `compression`, `large_files`, `large_jobs`, `streams`, `split_files`, `small_files`, `small_jobs`, `small_streams`, `dry_run` |
| `progress` | About each second during the copy | `bytes_done`, `bytes_total`, `files_done`, `files_total`, `files_failed`, `bytes_per_second`, `seconds_left` (null until known), `seconds_elapsed` |
| `file_failed` | The engine could not copy a file | `path` (the destination path), `reason` (`name_not_allowed`, `copy_failed`, or `assemble_failed`), `error` |
| `renamed` | With `--fix-names`: a file got a name that the phone allows | `from`, `to` |
| `done` | The copy is complete | `files_copied`, `files_failed`, `bytes`, `seconds`, `bytes_per_second` |
| `verify_start` | Verification starts | `files` |
| `verify_problem` | A file failed verification | `problem` (`missing`: the copy is missing or cannot be read; `unreadable`: the original cannot be read; `different`), `path` |
| `verify_done` | Verification is complete | `files`, `problems`, `seconds`, and `method` (`size`) from the MTP library, which compares sizes only |
| `error` | The copy cannot continue. The engine also sends it on cancel, with the message `interrupted`. | `message` |
| `device` | One for each phone, from `adbcp --devices --json` (and from the MTP library, with `connection` `mtp`) | `serial`, `state` (`device` when ready, or `unauthorized`, `offline`, …; `busy` with a `message` for an MTP phone that another program holds), `model`, `connection` (`usb`, `network`, or `mtp`), `link_mbps` |
| `entry` | One for each file or folder, from `adbcp --ls PATH --json` | `name`, `path`, `type` (`dir`, `file`, or `other`), `size`, `mtime` |
| `op_done` | `--mkdir`, `--rename`, `--delete`, or a `--wifi-` command was successful | `op` (`mkdir`, `rename`, `delete`, `wifi_pair`, `wifi_connect`, `wifi_disconnect`), `count` |
| `wifi_service` | One for each service, from `adbcp --wifi-scan --json` | `name`, `kind` (`pairing` or `connect`), `address` (`IP:port`) |
| `adb` | From `--adb-status`, and after `--get-adb` | `found`, `path`, `source` (`environment`, `bundled`, `path`, `homebrew`, `android-sdk`, or `downloaded`), `version` |
| `profile` | From `--show-profile PATH`, and after `--measure PATH` | `saved` (false: built-in values apply), `kind` (`media`, `appdir`, or `data`), `date`, `connection`, `link_mbps`, `streams`, `small_streams`, `small_kib`, `hash_workers`, `cores`, `large_mib_per_second`, `small_files_per_second` |

Example:

```json
{"event":"progress","bytes_done":38654705664,"bytes_total":62813896704,"files_done":9410,"files_total":15177,"files_failed":0,"bytes_per_second":417333248,"seconds_left":58,"seconds_elapsed":96.4}
```

### 7.2 Result codes

| Code | Meaning |
|---|---|
| 0 | All files copied. With verify, all files match. |
| 1 | Some files failed, verification found problems, or an error stopped the copy. |
| 130 | The user cancelled the copy. |

### 7.3 Cancelling

To cancel, the app sends the engine a stop signal. This signal is the same as Ctrl-C.

The app must start the engine in its own *process group*. Then the engine can stop all
its transfers and clean up. In tests, the engine stopped in less than one second. No
partial file and no process remained.

### 7.4 Helper commands

| Command | What it does |
|---|---|
| `adbcp --devices` | Lists the connected phones with model and connection speed. |
| `adbcp --wifi-scan` | Lists phones that offer Wireless debugging on the network, from adb's mDNS discovery: `pairing` services while a pairing screen is open, `connect` services while Wireless debugging is on. |
| `adbcp --wifi-pair ADDRESS CODE` | Pairs with a phone (`adb pair`). ADDRESS is `IP:port`. The engine refuses other address formats. |
| `adbcp --wifi-connect ADDRESS` | Connects to a paired phone (`adb connect`). |
| `adbcp --wifi-disconnect SERIAL` | Ends a Wi-Fi connection (`adb disconnect`). |
| `adbcp -s SERIAL --ls PATH` | Lists one folder on the phone, for the app's phone pane. |
| `adbcp -s SERIAL --show-profile PATH` | Shows the saved measurement for the phone, its connection, and the kind of destination PATH. |
| `adbcp -s SERIAL --measure PATH` | Measures now, without a copy, and saves the result. |
| `adbcp -s SERIAL --mkdir PATH` | Makes a folder on the phone. |
| `adbcp -s SERIAL --rename OLD NEW` | Renames an item on the phone. It never replaces an item. |
| `adbcp -s SERIAL --delete PATH...` | Deletes items on the phone permanently. adb has no trash. |

`--delete` refuses these paths:

- Storage roots and system areas.
- Standard top-level folders, such as DCIM, Download, and Android.
- Paths with only one level, such as `/sdcard`.
- Paths that contain `..`.

## 8. Requirements

- **Computer:** a Mac with a current version of macOS. The engine uses only tools that come with macOS, plus adb.
- **Phone:** Android with *USB debugging* on, or Wireless debugging (Android 11 or later). The user must allow this computer when the phone asks. Compression needs Android 11 or later.
- **Cable:** any USB data cable works. A USB 3 cable and port are much faster.

## 9. Packaging and distribution

- The app is a standard macOS application. It contains the engine. See [development.md](development.md#build-the-app).
- The app does not include Google's adb, because Google's license limits redistribution. The app uses an adb that is already on the Mac. If there is none, it asks the user, then downloads Google's package (see 6.4).
- The app is about 3 MB for one architecture, and about 6.6 MB for Apple Silicon and Intel.
- Apple has not signed or *notarized* the app. macOS blocks it the first time. The user must allow it one time. See [install.md](install.md#open-the-app-the-first-time).
- GitHub builds the app for Apple Silicon and Intel on demand and for version tags on `main`. See [development.md](development.md#github-build).

## 10. Open questions

1. Measurements come from two phones (Galaxy S23 Ultra, Galaxy S21 Ultra), both Samsung. Phones from other makers and USB 2.0 cables on other phones need tests.

[app-spec.md](app-spec.md#7-decisions-and-open-questions) lists the questions about the app.

---

## Glossary

**adb (Android Debug Bridge).** Google's official tool that connects a computer to an
Android phone. It is part of Google's "platform-tools" package.

**App-specific folder.** The folders `Android/data` and `Android/obb` in the phone's
storage. Each subfolder belongs to one app. Copying many small files there is about 10
times faster than copying into shared storage.

**Checksum (SHA-1).** A short code calculated from the contents of a file. If the codes of
the original and the copy are the same, the files are the same. adbcp uses the SHA-1 method.

**Compression (zstd, lz4).** Making data smaller during the transfer, then restoring it at
the destination. zstd and lz4 are two common methods. zstd usually makes data smaller.
lz4 uses less processing power. Files that are already compressed, such as video, do not
get smaller.

**Destination.** The folder that receives the copied files.

**Dry run.** Showing what the engine would copy, and how, without copying (`--dry-run`).

**Event.** One progress or status report from the engine to the app, as one line of JSON.

**GB, MB, GiB, MiB.** Units of size. The engine reports binary units. 1 MiB is 1,048,576
bytes. 1 GiB is 1,024 MiB, about 7% more than 1 GB. Speeds are in MiB per second (MiB/s).

**Group (batch).** Up to 200 small files that the engine sends in one transfer.

**JSON.** A standard text format for structured data. Programs can read it easily.

**Measurement (calibration).** The short test that finds the best settings for a phone,
connection, and destination. The saved result is also called a *profile*.

**Notarization.** Apple's check of an app. After this check, other Macs open the app
without a warning.

**Parallel transfer (stream).** One file transfer that runs at the same time as others.
More parallel transfers keep the cable busier, up to a limit.

**Part (split file).** A piece of a very large file. The engine sends the pieces at the
same time and joins them into the complete file at the destination.

**Process group.** A set of programs that the system can stop together with one signal.

**Resume.** Continuing an interrupted copy. The engine sends only the missing parts of
large files, and skips the files that already arrived (`--skip-existing`).

**Shared storage.** The main user storage on the phone, shown as `/sdcard` (also
`/storage/emulated/0`). It holds Download, DCIM, Music, and similar folders. Android
checks every file that is created there. This makes many small files slow. Shared
storage also refuses some characters in names.

**USB 2.0 / USB 3.** Generations of USB. USB 2.0 runs at up to 480 Mb/s, about 40 MB/s in
practice. USB 3 runs at 5 Gb/s or more. The cable and the port must both support USB 3
to get its speed.

**USB debugging.** A setting in the phone's Developer options. It allows adb connections.
The phone asks one time to allow each new computer.

**Verify.** Checking after the copy that every file at the destination is the same as
the original. The engine uses checksums for this.
