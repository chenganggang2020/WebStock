#include "futures_monitor_transport.hpp"
#include "futures_monitor_model.hpp"
#include "sina_jsonp.hpp"
#include <QCryptographicHash>
#include <QDateTime>
#include <QElapsedTimer>
#include <QJsonObject>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QRegularExpression>
#include <QSet>
#include <QThread>
#include <stdexcept>
#ifdef Q_OS_WIN
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif
namespace {
constexpr qint64 Limit=4*1024*1024;
constexpr qint64 BudgetMs=15000;
void require(bool b,const char*m){if(!b)throw std::runtime_error(m);}
struct Decoded {QString text,encoding;};
Decoded decode(const QByteArray &bytes,const QString &contentType){
 auto matches=QRegularExpression("(?:^|;)\\s*charset\\s*=\\s*[\"']?([^;\\s\"']+)",QRegularExpression::CaseInsensitiveOption).globalMatch(contentType);QSet<QString> declared;while(matches.hasNext())declared.insert(matches.next().captured(1).toLower());require(declared.size()<=1,"响应声明多个冲突编码");QString charset=declared.isEmpty()?"utf-8":*declared.begin();
 if(charset=="utf8")charset="utf-8";if(charset=="ascii")charset="us-ascii";if(charset=="cp936"||charset=="windows-936")charset="gbk";
 require(charset=="utf-8"||charset=="us-ascii"||charset=="gbk"||charset=="gb2312"||charset=="gb18030","响应编码不受支持，拒绝猜测");QString text;
 if(charset=="utf-8"){auto b=bytes.startsWith(QByteArray::fromHex("efbbbf"))?bytes.mid(3):bytes;text=QString::fromUtf8(b);require(text.toUtf8()==b,"响应UTF-8无效，拒绝替换字符");}
 else if(charset=="us-ascii"){for(auto c:bytes)require(static_cast<unsigned char>(c)<128,"响应不符合ASCII声明");text=QString::fromLatin1(bytes);}
 else {
  bool ascii=true;for(auto c:bytes)if(static_cast<unsigned char>(c)>=128)ascii=false;
  if(ascii)text=QString::fromLatin1(bytes);
  else {
#ifdef Q_OS_WIN
   UINT page=charset=="gb18030"?54936:936;int n=MultiByteToWideChar(page,MB_ERR_INVALID_CHARS,bytes.constData(),int(bytes.size()),nullptr,0);require(n>0,"响应中文编码无效");std::wstring wide(size_t(n),L'\0');require(MultiByteToWideChar(page,MB_ERR_INVALID_CHARS,bytes.constData(),int(bytes.size()),wide.data(),n)==n,"响应中文解码失败");text=QString::fromWCharArray(wide.data(),n);
#else
   throw std::runtime_error("此Qt平台未提供声明的中文编码解码；拒绝静默UTF-8替代");
#endif
  }
 }
 require(text.toUtf8().size()<=Limit,"解码后的响应超过4MiB");return {text,charset};
}
}
struct FuturesMonitorTransport::Job {QString symbol,url;QPointer<QNetworkReply> reply;QByteArray bytes;QElapsedTimer elapsed;QJsonObject response;bool done=false;};
struct FuturesMonitorTransport::Batch {QString token;Done done;QList<std::shared_ptr<Job>> jobs;};
FuturesMonitorTransport::FuturesMonitorTransport(QObject*parent,QNetworkAccessManager*borrowed):QObject(parent),network(borrowed?borrowed:new QNetworkAccessManager(this)){}
FuturesMonitorTransport::~FuturesMonitorTransport(){close();}
bool FuturesMonitorTransport::current(const std::shared_ptr<Batch>&b)const{return !closed&&active==b;}
void FuturesMonitorTransport::release(const std::shared_ptr<Batch>&b){for(auto j:b->jobs)if(j->reply){if(!j->reply->isFinished())j->reply->abort();j->reply->deleteLater();}}
void FuturesMonitorTransport::fail(const std::shared_ptr<Batch>&b,const QString&why){if(!current(b))return;active.reset();release(b);auto done=b->done;if(done)done(b->token,{},why);}
void FuturesMonitorTransport::start(const QString&token,const QStringList&selected,Done done){
 require(QThread::currentThread()==thread(),"期货transport须在所属线程启动");require(!closed&&network&&network->thread()==thread(),"期货transport已关闭或网络栈不可用");require(!active,"期货刷新已有在途批次");require(!token.isEmpty()&&token.size()<=128&&bool(done),"请求令牌或完成回调无效");require(!selected.isEmpty()&&selected.size()<=futuresMonitor::catalog().size(),"明确选择已核目录连续序列");QSet<QString> seen;for(auto s:selected){futuresMonitor::sourceUrl(s);require(!seen.contains(s),"请求序列重复");seen.insert(s);}
 auto b=std::make_shared<Batch>();b->token=token;b->done=std::move(done);active=b;
 for(auto s:selected){auto j=std::make_shared<Job>();j->symbol=s;j->url=futuresMonitor::sourceUrl(s);b->jobs.append(j);}
 for(auto j:b->jobs){if(!current(b))break;QNetworkRequest request{QUrl(j->url)};request.setRawHeader("Referer","https://finance.sina.com.cn/");request.setRawHeader("User-Agent","NativeMarketReview/0.6");request.setRawHeader("Accept-Encoding","identity");request.setRawHeader("Connection","close");request.setTransferTimeout(12000);request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);j->elapsed.start();j->reply=network->get(request);j->reply->setReadBufferSize(65536);
  connect(j->reply,&QIODevice::readyRead,this,[this,b,j]{consume(b,j);});connect(j->reply,&QNetworkReply::finished,this,[this,b,j]{finish(b,j);});connect(j->reply,&QObject::destroyed,this,[this,b,j]{if(current(b)&&!j->done)fail(b,j->symbol+"：请求对象提前销毁");});
  if(j->reply->isFinished())QMetaObject::invokeMethod(this,[this,b,j]{finish(b,j);},Qt::QueuedConnection);
 }
}
void FuturesMonitorTransport::consume(const std::shared_ptr<Batch>&b,const std::shared_ptr<Job>&j){if(!current(b)||j->done||!j->reply)return;try{
 require(j->elapsed.elapsed()<=BudgetMs,"响应超过15秒处理预算");int status=j->reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();if(status!=200){fail(b,j->symbol+QString("：HTTP %1，拒绝重定向/非完整成功").arg(status));return;}
 require(j->reply->url()==QUrl(j->url),"最终响应URL与明确请求不一致");require(j->reply->rawHeader("Content-Encoding").trimmed().isEmpty()||j->reply->rawHeader("Content-Encoding").trimmed().toLower()=="identity","响应压缩编码不符合identity请求");auto header=j->reply->header(QNetworkRequest::ContentLengthHeader);if(header.isValid()){bool ok=false;auto length=header.toLongLong(&ok);require(ok&&length>=0&&length<=Limit,"响应声明长度无效/超过4MiB");}
 while(j->reply->bytesAvailable()>0){auto part=j->reply->read(Limit-j->bytes.size()+1);require(!part.isEmpty(),"响应读取未前进");require(j->bytes.size()+part.size()<=Limit,"响应实际字节超过4MiB");j->bytes+=part;}
 }catch(const std::exception&e){fail(b,j->symbol+"："+QString::fromUtf8(e.what()));}}
void FuturesMonitorTransport::finish(const std::shared_ptr<Batch>&b,const std::shared_ptr<Job>&j){if(!current(b)||j->done||!j->reply)return;
 if(j->reply->error()!=QNetworkReply::NoError){fail(b,j->symbol+QString("：网络失败/取消/超时（HTTP %1）：%2").arg(j->reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt()).arg(j->reply->errorString()));return;}consume(b,j);if(!current(b))return;
 try{require(!j->bytes.isEmpty(),"响应正文为空");auto length=j->reply->header(QNetworkRequest::ContentLengthHeader);if(length.isValid())require(length.toLongLong()==j->bytes.size(),"响应实际长度与声明不一致");auto decoded=decode(j->bytes,j->reply->header(QNetworkRequest::ContentTypeHeader).toString());require(!sinaJsonp::array(decoded.text,j->symbol).isEmpty(),"响应JSONP声明与明确请求序列不一致");j->response=QJsonObject{{"symbol",j->symbol},{"payload",decoded.text},{"receivedAt",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},{"sourceUrl",j->url},{"httpStatus",200},{"encoding",decoded.encoding},{"bodySha256",QString::fromLatin1(QCryptographicHash::hash(j->bytes,QCryptographicHash::Sha256).toHex())}};j->done=true;for(auto pending:b->jobs)if(!pending->done)return;QJsonArray responses;for(auto job:b->jobs)responses.append(job->response);active.reset();release(b);auto done=b->done;if(done)done(b->token,responses,{});
 }catch(const std::exception&e){fail(b,j->symbol+"："+QString::fromUtf8(e.what()));}
}
void FuturesMonitorTransport::cancel(const QString&token){if(!active||active->token!=token)return;auto b=active;active.reset();release(b);}
void FuturesMonitorTransport::close(){closed=true;if(active){auto b=active;active.reset();release(b);}}

