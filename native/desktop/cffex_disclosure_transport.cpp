#include "cffex_disclosure_transport.hpp"
#include "cffex_disclosure_model.hpp"
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>
#include <QDateTime>
#include <QElapsedTimer>
#include <QThread>
#include <stdexcept>
namespace {constexpr qint64 Limit=2*1024*1024;void need(bool b,const char*m){if(!b)throw std::runtime_error(m);}}
struct CffexDisclosureTransport::Job{QString token;QJsonObject query;Done done;QPointer<QNetworkReply> reply;QPointer<QTimer> deadline;QByteArray bytes;QElapsedTimer elapsed;};
CffexDisclosureTransport::CffexDisclosureTransport(QObject*p,QNetworkAccessManager*t):QObject(p),network(t?t:new QNetworkAccessManager(this)),fixture(t!=nullptr){}
CffexDisclosureTransport::~CffexDisclosureTransport(){close();}
bool CffexDisclosureTransport::running(const std::shared_ptr<Job>&j)const{return !closed&&active==j;}
void CffexDisclosureTransport::release(const std::shared_ptr<Job>&j){if(j->deadline){j->deadline->stop();j->deadline->deleteLater();}if(j->reply){if(!j->reply->isFinished())j->reply->abort();j->reply->deleteLater();}}
void CffexDisclosureTransport::fail(const std::shared_ptr<Job>&j,const QString&error){if(!running(j))return;active.reset();release(j);j->done(j->token,{},error);}
void CffexDisclosureTransport::start(const QString&token,const QJsonObject&q,Done done){
 need(QThread::currentThread()==thread()&&!closed&&network&&network->thread()==thread()&&!active,"来源已关闭/线程或在途状态无效");
 need(!token.isEmpty()&&token.size()<=128&&bool(done),"请求令牌/回调无效");
 need(q==cffexDisclosure::request(q["date"].toString(),q["product"].toString()),"请求不属于明确日期和品种");
 need(QDate::fromString(q["date"].toString(),Qt::ISODate)<=QDateTime::currentDateTimeUtc().toOffsetFromUtc(28800).date(),"不能读取未来日期");
 auto j=std::make_shared<Job>();j->token=token;j->query=q;j->done=std::move(done);active=j;
 // This exact public CFFEX endpoint serves the XML over HTTP. No credentials,
 // arbitrary downgrade or redirect is allowed; preserve the actual source URL.
 QNetworkRequest request{QUrl(cffexDisclosure::publicUrl(q))};request.setRawHeader("Accept-Encoding","identity");request.setRawHeader("Connection","close");request.setRawHeader("User-Agent","NativeMarketReview/0.38");request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);request.setTransferTimeout(12000);
 j->elapsed.start();j->reply=network->get(request);j->reply->setReadBufferSize(65536);
 j->deadline=new QTimer(this);j->deadline->setSingleShot(true);connect(j->deadline,&QTimer::timeout,this,[this,j]{fail(j,"读取超过15秒，未重试");});j->deadline->start(15000);
 connect(j->reply,&QIODevice::readyRead,this,[this,j]{consume(j);});connect(j->reply,&QNetworkReply::finished,this,[this,j]{finish(j);});
 connect(j->reply,&QObject::destroyed,this,[this,j]{if(running(j))fail(j,"来源连接已关闭");});
 if(j->reply->isFinished())QMetaObject::invokeMethod(this,[this,j]{finish(j);},Qt::QueuedConnection);
}
void CffexDisclosureTransport::consume(const std::shared_ptr<Job>&j){if(!running(j)||!j->reply)return;try{
 need(j->elapsed.elapsed()<15000,"读取超过15秒处理预算");int status=j->reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();if(status!=200){fail(j,QString("HTTP %1；未取得完整披露，未改日期重试").arg(status));return;}
 need(j->reply->url()==QUrl(cffexDisclosure::publicUrl(j->query)),"来源URL改变，拒绝响应");auto enc=j->reply->rawHeader("Content-Encoding").trimmed().toLower();need(enc.isEmpty()||enc=="identity","响应压缩方式不符合identity请求");
 auto length=j->reply->header(QNetworkRequest::ContentLengthHeader);if(length.isValid()){bool ok=false;auto n=length.toLongLong(&ok);need(ok&&n>=0&&n<=Limit,"声明长度无效或超过2MiB");}
 while(j->reply->bytesAvailable()>0){auto bytes=j->reply->read(Limit-j->bytes.size()+1);need(!bytes.isEmpty()&&j->bytes.size()+bytes.size()<=Limit,"原文超过2MiB或读取未前进");j->bytes+=bytes;}
 }catch(const std::exception&e){fail(j,QString::fromUtf8(e.what()));}}
void CffexDisclosureTransport::finish(const std::shared_ptr<Job>&j){if(!running(j)||!j->reply)return;if(j->reply->error()!=QNetworkReply::NoError){fail(j,"网络失败/取消/超时；原历史保留");return;}consume(j);if(!running(j))return;try{
 auto length=j->reply->header(QNetworkRequest::ContentLengthHeader);need(!j->bytes.isEmpty()&&(!length.isValid()||length.toLongLong()==j->bytes.size()),"原文不完整");
 auto report=cffexDisclosure::parse(j->bytes,j->query,j->reply->url().toString(),QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs),fixture?"fixture-constructed":"host-fetch-response");
 need(j->elapsed.elapsed()<15000,"读取超过15秒处理预算");active.reset();release(j);j->done(j->token,report,{});
 }catch(const std::exception&e){fail(j,QString::fromUtf8(e.what()));}}
void CffexDisclosureTransport::cancel(const QString&t){if(!active||active->token!=t)return;auto j=active;active.reset();release(j);}
void CffexDisclosureTransport::close(){closed=true;if(active){auto j=active;active.reset();release(j);}}
