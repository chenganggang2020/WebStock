#include "window.hpp"
#include "account_reference_page.hpp"
#include <QtWidgets>
QJsonObject Window::accountReferenceOutput(const QString& id) const {
 QJsonObject selected;for(auto v:businessStore->read("accounts"))if(v.toObject()["id"]==id)selected=v.toObject();
 business::require(!selected.isEmpty(),"当前账户不存在；未保留旧结果");
 auto trades=businessStore->read("trades");QJsonObject quotes;
 for(auto v:instruments){auto row=v.toObject();auto full=row["id"].toString();business::require(!quotes.contains(full),"行情包含重复证券身份");
  if(row["quote"].isObject())quotes[full]=row["quote"];}
 const auto cut=QDateTime::currentDateTimeUtc();QJsonObject context{{"schema","native-account-reference-context/v1"},{"date",cut.toOffsetFromUtc(8*3600).date().toString(Qt::ISODate)},{"asOf",cut.toString(Qt::ISODateWithMs)},{"nativeTradeContract",true},{"nativeSinaPreviousCloseContract",true}};
 // No ledgerCompleteThroughDate: a date-only same-day ledger is not verified complete.
 return accountReference::evaluate(selected,trades,quotes,context);
}
void Window::accountReferenceView(const QString& requested){
 auto*container=pages.value("accountReference");QComboBox*choice=nullptr;AccountReferencePage*reference=nullptr;
 if(!container){
  container=new QWidget(workspaceTabs);container->setProperty("pageTitle","今日参考盈亏 / 成本比例");container->setProperty("workspace","自选与账户");pages["accountReference"]=container;
  auto*layout=new QVBoxLayout(container);choice=new QComboBox;choice->setObjectName("accountReferenceAccount");layout->addWidget(choice);
  auto*boundary=new QLabel("账本参考盈亏 · 按报价日期计算，未完成收盘对账。");boundary->setWordWrap(true);layout->addWidget(boundary);
  for(auto v:businessStore->read("accounts")){auto a=v.toObject();choice->addItem(a["name"].toString()+" · "+a["id"].toString(),a["id"].toString());}
  if(!requested.isEmpty())choice->setCurrentIndex(choice->findData(requested));
  reference=new AccountReferencePage([this,choice]{return accountReferenceOutput(choice->currentData().toString());},container);layout->addWidget(reference,1);
  connect(choice,&QComboBox::currentIndexChanged,reference,[reference](int){reference->reload();});
 }else{
  choice=container->findChild<QComboBox*>("accountReferenceAccount");reference=dynamic_cast<AccountReferencePage*>(container->findChild<QWidget*>("accountReferencePage"));
  const auto wanted=requested.isEmpty()?choice->currentData().toString():requested;QSignalBlocker blocked(choice);choice->clear();
  for(auto v:businessStore->read("accounts")){auto a=v.toObject();choice->addItem(a["name"].toString()+" · "+a["id"].toString(),a["id"].toString());}
  choice->setCurrentIndex(choice->findData(wanted));reference->reload();
 }
 activatePage(container);
}

