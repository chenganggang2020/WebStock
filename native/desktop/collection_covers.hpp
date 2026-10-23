#pragma once
#include "archive_video_review_model.hpp"
#include <QtWidgets>
#include <QThreadPool>
#include <QProcess>

// Only visible cards / the selected work request a thumbnail. No network and
// no source-media writes; decoding is bounded and stays off the GUI thread.
class CollectionCovers:public QObject {
 QCache<QString,QImage> images{96};QSet<QString> pending;
 QString mediaRoot;
public:
 std::function<void()> changed;
 explicit CollectionCovers(QString root,QObject*parent):QObject(parent),mediaRoot(root){}
 QString key(const QJsonObject&r)const{return r["id"].toString()+"|"+r["updatedAt"].toString()+"|"+r["assetPath"].toString();}
 QImage get(const QJsonObject&row){
  const auto k=key(row);if(auto*image=images.object(k))return *image;
  if(pending.contains(k)||pending.size()>=6)return {};
  if(row["assetPath"].toString().isEmpty()){images.insert(k,new QImage);return {};}
  pending.insert(k);QPointer<CollectionCovers> self(this);QStringList roots{mediaRoot};
  if(row["legacySource"]=="expert_observations")roots<<"D:/WebstockRuntime/data/media-library/douyin"<<"D:/WebstockRuntime/releases/WebStockData/media-library/douyin";
  static QThreadPool* pool=[](){auto*p=new QThreadPool(qApp);p->setMaxThreadCount(2);return p;}();
  pool->start([self,k,row,roots]{
   QImage image;const auto checked=archiveVideoReview::inspect(row,row,roots);
   const QString decoder="D:/WebstockRuntime/runtime/python/Lib/site-packages/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe";
   if(checked["playable"].toBool()&&QFileInfo::exists(decoder)){
    QProcess p;p.setProcessChannelMode(QProcess::SeparateChannels);
    p.start(decoder,{"-nostdin","-loglevel","error","-threads","1","-protocol_whitelist","file,pipe","-i",checked["path"].toString(),"-frames:v","1","-vf","scale=360:640:force_original_aspect_ratio=decrease","-f","image2pipe","-vcodec","png","pipe:1"});
    if(p.waitForFinished(8000)&&p.exitCode()==0){auto bytes=p.readAllStandardOutput();if(bytes.size()<=1024*1024)image.loadFromData(bytes,"PNG");}
    else {p.kill();p.waitForFinished(1000);}
   }
   if(self)QMetaObject::invokeMethod(self,[self,k,image]{if(!self)return;self->pending.remove(k);self->images.insert(k,new QImage(image));if(self->changed)self->changed();},Qt::QueuedConnection);
  });return {};
 }
};
class CollectionCoverLabel:public QLabel {
 QImage image;
 void fit(){setPixmap(image.isNull()?QPixmap():QPixmap::fromImage(image).scaled(contentsRect().size(),Qt::KeepAspectRatio,Qt::SmoothTransformation));}
protected:
 void resizeEvent(QResizeEvent*event)override{QLabel::resizeEvent(event);if(!image.isNull())fit();}
public:
 explicit CollectionCoverLabel(QWidget*parent):QLabel(parent){setSizePolicy(QSizePolicy::Ignored,QSizePolicy::Ignored);}
 void setCover(QImage value){image=std::move(value);fit();}
};
class CollectionCardDelegate:public QStyledItemDelegate {
 CollectionCovers*covers;
public:
 bool cards=false;
 CollectionCardDelegate(CollectionCovers*c,QObject*p):QStyledItemDelegate(p),covers(c){}
 QSize sizeHint(const QStyleOptionViewItem&,const QModelIndex&)const override{return cards?QSize(184,174):QSize(260,64);}
 void paint(QPainter*p,const QStyleOptionViewItem&o,const QModelIndex&i)const override{
  p->save();p->fillRect(o.rect,o.state&QStyle::State_Selected?o.palette.highlight():o.palette.base());
  p->setPen(o.state&QStyle::State_Selected?o.palette.highlightedText().color():o.palette.text().color());
  auto rect=o.rect.adjusted(9,7,-9,-5);auto lines=i.data().toString().split('\n');
  if(cards){auto photo=QRect(rect.left(),rect.top(),rect.width(),94);p->fillRect(photo,o.palette.alternateBase());
   auto image=covers->get(i.data(Qt::UserRole+1).toJsonObject());
   if(!image.isNull()){auto size=image.size().scaled(photo.size(),Qt::KeepAspectRatio);QRect target(QPoint(),size);target.moveCenter(photo.center());p->drawImage(target,image);}
   else p->drawText(photo,Qt::AlignCenter,"视频 · 暂无缩略图");rect.setTop(photo.bottom()+6);
  }
  auto font=o.font;font.setBold(true);p->setFont(font);QFontMetrics fm(font);
  p->drawText(QRect(rect.left(),rect.top(),rect.width(),22),Qt::AlignLeft|Qt::AlignVCenter,fm.elidedText(lines.value(0),Qt::ElideRight,rect.width()));
  font.setBold(false);font.setPointSizeF(qMax(8.0,font.pointSizeF()-1));p->setFont(font);
  p->drawText(QRect(rect.left(),rect.top()+24,rect.width(),32),Qt::AlignLeft|Qt::AlignTop|Qt::TextWordWrap,lines.mid(1).join(" · "));
  p->restore();
 }
};
