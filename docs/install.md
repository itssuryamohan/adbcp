# Install

## What you need

- **A Mac** with Apple Silicon or Intel and a current macOS. The app needs macOS 11 or later.
- **An Android phone.** With USB debugging on, copies are fastest. See [Turn on USB debugging](#turn-on-usb-debugging).
  Without it, the app copies in the phone's normal "File transfer" mode. See [Use the app without USB debugging](#use-the-app-without-usb-debugging).
- **A USB data cable.** Use a USB 3 cable in a USB 3 port. USB 3 is 5 to 10 times faster than USB 2.0.
- **Google's adb.** adbcp finds an installed copy, or downloads it for you. See [Get adb](#get-adb).

Compression needs Android 11 or later. Older phones copy without compression.

## Turn on USB debugging

1. On the phone, open **Settings > About phone**.
2. Tap **Build number** seven times. The phone shows "You are now a developer".
3. Open **Settings > Developer options**.
4. Turn on **USB debugging**.
5. Connect the phone to the Mac with the cable.
6. On the phone, tap **Allow** in the "Allow USB debugging?" message.

The menu names can differ on some phones. Samsung phones show **Build number** under
**Settings > About phone > Software information**.

> USB debugging lets an allowed computer control the phone. Turn it off when you do not
> need it.

## Use the app without USB debugging

The desktop app also works with USB debugging off. It then copies over MTP, the
standard "File transfer" mode of Android phones. It needs no adb.

1. Connect the phone with the cable and unlock it.
2. Pull down the notification panel and tap the USB notification.
3. Choose **Transferring files** (or **File transfer**).

The **Phone** list shows the phone as "SM-S918B · USB (no debugging)".

MTP sends one file at a time, without compression. On the test phone, copies took 2 to 3
times longer than with USB debugging. Many small files are slowest.

## Get the command-line tool

The tool is one bash script, `adbcp`. It needs only the tools that come with macOS.

```bash
git clone https://github.com/itssuryamohan/adbcp.git
cd adbcp
./adbcp --help
```

To run it from any folder, add its folder to your `PATH`:

```bash
echo "export PATH=\"$PWD:\$PATH\"" >> ~/.zshrc
```

Open a new Terminal window after this step.

Next step: [Command-line tool](cli.md).

## Get the desktop app

### Download a release

1. Open the repository's **Releases** page on GitHub.
2. Download `adbcp-<version>-macos-universal.zip`.
3. Unzip it.
4. Move `adbcp.app` to the Applications folder.

The same zip runs on Apple Silicon and Intel Macs.

### Open the app the first time

Apple did not sign or notarize the app. macOS blocks it the first time you open it.

1. Open `adbcp.app`. macOS says that it cannot check the app.
2. Click **Done**.
3. Open **System Settings > Privacy & Security**.
4. Scroll down and click **Open Anyway** next to adbcp.
5. Confirm with your password or Touch ID.

You do this only once. As an alternative, run this command, then open the app:

```bash
xattr -dr com.apple.quarantine /Applications/adbcp.app
```

### Build the app yourself

See [Development](development.md#build-the-app).

Next step: [Desktop app](app.md).

## Get adb

adb (Android Debug Bridge) is Google's tool that talks to the phone. Google's license
does not let others pass it on. Thus the app does not include it.

adbcp looks for adb in this order and uses the first one it finds:

1. The path in the `ADB` environment variable.
2. `platform-tools/adb` next to the `adbcp` script.
3. `adb` on your `PATH`.
4. Homebrew: `/opt/homebrew/bin/adb` or `/usr/local/bin/adb`.
5. Android Studio: `$ANDROID_HOME/platform-tools/adb` or `~/Library/Android/sdk/platform-tools/adb`.
6. A copy that adbcp downloaded before, in `~/Library/Caches/adbcp/platform-tools/`.

If it finds none:

- **The command-line tool** downloads Google's platform-tools (about 16 MB) one time.
- **The app** asks first. Click **Download** to get it, or **Not now** to stop.

Both check Google's digital signature before they use the download. adbcp refuses a copy
that Google did not sign.

To install adb yourself with Homebrew:

```bash
brew install android-platform-tools
```

To see which adb adbcp uses:

```bash
./adbcp --adb-status
```
