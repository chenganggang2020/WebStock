#include "window.hpp"
#include "futures_monitor_page.hpp"
#include "futures_monitor_transport.hpp"
#include <QtWidgets>
#include <QPointer>
void Window::futuresMonitorView(){
 auto*page=dynamic_cast<FuturesMonitorPage*>(pages.value("futuresMonitor"));
 if(!page){
  auto*client=new FuturesMonitorTransport(this,futuresTestNetwork);
  QPointer<FuturesMonitorTransport> service(client);
  auto target=std::make_shared<QPointer<FuturesMonitorPage>>();
  const bool fixtureWithoutTransport=testing&&!futuresTestNetwork;
  page=new FuturesMonitorPage(QFileInfo(businessStore->filePath()).absolutePath()+"/futures-monitor-v1.sqlite",
   [service,target,fixtureWithoutTransport](QString token,QStringList symbols){
    if(fixtureWithoutTransport){if(*target)(*target)->deliver(token,{},"隔离模式未连接来源");return;}
    if(!service){if(*target)(*target)->deliver(token,{},"来源已关闭");return;}
    service->start(token,symbols,[target](QString t,QJsonArray rows,QString error){if(*target)(*target)->deliver(t,rows,error);});
   },[service](QString token){if(service)service->cancel(token);},workspaceTabs);
  *target=page;page->setObjectName("futuresMonitorPage");page->setProperty("pageTitle","期货价量仓");page->setProperty("workspace","资金");pages["futuresMonitor"]=page;
  connect(workspaceTabs,&QTabWidget::currentChanged,page,[this,page](int){if(workspaceTabs->currentWidget()!=page)page->cancel();});
  connect(page,&QObject::destroyed,client,[service]{if(service){service->close();service->deleteLater();}});
  if(settings){auto state=QJsonDocument::fromJson(settings->value("futuresMonitor/state").toByteArray());if(state.isObject())page->restoreState(state.object());}
 }
 activatePage(page);
}

