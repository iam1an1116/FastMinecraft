#include "flutter_window.h"

#include <commdlg.h>
#include <dwmapi.h>
#include <uxtheme.h>
#include <windowsx.h>

#include <optional>
#include <string>

#include "flutter/generated_plugin_registrant.h"

#ifndef DWMWA_USE_IMMERSIVE_DARK_MODE
#define DWMWA_USE_IMMERSIVE_DARK_MODE 20
#endif

#ifndef DWMWA_WINDOW_CORNER_PREFERENCE
#define DWMWA_WINDOW_CORNER_PREFERENCE 33
#endif

#ifndef DWMWA_SYSTEMBACKDROP_TYPE
#define DWMWA_SYSTEMBACKDROP_TYPE 38
#endif

namespace {

std::string WideToUtf8(const std::wstring& wide) {
  if (wide.empty()) return {};
  int size = WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), static_cast<int>(wide.size()), nullptr, 0, nullptr, nullptr);
  if (size <= 0) return {};
  std::string out(static_cast<size_t>(size), 0);
  WideCharToMultiByte(CP_UTF8, 0, wide.c_str(), static_cast<int>(wide.size()), &out[0], size, nullptr, nullptr);
  return out;
}

}  // namespace

FlutterWindow::FlutterWindow(const flutter::DartProject& project)
    : project_(project) {}

FlutterWindow::~FlutterWindow() {}

void FlutterWindow::ApplyFramelessBackdrop(HWND hwnd) {
  BOOL dark = FALSE;
  DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof(dark));

  // Windows 11 rounded corners (DWMWCP_ROUND = 2)
  int corner = 2;
  DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &corner, sizeof(corner));

  // Windows 11 Acrylic backdrop (DWMSBT_TRANSIENTWINDOW = 3) with fallback to Mica (2)
  int backdrop = 3;
  if (FAILED(DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, &backdrop, sizeof(backdrop)))) {
    backdrop = 2;
    DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, &backdrop, sizeof(backdrop));
  }

  MARGINS margins = {-1, -1, -1, -1};
  DwmExtendFrameIntoClientArea(hwnd, &margins);
}

void FlutterWindow::SetupWindowChannel() {
  window_channel_ = std::make_unique<flutter::MethodChannel<flutter::EncodableValue>>(
      flutter_controller_->engine()->messenger(),
      "com.fastminecraft/window",
      &flutter::StandardMethodCodec::GetInstance());

  window_channel_->SetMethodCallHandler(
      [this](const flutter::MethodCall<flutter::EncodableValue>& call,
             std::unique_ptr<flutter::MethodResult<flutter::EncodableValue>> result) {
        HWND hwnd = GetHandle();
        const std::string& method = call.method_name();

        if (method == "startDragging") {
          ReleaseCapture();
          SendMessage(hwnd, WM_SYSCOMMAND, SC_MOVE | HTCAPTION, 0);
          result->Success();
        } else if (method == "zoomWindow") {
          ShowWindow(hwnd, IsZoomed(hwnd) ? SW_RESTORE : SW_MAXIMIZE);
          result->Success();
        } else if (method == "minimizeWindow") {
          ShowWindow(hwnd, SW_MINIMIZE);
          result->Success();
        } else if (method == "closeWindow") {
          PostMessage(hwnd, WM_CLOSE, 0, 0);
          result->Success();
        } else if (method == "pickJarZip" || method == "pickJar" || method == "pickFile") {
          static const wchar_t kJarZipFilter[] = L"Server Files (*.jar;*.zip)\0*.jar;*.zip\0All Files (*.*)\0*.*\0";
          static const wchar_t kJarFilter[] = L"JAR Files (*.jar)\0*.jar\0All Files (*.*)\0*.*\0";
          static const wchar_t kAllFilter[] = L"All Files (*.*)\0*.*\0";

          const wchar_t* filter = kAllFilter;
          if (method == "pickJarZip") filter = kJarZipFilter;
          else if (method == "pickJar") filter = kJarFilter;

          wchar_t file_path[MAX_PATH] = {0};
          OPENFILENAMEW ofn = {};
          ofn.lStructSize = sizeof(ofn);
          ofn.hwndOwner = hwnd;
          ofn.lpstrFile = file_path;
          ofn.nMaxFile = MAX_PATH;
          ofn.lpstrFilter = filter;
          ofn.nFilterIndex = 1;
          ofn.Flags = OFN_PATHMUSTEXIST | OFN_FILEMUSTEXIST | OFN_NOCHANGEDIR;

          if (GetOpenFileNameW(&ofn)) {
            result->Success(flutter::EncodableValue(WideToUtf8(file_path)));
          } else {
            result->Success();
          }
        } else {
          result->NotImplemented();
        }
      });
}

bool FlutterWindow::OnCreate() {
  if (!Win32Window::OnCreate()) {
    return false;
  }

  HWND hwnd = GetHandle();
  ApplyFramelessBackdrop(hwnd);
  SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
               SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER);

  RECT frame = GetClientArea();

  flutter_controller_ = std::make_unique<flutter::FlutterViewController>(
      frame.right - frame.left, frame.bottom - frame.top, project_);
  if (!flutter_controller_->engine() || !flutter_controller_->view()) {
    return false;
  }
  RegisterPlugins(flutter_controller_->engine());
  SetupWindowChannel();
  SetChildContent(flutter_controller_->view()->GetNativeWindow());

  flutter_controller_->engine()->SetNextFrameCallback([&]() {
    this->Show();
  });

  flutter_controller_->ForceRedraw();

  return true;
}

void FlutterWindow::OnDestroy() {
  window_channel_.reset();
  if (flutter_controller_) {
    flutter_controller_ = nullptr;
  }

  Win32Window::OnDestroy();
}

LRESULT
FlutterWindow::MessageHandler(HWND hwnd, UINT const message,
                              WPARAM const wparam,
                              LPARAM const lparam) noexcept {
  if (flutter_controller_) {
    std::optional<LRESULT> result =
        flutter_controller_->HandleTopLevelWindowProc(hwnd, message, wparam,
                                                      lparam);
    if (result) {
      return *result;
    }
  }

  switch (message) {
    case WM_NCCALCSIZE:
      if (wparam) {
        return 0;
      }
      break;
    case WM_NCHITTEST: {
      RECT rect;
      GetWindowRect(hwnd, &rect);
      LONG x = GET_X_LPARAM(lparam);
      LONG y = GET_Y_LPARAM(lparam);
      const LONG border = 6;
      bool left = x < rect.left + border;
      bool right = x >= rect.right - border;
      bool top = y < rect.top + border;
      bool bottom = y >= rect.bottom - border;
      if (top && left) return HTTOPLEFT;
      if (top && right) return HTTOPRIGHT;
      if (bottom && left) return HTBOTTOMLEFT;
      if (bottom && right) return HTBOTTOMRIGHT;
      if (left) return HTLEFT;
      if (right) return HTRIGHT;
      if (top) return HTTOP;
      if (bottom) return HTBOTTOM;
      break;
    }
    case WM_FONTCHANGE:
      if (flutter_controller_) {
        flutter_controller_->engine()->ReloadSystemFonts();
      }
      break;
  }

  return Win32Window::MessageHandler(hwnd, message, wparam, lparam);
}
