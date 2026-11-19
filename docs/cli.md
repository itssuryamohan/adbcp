# Command-line tool

`adbcp` copies files and folders between the Mac and a phone over adb. It works like
`cp`: give one or more sources, then a destination.

```
adbcp [options] SRC... DEST              Mac to phone
adbcp --pull [options] SRC... DEST       phone to Mac
```

Phone paths must be absolute, for example `/sdcard/Download/`.

## Common tasks

Copy a file to the phone:

```bash
adbcp ~/Movies/trip.mp4 /sdcard/Movies/
```

Copy a folder to the phone and check every file afterwards:

```bash
adbcp --verify ~/Documents/Games/MyGame /sdcard/Games/
```

Copy photos from the phone to the Mac:

```bash
adbcp --pull --verify /sdcard/DCIM/Camera ~/Pictures/phone/
```

Continue a copy that stopped. adbcp skips files that already exist with the same size:

```bash
adbcp --skip-existing ~/Documents/Games/MyGame /sdcard/Games/
```

Check an earlier copy without copying again:

```bash
adbcp --skip-existing --verify ~/Documents/Games/MyGame /sdcard/Games/
```

Show the plan without copying:

```bash
adbcp --dry-run ~/Documents/Games/MyGame /sdcard/Games/
```

## Continue a stopped copy

adbcp sends large files in parts. It records each part that arrives. If a copy stops,
run the same command again. adbcp then sends only the missing parts.

This works after Ctrl-C, a cut cable, a crash, or a restart of the Mac.

adbcp sends a file in parts in these cases:

- The file is 256 MiB or larger, and it does not compress. Examples are video, archives, and encrypted game packages. adbcp tests a 3 MiB sample of files with other extensions.
- The file is 4 GiB or larger.

A stopped copy keeps `NAME.adbcp-part` files at the destination. adbcp keeps the records
in `~/Library/Caches/adbcp/parts`. It deletes records that are older than 30 days.

adbcp starts a file again from the beginning in these cases:

- The source file changed (size or modification time).
- You changed the part size (`--chunk`).
- The `.adbcp-part` file is missing or shorter than expected.

`--no-split` and `-j 1` send each file in one piece. Then a stopped file starts again
from the beginning.

To finish the other files too, add `--skip-existing`. It skips files that are already
complete.

## Where the files go

adbcp follows the rules of `cp`:

- With one source and a destination that does not exist, the source gets the destination name.
- With several sources, a destination that ends in `/`, or an existing folder, the sources go into the destination.
- adbcp copies folders with all their contents.
- adbcp skips `.DS_Store` and `._*` files from the Mac.

> adbcp replaces files with the same name at the destination. It does not ask first.
> Use `--skip-existing` to keep existing files.

## What you see

adbcp prints one status line that updates while it copies. The line shows the
percentage, the amount copied, the speed, and the time left. At the end it prints a
summary. If files fail, it lists them with the reason.

- `-q` shows only errors and the summary.
- `-v` also lists each file when it finishes.
- `--json` prints one JSON event per line, for other programs. See
  [Events](engine-spec.md#71-events).

## Automatic settings

adbcp measures each phone, cable, and type of destination one time. The measurement
takes about 10 seconds. adbcp saves the result in `~/Library/Caches/adbcp/profiles` and
uses it for later copies.

- A copy of 2 GiB or more, or 1,000 files or more, measures first if no result exists.
- Smaller copies use built-in values until a measurement exists.
- `--recalibrate` measures again before the copy.
- `--measure PATH` measures now, without a copy.
- `--show-profile PATH` shows the saved result for that destination.

Copies from the phone use fixed values. They do not measure.

## Options

### Direction and device

| Option | What it does |
|---|---|
| `--pull` | Copy from the phone to the Mac. The sources are phone paths. |
| `-s SERIAL` | Use this phone. The default is `$ANDROID_SERIAL`, or the only connected phone. |
| `--devices` | List the connected phones. |

### Wi-Fi (Wireless debugging)

| Option | What it does |
|---|---|
| `--wifi-scan` | List the phones on this network that have Wireless debugging on. |
| `--wifi-pair ADDRESS CODE` | Pair with a phone. Use the IP address and port, and the 6-digit code, from **Pair device with pairing code** on the phone. |
| `--wifi-connect ADDRESS` | Connect to a paired phone. Use the address from `--wifi-scan`. |
| `--wifi-disconnect SERIAL` | End a Wi-Fi connection. |

Example:

```bash
adbcp --wifi-scan                            # connect  192.168.1.23:41234  adb-R5CT…
adbcp --wifi-pair 192.168.1.23:37123 123456  # one time for each phone
adbcp --wifi-connect 192.168.1.23:41234
adbcp -s 192.168.1.23:41234 ~/Movies/trip.mp4 /sdcard/Movies/
```

Over Wi-Fi, adbcp splits files of 256 MiB or more into 32 MiB parts and sends them on
parallel streams. This made Wi-Fi copies about twice as fast in tests.

### Checks and safety

| Option | What it does |
|---|---|
| `--verify` | Compare the SHA-1 checksum of each file on both sides after the copy. |
| `--skip-existing` | Skip files that exist at the destination with the same size. |
| `--fix-names` | Copy files with names the phone does not allow. adbcp replaces `" * : < > ? \| \` with `_`. |
| `--force` | Do not check the free space before the copy. |
| `--dry-run` | Show the plan and stop. |

### Speed

| Option | What it does |
|---|---|
| `-j N` | Use N parallel transfers for large files. This replaces the measured value. |
| `-z ALGO` | Compression: `auto`, `none`, `lz4`, `zstd`, or `brotli`. The default `auto` tests the data. |
| `--chunk SIZE` | Part size for split files. The default is `128M`. |
| `--split-min SIZE` | Split files that do not compress, from this size. The default is `256M`. `0` splits all such files. |
| `--no-split` | Never split files. This also turns off resuming inside files. |
| `--recalibrate` | Measure this phone, cable, and destination again. |
| `--burst` | Experimental. Restart adb in burst mode. It was slower on real copies in tests. |
| `--libusb` | Experimental. Restart adb with the libusb USB backend. |
| `--bench [DIR]` | Compare a single push with split pushes. Set the test file size with `--bench-size`. |

`--burst` and `--libusb` restart the adb server. This disconnects other adb tools for a
moment. Run `adb kill-server` to go back to the normal server.

Sizes take a number with an optional `K`, `M`, or `G`, for example `512M`.

### Phone files

| Option | What it does |
|---|---|
| `--ls PATH` | List a folder on the phone. |
| `--mkdir PATH` | Make a folder on the phone. |
| `--rename OLD NEW` | Rename or move an item on the phone. It never replaces an item. |
| `--delete PATH...` | Delete items on the phone permanently. |

`--delete` cannot be undone. adbcp refuses to delete storage roots, system folders, and
standard folders such as `DCIM`, `Download`, and `Android`.

### Measurements

| Option | What it does |
|---|---|
| `--measure PATH` | Measure the phone, cable, and destination now. |
| `--show-profile PATH` | Show the saved measurement for this destination. |

### adb

| Option | What it does |
|---|---|
| `--adb-status` | Show which adb adbcp uses. It downloads nothing. |
| `--get-adb` | Download Google's platform-tools into the cache now. |
| `--bundle` | Download adb into `platform-tools/` next to the script. Use this only for your own copy. |

### Output

| Option | What it does |
|---|---|
| `-q` | Show only errors and the summary. |
| `-v`, `--verbose` | Also list each file or group of small files when it finishes. |
| `--json` | Print one JSON event per line. |
| `-h`, `--help` | Show the help text. |

## Environment variables

| Variable | What it does |
|---|---|
| `ANDROID_SERIAL` | The phone to use, like `-s`. |
| `ADB` | The adb program to use. |
| `ADBCP_NO_DOWNLOAD=1` | Stop with an error when no adb is found. Do not download it. |
| `ADBCP_ADB_SEARCH_COMMON=0` | Do not look in the Homebrew and Android Studio folders. |
| `ADBCP_BATCH_FILES` | Small files per group. The default is 200. |
| `ADBCP_SMALL_STREAMS` | Parallel transfers for groups of small files. |

## Result codes

| Code | Meaning |
|---|---|
| 0 | All files copied. With `--verify`, all files match. |
| 1 | Some files failed, the check found differences, or an error stopped the copy. |
| 130 | You pressed Ctrl-C. |

Press Ctrl-C to stop a copy. adbcp stops all transfers in less than a second. It
removes files that it did not finish. Finished files stay.
