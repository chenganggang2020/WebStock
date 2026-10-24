#include "window.hpp"
#include "etf_monitor_page.hpp"
#include "etf_host_snapshot.hpp"
#include "etf_universe.hpp"
#include "securities_catalog_model.hpp"
#include "page_snapshot_reader.hpp"
#include "market_store.hpp"
#include "market_refresh_policy.hpp"
#include <QtWidgets>
#include <QPointer>
struct EtfPrefetchState {
 QStringList ids;QString token;int cursor=0;
 QHash<QString,qint64> nextAttempt;QHash<QString,int> failures;
 qint64 nextDispatch=0,publishAfter=0;bool dirty=false;
};
namespace {
void saveUniverse(const QString& path,const QJsonArray& rows){
 auto bytes=QJsonDocument(QJsonObject{{"schema","native-etf-universe/v1"},{"items",rows}}).toJson(QJsonDocument::Compact);
 if(bytes.size()>16*1024*1024)throw std::runtime_error("ETF独立目录超过16MiB，未覆盖");
 QSaveFile file(path);if(!file.open(QIODevice::WriteOnly)||file.write(bytes)!=bytes.size()||!file.commit())throw std::runtime_error("ETF独立目录保存失败");
}
QJsonArray retainQuotes(QJsonArray rows,const QJsonArray& current){
 QHash<QString,QJsonObject> latest;for(auto v:current){auto r=v.toObject();latest.insert(r["id"].toString(),r);}
 for(int n=0;n<rows.size();++n){auto r=rows[n].toObject(),old=latest.value(r["id"].toString());
  if(old["symbol"]==r["symbol"]){
   const auto a=old["quote"].toObject(),b=r["quote"].toObject();
   if(old.contains("quote")&&(b.isEmpty()||a["tradeDate"].toString()+a["tradeTime"].toString()>=b["tradeDate"].toString()+b["tradeTime"].toString()))r["quote"]=a;
   const auto am=old["minuteMeta"].toObject(),bm=r["minuteMeta"].toObject();
   if(old.contains("minute")&&(bm.isEmpty()||am["checkedAt"].toString()>=bm["checkedAt"].toString())){r["minute"]=old["minute"];r["minuteMeta"]=am;}
  }rows[n]=r;
 }return rows;
}
QJsonArray readSavedEtfObservations(QJsonArray rows,const QString& path){
 MarketStore saved(path);const auto keys=saved.keys(QStringLiteral(""));const QSet<QString> available(keys.begin(),keys.end());QJsonArray restored;
 for(auto value:rows){auto row=value.toObject();const auto symbol=row["symbol"].toString();
  if(available.contains(symbol+"-quote")){auto quote=saved.read(symbol+"-quote");if(!quote.isEmpty()){quote["cached"]=true;row["quote"]=quote;}}
  if(available.contains(symbol+"-minute")){auto minute=saved.read(symbol+"-minute");if(minute["timeUnit"]=="milliseconds"){minute["cached"]=true;row["minute"]=minute["rows"];row["minuteMeta"]=minute;}}
  restored.append(row);
 }
 return retainQuotes(restored,rows);
}
}
void Window::etfMonitorView(){
 auto*page=qobject_cast<EtfMonitorPage*>(pages.value("etfMonitor"));
 if(!page){
  const QString root=QFileInfo(businessStore->filePath()).absolutePath(),universePath=root+"/etf-universe-v1.json";
  QString path=root+"/etf-monitor-v35.json";bool existing=QFile::exists(path);
  etfObservationFeed=new MarketFeed(root+"/etf-observation-v1",this,etfTestNetwork,false);
  for(auto v:feed?feed->instruments:instruments)if(v.toObject()["id"].toString().section(':',1,1)=="etf"&&!v.toObject()["transient"].toBool())etfObservationFeed->instruments.append(v);
  page=new EtfMonitorPage(path,workspaceTabs);page->setHostPrefetchEnabled(true);page->setProperty("pageTitle","ETF盘中观察");page->setProperty("workspace","资金");pages["etfMonitor"]=page;
  etfPrefetch=std::make_shared<EtfPrefetchState>();
  auto*prefetchTimer=new QTimer(this);prefetchTimer->setObjectName("etfHostPrefetchTimer");prefetchTimer->setInterval(1000);
  connect(prefetchTimer,&QTimer::timeout,this,[this]{prefetchEtfMonitor(QDateTime::currentDateTimeUtc());});
  connect(etfObservationFeed,&MarketFeed::updated,this,[this](const QString&){if(etfPrefetch)etfPrefetch->dirty=true;});
  if(!testing)prefetchTimer->start();
  auto*cache=new QPushButton("重新载入行情",page);cache->setObjectName("etfMonitorReadHeld");qobject_cast<QVBoxLayout*>(page->layout())->insertWidget(0,cache);
  auto*directoryButton=new QPushButton("更新ETF目录",page);directoryButton->setObjectName("etfUniverseRefresh");qobject_cast<QVBoxLayout*>(page->layout())->insertWidget(0,directoryButton);
  auto*directoryStatus=new QLabel("ETF观察目录独立于自选及持仓；目录更新不代表报价更新",page);directoryStatus->setWordWrap(true);qobject_cast<QVBoxLayout*>(page->layout())->insertWidget(1,directoryStatus);
  auto*loader=new PageSnapshotReader(page,[]{return QJsonObject{};},[this,page,directoryButton,directoryStatus,universePath](QJsonObject result,QString error){
   directoryButton->setEnabled(true);if(!error.isEmpty()){directoryStatus->setText("目录读取失败："+error+"；保留既有目录");return;}
   try{auto rows=retainQuotes(result["items"].toArray(),etfObservationFeed->instruments);
    if(result["network"].toBool())saveUniverse(universePath,rows);
    etfObservationFeed->instruments=rows;page->applyHeldSnapshot(etfHostSnapshot::adapt(rows)["snapshot"].toObject());
    if(etfPrefetch)etfPrefetch->dirty=true;
    directoryStatus->setText(QString("ETF目录 %1 只 · %2 · 当前列表报价与分钟在应用运行期间预取").arg(rows.size()).arg(result["network"].toBool()?"目录请求完成，非全市场同刻报价":"已保存数据，非本次联网更新"));
   }catch(const std::exception&e){directoryStatus->setText(QString::fromUtf8(e.what()));}
  });
  auto*network=new QNetworkAccessManager(page);
  connect(directoryButton,&QPushButton::clicked,page,[page,directoryButton,directoryStatus,network,loader]{
   directoryButton->setEnabled(false);directoryStatus->setText("正在读取东方财富ETF目录…");
   QNetworkRequest request(securitiesCatalog::fundUrl());request.setTransferTimeout(15000);request.setRawHeader("User-Agent","Mozilla/5.0 StockNative/1");request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);
   auto*reply=network->get(request);auto bytes=std::make_shared<QByteArray>();
   QObject::connect(reply,&QIODevice::readyRead,page,[reply,bytes]{*bytes+=reply->readAll();if(bytes->size()>10*1024*1024)reply->abort();});
   QObject::connect(reply,&QNetworkReply::finished,page,[reply,bytes,loader,directoryButton,directoryStatus]{
    *bytes+=reply->readAll();auto error=reply->error();int status=reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();auto why=reply->errorString();reply->deleteLater();
    if(error!=QNetworkReply::NoError||status!=200){directoryButton->setEnabled(true);directoryStatus->setText(QString("目录刷新失败 HTTP %1：%2；保留旧目录").arg(status).arg(why));return;}
    loader->request([body=*bytes]{return QJsonObject{{"items",etfUniverse::merge(body,{})},{"network",true}};});
   });
  });
  connect(cache,&QPushButton::clicked,page,[this,page]{try{page->setSnapshot(etfHostSnapshot::adapt(etfObservationFeed->instruments)["snapshot"].toObject());}catch(...){page->setHostError({});}});
  connect(workspaceTabs,&QTabWidget::currentChanged,page,[this,page](int){bool active=workspaceTabs->currentWidget()==page;if(!active)etfRefreshToken.clear();page->setActive(active);});
  connect(page,&EtfMonitorPage::cancelRefreshRequested,this,[this](QString token){if(token==etfRefreshToken)etfRefreshToken.clear();});
  connect(page,&EtfMonitorPage::refreshRequested,this,&Window::refreshEtfMonitor);
  connect(page,&EtfMonitorPage::openChart,this,[this,page](QString id,QString p){
   bool prior=sourceEvidenceNavigation;
   try{auto target=etfHostSnapshot::chart(etfObservationFeed->instruments,id,p);if(feed)feed->observe(target);sourceEvidenceNavigation=true;home();if(p!="quote"){samplingSeconds=0;period=p;}loadInstrument(target["id"].toString(),false);if(p!="quote")setPeriod(p);recordViewedInstrument();}
   catch(...){page->setHostError({});}sourceEvidenceNavigation=prior;
  });
  activatePage(page);page->setActive(true);
  if(!existing)try{page->setSnapshot(etfHostSnapshot::adapt(etfObservationFeed->instruments)["snapshot"].toObject());}catch(...){page->setHostError({});}
  if(settings){auto saved=QJsonDocument::fromJson(settings->value("etfMonitor/state").toByteArray());if(saved.isObject())page->restoreState(saved.object());}
  const auto observationPath=root+"/etf-observation-v1/market-v1.sqlite";
  if(QFile::exists(universePath)||QFile::exists(observationPath))loader->request([universePath,observationPath,held=etfObservationFeed->instruments]{
   auto rows=held;
   if(QFile::exists(universePath)){QFile file(universePath);if(!file.open(QIODevice::ReadOnly)||file.size()>16*1024*1024)throw std::runtime_error("保存目录无法读取");auto packet=QJsonDocument::fromJson(file.readAll()).object();rows=packet["items"].toArray();if(packet["schema"]!="native-etf-universe/v1"||rows.isEmpty()||rows.size()>2000)throw std::runtime_error("保存目录格式无效");securitiesCatalog::validateRows(rows);}
   rows=readSavedEtfObservations(rows,observationPath);
   if(etfHostSnapshot::adapt(rows)["coverage"].toObject()["includedEtfCount"].toInt()!=rows.size())throw std::runtime_error("保存目录存在无效ETF身份");
   return QJsonObject{{"items",rows},{"network",false}};
  });
 }
 page->setRefreshAvailable(feed!=nullptr);activatePage(page);page->setActive(true);
}
void Window::prefetchEtfMonitor(const QDateTime& now){
 auto*page=qobject_cast<EtfMonitorPage*>(pages.value("etfMonitor"));auto state=etfPrefetch;
 if(!page||!state||!feed||!etfObservationFeed||persistenceClosing||!now.isValid()||(testing&&!etfTestNetwork))return;
 const bool visible=workspaceTabs->currentWidget()==page&&page->isVisible();
 const bool current=visible&&page->saveState()["history"].toString().isEmpty();
 const qint64 at=now.toMSecsSinceEpoch();
 // Rendering and collection have separate lifetimes. Keep the last displayed
 // bounded list while another page or a historical observation is being read.
 if(visible&&(current||state->ids.isEmpty())){
  QStringList ids;auto*list=page->findChild<QListWidget*>("etfMonitorRows");
  if(list)for(int n=0;n<list->count()&&ids.size()<24;++n){const auto id=list->item(n)->data(Qt::UserRole).toString();if(!ids.contains(id))ids.append(id);}
  if(ids!=state->ids){state->ids=ids;state->cursor=0;QSet<QString> retained;for(const auto&id:ids){retained.insert(id+"/quote");retained.insert(id+"/minute");}for(auto it=state->nextAttempt.begin();it!=state->nextAttempt.end();)if(!retained.contains(it.key()))it=state->nextAttempt.erase(it);else ++it;for(auto it=state->failures.begin();it!=state->failures.end();)if(!retained.contains(it.key()))it=state->failures.erase(it);else ++it;}
 }
 if(current){
  if(state->dirty&&etfRefreshToken.isEmpty()&&at>=state->publishAfter){
   try{page->applyHeldSnapshot(etfHostSnapshot::adapt(etfObservationFeed->instruments)["snapshot"].toObject());state->dirty=false;state->publishAfter=at+2000;}
   catch(const std::exception&e){page->setHostError(QString::fromUtf8(e.what()));}
  }
 }
 if(!state->token.isEmpty()||!etfRefreshToken.isEmpty()||state->ids.isEmpty()||at<state->nextDispatch)return;
 const int count=state->ids.size();
 for(int n=0;n<count*2;++n){
  const int slot=state->cursor++%(count*2);const auto id=state->ids[slot%count];const QString product=slot<count?"quote":"minute",key=id+"/"+product;
  if(at<state->nextAttempt.value(key))continue;
  try{etfHostSnapshot::request(etfObservationFeed->instruments,{{"ids",QJsonArray{id}},{"period",product}});}
  catch(...){state->nextAttempt[key]=at+300000;continue;}
  const auto token=QUuid::createUuid().toString(QUuid::WithoutBraces);state->token=token;state->nextDispatch=at+250;
  QPointer<Window> alive(this);
  etfObservationFeed->refreshEtf(id,product,token,[alive,state,token,id,product,key,now](QJsonObject receipt){
   if(!alive||alive->etfPrefetch!=state||state->token!=token)return;
   state->token.clear();
   const bool identity=receipt["token"]==token&&receipt["id"]==id&&receipt["period"]==product;
   const bool success=identity&&receipt["status"]=="success";
   const int failures=success?0:std::min(3,state->failures.value(key)+1);state->failures[key]=failures;
   state->nextAttempt[key]=now.toMSecsSinceEpoch()+marketRefresh::chinaInterval(now,failures,product=="quote"?30000:60000);
   // MarketFeed completes only after its individual SQLite write. Failure keeps
   // the previous dated value; no whole-history archive is appended here.
   state->dirty=true;
  });
  return;
 }
}
void Window::refreshEtfMonitor(QString token,QJsonObject selection){
 auto*page=qobject_cast<EtfMonitorPage*>(pages.value("etfMonitor"));if(!page)return;
 try{
  if(!feed||workspaceTabs->currentWidget()!=page)throw std::runtime_error("行情来源未连接或页面已离开");
  auto plan=etfHostSnapshot::request(etfObservationFeed->instruments,selection);etfRefreshToken=token;
  auto remaining=std::make_shared<int>(plan["ids"].toArray().size());auto seen=std::make_shared<QSet<QString>>();auto failures=std::make_shared<QStringList>();auto successes=std::make_shared<int>(0);
  QPointer<Window> alive(this);QPointer<EtfMonitorPage> target(page);
  for(auto value:plan["ids"].toArray()){
   if(etfRefreshToken!=token)break;QString id=value.toString(),product=plan["period"].toString();
   etfObservationFeed->refreshEtf(id,product,token,[alive,target,token,selection,plan,remaining,seen,failures,successes,id,product](QJsonObject receipt){
    if(!alive||!target||!etfHostSnapshot::accepts(alive->etfRefreshToken,receipt["token"].toString(),alive->workspaceTabs->currentWidget()==target))return;
    try{
     if(receipt["id"]!=id||receipt["period"]!=product||seen->contains(id))throw std::runtime_error("刷新回执身份不符");seen->insert(id);
     if(receipt["status"]!="success")failures->append(id.section(':',2)+" "+receipt["error"].toString("未取得"));else ++*successes;
     if(--*remaining==0){if(etfHostSnapshot::request(alive->etfObservationFeed->instruments,selection)!=plan)throw std::runtime_error("ETF清单已变化，请重新选择");if(*successes==0){alive->etfRefreshToken.clear();target->failRefresh(token,failures->join("；"));return;}auto snapshot=etfHostSnapshot::adapt(alive->etfObservationFeed->instruments,QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs))["snapshot"].toObject();
      const auto universePath=QFileInfo(alive->businessStore->filePath()).absolutePath()+"/etf-universe-v1.json";if(QFile::exists(universePath))saveUniverse(universePath,alive->etfObservationFeed->instruments);
      alive->etfRefreshToken.clear();target->acceptSnapshot(token,snapshot,failures->join("；"));}
    }catch(const std::exception&e){alive->etfRefreshToken.clear();target->failRefresh(token,QString::fromUtf8(e.what()));}
   });
  }
 }catch(const std::exception&e){etfRefreshToken.clear();page->failRefresh(token,QString::fromUtf8(e.what()));}
}
