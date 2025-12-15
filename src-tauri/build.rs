use std::{env, fs, path::PathBuf};

fn main() {
    // Make the default agent bundle always available at compile time.
    // We copy the JS bundle if present; otherwise we write a sentinel so runtime can error nicely.
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR is not set"));
    let out_path = out_dir.join("carf_default_agent.js");

    // NOTE: build.rs runs with CWD = src-tauri crate root.
    let source_path = PathBuf::from("..").join("src-frida").join("dist").join("index.js");

    println!("cargo:rerun-if-changed={}", source_path.display());

    match fs::read(&source_path) {
        Ok(bytes) => {
            let _ = fs::write(&out_path, bytes);
        }
        Err(_) => {
            let _ = fs::write(
                &out_path,
                "// __CARF_AGENT_MISSING__\n// Run: bun run compile\n",
            );
        }
    }

    tauri_build::build()
}
