#include "tencent_detail.hpp"
#include <QJsonArray>
#include <QNetworkReply>
#include <QPointer>
#include <QRegularExpression>
#include <QThreadPool>
#include <QTimer>
#include <QUrlQuery>
#include <stdexcept>

namespace tencentDetail {
namespace {
class Request final : public QObject {
 QNetworkAccessManager* network;
 QString symbol;
 int seconds;
 QJsonObject previous, before;
 QJsonValue previousClose;
 Done done;
 std::function<QDateTime()> clock;
 QTimer deadline;
 QPointer<QNetworkReply> reply;
 QByteArray bytes;
 QJsonArray pages;
 int requestCount=0,reused=0;
 bool ended=false,oversized=false;
 void stopReply(){
  auto* r=reply.data();reply.clear();if(!r)return;r->disconnect(this);if(!r->isFinished())r->abort();r->deleteLater();
 }
 void finish(QJsonObject result,QString error){
  if(ended)return;ended=true;deadline.stop();stopReply();auto callback=std::move(done);callback(std::move(result),std::move(error));
 }
 void get(const QString& action,int index,std::function<void(QByteArray)> complete){
  QUrl url("https://stock.gtimg.cn/data/index.php");QUrlQuery query;query.addQueryItem("appn","detail");query.addQueryItem("action",action);query.addQueryItem("c",symbol);if(index>=0)query.addQueryItem("p",QString::number(index));url.setQuery(query);
  QNetworkRequest request(url);request.setRawHeader("Referer","https://gu.qq.com/");request.setRawHeader("User-Agent","Mozilla/5.0");
  request.setAttribute(QNetworkRequest::CacheLoadControlAttribute,QNetworkRequest::AlwaysNetwork);
  request.setAttribute(QNetworkRequest::CookieLoadControlAttribute,QNetworkRequest::Manual);
  request.setAttribute(QNetworkRequest::CookieSaveControlAttribute,QNetworkRequest::Manual);
  request.setAttribute(QNetworkRequest::AuthenticationReuseAttribute,QNetworkRequest::Manual);
  request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);
  request.setTransferTimeout(6000);bytes.clear();oversized=false;++requestCount;reply=network->get(request);auto* r=reply.data();
  QTimer::singleShot(6500,r,[r]{if(!r->isFinished())r->abort();});
  connect(r,&QIODevice::readyRead,this,[this,r]{if(reply!=r)return;auto chunk=r->readAll();if(bytes.size()+chunk.size()>1024*1024){oversized=true;r->abort();}else bytes+=chunk;});
  connect(r,&QNetworkReply::finished,this,[this,r,complete]{
   if(reply!=r||ended)return;auto rest=r->readAll();if(bytes.size()+rest.size()>1024*1024)oversized=true;else bytes+=rest;
   const auto status=r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();const auto error=r->error();stopReply();
   if(oversized){finish({},"腾讯分笔响应超过1MiB限制");return;}
   if(error!=QNetworkReply::NoError||status!=200){finish({},QString("腾讯分笔HTTP %1或传输未完成；原数据保留").arg(status));return;}
   try{complete(bytes);}catch(const std::exception& e){finish({},QString::fromUtf8(e.what()));}
  });
 }
 void acceptPage(QByteArray body){
  const int index=pages.size();auto rows=page(body,symbol,index,before["dataDate"].toString(),clock());
  const auto bounds=before["ranges"].toArray()[index].toString().split('~');
  const auto first=rows.first().toObject()["tradeTime"].toString(),last=rows.last().toObject()["tradeTime"].toString();
  if(first!=bounds[0]||(index<before["ranges"].toArray().size()-1&&last!=bounds[1]))throw std::runtime_error("腾讯分笔页面边界变化；本次未替换原数据");
  pages.append(QJsonObject{{"range",first+"~"+last},{"text",QString::fromUtf8(body)}});
  QTimer::singleShot(0,this,[this]{next();});
 }
 void next(){
  try{
   const int index=pages.size();if(index==before["ranges"].toArray().size()){verify();return;}
   auto cached=previous["pages"].toArray();
   if(previous["symbol"]==symbol&&previous["dataDate"]==before["dataDate"]&&index<cached.size()&&index<before["ranges"].toArray().size()-1&&cached[index].toObject()["range"]==before["ranges"].toArray()[index]){
    ++reused;acceptPage(cached[index].toObject()["text"].toString().toUtf8());return;
   }
   QTimer::singleShot(80,this,[this,index]{get("data",index,[this](QByteArray bytes){acceptPage(bytes);});});
  }catch(const std::exception& e){finish({},QString::fromUtf8(e.what()));}
 }
 void verify(){
  get("info",-1,[this](QByteArray bytes){
   const auto after=info(bytes,symbol,clock());const auto ranges=after["ranges"].toArray(),oldRanges=before["ranges"].toArray();
   if(after["dataDate"]!=before["dataDate"]||ranges.size()<pages.size())throw std::runtime_error("腾讯分笔日期或目录在下载期间改变");
   bool complete=pages.size()==ranges.size();
   for(int i=0;i<pages.size();++i){auto actual=pages[i].toObject()["range"].toString().split('~'),latest=ranges[i].toString().split('~');
    if(actual[0]!=latest[0]||actual[1]>latest[1]||(i<pages.size()-1&&oldRanges[i]!=ranges[i]))throw std::runtime_error("腾讯分笔已封页发生变化；原数据保留");
    complete&=pages[i].toObject()["range"]==ranges[i];
   }
   QJsonObject snapshot{{"symbol",symbol},{"dataDate",before["dataDate"]},{"pages",pages},{"paginationComplete",complete}};
   const auto now=clock();const int interval=seconds;const auto baseline=previousClose;const int requests=requestCount,cacheHits=reused;
   // Model creation/JSON traversal is off the GUI thread. The mailbox outlives
   // cancellation; only its GUI completion dereferences the guarded request.
   auto* mailbox=new QObject;QPointer<Request> guard(this);
   QThreadPool::globalInstance()->start([snapshot,now,interval,baseline,requests,cacheHits,mailbox,guard]{
    QJsonObject result;QString error;
    try{result=series(snapshot,interval,now,baseline);result["detailSnapshot"]=snapshot;result["networkRequests"]=requests;result["reusedPages"]=cacheHits;}
    catch(const std::exception& e){error=QString::fromUtf8(e.what());}
    QMetaObject::invokeMethod(mailbox,[guard,mailbox,result,error]{mailbox->deleteLater();if(guard)guard->finish(result,error);},Qt::QueuedConnection);
   });
  });
 }
 public:
 Request(QNetworkAccessManager* network,QObject* parent,QString symbol,int seconds,QJsonObject previous,QJsonValue previousClose,Done done,std::function<QDateTime()> clock)
  :QObject(parent),network(network),symbol(std::move(symbol)),seconds(seconds),previous(std::move(previous)),previousClose(previousClose),done(std::move(done)),clock(std::move(clock)){
  deadline.setSingleShot(true);connect(&deadline,&QTimer::timeout,this,[this]{finish({},"腾讯分笔回补达到90秒上限；原数据保留");});
 }
 ~Request()override{stopReply();}
 void start(){
  if(!QRegularExpression("^(sh|sz|bj)[0-9]{6}$").match(symbol).hasMatch()||(seconds!=5&&seconds!=30)){finish({},"腾讯分笔证券或周期无效");return;}
  deadline.start(90000);get("info",-1,[this](QByteArray bytes){before=info(bytes,symbol,clock());next();});
 }
};
}
QObject* fetch(QNetworkAccessManager* network,QObject* parent,const QString& symbol,int seconds,QJsonObject previous,QJsonValue previousClose,Done done,std::function<QDateTime()> clock){
 auto* request=new Request(network,parent,symbol,seconds,std::move(previous),previousClose,std::move(done),std::move(clock));
 QTimer::singleShot(0,request,[request]{request->start();});return request;
}
}
