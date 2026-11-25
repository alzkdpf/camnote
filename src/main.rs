mod core;
mod edit;
mod storage;
use base64::Engine;
use core::*;
use serde::Serialize;
use std::{
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

#[tauri::command]
fn frontend_ready(report: serde_json::Value) -> Result<(), String> {
    if let Some(path) = std::env::var_os("CAMNOTE_UI_REPORT") {
        fs::write(path, serde_json::to_vec_pretty(&report).map_err(err)?).map_err(err)?;
    }
    Ok(())
}

struct Live {
    child: Child,
    frame: Arc<Mutex<Option<(Vec<u8>, Instant)>>>,
}
impl Drop for Live {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
#[derive(Default)]
struct Runtime {
    live: Mutex<Option<Live>>,
    settings: Mutex<Settings>,
    job: Mutex<bool>,
    pending_files: Mutex<Vec<String>>,
}
#[derive(Serialize)]
struct Scene {
    path: String,
    name: String,
    preview: String,
    body: String,
    generated: Option<String>,
    title: Option<String>,
    chat: edit::History,
    chat_error: Option<String>,
}
fn preview(path: &Path) -> Result<String, String> {
    let img = image::open(path).map_err(err)?.thumbnail(1400, 1000);
    let mut bytes = Cursor::new(Vec::new());
    img.write_to(&mut bytes, image::ImageFormat::Jpeg)
        .map_err(err)?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes.into_inner())
    ))
}
fn safe_scene(path: &str) -> Result<PathBuf, String> {
    let p = fs::canonicalize(path).map_err(err)?;
    let scenes = fs::canonicalize(root().join("scenes")).map_err(err)?;
    if p.parent() != Some(scenes.as_path()) {
        return Err("저장된 장면만 사용할 수 있습니다".into());
    }
    Ok(p)
}
fn scene(p: &Path) -> Result<Scene, String> {
    let (chat, chat_error) = match edit::load(p) {
        Ok(h) => (h, None),
        Err(e) => (edit::History::default(), Some(e)),
    };
    Ok(Scene {
        path: p.to_string_lossy().into(),
        name: p.file_stem().unwrap_or_default().to_string_lossy().into(),
        preview: preview(p)?,
        body: fs::read_to_string(p.with_extension("md")).unwrap_or_default(),
        generated: generated_image(p).and_then(|g| preview(&g).ok()),
        title: fs::read(p.with_extension("source.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            .and_then(|v| v["name"].as_str().map(str::to_owned)),
        chat,
        chat_error,
    })
}
#[tauri::command]
fn settings(state: tauri::State<Runtime>) -> Settings {
    state.settings.lock().unwrap().clone()
}
#[tauri::command]
fn take_open_photos(state: tauri::State<Runtime>) -> Result<Vec<String>, String> {
    let mut queue = state.pending_files.lock().map_err(err)?;
    let n = queue.len().min(8);
    Ok(queue.drain(..n).collect())
}
#[tauri::command]
fn update_settings(value: Settings, state: tauri::State<Runtime>) -> Result<(), String> {
    save_settings(&value)?;
    *state.settings.lock().map_err(err)? = value;
    Ok(())
}
#[tauri::command]
async fn devices(state: tauri::State<'_, Runtime>) -> Result<Vec<CameraDevice>, String> {
    let ffmpeg = state.settings.lock().map_err(err)?.ffmpeg.clone();
    tauri::async_runtime::spawn_blocking(move || list_cameras(&ffmpeg))
        .await
        .map_err(err)?
}
#[tauri::command]
async fn library() -> Result<Vec<Scene>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        Ok(scenes().iter().filter_map(|p| scene(p).ok()).collect())
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn choose_photos() -> Option<Vec<String>> {
    rfd::FileDialog::new()
        .set_title("사진 불러오기")
        .add_filter("사진", &["png", "jpg", "jpeg", "webp", "heic", "heif"])
        .pick_files()
        .map(|paths| {
            paths
                .into_iter()
                .map(|p| p.to_string_lossy().into_owned())
                .collect()
        })
}
#[derive(Serialize)]
struct Imports {
    scenes: Vec<Scene>,
    errors: Vec<String>,
}
#[tauri::command]
async fn import_photos(
    paths: Vec<String>,
    state: tauri::State<'_, Runtime>,
) -> Result<Imports, String> {
    if paths.is_empty() || paths.len() > 8 {
        return Err("한 번에 사진 1~8장을 선택하세요".into());
    }
    {
        let mut job = state.job.lock().map_err(err)?;
        if *job {
            return Err("작업이 끝난 뒤 사진을 불러오세요".into());
        }
        *job = true;
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut output = Imports {
            scenes: Vec::new(),
            errors: Vec::new(),
        };
        for path in paths {
            match import(Path::new(&path)).and_then(|p| scene(&p)) {
                Ok(s) => output.scenes.push(s),
                Err(e) => output.errors.push(format!(
                    "{}: {e}",
                    Path::new(&path)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                )),
            }
        }
        output
    })
    .await
    .map_err(err);
    *state.job.lock().map_err(err)? = false;
    result
}
#[tauri::command]
async fn photo_chat(
    path: String,
    message: String,
    mode: String,
    state: tauri::State<'_, Runtime>,
) -> Result<Scene, String> {
    let p = safe_scene(&path)?;
    let s = state.settings.lock().map_err(err)?.clone();
    {
        let mut job = state.job.lock().map_err(err)?;
        if *job {
            return Err("다른 작업이 진행 중입니다".into());
        }
        *job = true;
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        edit::chat(&s, &p, &message, &mode)?;
        scene(&p)
    })
    .await
    .map_err(err);
    *state.job.lock().map_err(err)? = false;
    result?
}
#[tauri::command]
fn select_revision(
    path: String,
    id: Option<String>,
    state: tauri::State<Runtime>,
) -> Result<Scene, String> {
    if *state.job.lock().map_err(err)? {
        return Err("작업이 끝난 뒤 버전을 선택하세요".into());
    }
    let p = safe_scene(&path)?;
    edit::select(&p, id)?;
    scene(&p)
}
#[tauri::command]
fn refresh_scene(path: String) -> Result<Scene, String> {
    scene(&safe_scene(&path)?)
}
#[tauri::command]
fn save_photo(path: String) -> Result<Option<String>, String> {
    let p = safe_scene(&path)?;
    let h = edit::load(&p)?;
    let source = edit::current(&p, &h)?;
    let Some(dest) = rfd::FileDialog::new()
        .set_title("현재 사진 저장")
        .set_file_name("CamNote-edited.png")
        .add_filter("PNG", &["png"])
        .save_file()
    else {
        return Ok(None);
    };
    if dest
        .extension()
        .and_then(|v| v.to_str())
        .is_none_or(|v| !v.eq_ignore_ascii_case("png"))
    {
        return Err("PNG 확장자로 저장하세요".into());
    }
    use std::os::unix::fs::OpenOptionsExt;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&dest)
        .map_err(|e| format!("기존 파일을 보존했습니다. 다른 이름을 선택하세요: {e}"))?;
    image::open(source)
        .map_err(err)?
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(err)?;
    Ok(Some(dest.to_string_lossy().into()))
}
#[tauri::command]
fn pick_vault() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Obsidian vault 선택")
        .pick_folder()
        .map(|p| p.to_string_lossy().into())
}
#[tauri::command]
fn stop_camera(state: tauri::State<Runtime>) -> Result<(), String> {
    state.live.lock().map_err(err)?.take();
    Ok(())
}
#[derive(Clone, Serialize)]
struct VideoFrame {
    session: String,
    data: String,
}
#[tauri::command]
fn start_camera(
    name: String,
    session: String,
    app: tauri::AppHandle,
    state: tauri::State<Runtime>,
) -> Result<(), String> {
    if *state.job.lock().map_err(err)? {
        return Err("작업이 끝난 뒤 카메라를 시작하세요".into());
    }
    let mut live = state.live.lock().map_err(err)?;
    live.take();
    let mut s = state.settings.lock().map_err(err)?.clone();
    s.camera_name = name.clone();
    save_settings(&s)?;
    *state.settings.lock().map_err(err)? = s.clone();
    fs::create_dir_all(root()).map_err(err)?;
    let mut child=Command::new(s.ffmpeg).args(["-hide_banner","-loglevel","warning","-f","avfoundation","-framerate","30","-i",&format!("{name}:none"),"-vf","fps=8,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2","-pix_fmt","rgb24","-f","rawvideo","pipe:1"]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(fs::File::create(root().join("camera.log")).map_err(err)?).spawn().map_err(err)?;
    let mut output = child.stdout.take().ok_or("카메라 출력 없음")?;
    let frame = Arc::new(Mutex::new(None));
    let latest = frame.clone();
    let session_clone = session.clone();
    std::thread::spawn(move || {
        loop {
            let mut buf = vec![0; 1280 * 720 * 3];
            if output.read_exact(&mut buf).is_err() {
                break;
            }
            let Ok(mut f) = latest.lock() else { break };
            *f = Some((buf.clone(), Instant::now()));
            drop(f);
            if let Some(rgb) = image::RgbImage::from_raw(1280, 720, buf) {
                let img = image::DynamicImage::ImageRgb8(rgb).thumbnail(960, 540);
                let mut jpg = Cursor::new(Vec::new());
                if img.write_to(&mut jpg, image::ImageFormat::Jpeg).is_ok() {
                    let _ = app.emit(
                        "camera-frame",
                        VideoFrame {
                            session: session_clone.clone(),
                            data: format!(
                                "data:image/jpeg;base64,{}",
                                base64::engine::general_purpose::STANDARD.encode(jpg.into_inner())
                            ),
                        },
                    );
                }
            }
        }
        let _ = app.emit("camera-ended", session_clone);
    });
    *live = Some(Live { child, frame });
    Ok(())
}
#[tauri::command]
fn capture(state: tauri::State<Runtime>) -> Result<Scene, String> {
    let mut live = state.live.lock().map_err(err)?;
    let cam = live.as_ref().ok_or("카메라를 먼저 시작하세요")?;
    let bytes = {
        let frame = cam.frame.lock().map_err(err)?;
        let (bytes, when) = frame.as_ref().ok_or("영상이 아직 도착하지 않았습니다")?;
        if when.elapsed() > Duration::from_secs(3) {
            return Err("영상이 멈췄습니다. iPhone 연결을 확인하세요.".into());
        }
        bytes.clone()
    };
    let p = save_frame(&bytes, 1280, 720)?;
    live.take();
    scene(&p)
}
#[tauri::command]
fn save_note(path: String, body: String) -> Result<(), String> {
    write_private(&safe_scene(&path)?.with_extension("md"), body)
}
#[tauri::command]
fn export_note(path: String, body: String, state: tauri::State<Runtime>) -> Result<String, String> {
    let p = safe_scene(&path)?;
    let s = state.settings.lock().map_err(err)?.clone();
    let dest = export(Path::new(&s.vault), &p, &body)?;
    let _ = open_note(&dest);
    Ok(dest.to_string_lossy().into())
}
#[tauri::command]
fn reopen_note(path: String, state: tauri::State<Runtime>) -> Result<(), String> {
    let p = safe_scene(&path)?;
    let s = state.settings.lock().map_err(err)?.clone();
    open_note(
        &Path::new(&s.vault)
            .join("CamNote")
            .join(p.with_extension("md").file_name().ok_or("파일명 없음")?),
    )
}
#[tauri::command]
fn plugin_install(state: tauri::State<Runtime>) -> Result<(), String> {
    install_plugin(&*state.settings.lock().map_err(err)?)
}
#[tauri::command]
async fn process_scene(
    path: String,
    kind: String,
    instruction: String,
    state: tauri::State<'_, Runtime>,
) -> Result<Scene, String> {
    let p = safe_scene(&path)?;
    let mut s = state.settings.lock().map_err(err)?.clone();
    {
        let mut job = state.job.lock().map_err(err)?;
        if *job {
            return Err("다른 작업이 진행 중입니다".into());
        }
        *job = true;
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        match kind.as_str() {
            "image" => {
                s.image_instruction = instruction;
                let h = edit::load(&p)?;
                let reference = edit::current(&p, &h)?;
                let output = generate_image_from(&s, &p, &reference)?;
                edit::register(&p, &output, "generate", &s.image_instruction, None)?;
            }
            "diagram" => {
                let reference = edit::current(&p, &edit::load(&p)?)?;
                generate(&s, &p, &reference, true)?;
            }
            "note" => {
                if !instruction.trim().is_empty() {
                    s.instruction = instruction;
                }
                let reference = edit::current(&p, &edit::load(&p)?)?;
                generate(&s, &p, &reference, false)?;
            }
            _ => return Err("지원하지 않는 작업".into()),
        }
        scene(&p)
    })
    .await
    .map_err(err);
    *state.job.lock().map_err(err)? = false;
    result?
}
#[tauri::command]
fn storage_status() -> storage::Status {
    storage::status()
}
#[tauri::command]
async fn recover_data(
    state: tauri::State<'_, Runtime>,
) -> Result<Option<storage::Recovery>, String> {
    {
        let mut busy = state.job.lock().map_err(err)?;
        if *busy {
            return Err("현재 작업을 완료한 뒤 복구하세요".into());
        }
        *busy = true;
    }
    let result = tauri::async_runtime::spawn_blocking(|| {
        let Some(path) = rfd::FileDialog::new()
            .set_title("이전 CamNote 데이터 폴더 선택 (scenes 폴더의 상위)")
            .pick_folder()
        else {
            return Ok(None);
        };
        storage::recover(&path, &root()).map(Some)
    })
    .await
    .map_err(err)
    .and_then(|r| r);
    *state.job.lock().map_err(err)? = false;
    if result.is_ok() {
        *state.settings.lock().map_err(err)? = load_settings();
    }
    result
}
fn main() {
    if let Err(error) = init_data() {
        eprintln!("CamNote data initialization failed: {error}");
        std::process::exit(1);
    }
    if let Err(error) = storage::auto_recover() {
        eprintln!("CamNote recovery failed: {error}");
        rfd::MessageDialog::new().set_title("CamNote 데이터 복구").set_description(format!("이전 자료의 자동 복구를 완료하지 못했습니다. 원본은 보존되어 있습니다. 설정의 이전 데이터 복구에서 다시 시도하세요.\n{error}")).show();
    }
    tauri::Builder::default()
        .manage(Runtime {
            settings: Mutex::new(load_settings()),
            ..Default::default()
        })
        .invoke_handler(tauri::generate_handler![
            storage_status,
            recover_data,
            frontend_ready,
            take_open_photos,
            settings,
            update_settings,
            devices,
            library,
            choose_photos,
            import_photos,
            photo_chat,
            select_revision,
            refresh_scene,
            save_photo,
            pick_vault,
            stop_camera,
            start_camera,
            capture,
            save_note,
            export_note,
            reopen_note,
            plugin_install,
            process_scene
        ])
        .setup(|app| {
            let menu = tauri::menu::Menu::default(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("CamNote 초기화 실패")
        .run(|app, event| {
            if let tauri::RunEvent::Opened { ref urls } = event {
                if let Some(state) = app.try_state::<Runtime>() {
                    if let Ok(mut queue) = state.pending_files.lock() {
                        for url in urls {
                            if let Ok(path) = url.to_file_path() {
                                let ext = path
                                    .extension()
                                    .and_then(|v| v.to_str())
                                    .unwrap_or("")
                                    .to_ascii_lowercase();
                                if ["jpg", "jpeg", "png", "webp", "heic", "heif"]
                                    .contains(&ext.as_str())
                                {
                                    let value = path.to_string_lossy().into_owned();
                                    if !queue.contains(&value) {
                                        queue.push(value);
                                    }
                                }
                            }
                        }
                        let _ = app.emit("photos-available", ());
                    }
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                if let Some(state) = app.try_state::<Runtime>() {
                    if let Ok(mut live) = state.live.lock() {
                        live.take();
                    }
                }
            }
        });
}
