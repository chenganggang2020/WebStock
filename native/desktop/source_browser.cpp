#include "source_browser.hpp"
#include "source_detail_response.hpp"

#include <WebView2.h>
#include <windows.h>

#include <QApplication>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QJsonDocument>
#include <QPointer>
#include <QTimer>
#include <atomic>
#include <functional>

namespace {
GUID guid(const wchar_t* text) {
  GUID value{};
  CLSIDFromString(text, &value);
  return value;
}
// SDK callback ABI without WRL/MSVC extensions; usable by the existing MinGW Qt
// build.
template <class I, class... Args>
class Callback final : public I {
  std::atomic<ULONG> refs{1};
  GUID iid;
  std::function<HRESULT(Args...)> fn;

 public:
  Callback(const wchar_t* id, std::function<HRESULT(Args...)> f)
      : iid(guid(id)), fn(std::move(f)) {}
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id, void** out) override {
    if (!out) return E_POINTER;
    *out = nullptr;
    if (IsEqualIID(id, IID_IUnknown) || IsEqualIID(id, iid)) {
      *out = static_cast<I*>(this);
      AddRef();
      return S_OK;
    }
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++refs; }
  ULONG STDMETHODCALLTYPE Release() override {
    auto n = --refs;
    if (!n) delete this;
    return n;
  }
  HRESULT STDMETHODCALLTYPE Invoke(Args... args) override {
    return fn(args...);
  }
};
template <class I, class... Args, class F>
auto callback(const wchar_t* id, F fn) {
  return new Callback<I, Args...>(id, fn);
}
QString takeString(LPWSTR text) {
  auto out = QString::fromWCharArray(text ? text : L"");
  CoTaskMemFree(text);
  return out;
}
}  // namespace
struct SourceBrowser::State {
  ICoreWebView2Controller* controller = nullptr;
  ICoreWebView2* view = nullptr;
  bool initialized = false, com = false, capturing = false, usable = false;
  bool collectionActive = false;
  quint64 generation = 0, captureId = 0;
  quint64 responseId = 0;
  QJsonObject detail;
  QUrl detailPage;
  QElapsedTimer detailAge;
};
SourceBrowser::SourceBrowser(QWidget* parent)
    : QWidget(parent), state(std::make_unique<State>()) {
  Q_INIT_RESOURCE(resources);
  setAttribute(Qt::WA_NativeWindow);
  setObjectName("platformSourceBrowser");
}
SourceBrowser::~SourceBrowser() {
  if (state->controller) state->controller->Close();
  if (state->view) state->view->Release();
  if (state->controller) state->controller->Release();
  if (state->com) CoUninitialize();
}
bool SourceBrowser::allowed(const QUrl& u) {
  return u.isValid() && u.scheme() == "https" && u.userInfo().isEmpty() &&
         (u.port() == -1 || u.port() == 443) &&
         QStringList{"www.douyin.com", "douyin.com"}.contains(u.host());
}
QUrl SourceBrowser::source() const {
  LPWSTR text = nullptr;
  if (state->view) state->view->get_Source(&text);
  return QUrl(takeString(text));
}
void SourceBrowser::initialize(const QString& profile) {
  if (state->initialized) return;
  state->initialized = true;
  if (!QDir::isAbsolutePath(profile) || !QDir().mkpath(profile)) {
    emit failure("独立来源会话目录不可用");
    return;
  }
  auto hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(hr)) {
    emit failure("来源会话COM初始化失败");
    return;
  }
  state->com = true;
  auto dll = QDir(QApplication::applicationDirPath())
                 .filePath("WebView2Loader.dll")
                 .toStdWString();
  // Keep the trusted absolute-path loader for process lifetime: pending COM
  // callbacks may outlive a widget.
  static HMODULE library = LoadLibraryExW(
      dll.c_str(), nullptr,
      LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
  using Create = HRESULT(STDAPICALLTYPE*)(
      PCWSTR, PCWSTR, ICoreWebView2EnvironmentOptions*,
      ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*);
  auto create = library
                    ? reinterpret_cast<Create>(GetProcAddress(
                          library, "CreateCoreWebView2EnvironmentWithOptions"))
                    : nullptr;
  if (!create) {
    emit failure("缺少官方WebView2Loader；行情和原生业务不受影响");
    return;
  }
  QPointer<SourceBrowser> self(this);
  auto completed =
      callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler,
               HRESULT, ICoreWebView2Environment*>(
          L"{4e8a3389-c9d8-4bd2-b6b5-124fee6cc14d}",
          [self](HRESULT error, ICoreWebView2Environment* env) {
            if (!self) return S_OK;
            if (FAILED(error) || !env) {
              emit self->failure("WebView2运行时不可用；未读取旧登录会话");
              return S_OK;
            }
            auto controller = callback<
                ICoreWebView2CreateCoreWebView2ControllerCompletedHandler,
                HRESULT, ICoreWebView2Controller*>(
                L"{6c4819f3-c9b7-4260-8127-c9f5bde7f68c}",
                [self](HRESULT error, ICoreWebView2Controller* c) {
                  if (!self) {
                    if (c) c->Close();
                    return S_OK;
                  }
                  if (FAILED(error) || !c) {
                    emit self->failure("来源页面创建失败");
                    return S_OK;
                  }
                  self->attach(c);
                  return S_OK;
                });
            auto hr = env->CreateCoreWebView2Controller(
                reinterpret_cast<HWND>(self->winId()), controller);
            controller->Release();
            if (FAILED(hr)) emit self->failure("来源页面控制器启动失败");
            return S_OK;
          });
  hr = create(nullptr, profile.toStdWString().c_str(), nullptr, completed);
  completed->Release();
  if (FAILED(hr)) emit failure("来源会话启动失败");
}
void SourceBrowser::attach(void* pointer) {
  state->controller = static_cast<ICoreWebView2Controller*>(pointer);
  state->controller->AddRef();
  if (FAILED(state->controller->get_CoreWebView2(&state->view))) {
    emit failure("来源引擎不可用");
    return;
  }
  auto reject = [this] {
    state->controller->Close();
    emit failure("无法应用来源隔离规则，已关闭来源引擎");
  };
  ICoreWebView2Settings* settings = nullptr;
  if (FAILED(state->view->get_Settings(&settings)) || !settings) {
    reject();
    return;
  }
  const bool safe =
      SUCCEEDED(settings->put_AreHostObjectsAllowed(FALSE)) &&
      SUCCEEDED(settings->put_IsWebMessageEnabled(FALSE)) &&
      SUCCEEDED(settings->put_AreDefaultScriptDialogsEnabled(FALSE)) &&
      SUCCEEDED(settings->put_AreDevToolsEnabled(FALSE)) &&
      SUCCEEDED(settings->put_AreDefaultContextMenusEnabled(FALSE));
  settings->Release();
  if (!safe) {
    reject();
    return;
  }
  QPointer<SourceBrowser> self(this);
  EventRegistrationToken ignored{};
  auto navigation =
      callback<ICoreWebView2NavigationStartingEventHandler, ICoreWebView2*,
               ICoreWebView2NavigationStartingEventArgs*>(
          L"{9adbe429-f36d-432b-9ddc-f8881fbd76e3}", [self](auto*, auto* args) {
            if (!self) {
              args->put_Cancel(TRUE);
              return S_OK;
            }
            LPWSTR uri = nullptr;
            args->get_Uri(&uri);
            auto url = QUrl(takeString(uri));
            ++self->state->generation;
            ++self->state->responseId;
            self->state->detail = {};
            if (!allowed(url)) {
              args->put_Cancel(TRUE);
              emit self->failure("已阻止跳出抖音HTTPS来源页");
            }
            return S_OK;
          });
  auto registration = state->view->add_NavigationStarting(navigation, &ignored);
  navigation->Release();
  if (FAILED(registration)) {
    reject();
    return;
  }
  // Observe only the detail response the official page itself requested. No
  // additional fetch, request/header mutation, cookie access or traffic log.
  ICoreWebView2_2* responses = nullptr;
  if (FAILED(state->view->QueryInterface(guid(L"{9E8F0CF8-E670-4B5E-B2BC-73E061E3184C}"),
      reinterpret_cast<void**>(&responses))) || !responses) {
    reject();
    return;
  }
  auto response = callback<ICoreWebView2WebResourceResponseReceivedEventHandler,
      ICoreWebView2*, ICoreWebView2WebResourceResponseReceivedEventArgs*>(
      L"{7de9898a-24f5-40c3-a2de-d4f458e69828}", [self](auto*, auto* args) {
        if (!self) return S_OK;
        ICoreWebView2WebResourceRequest* request = nullptr;
        if (FAILED(args->get_Request(&request)) || !request) return S_OK;
        LPWSTR uri = nullptr, method = nullptr;
        request->get_Uri(&uri);
        request->get_Method(&method);
        const QUrl url(takeString(uri));
        const auto verb = takeString(method);
        request->Release();
        const auto page = self->source();
        if (verb != "GET" || !sourceDetailResponse::accepts(page, url)) return S_OK;
        const auto generation = self->state->generation;
        const auto responseId = ++self->state->responseId;
        self->state->detail = {};
        ICoreWebView2WebResourceResponseView* view = nullptr;
        if (FAILED(args->get_Response(&view)) || !view) return S_OK;
        int status = 0;
        view->get_StatusCode(&status);
        if (status != 200) { view->Release(); return S_OK; }
        auto content = callback<ICoreWebView2WebResourceResponseViewGetContentCompletedHandler,
            HRESULT, IStream*>(L"{875738e1-9fa2-40e3-8b74-2e8972dd6fe7}",
            [self, page, generation, responseId](HRESULT error, IStream* stream) {
              if (!self || FAILED(error) || !stream || generation != self->state->generation ||
                  responseId != self->state->responseId || page != self->source()) return S_OK;
              QByteArray body;
              char chunk[65536];
              ULONG read = 0;
              for (;;) {
                const auto hr = stream->Read(chunk, sizeof(chunk), &read);
                if (FAILED(hr) || body.size() + read > 2 * 1024 * 1024) return S_OK;
                body.append(chunk, read);
                if (hr == S_FALSE || read == 0) break;
              }
              self->state->detail = sourceDetailResponse::select(body, sourceDetailResponse::work(page));
              self->state->detailPage = page;
              self->state->detailAge.start();
              return S_OK;
            });
        view->GetContent(content);
        content->Release();
        view->Release();
        return S_OK;
      });
  registration = responses->add_WebResourceResponseReceived(response, &ignored);
  response->Release();
  responses->Release();
  if (FAILED(registration)) { reject(); return; }
  auto loaded =
      callback<ICoreWebView2NavigationCompletedEventHandler, ICoreWebView2*,
               ICoreWebView2NavigationCompletedEventArgs*>(
          L"{d33a35bf-1c49-4f98-93ab-006e0533fe1c}", [self](auto*, auto* args) {
            if (self) {
              BOOL success = FALSE;
              args->get_IsSuccess(&success);
              emit self->loaded(self->source(), success);
            }
            return S_OK;
          });
  registration = state->view->add_NavigationCompleted(loaded, &ignored);
  loaded->Release();
  if (FAILED(registration)) {
    reject();
    return;
  }
  auto popup =
      callback<ICoreWebView2NewWindowRequestedEventHandler, ICoreWebView2*,
               ICoreWebView2NewWindowRequestedEventArgs*>(
          L"{d4c185fe-c81c-4989-97af-2d3fa7ab5651}", [self](auto*, auto* args) {
            args->put_Handled(TRUE);
            LPWSTR uri = nullptr;
            args->get_Uri(&uri);
            auto url = QUrl(takeString(uri));
            if (self) self->navigate(url);
            return S_OK;
          });
  registration = state->view->add_NewWindowRequested(popup, &ignored);
  popup->Release();
  if (FAILED(registration)) {
    reject();
    return;
  }
  auto permission =
      callback<ICoreWebView2PermissionRequestedEventHandler, ICoreWebView2*,
               ICoreWebView2PermissionRequestedEventArgs*>(
          L"{15e1c6a3-c72a-4df3-91d7-d097fbec6bfd}", [](auto*, auto* args) {
            args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY);
            return S_OK;
          });
  registration = state->view->add_PermissionRequested(permission, &ignored);
  permission->Release();
  if (FAILED(registration)) {
    reject();
    return;
  }
  ICoreWebView2_4* downloads = nullptr;
  auto hr = state->view->QueryInterface(
      guid(L"{20d02d59-6df2-42dc-bd06-f98a694b1302}"),
      reinterpret_cast<void**>(&downloads));
  if (FAILED(hr) || !downloads) {
    emit failure("来源运行时过旧，无法安全限制下载");
    state->controller->Close();
    return;
  }
  auto download =
      callback<ICoreWebView2DownloadStartingEventHandler, ICoreWebView2*,
               ICoreWebView2DownloadStartingEventArgs*>(
          L"{efedc989-c396-41ca-83f7-07f845a55724}", [](auto*, auto* args) {
            args->put_Cancel(TRUE);
            args->put_Handled(TRUE);
            return S_OK;
          });
  registration = downloads->add_DownloadStarting(download, &ignored);
  download->Release();
  downloads->Release();
  if (FAILED(registration)) {
    reject();
    return;
  }
  syncPresentation();
  state->usable = true;
  emit ready();
}
void SourceBrowser::navigate(const QUrl& url) {
  if (!allowed(url)) {
    emit failure("只允许抖音HTTPS页面；不打开本机文件或其他站点");
    return;
  }
  if (!state->usable) {
    emit failure("来源引擎尚未就绪");
    return;
  }
  ++state->captureId;
  state->capturing = false;
  if (FAILED(state->view->Navigate(
          url.toString(QUrl::FullyEncoded).toStdWString().c_str())))
    emit failure("来源页面导航失败");
}
void SourceBrowser::capture() {
  auto before = source();
  if (!state->usable || !allowed(before) || state->capturing) {
    emit failure("页面未就绪或正在读取");
    return;
  }
  QFile script(":/douyin-snapshot.js");
  if (!script.open(QIODevice::ReadOnly)) {
    emit failure("缺少只读来源提取器");
    return;
  }
  const bool freshDetail = before == state->detailPage && state->detailAge.isValid() &&
      state->detailAge.elapsed() < 120000;
  const auto detail = freshDetail ? state->detail : QJsonObject{};
  auto code = ("(function(sourceResponseDetail){return (\n" + QString::fromUtf8(script.readAll()).trimmed() +
      "\n);})(" + QString::fromUtf8(QJsonDocument(detail).toJson(QJsonDocument::Compact)) + ")").toStdWString();
  state->capturing = true;
  auto generation = state->generation, run = ++state->captureId;
  QPointer<SourceBrowser> self(this);
  auto handler =
      callback<ICoreWebView2ExecuteScriptCompletedHandler, HRESULT, LPCWSTR>(
          L"{49511172-cc67-4bca-9923-137112f4c4cc}",
          [self, before, generation, run, detail](HRESULT error, LPCWSTR json) {
            if (!self || run != self->state->captureId) return S_OK;
            self->state->capturing = false;
            if (FAILED(error) || generation != self->state->generation ||
                before != self->source()) {
              emit self->failure("读取期间来源改变，结果未采用");
              return S_OK;
            }
            auto text = QString::fromWCharArray(json ? json : L"");
            if (text.size() > 2 * 1024 * 1024) {
              emit self->failure("来源快照过大");
              return S_OK;
            }
            auto doc = QJsonDocument::fromJson(text.toUtf8());
            auto page = doc.object();
            if (!doc.isObject() || QUrl(page["pageUrl"].toString()) != before) {
              emit self->failure("页面身份不匹配，未入库");
              return S_OK;
            }
            auto structure = page["structure"].toObject();
            structure["observedDetailReady"] = !detail.isEmpty();
            page["structure"] = structure;
            emit self->snapshot(page);
            return S_OK;
          });
  auto hr = state->view->ExecuteScript(code.c_str(), handler);
  handler->Release();
  if (FAILED(hr)) {
    state->capturing = false;
    emit failure("只读页面提取失败");
    return;
  }
  QTimer::singleShot(15000, this, [self, run] {
    if (self && self->state->capturing && self->state->captureId == run) {
      self->state->capturing = false;
      ++self->state->captureId;
      emit self->failure("页面读取超时，未写入资料");
    }
  });
}
void SourceBrowser::stop() {
  setCollectionActive(false);
  ++state->generation;
  ++state->captureId;
  ++state->responseId;
  state->detail = {};
  state->capturing = false;
  if (state->usable) state->view->Stop();
}
void SourceBrowser::resizeEvent(QResizeEvent* e) {
  QWidget::resizeEvent(e);
  syncPresentation();
}
void SourceBrowser::syncPresentation() {
  if (state->controller) {
    RECT r{};
    GetClientRect(reinterpret_cast<HWND>(winId()), &r);
    // A hidden Qt tab must not suspend the explicitly running source page's
    // rendering/lazy loading. Use a useful viewport until its real page shows.
    if (state->collectionActive && !isVisible()) {
      r.right = qMax<LONG>(r.right, 900); r.bottom = qMax<LONG>(r.bottom, 700);
    }
    state->controller->put_Bounds(r);
    state->controller->put_IsVisible(isVisible() || state->collectionActive);
  }
}
void SourceBrowser::setCollectionActive(bool active) {
  state->collectionActive = active;
  syncPresentation();
}
bool SourceBrowser::collectionActive() const { return state->collectionActive; }
void SourceBrowser::showEvent(QShowEvent* e) {
  QWidget::showEvent(e);
  syncPresentation();
}
void SourceBrowser::hideEvent(QHideEvent* e) {
  QWidget::hideEvent(e);
  syncPresentation();
}
