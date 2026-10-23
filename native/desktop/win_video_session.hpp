#pragma once
#ifdef Q_OS_WIN
#include <QCoreApplication>
#include <QJsonObject>
#include <QThreadPool>
#include <windows.h>
#include <mfplay.h>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <memory>

// One MTA worker owns a player's entire COM lifetime. The GUI only reads a
// snapshot and posts bounded commands; it never waits for decoder shutdown.
class WinVideoSession : public std::enable_shared_from_this<WinVideoSession> {
 struct Command {int kind;double value;};
 std::mutex mutex;std::condition_variable wake;std::deque<Command> commands;
 bool retired=false;QJsonObject state;HWND target=nullptr;HANDLE file=INVALID_HANDLE_VALUE;
 using Notice=std::function<void(QJsonObject)>;Notice notice;
 struct Callback:IMFPMediaPlayerCallback {
  LONG refs=1;std::weak_ptr<WinVideoSession> owner;
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid,void**out)override{if(!out)return E_POINTER;*out=nullptr;if(IsEqualGUID(iid,IID_IUnknown)||IsEqualGUID(iid,__uuidof(IMFPMediaPlayerCallback))){*out=this;AddRef();return S_OK;}return E_NOINTERFACE;}
  ULONG STDMETHODCALLTYPE AddRef()override{return InterlockedIncrement(&refs);}
  ULONG STDMETHODCALLTYPE Release()override{auto n=InterlockedDecrement(&refs);if(!n)delete this;return n;}
  void STDMETHODCALLTYPE OnMediaPlayerEvent(MFP_EVENT_HEADER*h)override{if(h)if(auto p=owner.lock())p->post(100+int(h->eEventType),double(h->hrEvent));}
 };
 static double seconds(const PROPVARIANT&v){return v.vt==VT_I8?double(v.hVal.QuadPart)/10000000:v.vt==VT_UI8?double(v.uhVal.QuadPart)/10000000:-1;}
 void publish(QJsonObject value,bool notify){Notice fn;{std::lock_guard<std::mutex> lock(mutex);if(retired)return;state=value;fn=notice;}
  if(notify&&fn)QMetaObject::invokeMethod(QCoreApplication::instance(),[fn,value]{fn(value);},Qt::QueuedConnection);
 }
 void run(QString path){
  const HRESULT initialized=CoInitializeEx(nullptr,COINIT_MULTITHREADED);IMFPMediaPlayer*player=nullptr;auto callback=new Callback;callback->owner=shared_from_this();
  HRESULT hr=initialized;bool ready=false;
  wchar_t system[MAX_PATH];const UINT count=GetSystemDirectoryW(system,MAX_PATH);
  using Create=HRESULT(WINAPI*)(LPCWSTR,BOOL,MFP_CREATION_OPTIONS,IMFPMediaPlayerCallback*,HWND,IMFPMediaPlayer**);
  static HMODULE module=count&&count<MAX_PATH?LoadLibraryW(reinterpret_cast<LPCWSTR>((QString::fromWCharArray(system)+"/mfplay.dll").utf16())):nullptr;
  const auto create=module?reinterpret_cast<Create>(GetProcAddress(module,"MFPCreateMediaPlayer")):nullptr;
  bool cancelled;{std::lock_guard<std::mutex> lock(mutex);cancelled=retired;}
  if(SUCCEEDED(hr)&&!cancelled){
   hr=create?create(nullptr,FALSE,MFP_OPTION_FREE_THREADED_CALLBACK,callback,target,&player):E_NOTIMPL;
   IMFPMediaItem*item=nullptr;
   if(SUCCEEDED(hr))hr=player->CreateMediaItemFromURL(reinterpret_cast<LPCWSTR>(path.utf16()),TRUE,0,&item);
   if(SUCCEEDED(hr))hr=player->SetMediaItem(item);if(item)item->Release();
  }
  while(SUCCEEDED(hr)&&player){
   std::deque<Command> pending;
   {std::unique_lock<std::mutex> lock(mutex);wake.wait_for(lock,std::chrono::milliseconds(80),[this]{return retired||!commands.empty();});if(retired)break;pending.swap(commands);}
   bool notify=false;
   for(const auto&c:pending){
    // Cancellation wins over commands already drained from the queue.
    {std::lock_guard<std::mutex> lock(mutex);if(retired){cancelled=true;break;}}
    if(c.kind>=100){auto event=MFP_EVENT_TYPE(c.kind-100);hr=HRESULT(c.value);notify=true;if(FAILED(hr))break;if(event==MFP_EVENT_TYPE_MEDIAITEM_SET)ready=true;}
    else if(c.kind==0)hr=player->Play();
    else if(c.kind==1)hr=player->Pause();
    else if(c.kind==2){PROPVARIANT position={};position.vt=VT_I8;position.hVal.QuadPart=LONGLONG(c.value*10000000);const GUID unit={};hr=player->SetPosition(unit,&position);}
    else if(c.kind==3)hr=player->SetVolume(float(c.value));
    else if(c.kind==4)player->UpdateVideo();
    if(FAILED(hr))break;
   }
   if(cancelled||FAILED(hr))break;
   MFP_MEDIAPLAYER_STATE mode=MFP_MEDIAPLAYER_STATE_EMPTY;player->GetState(&mode);PROPVARIANT position={},duration={};const GUID unit={};float volume=0;
   player->GetPosition(unit,&position);player->GetDuration(unit,&duration);player->GetVolume(&volume);
   publish({{"ready",ready},{"playing",mode==MFP_MEDIAPLAYER_STATE_PLAYING},{"positionSeconds",seconds(position)},{"durationSeconds",seconds(duration)},{"durationType",duration.vt},{"volume",double(volume)}},notify);
  }
  if(FAILED(hr))publish({{"ready",false},{"playing",false},{"error",QString("播放器不可用（0x%1）").arg(quint32(hr),8,16,QChar('0'))}},true);
  if(player){player->SetMute(TRUE);player->Shutdown();player->Release();}callback->Release();
  if(file!=INVALID_HANDLE_VALUE){CloseHandle(file);file=INVALID_HANDLE_VALUE;}if(SUCCEEDED(initialized))CoUninitialize();
  // The native child is detached on retire, so deleting the Qt page cannot
  // destroy a decoder's target halfway through shutdown. Destroy on creator UI.
  auto hwnd=target;QMetaObject::invokeMethod(QCoreApplication::instance(),[hwnd]{if(IsWindow(hwnd))DestroyWindow(hwnd);},Qt::QueuedConnection);
 }
public:
 static std::shared_ptr<WinVideoSession> start(QString path,HANDLE file,HWND target,Notice notice){
  auto s=std::make_shared<WinVideoSession>();s->file=file;s->target=target;s->notice=std::move(notice);
  static QThreadPool*pool=[] {auto*p=new QThreadPool(QCoreApplication::instance());p->setMaxThreadCount(2);return p;}();
  pool->start([s,path]{s->run(path);});return s;
 }
 QJsonObject snapshot(){std::lock_guard<std::mutex> lock(mutex);return state;}
 void post(int kind,double value=0){std::lock_guard<std::mutex> lock(mutex);if(retired)return;
  // Coalesce mouse/slider/paint commands; events and explicit play/pause retain order.
  if(kind==2||kind==3||kind==4)for(auto it=commands.begin();it!=commands.end();)if(it->kind==kind)it=commands.erase(it);else ++it;
  if(commands.size()<128)commands.push_back({kind,value});wake.notify_one();
 }
 void retire(){
  {std::lock_guard<std::mutex> lock(mutex);retired=true;commands.clear();notice={};state={};}wake.notify_one();
  if(IsWindow(target)){ShowWindow(target,SW_HIDE);SetParent(target,HWND_MESSAGE);}
 }
};
#endif
