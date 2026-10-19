#include "window.hpp"
#include "etf_monitor_page.hpp"
#include "etf_host_snapshot.hpp"
#include <QtWidgets>
#include <QPointer>
void Window::etfMonitorView(){
 auto*page=qobject_cast<EtfMonitorPage*>(pages.value("etfMonitor"));
 if(!page){
  QString path=QFileInfo(businessStore->filePath()).absolutePath()+"/etf-monitor-v35.json";bool existing=QFile::exists(path);
  page=new EtfMonitorPage(path,workspaceTabs);page->setProperty("pageTitle","ETF盘中观察");page->setProperty("workspace","资金");pages["etfMonitor"]=page;
  auto*cache=new QPushButton("重新载入行情",page);cache->setObjectName("etfMonitorReadHeld");qobject_cast<QVBoxLayout*>(page->layout())->insertWidget(0,cache);
  connect(cache,&QPushButton::clicked,page,[this,page]{try{page->setSnapshot(etfHostSnapshot::adapt(feed?feed->instruments:instruments)["snapshot"].toObject());}catch(...){page->setHostError({});}});
  connect(workspaceTabs,&QTabWidget::currentChanged,page,[this,page](int){bool active=workspaceTabs->currentWidget()==page;if(!active)etfRefreshToken.clear();page->setActive(active);});
  connect(page,&EtfMonitorPage::cancelRefreshRequested,this,[this](QString token){if(token==etfRefreshToken)etfRefreshToken.clear();});
  connect(page,&EtfMonitorPage::refreshRequested,this,&Window::refreshEtfMonitor);
  connect(page,&EtfMonitorPage::openChart,this,[this,page](QString id,QString p){
   bool prior=sourceEvidenceNavigation;
   try{auto target=etfHostSnapshot::chart(feed?feed->instruments:instruments,id,p);sourceEvidenceNavigation=true;home();if(p!="quote"){samplingSeconds=0;period=p;}loadInstrument(target["id"].toString(),false);if(p!="quote")setPeriod(p);recordViewedInstrument();}
   catch(...){page->setHostError({});}sourceEvidenceNavigation=prior;
  });
  activatePage(page);page->setActive(true);
  if(!existing)try{page->setSnapshot(etfHostSnapshot::adapt(feed?feed->instruments:instruments)["snapshot"].toObject());}catch(...){page->setHostError({});}
  if(settings){auto saved=QJsonDocument::fromJson(settings->value("etfMonitor/state").toByteArray());if(saved.isObject())page->restoreState(saved.object());}
 }
 page->setRefreshAvailable(feed!=nullptr);activatePage(page);page->setActive(true);
}
void Window::refreshEtfMonitor(QString token,QJsonObject selection){
 auto*page=qobject_cast<EtfMonitorPage*>(pages.value("etfMonitor"));if(!page)return;
 try{
  if(!feed||workspaceTabs->currentWidget()!=page)throw std::runtime_error("行情来源未连接或页面已离开");
  auto plan=etfHostSnapshot::request(feed->instruments,selection);etfRefreshToken=token;
  auto remaining=std::make_shared<int>(plan["ids"].toArray().size());auto seen=std::make_shared<QSet<QString>>();auto failures=std::make_shared<QStringList>();auto successes=std::make_shared<int>(0);
  QPointer<Window> alive(this);QPointer<EtfMonitorPage> target(page);
  for(auto value:plan["ids"].toArray()){
   if(etfRefreshToken!=token)break;QString id=value.toString(),product=plan["period"].toString();
   feed->refreshEtf(id,product,token,[alive,target,token,selection,plan,remaining,seen,failures,successes,id,product](QJsonObject receipt){
    if(!alive||!target||!etfHostSnapshot::accepts(alive->etfRefreshToken,receipt["token"].toString(),alive->workspaceTabs->currentWidget()==target))return;
    try{
     if(receipt["id"]!=id||receipt["period"]!=product||seen->contains(id))throw std::runtime_error("刷新回执身份不符");seen->insert(id);
     if(receipt["status"]!="success")failures->append(id.section(':',2)+" "+receipt["error"].toString("未取得"));else ++*successes;
     if(etfHostSnapshot::request(alive->feed->instruments,selection)!=plan)throw std::runtime_error("ETF清单已变化，请重新选择");
     if(--*remaining==0){if(*successes==0){alive->etfRefreshToken.clear();target->failRefresh(token,failures->join("；"));return;}auto snapshot=etfHostSnapshot::adapt(alive->feed->instruments,QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs))["snapshot"].toObject();alive->etfRefreshToken.clear();target->acceptSnapshot(token,snapshot,failures->join("；"));}
    }catch(const std::exception&e){alive->etfRefreshToken.clear();target->failRefresh(token,QString::fromUtf8(e.what()));}
   });
  }
 }catch(const std::exception&e){etfRefreshToken.clear();page->failRefresh(token,QString::fromUtf8(e.what()));}
}
