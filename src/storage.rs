//! Version-independent storage and non-destructive legacy recovery.
use crate::core::{err, root, write_private};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Default, Serialize)]
pub struct Recovery {
    pub copied: usize,
    pub preserved: usize,
    pub already_done: bool,
}
#[derive(Serialize)]
pub struct Status {
    pub path: String,
    pub migrated: bool,
}
fn source_id(path: &Path) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for b in path.as_os_str().as_encoded_bytes() {
        hash = (hash ^ u64::from(*b)).wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}
fn regular(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_file())
}
fn files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !dir.exists() {
        return Ok(vec![]);
    }
    if fs::symlink_metadata(dir)
        .map_err(err)?
        .file_type()
        .is_symlink()
    {
        return Err("복구 폴더의 심볼릭 링크는 지원하지 않습니다".into());
    }
    let mut result = vec![];
    for entry in fs::read_dir(dir).map_err(err)? {
        let p = entry.map_err(err)?.path();
        if !regular(&p) {
            return Err("복구 폴더에는 일반 파일만 있어야 합니다".into());
        }
        result.push(p);
    }
    result.sort();
    Ok(result)
}
fn install(path: &Path, bytes: &[u8], report: &mut Recovery) -> Result<(), String> {
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(path.parent().ok_or("저장 폴더 없음")?)
        .map_err(err)?;
    if fs::symlink_metadata(path).is_ok() {
        if !regular(path) {
            return Err("복구 대상이 일반 파일이 아닙니다".into());
        }
        report.preserved += 1;
        return Ok(());
    }
    // Stage and fsync first, then atomically link into place without replacement.
    let tmp = path.parent().unwrap().join(format!(
        ".recovery-{}-{}.tmp",
        std::process::id(),
        jiff::Timestamp::now().as_nanosecond()
    ));
    let result = (|| {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(err)?;
        f.write_all(bytes).map_err(err)?;
        f.sync_all().map_err(err)?;
        fs::hard_link(&tmp, path).map_err(err)?;
        fs::File::open(path.parent().unwrap())
            .map_err(err)?
            .sync_all()
            .map_err(err)
    })();
    let _ = fs::remove_file(&tmp);
    result?;
    report.copied += 1;
    Ok(())
}
fn available(dir: &Path, name: &str, bytes: &[u8], id: &str) -> Result<String, String> {
    let p = dir.join(name);
    if !p.exists() {
        return Ok(name.into());
    }
    if regular(&p) && fs::read(&p).map_err(err)? == bytes {
        return Ok(name.into());
    }
    let stem = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("파일 이름 오류")?;
    let ext = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    for n in 0..10000 {
        let candidate = format!("{stem}-recovered-{id}-{n}.{ext}");
        let p = dir.join(&candidate);
        if !p.exists() || (regular(&p) && fs::read(&p).map_err(err)? == bytes) {
            return Ok(candidate);
        }
    }
    Err("복구 파일 이름을 만들 수 없습니다".into())
}
pub fn recover(source: &Path, dest: &Path) -> Result<Recovery, String> {
    let source = fs::canonicalize(source).map_err(err)?;
    let dest = fs::canonicalize(dest).map_err(err)?;
    if source == dest || source.starts_with(&dest) || dest.starts_with(&source) {
        return Err("현재 저장소 또는 그 하위·상위 폴더에서는 복구할 수 없습니다".into());
    }
    let scenes = files(&source.join("scenes"))?;
    let recordings = files(&source.join("recordings"))?;
    if recordings.is_empty()
        && !scenes.iter().any(|p| {
            matches!(
                p.extension().and_then(|s| s.to_str()),
                Some("png" | "jpg" | "jpeg")
            )
        })
    {
        return Err(
            "scenes 또는 recordings 폴더에 자료가 있는 CamNote 데이터 폴더를 선택하세요".into(),
        );
    }
    let id = source_id(&source);
    let marker = dest.join("recovery").join(&id).join("complete.json");
    if marker.exists() {
        return Ok(Recovery {
            already_done: true,
            ..Default::default()
        });
    }
    let mut report = Recovery::default();
    let generated = files(&source.join("generated"))?;
    // A complete, immutable copy of recoverable source files precedes merging.
    for (folder, list) in [("scenes", &scenes), ("generated", &generated)] {
        for p in list {
            install(
                &dest
                    .join("recovery")
                    .join(&id)
                    .join(folder)
                    .join(p.file_name().unwrap()),
                &fs::read(p).map_err(err)?,
                &mut report,
            )?;
        }
    }
    for p in &recordings {
        let name = p
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("파일 이름 오류")?;
        if p.extension().and_then(|s| s.to_str()) != Some("mp4") {
            continue;
        }
        let dir = dest.join("recordings");
        let mut target = dir.join(name);
        let mut n = 0;
        while fs::symlink_metadata(&target).is_ok() {
            target = dir.join(format!("recovered-{id}-{n}-{name}"));
            n += 1;
        }
        use std::os::unix::fs::DirBuilderExt;
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&dir)
            .map_err(err)?;
        crate::recording::copy_new(p, &target)?;
        report.copied += 1;
    }
    let mut names = BTreeMap::new();
    for p in &generated {
        let old = p
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("파일 이름 오류")?;
        let bytes = fs::read(p).map_err(err)?;
        let new = available(&dest.join("generated"), old, &bytes, &id)?;
        install(&dest.join("generated").join(&new), &bytes, &mut report)?;
        names.insert(old.to_owned(), new);
    }
    for photo in scenes.iter().filter(|p| {
        matches!(
            p.extension().and_then(|s| s.to_str()),
            Some("png" | "jpg" | "jpeg")
        )
    }) {
        let bytes = fs::read(photo).map_err(err)?;
        let old_name = photo
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("파일 이름 오류")?;
        // If any sidecar differs, recover the whole scene as a separate item.
        let stem = photo
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or("파일 이름 오류")?;
        let group: Vec<_> = scenes
            .iter()
            .filter(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(&format!("{stem}."))
            })
            .collect();
        let conflict = group.iter().any(|p| {
            let d = dest.join("scenes").join(p.file_name().unwrap());
            d.exists() && (!regular(&d) || fs::read(&d).ok() != fs::read(p).ok())
        });
        let new_name = if conflict {
            let mut chosen = None;
            for n in 0..10000 {
                let candidate = format!("{stem}-recovered-{id}-{n}");
                if group.iter().all(|p| {
                    let filename = p.file_name().unwrap().to_string_lossy();
                    fs::symlink_metadata(
                        dest.join("scenes")
                            .join(format!("{candidate}{}", &filename[stem.len()..])),
                    )
                    .is_err()
                }) {
                    chosen = Some(format!(
                        "{candidate}.{}",
                        photo.extension().unwrap().to_string_lossy()
                    ));
                    break;
                }
            }
            chosen.ok_or("장면 전체를 보존할 복구 이름을 만들 수 없습니다")?
        } else {
            available(&dest.join("scenes"), old_name, &bytes, &id)?
        };
        let new_stem = Path::new(&new_name).file_stem().unwrap().to_string_lossy();
        for p in group {
            let filename = p.file_name().unwrap().to_string_lossy();
            let suffix = &filename[stem.len()..];
            let target = dest.join("scenes").join(format!("{new_stem}{suffix}"));
            let mut data = fs::read(p).map_err(err)?;
            if suffix == ".generated-path" {
                let old = String::from_utf8(data.clone()).map_err(err)?;
                let old_path = Path::new(&old);
                if let Some(name) = old_path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .and_then(|n| names.get(n))
                {
                    // Use only a basename that was copied from this selected backup.
                    // The old absolute path may no longer exist after a folder move.
                    data = dest
                        .join("generated")
                        .join(name)
                        .to_string_lossy()
                        .as_bytes()
                        .to_vec();
                }
            } else if suffix == ".chat.json" {
                let mut h: serde_json::Value = serde_json::from_slice(&data).map_err(err)?;
                for key in ["messages", "revisions"] {
                    if let Some(items) = h[key].as_array_mut() {
                        for item in items {
                            let field = if key == "messages" { "revision" } else { "id" };
                            if let Some(new) = item[field].as_str().and_then(|n| names.get(n)) {
                                item[field] = new.clone().into();
                            }
                        }
                    }
                }
                if let Some(new) = h["active"].as_str().and_then(|n| names.get(n)) {
                    h["active"] = new.clone().into();
                }
                data = serde_json::to_vec_pretty(&h).map_err(err)?;
            }
            install(&target, &data, &mut report)?;
        }
    }
    let settings = source.join("settings.json");
    if regular(&settings) {
        let bytes = fs::read(&settings).map_err(err)?;
        serde_json::from_slice::<crate::core::Settings>(&bytes).map_err(err)?;
        install(
            &dest.join("recovery").join(&id).join("settings.json"),
            &bytes,
            &mut report,
        )?;
        install(&dest.join("settings.json"), &bytes, &mut report)?;
    }
    write_private(&marker, serde_json::to_vec_pretty(&report).map_err(err)?)?;
    Ok(report)
}
pub fn auto_recover() -> Result<(), String> {
    if std::env::var_os("CAMNOTE_DATA").is_some() {
        return Ok(());
    }
    if let Some(home) = std::env::var_os("HOME") {
        let legacy = PathBuf::from(home).join("Documents/CamNote/data");
        if files(&legacy.join("scenes"))?.iter().any(|p| {
            matches!(
                p.extension().and_then(|s| s.to_str()),
                Some("png" | "jpg" | "jpeg")
            )
        }) {
            recover(&legacy, &root())?;
        }
    }
    Ok(())
}
pub fn status() -> Status {
    Status {
        path: root().to_string_lossy().into_owned(),
        migrated: root().join("recovery").is_dir(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_preserves_versions_settings_and_survives_second_start() {
        let old = tempfile::tempdir().unwrap();
        let new = tempfile::tempdir().unwrap();
        fs::create_dir(old.path().join("scenes")).unwrap();
        fs::create_dir(old.path().join("generated")).unwrap();
        fs::write(old.path().join("scenes/scene.png"), b"original").unwrap();
        fs::write(old.path().join("scenes/scene.md"), b"note").unwrap();
        fs::write(old.path().join("generated/version.png"), b"edit").unwrap();
        fs::write(
            old.path().join("scenes/scene.generated-path"),
            old.path().join("generated/version.png").to_str().unwrap(),
        )
        .unwrap();
        fs::write(old.path().join("scenes/scene.chat.json"),br#"{"messages":[{"role":"user","content":"hello","revision":"version.png","error":false}],"revisions":[{"id":"version.png"}],"active":"version.png"}"#).unwrap();
        fs::write(old.path().join("settings.json"), b"{}").unwrap();
        recover(old.path(), new.path()).unwrap();
        assert_eq!(
            fs::read(new.path().join("scenes/scene.md")).unwrap(),
            b"note"
        );
        assert_eq!(
            fs::read_to_string(new.path().join("scenes/scene.generated-path")).unwrap(),
            fs::canonicalize(new.path())
                .unwrap()
                .join("generated/version.png")
                .to_str()
                .unwrap()
        );
        assert!(recover(old.path(), new.path()).unwrap().already_done);
        assert_eq!(
            fs::read(old.path().join("scenes/scene.png")).unwrap(),
            b"original"
        );
        assert!(new.path().join("settings.json").is_file());
    }
    #[test]
    fn migration_keeps_conflicting_photos_notes_and_revision_references() {
        let old = tempfile::tempdir().unwrap();
        let new = tempfile::tempdir().unwrap();
        for d in [old.path(), new.path()] {
            fs::create_dir(d.join("scenes")).unwrap();
            fs::create_dir(d.join("generated")).unwrap();
        }
        fs::write(old.path().join("scenes/s.png"), b"old").unwrap();
        fs::write(new.path().join("scenes/s.png"), b"new").unwrap();
        fs::write(old.path().join("scenes/s.md"), b"oldnote").unwrap();
        fs::write(new.path().join("scenes/s.md"), b"newnote").unwrap();
        fs::write(old.path().join("generated/v.png"), b"oldedit").unwrap();
        fs::write(new.path().join("generated/v.png"), b"newedit").unwrap();
        fs::write(
            old.path().join("scenes/s.chat.json"),
            br#"{"messages":[{"revision":"v.png"}],"revisions":[{"id":"v.png"}],"active":"v.png"}"#,
        )
        .unwrap();
        recover(old.path(), new.path()).unwrap();
        assert_eq!(fs::read(new.path().join("scenes/s.png")).unwrap(), b"new");
        assert_eq!(
            fs::read(new.path().join("scenes/s.md")).unwrap(),
            b"newnote"
        );
        let chat = files(&new.path().join("scenes"))
            .unwrap()
            .into_iter()
            .find(|p| p.to_string_lossy().ends_with(".chat.json"))
            .unwrap();
        let h: serde_json::Value = serde_json::from_slice(&fs::read(chat).unwrap()).unwrap();
        assert_ne!(h["active"], "v.png");
        assert_eq!(h["active"], h["messages"][0]["revision"]);
        assert_eq!(
            fs::read(
                new.path()
                    .join("generated")
                    .join(h["active"].as_str().unwrap())
            )
            .unwrap(),
            b"oldedit"
        );
    }
    #[test]
    fn migration_rejects_symlinks_without_marking_complete() {
        let old = tempfile::tempdir().unwrap();
        let new = tempfile::tempdir().unwrap();
        fs::create_dir(old.path().join("scenes")).unwrap();
        std::os::unix::fs::symlink("/etc/passwd", old.path().join("scenes/s.png")).unwrap();
        assert!(recover(old.path(), new.path()).is_err());
        assert!(!new.path().join("recovery").exists());
    }
    #[test]
    fn moved_backup_reconnects_generated_image_without_old_absolute_path() {
        let old = tempfile::tempdir().unwrap();
        let new = tempfile::tempdir().unwrap();
        fs::create_dir(old.path().join("scenes")).unwrap();
        fs::create_dir(old.path().join("generated")).unwrap();
        fs::write(old.path().join("scenes/s.png"), b"photo").unwrap();
        fs::write(old.path().join("generated/v.png"), b"edit").unwrap();
        fs::write(
            old.path().join("scenes/s.generated-path"),
            "/no-longer-present/old-install/generated/v.png",
        )
        .unwrap();
        recover(old.path(), new.path()).unwrap();
        let target = fs::read_to_string(new.path().join("scenes/s.generated-path")).unwrap();
        assert_eq!(fs::read(target).unwrap(), b"edit");
    }
    #[test]
    fn recovery_reserves_whole_group_when_orphan_note_already_exists() {
        let old = tempfile::tempdir().unwrap();
        let new = tempfile::tempdir().unwrap();
        fs::create_dir(old.path().join("scenes")).unwrap();
        fs::create_dir(new.path().join("scenes")).unwrap();
        fs::write(old.path().join("scenes/s.png"), b"old").unwrap();
        fs::write(old.path().join("scenes/s.md"), b"oldnote").unwrap();
        fs::write(new.path().join("scenes/s.png"), b"new").unwrap();
        let id = source_id(&fs::canonicalize(old.path()).unwrap());
        let orphan = new
            .path()
            .join("scenes")
            .join(format!("s-recovered-{id}-0.md"));
        fs::write(&orphan, b"orphan").unwrap();
        recover(old.path(), new.path()).unwrap();
        assert_eq!(fs::read(&orphan).unwrap(), b"orphan");
        assert_eq!(
            fs::read(
                new.path()
                    .join("scenes")
                    .join(format!("s-recovered-{id}-1.md"))
            )
            .unwrap(),
            b"oldnote"
        );
        assert_eq!(
            fs::read(
                new.path()
                    .join("scenes")
                    .join(format!("s-recovered-{id}-1.png"))
            )
            .unwrap(),
            b"old"
        );
    }
    #[test]
    fn video_only_backup_recovers_without_photos_and_remains_after_retry() {
        let old = tempfile::tempdir().unwrap();
        let new = tempfile::tempdir().unwrap();
        fs::create_dir(old.path().join("recordings")).unwrap();
        fs::write(old.path().join("recordings/v.mp4"), b"video").unwrap();
        recover(old.path(), new.path()).unwrap();
        assert_eq!(
            fs::read(new.path().join("recordings/v.mp4")).unwrap(),
            b"video"
        );
        assert!(recover(old.path(), new.path()).unwrap().already_done);
        assert_eq!(
            fs::read(old.path().join("recordings/v.mp4")).unwrap(),
            b"video"
        );
    }
}
