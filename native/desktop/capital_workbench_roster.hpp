#pragma once
#include "capital_workbench_model.hpp"
#include "capital_model_history.hpp"
#include "financial_delegate.hpp"
#include "dark_stock.hpp"
#include "dark_observation.hpp"
#include <QtWidgets>
#include <atomic>
#include <functional>

// Read-only roster join. It never adds to or rewrites the user's watchlist.
class CapitalWorkbenchRoster final:public QWidget {
 QJsonArray stocks,current,modelHistory;QJsonObject snapshot,history;QHash<QString,QJsonObject> models,latest;
 QString directory,active;bool network;int page=0;quint64 generation=0,historyGeneration=0;
 QThreadPool workers;std::shared_ptr<std::atomic_bool> cancelled=std::make_shared<std::atomic_bool>(false);
 std::shared_ptr<std::atomic_bool> historyCancelled=std::make_shared<std::atomic_bool>(false);
 std::shared_ptr<std::atomic_bool> backfillCancelled=std::make_shared<std::atomic_bool>(false);bool backfillBusy=false;
 QComboBox* scope;QLineEdit* search;QDateEdit* date;QLabel* state;QLabel* paging;QTableWidget* table;QPushButton* refresh;
 static QString amount(QJsonValue n){return n.isDouble()?QString::number(n.toDouble()/10000.,'f',2):QString("—");}
public:
 std::function<void(QJsonObject)> selected;
 std::function<void(QJsonArray,QString)> modelChanged;
 std::function<void(QString,bool)> backfillChanged;
 CapitalWorkbenchRoster(QString dir,QJsonArray roster,bool allow,QWidget* parent=nullptr):QWidget(parent),stocks(roster),directory(std::move(dir)),network(allow){
  setObjectName("capitalRoster");workers.setMaxThreadCount(1);auto* root=new QVBoxLayout(this);root->setContentsMargins(0,0,0,0);
  auto* controls=new QHBoxLayout;scope=new QComboBox;scope->setObjectName("capitalScope");scope->addItems({"自选股票","全部明暗榜股票","大盘资金"});
  search=new QLineEdit;search->setObjectName("capitalSearch");search->setPlaceholderText("搜索股票 / 指数名称或代码");
  date=new QDateEdit(QDateTime::currentDateTimeUtc().toOffsetFromUtc(28800).date());date->setObjectName("capitalModelDate");date->setCalendarPopup(true);date->setDisplayFormat("yyyy-MM-dd");
  refresh=new QPushButton("更新明暗榜");refresh->setObjectName("capitalModelRefresh");refresh->setEnabled(network);
  auto* stop=new QPushButton("取消明暗榜");auto* reload=new QPushButton("重读已保存");
  controls->addWidget(scope);controls->addWidget(search,1);controls->addWidget(date);controls->addWidget(refresh);controls->addWidget(stop);controls->addWidget(reload);root->addLayout(controls);
  state=new QLabel;state->setObjectName("capitalModelState");state->setTextFormat(Qt::PlainText);state->setWordWrap(true);root->addWidget(state);
  table=new QTableWidget(0,11);table->setObjectName("capitalRosterTable");table->setHorizontalHeaderLabels({"名称 / 代码","涨跌%","主力 · 万元","暗盘估算 · 万元","明盘估算 · 万元","超大单 · 万元","大单 · 万元","中单 · 万元","小单 · 万元","资金源日期","模型交易日 / 抓取时刻"});
  table->setEditTriggers(QAbstractItemView::NoEditTriggers);table->setSelectionBehavior(QAbstractItemView::SelectRows);table->setSelectionMode(QAbstractItemView::SingleSelection);table->verticalHeader()->hide();table->horizontalHeader()->setSectionResizeMode(QHeaderView::Interactive);table->horizontalHeader()->setStretchLastSection(true);
  for(int i=0;i<11;++i)table->setColumnWidth(i,i==0?180:i==1?70:i==10?220:135);
  financialVisual::install(table,{1},false);financialVisual::install(table,{2,3,4,5,6,7,8});root->addWidget(table,1);
  auto* footer=new QHBoxLayout;auto* prev=new QPushButton("上一页");auto* next=new QPushButton("下一页");paging=new QLabel;
  footer->addWidget(prev);footer->addWidget(paging,1);footer->addWidget(next);root->addLayout(footer);
  connect(search,&QLineEdit::textChanged,this,[this]{page=0;render();});connect(scope,&QComboBox::currentIndexChanged,this,[this]{page=0;render();});
  connect(prev,&QPushButton::clicked,this,[this]{if(page>0){--page;render();}});connect(next,&QPushButton::clicked,this,[this]{if((page+1)*100<current.size()){++page;render();}});
  auto choose=[this](int row){if(row<0||!table->item(row,0))return;auto s=table->item(row,0)->data(Qt::UserRole).toJsonObject();active=s["id"].toString();history={};modelHistory={};if(selected)selected(s);readHistory(s["symbol"].toString());};
  connect(table,&QTableWidget::currentCellChanged,this,[choose](int row){choose(row);});
  connect(table,&QTableWidget::cellClicked,this,[choose](int row,int){choose(row);});
  connect(refresh,&QPushButton::clicked,this,[this]{load(true);});connect(reload,&QPushButton::clicked,this,[this]{load(false);});connect(date,&QDateEdit::dateChanged,this,[this]{load(false);});
  connect(stop,&QPushButton::clicked,this,[this]{cancel();state->setText("已取消；未完成刷新不计成功，原记录保留。");});
  render();QTimer::singleShot(0,this,[this]{load(false);});
 }
 ~CapitalWorkbenchRoster()override{backfillCancelled->store(true);cancel();++historyGeneration;workers.clear();workers.waitForDone();}
 void cancelBackfill(){backfillCancelled->store(true);}
 void backfill(QDate first,QDate last){
  if(!network||backfillBusy)return;backfillBusy=true;backfillCancelled=std::make_shared<std::atomic_bool>(false);auto token=backfillCancelled;const auto dir=directory;QPointer<CapitalWorkbenchRoster> self(this);
  if(backfillChanged)backfillChanged("正在后台回补明暗日线；旧记录保留，可离开本页。",true);
  workers.start([self,dir,first,last,token]{QJsonObject receipt;QString error;
   auto progress=[self](QString text){QMetaObject::invokeMethod(qApp,[self,text]{if(self&&self->backfillChanged)self->backfillChanged(text,true);},Qt::QueuedConnection);};
   try{receipt=darkHistory::backfill(dir,first,last,[token]{return token->load();},progress);}catch(const std::exception& e){error=QString::fromUtf8(e.what());}
   QMetaObject::invokeMethod(qApp,[self,receipt,error]{if(!self)return;self->backfillBusy=false;
    const auto text=error.isEmpty()?QString("回补%1：新增 %2 天，保留 %3 天，未取得 %4 天。%5").arg(receipt["cancelled"].toBool()?"已取消":"结束").arg(receipt["saved"].toInt()).arg(receipt["preserved"].toInt()).arg(receipt["failed"].toInt()).arg(receipt["stoppedReason"].toString()):"回补未完成："+error;
    if(self->backfillChanged)self->backfillChanged(text,false);self->readHistory(self->active.section(':',0,0).toLower()+self->active.section(':',2));
   },Qt::QueuedConnection);
  });
 }
 void cancel(){cancelled->store(true);historyCancelled->store(true);++generation;refresh->setEnabled(network);}
 void setCurrent(const QString& id){active=id;render();}
 void updateSources(const QJsonArray& items){for(auto v:items){auto s=v.toObject();latest[s["id"].toString()]=s;}render();}
 QJsonArray modelRows()const{return capitalWorkbench::modelSeries(snapshot,history,active.section(':',0,0).toLower()+active.section(':',2));}
 QJsonArray historicalModelRows()const{auto out=modelHistory;for(auto v:modelRows())out.append(v);return out;}
 QString modelStatus()const{return "明暗盘模型估算 · 交易日 "+snapshot["tradingDay"].toString()+" · 柱图横轴为原抓取时刻（非行情源时点）；单点不推断趋势";}
 void notifyModel(){if(modelChanged)modelChanged(modelRows(),modelStatus());}
 void load(bool online){
  cancel();cancelled=std::make_shared<std::atomic_bool>(false);auto token=cancelled;const auto seq=generation;
  const auto day=date->date().toString(Qt::ISODate);const auto dir=directory;QPointer<CapitalWorkbenchRoster> self(this);
  state->setText(online?"正在核验完整明暗榜；完成前不覆盖原记录…":"正在读取原日期记录…");refresh->setEnabled(false);
  workers.start([self,seq,day,dir,token,online]{QJsonObject result;QString error;
   try{darkStock::Store store(dir);result=online?store.refresh(day,[token]{return token->load();}):store.read(day);if(result.isEmpty())result=store.latestOnOrBefore(day);}catch(const std::exception& e){error=QString::fromUtf8(e.what());try{result=darkStock::Store(dir).latestOnOrBefore(day);}catch(...){} }
   QMetaObject::invokeMethod(qApp,[self,seq,day,result,error,online]{if(!self||self->generation!=seq)return;self->snapshot=result;self->models.clear();for(auto v:result["rows"].toArray())self->models[v.toObject()["key"].toString()]=v.toObject();
    const auto actual=result["tradingDay"].toString();self->state->setText(QString("明暗盘模型估算 · %1 · 数据交易日 %2 · %3 行 · 请求日 %4%5").arg(online&&error.isEmpty()&&actual==day?"本次完整获取":"已保存历史（非本次更新成功）",actual).arg(result["rows"].toArray().size()).arg(day,error.isEmpty()?QString():" · 更新失败："+error));
    self->refresh->setEnabled(self->network);self->render();self->readHistory(self->active.section(':',0,0).toLower()+self->active.section(':',2));
   },Qt::QueuedConnection);
  });
 }
private:
 void readHistory(const QString& key){
  historyCancelled->store(true);historyCancelled=std::make_shared<std::atomic_bool>(false);
  history={};modelHistory={};notifyModel();const auto seq=++historyGeneration;const auto day=snapshot["tradingDay"].toString();if(!active.contains(":stock:"))return;
  QPointer<CapitalWorkbenchRoster> self(this);const auto dir=directory;const auto through=date->date().toString(Qt::ISODate);auto token=historyCancelled;
  workers.start([self,seq,dir,day,key,through,token]{QJsonObject h;QJsonArray all;QStringList errors;try{all=capitalWorkbench::savedModelHistory(dir,key,through,[token]{return token->load();},errors);if(!day.isEmpty())h=darkObservation::Store(dir+".observations-v1").read(key,day,[token]{return token->load();});}catch(const std::exception& e){errors.append(QString::fromUtf8(e.what()));}
   QMetaObject::invokeMethod(qApp,[self,seq,h,all,errors,token]{if(!self||self->historyGeneration!=seq||token->load())return;self->history=h;self->modelHistory=all;self->notifyModel();if(!errors.isEmpty())self->state->setText(self->state->text()+" · 观察档案读取未完成："+errors.join("；"));},Qt::QueuedConnection);
  });
 }
 void render(){
  current={};QJsonArray source=scope->currentIndex()==2?capitalWorkbench::markets():stocks;
  if(scope->currentIndex()==1){source={};for(auto v:snapshot["rows"].toArray()){auto s=capitalWorkbench::stock(v.toObject());if(!s.isEmpty())source.append(s);}}
  for(auto v:source){auto s=v.toObject();if(scope->currentIndex()==0&&!s["id"].toString().contains(":stock:"))continue;if((s["name"].toString()+s["symbol"].toString()).contains(search->text().trimmed(),Qt::CaseInsensitive))current.append(s);}
page=std::min(page,std::max(0,(int(current.size())-1)/100));QSignalBlocker block(table);table->setUpdatesEnabled(false);table->setCurrentCell(-1,-1);table->setRowCount(std::min(100,int(current.size())-page*100));int match=-1;
  for(int i=0;i<table->rowCount();++i){auto s=current[page*100+i].toObject();auto id=s["id"].toString();if(latest.contains(id))s=latest[id];const auto model=s["id"].toString().contains(":stock:")?models.value(s["symbol"].toString()):QJsonObject{};
auto rows=s["capitalDay"].toArray();auto meta=s["capitalDayMeta"].toObject();const auto day=date->date().toString(Qt::ISODate);const auto last=capitalWorkbench::onDay(rows,day);const auto sameDayModel=snapshot["tradingDay"]==day?model:QJsonObject{};auto change=capitalWorkbench::changePercent(s["quote"].toObject()["tradeDate"]==day?s:QJsonObject{},sameDayModel);
   QStringList values{s["name"].toString()+"  "+s["symbol"].toString().mid(2),change.isDouble()?QString::number(change.toDouble(),'f',2):"—",amount(last["mainNet"]),amount(capitalWorkbench::yuan(sameDayModel["darkNetCents"])),amount(capitalWorkbench::yuan(sameDayModel["visibleNetCents"])),amount(last["superNet"]),amount(last["largeNet"]),amount(last["mediumNet"]),amount(last["smallNet"]),last.isEmpty()?"该日未取得":last["label"].toString()+(meta["cached"].toBool()?" · 已保存":""),sameDayModel.isEmpty()?"该日未取得":snapshot["tradingDay"].toString()+" / "+QDateTime::fromString(sameDayModel["receivedAt"].toString(),Qt::ISODateWithMs).toOffsetFromUtc(28800).toString("MM-dd HH:mm:ss")};
   for(int c=0;c<values.size();++c)table->setItem(i,c,new QTableWidgetItem(values[c]));table->item(i,0)->setData(Qt::UserRole,s);if(id==active)match=i;
  }
  if(match>=0)table->selectRow(match);table->setUpdatesEnabled(true);paging->setText(QString("%1 项 · 第 %2/%3 页 · 点击一行查看全页历史；主力与模型估算不相加").arg(current.size()).arg(page+1).arg(std::max(1,(int(current.size())+99)/100)));
 }
protected:
 void hideEvent(QHideEvent* event)override{QWidget::hideEvent(event);}
};
