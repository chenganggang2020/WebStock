#include "market_overview_feed.hpp"
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QJsonDocument>
#include <QDateTime>
#include <QStringDecoder>
#ifdef Q_OS_WIN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif
namespace marketOverview {namespace {
QString now(){return QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);}
QStringList keys(){return {"indices","industry","concept","breadth"};}
QString target(int phase){if(phase==0)return "https://hq.sinajs.cn/list=s_sh000001,s_sz399001,s_sz399006,s_sh000688,s_sh000300,s_sh000905,s_sh000852,s_sh000016";if(phase==3)return "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=100&sort=code&asc=1&node=hs_a&symbol=&_s_r_a=page";return QString("https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m%%3A90%%2Bt%%3A%1%%2Bf%%3A%%2150&fields=f12,f14,f3,f6,f62,f128").arg(phase==1?2:3).replace("%%","%");}
QString source(int phase){return phase==0?"sina-public-index":phase==3?"sina-hs_a-page1":"eastmoney-public-board";}
QString scope(int phase){return phase==0?"eight-fixed-indices":phase==3?"hs_a-code-ascending-page1-up-to100-not-whole-market":"change-descending-page1-up-to100-not-complete-taxonomy";}
QString decode(const QByteArray& bytes,bool gbk){
#ifdef Q_OS_WIN
 int n=MultiByteToWideChar(gbk?936:CP_UTF8,MB_ERR_INVALID_CHARS,bytes.constData(),int(bytes.size()),nullptr,0);require(n>0,"公开来源字符编码无效");std::wstring w(n,L'\0');require(MultiByteToWideChar(gbk?936:CP_UTF8,MB_ERR_INVALID_CHARS,bytes.constData(),int(bytes.size()),w.data(),n)==n,"公开来源解码失败");return QString::fromStdWString(w);
#else
 require(!gbk,"此运行环境未提供GBK指数解码");QStringDecoder d(QStringDecoder::Utf8);QString s=d(bytes);require(!d.hasError(),"公开来源UTF8无效");return s;
#endif
}
}
Feed::Feed(QObject* p,QNetworkAccessManager* manager):QObject(p),transport(manager?manager:&owned){deadline.setSingleShot(true);connect(&deadline,&QTimer::timeout,this,[this]{if(!running)return;if(reply){auto r=reply;reply=nullptr;r->disconnect(this);r->abort();r->deleteLater();}while(phase<4){receive({},"整个观测批次超过18秒；旧分区缓存保留",0);if(!running)break;}});}
Feed::~Feed(){cancel();}
bool Feed::start(){if(running)return false;running=true;++generation;phase=0;sections={};receipts={};began=now();deadline.start(18000);next();return true;}
void Feed::cancel(){running=false;++generation;deadline.stop();if(reply){auto r=reply;reply=nullptr;r->disconnect(this);r->abort();r->deleteLater();}}
void Feed::next(){if(!running)return;if(phase>=4){finish();return;}QNetworkRequest req{QUrl(target(phase))};req.setRawHeader("Referer","https://finance.sina.com.cn/");req.setRawHeader("User-Agent","NativeMarketReview/market-overview");req.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);req.setAttribute(QNetworkRequest::CookieLoadControlAttribute,QNetworkRequest::Manual);req.setAttribute(QNetworkRequest::CookieSaveControlAttribute,QNetworkRequest::Manual);req.setAttribute(QNetworkRequest::AuthenticationReuseAttribute,QNetworkRequest::Manual);req.setTransferTimeout(5000);reply=transport->get(req);auto r=reply;auto token=generation;connect(r,&QNetworkReply::readyRead,this,[r]{if(r->bytesAvailable()>2*1024*1024)r->abort();});connect(r,&QNetworkReply::finished,this,[this,r,token]{if(!running||token!=generation){r->deleteLater();return;}reply=nullptr;auto bytes=r->readAll();int status=r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();QString error=r->error()==QNetworkReply::NoError&&status==200?QString{}:QString("HTTP %1：%2").arg(status).arg(r->errorString());r->deleteLater();receive(bytes,error,status);});}
void Feed::receive(QByteArray bytes,const QString& failure,int status){if(!running||phase>=4)return;int current=phase;QString error=failure;QJsonObject data;try{require(error.isEmpty(),error);require(!bytes.isEmpty()&&bytes.size()<=2*1024*1024,"响应为空或超过2MiB");auto at=now();if(current==0){data=indices(decode(bytes,true),at);require(data.value("receivedCount").toInt()>0,"八指数源没有有效记录");}else{QJsonParseError e;auto doc=QJsonDocument::fromJson(decode(bytes,false).toUtf8(),&e);require(e.error==QJsonParseError::NoError,"公开来源JSON无效");if(current==3){require(doc.isArray(),"样本源不是数组");auto rows=sampleRows(doc.array());require(!rows.isEmpty(),"样本源无有效股票");data=breadth(rows,scope(current));data.insert("rows",rows);}else{require(doc.isObject(),"板块源不是对象");auto rows=boardRows(doc.object(),keys()[current]);require(!rows.isEmpty(),"板块源无有效记录");data={{"rows",rows},{"providerTotal",doc.object().value("data").toObject().value("total")},{"wholeTaxonomyClaim",false}};}}}catch(const std::exception& e){error=QString::fromUtf8(e.what());}auto at=now();sections.insert(keys()[current],QJsonObject{{"availability",error.isEmpty()?"available":"unavailable"},{"source",source(current)},{"fetchedAt",at},{"sourceTime",QJsonValue::Null},{"sampleScope",scope(current)},{"data",data},{"error",error.left(1000)}});receipts.append(QJsonObject{{"section",keys()[current]},{"url",target(current)},{"checkedAt",at},{"httpStatus",status},{"bytes",bytes.size()},{"sha256",hash(bytes)},{"error",error.left(1000)}});++phase;if(deadline.isActive())next();else if(phase==4)finish();}
void Feed::finish(){if(!running)return;running=false;deadline.stop();QJsonObject s{{"schema","native-market-overview/v1"},{"scope","bounded-public-observations"},{"startedAt",began},{"fetchedAt",now()},{"unifiedSourceTime",QJsonValue::Null},{"sections",sections},{"receipts",receipts},{"archiveProvenance","native-source-receipt"}};s.insert("id",hash(QJsonDocument(s).toJson(QJsonDocument::Compact)));emit finished(s);}
}
