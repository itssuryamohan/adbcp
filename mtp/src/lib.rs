//! MTP back end for adbcp: copies files to and from an Android phone in its normal
//! "File transfer" USB mode, without Developer options or USB debugging.
//!
//! It reports the same JSON events as the adbcp engine (`device`, `entry`, `start`, `skip`,
//! `plan`, `progress`, `file_failed`, `renamed`, `done`, `verify_start`, `verify_problem`,
//! `verify_done`, `error`), so the desktop app shows MTP copies like adb copies.
//!
//! MTP allows one operation at a time, has no compression, and costs a few round trips
//! per file. It is slower than adb (see docs/engine-spec.md), but needs nothing on the phone.
//!
//! Phone paths use the same form as the engine: `/sdcard/...` (or `/storage/emulated/0/...`)
//! is the phone's internal storage. Other storages (SD cards) are not reachable yet.

use mtp_rs::{ByteRange, DateTime, MtpDevice, NewObjectInfo, ObjectHandle, ObjectInfo, Storage};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::ops::ControlFlow;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use tokio_util::io::ReaderStream;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Receives each event as it happens.
pub type Emit = Arc<dyn Fn(Value) + Send + Sync>;

/// Characters Android's shared storage refuses in names.
const BAD_CHARS: &[char] = &['"', '*', ':', '<', '>', '?', '|', '\\'];
const PART: &str = ".adbcp-part";

// ------------------------------------------------------------------- sessions ---

/// An open MTP session with one phone. MTP allows one session per phone, so every
/// operation on a phone shares it.
struct Phone {
    _device: MtpDevice,
    storage: Storage,
    model: String,
}

fn phones() -> &'static Mutex<HashMap<String, Arc<Phone>>> {
    static PHONES: OnceLock<Mutex<HashMap<String, Arc<Phone>>>> = OnceLock::new();
    PHONES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn explain(e: &mtp_rs::Error) -> String {
    if e.is_exclusive_access() {
        "on a Mac this is usually the photo service (ptpcamerad) or Android File Transfer. \
         Quit Android File Transfer, or run `pkill -9 ptpcamerad` in Terminal, then press Refresh"
            .into()
    } else if e.is_disconnected() {
        "the phone was disconnected".into()
    } else {
        e.to_string()
    }
}

async fn phone(serial: &str) -> Result<Arc<Phone>, String> {
    let mut map = phones().lock().await;
    if let Some(p) = map.get(serial) {
        return Ok(Arc::clone(p));
    }
    let device = MtpDevice::open_by_serial(serial).await.map_err(|e| explain(&e))?;
    let model = device.device_info().model.clone();
    let mut storages = device.storages().await.map_err(|e| explain(&e))?;
    if storages.is_empty() {
        return Err("the phone shows no storage: unlock it and choose \"File transfer\" \
                    in its USB settings"
            .into());
    }
    let storage = storages.remove(0);
    let p = Arc::new(Phone { _device: device, storage, model });
    map.insert(serial.to_string(), Arc::clone(&p));
    Ok(p)
}

/// Closes the session with a phone, for example after an error or when adb takes over.
pub async fn forget(serial: &str) {
    phones().lock().await.remove(serial);
}

/// Phones in MTP mode, as `device` events, except the serials in `skip` (phones that adb
/// already reaches). A phone that another program holds is reported with state "busy".
pub async fn devices(skip: &[String]) -> Vec<Value> {
    let list = match MtpDevice::list_devices() {
        Ok(l) => l,
        Err(_) => return vec![],
    };
    let seen: HashSet<String> = list.iter().filter_map(|i| i.serial_number.clone()).collect();
    phones().lock().await.retain(|s, _| seen.contains(s) && !skip.contains(s));
    let mut out = vec![];
    for info in list {
        let Some(serial) = info.serial_number.clone() else { continue };
        if skip.contains(&serial) {
            continue;
        }
        match phone(&serial).await {
            Ok(p) => out.push(json!({
                "event": "device", "serial": serial, "state": "device", "model": p.model,
                "connection": "mtp", "link_mbps": null,
            })),
            Err(e) => out.push(json!({
                "event": "device", "serial": serial, "state": "busy",
                "model": info.product.clone().unwrap_or_default(),
                "connection": "mtp", "link_mbps": null, "message": e,
            })),
        }
    }
    out
}

// ---------------------------------------------------------------------- paths ---

/// The components of a phone path below the internal storage: "/sdcard/DCIM/x" -> [DCIM, x].
fn rel(path: &str) -> Result<Vec<String>, String> {
    let p = path.trim_end_matches('/');
    let mut rest = None;
    for root in ["/sdcard", "/storage/emulated/0", "/storage/self/primary"] {
        if p == root {
            rest = Some("");
        } else if let Some(r) = p.strip_prefix(root).and_then(|r| r.strip_prefix('/')) {
            rest = Some(r);
        }
    }
    let rest = rest.ok_or_else(|| {
        format!("over MTP only the internal storage (/sdcard) is reachable, not {path}")
    })?;
    let comps: Vec<String> = rest.split('/').filter(|c| !c.is_empty()).map(String::from).collect();
    if comps.iter().any(|c| c == "." || c == "..") {
        return Err(format!("not a valid path: {path}"));
    }
    Ok(comps)
}

fn join(base: &str, name: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), name)
}

/// Storage roots and standard folders that the app refuses to delete or rename, the same
/// list as the engine's protected_path.
fn protected(path: &str) -> bool {
    let p = path.trim_end_matches('/');
    let Ok(comps) = rel(p) else { return true };
    match comps.len() {
        0 => true,
        1 => matches!(
            comps[0].as_str(),
            "Android" | "DCIM" | "Download" | "Pictures" | "Movies" | "Music" | "Documents"
                | "Alarms" | "Notifications" | "Podcasts" | "Ringtones" | "Audiobooks"
                | "Recordings"
        ),
        2 => comps[0] == "Android" && (comps[1] == "data" || comps[1] == "obb"),
        _ => false,
    }
}

// ------------------------------------------------------------------- listing ---

async fn children(st: &Storage, parent: Option<ObjectHandle>) -> Result<Vec<ObjectInfo>, String> {
    st.list_objects(parent).await.map_err(|e| explain(&e))
}

/// The object at `comps`: `Some(None)` for the storage root, `None` if it does not exist.
async fn find(st: &Storage, comps: &[String]) -> Result<Option<Option<ObjectInfo>>, String> {
    let mut cur: Option<ObjectInfo> = None;
    for c in comps {
        if let Some(o) = &cur {
            if !o.is_folder() {
                return Ok(None);
            }
        }
        let parent = cur.as_ref().map(|o| o.handle);
        match children(st, parent).await?.into_iter().find(|o| &o.filename == c) {
            Some(o) => cur = Some(o),
            None => return Ok(None),
        }
    }
    Ok(Some(cur))
}

/// The folder at `comps`, creating missing folders like `mkdir -p`.
async fn ensure_dir(
    st: &Storage,
    comps: &[String],
    cache: &mut HashMap<Vec<String>, Option<ObjectHandle>>,
) -> Result<Option<ObjectHandle>, String> {
    if let Some(h) = cache.get(comps) {
        return Ok(*h);
    }
    let mut parent: Option<ObjectHandle> = None;
    for i in 0..comps.len() {
        let prefix = comps[..=i].to_vec();
        if let Some(h) = cache.get(&prefix) {
            parent = *h;
            continue;
        }
        let name = &comps[i];
        let found = children(st, parent).await?.into_iter().find(|o| &o.filename == name);
        let h = match found {
            Some(o) if o.is_folder() => o.handle,
            Some(_) => return Err(format!("{} is a file, not a folder", comps[..=i].join("/"))),
            None => st.create_folder(parent, name).await.map_err(|e| explain(&e))?,
        };
        cache.insert(prefix, Some(h));
        parent = Some(h);
    }
    cache.insert(comps.to_vec(), parent);
    Ok(parent)
}

/// Seconds since 1970 for a date the phone wrote (local time when it wrote no offset).
fn unix(dt: &Option<DateTime>) -> i64 {
    let Some(d) = dt else { return 0 };
    if let Some(s) = d.to_unix_seconds() {
        return s;
    }
    // SAFETY: mktime only reads and normalizes the struct we pass.
    unsafe {
        let mut tm: libc::tm = std::mem::zeroed();
        tm.tm_year = d.year as i32 - 1900;
        tm.tm_mon = d.month as i32 - 1;
        tm.tm_mday = d.day as i32;
        tm.tm_hour = d.hour as i32;
        tm.tm_min = d.minute as i32;
        tm.tm_sec = d.second as i32;
        tm.tm_isdst = -1;
        libc::mktime(&mut tm) as i64
    }
}

fn set_mtime(path: &Path, secs: i64) {
    if secs <= 0 {
        return;
    }
    let Ok(c) = std::ffi::CString::new(path.as_os_str().as_encoded_bytes()) else { return };
    let t = libc::timeval { tv_sec: secs as libc::time_t, tv_usec: 0 };
    let times = [t, t];
    // SAFETY: a valid C string and two timevals, as utimes expects.
    unsafe { libc::utimes(c.as_ptr(), times.as_ptr()) };
}

/// One folder on the phone, as `entry` events (the engine's `--ls`).
pub async fn ls(serial: &str, path: &str) -> Result<Vec<Value>, String> {
    let p = phone(serial).await?;
    let node = find(&p.storage, &rel(path)?)
        .await?
        .ok_or_else(|| format!("not found on the phone: {path}"))?;
    if let Some(o) = &node {
        if !o.is_folder() {
            return Err(format!("not a folder: {path}"));
        }
    }
    let base = path.trim_end_matches('/');
    let base = if base.is_empty() { "/sdcard" } else { base };
    Ok(children(&p.storage, node.map(|o| o.handle))
        .await?
        .into_iter()
        .map(|o| {
            json!({
                "event": "entry", "name": o.filename, "path": join(base, &o.filename),
                "type": if o.is_folder() { "dir" } else { "file" },
                "size": if o.is_folder() { 0 } else { o.size }, "mtime": unix(&o.modified),
            })
        })
        .collect())
}

// ------------------------------------------------------------ file operations ---

fn check_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains('/') || name.chars().any(|c| BAD_CHARS.contains(&c)) {
        return Err(format!("the phone does not allow this name: {name}"));
    }
    Ok(())
}

fn split_last(path: &str) -> Result<(Vec<String>, String), String> {
    let mut comps = rel(path)?;
    let name = comps.pop().ok_or_else(|| format!("not a valid path: {path}"))?;
    Ok((comps, name))
}

/// Makes a folder (the engine's `--mkdir`). The parent folder must exist.
pub async fn mkdir(serial: &str, path: &str) -> Result<(), String> {
    let p = phone(serial).await?;
    let (parent, name) = split_last(path)?;
    check_name(&name)?;
    let parent = match find(&p.storage, &parent).await? {
        Some(Some(o)) if o.is_folder() => Some(o.handle),
        Some(None) => None,
        _ => return Err(format!("the folder for {path} does not exist")),
    };
    if children(&p.storage, parent).await?.iter().any(|o| o.filename == name) {
        return Err(format!("already exists: {path}"));
    }
    p.storage.create_folder(parent, &name).await.map_err(|e| explain(&e))?;
    Ok(())
}

/// Renames or moves `old` to `new` (the engine's `--rename`). It never replaces anything.
pub async fn rename(serial: &str, old: &str, new: &str) -> Result<(), String> {
    if protected(old) {
        return Err(format!("refusing to rename {old}"));
    }
    let p = phone(serial).await?;
    let st = &p.storage;
    let obj = match find(st, &rel(old)?).await? {
        Some(Some(o)) => o,
        _ => return Err(format!("not found on the phone: {old}")),
    };
    let (new_parent, new_name) = split_last(new)?;
    check_name(&new_name)?;
    let parent = match find(st, &new_parent).await? {
        Some(Some(o)) if o.is_folder() => Some(o.handle),
        Some(None) => None,
        _ => return Err(format!("the folder for {new} does not exist")),
    };
    if children(st, parent).await?.iter().any(|o| o.filename == new_name) {
        return Err(format!("already exists: {new}"));
    }
    let old_parent = (obj.parent != ObjectHandle::ROOT).then_some(obj.parent);
    if old_parent != parent {
        st.move_object(obj.handle, parent.unwrap_or(ObjectHandle::ROOT), None)
            .await
            .map_err(|e| explain(&e))?;
    }
    if obj.filename != new_name {
        st.rename(obj.handle, &new_name).await.map_err(|e| explain(&e))?;
    }
    Ok(())
}

async fn delete_tree(st: &Storage, o: ObjectInfo) -> Result<(), String> {
    if o.is_folder() {
        for c in children(st, Some(o.handle)).await? {
            Box::pin(delete_tree(st, c)).await?;
        }
    }
    st.delete(o.handle).await.map_err(|e| explain(&e))
}

/// Deletes files and folders permanently (the engine's `--delete`). Storage roots and
/// standard folders are refused before anything is deleted.
pub async fn delete(serial: &str, paths: &[String]) -> Result<(), String> {
    if let Some(p) = paths.iter().find(|p| protected(p)) {
        return Err(format!("refusing to delete {p} (a storage root or standard folder)"));
    }
    let p = phone(serial).await?;
    for path in paths {
        match find(&p.storage, &rel(path)?).await? {
            Some(Some(o)) => delete_tree(&p.storage, o).await?,
            _ => return Err(format!("not found on the phone: {path}")),
        }
    }
    Ok(())
}

// --------------------------------------------------------------------- copies ---

pub struct CopyRequest {
    pub serial: String,
    /// Phone to Mac. Otherwise Mac to phone.
    pub pull: bool,
    pub sources: Vec<String>,
    /// The destination folder.
    pub dest: String,
    /// Compare sizes after the copy. MTP gives no checksums on the phone.
    pub verify: bool,
    pub skip_existing: bool,
    pub fix_names: bool,
}

/// What the progress reports read while a copy runs.
#[derive(Default)]
struct Counters {
    done_bytes: AtomicU64,
    inflight: AtomicU64,
    files_done: AtomicU64,
    files_failed: AtomicU64,
}

fn progress_ticker(
    emit: Emit,
    c: Arc<Counters>,
    total_bytes: u64,
    total_files: u64,
    stop: Arc<AtomicBool>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let t0 = Instant::now();
        let (mut last_t, mut last_b, mut rate) = (0f64, 0u64, 0f64);
        while !stop.load(Ordering::Relaxed) {
            tokio::time::sleep(Duration::from_millis(1000)).await;
            let t = t0.elapsed().as_secs_f64();
            let b = (c.done_bytes.load(Ordering::Relaxed) + c.inflight.load(Ordering::Relaxed))
                .min(total_bytes);
            let now = (b - last_b.min(b)) as f64 / (t - last_t).max(0.001);
            rate = if rate == 0.0 { now } else { 0.8 * rate + 0.2 * now };
            (last_t, last_b) = (t, b);
            let left = if rate > 1.0 { json!(((total_bytes - b) as f64 / rate).round()) } else { json!(null) };
            emit(json!({
                "event": "progress", "bytes_done": b, "bytes_total": total_bytes,
                "files_done": c.files_done.load(Ordering::Relaxed), "files_total": total_files,
                "files_failed": c.files_failed.load(Ordering::Relaxed),
                "bytes_per_second": rate.round(), "seconds_left": left,
                "seconds_elapsed": (t * 10.0).round() / 10.0,
            }));
        }
    })
}

fn fail(emit: &Emit, c: &Counters, path: &str, reason: &str, error: &str) {
    c.files_failed.fetch_add(1, Ordering::Relaxed);
    emit(json!({"event": "file_failed", "path": path, "reason": reason, "error": error}));
}

/// Replaces characters the phone does not allow with `_`, adding _2, _3 ... before the
/// extension when the new name is already taken.
fn safe_name(name: &str, taken: &HashSet<String>) -> String {
    let base: String = name.chars().map(|c| if BAD_CHARS.contains(&c) { '_' } else { c }).collect();
    if !taken.contains(&base) {
        return base;
    }
    let (stem, ext) = match base.rfind('.') {
        Some(i) if i > 0 => (&base[..i], &base[i..]),
        _ => (base.as_str(), ""),
    };
    (2..).map(|n| format!("{stem}_{n}{ext}")).find(|c| !taken.contains(c)).unwrap()
}

/// Runs a copy and returns the result code: 0 all copied (and verified), 1 some files
/// failed, 130 cancelled.
pub async fn copy(req: CopyRequest, emit: Emit, cancel: Arc<AtomicBool>) -> i32 {
    let res = if req.pull { pull(&req, &emit, &cancel).await } else { push(&req, &emit, &cancel).await };
    match res {
        Ok(code) => code,
        Err(e) if cancel.load(Ordering::Relaxed) => {
            let _ = e;
            emit(json!({"event": "error", "message": "interrupted"}));
            130
        }
        Err(e) => {
            if e.contains("disconnected") {
                forget(&req.serial).await;
            }
            emit(json!({"event": "error", "message": e}));
            1
        }
    }
}

struct Item {
    local: PathBuf,
    rel: Vec<String>,
    size: u64,
}

/// Files and folders under the Mac sources, with paths relative to the destination.
fn walk_local(sources: &[String]) -> Result<(Vec<Item>, Vec<Vec<String>>), String> {
    fn skip(name: &str) -> bool {
        name == ".DS_Store" || name.starts_with("._")
    }
    fn visit(dir: &Path, rel: &[String], items: &mut Vec<Item>, dirs: &mut Vec<Vec<String>>) -> Result<(), String> {
        let mut entries: Vec<_> = std::fs::read_dir(dir)
            .map_err(|e| format!("{}: {e}", dir.display()))?
            .filter_map(|e| e.ok())
            .collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().to_string();
            if skip(&name) {
                continue;
            }
            let path = e.path();
            let meta = std::fs::metadata(&path).map_err(|e| format!("{}: {e}", path.display()))?;
            let mut r = rel.to_vec();
            r.push(name);
            if meta.is_dir() {
                dirs.push(r.clone());
                visit(&path, &r, items, dirs)?;
            } else if meta.is_file() {
                items.push(Item { local: path, rel: r, size: meta.len() });
            }
        }
        Ok(())
    }
    let (mut items, mut dirs) = (vec![], vec![]);
    for s in sources {
        let path = PathBuf::from(s);
        let meta = std::fs::metadata(&path).map_err(|_| format!("no such file or directory: {s}"))?;
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if meta.is_dir() {
            dirs.push(vec![name.clone()]);
            visit(&path, &[name], &mut items, &mut dirs)?;
        } else {
            items.push(Item { local: path, rel: vec![name], size: meta.len() });
        }
    }
    Ok((items, dirs))
}

fn plan_event(files: usize) -> Value {
    json!({
        "event": "plan", "tuning": "MTP (no USB debugging): one transfer at a time",
        "compression": "none", "large_files": files, "large_jobs": files, "streams": 1,
        "split_files": 0, "small_files": 0, "small_jobs": 0, "small_streams": 0, "dry_run": 0,
    })
}

fn done_event(copied: u64, failed: u64, bytes: u64, secs: f64) -> Value {
    json!({
        "event": "done", "files_copied": copied, "files_failed": failed, "bytes": bytes,
        "seconds": (secs * 10.0).round() / 10.0,
        "bytes_per_second": if secs > 0.0 { (bytes as f64 / secs).round() } else { 0.0 },
    })
}

async fn push(req: &CopyRequest, emit: &Emit, cancel: &Arc<AtomicBool>) -> Result<i32, String> {
    let p = phone(&req.serial).await?;
    let st = &p.storage;
    let dest_comps = rel(&req.dest)?;
    let dest_base = format!("/sdcard/{}", dest_comps.join("/"));
    let dest_base = dest_base.trim_end_matches('/').to_string();
    let (mut items, dirs) = walk_local(&req.sources)?;
    if items.is_empty() && dirs.is_empty() {
        return Err("nothing to copy".into());
    }
    let total_files = items.len() as u64;
    let total_bytes: u64 = items.iter().map(|i| i.size).sum();
    emit(json!({
        "event": "start", "version": VERSION, "serial": req.serial, "model": p.model,
        "connection": "mtp", "link_mbps": null, "direction": "to_phone",
        "destination": dest_base, "files": total_files, "bytes": total_bytes,
    }));
    let c = Arc::new(Counters::default());

    // Names the phone does not allow: fix them, or leave the files out and report them.
    let mut fixed: HashMap<Vec<String>, String> = HashMap::new();
    let mut taken: HashMap<Vec<String>, HashSet<String>> = HashMap::new();
    for r in dirs.iter().chain(items.iter().map(|i| &i.rel)) {
        for k in 0..r.len() {
            taken.entry(r[..k].to_vec()).or_default().insert(r[k].clone());
        }
    }
    let mut keep = Vec::with_capacity(items.len());
    let mut bad = 0u64;
    let mut map_rel = |r: &[String], fixed: &mut HashMap<Vec<String>, String>| -> Vec<String> {
        (0..r.len())
            .map(|k| {
                let key = r[..=k].to_vec();
                if let Some(f) = fixed.get(&key) {
                    return f.clone();
                }
                if !r[k].chars().any(|ch| BAD_CHARS.contains(&ch)) {
                    return r[k].clone();
                }
                let set = taken.entry(r[..k].to_vec()).or_default();
                let f = safe_name(&r[k], set);
                set.insert(f.clone());
                fixed.insert(key, f.clone());
                f
            })
            .collect()
    };
    for mut it in items.drain(..) {
        let has_bad = it.rel.iter().any(|n| n.chars().any(|ch| BAD_CHARS.contains(&ch)));
        if has_bad && !req.fix_names {
            bad += 1;
            fail(emit, &c, &join(&dest_base, &it.rel.join("/")), "name_not_allowed",
                 "the phone does not allow \" * : < > ? | \\ in names");
            continue;
        }
        if has_bad {
            let new_rel = map_rel(&it.rel, &mut fixed);
            emit(json!({"event": "renamed", "from": join(&dest_base, &it.rel.join("/")),
                        "to": join(&dest_base, &new_rel.join("/"))}));
            it.rel = new_rel;
        }
        keep.push(it);
    }
    let dirs: Vec<Vec<String>> = dirs.iter().map(|d| map_rel(d, &mut fixed)).collect();

    let mut dircache: HashMap<Vec<String>, Option<ObjectHandle>> = HashMap::new();
    let root = ensure_dir(st, &dest_comps, &mut dircache).await?;
    let _ = root;
    // Each destination folder is listed once, before anything is written into it.
    let mut listings: HashMap<Vec<String>, HashMap<String, ObjectInfo>> = HashMap::new();
    async fn listing<'a>(
        st: &Storage,
        dir: &[String],
        cache: &mut HashMap<Vec<String>, Option<ObjectHandle>>,
        listings: &'a mut HashMap<Vec<String>, HashMap<String, ObjectInfo>>,
        create: bool,
    ) -> Result<Option<&'a HashMap<String, ObjectInfo>>, String> {
        if !listings.contains_key(dir) {
            let handle = if create {
                ensure_dir(st, dir, cache).await?
            } else {
                match find(st, dir).await? {
                    Some(Some(o)) if o.is_folder() => Some(o.handle),
                    Some(None) => None,
                    _ => return Ok(None),
                }
            };
            cache.insert(dir.to_vec(), handle);
            let objs = children(st, handle).await?;
            listings.insert(dir.to_vec(), objs.into_iter().map(|o| (o.filename.clone(), o)).collect());
        }
        Ok(listings.get(dir))
    }

    if req.skip_existing {
        let before = keep.len();
        let mut skipped_bytes = 0u64;
        let mut rest = Vec::with_capacity(keep.len());
        for it in keep {
            let mut dir = dest_comps.clone();
            dir.extend_from_slice(&it.rel[..it.rel.len() - 1]);
            let same = listing(st, &dir, &mut dircache, &mut listings, false)
                .await?
                .and_then(|l| l.get(it.rel.last().unwrap()))
                .is_some_and(|o| !o.is_folder() && o.size == it.size);
            if same { skipped_bytes += it.size } else { rest.push(it) }
        }
        keep = rest;
        if keep.len() != before {
            emit(json!({"event": "skip", "files": before - keep.len(), "bytes": skipped_bytes}));
        }
        listings.clear();
    }
    emit(plan_event(keep.len()));
    for d in &dirs {
        let mut full = dest_comps.clone();
        full.extend_from_slice(d);
        ensure_dir(st, &full, &mut dircache).await?;
    }

    let bytes_todo: u64 = keep.iter().map(|i| i.size).sum();
    let stop = Arc::new(AtomicBool::new(false));
    let ticker = progress_ticker(Arc::clone(emit), Arc::clone(&c), bytes_todo, keep.len() as u64, Arc::clone(&stop));
    let t0 = Instant::now();
    let mut copied: Vec<(ObjectHandle, u64, String)> = vec![];
    let mut cancelled = false;
    for it in &keep {
        if cancel.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }
        let mut dir = dest_comps.clone();
        dir.extend_from_slice(&it.rel[..it.rel.len() - 1]);
        let name = it.rel.last().unwrap().clone();
        let dest_path = join(&dest_base, &it.rel.join("/"));
        let (parent, existing, stale_part) = {
            let l = listing(st, &dir, &mut dircache, &mut listings, true).await?.unwrap();
            (dircache.get(&dir).copied().flatten(), l.get(&name).cloned(), l.get(&format!("{name}{PART}")).cloned())
        };
        if let Some(o) = &existing {
            if o.is_folder() {
                fail(emit, &c, &dest_path, "copy_failed", "a folder with this name exists");
                continue;
            }
        }
        if let Some(o) = stale_part {
            let _ = st.delete(o.handle).await;
        }
        // A file that replaces another is written under a temporary name first, so the old
        // one stays until the new one is complete.
        let up_name = if existing.is_some() { format!("{name}{PART}") } else { name.clone() };
        let file = match tokio::fs::File::open(&it.local).await {
            Ok(f) => f,
            Err(e) => {
                fail(emit, &c, &dest_path, "copy_failed", &e.to_string());
                continue;
            }
        };
        let stream = ReaderStream::with_capacity(file, 1 << 20);
        let (inflight, stop_now) = (Arc::clone(&c), Arc::clone(cancel));
        c.inflight.store(0, Ordering::Relaxed);
        let r = st
            .upload_with_progress(parent, NewObjectInfo::file(&up_name, it.size), stream, move |pr| {
                inflight.inflight.store(pr.bytes_transferred, Ordering::Relaxed);
                if stop_now.load(Ordering::Relaxed) { ControlFlow::Break(()) } else { ControlFlow::Continue(()) }
            })
            .await;
        c.inflight.store(0, Ordering::Relaxed);
        match r {
            Ok(h) => {
                if let Some(old) = &existing {
                    let swapped = async {
                        st.delete(old.handle).await.map_err(|e| explain(&e))?;
                        st.rename(h, &name).await.map_err(|e| explain(&e))
                    }
                    .await;
                    if let Err(e) = swapped {
                        fail(emit, &c, &dest_path, "assemble_failed", &e);
                        continue;
                    }
                }
                c.done_bytes.fetch_add(it.size, Ordering::Relaxed);
                c.files_done.fetch_add(1, Ordering::Relaxed);
                copied.push((h, it.size, dest_path));
            }
            Err(e) => {
                if let Some(h) = e.partial {
                    let _ = st.delete(h).await;
                }
                if cancel.load(Ordering::Relaxed) {
                    cancelled = true;
                    break;
                }
                if e.source.is_disconnected() {
                    stop.store(true, Ordering::Relaxed);
                    let _ = ticker.await;
                    return Err(explain(&e.source));
                }
                fail(emit, &c, &dest_path, "copy_failed", &explain(&e.source));
            }
        }
    }
    stop.store(true, Ordering::Relaxed);
    let _ = ticker.await;
    if cancelled {
        emit(json!({"event": "error", "message": "interrupted"}));
        return Ok(130);
    }
    let failed = c.files_failed.load(Ordering::Relaxed);
    emit(done_event(copied.len() as u64, failed, c.done_bytes.load(Ordering::Relaxed), t0.elapsed().as_secs_f64()));
    let _ = bad;
    let mut problems = 0;
    if req.verify {
        let tv = Instant::now();
        emit(json!({"event": "verify_start", "files": copied.len()}));
        for (h, size, path) in &copied {
            match st.get_object_info(*h).await {
                Ok(o) if o.size == *size => {}
                Ok(_) => { problems += 1; emit(json!({"event": "verify_problem", "problem": "different", "path": path})); }
                Err(_) => { problems += 1; emit(json!({"event": "verify_problem", "problem": "missing", "path": path})); }
            }
        }
        emit(json!({"event": "verify_done", "files": copied.len(), "problems": problems,
                    "seconds": (tv.elapsed().as_secs_f64() * 10.0).round() / 10.0, "method": "size"}));
    }
    Ok(if failed == 0 && problems == 0 { 0 } else { 1 })
}

struct Remote {
    handle: ObjectHandle,
    rel: Vec<String>,
    size: u64,
    mtime: i64,
}

async fn pull(req: &CopyRequest, emit: &Emit, cancel: &Arc<AtomicBool>) -> Result<i32, String> {
    let p = phone(&req.serial).await?;
    let st = &p.storage;
    let dest = PathBuf::from(&req.dest);
    let (mut items, mut dirs) = (Vec::<Remote>::new(), Vec::<Vec<String>>::new());
    for s in &req.sources {
        let obj = match find(st, &rel(s)?).await? {
            Some(Some(o)) => o,
            _ => return Err(format!("not found on the phone: {s}")),
        };
        if obj.is_folder() {
            let mut queue = vec![(obj.handle, vec![obj.filename.clone()])];
            dirs.push(vec![obj.filename.clone()]);
            while let Some((h, r)) = queue.pop() {
                for o in children(st, Some(h)).await? {
                    let mut rr = r.clone();
                    rr.push(o.filename.clone());
                    if o.is_folder() {
                        dirs.push(rr.clone());
                        queue.push((o.handle, rr));
                    } else {
                        items.push(Remote { handle: o.handle, rel: rr, size: o.size, mtime: unix(&o.modified) });
                    }
                }
            }
        } else {
            items.push(Remote { handle: obj.handle, rel: vec![obj.filename.clone()], size: obj.size, mtime: unix(&obj.modified) });
        }
    }
    items.sort_by(|a, b| a.rel.cmp(&b.rel));
    let total_files = items.len() as u64;
    let total_bytes: u64 = items.iter().map(|i| i.size).sum();
    emit(json!({
        "event": "start", "version": VERSION, "serial": req.serial, "model": p.model,
        "connection": "mtp", "link_mbps": null, "direction": "from_phone",
        "destination": req.dest, "files": total_files, "bytes": total_bytes,
    }));
    let local_of = |r: &[String]| r.iter().fold(dest.clone(), |acc, c| acc.join(c));
    if req.skip_existing {
        let before = items.len();
        let mut skipped = 0u64;
        items.retain(|it| {
            let same = std::fs::metadata(local_of(&it.rel)).is_ok_and(|m| m.is_file() && m.len() == it.size);
            if same { skipped += it.size }
            !same
        });
        if items.len() != before {
            emit(json!({"event": "skip", "files": before - items.len(), "bytes": skipped}));
        }
    }
    emit(plan_event(items.len()));
    for d in &dirs {
        std::fs::create_dir_all(local_of(d)).map_err(|e| format!("cannot create folders under {}: {e}", dest.display()))?;
    }
    std::fs::create_dir_all(&dest).map_err(|e| format!("cannot create {}: {e}", dest.display()))?;

    let c = Arc::new(Counters::default());
    let bytes_todo: u64 = items.iter().map(|i| i.size).sum();
    let stop = Arc::new(AtomicBool::new(false));
    let ticker = progress_ticker(Arc::clone(emit), Arc::clone(&c), bytes_todo, items.len() as u64, Arc::clone(&stop));
    let t0 = Instant::now();
    let mut copied: Vec<(PathBuf, u64)> = vec![];
    let mut cancelled = false;
    for it in &items {
        if cancel.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }
        let local = local_of(&it.rel);
        let tmp = PathBuf::from(format!("{}{PART}", local.display()));
        c.inflight.store(0, Ordering::Relaxed);
        let r: Result<(), String> = async {
            let mut dl = st.download(it.handle, ByteRange::Full).await.map_err(|e| explain(&e))?;
            let mut f = tokio::fs::File::create(&tmp).await.map_err(|e| e.to_string())?;
            let mut got = 0u64;
            while let Some(chunk) = dl.next_chunk().await {
                if cancel.load(Ordering::Relaxed) {
                    let _ = dl.cancel(Duration::from_secs(2)).await;
                    return Err("interrupted".into());
                }
                let chunk = chunk.map_err(|e| explain(&e))?;
                f.write_all(&chunk).await.map_err(|e| e.to_string())?;
                got += chunk.len() as u64;
                c.inflight.store(got, Ordering::Relaxed);
            }
            f.flush().await.map_err(|e| e.to_string())?;
            drop(f);
            if got != it.size {
                return Err(format!("received {got} of {} bytes", it.size));
            }
            tokio::fs::rename(&tmp, &local).await.map_err(|e| e.to_string())?;
            set_mtime(&local, it.mtime);
            Ok(())
        }
        .await;
        c.inflight.store(0, Ordering::Relaxed);
        match r {
            Ok(()) => {
                c.done_bytes.fetch_add(it.size, Ordering::Relaxed);
                c.files_done.fetch_add(1, Ordering::Relaxed);
                copied.push((local, it.size));
            }
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                if cancel.load(Ordering::Relaxed) {
                    cancelled = true;
                    break;
                }
                if e.contains("disconnected") {
                    stop.store(true, Ordering::Relaxed);
                    let _ = ticker.await;
                    return Err(e);
                }
                fail(emit, &c, &local.display().to_string(), "copy_failed", &e);
            }
        }
    }
    stop.store(true, Ordering::Relaxed);
    let _ = ticker.await;
    if cancelled {
        emit(json!({"event": "error", "message": "interrupted"}));
        return Ok(130);
    }
    let failed = c.files_failed.load(Ordering::Relaxed);
    emit(done_event(copied.len() as u64, failed, c.done_bytes.load(Ordering::Relaxed), t0.elapsed().as_secs_f64()));
    let mut problems = 0;
    if req.verify {
        let tv = Instant::now();
        emit(json!({"event": "verify_start", "files": copied.len()}));
        for (path, size) in &copied {
            match std::fs::metadata(path) {
                Ok(m) if m.len() == *size => {}
                Ok(_) => { problems += 1; emit(json!({"event": "verify_problem", "problem": "different", "path": path.display().to_string()})); }
                Err(_) => { problems += 1; emit(json!({"event": "verify_problem", "problem": "missing", "path": path.display().to_string()})); }
            }
        }
        emit(json!({"event": "verify_done", "files": copied.len(), "problems": problems,
                    "seconds": (tv.elapsed().as_secs_f64() * 10.0).round() / 10.0, "method": "size"}));
    }
    Ok(if failed == 0 && problems == 0 { 0 } else { 1 })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_map_to_internal_storage() {
        assert_eq!(rel("/sdcard").unwrap(), Vec::<String>::new());
        assert_eq!(rel("/sdcard/").unwrap(), Vec::<String>::new());
        assert_eq!(rel("/sdcard/DCIM/Camera").unwrap(), vec!["DCIM", "Camera"]);
        assert_eq!(rel("/storage/emulated/0/Download/").unwrap(), vec!["Download"]);
        assert!(rel("/data/local/tmp").is_err());
        assert!(rel("/sdcard/../etc").is_err());
        assert!(rel("/sdcardx/a").is_err());
    }

    #[test]
    fn protected_paths() {
        for p in ["/sdcard", "/sdcard/", "/sdcard/DCIM", "/sdcard/Download/", "/storage/emulated/0",
                  "/sdcard/Android/data", "/sdcard/Android", "/data/local/tmp", "/sdcard/../x"] {
            assert!(protected(p), "{p} should be protected");
        }
        for p in ["/sdcard/Download/x", "/sdcard/DCIM/Camera", "/sdcard/MyFolder", "/sdcard/Android/data/app"] {
            assert!(!protected(p), "{p} should be deletable");
        }
    }

    #[test]
    fn safe_names() {
        let taken: HashSet<String> = ["sound_effects.bnk".to_string()].into();
        assert_eq!(safe_name("a:b?.txt", &HashSet::new()), "a_b_.txt");
        assert_eq!(safe_name("sound:effects.bnk", &taken), "sound_effects_2.bnk");
    }
}
