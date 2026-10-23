#include "window.hpp"
#include "account_edit_page.hpp"
#include <QtWidgets>
void Window::accountEditView(){
 auto*p=dynamic_cast<AccountEditPage*>(pages.value("accountEdit"));
 if(!p){
  AccountEditHost host;host.atomicCas=true;host.loadAccounts=[this]{return businessStore->read("accounts");};
  host.compareAndSave=[this](QJsonObject expected,QJsonObject candidate){
   auto actual=businessStore->editAccount(expected,candidate);
   for(auto*page:pages)for(auto*choice:page->findChildren<QComboBox*>("ledgerAccount"))for(int i=0;i<choice->count();++i)if(choice->itemData(i)==actual["id"].toString()){QSignalBlocker block(choice);choice->setItemText(i,actual["name"].toString());}
   return actual;
  };
  p=new AccountEditPage(host,workspaceTabs);p->setProperty("pageTitle","账户资料 / 手工现金");p->setProperty("workspace","自选与账户");pages["accountEdit"]=p;
  connect(workspaceTabs,&QTabWidget::currentChanged,p,[this,p](int){p->setActive(workspaceTabs->currentWidget()==p);});
  if(settings&&settings->contains("accountEdit/state"))try{auto bytes=settings->value("accountEdit/state").toByteArray();business::require(bytes.size()<=32*1024*1024,"账户草稿状态过大");
   QJsonParseError error;auto d=QJsonDocument::fromJson(bytes,&error);business::require(error.error==QJsonParseError::NoError&&d.isObject(),"账户草稿状态损坏，原状态保留");p->restoreState(d.object());
  }catch(const std::exception&e){accountEditStateFailed=true;p->findChild<QLabel*>("accountEditMessage")->setText(QString::fromUtf8(e.what()));}
 }
 activatePage(p);p->setActive(true);
}
void Window::saveAccountEditView(){
 if(!settings)return;
 if(accountEditStateFailed){
  auto*page=dynamic_cast<AccountEditPage*>(pages.value("accountEdit"));
  business::require(!page||!page->back(),"旧账户草稿未能恢复，新输入尚未处理；原状态保留，窗口未退出");
  return;
 }
 if(auto*p=dynamic_cast<AccountEditPage*>(pages.value("accountEdit"))){auto bytes=QJsonDocument(p->saveState()).toJson(QJsonDocument::Compact);business::require(bytes.size()<=32*1024*1024,"账户草稿超过32MiB，未截断");settings->setValue("accountEdit/state",bytes);}
}
