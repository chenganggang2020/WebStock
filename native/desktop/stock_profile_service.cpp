#include "stock_profile_service.hpp"
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>
#include <QElapsedTimer>
#include <QThread>

struct StockProfileService::Job{
 struct Part{QPointer<QNetworkReply> reply;QByteArray bytes;bool finished=false;};
 QString token,id;StockProfileCache::Snapshot before;std::function<bool()> alive;Done done;
 QMap<QString,Part> parts;QJsonObject responses;QPointer<QTimer> deadline;QElapsedTimer elapsed;bool finishing=false;
};
StockProfileService::StockProfileService(QString directory,bool allow,QObject* parent,QNetworkAccessManager* test):QObject(parent),network(test?test:new QNetworkAccessManager(this)),allowed(allow),fixture(test!=nullptr),cache(std::move(directory)){}
StockProfileService::~StockProfileService(){close();}
bool StockProfileService::running(const std::shared_ptr<Job>&j)const{return !closed&&active==j&&!j->finishing;}
void StockProfileService::release(const std::shared_ptr<Job>&j){if(j->deadline){j->deadline->stop();j->deadline->deleteLater();}for(auto& part:j->parts)if(part.reply){if(!part.reply->isFinished())part.reply->abort();part.reply->deleteLater();}}
void StockProfileService::start(QString token,QString id,std::function<bool()>alive,Done done){
 stockProfile::need((allowed||fixture)&&stockProfile::supported(id),"当前测试或证券类型不允许公开F10读取");stockProfile::need(QThread::currentThread()==thread()&&network&&network->thread()==thread()&&!closed&&!active,"已有主营读取或线程/来源已关闭");stockProfile::need(!token.isEmpty()&&token.size()<=128&&alive&&done&&alive(),"主营请求令牌/当前页面无效");
 auto j=std::make_shared<Job>();j->token=token;j->id=id;j->alive=std::move(alive);j->done=std::move(done);j->before=cache.capture(id,QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));for(auto kind:stockProfile::kinds)j->parts[kind]={};active=j;j->elapsed.start();j->deadline=new QTimer(this);j->deadline->setSingleShot(true);connect(j->deadline,&QTimer::timeout,this,[this,j]{for(auto kind:stockProfile::kinds)partDone(j,kind,"本次主营读取超过12秒，未重试");});j->deadline->start(12000);
 try{for(auto kind:stockProfile::kinds){QNetworkRequest request{QUrl(stockProfile::request(id,kind)["url"].toString())};request.setRawHeader("Connection","close");request.setRawHeader("Cookie","");request.setRawHeader("Referer","https://emweb.securities.eastmoney.com/");request.setRawHeader("User-Agent","Mozilla/5.0 NativeMarketReview");request.setAttribute(QNetworkRequest::CookieLoadControlAttribute,QNetworkRequest::Manual);request.setAttribute(QNetworkRequest::CookieSaveControlAttribute,QNetworkRequest::Manual);request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);request.setTransferTimeout(8000);
 auto reply=network->get(request);stockProfile::need(reply!=nullptr,"未取得主营来源连接");j->parts[kind].reply=reply;reply->setReadBufferSize(65536);connect(reply,&QIODevice::readyRead,this,[this,j,kind]{consume(j,kind);});connect(reply,&QNetworkReply::finished,this,[this,j,kind]{partDone(j,kind);});connect(reply,&QObject::destroyed,this,[this,j,kind]{partDone(j,kind,"主营来源连接已关闭");});if(reply->isFinished())QMetaObject::invokeMethod(this,[this,j,kind]{partDone(j,kind);},Qt::QueuedConnection);
 }}catch(...){cancel(token);throw;}
}
void StockProfileService::consume(const std::shared_ptr<Job>&j,QString kind){if(!running(j)||j->parts[kind].finished||!j->parts[kind].reply)return;auto&part=j->parts[kind];auto reply=part.reply;try{
 stockProfile::need(j->elapsed.elapsed()<12000,"本次主营读取超过12秒，未重试");int status=reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();stockProfile::need(status==200,QString("HTTP %1；主营来源未取得完整数据").arg(status));stockProfile::need(reply->url()==QUrl(stockProfile::request(j->id,kind)["url"].toString()),"主营来源URL改变，拒绝响应");auto encoding=reply->rawHeader("Content-Encoding").trimmed().toLower();stockProfile::need(encoding.isEmpty()||encoding=="identity"||encoding=="gzip"||encoding=="deflate","主营响应压缩方式不受支持");auto length=reply->header(QNetworkRequest::ContentLengthHeader);if(length.isValid()){bool ok=false;auto value=length.toLongLong(&ok);stockProfile::need(ok&&value>=0&&value<=stockProfile::limit,"主营声明长度无效或超过1MiB");}
 while(reply->bytesAvailable()>0){auto raw=reply->read(stockProfile::limit-part.bytes.size()+1);stockProfile::need(!raw.isEmpty()&&part.bytes.size()+raw.size()<=stockProfile::limit,"主营原字段超过1MiB或读取未前进");part.bytes+=raw;}
 }catch(const std::exception&e){partDone(j,kind,QString::fromUtf8(e.what()));}}
void StockProfileService::partDone(const std::shared_ptr<Job>&j,QString kind,QString error){if(!running(j)||j->parts[kind].finished)return;auto&part=j->parts[kind];auto reply=part.reply;QJsonObject response{{"at",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)}};
 if(error.isEmpty()){if(!reply)error="未取得主营来源连接";else if(reply->error()!=QNetworkReply::NoError)error=QString("主营网络读取失败 · HTTP %1 · Qt %2 · %3").arg(reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt()).arg(int(reply->error())).arg(reply->errorString().left(1024));else{consume(j,kind);if(!running(j)||part.finished)return;try{auto length=reply->header(QNetworkRequest::ContentLengthHeader);stockProfile::need(!part.bytes.isEmpty()&&(!length.isValid()||length.toLongLong()==part.bytes.size()),"主营响应原文不完整");stockProfile::need(QString::fromUtf8(part.bytes).toUtf8()==part.bytes,"主营响应UTF-8无效");watchlistBackup::JsonGate{QString::fromUtf8(part.bytes)}.run();QJsonParseError e;auto doc=QJsonDocument::fromJson(part.bytes,&e);stockProfile::need(e.error==QJsonParseError::NoError&&doc.isObject(),"主营响应JSON无效");response["body"]=doc.object();response["origin"]=fixture?"fixture-constructed":"host-fetch-response";}catch(const std::exception&e){error=QString::fromUtf8(e.what());}}}
 response["error"]=error.isEmpty()?QJsonValue(QJsonValue::Null):QJsonValue(error);part.finished=true;j->responses[kind]=response;if(reply){if(!reply->isFinished())reply->abort();reply->deleteLater();}if(j->responses.size()==3)finish(j);
}
void StockProfileService::finish(const std::shared_ptr<Job>&j){if(!running(j))return;j->finishing=true;if(j->deadline)j->deadline->stop();if(!j->alive()){active.reset();release(j);return;}QJsonObject packet;QString error;try{packet=stockProfile::merge(j->id,j->responses,j->before.packet,QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));cache.save(j->id,packet,j->before.baseline,[this,j]{return !closed&&active==j&&j->alive();});}catch(const std::exception&e){error=QString::fromUtf8(e.what());packet={};}if(closed||active!=j)return;active.reset();release(j);if(j->alive())j->done(j->token,packet,error);}
void StockProfileService::cancel(QString token){if(!active||active->token!=token)return;auto j=active;active.reset();release(j);}
void StockProfileService::close(){if(closed)return;closed=true;if(active){auto j=active;active.reset();release(j);}}
