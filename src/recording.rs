use crate::core::{err, root};
use serde::Serialize;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Child, Command},
    time::{Duration, Instant},
};

#[derive(Clone, Default)]
pub struct Finalization {
    inner: std::sync::Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>,
}
pub struct FinalizationTicket {
    inner: std::sync::Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>,
}
impl Finalization {
    pub fn begin(&self) -> Result<FinalizationTicket, String> {
        let mut busy = self.inner.0.lock().map_err(err)?;
        if *busy {
            return Err("동영상을 저장 중입니다. 잠시 기다리세요.".into());
        }
        *busy = true;
        Ok(FinalizationTicket {
            inner: self.inner.clone(),
        })
    }
    pub fn is_running(&self) -> bool {
        self.inner.0.lock().map_or(true, |busy| *busy)
    }
    pub fn wait(&self) {
        if let Ok(busy) = self.inner.0.lock() {
            let _guard = self
                .inner
                .1
                .wait_timeout_while(busy, Duration::from_secs(17), |busy| *busy);
        }
    }
}
impl Drop for FinalizationTicket {
    fn drop(&mut self) {
        if let Ok(mut busy) = self.inner.0.lock() {
            *busy = false;
            self.inner.1.notify_all();
        }
    }
}

#[derive(Clone, Serialize)]
pub struct Video {
    pub path: String,
    pub name: String,
    pub bytes: u64,
}
pub fn directory() -> Result<PathBuf, String> {
    use std::os::unix::fs::DirBuilderExt;
    let p = root().join("recordings");
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&p)
        .map_err(err)?;
    Ok(p)
}
pub fn new_path() -> Result<PathBuf, String> {
    Ok(directory()?.join(format!(
        "recording-{}-{}.mp4",
        jiff::Zoned::now().strftime("%Y%m%d-%H%M%S"),
        jiff::Timestamp::now().as_nanosecond()
    )))
}
pub fn output_args(cmd: &mut Command, path: &Path) {
    cmd.args([
        "-map",
        "0:v:0",
        "-vf",
        "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-movflags",
        "+frag_keyframe+empty_moov+default_base_moof",
        "-frag_duration",
        "1000000",
        "-f",
        "mp4",
    ])
    .arg(path);
}
pub fn finish(child: &mut Child) -> Result<(), String> {
    if let Some(mut input) = child.stdin.take() {
        let _ = input.write_all(b"q\n");
    }
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(err)? {
            return if status.success() {
                Ok(())
            } else {
                Err(
                    "녹화가 정상 종료되지 않았습니다. 저장된 파일과 recording.log를 확인하세요."
                        .into(),
                )
            };
        }
        if start.elapsed() > Duration::from_secs(15) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("녹화 종료 시간이 초과되었습니다. 일부 영상이 저장되었을 수 있습니다. 동영상 목록에서 확인하세요.".into());
        }
        std::thread::sleep(Duration::from_millis(40));
    }
}
pub fn info(path: &Path) -> Result<Video, String> {
    Ok(Video {
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        bytes: fs::metadata(path).map_err(err)?.len(),
    })
}
pub fn list() -> Result<Vec<Video>, String> {
    let mut result = vec![];
    for entry in fs::read_dir(directory()?).map_err(err)? {
        let p = entry.map_err(err)?.path();
        if p.extension().and_then(|v| v.to_str()) == Some("mp4")
            && fs::symlink_metadata(&p).map_err(err)?.is_file()
        {
            result.push(info(&p)?);
        }
    }
    result.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(result)
}
pub fn safe(path: &str) -> Result<PathBuf, String> {
    let p = fs::canonicalize(path).map_err(err)?;
    if p.parent() != Some(fs::canonicalize(directory()?).map_err(err)?.as_path())
        || p.extension().and_then(|v| v.to_str()) != Some("mp4")
        || !p.is_file()
    {
        return Err("저장된 동영상만 열 수 있습니다".into());
    }
    Ok(p)
}
pub fn copy_new(source: &Path, dest: &Path) -> Result<(), String> {
    use std::os::unix::fs::OpenOptionsExt;
    let mut input = fs::File::open(source).map_err(err)?;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(dest)
        .map_err(|e| format!("기존 파일은 덮어쓰지 않습니다. 다른 이름으로 저장하세요: {e}"))?;
    let result = std::io::copy(&mut input, &mut output)
        .map_err(err)
        .and_then(|_| output.sync_all().map_err(err));
    drop(output);
    if result.is_err() {
        let _ = fs::remove_file(dest);
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Read, process::Stdio};
    #[test]
    fn video_export_never_overwrites_existing_file() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("source.mp4");
        let dst = d.path().join("existing.mp4");
        fs::write(&src, b"video").unwrap();
        fs::write(&dst, b"keep").unwrap();
        assert!(copy_new(&src, &dst).is_err());
        assert_eq!(fs::read(&dst).unwrap(), b"keep");
    }
    #[test]
    #[ignore = "Requires CAMNOTE_TEST_FFMPEG and its sibling ffprobe; uses synthetic video only"]
    fn synthetic_recording_stops_gracefully_with_preview_and_decodes() {
        let ffmpeg = std::env::var_os("CAMNOTE_TEST_FFMPEG").expect("explicit test executable");
        let ffmpeg = PathBuf::from(ffmpeg);
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("video.mp4");
        let mut cmd = Command::new(&ffmpeg);
        cmd.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-n",
            "-re",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=1280x720:rate=30",
        ]);
        output_args(&mut cmd, &path);
        cmd.args([
            "-map", "0:v:0", "-vf", "fps=8", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
        let mut child = cmd.spawn().unwrap();
        let mut stdout = child.stdout.take().unwrap();
        let reader = std::thread::spawn(move || {
            let mut buf = vec![0; 1280 * 720 * 3];
            let mut frames = 0;
            while stdout.read_exact(&mut buf).is_ok() {
                frames += 1;
            }
            frames
        });
        std::thread::sleep(Duration::from_secs(3));
        finish(&mut child).unwrap();
        assert!(reader.join().unwrap() > 0);
        let out = Command::new(ffmpeg.with_file_name("ffprobe"))
            .args([
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
            ])
            .arg(&path)
            .output()
            .unwrap();
        assert!(out.status.success());
        let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
        let streams = v["streams"].as_array().unwrap();
        assert_eq!(streams.len(), 1);
        assert_eq!(streams[0]["codec_name"], "h264");
        assert_eq!(streams[0]["width"], 1280);
        assert_eq!(streams[0]["height"], 720);
        assert_eq!(streams[0]["avg_frame_rate"], "30/1");
        assert!(
            v["format"]["duration"]
                .as_str()
                .unwrap()
                .parse::<f64>()
                .unwrap()
                > 1.
        );
        assert!(
            Command::new(&ffmpeg)
                .args(["-v", "error", "-i"])
                .arg(&path)
                .args(["-f", "null", "-"])
                .status()
                .unwrap()
                .success()
        );
        // A second recording uses a new path; the first must remain unchanged.
        let original = fs::read(&path).unwrap();
        let other = d.path().join("second.mp4");
        let mut cmd = Command::new(&ffmpeg);
        cmd.args([
            "-v",
            "error",
            "-n",
            "-f",
            "lavfi",
            "-i",
            "color=size=1280x720:rate=30",
            "-t",
            "1",
        ]);
        output_args(&mut cmd, &other);
        assert!(cmd.status().unwrap().success());
        assert_eq!(fs::read(&path).unwrap(), original);
    }
    #[test]
    fn shutdown_waits_for_background_finalization() {
        let state = Finalization::default();
        let ticket = state.begin().unwrap();
        assert!(state.is_running());
        assert!(state.begin().is_err());
        let worker = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            drop(ticket);
        });
        state.wait();
        assert!(!state.is_running());
        worker.join().unwrap();
    }
}
