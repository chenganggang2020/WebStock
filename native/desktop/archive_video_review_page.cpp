#include "archive_video_review_page.hpp"
#include "archive_video_review_model.hpp"
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QLabel>
#include <QPushButton>
#include <QPlainTextEdit>
#include <QScrollArea>
#include <QTabWidget>
#include <QPointer>
#include <QMetaObject>
#include <QHideEvent>
#include <QThreadPool>
#include <QSlider>
#include <QTimer>
#include "collection_presentation.hpp"
#include "win_video_session.hpp"
#include <vector>
#ifdef Q_OS_WIN
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0601
#endif
#include <windows.h>
#include <mfplay.h>
#endif
namespace {
class VideoSurface : public QWidget {
 bool queued=false,updating=false;
 void scheduleVideoPaint(){
  if(queued||updating||!repaintVideo)return;queued=true;
  // MFPlay can synchronously request WM_PAINT. Do not re-enter Qt's paint pass.
  QTimer::singleShot(0,this,[this]{queued=false;if(!repaintVideo)return;updating=true;repaintVideo();updating=false;});
 }
public:
 std::function<void()> repaintVideo;
 explicit VideoSurface(QWidget*p):QWidget(p){setMinimumHeight(180);
#ifdef Q_OS_WIN
 setAttribute(Qt::WA_NativeWindow); setAttribute(Qt::WA_PaintOnScreen);
#endif
 }
 QPaintEngine* paintEngine() const override {return nullptr;}
 void paintEvent(QPaintEvent*) override {scheduleVideoPaint();}
 void resizeEvent(QResizeEvent*) override {scheduleVideoPaint();}
};
}
struct ArchiveVideoReviewPage::State {
 bool playWhenReady=false;QSlider*progress=nullptr,*volume=nullptr;QLabel*clock=nullptr;
 bool checking=false; QJsonArray allSegments; int segmentPage=0; QVBoxLayout*segmentLayout=nullptr; QWidget*segmentContents=nullptr; QJsonObject row;QStringList roots;Current current;QLabel*status=nullptr;VideoSurface*surface=nullptr;QPushButton*play=nullptr,*pause=nullptr; QList<QPushButton*> seeks;QList<QJsonObject> segments;bool active=false,ready=false;int generation=0;
#ifdef Q_OS_WIN
 std::shared_ptr<WinVideoSession> player;
#endif
};
ArchiveVideoReviewPage::ArchiveVideoReviewPage(QJsonObject captured,QStringList roots,Current current,QWidget*parent):QWidget(parent),s(new State){s->row=captured;s->roots=roots;s->current=std::move(current);auto layout=new QVBoxLayout(this);auto title=new QLabel(captured["title"].toString()+" — 视频与文稿（只读）",this);title->setTextFormat(Qt::PlainText);title->setWordWrap(true);layout->addWidget(title);s->status=new QLabel("未打开播放器；逐字稿与媒体对应关系未自动核验",this);s->status->setWordWrap(true);layout->addWidget(s->status);s->surface=new VideoSurface(this);layout->addWidget(s->surface,3);auto controls=new QHBoxLayout;auto open=new QPushButton("核验并打开归档",this);s->play=new QPushButton("播放",this);s->pause=new QPushButton("暂停",this);controls->addWidget(open);controls->addWidget(s->play);controls->addWidget(s->pause);layout->addLayout(controls);s->play->setEnabled(false);s->pause->setEnabled(false);connect(open,&QPushButton::clicked,this,[this]{s->active=true;validate();});connect(s->play,&QPushButton::clicked,this,[this]{if(!unchanged())return;
#ifdef Q_OS_WIN
if(s->player&&s->ready)s->player->post(0);
#endif
});connect(s->pause,&QPushButton::clicked,this,[this]{
#ifdef Q_OS_WIN
if(s->player)s->player->post(1);
#endif
});auto readers=new QTabWidget(this);readers->setObjectName("archiveVideoReaders");layout->addWidget(readers,2);auto addText=[&](QString label,QString value){auto reader=new QPlainTextEdit(value,readers);reader->setReadOnly(true);reader->setMinimumHeight(150);readers->addTab(reader,label);};auto asr=captured["asrResult"].toObject();addText("当前文稿",captured["text"].toString());addText("采集原文",captured["originalText"].toString());auto transcript=asr["transcript"].toString(asr["text"].toString());if(transcript.isEmpty()&&captured["legacySource"].toString()==QStringLiteral("expert_observations"))addText("转写原稿（无时间轴）",captured["legacyOriginal"].toObject()["transcript_text"].toString());else addText("原始 ASR 全文",transcript);auto scroll=new QScrollArea(this);scroll->setWidgetResizable(true);auto contents=new QWidget(scroll);auto items=new QVBoxLayout(contents);s->allSegments=asr["segments"].toArray();s->segmentContents=contents;s->segmentLayout=items;renderSegments();scroll->setWidget(contents);layout->addWidget(scroll);scroll->setVisible(!s->allSegments.isEmpty());auto pages=new QHBoxLayout;auto previous=new QPushButton("上一页逐字稿",this);auto next=new QPushButton("下一页逐字稿",this);pages->addWidget(previous);pages->addWidget(next);previous->setVisible(!s->allSegments.isEmpty());next->setVisible(!s->allSegments.isEmpty());layout->addLayout(pages);connect(previous,&QPushButton::clicked,this,[this]{if(s->segmentPage>0){--s->segmentPage;renderSegments();}});connect(next,&QPushButton::clicked,this,[this]{if((s->segmentPage+1)*20<s->allSegments.size()){++s->segmentPage;renderSegments();}});}
void ArchiveVideoReviewPage::renderSegments(){while(auto item=s->segmentLayout->takeAt(0)){delete item->widget();delete item;}s->seeks.clear();s->segments.clear();double duration=-1;
#ifdef Q_OS_WIN
if(s->ready&&s->player)duration=s->player->snapshot()["durationSeconds"].toDouble(-1);
#endif
for(int i=s->segmentPage*20;i<qMin(s->allSegments.size(),(s->segmentPage+1)*20);++i){auto segment=s->allSegments[i].toObject();s->segments.append(segment);auto button=new QPushButton(QString("试定位 %1–%2 秒（对应关系未核验）").arg(segment["start"].toVariant().toString(),segment["end"].toVariant().toString()),s->segmentContents);bool valid=archiveVideoReview::seekSeconds(segment,duration)>=0;button->setEnabled(s->ready&&valid);if(!valid)button->setToolTip("时间缺失、无效或超过实际视频时长");s->seeks.append(button);s->segmentLayout->addWidget(button);auto text=new QLabel(segment["text"].toString(),s->segmentContents);text->setWordWrap(true);text->setTextInteractionFlags(Qt::TextSelectableByMouse);text->setTextFormat(Qt::PlainText);s->segmentLayout->addWidget(text);connect(button,&QPushButton::clicked,this,[this,segment]{
#ifdef Q_OS_WIN
if(s->player)seek(archiveVideoReview::seekSeconds(segment,s->player->snapshot()["durationSeconds"].toDouble(-1)));
#endif
});}s->segmentLayout->addStretch();}

ArchiveVideoReviewPage::ArchiveVideoReviewPage(QJsonObject row,QStringList roots,Current current,QWidget*parent,bool compact)
 :ArchiveVideoReviewPage(row,roots,std::move(current),parent){
 if(compact){
  setObjectName("collectionInlinePlayer");
  for(auto*label:findChildren<QLabel*>(QString(),Qt::FindDirectChildrenOnly))if(label!=s->status)label->setText(collectionPresentation::title(row));
  if(auto*readers=findChild<QTabWidget*>("archiveVideoReaders"))readers->hide();
  for(auto*scroll:findChildren<QScrollArea*>())scroll->hide();
  for(auto*button:findChildren<QPushButton*>()){
   if(button->text()=="上一页逐字稿"||button->text()=="下一页逐字稿")button->hide();
   if(button->text()=="核验并打开归档"){
    button->setText("重新播放");QObject::disconnect(button,&QPushButton::clicked,this,nullptr);
    connect(button,&QPushButton::clicked,this,[this]{openMedia(true);});
   }
  }
  s->surface->setMinimumSize(280,400);
  auto*layout=qobject_cast<QVBoxLayout*>(this->layout());
  s->progress=new QSlider(Qt::Horizontal,this);s->progress->setObjectName("videoProgress");s->progress->setRange(0,10000);s->progress->setEnabled(false);layout->addWidget(s->progress);
  auto*audio=new QHBoxLayout;s->clock=new QLabel("00:00 / 00:00",this);audio->addWidget(s->clock);audio->addStretch();audio->addWidget(new QLabel("音量",this));
  s->volume=new QSlider(Qt::Horizontal,this);s->volume->setObjectName("videoVolume");s->volume->setRange(0,100);s->volume->setValue(100);s->volume->setMaximumWidth(110);audio->addWidget(s->volume);layout->addLayout(audio);
  connect(s->progress,&QSlider::sliderReleased,this,[this]{auto state=playbackState();const auto duration=state["durationSeconds"].toDouble(-1);if(duration>0)seek(duration*s->progress->value()/s->progress->maximum());});
  connect(s->volume,&QSlider::valueChanged,this,[this](int value){
#ifdef Q_OS_WIN
   if(s->player)s->player->post(3,value/100.0);
#endif
  });
  auto*tick=new QTimer(this);tick->setInterval(250);connect(tick,&QTimer::timeout,this,[this]{
   if(!s->active||!s->ready)return;const auto state=playbackState();const double duration=state["durationSeconds"].toDouble(-1),position=state["positionSeconds"].toDouble(-1);
   auto time=[](double value){int seconds=qMax(0,int(value));return QString("%1:%2").arg(seconds/60,2,10,QChar('0')).arg(seconds%60,2,10,QChar('0'));};
   s->clock->setText(time(position)+" / "+time(duration));s->progress->setEnabled(duration>0);
   if(duration>0&&position>=0&&!s->progress->isSliderDown())s->progress->setValue(qBound(0,int(position/duration*10000),10000));
  });tick->start();
 }
}
void ArchiveVideoReviewPage::hideEvent(QHideEvent*event){setActive(false);QWidget::hideEvent(event);}
ArchiveVideoReviewPage::~ArchiveVideoReviewPage(){s->active=false;release();}
void ArchiveVideoReviewPage::openMedia(bool playImmediately){s->active=true;validate();s->playWhenReady=playImmediately&&s->checking;}
bool ArchiveVideoReviewPage::unchanged(){
 try{if(s->active&&s->current&&archiveVideoReview::fingerprint(s->row)==archiveVideoReview::fingerprint(s->current(s->row["id"].toString())))return true;}
 catch(const std::exception&e){release();s->status->setText(QString::fromUtf8(e.what()));return false;}
 release();s->status->setText("作品记录版本已改变，请重新选择");return false;
}
void ArchiveVideoReviewPage::release(){s->playWhenReady=false;if(s->progress){s->progress->setEnabled(false);s->progress->setValue(0);s->clock->setText("00:00 / 00:00");}++s->generation;s->checking=false;s->ready=false;s->play->setEnabled(false);s->pause->setEnabled(false);for(auto button:s->seeks)button->setEnabled(false);s->surface->repaintVideo={};
#ifdef Q_OS_WIN
if(s->player){s->player->retire();s->player.reset();}
#endif
}
namespace {
struct MediaReadLock {
#ifdef Q_OS_WIN
 HANDLE file=INVALID_HANDLE_VALUE;
 ~MediaReadLock(){if(file!=INVALID_HANDLE_VALUE)CloseHandle(file);}
#endif
};
}
void ArchiveVideoReviewPage::validate(){
 if(s->checking)return;
 release();if(!unchanged())return;
 const int token=s->generation;s->checking=true;s->status->setText("正在准备视频…");
 QPointer<ArchiveVideoReviewPage> guard(this);const auto row=s->row;const auto roots=s->roots;
 static QThreadPool* pool=[](){auto*p=new QThreadPool(QCoreApplication::instance());p->setMaxThreadCount(2);return p;}();
 pool->start([guard,row,roots,token]{
  if(!guard)return;
  auto result=archiveVideoReview::inspect(row,row,roots);auto lockedFile=std::make_shared<MediaReadLock>();
#ifdef Q_OS_WIN
  if(result["playable"].toBool()){
   const auto path=result["path"].toString();
   lockedFile->file=CreateFileW(reinterpret_cast<LPCWSTR>(path.utf16()),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);
   if(lockedFile->file==INVALID_HANDLE_VALUE){result["playable"]=false;result["reason"]="无法锁定视频文件";}
   else {
    // Hash off the GUI thread, retaining the read lock through playback.
    // The current record is independently rechecked on the GUI thread below.
    const auto locked=archiveVideoReview::inspect(row,row,roots);
    if(!locked["playable"].toBool()||locked["sha256"]!=result["sha256"]||locked["bytes"]!=result["bytes"]){
     result["playable"]=false;result["reason"]="视频文件核验前后发生变化，请重新选择";
    }
   }
  }
#endif
  if(!guard)return;
  QMetaObject::invokeMethod(guard,[guard,result,lockedFile,token]{
   if(!guard)return;auto self=guard.data();auto &s=*self->s;
   if(token!=s.generation||!s.active)return;
   s.checking=false;s.status->setText(result["reason"].toString());
   if(!result["playable"].toBool()||!self->unchanged())return;
#ifdef Q_OS_WIN
const auto parentWindow=reinterpret_cast<HWND>(s.surface->winId());RECT rect{};GetClientRect(parentWindow,&rect);
const HWND target=CreateWindowExW(0,L"STATIC",L"",WS_CHILD|WS_VISIBLE|WS_CLIPSIBLINGS,0,0,rect.right,rect.bottom,parentWindow,nullptr,GetModuleHandleW(nullptr),nullptr);
if(!target){self->release();s.status->setText("视频显示区域创建失败");return;}
const auto locked=lockedFile->file;lockedFile->file=INVALID_HANDLE_VALUE;
s.player=WinVideoSession::start(result["path"].toString(),locked,target,[guard,token](QJsonObject update){
 if(!guard||guard->s->generation!=token||!guard->s->active)return;auto&state=*guard->s;
 if(!update["error"].toString().isEmpty()){guard->release();state.status->setText(update["error"].toString());return;}
 if(update["ready"].toBool()&&!state.ready){
  if(!guard->unchanged())return;state.ready=true;state.play->setEnabled(true);state.pause->setEnabled(true);
  const auto duration=update["durationSeconds"].toDouble(-1);
  for(int i=0;i<state.seeks.size();++i)state.seeks[i]->setEnabled(archiveVideoReview::seekSeconds(state.segments[i],duration)>=0);
  state.status->setText(state.progress?"已就绪":"已就绪，等待手动播放；时间定位对应关系未自动核验");
  if(state.progress)state.progress->setEnabled(duration>0);
  if(state.volume)state.player->post(3,state.volume->value()/100.0);
  if(state.playWhenReady){state.playWhenReady=false;state.play->click();}
 }
});
s.surface->repaintVideo=[guard,target,parentWindow]{
 if(!guard||!guard->s->player||!IsWindow(target))return;RECT rect{};GetClientRect(parentWindow,&rect);MoveWindow(target,0,0,rect.right,rect.bottom,TRUE);guard->s->player->post(4);
};
#else
s.status->setText("此平台未提供本机视频播放器");
#endif
},Qt::QueuedConnection);});}
void ArchiveVideoReviewPage::seek(double seconds){if(seconds<0||!unchanged()||!s->ready)return;
#ifdef Q_OS_WIN
s->player->post(2,seconds);
#endif
}
QJsonObject ArchiveVideoReviewPage::playbackState() const {
 QJsonObject out{{"active",s->active},{"ready",s->ready},{"status",s->status->text()},{"positionSeconds",QJsonValue()},{"playing",false}};
#ifdef Q_OS_WIN
 if(s->player&&s->ready){const auto state=s->player->snapshot();for(auto i=state.begin();i!=state.end();++i)out[i.key()]=i.value();}
#endif
 return out;
}
void ArchiveVideoReviewPage::setActive(bool value){s->active=value;if(!value){release();s->status->setText(s->progress?"已停止 · 点击重新播放":"已关闭视频");}}
void ArchiveVideoReviewPage::close(){setActive(false);}
bool ArchiveVideoReviewPage::back(){close();return false;}
QJsonObject ArchiveVideoReviewPage::saveState(){return QJsonObject{{"id",s->row["id"]},{"segmentPage",s->segmentPage},{"paused",true}};}
void ArchiveVideoReviewPage::restoreState(QJsonObject state){close();if(state["id"]==s->row["id"]){s->segmentPage=qBound(0,state["segmentPage"].toInt(),qMax(0,(int(s->allSegments.size())-1)/20));renderSegments();}}




