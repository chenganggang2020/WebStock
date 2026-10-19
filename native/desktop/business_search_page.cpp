#include "business_search_page.hpp"
#include "securities_legacy_store.hpp"
#include "stock_profile_service.hpp"
#include "research_presentation.hpp"
#include "native_read_pool.hpp"
#include <QPointer>
#include <QShowEvent>
#include <QHideEvent>
#include <QTimer>
#include <QTabWidget>
#include <QTextBrowser>
#include <QComboBox>
#include <QHeaderView>
#include <QHBoxLayout>
#include <QLabel>
#include <QLineEdit>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QSignalBlocker>
#include <QSplitter>
#include <QTableWidget>
#include <QVBoxLayout>

static BusinessSearchPage::Sources localSources(QString database,QString cacheDirectory){
 BusinessSearchPage::Sources sources;
 sources.snapshot=[database]{return SecuritiesLegacyStore(database).snapshot();};
 sources.cachedProfile=[cacheDirectory](QString id){return StockProfileCache(cacheDirectory).owned(id).packet;};
 return sources;
}
BusinessSearchPage::BusinessSearchPage(QString database,QString cache,Navigate fn,QWidget* parent):BusinessSearchPage(localSources(database,cache),std::move(fn),parent){}
BusinessSearchPage::BusinessSearchPage(Sources input,Navigate fn,QWidget* parent):QWidget(parent),sources(std::move(input)),navigate(std::move(fn)){
 setObjectName("businessSearchPage");auto layout=new QVBoxLayout(this);auto title=new QLabel("主营资料搜索");title->setStyleSheet("font-size:20px;font-weight:600");layout->addWidget(title);
 auto info=new QLabel("搜索代码、名称、主营、行业或经营范围；选择结果进入个股研究。");info->setWordWrap(true);layout->addWidget(info);
 auto bar=new QHBoxLayout;layout->addLayout(bar);query=new QLineEdit;query->setObjectName("businessSearchQuery");query->setPlaceholderText("例如：封测、银行、电子器件制造");bar->addWidget(query,1);
 field=new QComboBox;field->setObjectName("businessSearchField");for(auto pair:{std::pair<const char*,const char*>{"全部字段","all"},{"主营组成","business"},{"行业","industry"},{"板块","board"},{"范围/回顾/标签","scope"}})field->addItem(QString::fromUtf8(pair.first),QString(pair.second));bar->addWidget(field);
 sort=new QComboBox;sort->setObjectName("businessSearchSort");sort->addItem("匹配度","relevance");sort->addItem("名称","name");sort->addItem("取得响应时刻","time");bar->addWidget(sort);
 auto find=new QPushButton("搜索");find->setObjectName("businessSearchSearch");bar->addWidget(find);auto reloadButton=new QPushButton("重新载入资料");reloadButton->setObjectName("businessSearchReload");bar->addWidget(reloadButton);
 auto split=new QSplitter(Qt::Vertical);layout->addWidget(split,1);results=new QTableWidget;results->setObjectName("businessSearchResults");results->setColumnCount(7);results->setHorizontalHeaderLabels({"证券 / 代码","行业","主营/命中理由","来源","取得时刻","旧库更新时刻","身份"});results->setSelectionBehavior(QAbstractItemView::SelectRows);results->setSelectionMode(QAbstractItemView::SingleSelection);results->setEditTriggers(QAbstractItemView::NoEditTriggers);results->verticalHeader()->hide();results->horizontalHeader()->setSectionResizeMode(QHeaderView::Interactive);results->horizontalHeader()->setStretchLastSection(true);results->setColumnWidth(0,200);results->setColumnWidth(1,90);results->setColumnWidth(2,260);results->setColumnWidth(3,130);results->setColumnWidth(4,170);results->setColumnWidth(5,150);split->addWidget(results);
 auto tabs=new QTabWidget;tabs->setObjectName("businessSearchReadingTabs");summary=new QTextBrowser;summary->setObjectName("businessSearchSummary");summary->setOpenLinks(false);summary->document()->setDocumentMargin(16);tabs->addTab(summary,"主营概况");details=new QPlainTextEdit;details->setObjectName("businessSearchDetails");details->setReadOnly(true);tabs->addTab(details,"来源详情");split->addWidget(tabs);split->setStretchFactor(0,3);split->setStretchFactor(1,2);
 auto actions=new QHBoxLayout;layout->addLayout(actions);research=new QPushButton("进入个股研究");research->setObjectName("businessSearchOpenResearch");chart=new QPushButton("查看K线");chart->setObjectName("businessSearchOpenChart");actions->addWidget(research);actions->addWidget(chart);actions->addStretch();status=new QLabel;status->setObjectName("businessSearchStatus");status->setWordWrap(true);layout->addWidget(status);
 previous=new QPushButton("上一页");previous->setObjectName("businessSearchPrevious");next=new QPushButton("下一页");next->setObjectName("businessSearchNext");actions->addWidget(previous);actions->addWidget(next);
 connect(previous,&QPushButton::clicked,this,[this]{offset=qMax(0,offset-100);renderResults();});
 connect(next,&QPushButton::clicked,this,[this]{if(offset+100<hits.size()){offset+=100;renderResults();}});
 connect(find,&QPushButton::clicked,this,[this]{safe([this]{search();});});connect(query,&QLineEdit::returnPressed,find,&QPushButton::click);connect(field,&QComboBox::currentIndexChanged,this,[this]{safe([this]{search();});});connect(sort,&QComboBox::currentIndexChanged,this,[this]{safe([this]{search();});});connect(reloadButton,&QPushButton::clicked,this,[this]{reload();});connect(results,&QTableWidget::itemSelectionChanged,this,[this]{selectedId=selectedRow().value("id").toString();renderSelection();});connect(research,&QPushButton::clicked,this,[this]{open("research");});connect(chart,&QPushButton::clicked,this,[this]{open("chart");});connect(results,&QTableWidget::cellDoubleClicked,this,[this](int,int){open("research");});renderResults();reload();
}
void BusinessSearchPage::safe(std::function<void()> fn){try{fn();}catch(const std::exception& e){status->setText(QString::fromUtf8(e.what()));}}
void BusinessSearchPage::reload(){
 ++dataSerial;needsLoad=true;search();
}
void BusinessSearchPage::showEvent(QShowEvent* e){QWidget::showEvent(e);QTimer::singleShot(0,this,[this]{dispatch();});}
void BusinessSearchPage::hideEvent(QHideEvent* e){++requestSerial;if(busy)pending=true;QWidget::hideEvent(e);}
QJsonObject BusinessSearchPage::selectedRow()const{auto index=results->currentRow();return index>=0&&offset+index<hits.size()?hits[offset+index].toObject():QJsonObject{};}
void BusinessSearchPage::search(){
 ++requestSerial;pending=true;status->setText("正在整理资料… 可以继续搜索或切换页面。");dispatch();
}
void BusinessSearchPage::dispatch(){
 if(busy||!pending||!isVisible())return;
 busy=true;pending=false;
 const auto serial=requestSerial,revision=dataSerial;const bool loading=needsLoad;
 const auto input=sources;const auto prior=rows;const auto stats=sourceStats;
 const businessSearch::Query filter{query->text(),field->currentData().toString(),sort->currentData().toString()};
 QPointer<BusinessSearchPage> owner(this);auto* app=QCoreApplication::instance();
 nativeReadPool()->start([owner,app,serial,revision,loading,input,prior,stats,filter]{
  auto data=prior;auto meta=stats;QJsonArray found;QString failure;int rejected=0,extra=0;
  try{
   if(loading){
    SecuritiesLegacyStore::Snapshot snapshot;
    if(input.snapshot)snapshot=input.snapshot();
    else{stockResearch::need(bool(input.directory)&&bool(input.profiles)&&bool(input.stats),"宿主未接共享资料读取接口");snapshot={input.stats(),input.directory(),input.profiles()};}
    stockResearch::need(snapshot.meta.value("available").toBool(),"资料库尚不可用");
    data=businessSearch::catalog(snapshot.directory,snapshot.profiles,input.cachedProfile);meta=snapshot.meta;
   }
   found=businessSearch::search(data,filter);
   for(auto v:found)if(!v.toObject().value("canOpen").toBool())++rejected;
   for(auto v:data)if(v.toObject().value("origin")=="legacy-profile-only")++extra;
  }catch(const std::exception& e){failure=QString::fromUtf8(e.what());}
  QMetaObject::invokeMethod(app,[owner,serial,revision,loading,data,meta,found,failure,rejected,extra]{
   if(!owner)return;auto* page=owner.data();page->busy=false;
   if(page->isVisible()&&page->dataSerial==revision){
    // A changed query reuses the validated dataset, never the stale search hits.
    if(failure.isEmpty()&&loading){page->rows=data;page->sourceStats=meta;page->needsLoad=false;}
    if(page->requestSerial==serial){
     if(failure.isEmpty()){
      page->hits=found;page->error.clear();page->rejected=rejected;page->supplemental=extra;page->offset=0;
      for(int n=0;n<found.size();++n)if(found[n].toObject().value("id")==page->selectedId){page->offset=n/100*100;break;}
      page->renderResults();
     }else{page->error=failure;page->status->setText("资料读取失败："+failure+"；此前结果和选择已保留。");}
    }
   }
   if(owner)owner->dispatch();
  },Qt::QueuedConnection);
 });
}
void BusinessSearchPage::renderResults(){
 const int count=qMin(100,int(hits.size())-offset);int keep=-1;
 {QSignalBlocker blocked(results);results->clearContents();results->setCurrentCell(-1,-1);results->setRowCount(qMax(0,count));
  for(int n=0;n<count;++n){auto row=hits[offset+n].toObject(),values=row.value("values").toObject(),source=row.value("matchSource").toObject();if(row.value("id")==selectedId)keep=n;
   QStringList cols{stockResearch::display(values.value("name"))+"\n"+row.value("code").toString(),stockResearch::display(values.value("industry")),row.value("matchReason").toString(),stockResearch::display(source.value("source")),stockResearch::display(source.value("fetchedAt")),stockResearch::display(source.value("updatedAt")),row.value("canOpen").toBool()?"已核身份":"身份待核（不能跳转）"};
   for(int c=0;c<cols.size();++c){auto* item=new QTableWidgetItem(cols[c].left(300));item->setToolTip(c==0?cols[c]+"\n"+row.value("id").toString():cols[c]);results->setItem(n,c,item);}
  }if(keep>=0)results->selectRow(keep);
 }
 previous->setEnabled(offset>0);next->setEnabled(offset+100<hits.size());
 status->setText(QString("目录 %1 · 主营资料 %2 · 补充资料 %3 | 结果 %4 / %5 · 身份待核 %6 · 第 %7 / %8 页。%9").arg(sourceStats.value("directoryRows").toInt()).arg(sourceStats.value("profileRows").toInt()).arg(supplemental).arg(hits.size()).arg(rows.size()).arg(rejected).arg(offset/100+1).arg(qMax(1,(int(hits.size())+99)/100)).arg(error.isEmpty()?QString():"最近重读失败："+error));renderSelection();
}
void BusinessSearchPage::renderSelection(){auto row=selectedRow();auto open=!row.isEmpty()&&row.value("canOpen").toBool();research->setEnabled(open);chart->setEnabled(open);if(row.isEmpty()){summary->setHtml("<h2>主营资料搜索</h2><p>选择一条结果查看公司主营和经营范围。</p>");details->setPlainText(rows.isEmpty()?"尚无可搜索的工作资料；等待旧资料转换完成。":"选择一条结果查看完整命中理由、来源和原资料。");return;}
 QString text=row.value("matchReason").toString()+"\n完整身份："+row.value("id").toString()+"\n身份依据："+row.value("identityReason").toString()+"\n命中来源与时点：\n"+stockResearch::pretty(row.value("matchSource").toObject());auto legacy=row.value("legacyProfile").toObject();if(!legacy.isEmpty())text+="\n"+businessSearch::legacyOverview(legacy)+"\n"+businessSearch::legacyOriginal(legacy);else text+="\n该结果尚无旧主营摘录；旧索引原字段保留如下。";text+="\n旧索引全部原字段：\n"+stockResearch::pretty(row.value("legacy").toObject());if(!row.value("nativeProfile").toObject().isEmpty())text+="\n原生F10缓存概况：\n"+stockProfile::overview(row.value("nativeProfile").toObject());for(auto key:{"legacyProfileError","nativeProfileError"})if(row.contains(key))text+="\n读取限制："+row.value(key).toString();if(row.contains("rejectedProfile"))text+="\n未核旧资料（禁止跳转）：\n"+stockResearch::pretty(row.value("rejectedProfile").toObject());details->setPlainText(text);
 QString html;try{
  auto id=row["id"].toString();auto p=row["nativeProfile"].toObject();
  if(!row["canOpen"].toBool())html="<h2>证券身份待核</h2><p>资料已保留；确认身份前不能跳转到其他证券。完整原资料见来源详情。</p>";
  else if(!p.isEmpty()){stockProfile::validate(id,p);html=researchPresentation::company(id,p);}
  else if(!legacy.isEmpty()){businessSearch::validateLegacy(id,legacy);html=researchPresentation::company(id,QJsonDocument::fromJson(legacy["row"].toObject()["legacy"].toObject()["payload_json"].toString().toUtf8()).object(),true);}
  else {auto values=row["values"].toObject();html="<h2>"+researchPresentation::field(values["name"])+"</h2><p>行业："+researchPresentation::field(values["industry"])+"</p><h3>主营业务</h3><p>"+researchPresentation::field(values["businessSummary"])+"</p><h3>经营范围</h3><p>"+researchPresentation::field(values["businessScope"])+"</p>";}
 }catch(const std::exception& e){html="<h2>资料无法读取</h2><p>"+QString::fromUtf8(e.what()).toHtmlEscaped()+"</p>";}
 for(auto key:{"legacyProfileError","nativeProfileError"})if(row.contains(key))html+="<p>资料读取受限："+row[key].toString().toHtmlEscaped()+"</p>";
 summary->setHtml(html);
}
void BusinessSearchPage::open(QString action){safe([this,action]{auto row=selectedRow();stockResearch::need(isVisible()&&!row.isEmpty()&&row.value("canOpen")==true,"请选择已核完整身份；未跳转其他证券");stockResearch::identity(row.value("id").toString());stockResearch::need(bool(navigate),"宿主未接个股研究/K线入口");navigate(row,action);});}
QJsonObject BusinessSearchPage::saveState()const{return {{"schema","business-search-view/v1"},{"query",query->text()},{"field",field->currentData().toString()},{"sort",sort->currentData().toString()},{"selectedId",selectedId}};}
void BusinessSearchPage::restoreState(QJsonObject value){safe([this,value]{stockResearch::need(value.value("schema")=="business-search-view/v1","主营搜索视图状态无效");int f=field->findData(value.value("field").toString()),s=sort->findData(value.value("sort").toString());stockResearch::need(f>=0&&s>=0&&value.value("query").isString(),"主营搜索视图字段无效");{QSignalBlocker a(field),b(sort);field->setCurrentIndex(f);sort->setCurrentIndex(s);query->setText(value.value("query").toString());}selectedId=value.value("selectedId").toString();search();});}
