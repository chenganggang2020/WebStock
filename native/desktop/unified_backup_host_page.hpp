#pragma once
#include "unified_backup_host.hpp"
#include "unified_backup_page.hpp"
#include "industry_archive_reading.hpp"
#include <QPointer>
#include <QLabel>
#include <QHideEvent>
#include <QShowEvent>

namespace unifiedBackup {
// Root opens the picker and later calls the corresponding accept* method.
struct Pickers {std::function<void()> importFile,newExportFile,receiptFile;};
class HostPage final:public QWidget {
 std::shared_ptr<Host> host;std::shared_ptr<AsyncLane> lane;Runner runner;Pickers pickers;Page* page;QTextEdit* details;QPushButton *save,*discard,*oldReceipt,*cancelTask;
 QByteArray pending;QJsonArray pendingIds;bool busy=false,picking=false,active=true;
 void refresh(){save->setEnabled(active&&!busy&&!picking&&!pending.isEmpty()&&bool(pickers.newExportFile));discard->setEnabled(!busy&&!picking&&!pending.isEmpty());oldReceipt->setEnabled(!busy&&!picking&&bool(pickers.receiptFile));page->setEnabled(active&&!busy&&!picking);cancelTask->setEnabled(active&&lane->busy()&&!lane->writeInFlight());}
 void run(Task task,Work work,Done done){need(bool(runner),"宿主执行器未接");if(busy||!active)return;busy=true;if(task.writing)display("正在写入并核验；离开不会撤销已开始的操作。");refresh();QPointer<HostPage> guard(this);auto finish=[guard,done](QJsonObject value,QString error){if(!guard)return;guard->busy=false;if(!error.isEmpty())guard->display("操作未确认："+error+"\n不会自动重试。");else try{done(value,{});}catch(const std::exception&e){guard->display(QString::fromUtf8(e.what()));}guard->refresh();};try{runner(task,std::move(work),finish);refresh();}catch(const std::exception&e){finish({},QString::fromUtf8(e.what()));}}
public:
 HostPage(std::shared_ptr<Host> h,std::shared_ptr<AsyncLane> a,Pickers p,QWidget*parent=nullptr):QWidget(parent),host(std::move(h)),lane(std::move(a)),runner(lane->runner()),pickers(std::move(p)){
  setObjectName("unifiedBackupHostPage");auto layout=new QVBoxLayout(this);
  auto receipt=new QLabel("本次回执位置（确认开始前不会创建）：\n"+host->receiptPath(),this);receipt->setWordWrap(true);receipt->setTextInteractionFlags(Qt::TextSelectableByMouse);layout->addWidget(receipt);
  page=new Page(host->coordinator(),lane,pickers.importFile?std::function<void()>([this]{picking=true;refresh();try{pickers.importFile();}catch(const std::exception&e){pickerCancelled();details->setPlainText(QString::fromUtf8(e.what()));}}):std::function<void()>{},[this](QByteArray bytes,QJsonObject summary){pending=std::move(bytes);pendingIds=summary["selectedDomainIds"].toArray();display(summary["display"].toString());refresh();},this);layout->addWidget(page,4);
  details=new QTextEdit(this);details->setReadOnly(true);details->setObjectName("hostBackupDetails");layout->addWidget(details,1);
  auto row=new QHBoxLayout;save=new QPushButton("确认预览并另存新文件",this);save->setObjectName("saveBackupNew");discard=new QPushButton("取消待导出备份",this);discard->setObjectName("discardBackupExport");oldReceipt=new QPushButton("只读查看历史回执",this);oldReceipt->setObjectName("inspectOldReceipt");row->addWidget(save);row->addWidget(discard);row->addWidget(oldReceipt);cancelTask=new QPushButton("取消读取 / 预览",this);cancelTask->setObjectName("cancelBackupTask");row->addWidget(cancelTask);layout->addLayout(row);connect(cancelTask,&QPushButton::clicked,this,[this]{lane->invalidate();pending.clear();pendingIds={};page->cancelPreview();display("预览已取消，等待后台释放资源；晚到结果不会接受。");});
  connect(save,&QPushButton::clicked,this,[this]{try{need(!lane->busy(),"后台任务仍在执行");QJsonArray current;for(auto* box:page->findChildren<QCheckBox*>())if(box->property("exportReady").isValid()&&box->isChecked())current.append(box->objectName());
    if(!equal(pendingIds,current)){pending.clear();refresh();need(false,"所选范围已变化，请重新生成并预览备份");}
    picking=true;refresh();pickers.newExportFile();
   }catch(const std::exception&e){pickerCancelled();details->setPlainText(QString::fromUtf8(e.what()));}});
  connect(discard,&QPushButton::clicked,this,[this]{pending.clear();details->setPlainText("已取消待导出备份；未写入文件。");refresh();});
  connect(oldReceipt,&QPushButton::clicked,this,[this]{picking=true;refresh();try{pickers.receiptFile();}catch(const std::exception&e){pickerCancelled();details->setPlainText(QString::fromUtf8(e.what()));}});
  page->onInvalidate=[this]{pending.clear();pendingIds={};refresh();};refresh();
 }
 void pickerCancelled(){picking=false;details->setPlainText("文件选择已取消；未写入数据或文件。");refresh();}
 void acceptImport(QString path){picking=false;if(!page->startImport()){refresh();return;}pending.clear();pendingIds={};auto h=host;run({false,false},[h,path]{auto b=decode(h->readImport(path));return QJsonObject{{"payload",b},{"display",Page::importText(b)}};},[this](QJsonObject r,QString){page->acceptPrepared(r["payload"].toObject(),r["display"].toString());});}
 void acceptExport(QString path){picking=false;auto h=host;auto bytes=pending;pending.clear();pendingIds={};run({true,false},[h,path,bytes]{h->saveExportNew(path,bytes);return QJsonObject{{"path",path}};},[this](QJsonObject result,QString){display("已写入新文件并独立回读确认：\n"+result["path"].toString());});}
 void acceptReceipt(QString path){picking=false;auto h=host;run({false,true},[h,path]{auto inspection=h->inspectReceipt(path);auto text=historicalReceiptText(inspection);for(auto row:inspection["receipt"].toObject()["domains"].toArray()){text+=::recentRestore::describeOperationRow(row.toObject())+::businessRestore::describeOperationRow(row.toObject());text+=::observationRestore::describeOperationRow(row.toObject());text+=::candidateRestore::describe(row.toObject());text+=::industryArchive::describeOperationRow(row.toObject());}return QJsonObject{{"display",text}};},[this](QJsonObject value,QString){page->showReceiptInspection(value["display"].toString());display("历史回执已校验；完整原字段与回执在上方分页阅读。不会继续旧操作。");});}
 void display(QString text){details->setPlainText(text.size()>32768?text.left(32768)+"\n[本区仅显示前32768字符；完整内容保留原文件，恢复差异在上方分页]":text);}
 void setActive(bool value){active=value;page->setActive(value);if(!value){pending.clear();pendingIds={};}refresh();}
 ~HostPage(){lane->invalidate();}
 protected:
 void hideEvent(QHideEvent* event)override{setActive(false);QWidget::hideEvent(event);}
 void showEvent(QShowEvent* event)override{QWidget::showEvent(event);setActive(true);}
};
}
