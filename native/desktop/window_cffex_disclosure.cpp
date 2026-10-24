#include "window.hpp"
#include "cffex_disclosure_page.hpp"
#include "cffex_disclosure_model.hpp"
#include "cffex_disclosure_transport.hpp"
#include <QtWidgets>
void Window::cffexDisclosureView(){
 auto*page=dynamic_cast<cffexDisclosure::Page*>(pages.value("cffexDisclosure"));
 try{
  if(!page){
   auto*client=new CffexDisclosureTransport(this,cffexTestNetwork);QPointer<CffexDisclosureTransport> service(client);
   auto target=std::make_shared<QPointer<cffexDisclosure::Page>>();const bool isolated=testing&&!cffexTestNetwork;
   auto path=QFileInfo(businessStore->filePath()).absolutePath()+"/cffex-disclosure-v1.json";
   page=new cffexDisclosure::Page({
    [target,service,isolated](QString token,QJsonObject q){
     if(!service||isolated){if(*target)(*target)->fail(token,"隔离模式未连接来源或来源已关闭");return;}
     service->start(token,q,[target](QString t,QJsonObject r,QString error){if(!*target)return;if(error.isEmpty())(*target)->accept(t,r);else (*target)->fail(t,error);});
    },[service](QString token){if(service)service->cancel(token);},
    [this](QString title,QString message){if(testing)return;statusBar()->showMessage(title+" · "+message,30000);if(!QSystemTrayIcon::isSystemTrayAvailable())return;auto*tray=findChild<QSystemTrayIcon*>("cffexNotificationTray");if(!tray){tray=new QSystemTrayIcon(windowIcon(),this);tray->setObjectName("cffexNotificationTray");tray->setToolTip("Stock 期货披露");tray->show();}tray->showMessage(title,message,QSystemTrayIcon::Information,15000);}
   },path,workspaceTabs);
   *target=page;page->setObjectName("cffexDisclosurePage");page->setProperty("workspace","资金");page->setProperty("pageTitle","股指期货指定日披露");pages["cffexDisclosure"]=page;
   connect(workspaceTabs,&QTabWidget::currentChanged,page,[this,page]{if(workspaceTabs->currentWidget()!=page)page->cancel();});
   connect(qApp,&QGuiApplication::applicationStateChanged,page,[page](Qt::ApplicationState s){if(s!=Qt::ApplicationActive)page->cancel();});
   connect(page,&QObject::destroyed,client,[service]{if(service){service->close();service->deleteLater();}});
   QFile file(path+".reading.json");if(file.exists()){try{
    if(!file.open(QIODevice::ReadOnly)||file.size()>8*1024*1024)throw std::runtime_error("阅读缓存不可读或过大");auto d=QJsonDocument::fromJson(file.readAll());if(!d.isObject())throw std::runtime_error("阅读缓存损坏，原文件保留");page->restoreState(d.object());
   }catch(const std::exception&e){page->findChild<QLabel*>("cffexStatus")->setText("阅读状态未恢复："+QString::fromUtf8(e.what()));}}
  }
  activatePage(page);
 }catch(const std::exception&e){dataState->setText("披露页未打开："+QString::fromUtf8(e.what()));}
}
void Window::saveCffexDisclosureState(bool strict){
 auto*p=dynamic_cast<cffexDisclosure::Page*>(pages.value("cffexDisclosure"));if(!p)return;try{
  auto path=QFileInfo(businessStore->filePath()).absolutePath()+"/cffex-disclosure-v1.json.reading.json";QFile old(path);
  if(old.exists()){if(!old.open(QIODevice::ReadOnly)||old.size()>8*1024*1024)throw std::runtime_error("原阅读缓存不能验证");auto d=QJsonDocument::fromJson(old.readAll());if(!d.isObject()||d.object()["schema"]!="cffex-reading/v1")throw std::runtime_error("原阅读缓存损坏，拒绝覆盖");auto r=d.object()["report"].toObject();if(!r.isEmpty())cffexDisclosure::validate(r);old.close();}
  auto bytes=QJsonDocument(p->saveState()).toJson(QJsonDocument::Compact);if(bytes.size()>8*1024*1024)throw std::runtime_error("阅读状态过大，未截断");
  QSaveFile file(path);if(!file.open(QIODevice::WriteOnly)||file.write(bytes)!=bytes.size()||!file.commit())throw std::runtime_error("阅读状态未保存");
 }catch(const std::exception&e){p->findChild<QLabel*>("cffexStatus")->setText("阅读状态未保存："+QString::fromUtf8(e.what()));if(strict)throw;}
}
