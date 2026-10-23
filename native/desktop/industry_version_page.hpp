#pragma once
#include "industry_archive_store.hpp"
#include "industry_version_catalog.hpp"
#include "business_store.hpp"
#include "industry_graph.hpp"
#include <QtWidgets>
#include <QFutureWatcher>
#include <QPromise>
#include <QThreadPool>
class IndustryVersionPage final:public QWidget{
 bool reading=false,readAgain=false;QString pendingTopic;
 std::shared_ptr<BusinessStore> store;QJsonArray groups;QComboBox *archives,*versions,*compare;QPlainTextEdit *reader,*comparison,*context;QLabel *status;QPlainTextEdit *delta,*graphDetail;IndustryGraph* graph;QComboBox* relation;QJsonArray graphRows;
 QJsonObject group()const{int n=archives->currentIndex();return n>=0&&n<groups.size()?groups[n].toObject():QJsonObject{};}
 void showGroup(){
  auto g=group();QSignalBlocker a(versions),b(compare);versions->clear();compare->clear();compare->addItem("不对比",QString());int current=-1;
  for(auto value:g["versions"].toArray()){auto v=value.toObject();auto id=v["id"].toString();auto label="#"+QString::number(v["sequence"].toInt())+" · "+id+" · "+v["createdAt"].toString();versions->addItem(label,id);compare->addItem(label,id);if(v["id"]==g["currentVersionId"])current=versions->count()-1;}
  versions->setCurrentIndex(current>=0?current:(versions->count()?0:-1));showVersion();
 }
 void showRelation(){auto key=relation->currentData().toString();graph->setSelection(key);for(auto v:graphRows){auto row=v.toObject();if(row["key"]==key){graphDetail->setPlainText(QString(row["bodyAvailable"].toBool()?"留存正文中的引文逐字匹配；仍需当前事实复核":"引用缺件或未逐字匹配；不得视为当前已核验")+"\n"+QString::fromUtf8(QJsonDocument(row).toJson(QJsonDocument::Indented)));return;}}graphDetail->clear();}
 void showVersion(){
  auto g=group(),v=industryArchive::version(g,versions->currentData().toString());reader->setPlainText(industryArchive::reportText(g,versions->currentData().toString()));comparison->setPlainText(industryArchive::reportText(g,compare->currentData().toString()));context->setPlainText(industryArchive::contextText(g));
  auto compared=compare->currentData().toString();delta->setPlainText(compared.isEmpty()?"选择对比版本后显示原关系ID的新增、删除、变化及证据变化。":QString::fromUtf8(QJsonDocument(industryArchive::difference(g,compared,versions->currentData().toString())).toJson(QJsonDocument::Indented)));
  graphRows=industryArchive::selectedRelations(g,versions->currentData().toString());QJsonArray displayed;for(auto value:graphRows){auto row=value.toObject();if(row["status"]=="legacyVerified")row["status"]="legacy";displayed.append(row);}graph->setRows(displayed);{QSignalBlocker blocker(relation);relation->clear();for(auto value:graphRows){auto row=value.toObject();relation->addItem(row["companyName"].toString()+" · "+row["relationId"].toString(),row["key"].toString());}}showRelation();
  status->setText(groups.isEmpty()?"暂无旧产业报告；可在统一备份中预览完整原件。":QString(g["complete"]==true?"完整原件已核对":"已有旧正文；完整关联未提供")+" · 原当前指针："+g["currentVersionId"].toString()+" · 所选原前版："+v["previousVersionId"].toString());
 }
public:
 explicit IndustryVersionPage(std::shared_ptr<BusinessStore> s,std::function<void()> backup={},QWidget* parent=nullptr):QWidget(parent),store(std::move(s)){
  setObjectName("industryVersionPage");auto layout=new QVBoxLayout(this);auto tools=new QHBoxLayout;layout->addLayout(tools);archives=new QComboBox(this);archives->setObjectName("industryReportArchive");tools->addWidget(archives,2);auto reload=new QPushButton("重读历史原件",this);tools->addWidget(reload);auto restore=new QPushButton("统一备份 / 恢复完整原件",this);restore->setObjectName("industryReportRestore");restore->setEnabled(bool(backup));tools->addWidget(restore);if(backup)connect(restore,&QPushButton::clicked,this,[backup]{backup();});
  auto selection=new QHBoxLayout;layout->addLayout(selection);versions=new QComboBox(this);versions->setObjectName("industryReportVersion");compare=new QComboBox(this);compare->setObjectName("industryReportCompare");selection->addWidget(new QLabel("查看版本",this));selection->addWidget(versions,1);selection->addWidget(new QLabel("对比版本",this));selection->addWidget(compare,1);
  auto tabs=new QTabWidget(this);layout->addWidget(tabs,1);auto split=new QSplitter(this);reader=new QPlainTextEdit(split);comparison=new QPlainTextEdit(split);reader->setObjectName("industryReportOriginal");comparison->setObjectName("industryReportComparison");reader->setReadOnly(true);comparison->setReadOnly(true);tabs->addTab(split,"完整版本 / 并排对比");context=new QPlainTextEdit(this);context->setObjectName("industryReportContext");context->setReadOnly(true);tabs->addTab(context,"原配置 / 运行 / 多证据");delta=new QPlainTextEdit(this);delta->setReadOnly(true);delta->setObjectName("industryVersionDifference");tabs->addTab(delta,"原版本关系差异");auto graphPage=new QWidget(this);auto graphLayout=new QVBoxLayout(graphPage);relation=new QComboBox(graphPage);relation->setObjectName("industryVersionRelation");graphLayout->addWidget(relation);auto graphSplit=new QSplitter(Qt::Vertical,graphPage);graphLayout->addWidget(graphSplit,1);auto scroll=new QScrollArea(graphSplit);scroll->setMinimumHeight(200);graphSplit->setChildrenCollapsible(false);graph=new IndustryGraph(scroll);graph->setObjectName("industryVersionGraph");scroll->setWidget(graph);scroll->setWidgetResizable(true);graphDetail=new QPlainTextEdit(graphSplit);graphDetail->setReadOnly(true);graphDetail->setObjectName("industryVersionEvidence");tabs->addTab(graphPage,"所选版本环节图 / 逐条证据");connect(relation,&QComboBox::currentIndexChanged,this,[this]{showRelation();});graph->selected=[this](QString key){int i=relation->findData(key);if(i>=0)relation->setCurrentIndex(i);};status=new QLabel(this);status->setObjectName("industryReportState");status->setWordWrap(true);layout->addWidget(status);
  connect(archives,&QComboBox::currentIndexChanged,this,[this]{showGroup();});connect(versions,&QComboBox::currentIndexChanged,this,[this]{showVersion();});connect(compare,&QComboBox::currentIndexChanged,this,[this]{showVersion();});connect(reload,&QPushButton::clicked,this,[this]{refresh();});
 }
 void refresh(){
  if(reading){readAgain=true;return;}reading=true;setProperty("catalogLoading",true);status->setText("正在读取历史报告…");
  using Result=QPair<QJsonArray,QString>;
  auto promise=std::make_shared<QPromise<Result>>();promise->start();auto watcher=new QFutureWatcher<Result>(this);
  connect(watcher,&QFutureWatcher<Result>::finished,this,[this,watcher]{
   const auto result=watcher->result();watcher->deleteLater();reading=false;
   if(readAgain){readAgain=false;refresh();return;}
   setProperty("catalogLoading",false);
   if(!result.second.isEmpty()){status->setText(result.second);return;}
   auto saved=archives->currentData().toString(),savedVersion=versions->currentData().toString(),savedCompare=compare->currentData().toString();QSignalBlocker blocker(archives);groups=result.first;archives->clear();
   for(auto v:groups){auto g=v.toObject();archives->addItem(g["name"].toString()+(g["complete"]==true?" · 完整档案":" · 已有正文"),g["key"].toString());}
   int n=archives->findData(saved);archives->setCurrentIndex(n>=0?n:(groups.size()?0:-1));
   if(!pendingTopic.isEmpty())setTopic(pendingTopic);showGroup();
   if(archives->currentData().toString()==saved){int v=versions->findData(savedVersion),c=compare->findData(savedCompare);if(v>=0)versions->setCurrentIndex(v);if(c>=0)compare->setCurrentIndex(c);}
  });watcher->setFuture(promise->future());const auto path=store->filePath();
  static QThreadPool*pool=[] {auto*p=new QThreadPool(qApp);p->setMaxThreadCount(1);return p;}();
  pool->start([promise,path]{Result result;try{
   const auto rows=industryArchive::Store(path).catalogRecords();QJsonArray reports,topics;
   for(auto v:rows){auto row=v.toObject();if(row["kind"]=="reports")reports.append(industryArchive::recordObject(row));if(row["kind"]=="topics")topics.append(industryArchive::recordObject(row));}
   result.first=industryArchive::catalog(reports,topics);
  }catch(const std::exception&e){result.second=QString::fromUtf8(e.what());}promise->addResult(result);promise->finish();});
 }
 void setTopic(QString id){if(id.startsWith("legacy-topic:"))id=id.mid(13);if(reading){pendingTopic=id;return;}pendingTopic.clear();for(int i=0;i<groups.size();++i)if(groups[i].toObject()["topicId"]==id){archives->setCurrentIndex(i);return;}}
protected:
 void showEvent(QShowEvent*e)override{QWidget::showEvent(e);refresh();}
};

