#include "recent_page.hpp"
#include "recent_legacy.hpp"
#include "recent_restore.hpp"
#include "page_snapshot_reader.hpp"
#include <QTextEdit>
#include <QComboBox>
#include <QFileDialog>
#include <QFileInfo>
#include <QHeaderView>
#include <QLabel>
#include <QLineEdit>
#include <QPushButton>
#include <QTemporaryFile>
#include <QSet>
#include <QScopeGuard>
#include <QSignalBlocker>
#include <QTableWidget>
#include <QVBoxLayout>
#include <cmath>
#include <functional>
#include <stdexcept>
namespace {
QString number(const QJsonValue& value) {
  return value.isDouble() && std::isfinite(value.toDouble()) ? QString::number(value.toDouble(),'f',2):"--";
}
QString local(const QJsonValue& value) {
  const auto time=QDateTime::fromString(value.toString(),Qt::ISODate);
  return time.isValid()?time.toOffsetFromUtc(28800).toString("yyyy-MM-dd HH:mm:ss"):"未取得";
}
void require(bool ok,const char* message) {if(!ok)throw std::runtime_error(message);}
}
RecentPage::RecentPage(std::shared_ptr<RecentStore> s,QWidget* p):QWidget(p),store(std::move(s)) {
  setObjectName("recentPage");auto root=new QVBoxLayout(this);root->setContentsMargins(8,8,8,8);root->setSpacing(6);
  auto tools=new QHBoxLayout;root->addLayout(tools);
  search=new QLineEdit;search->setObjectName("recentSearch");search->setPlaceholderText("搜索名称 / 代码 / 市场");search->setClearButtonEnabled(true);tools->addWidget(search,1);
  sort=new QComboBox;sort->setObjectName("recentSort");
  for(const auto& pair:QList<QPair<QString,QString>>{{"最近查看","last_viewed"},{"查看次数","view_count"},{"涨幅优先","change_desc"},{"跌幅优先","change_asc"}})sort->addItem(pair.first,pair.second);
  tools->addWidget(sort);
  state=new QLabel;state->setObjectName("recentState");state->setTextFormat(Qt::PlainText);state->setWordWrap(true);
  auto button=[&](QHBoxLayout* row,QString label,QString name,std::function<void()> action) {
    auto b=new QPushButton(label);b->setObjectName(name);row->addWidget(b);
    connect(b,&QPushButton::clicked,this,[this,action]{try{action();}catch(const std::exception& e){state->setText("未执行："+QString::fromUtf8(e.what()));}});return b;
  };
  button(tools,"更新报价","recentRefresh",[this]{state->setText("使用现有行情更新；本页不新增数据接口，不增加查看次数。");emit refreshQuotesRequested();});
  button(tools,"旧库导入","recentImport",[this]{const auto path=QFileDialog::getOpenFileName(this,"只读选择旧最近查看库",{},"SQLite (*.db *.sqlite)");if(!path.isEmpty())previewLegacy(path);});
  button(tools,"导出CSV","recentExport",[this]{const auto path=QFileDialog::getSaveFileName(this,"导出当前可见记录到新文件","最近查看.csv","CSV (*.csv)");if(!path.isEmpty())exportCsv(path);});
  button(tools,"清空记录","recentClear",[this]{clearConfirmation->show();});
  auto actions=new QHBoxLayout;root->addLayout(actions);
  open=button(actions,"打开行情","recentOpen",[this]{require(!property("recentReadPending").toBool(),"列表仍在读取，请稍后再操作");const auto item=selected();require(item["canOpen"].toBool(),"旧证券身份不明确，请从明确证券入口重新查看");emit openRequested(item["id"].toString(),false);});
  analysis=button(actions,"信号解释","recentAnalysis",[this]{require(!property("recentReadPending").toBool(),"列表仍在读取，请稍后再操作");const auto item=selected();require(item["canOpen"].toBool(),"证券身份不明确");emit openRequested(item["id"].toString(),true);});
  watchlist=button(actions,"加入自选","recentWatchlist",[this]{require(!property("recentReadPending").toBool(),"列表仍在读取，请稍后再操作");const auto item=selected();require(item["canOpen"].toBool(),"证券身份不明确");emit watchlistRequested(item);});
  ledger=button(actions,"记账 / 持仓","recentLedger",[this]{require(!property("recentReadPending").toBool(),"列表仍在读取，请稍后再操作");const auto item=selected();require(item["canOpen"].toBool()&&!item["id"].toString().contains(":index:"),"指数不能作为股票记账");emit ledgerRequested(item);});
  remove=button(actions,"删除选中","recentRemove",[this]{require(!property("recentReadPending").toBool(),"列表仍在读取，请稍后再操作");const auto item=selected();require(!item.isEmpty(),"请先选中记录");store->remove(item["id"].toString());{QSignalBlocker block(table);const int n=table->currentRow();if(n>=0&&n<visibleRows.size()){visibleRows.removeAt(n);table->removeRow(n);}if(!visibleRows.isEmpty())table->selectRow(0);}selectionChanged();reload();state->setText("已删除本机记录；旧库不变。");});actions->addStretch();
  auto backupActions=new QHBoxLayout;root->addLayout(backupActions);
  button(backupActions,"统一备份与恢复","recentBackupRestore",[this]{if(!isVisible()||!isEnabled())return;emit backupRestoreRequested();});backupActions->addStretch();
  clearConfirmation=new QWidget;clearConfirmation->setObjectName("recentClearConfirmation");auto clearRow=new QHBoxLayout(clearConfirmation);clearRow->setContentsMargins(0,0,0,0);
  clearRow->addWidget(new QLabel("清空所有本机最近查看？不会删除自选或改动旧数据库。"),1);
  button(clearRow,"确认清空","recentConfirmClear",[this]{store->clear();{QSignalBlocker block(table);visibleRows={};table->setRowCount(0);}clearConfirmation->hide();selectionChanged();reload();state->setText("本机最近查看已清空；迟到报价不会恢复已清记录。");});
  button(clearRow,"保留记录","recentCancelClear",[this]{clearConfirmation->hide();});root->addWidget(clearConfirmation);clearConfirmation->hide();
  summary=new QLabel;summary->setObjectName("recentSummary");summary->setTextFormat(Qt::PlainText);root->addWidget(summary);root->addWidget(state);
  table=new QTableWidget;table->setObjectName("recentTable");table->setColumnCount(8);
  table->setHorizontalHeaderLabels({"证券名称 / 市场","代码","最新价","涨跌幅 %","查看次数","最近查看（北京时间）","报价时间","来源 / 状态"});
  table->setEditTriggers(QAbstractItemView::NoEditTriggers);table->setSelectionBehavior(QAbstractItemView::SelectRows);table->setSelectionMode(QAbstractItemView::SingleSelection);
  table->verticalHeader()->hide();table->verticalHeader()->setDefaultSectionSize(30);table->horizontalHeader()->setSectionResizeMode(QHeaderView::ResizeToContents);table->horizontalHeader()->setStretchLastSection(true);root->addWidget(table,1);
  connect(table,&QTableWidget::itemSelectionChanged,this,&RecentPage::selectionChanged);
  connect(table,&QTableWidget::cellDoubleClicked,this,[this](int,int){if(open->isEnabled())open->click();});
  connect(search,&QLineEdit::textChanged,this,[this]{reload();});
  connect(sort,&QComboBox::currentIndexChanged,this,[this]{reload();});
  originalDetails=new QTextEdit;originalDetails->setObjectName("recentOriginalDetails");originalDetails->setReadOnly(true);originalDetails->setMinimumHeight(120);root->addWidget(originalDetails,1);
  auto originalPaging=new QHBoxLayout;root->addLayout(originalPaging);originalPrevious=button(originalPaging,"上一段原字段","recentOriginalPrevious",[this]{originalOffset=qMax(0,originalOffset-32768);renderOriginal();});originalNext=button(originalPaging,"下一段原字段","recentOriginalNext",[this]{originalOffset+=32768;renderOriginal();});
  importPanel=new QWidget;importPanel->setObjectName("recentImportPanel");auto importLayout=new QVBoxLayout(importPanel);importLayout->setContentsMargins(0,0,0,0);
  previewSummary=new QLabel;previewSummary->setObjectName("recentImportSummary");previewSummary->setTextFormat(Qt::PlainText);previewSummary->setWordWrap(true);importLayout->addWidget(previewSummary);
  preview=new QTableWidget;preview->setObjectName("recentImportPreview");preview->setColumnCount(5);preview->setHorizontalHeaderLabels({"旧证券 / 推导身份","次数","最近查看（北京时间）","身份状态","导入处理"});
  preview->setEditTriggers(QAbstractItemView::NoEditTriggers);preview->verticalHeader()->hide();preview->verticalHeader()->setDefaultSectionSize(30);preview->horizontalHeader()->setSectionResizeMode(QHeaderView::ResizeToContents);preview->horizontalHeader()->setStretchLastSection(true);importLayout->addWidget(preview,1);
  auto importActions=new QHBoxLayout;importLayout->addLayout(importActions);
  button(importActions,"确认导入新记录","recentConfirmImport",[this]{confirmLegacy();});
  button(importActions,"取消导入","recentCancelImport",[this]{pending={};importPanel->hide();state->setText("已取消；没有写入。");});importActions->addStretch();root->addWidget(importPanel,1);importPanel->hide();
  auto* reads=new PageSnapshotReader(this,[]{return QJsonObject{};},[this](QJsonObject data,QString error){
  setProperty("recentReadPending",false);setProperty("recentReadError",error);
  bool published=false;const auto selectedId=selected()["id"].toString();
  try {
    if(!error.isEmpty())throw std::runtime_error(error.toUtf8().constData());
    visibleRows=data["rows"].toArray();
    QSignalBlocker blocked(table);
    auto* header=table->horizontalHeader();
    header->setSectionResizeMode(QHeaderView::Fixed);
    const auto restoreColumnSizing=qScopeGuard([header]{header->setSectionResizeMode(QHeaderView::ResizeToContents);});
    table->setRowCount(visibleRows.size());int selectedRow=0;
    for(int n=0;n<visibleRows.size();++n) {
      const auto row=visibleRows[n].toObject(),q=row["quote"].toObject();
      const auto id=row["id"].toString();if(id==selectedId)selectedRow=n;
      auto source=q["source"].toString("未取得");
      source+=!q["price"].isDouble()?" · 无报价":q["cached"].toBool()||!q["error"].toString().isEmpty()?" · 旧缓存":" · 源时间见前列";
      if(!row["canOpen"].toBool())source+=" · 身份待核对";
      const QStringList fields{row["name"].toString()+" · "+id.section(':',0,1),row["code"].toString(),number(q["price"]),number(q["changePercent"]),QString::number(row["viewCount"].toInteger()),local(row["lastViewedAt"]),
        q["tradeDate"].toString().isEmpty()?"未取得":q["tradeDate"].toString()+" "+q["tradeTime"].toString(),source};
      for(int col=0;col<fields.size();++col) {
        auto item=new QTableWidgetItem(fields[col]);item->setToolTip(row["identityNote"].toString()+"\n"+q["error"].toString());
        if(col>=2&&col<=4)item->setTextAlignment(Qt::AlignRight|Qt::AlignVCenter);
        table->setItem(n,col,item);
      }
      const auto change=q["changePercent"];
      if(change.isDouble()&&std::isfinite(change.toDouble())&&change.toDouble()!=0)table->item(n,3)->setForeground(change.toDouble()>0?QColor("#c93c49"):QColor("#07875f"));
    }
    if(!visibleRows.isEmpty())table->selectRow(selectedRow);
    summary->setText(visibleRows.isEmpty()?"暂无匹配的最近查看；主动打开证券详情后记录。":QString("最近 %1 条 · 仅主动打开详情计次；显示源报价时间，不承诺实时").arg(visibleRows.size()));
    published=true;
  } catch(const std::exception& e) {summary->setText("读取未完成；上次显示暂保留，请解除数据库占用后重试。");state->setText("未更新："+QString::fromUtf8(e.what()));}
  selectionChanged();setProperty("recentSnapshotReady",published);if(auto* button=findChild<QPushButton*>("recentExport"))button->setEnabled(published);
  });reads->setObjectName("recentSnapshotReader");
  reload();
}
void RecentPage::reload() {
  auto* reads=dynamic_cast<PageSnapshotReader*>(findChild<QObject*>("recentSnapshotReader",Qt::FindDirectChildrenOnly));if(!reads)return;
  const auto path=store->filePath(),query=search->text(),order=sort->currentData().toString();
  setProperty("recentReadPending",true);setProperty("recentSnapshotReady",false);setProperty("recentReadError",QString());
  summary->setText("正在后台读取最近查看；原显示暂保留，尚未更新。");if(auto* button=findChild<QPushButton*>("recentExport"))button->setEnabled(false);for(auto b:{open,analysis,watchlist,ledger,remove})b->setEnabled(false);
  reads->requestCancellable([path,query,order](const PageSnapshotReader::Cancel& cancel){if(cancel())throw std::runtime_error("最近读取已取消");auto rows=RecentStore(path).list(query,order);if(cancel())throw std::runtime_error("最近读取已取消");return QJsonObject{{"rows",rows}};});
}
void RecentPage::applyQuotes(const QJsonArray& instruments) {
  try{store->updateQuotes(instruments);reload();}catch(const std::exception& e){state->setText("报价保存失败："+QString::fromUtf8(e.what()));}
}
void RecentPage::previewLegacy(const QString& path) {
  pending={};importPanel->hide();preview->setRowCount(0);
  const auto rows=recentLegacy::read(path);
  QSet<QString> existing;for(const auto& value:store->list({},"last_viewed",10000))existing.insert(value.toObject()["id"].toString());
  int conflicts=0,uncertain=0;preview->setRowCount(rows.size());
  for(int n=0;n<rows.size();++n) {
    const auto row=rows[n].toObject();const bool conflict=existing.contains(row["id"].toString());conflicts+=conflict;uncertain+=!row["canOpen"].toBool();
    const QStringList fields{row["name"].toString()+" · "+row["id"].toString(),QString::number(row["viewCount"].toInteger()),local(row["lastViewedAt"]),row["identityNote"].toString(),conflict?"冲突：保留本机记录":"新条目；重复导入会跳过"};
    for(int col=0;col<fields.size();++col)preview->setItem(n,col,new QTableWidgetItem(fields[col]));
  }
  pending=rows;
  previewSummary->setText(QString("只读预览 %1 条 · 冲突 %2 条（不覆盖本机）· 身份待核对 %3 条（保留但禁止跳转）\n确认前未导入；旧无时区时间按旧服务北京时间解析，旧报价不是实时行情。").arg(rows.size()).arg(conflicts).arg(uncertain));
  importPanel->show();state->setText("请核对下方逐条预览后确认；源数据库始终只读。");
}
void RecentPage::confirmLegacy() {
  require(!pending.isEmpty(),"没有待确认的旧记录");
  const auto result=store->importRows(pending);pending={};importPanel->hide();reload();
  state->setText(QString("导入完成：新增 %1，保留本机冲突 %2，已处理重复 %3；没有改动旧库。").arg(result["inserted"].toInt()).arg(result["conflicts"].toInt()).arg(result["duplicates"].toInt()));
}
void RecentPage::exportCsv(const QString& path) {
  require(!property("recentReadPending").toBool()&&property("recentSnapshotReady").toBool(),"最近列表尚无本次已完成快照，未导出；请等待读取完成后重试");
  require(!QFileInfo::exists(path),"请导出到新文件，不能覆盖已有文件或数据库");
  const auto bytes=RecentStore::csv(visibleRows);QTemporaryFile file(path+".recent-XXXXXX");
  require(file.open()&&file.write(bytes)==bytes.size()&&file.flush(),"CSV保存失败");
  file.close();
  // QFile::rename refuses an existing destination, including one created after
  // the initial check; QSaveFile::commit would replace that intervening file.
  require(file.rename(path),"CSV未导出：目标已出现或无法写入，请选择新的文件名");
  file.setAutoRemove(false);
  state->setText(QString("已导出当前 %1 条可见记录；未改变查看次数。").arg(visibleRows.size()));
}
QJsonObject RecentPage::selected() const {
  if(!table)return {};
  const auto row=table->currentRow();return row>=0&&row<visibleRows.size()?visibleRows[row].toObject():QJsonObject{};
}
void RecentPage::selectionChanged() {
  const auto item=selected();const auto known=!property("recentReadPending").toBool()&&!item.isEmpty()&&item["canOpen"].toBool();
  for(auto b:{open,analysis,watchlist})b->setEnabled(known);
  if(originalSelection!=item["id"].toString())originalOffset=0;originalSelection=item["id"].toString();originalText=item.isEmpty()?"选择记录查看完整原字段；选中不计次。":recentRestore::describeRow(item);renderOriginal();
  ledger->setEnabled(known&&!item["id"].toString().contains(":index:"));remove->setEnabled(!property("recentReadPending").toBool()&&!item.isEmpty());
}
void RecentPage::renderOriginal(){if(originalOffset>=originalText.size())originalOffset=0;auto end=qMin<qsizetype>(originalText.size(),originalOffset+32768);originalDetails->setPlainText(originalText.mid(originalOffset,32768));originalDetails->setToolTip(QString("完整原字段共 %1 字符；当前 %2 至 %3，分段显示，不截断原文").arg(originalText.size()).arg(originalOffset+1).arg(end));originalPrevious->setEnabled(originalOffset>0);originalNext->setEnabled(end<originalText.size());originalPrevious->setVisible(originalText.size()>32768);originalNext->setVisible(originalText.size()>32768);}
