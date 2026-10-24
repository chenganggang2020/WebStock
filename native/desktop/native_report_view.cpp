#include "native_report_view.hpp"
#include <QApplication>
#include <QDir>
#include <QJsonDocument>
#include <QJsonObject>
#include <QPointer>
#include <QTimer>
#ifdef Q_OS_WIN
#include <windows.h>
#include <shlwapi.h>
#include <WebView2.h>
#include <atomic>
#include <functional>

namespace {
template<class I, class... Args> class Handler final : public I {
    std::atomic<ULONG> refs{1}; GUID iid;
    std::function<HRESULT(Args...)> function;
public:
    Handler(REFIID id,std::function<HRESULT(Args...)> fn):iid(id),function(std::move(fn)){}
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID id,void** out) override {
        if(!out)return E_POINTER;*out=nullptr;
        if(IsEqualIID(id,IID_IUnknown)||IsEqualIID(id,iid)){*out=static_cast<I*>(this);AddRef();return S_OK;}return E_NOINTERFACE;
    }
    ULONG STDMETHODCALLTYPE AddRef() override{return ++refs;}
    ULONG STDMETHODCALLTYPE Release() override{auto n=--refs;if(!n)delete this;return n;}
    HRESULT STDMETHODCALLTYPE Invoke(Args... args) override{return function(args...);}
};
QString take(LPWSTR value){auto out=QString::fromWCharArray(value?value:L"");CoTaskMemFree(value);return out;}
}
#endif

struct NativeReportView::State {
    QByteArray html;QString profile;bool started=false;int checks=0;
#ifdef Q_OS_WIN
    bool com=false;
    ICoreWebView2Environment* environment=nullptr;
    ICoreWebView2Controller* controller=nullptr;
    ICoreWebView2* view=nullptr;
#endif
};
QUrl NativeReportView::reportUrl(){return QUrl("https://webstock-report.invalid/report.html");}
bool NativeReportView::allowedNavigation(const QUrl& url){return url==reportUrl();}
NativeReportView::NativeReportView(QByteArray html,QString profile,QWidget* parent):QWidget(parent),state_(std::make_unique<State>()){
    state_->html=std::move(html);state_->profile=std::move(profile);setObjectName("pluginNativeReportView");
    setAttribute(Qt::WA_NativeWindow);setMinimumSize(320,420);
}
NativeReportView::~NativeReportView(){
#ifdef Q_OS_WIN
    if(state_->controller)state_->controller->Close();
    if(state_->view)state_->view->Release();
    if(state_->controller)state_->controller->Release();
    if(state_->environment)state_->environment->Release();
    if(state_->com)CoUninitialize();
#endif
}
void NativeReportView::initialize(){
    if(state_->started)return;state_->started=true;
#ifdef Q_OS_WIN
    if(state_->html.isEmpty()||state_->html.size()>16*1024*1024||!QDir::isAbsolutePath(state_->profile)||!QDir().mkpath(state_->profile)){
        emit failure("原版报告或独立显示目录不可用");return;
    }
    auto hr=CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
    if(FAILED(hr)){emit failure("原版报告显示组件初始化失败");return;}state_->com=true;
    const auto dll=QDir(QApplication::applicationDirPath()).filePath("WebView2Loader.dll").toStdWString();
    static HMODULE library=LoadLibraryExW(dll.c_str(),nullptr,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_DEFAULT_DIRS);
    using Create=HRESULT(STDAPICALLTYPE*)(PCWSTR,PCWSTR,ICoreWebView2EnvironmentOptions*,ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler*);
    auto create=library?reinterpret_cast<Create>(GetProcAddress(library,"CreateCoreWebView2EnvironmentWithOptions")):nullptr;
    if(!create){emit failure("缺少 WebView2Loader；可导出原版报告查看");return;}
    QPointer<NativeReportView> self(this);
    auto callback=new Handler<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler,HRESULT,ICoreWebView2Environment*>(IID_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler,[self](HRESULT error,ICoreWebView2Environment* env){
        if(!self)return S_OK;
        if(FAILED(error)||!env){emit self->failure("WebView2 运行时不可用；可导出原版报告查看");return S_OK;}
        self->state_->environment=env;env->AddRef();
        auto done=new Handler<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler,HRESULT,ICoreWebView2Controller*>(IID_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler,[self](HRESULT error,ICoreWebView2Controller* c){
            if(!self){if(c)c->Close();return S_OK;}
            if(FAILED(error)||!c){emit self->failure("原版报告窗口创建失败");return S_OK;}self->attach(c);return S_OK;
        });
        auto hr=env->CreateCoreWebView2Controller(reinterpret_cast<HWND>(self->winId()),done);done->Release();
        if(FAILED(hr))emit self->failure("原版报告窗口启动失败");return S_OK;
    });
    hr=create(nullptr,state_->profile.toStdWString().c_str(),nullptr,callback);callback->Release();
    if(FAILED(hr))emit failure("原版报告环境启动失败");
#else
    emit failure("当前平台未提供内嵌报告组件；可导出原版HTML报告");
#endif
}
void NativeReportView::attach(void* pointer){
#ifdef Q_OS_WIN
    state_->controller=static_cast<ICoreWebView2Controller*>(pointer);state_->controller->AddRef();
    if(FAILED(state_->controller->get_CoreWebView2(&state_->view))){emit failure("原版报告引擎不可用");return;}
    auto reject=[this]{state_->controller->Close();emit failure("原版报告隔离设置失败，已关闭显示组件");};
    ICoreWebView2Settings* settings=nullptr;
    if(FAILED(state_->view->get_Settings(&settings))||!settings){reject();return;}
    bool safe=SUCCEEDED(settings->put_AreHostObjectsAllowed(FALSE))&&SUCCEEDED(settings->put_IsWebMessageEnabled(FALSE))&&
        SUCCEEDED(settings->put_AreDefaultScriptDialogsEnabled(FALSE))&&SUCCEEDED(settings->put_AreDevToolsEnabled(FALSE));
    settings->Release();if(!safe){reject();return;}
    QPointer<NativeReportView> self(this);EventRegistrationToken token{};
    auto navigation=new Handler<ICoreWebView2NavigationStartingEventHandler,ICoreWebView2*,ICoreWebView2NavigationStartingEventArgs*>(IID_ICoreWebView2NavigationStartingEventHandler,[self](auto*,auto* args){
        LPWSTR raw=nullptr;args->get_Uri(&raw);const QUrl url(take(raw));
        if(!self||!allowedNavigation(url)){args->put_Cancel(TRUE);if(self)self->setProperty("reportBlockedNavigation",url.toString());}return S_OK;
    });
    auto hr=state_->view->add_NavigationStarting(navigation,&token);navigation->Release();if(FAILED(hr)){reject();return;}
    // Serve only the verified in-memory HTML, through a private origin. There is
    // no local HTTP listener, file:// access, CDN or data-fetching endpoint.
    if(FAILED(state_->view->AddWebResourceRequestedFilter(L"*",COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL))){reject();return;}
    auto resource=new Handler<ICoreWebView2WebResourceRequestedEventHandler,ICoreWebView2*,ICoreWebView2WebResourceRequestedEventArgs*>(IID_ICoreWebView2WebResourceRequestedEventHandler,[self](auto*,auto* args){
        if(!self)return S_OK;ICoreWebView2WebResourceRequest* request=nullptr;args->get_Request(&request);
        LPWSTR uri=nullptr,method=nullptr;if(request){request->get_Uri(&uri);request->get_Method(&method);request->Release();}
        const auto url=QUrl(take(uri));const auto verb=take(method);const bool allowed=allowedNavigation(url)&&verb=="GET";
        auto bytes=allowed?self->state_->html:QByteArray("Blocked");
        IStream* stream=SHCreateMemStream(reinterpret_cast<const BYTE*>(bytes.constData()),UINT(bytes.size()));
        if(!stream)return E_OUTOFMEMORY;
        ICoreWebView2WebResourceResponse* response=nullptr;
        const wchar_t* headers=L"Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'\r\n";
        auto hr=self->state_->environment->CreateWebResourceResponse(stream,allowed?200:403,allowed?L"OK":L"Blocked",headers,&response);stream->Release();
        if(SUCCEEDED(hr)&&response){args->put_Response(response);response->Release();}
        if(!allowed)self->setProperty("reportBlockedResource",url.toString());return hr;
    });
    hr=state_->view->add_WebResourceRequested(resource,&token);resource->Release();if(FAILED(hr)){reject();return;}
    auto popup=new Handler<ICoreWebView2NewWindowRequestedEventHandler,ICoreWebView2*,ICoreWebView2NewWindowRequestedEventArgs*>(IID_ICoreWebView2NewWindowRequestedEventHandler,[](auto*,auto* args){args->put_Handled(TRUE);return S_OK;});
    hr=state_->view->add_NewWindowRequested(popup,&token);popup->Release();if(FAILED(hr)){reject();return;}
    auto permission=new Handler<ICoreWebView2PermissionRequestedEventHandler,ICoreWebView2*,ICoreWebView2PermissionRequestedEventArgs*>(IID_ICoreWebView2PermissionRequestedEventHandler,[](auto*,auto* args){args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY);return S_OK;});
    hr=state_->view->add_PermissionRequested(permission,&token);permission->Release();if(FAILED(hr)){reject();return;}
    auto complete=new Handler<ICoreWebView2NavigationCompletedEventHandler,ICoreWebView2*,ICoreWebView2NavigationCompletedEventArgs*>(IID_ICoreWebView2NavigationCompletedEventHandler,[self](auto*,auto* args){
        if(!self)return S_OK;BOOL success=FALSE;args->get_IsSuccess(&success);
        if(success){self->setProperty("reportLoaded",true);emit self->loaded();self->inspectRenderedDocument();}
        else emit self->failure("原版报告载入失败，可导出报告检查");return S_OK;
    });
    hr=state_->view->add_NavigationCompleted(complete,&token);complete->Release();if(FAILED(hr)){reject();return;}
    syncBounds();
    if(FAILED(state_->view->Navigate(reportUrl().toString().toStdWString().c_str())))emit failure("原版报告导航失败");
#else
    Q_UNUSED(pointer);
#endif
}
void NativeReportView::inspectRenderedDocument(){
#ifdef Q_OS_WIN
    if(!state_->view||++state_->checks>60)return;
    QPointer<NativeReportView> self(this);
    // Read-only renderer health check, including Bokeh's shadow roots.
    auto done=new Handler<ICoreWebView2ExecuteScriptCompletedHandler,HRESULT,LPCWSTR>(IID_ICoreWebView2ExecuteScriptCompletedHandler,[self](HRESULT error,LPCWSTR json){
        if(!self)return S_OK;
        auto result=QJsonDocument::fromJson(QString::fromWCharArray(json?json:L"{}").toUtf8()).object();
        int count=result.value("canvases").toInt();self->setProperty("reportCanvasCount",count);
        if(SUCCEEDED(error)&&count>=4){self->setProperty("reportRendered",true);emit self->rendered(count);}
        else if(self->state_->checks>=60)emit self->failure("原版报告图表未完成渲染；明细仍可查看或导出报告");
        else QTimer::singleShot(250,self,[self]{if(self)self->inspectRenderedDocument();});return S_OK;
    });
    state_->view->ExecuteScript(L"(()=>{let n=0;function scan(root){for(const e of root.querySelectorAll('*')){if(e.tagName==='CANVAS'&&e.width>0&&e.height>0)n++;if(e.shadowRoot)scan(e.shadowRoot);}}scan(document);return {canvases:n};})()",done);done->Release();
#endif
}
void NativeReportView::syncBounds(){
#ifdef Q_OS_WIN
    if(state_->controller){RECT r{};GetClientRect(reinterpret_cast<HWND>(winId()),&r);state_->controller->put_Bounds(r);state_->controller->put_IsVisible(isVisible());}
#endif
}
void NativeReportView::showEvent(QShowEvent* e){QWidget::showEvent(e);initialize();syncBounds();}
void NativeReportView::hideEvent(QHideEvent* e){QWidget::hideEvent(e);syncBounds();}
void NativeReportView::resizeEvent(QResizeEvent* e){QWidget::resizeEvent(e);syncBounds();}
