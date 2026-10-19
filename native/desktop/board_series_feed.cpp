#include "board_series_feed.hpp"
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QDateTime>
#include <QThread>
#include <stdexcept>
namespace boardSeries {
Feed::Feed(QObject* parent,QNetworkAccessManager* manager):QObject(parent),transport(manager?manager:new QNetworkAccessManager(this)){
  deadline.setSingleShot(true);connect(&deadline,&QTimer::timeout,this,[this]{finish("板块历史读取超过12秒；未重试，旧缓存保留");});
}
Feed::~Feed(){cancel();}
bool Feed::start(const QJsonObject& q){
  key(q);if(running)return false;if(!transport||QThread::currentThread()!=thread()||transport->thread()!=thread())throw std::runtime_error("Board network owner unavailable or wrong thread");
  pending=q;bytes.clear();running=true;auto token=++generation;QNetworkRequest request(url(q));request.setRawHeader("Referer","https://quote.eastmoney.com/");request.setRawHeader("User-Agent","Mozilla/5.0 NativeMarketReview");request.setRawHeader("Cookie","");request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);request.setAttribute(QNetworkRequest::CookieLoadControlAttribute,QNetworkRequest::Manual);request.setAttribute(QNetworkRequest::CookieSaveControlAttribute,QNetworkRequest::Manual);request.setAttribute(QNetworkRequest::AuthenticationReuseAttribute,QNetworkRequest::Manual);request.setTransferTimeout(12000);
  reply=transport->get(request);if(!reply){running=false;pending={};throw std::runtime_error("Board request did not start");}reply->setReadBufferSize(65536);auto r=reply.data();deadline.start(12000);
  connect(r,&QIODevice::readyRead,this,[this,r,token]{if(running&&token==generation&&reply==r)consume();});
  connect(r,&QNetworkReply::finished,this,[this,r,token]{if(!running||token!=generation||reply!=r)return;consume();if(!running)return;auto status=r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();auto failure=r->error()==QNetworkReply::NoError&&status==200&&r->url()==url(pending)?QString():QString("HTTP %1：%2；来源未返回有效板块历史").arg(status).arg(r->errorString());finish(failure);});
  connect(r,&QObject::destroyed,this,[this,token]{if(running&&token==generation)finish("板块来源连接已关闭");});
  return true;
}
void Feed::consume(){
  if(!running||!reply)return;auto length=reply->header(QNetworkRequest::ContentLengthHeader);if(length.isValid()&&length.toLongLong()>2*1024*1024){finish("板块响应超过2MiB");return;}
  while(reply&&reply->bytesAvailable()>0){auto chunk=reply->read(2*1024*1024-bytes.size()+1);if(chunk.isEmpty()){finish("板块来源读取未前进");return;}bytes+=chunk;if(bytes.size()>2*1024*1024){finish("板块响应超过2MiB");return;}}
}
void Feed::cancel(){
  ++generation;running=false;deadline.stop();auto r=reply;reply=nullptr;if(r){r->disconnect(this);if(!r->isFinished())r->abort();r->deleteLater();}bytes.clear();pending={};
}
void Feed::finish(const QString& failure){
  if(!running)return;auto q=pending;QString error=failure;QJsonObject result;try{if(error.isEmpty())result=parse(bytes,q,QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));}catch(const std::exception& e){error=QString::fromUtf8(e.what());}
  running=false;deadline.stop();auto r=reply;reply=nullptr;if(r){r->disconnect(this);if(!r->isFinished())r->abort();r->deleteLater();}bytes.clear();pending={};emit finished(q,result,error.left(2000));
}
}
