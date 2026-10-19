#include "futures_monitor_transport.hpp"
#include "futures_monitor_model.hpp"
#include <QCoreApplication>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QPointer>
#include <cstring>
#include <stdexcept>
void check(bool b,const char*s){if(!b)throw std::runtime_error(s);}
class Reply:public QNetworkReply {
 QByteArray data;
protected:qint64 readData(char*out,qint64 size)override{qint64 n=qMin(size,qint64(data.size()));if(n){std::memcpy(out,data.constData(),size_t(n));data.remove(0,int(n));}return n;}
public:
 bool aborted=false;
 Reply(const QNetworkRequest&r,QObject*p):QNetworkReply(p){setRequest(r);setUrl(r.url());setOperation(QNetworkAccessManager::GetOperation);setAttribute(QNetworkRequest::HttpStatusCodeAttribute,200);setHeader(QNetworkRequest::ContentTypeHeader,"text/javascript; charset=utf-8");setOpenMode(QIODevice::ReadOnly|QIODevice::Unbuffered);}
 qint64 bytesAvailable()const override{return data.size()+QNetworkReply::bytesAvailable();}
 void abort()override{aborted=true;setError(OperationCanceledError,"cancelled");setFinished(true);emit finished();}
 void feed(QByteArray bytes){data+=bytes;emit readyRead();}
 void finish(int status=200,NetworkError error=NoError){setAttribute(QNetworkRequest::HttpStatusCodeAttribute,status);if(error!=NoError)setError(error,"fixture-error");setFinished(true);emit finished();}
 void header(QNetworkRequest::KnownHeaders name,QVariant value){setHeader(name,value);}
 void rawHeader(QByteArray name,QByteArray value){setRawHeader(name,value);}
 void finalUrl(QUrl url){setUrl(url);}
};
class Fake:public QNetworkAccessManager {
protected:QNetworkReply*createRequest(Operation,const QNetworkRequest&r,QIODevice*)override{auto reply=new Reply(r,this);replies.append(reply);return reply;}
public:QList<QPointer<Reply>> replies;
};
QByteArray body(QString symbol){return ("var _"+symbol+"=([{\"d\":\"2026-10-13 10:02:00\",\"c\":1,\"v\":0,\"p\":0}]);").toUtf8();}
int main(int argc,char**argv){QCoreApplication app(argc,argv);try{
 Fake fake;FuturesMonitorTransport client(nullptr,&fake);int count=0;QString error,token;QJsonArray responses;
 auto done=[&](QString t,QJsonArray r,QString e){count++;token=t;responses=r;error=e;};
 check(fake.replies.isEmpty(),"construct no request");client.start("first",{"IF0","IH0"},done);check(fake.replies.size()==2,"selected requests only");
 check(fake.replies[0]->request().url()==QUrl(futuresMonitor::sourceUrl("IF0"))&&fake.replies[0]->request().transferTimeout()==12000,"exact source/timeout");
 check(fake.replies[0]->request().attribute(QNetworkRequest::RedirectPolicyAttribute).toInt()==QNetworkRequest::ManualRedirectPolicy&&fake.replies[0]->request().rawHeader("Accept-Encoding")=="identity","no redirects/compression");
 fake.replies[1]->feed(body("IH0"));fake.replies[1]->finish();check(count==0,"wait for selected batch");fake.replies[0]->feed(body("IF0"));fake.replies[0]->finish();check(count==1&&error.isEmpty()&&responses.size()==2&&responses[0].toObject()["symbol"]=="IF0"&&token=="first","association/order/once");
 client.start("cancel",{"IC0"},done);auto cancelled=fake.replies.last();client.cancel("cancel");cancelled->feed(body("IC0"));cancelled->finish();check(count==1&&cancelled->aborted,"cancel before late completion");
 client.start("http",{"IF0","IM0"},done);int i=fake.replies.size()-2;fake.replies[i]->finish(503);check(count==2&&!error.isEmpty()&&responses.isEmpty()&&fake.replies[i+1]->aborted,"HTTP error aborts batch without success");
 client.start("redirect",{"IF0"},done);fake.replies.last()->finish(302);check(count==3&&!error.isEmpty(),"redirect rejected");
 client.start("url",{"IF0"},done);fake.replies.last()->finalUrl(QUrl(futuresMonitor::sourceUrl("IH0")));fake.replies.last()->feed(body("IF0"));fake.replies.last()->finish();check(count==4&&!error.isEmpty(),"wrong final request URL");
 client.start("identity",{"IF0"},done);fake.replies.last()->feed(body("IH0"));fake.replies.last()->finish();check(count==5&&!error.isEmpty(),"response symbol mismatch");
 client.start("large",{"IF0"},done);fake.replies.last()->feed(QByteArray(4*1024*1024+1,'x'));check(count==6&&!error.isEmpty(),"actual streamed byte limit");
 client.start("declared",{"IF0"},done);fake.replies.last()->header(QNetworkRequest::ContentLengthHeader,4*1024*1024+1);fake.replies.last()->feed("x");check(count==7&&!error.isEmpty(),"declared byte limit");
 client.start("encoding",{"IF0"},done);fake.replies.last()->header(QNetworkRequest::ContentTypeHeader,"text/javascript; charset=unknown-fixture");fake.replies.last()->feed(body("IF0"));fake.replies.last()->finish();check(count==8&&!error.isEmpty(),"unknown charset not guessed");
 client.start("badutf",{"IF0"},done);fake.replies.last()->feed(body("IF0")+QByteArray::fromHex("ff"));fake.replies.last()->finish();check(count==9&&!error.isEmpty(),"invalid UTF8 not replaced");
 client.start("timeout",{"IF0"},done);fake.replies.last()->finish(0,QNetworkReply::TimeoutError);check(count==10&&!error.isEmpty(),"timeout not success");
 client.start("close",{"IF0"},done);auto closed=fake.replies.last();client.close();closed->feed(body("IF0"));closed->finish();check(count==10&&closed->aborted,"close late suppression");
 bool rejected=false;try{client.start("closed",{"IF0"},done);}catch(...){rejected=true;}check(rejected,"closed client cannot request");
 FuturesMonitorTransport validation(nullptr,&fake);for(auto selected:QList<QStringList>{{},{"IF2410"},{"IF0","IF0"},{"IF0","IH0","IC0","IM0","IF0"}}){rejected=false;int before=fake.replies.size();try{validation.start("invalid",selected,done);}catch(...){rejected=true;}check(rejected&&fake.replies.size()==before,"invalid selection no dispatch");}
 int previous=count;validation.start("gbk",{"IF0"},done);fake.replies.last()->header(QNetworkRequest::ContentTypeHeader,"text/javascript; charset=GBK");auto gbk=body("IF0");gbk.replace("\"c\":1","\"label\":\""+QByteArray::fromHex("d6d0cec4")+"\",\"c\":1");fake.replies.last()->feed(gbk);fake.replies.last()->finish();check(count==previous+1&&error.isEmpty()&&responses.first().toObject()["payload"].toString().contains(QString::fromUtf8("中文")),"actual Windows GBK decode");
 previous=count;validation.start("gzip",{"IF0"},done);fake.replies.last()->rawHeader("Content-Encoding","gzip");fake.replies.last()->feed(body("IF0"));check(count==previous+1&&!error.isEmpty(),"compressed response rejected");
 previous=count;validation.start("length",{"IF0"},done);fake.replies.last()->header(QNetworkRequest::ContentLengthHeader,1);fake.replies.last()->feed(body("IF0"));fake.replies.last()->finish();check(count==previous+1&&!error.isEmpty(),"partial length rejected");
 puts("PASS Qt futures actual transport/fake HTTP association/status/redirect/url/bytes/encoding/timeout/cancel/late/close; no source network");return 0;
 }catch(const std::exception&e){fprintf(stderr,"FAIL %s\n",e.what());return 1;}}

