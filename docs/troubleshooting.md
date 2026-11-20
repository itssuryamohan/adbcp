# Troubleshooting

To see what adbcp sees, run these commands:

```bash
./adbcp --adb-status     # which adb adbcp uses
./adbcp --devices        # the connected phones and their state
```

In the app, open **Details** in the transfer bar to read all engine messages.

## The phone does not show

| Message or state | What to do |
|---|---|
| No phone in the list | Use a data cable, not a charge-only cable. Unlock the phone. Click **Refresh**. |
| `unauthorized`, or "authorize this computer on the phone?" | Unlock the phone and tap **Allow** in the "Allow USB debugging?" message. If no message shows, open **Developer options**, tap **Revoke USB debugging authorizations**, and connect again. |
| `offline` | Disconnect the cable and connect it again. If this does not help, run `adb kill-server`. |
| "more than one device/emulator" | Select the phone with `-s SERIAL`. `./adbcp --devices` shows the serial numbers. |
| "no devices/emulators found" | Check that USB debugging is on. See [Install](install.md#turn-on-usb-debugging). |
| The app shows "· in use by another app" | macOS's photo service (`ptpcamerad`) or Android File Transfer holds the phone's File transfer mode. Quit Android File Transfer, or run `pkill -9 ptpcamerad`, then click **Refresh**. |
| The app shows "· USB (no debugging)" and copies are slow | USB debugging is off, so the app uses MTP. Turn on USB debugging for copies 2 to 3 times faster. |

## Wi-Fi problems

| Problem | What to do |
|---|---|
| The app does not find the phone | Put the phone and the Mac on the same Wi-Fi network. Some public and guest networks block devices from seeing each other. |
| macOS asked about the local network and you clicked **Don't Allow** | Open **System Settings > Privacy & Security > Local Network** and turn on adbcp. |
| Pairing fails | Pairing codes work one time and expire. Open the pairing screen on the phone again and scan the new code. |
| **Connect** fails: "failed to connect" | The phone was not paired with this Mac, or Wireless debugging turned off. Pair again with the QR code. |
| The phone disappears after some time | Android turns off Wireless debugging when the phone leaves the network. Turn it on again, then click **Connect** in **Wi-Fi…**. |
| Wi-Fi copies are slow | Your Wi-Fi network sets the speed. Use 5 GHz or 6 GHz Wi-Fi near the router, or use the USB cable for large copies. |

## adb problems

| Message | What to do |
|---|---|
| "adb is not installed" | Install adb, or let adbcp download it. See [Get adb](install.md#get-adb). |
| "adb download failed" | Check the internet connection, then try again. |
| "downloaded adb is not signed by Google; refusing to use it" | adbcp did not use the download. Try again later, or install adb with Homebrew. |
| "adb start-server failed" | Another adb version may run. Run `adb kill-server`, then try again. |
| Android Studio loses the phone | `--burst` and `--libusb` restart adb. Run `adb kill-server` to go back to normal. |

Two different adb versions can stop each other's server. Use one adb for all tools. Set
`ADB` to the same adb that your other tools use.

## The copy is slow

| Cause | What to do |
|---|---|
| USB 2.0 connection | adbcp warns "the phone is connected at USB 2.0 speed". Use a USB 3 cable and a USB 3 port on the Mac. Do not use a USB hub. |
| Many small files in shared storage | Android takes 5 to 10 ms to create each file in `/sdcard`. This limits the speed. adbcp sends small files in groups to reduce the effect. |
| Old measurement | Run the copy with `--recalibrate`, or click **Measure now** in the app. |
| Phone is hot or in power saving mode | Let the phone cool down, and turn off power saving. |

## Some files fail

| Message | What to do |
|---|---|
| Names the phone does not allow | Shared storage refuses the characters `" * : < > ? \| \`. Use `--fix-names`, or click **Copy with safe names** in the app. |
| "skipping files whose names contain tabs or line breaks" | Rename those files on the Mac, then copy again. |
| "not enough space on device" | Free space on the phone. Use `--force` only if you know that the space is enough. |
| "not found on the phone" | Check the phone path. Phone paths must start with `/`. |
| Folders that "could not be read (permission denied)" | Android blocks some folders, such as other apps' private data. adbcp leaves them out. |
| A file is "different" after verify | Copy that file again. If it fails again, check the cable and the free space. |

## A copy stopped in the middle

Run the same copy again with `--skip-existing`. In the app, select the same items and
choose **Skip existing**.

- Large files continue from the last part that arrived. adbcp shows "Resuming".
- `--skip-existing` skips the files that are complete.

A stopped copy can leave `NAME.adbcp-part` files at the destination. These are the
partly copied large files. If you do not want to continue the copy, delete them by hand.

If "Resuming" does not show, adbcp starts the file again. This happens when the source
file changed, when the `.adbcp-part` file is missing, or when **Resumable large files**
is off (`--no-resume`). See
[Continue a stopped copy](cli.md#continue-a-stopped-copy).

## The app does not open

macOS blocks apps that Apple did not notarize. See
[Open the app the first time](install.md#open-the-app-the-first-time).

## Report a problem

Open an issue on the GitHub repository. Include:

- The output of `./adbcp --adb-status` and `./adbcp --devices`.
- The phone model and Android version.
- The command you ran, or the steps in the app.
- The messages from the Terminal, or from **Details** in the app.

Remove private file names before you post the messages.
