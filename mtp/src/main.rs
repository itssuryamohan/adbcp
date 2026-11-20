//! adbcp-mtp: the MTP back end of adbcp as a command-line tool. It prints one JSON
//! event per line, like `adbcp --json`. See lib.rs.

use adbcp_mtp::{CopyRequest, Emit};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

const USAGE: &str = "usage: adbcp-mtp devices
       adbcp-mtp ls SERIAL PATH
       adbcp-mtp mkdir SERIAL PATH
       adbcp-mtp rename SERIAL OLD NEW
       adbcp-mtp delete SERIAL PATH...
       adbcp-mtp push SERIAL [--verify] [--skip-existing] [--fix-names] SRC... DEST
       adbcp-mtp pull SERIAL [--verify] [--skip-existing] SRC... DEST

Phone paths start with /sdcard (the phone's internal storage). The phone must be
connected by USB and set to \"File transfer\". It needs no USB debugging.
Prints one JSON event per line. Result codes: 0 done, 1 failed, 2 usage, 130 cancelled.";

fn print(v: &Value) {
    println!("{v}");
}

fn usage() -> ! {
    eprintln!("{USAGE}");
    std::process::exit(2)
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = args.first().map(String::as_str) else { usage() };
    if cmd == "-h" || cmd == "--help" {
        println!("{USAGE}");
        return;
    }
    if cmd == "devices" {
        for d in adbcp_mtp::devices(&[]).await {
            print(&d);
        }
        return;
    }
    let Some(serial) = args.get(1).cloned() else { usage() };
    let rest = &args[2..];
    let result: Result<(), String> = match cmd {
        "ls" if rest.len() == 1 => adbcp_mtp::ls(&serial, &rest[0]).await.map(|v| v.iter().for_each(print)),
        "mkdir" if rest.len() == 1 => adbcp_mtp::mkdir(&serial, &rest[0]).await,
        "rename" if rest.len() == 2 => adbcp_mtp::rename(&serial, &rest[0], &rest[1]).await,
        "delete" if !rest.is_empty() => adbcp_mtp::delete(&serial, rest).await,
        "push" | "pull" => {
            let mut req = CopyRequest {
                serial, pull: cmd == "pull", sources: vec![], dest: String::new(),
                verify: false, skip_existing: false, fix_names: false,
            };
            let mut paths = vec![];
            for a in rest {
                match a.as_str() {
                    "--verify" => req.verify = true,
                    "--skip-existing" => req.skip_existing = true,
                    "--fix-names" => req.fix_names = true,
                    s if s.starts_with("--") => usage(),
                    s => paths.push(s.to_string()),
                }
            }
            if paths.len() < 2 {
                usage();
            }
            req.dest = paths.pop().unwrap();
            req.sources = paths;
            let cancel = Arc::new(AtomicBool::new(false));
            let c2 = Arc::clone(&cancel);
            tokio::spawn(async move {
                if tokio::signal::ctrl_c().await.is_ok() {
                    c2.store(true, Ordering::Relaxed);
                }
            });
            let emit: Emit = Arc::new(|v| print(&v));
            let code = adbcp_mtp::copy(req, emit, cancel).await;
            std::process::exit(code);
        }
        _ => usage(),
    };
    match result {
        Ok(()) => {
            if cmd != "ls" {
                print(&json!({"event": "op_done", "op": cmd, "count": rest.len()}));
            }
        }
        Err(e) => {
            print(&json!({"event": "error", "message": e}));
            std::process::exit(1);
        }
    }
}
