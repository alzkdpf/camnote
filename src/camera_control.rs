use image::{RgbImage, imageops};

pub const FRAME_WIDTH: u32 = 1280;
pub const FRAME_HEIGHT: u32 = 720;
pub const FIT_FRAME: &str =
    "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2";

/// Zoom is an integer percentage rather than an interpolated FFmpeg expression.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Zoom(u16);
impl Zoom {
    pub const ORIGINAL: Self = Self(100);

    pub fn new(percent: u16) -> Result<Self, String> {
        if (100..=300).contains(&percent) && percent % 25 == 0 {
            Ok(Self(percent))
        } else {
            Err("줌은 1배에서 3배까지 0.25배 단위로 조절할 수 있습니다.".into())
        }
    }

    pub fn percent(self) -> u16 {
        self.0
    }

    fn crop(self) -> (u32, u32, u32, u32) {
        // Keep the dimensions and offsets even for chroma-subsampled video.
        let width = (FRAME_WIDTH * 100 / u32::from(self.0)) & !3;
        let height = (FRAME_HEIGHT * 100 / u32::from(self.0)) & !3;
        ((FRAME_WIDTH - width) / 2, (FRAME_HEIGHT - height) / 2, width, height)
    }

    pub fn apply(self, frame: RgbImage, width: u32, height: u32) -> RgbImage {
        if self == Self::ORIGINAL {
            return if (width, height) == (FRAME_WIDTH, FRAME_HEIGHT) {
                frame
            } else {
                imageops::resize(&frame, width, height, imageops::FilterType::Triangle)
            };
        }
        let (x, y, w, h) = self.crop();
        imageops::resize(
            &imageops::crop_imm(&frame, x, y, w, h).to_image(), width, height,
            imageops::FilterType::Triangle,
        )
    }

    pub fn video_filter(self) -> String {
        if self == Self::ORIGINAL {
            return FIT_FRAME.into();
        }
        let (x, y, w, h) = self.crop();
        format!("{FIT_FRAME},crop={w}:{h}:{x}:{y}:exact=1,scale={FRAME_WIDTH}:{FRAME_HEIGHT},setsar=1")
    }
}

#[cfg(target_os = "macos")]
mod native {
    unsafe extern "C" {
        fn camnote_camera_autofocus(name: *const std::ffi::c_char, perform: i32) -> i32;
    }

    pub fn focus(name: &str, perform: bool) -> i32 {
        let Ok(name) = std::ffi::CString::new(name) else {
            return 0;
        };
        // The bridge borrows the name only during this synchronous call.
        unsafe { camnote_camera_autofocus(name.as_ptr(), i32::from(perform)) }
    }
}
#[cfg(not(target_os = "macos"))]
mod native {
    pub fn focus(_name: &str, _perform: bool) -> i32 {
        0
    }
}

pub fn supports_autofocus(name: &str) -> bool {
    native::focus(name, false) == 1
}

pub fn request_autofocus(name: &str) -> Result<(), String> {
    match native::focus(name, true) {
        1 => Ok(()),
        -1 => Err("카메라 설정에 접근할 수 없습니다. 이 연결에서는 초점을 변경하지 못했습니다.".into()),
        _ => Err("이 카메라 연결은 앱에서 자동 초점을 다시 맞추는 기능을 지원하지 않습니다.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    #[test]
    fn zoom_shape_and_limits() {
        for percent in (100..=300).step_by(25) {
            let (x, y, w, h) = Zoom::new(percent).unwrap().crop();
            assert_eq!((2 * x + w, 2 * y + h), (FRAME_WIDTH, FRAME_HEIGHT));
            assert!((i64::from(w) * 9 - i64::from(h) * 16).abs() < 64);
            assert_eq!((x % 2, y % 2), (0, 0));
        }
        for percent in [0, 99, 110, 301, u16::MAX] {
            assert!(Zoom::new(percent).is_err());
        }
        assert_eq!(Zoom::ORIGINAL.video_filter(), FIT_FRAME);
        assert!(Zoom::new(200).unwrap().video_filter().contains("crop=640:360:320:180:exact=1"));
    }

    #[test]
    fn still_zoom_preserves_center_and_removes_edges() {
        let mut source = RgbImage::from_pixel(FRAME_WIDTH, FRAME_HEIGHT, Rgb([255, 0, 0]));
        for y in 180..540 {
            for x in 320..960 {
                source.put_pixel(x, y, Rgb([0, 200, 0]));
            }
        }
        let zoomed = Zoom::new(200).unwrap().apply(source, FRAME_WIDTH, FRAME_HEIGHT);
        assert!(zoomed.pixels().all(|pixel| pixel.0 == [0, 200, 0]));
    }

    #[test]
    fn autofocus_rejects_invalid_or_nonexistent_camera_names() {
        for name in ["", "\0", "__camnote_no_such_camera__"] {
            assert!(!supports_autofocus(name));
            assert!(request_autofocus(name).is_err());
        }
    }
}
