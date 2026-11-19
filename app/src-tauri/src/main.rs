// adbcp desktop app: a window around the adbcp copy engine (see ../../docs/app-spec.md).
//
// The engine is the bash script bundled under Resources/engine. Google's adb is not
// bundled: the engine finds an installed one, or the window asks before downloading it. This side starts it
// with --json, forwards its events to the window ("engine-event", "engine-log",
// "engine-exit"), and cancels it with SIGINT. The engine runs in its own process group
// so that its interrupt handler can stop every transfer it started.

use std::io::{BufRead, BufReader};
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

/// Process id of the running copy, which is also its process group id.
#[derive(Default)]
struct Running(Mutex<Option<i32>>);

/// Set while "Measure now" runs, so a copy and a measurement never overlap.
#[derive(Default)]
struct Measuring(Mutex<bool>);

/// The bundled engine, or the one named by ADBCP_ENGINE (handy during development).
fn engine_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("ADBCP_ENGINE") {
        return Ok(PathBuf::from(p));
    }
    let p = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("engine/adbcp");
    if p.exists() {
        Ok(p)
    } else {
        Err(format!("copy engine not found at {}", p.display()))
    }
}

fn engine(app: &AppHandle) -> Result<Command, String> {
    let mut cmd = Command::new("/bin/bash");
    cmd.arg(engine_path(app)?);
    // Google's adb is not bundled. The engine must never download it on its own from
    // the app: the window asks first, then calls get_adb.
    cmd.env("ADBCP_NO_DOWNLOAD", "1");
    Ok(cmd)
}

/// Google's page for the Android SDK Platform-Tools, with their terms.
const ADB_TERMS_URL: &str = "https://developer.android.com/tools/releases/platform-tools";

/// Runs a short engine query (--devices, --ls) and returns its JSON events.
fn query(app: &AppHandle, args: Vec<String>) -> Result<Vec<Value>, String> {
    let out = engine(app)?
        .arg("--json") // before the arguments: a "--" among them ends the options
        .args(&args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| e.to_string())?;
    let events: Vec<Value> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    if let Some(e) = events.iter().find(|e| e["event"] == "error") {
        return Err(e["message"].as_str().unwrap_or("unknown error").to_string());
    }
    Ok(events)
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())
}

/// Which adb the engine would use, without downloading anything.
#[tauri::command]
async fn adb_status(app: AppHandle) -> Result<Vec<Value>, String> {
    blocking(move || query(&app, vec!["--adb-status".into()])).await?
}

/// Downloads Google's platform-tools (about 16 MB) after the user agreed in the window.
#[tauri::command]
async fn get_adb(app: AppHandle) -> Result<Vec<Value>, String> {
    blocking(move || query(&app, vec!["--get-adb".into()])).await?
}

/// Opens Google's Platform-Tools page (and only that page) in the default browser.
#[tauri::command]
fn open_adb_terms() -> Result<(), String> {
    Command::new("/usr/bin/open").arg(ADB_TERMS_URL).status().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn list_devices(app: AppHandle) -> Result<Vec<Value>, String> {
    blocking(move || query(&app, vec!["--devices".into()])).await?
}

/// Phones offering Wireless debugging on this network (adb's mDNS discovery).
#[tauri::command]
async fn wifi_scan(app: AppHandle) -> Result<Vec<Value>, String> {
    blocking(move || query(&app, vec!["--wifi-scan".into()])).await?
}

/// Pairs with, connects to, or disconnects from a phone over Wi-Fi.
#[tauri::command]
async fn wifi_op(app: AppHandle, op: String, args: Vec<String>) -> Result<(), String> {
    let flag = match op.as_str() {
        "pair" => "--wifi-pair",
        "connect" => "--wifi-connect",
        "disconnect" => "--wifi-disconnect",
        _ => return Err(format!("unknown Wi-Fi operation {op}")),
    };
    blocking(move || {
        let mut a = vec![flag.to_string(), "--".to_string()];
        a.extend(args);
        query(&app, a).map(|_| ())
    })
    .await?
}

/// The QR code for "Pair device with QR code", as an SVG image.
#[tauri::command]
fn qr_svg(text: String) -> Result<String, String> {
    use qrcode::render::svg;
    let code = qrcode::QrCode::new(text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(code
        .render::<svg::Color>()
        .min_dimensions(200, 200)
        .dark_color(svg::Color("#000000"))
        .light_color(svg::Color("#ffffff"))
        .build())
}

#[tauri::command]
async fn list_dir(app: AppHandle, serial: String, path: String) -> Result<Vec<Value>, String> {
    blocking(move || query(&app, vec!["-s".into(), serial, "--ls".into(), path])).await?
}

/// Saved measurements for this phone and the kind of destination `dest` is.
#[tauri::command]
async fn show_profile(app: AppHandle, serial: String, dest: String) -> Result<Vec<Value>, String> {
    blocking(move || query(&app, vec!["-s".into(), serial, "--show-profile".into(), dest])).await?
}

/// "Measure now": measures the phone at `dest` (about 10 seconds) and saves the results.
#[tauri::command]
async fn measure(app: AppHandle, serial: String, dest: String) -> Result<Vec<Value>, String> {
    {
        if app.state::<Running>().0.lock().unwrap().is_some() {
            return Err("a copy is running".into());
        }
        let measuring = app.state::<Measuring>();
        let mut busy = measuring.0.lock().unwrap();
        if *busy {
            return Err("already measuring".into());
        }
        *busy = true;
    }
    let a = app.clone();
    let result = blocking(move || query(&a, vec!["-s".into(), serial, "--measure".into(), dest])).await;
    *app.state::<Measuring>().0.lock().unwrap() = false;
    result?
}

/// One entry of a folder listing, for either pane (the engine's --ls entries have the
/// same fields).
#[derive(Serialize)]
struct Entry {
    name: String,
    path: String,
    #[serde(rename = "type")]
    kind: &'static str,
    size: u64,
    mtime: u64,
}

/// The folders and files directly inside `path` on this Mac.
#[tauri::command]
async fn list_local(path: String) -> Result<Vec<Entry>, String> {
    blocking(move || {
        let dir = std::fs::read_dir(&path).map_err(|e| format!("cannot open {path}: {e}"))?;
        let mut out = Vec::new();
        for item in dir.flatten() {
            let p = item.path();
            // Follow symlinks for the type and size, like Finder; broken links show as "other".
            let meta = std::fs::metadata(&p).or_else(|_| std::fs::symlink_metadata(&p));
            let Ok(meta) = meta else { continue };
            let kind = if meta.is_dir() { "dir" } else if meta.is_file() { "file" } else { "other" };
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_secs());
            out.push(Entry {
                name: item.file_name().to_string_lossy().into_owned(),
                path: p.to_string_lossy().into_owned(),
                kind,
                size: if meta.is_file() { meta.len() } else { 0 },
                mtime,
            });
        }
        Ok(out)
    })
    .await?
}

/// Common places on this Mac for the Mac pane's menu: (name, path) pairs that exist.
#[tauri::command]
fn local_places(app: AppHandle) -> Vec<(String, String)> {
    let p = app.path();
    let mut places: Vec<(String, Option<PathBuf>)> = vec![
        ("Home".into(), p.home_dir().ok()),
        ("Desktop".into(), p.desktop_dir().ok()),
        ("Documents".into(), p.document_dir().ok()),
        ("Downloads".into(), p.download_dir().ok()),
        ("Movies".into(), p.video_dir().ok()),
        ("Music".into(), p.audio_dir().ok()),
        ("Pictures".into(), p.picture_dir().ok()),
    ];
    if let Ok(volumes) = std::fs::read_dir("/Volumes") {
        for v in volumes.flatten() {
            let path = v.path();
            // The startup disk also appears here, as a link to "/".
            if std::fs::read_link(&path).is_ok() {
                continue;
            }
            places.push((v.file_name().to_string_lossy().into_owned(), Some(path)));
        }
    }
    places
        .into_iter()
        .filter_map(|(name, path)| path.filter(|p| p.is_dir()).map(|p| (name, p.display().to_string())))
        .collect()
}

#[tauri::command]
fn local_mkdir(path: String) -> Result<(), String> {
    std::fs::create_dir(&path).map_err(|e| e.to_string())
}

/// Renames without ever replacing an existing item.
#[tauri::command]
fn local_rename(from: String, to: String) -> Result<(), String> {
    if std::path::Path::new(&to).exists() {
        return Err("something with that name already exists".into());
    }
    std::fs::rename(&from, &to).map_err(|e| e.to_string())
}

/// Moves items to the Trash (never deletes them outright).
#[tauri::command]
async fn local_trash(paths: Vec<String>) -> Result<(), String> {
    blocking(move || {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut ctx = trash::TrashContext::default();
        // NSFileManager avoids asking for permission to control Finder.
        ctx.set_delete_method(DeleteMethod::NsFileManager);
        ctx.delete_all(&paths).map_err(|e| e.to_string())
    })
    .await?
}

/// New folder, rename and delete on the phone, through the engine (which refuses to
/// delete storage roots and standard folders).
#[tauri::command]
async fn phone_op(app: AppHandle, serial: String, op: String, paths: Vec<String>) -> Result<(), String> {
    let flag = match op.as_str() {
        "mkdir" => "--mkdir",
        "rename" => "--rename",
        "delete" => "--delete",
        _ => return Err(format!("unknown operation {op}")),
    };
    blocking(move || {
        let mut args = vec!["-s".to_string(), serial, flag.to_string(), "--".to_string()];
        args.extend(paths);
        query(&app, args).map(|_| ())
    })
    .await?
}

/// Settings remembered between launches, as JSON in the app's settings folder.
fn settings_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("settings.json"))
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Value {
    settings_file(&app)
        .ok()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(Value::Null)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    let file = settings_file(&app)?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(file, text).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyRequest {
    serial: String,
    pull: bool,
    sources: Vec<String>,
    dest: String,
    verify: bool,
    skip_existing: bool,
    streams: Option<u32>,
    compression: String,
    split: bool,
    part_size_mib: Option<u32>,
    split_min_mib: Option<u32>,
    fix_names: bool,
    burst: bool,
    libusb: bool,
    force: bool,
    /// Measure the phone, cable and destination first (--recalibrate). Otherwise the
    /// engine never measures by itself (--no-calibrate): the user chooses.
    #[serde(default)]
    calibrate: bool,
}

/// Starts a copy. Options are built from typed fields, so the window cannot pass
/// arbitrary engine flags.
#[tauri::command]
fn start_copy(app: AppHandle, running: State<Running>, req: CopyRequest) -> Result<(), String> {
    let mut slot = running.0.lock().unwrap();
    if slot.is_some() {
        return Err("a copy is already running".into());
    }
    if *app.state::<Measuring>().0.lock().unwrap() {
        return Err("wait for the measurement to finish".into());
    }
    let mut cmd = engine(&app)?;
    cmd.args(["--json", "-s", &req.serial]);
    if req.pull {
        cmd.arg("--pull");
    }
    if req.verify {
        cmd.arg("--verify");
    }
    if req.skip_existing {
        cmd.arg("--skip-existing");
    }
    if let Some(n) = req.streams {
        cmd.args(["-j", &n.to_string()]);
    }
    match req.compression.as_str() {
        "none" | "zstd" | "lz4" => {
            cmd.args(["-z", &req.compression]);
        }
        _ => {}
    }
    if !req.split {
        cmd.arg("--no-split");
    }
    if let Some(n) = req.part_size_mib {
        cmd.args(["--chunk", &format!("{n}M")]);
    }
    if let Some(n) = req.split_min_mib {
        cmd.args(["--split-min", &format!("{n}M")]);
    }
    if req.fix_names {
        cmd.arg("--fix-names");
    }
    if req.burst {
        cmd.arg("--burst");
    }
    if req.libusb {
        cmd.arg("--libusb");
    }
    if req.force {
        cmd.arg("--force");
    }
    cmd.arg(if req.calibrate && !req.pull { "--recalibrate" } else { "--no-calibrate" });
    cmd.arg("--").args(&req.sources).arg(&req.dest);
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);

    let mut child = cmd.spawn().map_err(|e| format!("cannot start the copy engine: {e}"))?;
    *slot = Some(child.id() as i32);

    let stdout = child.stdout.take().expect("piped stdout");
    let stderr = child.stderr.take().expect("piped stderr");
    let a = app.clone();
    let events = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                let _ = a.emit("engine-event", v);
            }
        }
    });
    let a = app.clone();
    let log = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = a.emit("engine-log", line);
        }
    });
    let a = app.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        let _ = events.join(); // deliver every event before the exit notice
        let _ = log.join();
        let code = status
            .ok()
            .and_then(|s| s.code().or_else(|| s.signal().map(|n| 128 + n)))
            .unwrap_or(-1);
        *a.state::<Running>().0.lock().unwrap() = None;
        let _ = a.emit("engine-exit", code);
    });
    Ok(())
}

/// Asks the running copy to stop, like Ctrl-C in a terminal.
#[tauri::command]
fn cancel_copy(running: State<Running>) -> bool {
    match *running.0.lock().unwrap() {
        Some(pid) => {
            unsafe { libc::kill(pid, libc::SIGINT) };
            true
        }
        None => false,
    }
}

/// For automated smoke tests: ADBCP_APP_AUTORUN holds a JSON copy request that the
/// window fills in and starts on launch.
#[tauri::command]
fn autorun() -> Option<Value> {
    std::env::var("ADBCP_APP_AUTORUN")
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
}

fn main() {
    let app = tauri::Builder::default()
        .manage(Running::default())
        .manage(Measuring::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(drag) = event {
                // Positions are sent in CSS pixels so the window can find the pane under them.
                let scale = window.scale_factor().unwrap_or(1.0);
                let at = |p: &tauri::PhysicalPosition<f64>| serde_json::json!({ "x": p.x / scale, "y": p.y / scale });
                match drag {
                    tauri::DragDropEvent::Enter { position, .. } | tauri::DragDropEvent::Over { position } => {
                        let _ = window.emit("drag-hover", serde_json::json!({ "over": true, "at": at(position) }));
                    }
                    tauri::DragDropEvent::Leave => {
                        let _ = window.emit("drag-hover", serde_json::json!({ "over": false }));
                    }
                    tauri::DragDropEvent::Drop { paths, position } => {
                        let _ = window.emit("drag-hover", serde_json::json!({ "over": false }));
                        let paths: Vec<String> = paths.iter().map(|p| p.display().to_string()).collect();
                        let _ = window.emit("files-dropped", serde_json::json!({ "paths": paths, "at": at(position) }));
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            adb_status,
            get_adb,
            open_adb_terms,
            list_devices,
            wifi_scan,
            wifi_op,
            qr_svg,
            list_dir,
            list_local,
            local_places,
            local_mkdir,
            local_rename,
            local_trash,
            phone_op,
            show_profile,
            measure,
            load_settings,
            save_settings,
            start_copy,
            cancel_copy,
            autorun
        ])
        .build(tauri::generate_context!())
        .expect("failed to start adbcp");
    app.run(|app, event| {
        // Quitting while copying stops the whole copy, not just the engine script.
        if let tauri::RunEvent::Exit = event {
            if let Some(pid) = *app.state::<Running>().0.lock().unwrap() {
                unsafe { libc::kill(-pid, libc::SIGTERM) };
            }
        }
    });
}
