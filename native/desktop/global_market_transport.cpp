#include "global_market_transport.hpp"
#include "global_market_model.hpp"
#include "global_market_session.hpp"
#include "native_read_pool.hpp"
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>
#include <QPointer>
#include <QDateTime>
#include <QCryptographicHash>
#include <QRegularExpression>
#include <QThread>
#include <algorithm>
#include <atomic>
#include <stdexcept>
#include <utility>
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
// Move owned payloads out of queued aliases before releasing them on a worker.
template<class T>void retire(T value){
 auto* app=QCoreApplication::instance();if(!app||QThread::currentThread()!=app->thread())return;
 auto payload=std::make_shared<T>(std::move(value));nativeReadPool()->start([payload]{*payload={};},1);
}
struct TransportInput {QString kind,url,receivedAt,error;QByteArray type,bytes;int status=0,order=0;};
struct TransportWork {quint64 serial=0;QString key,period;QList<TransportInput> jobs;std::shared_ptr<std::atomic_bool> cancel;};
struct TransportOutput {quint64 serial=0;QJsonObject series,quote;QStringList errors;QJsonArray receipts;};
std::shared_ptr<TransportOutput> prepare(TransportWork& work){
 auto out=std::make_shared<TransportOutput>();out->serial=work.serial;
 QJsonObject session;auto jobs=std::move(work.jobs);QList<int> order;for(int i=0;i<jobs.size();++i)order.append(i);
 std::stable_sort(order.begin(),order.end(),[&](int a,int b){return jobs[a].order<jobs[b].order;});QList<QJsonObject> rows(jobs.size());
 for(int i:order){
  auto& j=jobs[i];QString encoding,error=j.error;const auto sha=QString::fromLatin1(QCryptographicHash::hash(j.bytes,QCryptographicHash::Sha256).toHex());
  if(error.isEmpty()&&!work.cancel->load())try{
   const auto utf8=decoded(j.bytes,j.type,j.kind=="quote",encoding);
   auto result=j.kind=="session"?globalMarket::parseProviderSession(utf8,globalMarket::definition(work.key)["symbol"].toString()):j.kind=="quote"?globalMarket::parseQuote(work.key,utf8):globalMarket::parseSeries(work.key,work.period,utf8);
   result["fetchedAt"]=now();result["lastAttemptAt"]=result["fetchedAt"];result["requestUrl"]=j.url;result["httpStatus"]=j.status;result["encoding"]=encoding;result["bodySha256"]=sha;
   if(j.kind=="session")session=result;else if(j.kind=="quote")out->quote=result;else{
    out->series=result;const auto d=globalMarket::definition(work.key);
    if(d["kind"]=="index"&&out->quote.isEmpty()&&result["value"].isDouble())out->quote=QJsonObject{{"key",work.key},{"id",d["id"]},{"value",result["value"]},{"changePct",result["changePct"]},{"observedAt",result["observedAt"]},{"source",result["source"]},{"sourceUrl",result["sourceUrl"]},{"fetchedAt",result["fetchedAt"]},{"cacheState","fresh"},{"priceKind",work.period=="daily"?"daily-close":"market"},{"encoding",encoding}};
   }
  }catch(const std::exception& e){error=QString::fromUtf8(e.what());}
  if(!error.isEmpty())out->errors.append((j.kind=="quote"?"报价：":"图表：")+error);
  rows[i]=QJsonObject{{"key",work.key},{"period",work.period},{"kind",j.kind},{"url",j.url},{"httpStatus",j.status},{"encoding",encoding},{"receivedAt",j.receivedAt},{"error",error},{"bytes",j.bytes.size()},{"receiptState","ready"},{"bodySha256",sha},{"payloadBase64",QString::fromLatin1(j.bytes.toBase64())}};
 }
 if(!session.isEmpty()&&!out->series.isEmpty())out->series["sessionSchedule"]=session;
 for(auto& row:rows)out->receipts.append(std::move(row));return out;
}
}
struct GlobalMarketTransport::Private {
 struct Job {QString kind,url,error,receivedAt;QPointer<QNetworkReply> reply;QByteArray type,bytes;int status=0,order=0;bool done=false;};
 struct Batch {quint64 serial=0;QString key,period;Done done;QList<std::shared_ptr<Job>> jobs;QPointer<QTimer> deadline;std::shared_ptr<std::atomic_bool> cancel=std::make_shared<std::atomic_bool>(false);bool started=false,queued=false;int terminalCount=0;};
 GlobalMarketTransport* owner;QPointer<QNetworkAccessManager> network;std::shared_ptr<Batch> active;QJsonArray receipts;quint64 serial=0;bool computing=false;
 std::shared_ptr<std::atomic_bool> computingCancel;std::shared_ptr<TransportWork> waiting;
 Private(GlobalMarketTransport* p,QNetworkAccessManager* borrowed):owner(p),network(borrowed?borrowed:new QNetworkAccessManager(p)){}
 bool current(const std::shared_ptr<Batch>& b)const{return active==b;}
 void release(const std::shared_ptr<Batch>& b){
  if(b->deadline){b->deadline->stop();b->deadline->deleteLater();b->deadline=nullptr;}
  for(auto j:b->jobs)if(j->reply){auto reply=j->reply;j->reply=nullptr;if(!reply->isFinished())reply->abort();reply->deleteLater();}
 }
 void preparing(const std::shared_ptr<Batch>& b){
  retire(std::exchange(receipts,{}));for(auto j:b->jobs)receipts.append(QJsonObject{{"key",b->key},{"period",b->period},{"kind",j->kind},{"url",j->url},{"httpStatus",j->status},{"encoding",""},{"receivedAt",j->receivedAt},{"error",j->error},{"bytes",j->bytes.size()},{"receiptState","preparing"}});
 }
 std::shared_ptr<TransportWork> snapshot(const std::shared_ptr<Batch>& b){
  auto work=std::make_shared<TransportWork>();work->serial=b->serial;work->key=b->key;work->period=b->period;work->cancel=b->cancel;
  for(auto j:b->jobs)work->jobs.append(TransportInput{j->kind,j->url,j->receivedAt,j->error,j->type,std::move(j->bytes),j->status,j->order});b->queued=true;return work;
 }
 void discardWaiting(){if(waiting){retire(std::move(waiting->jobs));waiting.reset();}}
 void completed(const std::shared_ptr<TransportOutput>& out){
  computing=false;computingCancel.reset();Done done;
  if(out->serial==serial){
   retire(std::exchange(receipts,std::move(out->receipts)));
   if(active&&active->serial==serial&&!active->cancel->load()){auto b=std::exchange(active,{});done=std::move(b->done);}
  }
  QPointer<GlobalMarketTransport> guard(owner);if(done)done(out->series,out->quote,out->errors);retire(std::move(*out));if(!guard)return;dispatch();
 }
 void launch(std::shared_ptr<TransportWork> work){
  computing=true;computingCancel=work->cancel;QPointer<GlobalMarketTransport> guard(owner);QPointer<QObject> app(QCoreApplication::instance());
  nativeReadPool()->start([work=std::move(work),guard,app]{
   auto out=prepare(*work);
   if(!app||!QMetaObject::invokeMethod(app,[guard,out]{if(guard)guard->d->completed(out);else retire(std::move(*out));},Qt::QueuedConnection))out.reset();
  });
 }
 void dispatch(){
  if(computing)return;if(waiting){auto work=std::exchange(waiting,{});launch(std::move(work));}else if(active&&!active->started)begin(active);
 }
 void enqueue(std::shared_ptr<TransportWork> work){discardWaiting();waiting=std::move(work);dispatch();}
 void terminal(const std::shared_ptr<Batch>& b,const std::shared_ptr<Job>& j,QString error){
  if(!current(b)||j->done)return;j->done=true;j->error=error;j->order=++b->terminalCount;
  if(j->reply){auto reply=j->reply;j->reply=nullptr;j->status=reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();j->type=reply->header(QNetworkRequest::ContentTypeHeader).toByteArray();if(!reply->isFinished())reply->abort();reply->deleteLater();}j->receivedAt=now();
  for(auto pending:b->jobs)if(!pending->done)return;
  release(b);preparing(b);enqueue(snapshot(b));
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
  }catch(const std::exception&e){terminal(b,j,QString::fromUtf8(e.what()));}
 }
 void finish(const std::shared_ptr<Batch>& b,const std::shared_ptr<Job>& j){
  if(!current(b)||j->done||!j->reply)return;
  const auto reply=j->reply;j->status=reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
  if(reply->error()!=QNetworkReply::NoError){terminal(b,j,QString("HTTP %1；%2").arg(j->status).arg(reply->errorString()));return;}
  consume(b,j);if(!current(b)||j->done)return;
  try{
   need(!j->bytes.isEmpty(),"公开来源正文为空");const auto length=reply->header(QNetworkRequest::ContentLengthHeader);if(length.isValid())need(length.toLongLong()==j->bytes.size(),"响应正文与声明长度不一致");terminal(b,j,{});
  }catch(const std::exception&e){terminal(b,j,QString::fromUtf8(e.what()));}
 }
 void begin(const std::shared_ptr<Batch>& b){
  b->started=true;
  if(!network){for(auto j:b->jobs)terminal(b,j,"网络对象提前销毁");return;}
  b->deadline=new QTimer(owner);b->deadline->setSingleShot(true);QObject::connect(b->deadline,&QTimer::timeout,owner,[this,b]{for(auto j:b->jobs)if(current(b)&&!j->done)terminal(b,j,"请求超过8秒预算，未循环重试");});b->deadline->start(8000);
  for(auto j:b->jobs){
   QNetworkRequest req{QUrl(j->url)};req.setRawHeader("Referer","https://finance.sina.com.cn/");req.setRawHeader("User-Agent","NativeMarketReview/GlobalParity");req.setRawHeader("Accept-Encoding","identity");req.setAttribute(QNetworkRequest::CacheLoadControlAttribute,QNetworkRequest::AlwaysNetwork);req.setAttribute(QNetworkRequest::CookieLoadControlAttribute,QNetworkRequest::Manual);req.setAttribute(QNetworkRequest::CookieSaveControlAttribute,QNetworkRequest::Manual);req.setAttribute(QNetworkRequest::AuthenticationReuseAttribute,QNetworkRequest::Manual);req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);req.setTransferTimeout(7000);
   j->reply=network->get(req);j->reply->setReadBufferSize(65536);
   QObject::connect(j->reply,&QIODevice::readyRead,owner,[this,b,j]{consume(b,j);});QObject::connect(j->reply,&QNetworkReply::finished,owner,[this,b,j]{finish(b,j);});
   QObject::connect(j->reply,&QObject::destroyed,owner,[this,b,j]{if(current(b)&&!j->done)terminal(b,j,"请求对象提前销毁");});
   if(j->reply->isFinished())QMetaObject::invokeMethod(owner,[this,b,j]{finish(b,j);},Qt::QueuedConnection);
  }
 }
 void stop(bool keepReceipt){
  auto b=std::exchange(active,{});if(!b)return;b->cancel->store(true);
  if(!b->queued){
   for(auto j:b->jobs)if(!j->done){j->done=true;j->order=++b->terminalCount;j->error=b->started?"请求已取消":"请求已取消，尚未开始网络接收";if(j->reply){j->status=j->reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();j->type=j->reply->header(QNetworkRequest::ContentTypeHeader).toByteArray();}}
   release(b);for(auto j:b->jobs)if(j->receivedAt.isEmpty()&&b->started)j->receivedAt=now();
   auto work=snapshot(b);if(keepReceipt){
    // snapshot moved the bytes; use its owned byte lengths for the pending metadata.
    retire(std::exchange(receipts,{}));for(const auto& j:work->jobs)receipts.append(QJsonObject{{"key",b->key},{"period",b->period},{"kind",j.kind},{"url",j.url},{"httpStatus",j.status},{"encoding",""},{"receivedAt",j.receivedAt},{"error",j.error},{"bytes",j.bytes.size()},{"receiptState","preparing"}});enqueue(std::move(work));
   }else retire(std::move(work->jobs));
  }else release(b);
 }
};
GlobalMarketTransport::GlobalMarketTransport(QObject* p,QNetworkAccessManager* n):QObject(p),d(new Private(this,n)){}
GlobalMarketTransport::~GlobalMarketTransport(){d->stop(false);if(d->computingCancel)d->computingCancel->store(true);d->discardWaiting();retire(std::exchange(d->receipts,{}));}
bool GlobalMarketTransport::busy()const{return bool(d->active);}
QJsonArray GlobalMarketTransport::responses()const{return d->receipts;}
void GlobalMarketTransport::cancel(){d->stop(true);}
void GlobalMarketTransport::start(QString key,QString period,Done done){
 need(!d->active&&d->network&&bool(done),"全球行情已有请求或网络/回调不可用");need(QThread::currentThread()==thread()&&d->network->thread()==thread(),"全球行情网络线程不一致");
 auto b=std::make_shared<Private::Batch>();b->key=key;b->period=period;b->done=std::move(done);
 auto add=[&](QString kind,QString url){auto j=std::make_shared<Private::Job>();j->kind=kind;j->url=url;b->jobs.append(j);};
 add("series",globalMarket::seriesUrl(key,period));const auto quote=globalMarket::quoteUrl(key);if(!quote.isEmpty())add("quote",quote);
 const auto definition=globalMarket::definition(key);if(period=="intraday"&&definition["kind"]=="cfd"){const auto symbol=definition["symbol"].toString();add("session","https://stock.finance.sina.com.cn/futures/api/jsonp.php/var%20kke_future_hf_"+symbol+"=/InterfaceInfoService.getMarket?category=hf&symbol="+symbol);}
 b->serial=++d->serial;d->discardWaiting();d->active=b;d->preparing(b);d->dispatch();
}
