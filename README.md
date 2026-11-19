# adbcp

adbcp copies files between a Mac and an Android phone over a USB cable. It is fast.
It has a command-line tool and a small desktop app.

> **Use at your own risk.** This is a personal project. It comes as is, without
> warranty. The author is not responsible for lost or damaged files, or for damaged or
> unusable ("bricked") devices. Read the [disclaimer](#disclaimer) before you use it.

## What it does

`adb push` and `adb pull` send one file at a time. They wait for the phone to confirm
each piece. adbcp uses the same adb, but it:

- **Sends several files at the same time.** It also splits very large files into parts and sends the parts at the same time.
- **Sends small files in groups** of up to 200, next to the large files.
- **Compresses only data that gets smaller.** It sends video, photos, and archives as they are.
- **Tunes itself.** It measures each phone, cable, and destination one time (about 10 seconds).
- **Works in both directions**: Mac to phone, and phone to Mac (`--pull`).
- **Checks its work.** `--verify` compares SHA-1 checksums on both sides.
- **Continues a stopped copy.** Large files continue from the last part that arrived. `--skip-existing` skips files that already arrived.
- **Does not leave half-written files.** See the note on unplugging in [Before you use it](#before-you-use-it).

### Measured speed

Galaxy S23 Ultra over USB 3 (5 Gb/s), 12.6 GB of game data in 1,881 files:

| Direction | adbcp | Plain `adb` |
|---|---|---|
| Mac to phone | 32 s (about 400 MiB/s) | not measured for this folder |
| Phone to Mac | 32 s | 68–76 s (`adb pull`) |

Over a USB 2.0 cable, the same phone reached about 34 MB/s. These numbers come from one
phone. Your results can be different.

## Quick start

1. Turn on USB debugging on the phone. See [Install](docs/install.md#turn-on-usb-debugging).
2. Connect the phone with a USB data cable.
3. Get adbcp:

   ```bash
   git clone https://github.com/itssuryamohan/adbcp.git
   cd adbcp
   ```

4. Copy files:

   ```bash
   # Mac to phone
   ./adbcp --verify ~/Movies/trip.mp4 /sdcard/Movies/

   # Phone to Mac
   ./adbcp --pull --verify /sdcard/DCIM/Camera ~/Pictures/phone/

   # Continue a copy that stopped
   ./adbcp --skip-existing ~/Documents/Games/MyGame /sdcard/Games/
   ```

adbcp uses an adb that is already on the Mac. If there is none, it downloads Google's
adb one time and checks Google's signature. See [Get adb](docs/install.md#get-adb).

All options are in [Command-line tool](docs/cli.md).

## Desktop app

The app shows two file lists side by side: this Mac on the left, the phone on the right.

- Select items and click a copy button, or drag them to the other pane.
- Drop files from Finder onto the phone pane.
- Make folders, rename, and delete on both sides.
- See the progress, speed, time left, and problems in the transfer bar.
- Connect the phone over Wi-Fi with a QR code (Wireless debugging), without a cable.

Download the app from the **Releases** page. It runs on Apple Silicon and Intel Macs.
Apple did not notarize it, so you must allow it one time. See
[Open the app the first time](docs/install.md#open-the-app-the-first-time).

The app is about 6.6 MB. It does not include Google's adb. If no adb is on the Mac, the
app asks before it downloads it.

To build the app yourself, see [Development](docs/development.md#build-the-app).

## Before you use it

These are not bugs, but they can surprise you:

- **The command-line tool replaces files with the same name. It does not ask.** This is true in both directions. The app asks first.
- **Deleting on the phone is permanent.** adb has no trash. The app always asks first. It does not delete storage roots or standard folders, such as DCIM or Download.
- **"Skip existing" compares only file sizes.** Add `--verify` to compare the contents.
- **Shared storage (`/sdcard`) refuses some characters in names**: `" * : < > ? | \`. adbcp reports these files. `--fix-names` copies them with `_` instead.
- **Measuring writes test files** into a hidden `.adbcp-probe…` folder in the destination. adbcp deletes them afterwards.
- **`--burst` and `--libusb` restart the adb server.** This disconnects other adb tools, such as Android Studio, for a moment.
- **A stopped copy keeps its partly copied large files.** Cancel, a cut cable, or a crash leaves `NAME.adbcp-part` files at the destination. Run the same copy again to finish them. If you do not want to continue, delete these files by hand.

## Documentation

| Document | Contents |
|---|---|
| [Install](docs/install.md) | USB debugging, the tool, the app, and adb |
| [Command-line tool](docs/cli.md) | Common tasks and all options |
| [Desktop app](docs/app.md) | How to use the window |
| [Troubleshooting](docs/troubleshooting.md) | Error messages and slow copies |
| [Development](docs/development.md) | Build, test, and release |
| [Engine specification](docs/engine-spec.md) | How the engine works, and its JSON events |
| [App specification](docs/app-spec.md) | The app design and tests |

## License

adbcp is under the [MIT License](LICENSE). You can use, copy, change, and share the
code for any purpose. Keep the copyright notice and the license text in your copies.
The license gives no warranty and no liability. See also the [Disclaimer](#disclaimer).

## Third-party software

- **adb** (Android platform-tools) comes from Google, under Google's license. This
  repository and the app do not include it. adbcp downloads it from Google when needed.
  The app asks first.
- **Tauri** and the other Rust and npm packages have their own licenses (mostly MIT or Apache-2.0). The lists are
  in `app/src-tauri/Cargo.lock` and `app/package-lock.json`.

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
