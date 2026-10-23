#include "board_series_feed.hpp"
#include "ths_board_public.hpp"
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
  pending=q;bytes.clear();daily={};receipts={};thsInventory={};thsCode.clear();detailHash.clear();checkedAt=QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);running=true;++generation;deadline.start(12000);request(url(q));return true;
}
void Feed::request(const QUrl& target){
  bytes.clear();auto token=generation;QNetworkRequest request(target);request.setRawHeader("Referer",pending["provider"]==thsBoard::provider?"https://q.10jqka.com.cn/":"https://quote.eastmoney.com/");request.setRawHeader("User-Agent","Mozilla/5.0 NativeMarketReview");request.setRawHeader("Cookie","");request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);request.setAttribute(QNetworkRequest::CookieLoadControlAttribute,QNetworkRequest::Manual);request.setAttribute(QNetworkRequest::CookieSaveControlAttribute,QNetworkRequest::Manual);request.setAttribute(QNetworkRequest::AuthenticationReuseAttribute,QNetworkRequest::Manual);request.setTransferTimeout(qMax(1,deadline.remainingTime()));
  if(pending["provider"]==thsBoard::provider){request.setAttribute(QNetworkRequest::CacheLoadControlAttribute,QNetworkRequest::AlwaysNetwork);request.setRawHeader("Cache-Control","no-cache");}reply=transport->get(request);if(!reply){finish("Board request did not start");return;}reply->setReadBufferSize(65536);auto r=reply.data();
  connect(r,&QIODevice::readyRead,this,[this,r,token]{if(running&&token==generation&&reply==r)consume();});
  connect(r,&QNetworkReply::finished,this,[this,r,token,target]{if(!running||token!=generation||reply!=r)return;consume();if(!running)return;auto status=r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();auto failure=r->error()==QNetworkReply::NoError&&status==200&&r->url()==target?QString():QString("HTTP %1：%2；来源未返回有效板块历史").arg(status).arg(r->errorString());if(!failure.isEmpty()){finish(failure);return;}r->disconnect(this);reply=nullptr;r->deleteLater();try{receive();}catch(const std::exception& e){finish(QString::fromUtf8(e.what()));}});
  connect(r,&QObject::destroyed,this,[this,token]{if(running&&token==generation)finish("板块来源连接已关闭");});
}
void Feed::receive(){
 if(pending["provider"]!=thsBoard::provider){finish();return;}
 if(thsCode.isEmpty()){thsCode=thsBoard::chartCode(bytes,pending["taxonomy"].toString(),pending["code"].toString());detailHash=thsBoard::sha(bytes);request(thsBoard::inventoryUrl(thsCode));return;}
 if(thsInventory.isEmpty()){thsInventory=thsBoard::inventory(bytes,thsCode,checkedAt);thsYear=thsInventory["yearCounts"].toObject().keys().last().toInt();request(thsBoard::yearUrl(thsCode,thsYear));return;}
 auto rows=thsBoard::annual(bytes,thsCode,thsYear,checkedAt);receipts.append(QJsonObject{{"year",thsYear},{"url",thsBoard::yearUrl(thsCode,thsYear).toString()},{"sha256",thsBoard::sha(bytes)},{"count",rows.size()}});for(auto v:daily)rows.append(v);daily=rows;
 if(daily.size()>=qMin(pending["rawDays"].toInt(),thsInventory["total"].toInt())){finish();return;}auto years=thsInventory["yearCounts"].toObject().keys();int index=years.indexOf(QString::number(thsYear));if(receipts.size()>=9||index<=0){finish("同花顺有界读取未满足来源声明；未替换旧历史");return;}thsYear=years[index-1].toInt();request(thsBoard::yearUrl(thsCode,thsYear));
}
void Feed::consume(){
  if(!running||!reply)return;auto length=reply->header(QNetworkRequest::ContentLengthHeader);if(length.isValid()&&length.toLongLong()>2*1024*1024){finish("板块响应超过2MiB");return;}
  while(reply&&reply->bytesAvailable()>0){auto chunk=reply->read(2*1024*1024-bytes.size()+1);if(chunk.isEmpty()){finish("板块来源读取未前进");return;}bytes+=chunk;if(bytes.size()>2*1024*1024){finish("板块响应超过2MiB");return;}}
}
void Feed::cancel(){
  ++generation;running=false;deadline.stop();auto r=reply;reply=nullptr;if(r){r->disconnect(this);if(!r->isFinished())r->abort();r->deleteLater();}bytes.clear();pending={};
}
void Feed::finish(const QString& failure){
  if(!running)return;auto q=pending;QString error=failure;QJsonObject result;try{if(error.isEmpty()){auto at=QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);result=q["provider"]==thsBoard::provider?fromThs(daily,receipts,thsCode,detailHash,q,at,thsInventory):parse(bytes,q,at);}}catch(const std::exception& e){error=QString::fromUtf8(e.what());}
  running=false;deadline.stop();auto r=reply;reply=nullptr;if(r){r->disconnect(this);if(!r->isFinished())r->abort();r->deleteLater();}bytes.clear();pending={};emit finished(q,result,error.left(2000));
}
}
