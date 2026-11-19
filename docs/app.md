# Desktop app

The app shows two file lists side by side. The left pane shows this Mac. The right pane
shows the phone. To copy, move items from one pane to the other.

The app uses the same engine as the command-line tool. For the full design, see the
[App specification](app-spec.md).

## Start

1. Connect the phone with the cable. USB debugging must be on. See [Install](install.md#turn-on-usb-debugging).
2. Open adbcp.
3. If the app asks for adb, click **Download**. See [Get adb](install.md#get-adb).
4. Select the phone in the **Phone** list at the top.

If the phone does not show, click **Refresh**. If the phone pane shows a message, follow
its steps.

## Connect over Wi-Fi

You can use the phone without a cable. The phone and the Mac must be on the same Wi-Fi
network.

1. Click **Wi-Fi…** next to **Refresh**. The app shows a QR code.
2. On the phone, open **Settings > Developer options > Wireless debugging** and turn it on.
3. Tap **Pair device with QR code** and scan the code on the Mac.

The app pairs, connects, and selects the phone. The **Phone** list shows it as
"SM-S918B · Wi-Fi". You pair each phone one time. Later, open **Wi-Fi…** and click
**Connect** next to the phone.

If the phone cannot scan the code, open **Pair with a code instead**. On the phone, tap
**Pair device with pairing code**. Type the IP address and port, and the 6-digit code,
then click **Pair**. The app fills in the address when it finds the phone.

Wi-Fi is slower than USB. Your Wi-Fi network sets the speed. On the test network, copies
ran at about 16 MiB/s, against about 400 MiB/s over USB 3.

macOS can ask to let adbcp find devices on the local network. Click **Allow**. Without
it, the app cannot find the phone.

## Move around

- Double-click a folder to open it.
- Click **↑** to go up one folder.
- Type a path in the path field and press Return.
- Use the **Places** menu for common folders, such as Downloads or DCIM.
- Click a column title to sort by name, size, or date.

To select items:

- Click an item to select it.
- Command-click to add or remove one item.
- Shift-click to select a range.
- Press Command-A to select all items.

## Copy

1. Open the destination folder in one pane.
2. Select the items in the other pane.
3. Click **Copy to phone →** or **← Copy to Mac**.

To the phone, you can choose how the app sets its speed settings:

| Button | What it does |
|---|---|
| **Copy to phone →** | Uses the settings measured earlier for this phone, cable, and kind of folder. If there are none, it uses built-in settings. It never measures. |
| **Calibrate & copy →** | Measures this phone, cable, and folder first (about 10 seconds, longer on Wi-Fi), saves the result, then copies. Use it the first time, or after you change the cable or the connection. |

Hold the pointer over **Copy to phone →** to see which measurement it uses. Copies to
the Mac always use fixed settings, so that side has no Calibrate button.

You can also drag the items to the other pane. Drop them on a folder to copy into that
folder. You can drag files from Finder onto the phone pane.

If items with the same names exist at the destination, the app asks what to do:

- **Replace** copies over the existing items.
- **Skip existing** keeps items that have the same size.
- **Cancel** stops.

You can start more copies while one runs. They wait in a queue.

## Watch a copy

The transfer bar at the bottom shows the progress, speed, and time left.

- **Problems** lists files that failed, with the reason.
- **Details** shows all messages from the engine.
- **Cancel** stops the copy and clears the queue. Large files that the engine sends in parts stay as `NAME.adbcp-part`. Copy the same items again to continue them. The app removes other unfinished files.

After a copy:

- **Retry failed files** copies the failed files again.
- **Copy with safe names** copies files whose names the phone does not allow. The app
  replaces each character that is not allowed with `_`.

## Manage files

Each pane has **New folder**, **Rename**, and **Delete** buttons.

| Pane | What Delete does |
|---|---|
| This Mac | Moves the items to the Trash. |
| Phone | Deletes the items permanently, after you confirm. |

The app does not let you delete storage roots or standard phone folders, such as
`/sdcard`, `DCIM`, or `Download`.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| Return | Open the selected folder |
| Command-↑ | Go up one folder |
| Command-A | Select all |
| Shift-Command-N | New folder |
| Command-Delete | Delete, with confirmation |

## Settings

Click **⚙ Settings** to open the settings.

| Setting | Default | What it does |
|---|---|---|
| Verify after copying | On | Compares each file on both sides after the copy. This adds 70 to 90% to the time. |
| When names already exist | Ask | Ask, Replace, or Skip existing. |
| Show hidden files | Off | Shows names that start with `.`. |
| Tuning | — | Shows the saved measurement. **Measure now** measures the phone again (about 10 seconds). |
| adb | — | Shows which adb the app uses. |
| Parallel transfers | Automatic | The number of files that the engine sends at the same time. |
| Compression | Automatic | Off, zstd, or lz4. Automatic tests the data first. |
| Split very large files | Automatic | Sends parts of large files at the same time. |
| Part size, Split files from | 128 MiB, 256 MiB | Sizes for split files. |
| Replace characters the phone does not allow | Off | Uses safe names for every copy. |
| Burst mode, libusb connection | Off | Experimental. Both restart adb. |
| Skip the free-space check | Off | The app does not remember this setting. |

The app saves the settings, the last folders, and the sort order in
`~/Library/Application Support/dev.adbcp.desktop/settings.json`.
