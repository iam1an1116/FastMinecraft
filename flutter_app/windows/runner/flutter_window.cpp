#include "flutter_window.h"

#include <commdlg.h>
#include <dwmapi.h>

#include <optional>
#include <string>

#include "flutter/generated_plugin_registrant.h"
#include "utils.h"

namespace {

constexpr DWORD kDwmwaUseImmersiveDarkMode = 20;
constexpr DWORD kDwmwaWindowCornerPreference = 33;

bool FileExists(const std::wstring& path) {
  DWORD attrs = GetFileAttributesW(path.c_str());
  return attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY);
}

std::wstring GetExeDirectory() {
  wchar_t buffer[MAX_PATH] = {0};
  DWORD len = GetModuleFileNameW(nullptr, buffer, MAX_PATH);
  if (len == 0 || len >= MAX_PATH) {
    return L".";
  }
  std::wstring full(buffer, len);
  size_t pos = full.find_last_of(L"\\/");
  if (pos == std::wstring::npos) {
    return L".";
  }
  return full.substr(0, pos);
}

}  // namespace

FlutterWindow::FlutterWindow(const flutter::DartProject& project)
    : project_(project) {}

FlutterWindow::~FlutterWindow() {
  StopBundledBackend();
}

void FlutterWindow::ApplyFramelessBackdrop(HWND hwnd) {
  LONG_PTR style = GetWindowLongPtrW(hwnd, GWL_STYLE);
  style &= ~static_cast<LONG_PTR>(WS_CAPTION);
  SetWindowLongPtrW(hwnd, GWL_STYLE, style);
  SetMenu(hwnd, nullptr);

  BOOL dark = FALSE;
  DwmSetWindowAttribute(hwnd, kDwmwaUseImmersiveDarkMode, &dark, sizeof(dark));

  // Windows 11 rounded corners (DWMWCP_ROUND = 2)
  int corner = 2;
  DwmSetWindowAttribute(hwnd, kDwmwaWindowCornerPreference, &corner, sizeof(corner));

  // Keep native drop shadow without drawing a default DWM caption frame.
  MARGINS margins = {0, 0, 1, 0};
  DwmExtendFrameIntoClientArea(hwnd, &margins);
}

void FlutterWindow::StartBundledBackend() {
  if (backend_process_ != nullptr) {
    return;
  }

  std::wstring exe_dir = GetExeDirectory();
  std::wstring index_js = exe_dir + L"\\backend\\src\\index.js";
  if (!FileExists(index_js)) {
    return;
  }

  std::wstring node_exe = exe_dir + L"\\node\\node.exe";
  if (!FileExists(node_exe)) {
    wchar_t found[MAX_PATH] = {0};
    if (SearchPathW(nullptr, L"node.exe", nullptr, MAX_PATH, found, nullptr) > 0) {
      node_exe = found;
    } else {
      return;
    }
  }

  SetEnvironmentVariableW(L"PORT", L"3001");
  SetEnvironmentVariableW(L"FM_DATA_DIR", exe_dir.c_str());

  if (!backend_job_) {
    backend_job_ = CreateJobObjectW(nullptr, nullptr);
    if (backend_job_) {
      JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli = {};
      jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      SetInformationJobObject(backend_job_, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli));
    }
  }

  SECURITY_ATTRIBUTES sa = {};
  sa.nLength = sizeof(sa);
  sa.bInheritHandle = TRUE;

  std::wstring log_path = exe_dir + L"\\fm-backend.log";
  HANDLE log_handle = CreateFileW(
      log_path.c_str(),
      GENERIC_WRITE,
      FILE_SHARE_READ | FILE_SHARE_WRITE,
      &sa,
      CREATE_ALWAYS,
      FILE_ATTRIBUTE_NORMAL,
      nullptr);

  STARTUPINFOW si = {};
  si.cb = sizeof(si);
  if (log_handle != INVALID_HANDLE_VALUE) {
    si.dwFlags |= STARTF_USESTDHANDLES;
    si.hStdOutput = log_handle;
    si.hStdError = log_handle;
    si.hStdInput = nullptr;
  }

  std::wstring cmd = L"\"" + node_exe + L"\" \"" + index_js + L"\" \"" + exe_dir + L"\"";
  PROCESS_INFORMATION pi = {};
  BOOL ok = CreateProcessW(
      nullptr,
      &cmd[0],
      nullptr,
      nullptr,
      log_handle != INVALID_HANDLE_VALUE ? TRUE : FALSE,
      CREATE_NO_WINDOW,
      nullptr,
      exe_dir.c_str(),
      &si,
      &pi);

  if (log_handle != INVALID_HANDLE_VALUE) {
    CloseHandle(log_handle);
  }

  if (ok) {
    if (backend_job_) {
      AssignProcessToJobObject(backend_job_, pi.hProcess);
    }
    CloseHandle(pi.hThread);
    backend_process_ = pi.hProcess;
  }
}

void FlutterWindow::StopBundledBackend() {
  if (backend_process_) {
    TerminateProcess(backend_process_, 0);
    CloseHandle(backend_process_);
    backend_process_ = nullptr;
  }
  if (backend_job_) {
    CloseHandle(backend_job_);
    backend_job_ = nullptr;
  }
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
          static const wchar_t kJarZipFilter[] =
              L"Server Files (*.jar;*.zip)\0*.jar;*.zip\0All Files (*.*)\0*.*\0";
          static const wchar_t kJarFilter[] =
              L"JAR Files (*.jar)\0*.jar\0All Files (*.*)\0*.*\0";
          static const wchar_t kAllFilter[] =
              L"All Files (*.*)\0*.*\0";

          const wchar_t* filter = kAllFilter;
          if (method == "pickJarZip") {
            filter = kJarZipFilter;
          } else if (method == "pickJar") {
            filter = kJarFilter;
          }

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
            result->Success(flutter::EncodableValue(Utf8FromUtf16(file_path)));
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

  StartBundledBackend();

  HWND hwnd = GetHandle();
  ApplyFramelessBackdrop(hwnd);
  SetWindowPos(hwnd, nullptr, 0, 0, 0, 0,
               SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);

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
  if (window_channel_) {
    window_channel_->SetMethodCallHandler(nullptr);
    window_channel_.reset();
  }
  if (flutter_controller_) {
    flutter_controller_ = nullptr;
  }
  StopBundledBackend();

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
        if (IsZoomed(hwnd)) {
          auto* params = reinterpret_cast<NCCALCSIZE_PARAMS*>(lparam);
          HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
          MONITORINFO info = {};
          info.cbSize = sizeof(info);
          if (GetMonitorInfoW(monitor, &info)) {
            params->rgrc[0] = info.rcWork;
          }
        }
      }
      return 0;
    case WM_NCACTIVATE:
      return TRUE;
    case WM_NCHITTEST: {
      RECT rect;
      GetWindowRect(hwnd, &rect);
      const LONG x = static_cast<LONG>(static_cast<short>(LOWORD(lparam)));
      const LONG y = static_cast<LONG>(static_cast<short>(HIWORD(lparam)));
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
      return HTCLIENT;
    }
    case WM_FONTCHANGE:
      if (flutter_controller_) {
        flutter_controller_->engine()->ReloadSystemFonts();
      }
      break;
  }

  return Win32Window::MessageHandler(hwnd, message, wparam, lparam);
}
