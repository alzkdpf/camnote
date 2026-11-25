# CamNote

macOS에서 iPhone 연속성 카메라 또는 웹캠으로 장면을 저장하고, Codex CLI로 텍스트 노트·새 이미지를 만들어 Obsidian으로 보내는 Tauri 2 + Rust 데스크탑 앱입니다.

**현재 배포는 Apple Silicon용 실험적 프리릴리스이며 Apple 공증이 없습니다.** FFmpeg와 Codex CLI는 포함되지 않습니다. CamNote 자체의 오픈소스 라이선스는 아직 선택하지 않았습니다. [이용허락 상태](RIGHTS.md)와 [보안 검토 범위](SECURITY-REVIEW.md)를 확인하세요.

## 설치

1. [Releases](https://github.com/alzkdpf/camnote/releases)에서 `macos-arm64.dmg`를 받습니다.
2. DMG 안의 CamNote.app을 Applications로 옮깁니다.
3. FFmpeg와 최신 Codex CLI를 별도로 설치하고 터미널에서 `codex login`을 완료합니다. CLI는 `--ignore-user-config`, 기능 비활성화 옵션과 내장 이미지 생성 도구를 지원해야 합니다.
4. 설정에서 필요한 실행 파일 경로를 확인합니다. 설치 위치에 따라 자동 탐색되지 않을 수 있습니다.

macOS 13 이상이 필요합니다. Intel Mac용 바이너리는 배포하지 않습니다. 이 빌드는 ad hoc 서명만 되어 있어 macOS가 실행을 차단할 수 있습니다. 소스 빌드 또는 조직의 승인 절차를 사용하세요. Gatekeeper를 전역으로 비활성화하는 방법은 권장하지 않습니다.

## 사용

1. 카메라 목록에서 장치를 고르고 중앙의 **카메라 시작**을 누릅니다. 처음 사용할 때 macOS 카메라 권한을 허용합니다.
2. 미리보기를 확인하고 **장면 촬영**을 누릅니다. PNG/JPEG는 **이미지 가져오기**로 추가할 수 있습니다.
3. **텍스트로 정리**로 노트를 생성하거나, **이미지 변환**을 펼쳐 지시를 입력합니다. 예: “원본 구도를 유지하고 수채화로 바꿔줘.” SVG 도식은 **추가 작업**에 있습니다.
4. 노트 편집 내용은 로컬에 자동 저장됩니다. 생성 이미지는 텍스트 노트가 없어도 내보낼 수 있습니다.
5. 설정에서 기존 Obsidian vault를 선택하고 **Obsidian으로 보내기**를 누릅니다.

노트는 `선택한 vault/CamNote/`, 첨부는 `선택한 vault/CamNote/attachments/`에 저장됩니다. 기존 노트는 덮어쓰지 않으며 재전송은 거부하고 기존 노트 열기를 제공합니다. 앱 데이터와 Obsidian 노트 사이의 양방향 동기화는 없습니다.

Space는 카메라 시작·촬영, Command-O는 가져오기, Command-S는 노트 저장, Command-comma는 설정입니다. 편집 중에는 Space가 촬영을 실행하지 않습니다.

## iPhone 연속성 카메라

Mac과 iPhone에 같은 Apple 계정으로 로그인하고 Wi-Fi·Bluetooth를 켭니다. iPhone 설정 → 일반 → AirPlay 및 연속성(또는 AirPlay 및 Handoff) → 연속성 카메라를 켜고, iPhone을 잠근 채 가까이 거치하세요. USB 연결도 가능하며 신뢰 확인은 기기에서 직접 진행합니다.

앱에서 목록을 새로고침한 뒤 일반 iPhone 카메라 또는 책상 촬영용 데스크뷰 카메라를 선택합니다. 앱 자체의 별도 Bluetooth 페어링 서버는 없습니다. 연결 조건은 [Apple 공식 안내](https://support.apple.com/en-us/102546)를 참고하세요.

## 모델과 개인정보

- Codex CLI는 로컬 프로세스이지만 온라인 모델에 이미지와 지시를 전달할 수 있습니다. ChatGPT/Codex 로그인은 오프라인 모델을 뜻하지 않습니다.
- 텍스트는 로컬 Ollama vision 모델도 선택할 수 있습니다. 서버는 `127.0.0.1:11434`로 고정되고 모델은 사용자가 준비합니다.
- 새 이미지 변환은 Codex의 내장 이미지 도구를 사용합니다. 사용 권한이 없으면 오류를 표시하며 유료 API나 다른 제공자로 자동 전환하지 않습니다.
- 앱은 Codex의 사용자 설정 파일을 로드하지 않고, shell·view_image 도구를 끈 읽기 전용 실행을 요청합니다. 인증정보는 기존 Codex CLI가 관리합니다. 읽기 전용 sandbox는 완전한 파일시스템·네트워크 격리를 의미하지 않습니다.
- 모델이 반환한 HTML과 이미지 임베드는 텍스트 노트에서 이스케이프합니다. SVG는 XML 요소·속성 허용 목록으로 검증합니다. 생성 결과와 불확실한 내용은 확인 후 사용하세요.

기본 데이터 위치는 현재 사용자의 `~/Library/Application Support/CamNote`입니다. `CAMNOTE_DATA`로 신뢰할 수 있는 별도 폴더를 지정할 수 있습니다. 촬영물·노트·설정·로그는 이 위치에만 생성되며 저장소나 DMG에 포함하지 않습니다. 로그에도 지시와 모델 응답이 포함될 수 있으므로 공개 공유하지 마세요.

텍스트 요청 제한은 240초, 이미지 변환은 600초, Ollama는 180초입니다. 카메라는 시작을 누를 때 켜지고 촬영·중지·앱 종료 시 정리합니다. 촬영은 1280×720, 미리보기는 최대 8fps입니다. 앱을 강제 종료하면 진행 중 작업이나 마지막 자동 저장의 완료를 보장하지 않습니다.

## Obsidian 안에서 위임

앱 설정의 **Obsidian 위임 플러그인 설치**를 누른 뒤, Obsidian의 커뮤니티 플러그인에서 CamNote를 활성화합니다. 기존 플러그인 폴더는 덮어쓰지 않습니다.

이미지가 첨부된 노트를 열고 명령 팔레트에서 **CamNote: 첨부 장면을 Codex에 위임** 또는 **첨부 사진을 새 이미지로 변환**을 실행합니다. 현재 노트의 첫 PNG/JPEG 첨부 파일을 전달하며 결과는 별도 노트로 만듭니다. 플러그인의 모델·지시는 Obsidian 설정에서 변경합니다. 외부 Agent Client 플러그인은 필요하지 않습니다.

## 소스 빌드

필요 도구: macOS, Xcode Command Line Tools, Rust 1.100 이상, Python 3, Node.js 18 이상(플러그인 테스트용). FFmpeg·Codex CLI는 기능 실행 시 필요합니다.

```sh
cargo test --locked
node --test tests/plugin.test.cjs
./run.command
./package.command
./scripts/make-dmg.sh
```

`package.command`는 경로를 remap한 release 바이너리, 제3자 라이선스 고지와 ad hoc 서명 앱을 생성합니다. `make-dmg.sh`는 앱·고지 파일·Applications 링크만 DMG에 넣습니다. 개인 데이터는 복사하지 않습니다.

`ui/`는 화면, `src/main.rs`는 Tauri 명령·카메라, `src/core.rs`는 저장·모델·Obsidian 내보내기, `obsidian-plugin/`은 보조 플러그인입니다. UI는 앱 실행 파일에 포함되어 별도 웹 서버가 필요하지 않습니다.

## 라이선스

CamNote 자체의 이용허락 라이선스는 보류 중입니다. 공개 저장소라는 이유만으로 자유로운 재사용 권한을 부여하지는 않습니다. 의존성 고지는 [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt)에 있으며, 외부 FFmpeg·Codex·Ollama는 번들에 없습니다.
