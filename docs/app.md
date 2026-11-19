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
