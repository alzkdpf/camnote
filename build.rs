use std::{env, path::PathBuf, process::Command};

fn main() {
    println!("cargo:rerun-if-changed=src/camera_autofocus.m");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let out = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo output directory"));
        let object = out.join("camera_autofocus.o");
        let library = out.join("libcamnote_camera_autofocus.a");
        let arch = match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
            Ok("aarch64") => "arm64",
            Ok("x86_64") => "x86_64",
            _ => panic!("unsupported macOS target architecture"),
        };
        assert!(
            Command::new("xcrun")
                .args(["--sdk", "macosx", "clang", "-arch", arch, "-mmacosx-version-min=13.0",
                    "-fobjc-arc", "-c", "src/camera_autofocus.m", "-o"])
                .arg(&object).status().expect("compile camera controls").success()
        );
        assert!(
            Command::new("xcrun").args(["ar", "rcs"]).arg(&library).arg(&object)
                .status().expect("archive camera controls").success()
        );
        println!("cargo:rustc-link-search=native={}", out.display());
        println!("cargo:rustc-link-lib=static=camnote_camera_autofocus");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
    }
    tauri_build::build()
}
