#include "stock_profile_service.hpp"
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QTimer>
#include <QCoreApplication>
#include <QTemporaryDir>
#include <QElapsedTimer>
#include <QThread>
#include <cstdio>
int checks=0;void ck(bool b,const char*why){if(!b)throw std::runtime_error(why);++checks;}
template<class F>void reject(F f,const char*why){bool no=false;try{f();}catch(...){no=true;}ck(no,why);}
QByteArray bytes(QString path){QFile f(path);if(!f.open(QIODevice::ReadOnly))throw std::runtime_error("Owned file unavailable");return f.readAll();}
class Reply:public QNetworkReply {
 QByteArray payload;qint64 offset=0;bool ended=false;
public:
 Reply(QNetworkRequest request,QByteArray body,int status,bool delay,QObject* parent):QNetworkReply(parent),payload(body){setRequest(request);setUrl(request.url());setAttribute(QNetworkRequest::HttpStatusCodeAttribute,status);setHeader(QNetworkRequest::ContentLengthHeader,payload.size());setRawHeader("Content-Encoding","identity");open(QIODevice::ReadOnly);if(!delay)QTimer::singleShot(0,this,[this]{release();});}
 void release(){if(ended)return;ended=true;setFinished(true);emit readyRead();emit finished();}
 void abort()override{if(ended)return;ended=true;setError(QNetworkReply::OperationCanceledError,"controlled cancellation");setFinished(true);emit finished();}
 qint64 bytesAvailable()const override{return payload.size()-offset+QNetworkReply::bytesAvailable();}
 qint64 readData(char*data,qint64 maximum)override{auto n=qMin(maximum,qint64(payload.size()-offset));if(n<=0)return -1;std::memcpy(data,payload.constData()+offset,size_t(n));offset+=n;return n;}
};
class Feed:public QNetworkAccessManager {
public:
 QJsonObject responses;QString denied,html,blocked;QStringList urls;QList<QPointer<Reply>> replies;
 explicit Feed(QJsonObject r):responses(std::move(r)){}
 QNetworkReply* createRequest(Operation op,const QNetworkRequest&r,QIODevice*)override{if(op!=GetOperation)throw std::runtime_error("Unexpected transport operation");auto kind=r.url().path().split('/').value(2);urls.append(r.url().toString());auto body=kind==html?QByteArray("<html>blocked</html>"):QJsonDocument(responses[kind].toObject()["body"].toObject()).toJson(QJsonDocument::Compact);auto reply=new Reply(r,body,kind==denied?403:200,kind==blocked,this);replies.append(reply);return reply;}
};
QJsonObject await(StockProfileService&service,QString id,QString token){bool done=false;QJsonObject packet;QString error;service.start(token,id,[]{return true;},[&](QString,QJsonObject p,QString e){packet=p;error=e;done=true;});QElapsedTimer timer;timer.start();while(!done&&timer.elapsed()<15000){QCoreApplication::processEvents();QThread::msleep(1);}ck(done,"Bounded transport did not finish");ck(error.isEmpty(),"Controlled source action failed");return packet;}
int main(int argc,char**argv){QCoreApplication app(argc,argv);try{
 auto f=QJsonDocument::fromJson(bytes(QString::fromLocal8Bit(argv[1]))).object();auto id=f["id"].toString();QTemporaryDir root(QString::fromLocal8Bit(argv[2])+"/profile-transfer-XXXXXX");if(!root.isValid())throw std::runtime_error("Private output unavailable");root.setAutoRemove(false);auto folder=root.filePath("cache");StockProfileService off(folder,false);reject([&]{off.start("off",id,[]{return true;},[](auto,auto,auto){});},"Testing default allowed real network");ck(!QDir(folder).exists(),"Disabled network initialized cache");off.close();Feed feed(f["responses"].toObject());StockProfileService service(folder,false,nullptr,&feed);auto p=await(service,id,"good");ck(p["companyName"]=="合同构造示例公司","Manual native source action did not reach company fields");bool fixed=feed.urls.size()==3;for(auto u:feed.urls)fixed&=u.startsWith(stockProfile::base+"/")&&u.endsWith("?code=SH600000");ck(fixed,"Manual action did not use exactly three fixed-market URLs");ck(p["sources"].toObject()["BusinessAnalysis"].toObject()["origin"]=="fixture-constructed","Controlled source mislabeled live");auto path=service.cache.filePath(id);auto durable=bytes(path);
 feed.denied="BusinessAnalysis";auto failed=await(service,id,"failed");auto source=failed["sources"].toObject()["BusinessAnalysis"].toObject();ck(source["status"]=="cached-after-failure"&&source["fetchedAt"]==p["sources"].toObject()["BusinessAnalysis"].toObject()["fetchedAt"],"HTTP failure discarded cache or advanced success clock");ck(source["data"]==p["sources"].toObject()["BusinessAnalysis"].toObject()["data"],"HTTP failure rewrote old payload");feed.denied.clear();feed.html="CompanySurvey";auto html=await(service,id,"html");ck(html["sources"].toObject()["CompanySurvey"].toObject()["status"]=="cached-after-failure","HTML gate treated as company success");int count=feed.urls.size();reject([&]{service.start("index","SH:index:000001",[]{return true;},[](auto,auto,auto){});},"Unsupported index became stock request");ck(feed.urls.size()==count,"Unsupported type sent public requests");service.close();
 Feed delayed(f["responses"].toObject());delayed.blocked="BusinessAnalysis";StockProfileService leaving(root.filePath("leaving"),false,nullptr,&delayed);bool owner=true,callback=false;leaving.start("leaving",id,[&]{return owner;},[&](auto,auto,auto){callback=true;});ck(delayed.urls.size()==3,"Controlled pending requests absent");owner=false;leaving.cancel("leaving");for(int i=0;i<5;i++)QCoreApplication::processEvents();ck(!callback&&!QFileInfo::exists(leaving.cache.filePath(id)),"Late cancelled action wrote cache or updated hidden owner");leaving.close();
 auto out=QJsonDocument(QJsonObject{{"checks",checks},{"threeManualFixedRequests",true},{"failureCachePreserved",true},{"htmlRejected",true},{"lateCancelDropped",true},{"actualProviderFetch",false}}).toJson(QJsonDocument::Compact);std::printf("%s\n",out.constData());return 0;
 }catch(const std::exception&e){std::fprintf(stderr,"%s at check %d\n",e.what(),checks);return 1;}}
