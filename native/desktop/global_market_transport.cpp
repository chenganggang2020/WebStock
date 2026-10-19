#include "global_market_transport.hpp"
#include "global_market_model.hpp"
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>
#include <QPointer>
#include <QDateTime>
#include <QCryptographicHash>
#include <QRegularExpression>
#include <QThread>
#include <stdexcept>
#ifdef Q_OS_WIN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif
namespace {
constexpr int Limit=globalMarket::MaxResponseBytes;
void need(bool ok,QString why){if(!ok)throw std::runtime_error(why.toUtf8().constData());}
QString now(){return QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);}
QByteArray decoded(QByteArray bytes,QByteArray type,bool quote,QString& encoding){
 encoding="utf-8";
 if(quote){
  const auto match=QRegularExpression("charset\\s*=\\s*[\"']?([a-zA-Z0-9_-]+)",QRegularExpression::CaseInsensitiveOption).match(QString::fromLatin1(type));
  encoding=match.hasMatch()?match.captured(1).toLower():"gb18030";
  if(encoding=="utf8")encoding="utf-8";
  if(encoding=="gb2312"||encoding=="cp936"||encoding=="windows-936")encoding="gbk";
  need(encoding=="utf-8"||encoding=="gbk"||encoding=="gb18030"||encoding=="us-ascii","新浪报价声明未知编码："+encoding);
 }
 if(encoding=="gbk"||encoding=="gb18030"){
#ifdef Q_OS_WIN
  const UINT page=encoding=="gb18030"?54936:936;const int size=MultiByteToWideChar(page,MB_ERR_INVALID_CHARS,bytes.constData(),bytes.size(),nullptr,0);
  need(size>0,"新浪报价GB18030/GBK原始字节无效");std::wstring value(size,L'\0');need(MultiByteToWideChar(page,MB_ERR_INVALID_CHARS,bytes.constData(),bytes.size(),value.data(),size)==size,"新浪报价中文解码失败");
  return QString::fromWCharArray(value.data(),size).toUtf8();
#else
  for(auto c:bytes)need(static_cast<unsigned char>(c)<128,"此平台没有限定报价中文解码实现");return bytes;
#endif
 }
 if(encoding=="us-ascii")for(auto c:bytes)need(static_cast<unsigned char>(c)<128,"报价ASCII声明与字节不一致");
 need(QString::fromUtf8(bytes).toUtf8()==bytes,"JSON/UTF8报价原始编码无效，未猜测替换");return bytes;
}
}
struct GlobalMarketTransport::Private {
 struct Job {QString kind,url,encoding,error,receivedAt;QPointer<QNetworkReply> reply;QByteArray bytes;int status=0;bool done=false;};
 struct Batch {QString key,period;Done done;QList<std::shared_ptr<Job>> jobs;QPointer<QTimer> deadline;QJsonObject series,quote;QStringList errors;};
 GlobalMarketTransport* owner;QPointer<QNetworkAccessManager> network;std::shared_ptr<Batch> active;QJsonArray receipts;
 Private(GlobalMarketTransport* p,QNetworkAccessManager* borrowed):owner(p),network(borrowed?borrowed:new QNetworkAccessManager(p)){}
 bool current(const std::shared_ptr<Batch>& b)const{return active==b;}
 void release(const std::shared_ptr<Batch>& b){if(b->deadline){b->deadline->stop();b->deadline->deleteLater();}for(auto j:b->jobs)if(j->reply){if(!j->reply->isFinished())j->reply->abort();j->reply->deleteLater();}}
 void record(const std::shared_ptr<Batch>& b){
  receipts={};for(auto j:b->jobs)receipts.append(QJsonObject{{"key",b->key},{"period",b->period},{"kind",j->kind},{"url",j->url},{"httpStatus",j->status},{"encoding",j->encoding},{"receivedAt",j->receivedAt},{"error",j->error},{"bytes",j->bytes.size()},{"bodySha256",QString::fromLatin1(QCryptographicHash::hash(j->bytes,QCryptographicHash::Sha256).toHex())},{"payloadBase64",QString::fromLatin1(j->bytes.toBase64())}});
 }
 void settle(const std::shared_ptr<Batch>& b,const std::shared_ptr<Job>& j,QString error){
  if(!current(b)||j->done)return;j->done=true;j->error=error;j->receivedAt=now();if(!error.isEmpty())b->errors.append((j->kind=="quote"?"报价：":"图表：")+error);
  for(auto pending:b->jobs)if(!pending->done)return;
  record(b);active.reset();release(b);auto done=b->done;if(done)done(b->series,b->quote,b->errors);
 }
 void consume(const std::shared_ptr<Batch>& b,const std::shared_ptr<Job>& j){
  if(!current(b)||j->done||!j->reply)return;
  try{
   const auto reply=j->reply;j->status=reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
   need(j->status==200,QString("HTTP %1；%2").arg(j->status).arg(reply->errorString()));
   need(reply->url()==QUrl(j->url),"响应发生重定向或最终URL不一致");
   const auto encoding=reply->rawHeader("Content-Encoding").trimmed().toLower();need(encoding.isEmpty()||encoding=="identity","响应未遵守identity编码请求");
   const auto declared=reply->header(QNetworkRequest::ContentLengthHeader);if(declared.isValid()){bool ok=false;const auto length=declared.toLongLong(&ok);need(ok&&length>=0&&length<=Limit,"响应声明长度无效或超过16MiB");}
   while(reply->bytesAvailable()>0){const auto part=reply->read(Limit-j->bytes.size()+1);need(!part.isEmpty(),"响应读取未前进");need(j->bytes.size()+part.size()<=Limit,"实际响应超过16MiB");j->bytes+=part;}
  }catch(const std::exception&e){settle(b,j,QString::fromUtf8(e.what()));}
 }
 void finish(const std::shared_ptr<Batch>& b,const std::shared_ptr<Job>& j){
  if(!current(b)||j->done||!j->reply)return;
  const auto reply=j->reply;j->status=reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
  if(reply->error()!=QNetworkReply::NoError){settle(b,j,QString("HTTP %1；%2").arg(j->status).arg(reply->errorString()));return;}
  consume(b,j);if(!current(b)||j->done)return;
  try{
   need(!j->bytes.isEmpty(),"公开来源正文为空");const auto length=reply->header(QNetworkRequest::ContentLengthHeader);if(length.isValid())need(length.toLongLong()==j->bytes.size(),"响应正文与声明长度不一致");
   const auto utf8=decoded(j->bytes,reply->header(QNetworkRequest::ContentTypeHeader).toByteArray(),j->kind=="quote",j->encoding);
   auto result=j->kind=="quote"?globalMarket::parseQuote(b->key,utf8):globalMarket::parseSeries(b->key,b->period,utf8);result["fetchedAt"]=now();result["lastAttemptAt"]=result["fetchedAt"];result["requestUrl"]=j->url;result["httpStatus"]=j->status;result["encoding"]=j->encoding;result["bodySha256"]=QString::fromLatin1(QCryptographicHash::hash(j->bytes,QCryptographicHash::Sha256).toHex());
   if(j->kind=="quote")b->quote=result;else{
    b->series=result;const auto d=globalMarket::definition(b->key);
    if(d["kind"]=="index"&&b->quote.isEmpty()&&result["value"].isDouble())b->quote=QJsonObject{{"key",b->key},{"id",d["id"]},{"value",result["value"]},{"changePct",result["changePct"]},{"observedAt",result["observedAt"]},{"source",result["source"]},{"sourceUrl",result["sourceUrl"]},{"fetchedAt",result["fetchedAt"]},{"cacheState","fresh"},{"priceKind",b->period=="daily"?"daily-close":"market"},{"encoding",j->encoding}};
   }settle(b,j,{});
  }catch(const std::exception&e){settle(b,j,QString::fromUtf8(e.what()));}
 }
};
GlobalMarketTransport::GlobalMarketTransport(QObject* p,QNetworkAccessManager* n):QObject(p),d(new Private(this,n)){}
GlobalMarketTransport::~GlobalMarketTransport(){cancel();}
bool GlobalMarketTransport::busy()const{return bool(d->active);}
QJsonArray GlobalMarketTransport::responses()const{return d->receipts;}
void GlobalMarketTransport::cancel(){if(d->active){const auto b=d->active;d->active.reset();d->record(b);d->release(b);}}
void GlobalMarketTransport::start(QString key,QString period,Done done){
 need(!d->active&&d->network&&bool(done),"全球行情已有请求或网络/回调不可用");need(QThread::currentThread()==thread()&&d->network->thread()==thread(),"全球行情网络线程不一致");
 auto b=std::make_shared<Private::Batch>();b->key=key;b->period=period;b->done=std::move(done);
 auto add=[&](QString kind,QString url){auto j=std::make_shared<Private::Job>();j->kind=kind;j->url=url;b->jobs.append(j);};
 add("series",globalMarket::seriesUrl(key,period));const auto quote=globalMarket::quoteUrl(key);if(!quote.isEmpty())add("quote",quote);d->active=b;d->receipts={};
 b->deadline=new QTimer(this);b->deadline->setSingleShot(true);connect(b->deadline,&QTimer::timeout,this,[this,b]{for(auto j:b->jobs)if(d->current(b)&&!j->done)d->settle(b,j,"请求超过8秒预算，未循环重试");});b->deadline->start(8000);
 for(auto j:b->jobs){
  QNetworkRequest req{QUrl(j->url)};req.setRawHeader("Referer","https://finance.sina.com.cn/");req.setRawHeader("User-Agent","NativeMarketReview/GlobalParity");req.setRawHeader("Accept-Encoding","identity");req.setAttribute(QNetworkRequest::CacheLoadControlAttribute,QNetworkRequest::AlwaysNetwork);req.setAttribute(QNetworkRequest::CookieLoadControlAttribute,QNetworkRequest::Manual);req.setAttribute(QNetworkRequest::CookieSaveControlAttribute,QNetworkRequest::Manual);req.setAttribute(QNetworkRequest::AuthenticationReuseAttribute,QNetworkRequest::Manual);req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);req.setTransferTimeout(7000);
  j->reply=d->network->get(req);j->reply->setReadBufferSize(65536);
  connect(j->reply,&QIODevice::readyRead,this,[this,b,j]{d->consume(b,j);});connect(j->reply,&QNetworkReply::finished,this,[this,b,j]{d->finish(b,j);});
  connect(j->reply,&QObject::destroyed,this,[this,b,j]{if(d->current(b)&&!j->done)d->settle(b,j,"请求对象提前销毁");});
  if(j->reply->isFinished())QMetaObject::invokeMethod(this,[this,b,j]{d->finish(b,j);},Qt::QueuedConnection);
 }
}
