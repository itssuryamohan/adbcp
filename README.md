# adbcp

Fast file copying between a Mac and an Android phone over a USB cable: a command-line
tool, plus a small desktop app.

> **Use at your own risk.** This is a personal project, provided as is, without any
> warranty. The author is not responsible for lost or damaged files, or for damaged or
> unusable ("bricked") devices. Read the [disclaimer](#disclaimer) before using it.

## What it does

The standard `adb push` and `adb pull` send one file at a time and wait for the phone to
confirm each piece. adbcp uses the same adb underneath, but:

- **Sends several files at once**, and splits very large files into parts sent in parallel.
- **Batches small files**: up to 200 per transfer, alongside the large ones, so that the
  phone's per-file overhead hides behind the big transfers.
- **Compresses only what compresses**: video, photos and archives are sent as they are.
- **Tunes itself**: measures each phone, cable and destination once (about 10 seconds)
  and remembers the best settings.
- **Works in both directions**: computer to phone, and phone to computer (`--pull`).
- **Checks its work** (`--verify` compares SHA-1 checksums on both sides) and
  **resumes** interrupted copies (`--skip-existing`).
- **Avoids half-written files**: large files are assembled under a temporary name, and
  partial files are removed when a copy fails or is cancelled (but see the note on
  unplugging below).
- **Shows real progress**, including inside large files, and reports problems in plain words.

### Measured speed

On a Galaxy S23 Ultra over USB 3 (5 Gb/s), copying 12.6 GB of game data in 1,881 files:

| Direction | adbcp | Plain `adb` |
|---|---|---|
| Computer to phone | 32 s (about 400 MiB/s) | not measured for this folder |
| Phone to computer | 32 s | 68–76 s (`adb pull`) |

On a USB 2.0 cable the same phone reached about 34 MB/s, and more on data that
compresses well. These numbers come from one phone; yours will differ.

## Requirements

- **A Mac** (Apple Silicon or Intel) with a current macOS. The tool is a bash script that
  also runs on the bash 3.2 shipped with macOS. It was written with Linux in mind but has
  only been tested on macOS.
- **An Android phone with USB debugging turned on** (see below).
- **A USB data cable.** A USB 3 cable in a USB 3 port is 5–10 times faster than USB 2.0;
  adbcp warns when the connection is slow.
- **No adb installation needed.** If adb is not found, adbcp downloads Google's official
  platform-tools once and checks Google's signature before using it.

### Turning on USB debugging

1. On the phone, open **Settings › About phone** and tap **Build number** seven times.
2. Open **Settings › Developer options** and turn on **USB debugging**.
3. Connect the cable and accept **Allow USB debugging** on the phone.

USB debugging lets a computer you have allowed control the phone. Turn it off again when
you no longer need it.

## Command-line use

```bash
git clone https://github.com/<your-account>/adbcp.git && cd adbcp
chmod +x adbcp

# Computer to phone
./adbcp ~/Movies/trip.mp4 /sdcard/Movies/
./adbcp --verify ~/Documents/Games/MyGame /sdcard/Games/

# Phone to computer
./adbcp --pull --verify /sdcard/DCIM/Camera ~/Pictures/phone/

# Continue an interrupted copy
./adbcp --skip-existing ~/Documents/Games/MyGame /sdcard/Games/

# See what would happen, without copying
./adbcp --dry-run ~/Documents/Games/MyGame /sdcard/Games/

./adbcp --help
```

Other useful options: `--measure PATH` measures the phone now, `--show-profile PATH`
shows the saved measurements, `--fix-names` replaces characters the phone does not allow
in file names, and `--json` prints machine-readable progress events.

## Desktop app

A small window around the same tool, built with [Tauri 2](https://tauri.app). It shows
the connected phone, lets you pick files or folders (or drag them in), browse the phone,
see the measurements, and follow progress. It remembers your settings between launches.

There are no prebuilt downloads; build it yourself:

```bash
# Once: Rust (https://rustup.rs) and Node.js are needed
./adbcp --bundle                 # downloads Google's adb into platform-tools/ for the app
cd app
npm install
npm run build                    # needs ~/.cargo/bin on your PATH
open src-tauri/target/release/bundle/macos/adbcp.app
```

The app is about 22 MB, most of it the bundled adb. It is not signed by Apple, which is
fine for an app you build yourself; sharing it with others would need signing and
notarization.

## Before you use it

These are not bugs, but they can surprise you:

- **Files with the same name are overwritten without asking**, in both directions.
- **"Skip existing" only compares file sizes.** Add `--verify` to compare the contents.
- **The phone's shared storage (`/sdcard`) refuses some characters in names**
  (`" * : < > ? | \`). Such files are reported, or renamed with `--fix-names`.
- **Measuring writes test files** into a hidden `.adbcp-probe…` folder in the destination
  and deletes them afterwards.
- **`--burst` and `--libusb` restart the adb server**, which briefly disconnects other adb
  tools such as Android Studio.
- **Unplugging the cable during a copy** stops it. Files that finished copying stay. A
  large file that was being copied in parts can leave a hidden `….adbcp-part` file on
  the phone; running the same copy again normally replaces it, otherwise delete it by hand.

## Documentation

- [SPEC.md](SPEC.md): how the copy engine works, its measured performance, and the
  events the app reads.
- [app/SPEC.md](app/SPEC.md): the desktop app: window, settings, building and testing.

## Project layout

```
adbcp            the copy engine (one bash script)
SPEC.md          engine specification
app/             desktop app (Tauri 2: Rust + HTML/CSS/JavaScript)
  SPEC.md        app specification
  src/           the window
  src-tauri/     the Rust side, app configuration and icons
```

## Third-party software

- **adb** (Android platform-tools) is made by Google and covered by Google's own license.
  It is not included in this repository; adbcp downloads it from Google when needed.
- **Tauri** and the other Rust and npm packages used by the app are covered by their own
  licenses, listed in `app/src-tauri/Cargo.lock` and `app/package-lock.json`.

## Disclaimer

This software is provided "as is", without warranty of any kind, express or implied,
including but not limited to warranties of merchantability, fitness for a particular
purpose and non-infringement. You use it entirely at your own risk.

The author is not responsible or liable for any loss, deletion or corruption of files or
data; for any damage to, malfunction of, or loss of use of any phone, computer or other
device, including a device that no longer starts or works ("bricking"); or for any other
damage or loss of any kind arising from the use of, or inability to use, this software.

adbcp only copies files through Google's adb. It does not flash firmware, unlock
bootloaders, root devices or change system partitions. Copying files can still overwrite
or remove data at the destination, and turning on USB debugging has risks of its own.
**Always keep a backup of anything you cannot afford to lose.**

This project is not affiliated with or endorsed by Google, Samsung or any phone maker.
"Android" is a trademark of Google LLC.
