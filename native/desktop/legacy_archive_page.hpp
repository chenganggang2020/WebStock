#pragma once
#include <QtWidgets>
#include <QtSql>
#include <stdexcept>
#include "page_snapshot_reader.hpp"

// Local archive only: no jobs, token/session storage, executable SQL, or networking.
namespace legacyArchive {
inline const QStringList allowed={"expert_observations","knowledge_sources","expert_comments","expert_comment_captures","expert_observation_metrics","expert_sync_runs","expert_sync_run_items","ai_research_runs","external_research_batches","industry_concept_discovery","industry_research_topics","industry_research_versions","industry_research_evidence","industry_research_runs","portfolio_accounts","trades","portfolio_snapshots","watchlist","sectors","recent_stocks","sector_leaders","sector_leader_snapshots","stock_profiles","stock_search_index","market_quote_snapshots","market_quote_bars_5s","market_quote_bars_30s","knowledge_chunks","hot_market_snapshots","hot_market_ai_results","ai_screener_results","eastmoney_etf_daily_reports","paper_monitor_runs","paper_portfolios","paper_portfolio_items","paper_portfolio_positions","paper_portfolio_snapshots","paper_orders","paper_fills","paper_model_decisions","expert_backtests","screener_candidate_notes"};
inline void need(bool ok,const QString& message){if(!ok)throw std::runtime_error(message.toStdString());}
struct Connection {
 QString name=QUuid::createUuid().toString();QSqlDatabase db;
 explicit Connection(const QString& path){
  need(QFileInfo(path).isFile(),"旧版数据快照不存在；未创建空库");
  db=QSqlDatabase::addDatabase("QSQLITE",name);db.setDatabaseName(path);db.setConnectOptions("QSQLITE_OPEN_READONLY;QSQLITE_BUSY_TIMEOUT=1000");
  if(!db.open()){db={};QSqlDatabase::removeDatabase(name);throw std::runtime_error("旧版快照只读打开失败");}
 }
 ~Connection(){db.close();db={};QSqlDatabase::removeDatabase(name);}
};
inline QStringList tables(const QString& path){Connection c(path);QStringList result,found;QSqlQuery q(c.db);need(q.exec("SELECT name FROM sqlite_master WHERE type='table'"),"旧数据目录读取失败，请解除占用后重试");while(q.next())found<<q.value(0).toString();need(!q.lastError().isValid(),"旧数据目录读取失败");for(const auto& t:allowed)if(found.contains(t))result<<t;return result;}
inline QString row(const QString& path,const QString& table,qint64 offset){
 need(allowed.contains(table)&&offset>=0,"不是允许查阅的数据表或记录位置");Connection c(path);QSqlQuery q(c.db);
 const QRegularExpression sensitive("cookie|token|password|secret|credential|session|signed|media_url|play_url|download_url|config",QRegularExpression::CaseInsensitiveOption);
 QStringList columns;const auto schema=c.db.record(table);need(!schema.isEmpty(),"旧数据结构不可读");
 for(int i=0;i<schema.count();++i){auto name=schema.fieldName(i);name.replace('"',"\"\"");const auto quoted="\""+name+"\"";columns<<(sensitive.match(schema.fieldName(i)).hasMatch()?"NULL AS "+quoted:quoted);}
 need(q.prepare("SELECT "+columns.join(',')+" FROM \""+table+"\" ORDER BY rowid LIMIT 1 OFFSET ?"),"旧数据结构不可读");q.addBindValue(offset);need(q.exec(),"旧数据读取失败");if(!q.next())return {};
 QString text;const auto record=q.record();
 for(int i=0;i<record.count();++i){const auto key=record.fieldName(i);text+=key+"\n";
  if(sensitive.match(key).hasMatch())text+="[未展示敏感字段，原件保留]";
  else if(q.value(i).isNull())text+="[NULL / 未知]";
  else text+=q.value(i).toString();
  text+="\n\n";
 }
 return text;
}
class Page:public QWidget {
 QString path;QComboBox* table;QPlainTextEdit* text;QLabel* status;QSpinBox* index;
 PageSnapshotReader* reads=nullptr;bool catalogReady=false;
 void load(bool catalog=false){
  catalog=catalog||!catalogReady;const auto selected=table->currentText();const qint64 offset=index->value()-1;
  if(!catalog&&selected.isEmpty())return;
  setProperty("legacyArchivePending",true);setProperty("legacyArchiveReady",false);setProperty("legacyArchiveError",QString());
  text->clear();status->setText("正在读取档案…");
  reads->requestCancellable([file=path,selected,offset,catalog](const PageSnapshotReader::Cancel& cancel){
   if(cancel())throw std::runtime_error("档案读取已取消");
   QStringList names;QString chosen=selected;qint64 position=offset;
   if(catalog){names=tables(file);if(!names.contains(chosen)){chosen=names.value(0);position=0;}}
   if(cancel())throw std::runtime_error("档案读取已取消");
   const auto value=chosen.isEmpty()?QString():row(file,chosen,position);
   if(cancel())throw std::runtime_error("档案读取已取消");
   return QJsonObject{{"catalog",catalog},{"tables",QJsonArray::fromStringList(names)},{"table",chosen},{"offset",position},{"text",value}};
  });
 }
 public:
 explicit Page(QString file,QWidget* parent=nullptr):QWidget(parent),path(std::move(file)){
  setObjectName("legacyArchivePage");auto* layout=new QVBoxLayout(this);
  auto* notice=new QLabel("旧版数据完整快照｜已兼容资料在原业务页；此处查阅未转换的旧字段。会话、密钥、自动任务配置不提供入口。原视频仍保留在旧媒体目录。");notice->setWordWrap(true);layout->addWidget(notice);
  auto* bar=new QHBoxLayout;table=new QComboBox;table->setObjectName("legacyArchiveTable");bar->addWidget(table,1);index=new QSpinBox;index->setRange(1,2147483647);index->setPrefix("记录 ");bar->addWidget(index);
  auto* previous=new QPushButton("上一条");auto* next=new QPushButton("下一条");bar->addWidget(previous);bar->addWidget(next);auto* retry=new QPushButton("重新读取");retry->setObjectName("legacyArchiveReload");bar->addWidget(retry);layout->addLayout(bar);
  text=new QPlainTextEdit;text->setObjectName("legacyArchiveText");text->setReadOnly(true);layout->addWidget(text,1);status=new QLabel;status->setObjectName("legacyArchiveStatus");layout->addWidget(status);
  table->setEnabled(false);index->setEnabled(false);previous->setEnabled(false);next->setEnabled(false);
  reads=new PageSnapshotReader(this,[]{return QJsonObject{};},[this,previous,next](QJsonObject result,QString error){
   setProperty("legacyArchivePending",false);setProperty("legacyArchiveError",error);
   if(!error.isEmpty()){text->clear();status->setText(error);setProperty("legacyArchiveReady",false);return;}
   if(result["catalog"].toBool()){
    QSignalBlocker holdTable(table),holdIndex(index);table->clear();for(const auto& name:result["tables"].toArray())table->addItem(name.toString());
    table->setCurrentText(result["table"].toString());index->setValue(int(result["offset"].toInteger()+1));catalogReady=true;
   }
   table->setEnabled(table->count()>0);index->setEnabled(table->count()>0);previous->setEnabled(table->count()>0);next->setEnabled(table->count()>0);
   const auto value=result["text"].toString();text->setPlainText(value);status->setText(table->count()==0?"没有可查阅的数据表":value.isEmpty()?"此位置没有记录":"只读原始档案 · 未重算历史 · 不启动任务");
   setProperty("legacyArchiveReady",true);
  });
  reads->setObjectName("legacyArchiveReader");
  connect(table,&QComboBox::currentIndexChanged,this,[this]{QSignalBlocker hold(index);index->setValue(1);load();});
  connect(index,&QSpinBox::valueChanged,this,[this]{load();});connect(previous,&QPushButton::clicked,this,[this]{index->stepDown();});connect(next,&QPushButton::clicked,this,[this]{index->stepUp();});connect(retry,&QPushButton::clicked,this,[this]{load(true);});load(true);
 }
};
}
