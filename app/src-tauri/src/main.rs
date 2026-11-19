// adbcp desktop app: a window around the adbcp copy engine (see ../../SPEC.md).
//
// The engine is the bash script bundled under Resources/engine. This side starts it
// with --json, forwards its events to the window ("engine-event", "engine-log",
// "engine-exit"), and cancels it with SIGINT. The engine runs in its own process group
// so that its interrupt handler can stop every transfer it started.

use std::io::{BufRead, BufReader};
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

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
    Ok(cmd)
}

/// Runs a short engine query (--devices, --ls) and returns its JSON events.
fn query(app: &AppHandle, args: Vec<String>) -> Result<Vec<Value>, String> {
    let out = engine(app)?
        .args(&args)
        .arg("--json")
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

#[tauri::command]
async fn list_devices(app: AppHandle) -> Result<Vec<Value>, String> {
    blocking(move || query(&app, vec!["--devices".into()])).await?
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

/// Native picker for files or folders on this computer.
#[tauri::command]
async fn pick_local(app: AppHandle, folders: bool, multiple: bool) -> Result<Vec<String>, String> {
    blocking(move || {
        let dialog = app.dialog().file();
        let picked = match (folders, multiple) {
            (true, true) => dialog.blocking_pick_folders().unwrap_or_default(),
            (true, false) => dialog.blocking_pick_folder().into_iter().collect(),
            (false, _) => dialog.blocking_pick_files().unwrap_or_default(),
        };
        picked
            .into_iter()
            .filter_map(|p| p.into_path().ok())
            .map(|p| p.display().to_string())
            .collect()
    })
    .await
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
        .plugin(tauri_plugin_dialog::init())
        .manage(Running::default())
        .manage(Measuring::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(drag) = event {
                match drag {
                    tauri::DragDropEvent::Enter { .. } => {
                        let _ = window.emit("drag-hover", true);
                    }
                    tauri::DragDropEvent::Leave => {
                        let _ = window.emit("drag-hover", false);
                    }
                    tauri::DragDropEvent::Drop { paths, .. } => {
                        let _ = window.emit("drag-hover", false);
                        let paths: Vec<String> = paths.iter().map(|p| p.display().to_string()).collect();
                        let _ = window.emit("files-dropped", paths);
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_devices,
            list_dir,
            show_profile,
            measure,
            load_settings,
            save_settings,
            pick_local,
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
