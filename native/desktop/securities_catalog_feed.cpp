#include "securities_catalog_feed.hpp"
#include "securities_catalog_model.hpp"
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QDateTime>
#include <QThread>
#include <QCryptographicHash>
#include <stdexcept>
#ifdef Q_OS_WIN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif
namespace securitiesCatalog {
namespace {
QString now(){return QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);}
void need(bool ok,const char*message){if(!ok)throw std::runtime_error(message);}
QString decode(const QByteArray&bytes){
#ifdef Q_OS_WIN
 int n=MultiByteToWideChar(54936,MB_ERR_INVALID_CHARS,bytes.constData(),int(bytes.size()),nullptr,0);need(n>0,"新浪检索字符编码无效");std::wstring text(n,L'\0');need(MultiByteToWideChar(54936,MB_ERR_INVALID_CHARS,bytes.constData(),int(bytes.size()),text.data(),n)==n,"新浪检索解码失败");return QString::fromWCharArray(text.data(),n);
#else
 need(QString::fromUtf8(bytes).toUtf8()==bytes,"此平台不能解码新浪GB18030");return QString::fromUtf8(bytes);
#endif
}
}
Feed::Feed(QObject*p,QNetworkAccessManager*m):QObject(p),network(m?m:new QNetworkAccessManager(this)){deadline.setSingleShot(true);connect(&deadline,&QTimer::timeout,this,[this]{finish("公开目录/检索达到本轮总截止；旧缓存保留"+(fallbackErrors.isEmpty()?QString():" · "+fallbackErrors.join(" · ")));});}
Feed::~Feed(){cancel();}
void Feed::directory(){cancel();kind="directory";query.clear();started=now();page=1;total=-1;collected={};phase="eastmoney";provider="eastmoney-a-shares";exchange=received=0;stockCoverage={};currentCoverage={};fallbackErrors.clear();running=true;deadline.start(120000);request();}
void Feed::lookup(QString q){suggestionUrl(q);cancel();kind="search";query=q.trimmed();started=now();fallbackErrors.clear();running=true;deadline.start(6000);request();}
void Feed::cancel(){++generation;running=false;deadline.stop();auto old=reply;reply=nullptr;if(old){old->disconnect(this);if(!old->isFinished())old->abort();old->deleteLater();}bytes.clear();}
void Feed::finish(QString error,QJsonObject result){if(!running)return;auto k=kind,q=query;cancel();emit finished(k,q,result,error.left(1000));}
void Feed::rejected(QString error){
 if(!running)return;
 if(kind=="directory"&&phase=="eastmoney"){
  fallbackErrors.append("东财完整股票目录未取得："+error.left(500));provider="sina-a-shares";phase="count-before";exchange=received=0;page=1;total=-1;collected={};stockCoverage={};currentCoverage={};request();return;
 }
 if(!fallbackErrors.isEmpty())error+=" · "+fallbackErrors.join(" · ");finish(error);
}
void Feed::request(){
 if(!running)return;
 try{
  need(network&&thread()==QThread::currentThread()&&network->thread()==thread(),"公开请求宿主不存在或线程不符");
  bool fund=kind=="directory"&&phase=="fund";QString market=exchange==0?"SH":"SZ";
  QUrl url=kind=="search"?suggestionUrl(query):fund?fundUrl():phase=="eastmoney"?stockUrl(page):phase=="pages"?sinaPageUrl(market,page):sinaCountUrl(market);
  auto ticket=generation;emit progress(kind=="search"?"正在读取公开名称/代码匹配；不会更新全目录":fund?"沪深股票完整校验结束，正在独立读取ETF文件":phase=="eastmoney"?QString("正在读取东财沪深股票第%1页；累计%2").arg(page).arg(collected.size()):QString("东财未完成，改用新浪明确沪深A股节点 · %1 · %2 · 页%3 · 累计%4；计数闭合才更新").arg(market,phase).arg(page).arg(collected.size()));if(!running||ticket!=generation)return;
  QNetworkRequest req(url);req.setRawHeader("User-Agent","Mozilla/5.0 StockNative/1");req.setRawHeader("Referer",url.host().contains("sina")?"https://finance.sina.com.cn/":"https://quote.eastmoney.com/");req.setRawHeader("Cookie","");req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);req.setAttribute(QNetworkRequest::CookieLoadControlAttribute,QNetworkRequest::Manual);req.setAttribute(QNetworkRequest::CookieSaveControlAttribute,QNetworkRequest::Manual);req.setAttribute(QNetworkRequest::AuthenticationReuseAttribute,QNetworkRequest::Manual);req.setTransferTimeout(kind=="search"?4000:8000);bytes.clear();reply=network->get(req);need(reply,"公开请求未启动");auto*r=reply.data();r->setReadBufferSize(65536);int max=kind=="search"?100000:fund?10*1024*1024:2*1024*1024;
  connect(r,&QIODevice::readyRead,this,[this,r,ticket,max]{if(!running||generation!=ticket||reply!=r)return;bytes+=r->readAll();if(bytes.size()>max)finish("公开响应超过本轮字节上限；未接收不完整目录");});
  connect(r,&QObject::destroyed,this,[this,ticket]{if(running&&generation==ticket)finish("公开连接被关闭；旧缓存保留");});
  connect(r,&QNetworkReply::finished,this,[this,r,ticket,max,url,fund,market]{
   if(!running||generation!=ticket||reply!=r)return;bytes+=r->readAll();auto body=bytes;bytes.clear();auto status=r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();auto error=r->errorString();int networkError=int(r->error());bool ok=r->error()==QNetworkReply::NoError&&status==200&&r->url()==url;reply=nullptr;r->disconnect(this);r->deleteLater();
   try{
    need(ok,"公开源HTTP/连接/跳转错误，未接收结果");need(body.size()<=max,"公开响应超限");
    if(kind=="search"){auto items=suggestions(decode(body));finish({},{{"schema","native-securities-public-search/v1"},{"query",query},{"source","sina-public-stock-lookup"},{"sourceUrl",url.toString()},{"sourceTime",QJsonValue::Null},{"startedAt",started},{"fetchedAt",now()},{"coverageComplete",false},{"items",items}});return;}
    if(fund){
     auto result=fundFile(body);QJsonArray all=collected;for(auto v:result["items"].toArray())all.append(v);validateRows(all);
     QJsonObject packet{{"schema","native-securities-public-directory/v1"},{"sourceTime",QJsonValue::Null},{"startedAt",started},{"fetchedAt",now()},{"coverageComplete",true},{"stockCount",total},{"stockProvider",provider},{"stockSourceUrl",provider=="sina-a-shares"?sinaPageUrl("SH",1).toString():stockUrl(1).toString()},{"stockCoverage",stockCoverage},{"fallbackErrors",QJsonArray::fromStringList(fallbackErrors)},{"fundSourceUrl",fundUrl().toString()},{"fundInputRows",result["inputRows"]},{"etfCount",result["items"].toArray().size()},{"scope","沪深A股完整分页；ETF单独来源和计数，不计入股票覆盖；不含全部BJ/指数/其他证券"},{"items",all}};
     if(provider=="sina-a-shares")validateSinaCoverage(packet);finish({},packet);return;
    }
    if(phase=="eastmoney"){
     auto result=stockPage(body,total);total=result["total"].toInt();auto rows=result["items"].toArray();need(rows.size()==std::min(100,total-int(collected.size())),"目录分页数量不完整，未更新旧目录");for(auto v:rows)collected.append(v);validateRows(collected);if(collected.size()<total)++page;else phase="fund";
    }else if(phase=="count-before"){
     total=sinaStockCount(body);need(collected.size()+total<=20000,"新浪沪深A股合计超过20000，未截断");received=0;page=1;currentCoverage={{"market",market},{"countBefore",total},{"countBeforeAt",now()},{"countUrl",url.toString()},{"pages",QJsonArray{}}};phase="pages";
    }else if(phase=="pages"){
     auto rows=sinaStockPage(body,market);need(rows.size()==std::min(80,total-received),"新浪A股分页缺行，未提交部分目录");if(received>0)need(collected.last().toObject()["legacy"].toObject()["symbol"].toString()<rows.first().toObject()["legacy"].toObject()["symbol"].toString(),"新浪A股跨页重复或乱序");for(auto v:rows)collected.append(v);received+=rows.size();validateRows(collected);auto pages=currentCoverage["pages"].toArray();pages.append(QJsonObject{{"page",page},{"url",url.toString()},{"rows",rows.size()},{"httpStatus",200},{"checkedAt",now()},{"sha256",QString::fromLatin1(QCryptographicHash::hash(body,QCryptographicHash::Sha256).toHex())}});currentCoverage["pages"]=pages;if(received==total)phase="count-after";else ++page;
    }else{
     int after=sinaStockCount(body);need(after==total&&received==total,"新浪A股首尾计数变化，未用旧总数冒充完整目录");currentCoverage["countAfter"]=after;currentCoverage["countAfterAt"]=now();currentCoverage["rows"]=received;stockCoverage.append(currentCoverage);if(exchange==0){exchange=1;phase="count-before";page=1;}else{total=collected.size();phase="fund";}
    }
    if(provider=="sina-a-shares"&&phase!="fund"){auto epoch=generation;QTimer::singleShot(200,this,[this,epoch]{if(running&&generation==epoch)request();});}else request();
   }catch(const std::exception&e){rejected(QString::fromUtf8(e.what())+QString(" · HTTP %1 · Qt %2 · %3").arg(status).arg(networkError).arg(error));}
  });
 }catch(const std::exception&e){rejected(QString::fromUtf8(e.what()));}
}
}
