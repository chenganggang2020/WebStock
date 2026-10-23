#include "sector_watch_page.hpp"
#include "visible_refresh.hpp"
#include "sector_watch_feed.hpp"
#include "board_series_widget.hpp"
#include <QStackedWidget>
#include <QFileInfo>
#include "sector_watch_store.hpp"
QJsonArray SectorWatchPage::sourceEvidence() const {
 QJsonArray out;
 // Read only the two selected keys; never enumerate the cache or request a source.
 for(auto q:{catalogQuery(),memberQuery()})if(!q.isEmpty()){
  auto saved=sectorWatch::Store(file).read(q);
  out.append(QJsonObject{{"snapshot",q.value("kind")=="catalog"?catalog:current},{"query",q},{"lastAttempt",saved.value("lastAttempt")}});
 }
 return out;
}
#include "chart.hpp"
#include <QApplication>
#include <QComboBox>
#include <QLineEdit>
#include <QLabel>
#include <QPushButton>
#include <QTableWidget>
#include <QHeaderView>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QSplitter>
#include <QFileDialog>
#include <QSignalBlocker>
#include <QDateTime>
#include <QPointer>
#include <QHideEvent>
#include <QShowEvent>
#include <cmath>
namespace {
QString value(const QJsonValue& v,int digits=2){return v.isDouble()?QString::number(v.toDouble(),'f',digits):QString("—");}
double number(const QJsonValue& v){return v.isDouble()&&std::isfinite(v.toDouble())?v.toDouble():NAN;}
QTableWidget* table(QString name,QStringList labels,QWidget* parent){auto t=new QTableWidget(0,labels.size(),parent);t->setObjectName(name);t->setHorizontalHeaderLabels(labels);t->setEditTriggers(QAbstractItemView::NoEditTriggers);t->setSelectionBehavior(QAbstractItemView::SelectRows);t->setSelectionMode(QAbstractItemView::SingleSelection);t->verticalHeader()->hide();t->verticalHeader()->setDefaultSectionSize(40);t->horizontalHeader()->setSectionResizeMode(QHeaderView::ResizeToContents);t->horizontalHeader()->setSectionResizeMode(0,QHeaderView::Interactive);t->setColumnWidth(0,180);t->horizontalHeader()->setStretchLastSection(true);return t;}
QJsonObject instrument(QJsonObject row){row["symbol"]=row["market"].toString().toLower()+row["code"].toString();row["group"]="默认分组";return row;}
QString summary(const QJsonObject& s,bool directory=true){if(s["catalogTransport"]=="ths-official-category-html")return QString("同花顺官网可见目录 %1 项 · 本轮抓取 %2\n分类区及本页新建链接已核对；未扫描历史新增归档页。不含报价，K线独立读取。").arg(s["items"].toArray().size()).arg(s["fetchedAt"].toString());if(s.isEmpty())return directory?"暂无此分类数据，请点击获取目录":"暂无此板块成分数据，请点击获取此板块完整成分";if(s["catalogTransport"]=="official-classification-html")return QString("官网完整分类目录 %1 项 · 名称与BK代码已核验 · 不含实时报价\n抓取 %2 → %3\n%4 · K线需单独读取，不用估算或缓存冒充更新").arg(s["items"].toArray().size()).arg(s["startedAt"].toString(),s["fetchedAt"].toString(),s["sourceUrl"].toString());return QString("%1行 / 来源声明%2 · 集合%3 · 报价%4\n抓取 %5 → %6\n行情统一时点未知；不是同时快照；缺数显示—").arg(s["items"].toArray().size()).arg(s["declaredTotal"].toInt()).arg(s["coverageComplete"].toBool()?"齐全":"不完整").arg(s["quoteComplete"].toBool()?"字段齐全":"有缺项").arg(s["startedAt"].toString(),s["fetchedAt"].toString());}
}
SectorWatchPage::SectorWatchPage(QString path,bool enabled,QWidget* parent,QNetworkAccessManager* transport):QWidget(parent),file(std::move(path)),allowNetwork(enabled),feed(new sectorWatch::Feed(this,transport)){
 setObjectName("sectorWatchPage");workers.setMaxThreadCount(1);auto shell=new QVBoxLayout(this);shell->setContentsMargins(0,0,0,0);pageViews=new QStackedWidget(this);shell->addWidget(pageViews);memberView=new QWidget(pageViews);memberView->setObjectName("sectorMemberView");auto root=new QVBoxLayout(memberView);root->setContentsMargins(6,6,6,6);root->setSpacing(5);auto tools=new QHBoxLayout;
 provider=new QComboBox(this);provider->setObjectName("sectorProvider");provider->addItem("东方财富公开板块","eastmoney-public-board");provider->addItem("同花顺公开板块","ths-public-board");provider->addItem("新浪公开分类","sina");taxonomy=new QComboBox(this);taxonomy->setObjectName("sectorTaxonomy");taxonomy->addItem("行业","industry");taxonomy->addItem("概念","concept");filter=new QLineEdit(this);filter->setObjectName("sectorFilter");filter->setPlaceholderText("筛选当前成分名称 / 完整代码");sort=new QComboBox(this);sort->setObjectName("sectorSort");sort->addItem("涨幅降序·缺数末尾","changePct");sort->addItem("成交额降序·缺数末尾","amount");sort->addItem("主力净额·供应商分类","mainNetInflow");
 fetchCatalog=new QPushButton("获取完整目录",this);fetchCatalog->setObjectName("sectorFetchCatalog");fetchMembers=new QPushButton("获取此板块完整成分",this);fetchMembers->setObjectName("sectorFetchMembers");stopButton=new QPushButton("取消",this);stopButton->setObjectName("sectorCancel");for(auto w:QList<QWidget*>{provider,taxonomy,fetchCatalog,fetchMembers,stopButton})tools->addWidget(w);tools->addStretch();root->addLayout(tools);
 state=new QLabel("请选择行业或概念目录",this);state->setObjectName("sectorState");state->setWordWrap(true);root->addWidget(state);auto split=new QSplitter(Qt::Horizontal,this);split->setChildrenCollapsible(false);root->addWidget(split,1);
 auto left=new QWidget(split);auto ll=new QVBoxLayout(left);ll->setContentsMargins(0,0,0,0);ll->addWidget(new QLabel("来源板块目录 · 不同分类不按同名合并",left));boardFilter=new QLineEdit(left);boardFilter->setObjectName("sectorBoardFilter");boardFilter->setPlaceholderText("筛选板块名称 / 来源代码");ll->addWidget(boardFilter);boards=table("sectorBoards",{"板块名称 / 代码","涨幅%"},left);ll->addWidget(boards);
 connect(boardFilter,&QLineEdit::textChanged,this,[this]{renderBoards();});
 auto middle=new QWidget(split);auto ml=new QVBoxLayout(middle);ml->setContentsMargins(0,0,0,0);auto mt=new QHBoxLayout;mt->addWidget(filter,1);mt->addWidget(sort);ml->addLayout(mt);members=table("sectorMembers",{"证券 / 市场代码","最新","涨幅%","成交额(元)","主力净额(元)"},middle);ml->addWidget(members);
 auto right=new QWidget(split);auto rl=new QVBoxLayout(right);rl->setContentsMargins(0,0,0,0);details=new QLabel("选择板块，再选择成分。成分列表不是自选。",right);details->setObjectName("sectorDetails");details->setWordWrap(true);rl->addWidget(details);quoteState=new QLabel("分时等待明确选择；统一来源时点未知",right);quoteState->setObjectName("sectorQuoteState");quoteState->setWordWrap(true);rl->addWidget(quoteState);chart=new Chart(right);chart->setObjectName("sectorChart");chart->minute=true;chart->periodName="分时";chart->overlay=false;chart->showNine=false;chart->volumeLabel="成交量 · 手（来源口径）";chart->setSeries({}, {},true);rl->addWidget(chart,1);auto actions=new QHBoxLayout;openButton=new QPushButton("打开原生K线",right);openButton->setObjectName("sectorOpen");addButton=new QPushButton("明确加入自选",right);addButton->setObjectName("sectorAdd");exportButton=new QPushButton("导出当前集合…",right);exportButton->setObjectName("sectorExport");actions->addWidget(openButton);actions->addWidget(addButton);actions->addWidget(exportButton);rl->addLayout(actions);split->setSizes({230,420,650});
 pageViews->addWidget(memberView);boardSeries=new BoardSeriesWidget(QFileInfo(file).absolutePath()+"/board-series-v1",allowNetwork,pageViews,transport);pageViews->addWidget(boardSeries);
 openBoardButton=new QPushButton("板块自身 K 线",this);openBoardButton->setObjectName("openBoardKline");tools->insertWidget(4,openBoardButton);
 connect(openBoardButton,&QPushButton::clicked,this,&SectorWatchPage::openBoardSeries);
 connect(boardSeries,&BoardSeriesWidget::backRequested,this,[this]{pageViews->setCurrentWidget(memberView);});
 connect(boardSeries,&BoardSeriesWidget::directoryRefreshRequested,this,&SectorWatchPage::refreshBoardDirectory);

 auto boundary=new QLabel("当前：完整板块目录 / 成分 / 行情联动。人工龙头、多日旧热度、外部研究、AI复核仍属后续迁移；本页没有替代它们。",this);boundary->setWordWrap(true);root->addWidget(boundary);
 auto changed=[this]{cancel();catalog={};current={};board={};selected={};restoreBoard.clear();boards->setRowCount(0);members->setRowCount(0);chart->setSeries({}, {},true);details->setText("已切换来源/分类，正在读取独立缓存");quoteState->setText("尚未选择成分");loadCache(true);};connect(provider,&QComboBox::currentIndexChanged,this,changed);connect(taxonomy,&QComboBox::currentIndexChanged,this,changed);connect(filter,&QLineEdit::textChanged,this,[this]{renderMembers();});connect(sort,&QComboBox::currentIndexChanged,this,[this]{renderMembers();});connect(boards,&QTableWidget::itemSelectionChanged,this,&SectorWatchPage::selectBoard);connect(members,&QTableWidget::itemSelectionChanged,this,&SectorWatchPage::selectMember);connect(fetchCatalog,&QPushButton::clicked,this,[this]{fetch(true);});connect(fetchMembers,&QPushButton::clicked,this,[this]{fetch(false);});connect(stopButton,&QPushButton::clicked,this,[this]{cancel();state->setText("已取消；已提交完整缓存保留，不发布晚回调");});connect(openButton,&QPushButton::clicked,this,[this]{if(selected["canOpen"].toBool())emit openInstrument(selected["id"].toString());});connect(addButton,&QPushButton::clicked,this,[this]{if(selected["canOpen"].toBool())emit addWatchlist(instrument(selected));});connect(exportButton,&QPushButton::clicked,this,[this]{auto path=QFileDialog::getSaveFileName(this,"导出新文件（不覆盖）",{},"JSON (*.json);;CSV (*.csv)");if(!path.isEmpty())exportSnapshot(path);});
 connect(feed,&sectorWatch::Feed::finished,this,[this](QJsonObject q,QJsonObject result,QString error){if(!busy||q!=(q["kind"]=="catalog"?catalogQuery():memberQuery()))return;bool directory=q["kind"]=="catalog";auto path=file;state->setText(error.isEmpty()?"完整读取完成，正在核验保存":"读取失败，旧完整缓存保留："+error);if(error.isEmpty())run([path,result](auto cancel){sectorWatch::Store(path).save(result,cancel);return result;},[this,directory](QJsonObject result){if(directory){catalog=result;if(boardSeries)boardSeries->setDirectory(result);renderBoards();}else{current=result;renderMembers();}state->setText("完整集合已保存；"+summary(result));});else{QString at=QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);run([path,q,error,at](auto cancel){sectorWatch::Store(path).recordFailure(q,error.left(1000),at,cancel);return QJsonObject{};},[this,error](QJsonObject){state->setText("读取失败，旧完整缓存保留："+error);});}});controls();
}
SectorWatchPage::~SectorWatchPage(){cancel();workers.clear();workers.waitForDone();}
QJsonObject SectorWatchPage::catalogQuery()const{auto p=provider->currentData().toString(),t=taxonomy->currentData().toString();if(p=="sina")p="sina-public-"+t;return sectorWatch::query(p,t);}
QJsonObject SectorWatchPage::memberQuery()const{if(board.isEmpty()||provider->currentData()=="ths-public-board")return QJsonObject{};auto q=catalogQuery();return sectorWatch::query(q["provider"].toString(),q["taxonomy"].toString(),board["code"].toString());}
void SectorWatchPage::cancel(){++generation;cancelled->store(true);workers.clear();busy=false;feed->cancel();if(boardSeries)boardSeries->cancelRead();controls();}
void SectorWatchPage::run(std::function<QJsonObject(const sectorWatch::Cancel&)> work,std::function<void(QJsonObject)> done){cancelled->store(true);cancelled=std::make_shared<std::atomic_bool>(false);auto flag=cancelled;auto token=++generation;busy=true;controls();QPointer<SectorWatchPage> self(this);workers.start([self,flag,token,work,done]{QJsonObject result;QString error;try{result=work([flag]{return flag->load();});}catch(const std::exception& e){error=QString::fromUtf8(e.what());}QMetaObject::invokeMethod(qApp,[self,flag,token,result,error,done]{if(!self||flag->load()||self->generation!=token)return;self->busy=false;if(error.isEmpty())done(result);else self->state->setText(error+"；已提交记录仍保留");self->controls();},Qt::QueuedConnection);});}
void SectorWatchPage::loadCache(bool directory){auto q=directory?catalogQuery():memberQuery();if(q.isEmpty())return;cancel();state->setText("正在载入板块数据");QString path=file;run([path,q](auto cancel){return sectorWatch::Store(path).read(q,cancel);},[this,directory](QJsonObject saved){auto result=saved["snapshot"].toObject();if(directory){catalog=result;if(boardSeries)boardSeries->setDirectory(result);renderBoards();}else{current=result;renderMembers();}QString error=saved["lastAttempt"].toObject()["error"].toString();state->setText((result.isEmpty()?"":"已载入 · ")+summary(result,directory)+(error.isEmpty()?QString():"\n最近失败："+error));});}
void SectorWatchPage::fetch(bool directory){if(!allowNetwork){state->setText("此实例禁止网络，只能查看本机缓存");return;}auto q=directory?catalogQuery():memberQuery();if(q.isEmpty()||busy)return;cancel();busy=true;controls();state->setText("显式读取此集合；总截止8秒，无全市场后台扫描");try{if(!feed->start(q)){busy=false;state->setText("已有读取未结束");controls();}}catch(const std::exception& e){busy=false;state->setText(QString::fromUtf8(e.what()));controls();}}
void SectorWatchPage::renderBoards(){rendering=true;QString keep=restoreBoard.isEmpty()?board.value("key").toString():restoreBoard,needle=boardFilter->text().trimmed();bool restoring=!restoreBoard.isEmpty();boards->setRowCount(0);for(auto v:sectorWatch::sorted(catalog.value("items").toArray(),"changePct")){auto row=v.toObject();if(!needle.isEmpty()&&!row["name"].toString().contains(needle,Qt::CaseInsensitive)&&!row["code"].toString().contains(needle,Qt::CaseInsensitive))continue;int r=boards->rowCount();boards->insertRow(r);auto item=new QTableWidgetItem(row["name"].toString()+"\n"+row["code"].toString());item->setData(Qt::UserRole,row);boards->setItem(r,0,item);boards->setItem(r,1,new QTableWidgetItem(value(row["changePct"])));if(row["key"]==keep)boards->selectRow(r);}rendering=false;if(restoring&&boards->currentRow()>=0){restoreBoard.clear();QTimer::singleShot(0,this,[this,keep]{if(boards->currentRow()>=0&&boards->item(boards->currentRow(),0)->data(Qt::UserRole).toJsonObject()["key"]==keep)selectBoard();});}controls();}
void SectorWatchPage::renderMembers(){
 rendering=true;QString keep=selected.value("key").toString(),needle=filter->text().trimmed();bool retained=false;
 for(auto v:current.value("items").toArray()){auto row=v.toObject();if(keep.isEmpty()||row["key"]!=keep)continue;bool same=true;for(auto field:{"id","market","type","code","sourceMarket","provider","taxonomy","boardCode","canOpen"})if(row[field]!=selected[field]){same=false;break;}if(same){selected=row;retained=true;}break;}
 if(!retained){selected={};chart->setSeries({}, {},true);quoteState->setText("请选择成分，未自动加入自选");}
 members->setRowCount(0);for(auto v:sectorWatch::sorted(current.value("items").toArray(),sort->currentData().toString())){auto row=v.toObject();if(!needle.isEmpty()&&!row["name"].toString().contains(needle,Qt::CaseInsensitive)&&!row["id"].toString().contains(needle,Qt::CaseInsensitive)&&!row["code"].toString().contains(needle))continue;int r=members->rowCount();members->insertRow(r);auto item=new QTableWidgetItem(row["name"].toString()+"\n"+(row["id"].isString()?row["id"].toString():row["code"].toString()+" · 身份待核"));item->setData(Qt::UserRole,row);members->setItem(r,0,item);int c=1;for(auto field:{"price","changePct","amount","mainNetInflow"})members->setItem(r,c++,new QTableWidgetItem(value(row[field])));if(retained&&row["key"]==keep)members->selectRow(r);}
 details->setText(board["name"].toString()+" · "+board["key"].toString()+"\n"+summary(current,false));rendering=false;controls();
}
void SectorWatchPage::selectBoard(){if(rendering||boards->currentRow()<0)return;auto item=boards->item(boards->currentRow(),0);if(!item)return;cancel();board=item->data(Qt::UserRole).toJsonObject();if(boardSeries)boardSeries->setBoard(board);selected={};current={};members->setRowCount(0);chart->setSeries({}, {},true);details->setText(board["name"].toString()+" · "+board["key"].toString());quoteState->setText("尚未选择成分");if(provider->currentData()=="ths-public-board"){details->setText(board["name"].toString()+"\n同花顺目录已核对。请点“板块自身 K 线”。本轮未接入成分列表，不使用其他来源代替。");controls();}else loadCache(false);}
void SectorWatchPage::selectMember(){if(rendering||members->currentRow()<0)return;if(pageViews)pageViews->setCurrentWidget(memberView);auto item=members->item(members->currentRow(),0);if(!item)return;selected=item->data(Qt::UserRole).toJsonObject();chart->setSeries({}, {},true);quoteState->setText(selected["name"].toString()+" · "+(selected["canOpen"].toBool()?"临时观察，等待来源行情":"来源身份未确认，不能联动"));controls();if(selected["canOpen"].toBool())emit observeInstrument(instrument(selected));}
void SectorWatchPage::controls(){if(!fetchCatalog)return;fetchCatalog->setText(provider->currentData()=="ths-public-board"?"读取官网可见目录":"获取完整目录");fetchCatalog->setEnabled(allowNetwork&&!busy);fetchMembers->setEnabled(allowNetwork&&!busy&&!board.isEmpty()&&provider->currentData()!="ths-public-board");stopButton->setEnabled(busy);if(openBoardButton)openBoardButton->setEnabled(!busy);openButton->setEnabled(!busy&&selected["canOpen"].toBool());addButton->setEnabled(!busy&&selected["canOpen"].toBool());exportButton->setEnabled(!busy&&(!current.isEmpty()||!catalog.isEmpty()));}
QJsonObject SectorWatchPage::saveState()const{return {{"provider",provider->currentData().toString()},{"taxonomy",taxonomy->currentData().toString()},{"boardKey",board["key"]},{"boardFilter",boardFilter->text().left(160)},{"filter",filter->text().left(160)},{"sort",sort->currentData().toString()}};}
void SectorWatchPage::restoreState(const QJsonObject& s){cancel();QSignalBlocker a(provider),b(taxonomy),c(filter),d(sort),e(boardFilter);int p=provider->findData(s["provider"].toString()),t=taxonomy->findData(s["taxonomy"].toString()),r=sort->findData(s["sort"].toString());if(p>=0)provider->setCurrentIndex(p);if(t>=0)taxonomy->setCurrentIndex(t);if(r>=0)sort->setCurrentIndex(r);filter->setText(s["filter"].toString().left(160));boardFilter->setText(s["boardFilter"].toString().left(160));restoreBoard=s["boardKey"].toString().left(160);catalog={};current={};board={};selected={};boards->setRowCount(0);members->setRowCount(0);chart->setSeries({}, {},true);if(isVisible())loadCache(true);}
void SectorWatchPage::updateInstrument(const QJsonObject& s){
 if(selected.isEmpty()||!selected["canOpen"].toBool()||s["id"]!=selected["id"])return;
 auto* repaint=static_cast<VisibleRefresh*>(findChild<QObject*>("minuteRefresh",Qt::FindDirectChildrenOnly));
 if(!repaint){repaint=new VisibleRefresh(this);repaint->setObjectName("minuteRefresh");repaint->refresh=[this]{updateInstrument(property("pendingMinute").toJsonObject());};}
 const QJsonObject input{{"id",s["id"]},{"quote",s["quote"]},{"minute",s["minute"]},{"minuteMeta",s["minuteMeta"]},{"name",selected["name"]},{"dark",palette().color(QPalette::Window).lightness()<128}};
 if(!repaint->applying()){setProperty("pendingMinute",input);repaint->request();return;}
 if(!isVisible()||window()->isMinimized())return;
 const auto rows=s["minute"].toArray();
 if(property("appliedMinute").toJsonObject()==input&&chart->bars.size()==size_t(rows.size()))return;
 setProperty("appliedMinute",input);
 auto q=s["quote"].toObject(),meta=s["minuteMeta"].toObject();
 QString status=selected["name"].toString()+" "+s["id"].toString()+"\n报价 "+value(q["price"])+" · "+q["source"].toString()+" · "+q["tradeDate"].toString()+" "+q["tradeTime"].toString();
 if(q["cached"].toBool())status+=" · 报价旧缓存";
 if(!q["error"].toString().isEmpty())status+="\n报价错误："+q["error"].toString();
 status+="\n分时 "+meta["source"].toString()+" · 检查 "+meta["checkedAt"].toString();
 if(meta["cached"].toBool())status+=" · 分时旧缓存";
 if(!meta["error"].toString().isEmpty())status+="\n分时错误："+meta["error"].toString();
 quoteState->setText(status);
  chart->dark=palette().color(QPalette::Window).lightness()<128;chart->previousClose=number(meta["previousClose"]);
  const QJsonObject series{{"id",s["id"]},{"rows",rows}};if(chart->property("liveSeriesInput").toJsonObject()==series&&chart->bars.size()==size_t(rows.size())){chart->update();return;}chart->setProperty("liveSeriesInput",series);
  std::vector<market::Bar> bars;QStringList labels;for(auto v:rows){auto row=v.toObject();bars.push_back({number(row["time"]),number(row["open"]),number(row["high"]),number(row["low"]),number(row["close"]),number(row["volume"]),row["valid"].toBool(),row["closed"].toBool()});labels<<row["label"].toString();}chart->setSeries(bars,labels,true,false);
}
void SectorWatchPage::openBoardSeries(){
 if(busy||!isVisible()||window()->isMinimized()||!boardSeries)return;boardSeries->setProvider(provider->currentData().toString());if(boards->currentRow()>=0&&!board.value("code").toString().isEmpty())boardSeries->setBoard(board);pageViews->setCurrentWidget(boardSeries);
}
void SectorWatchPage::refreshBoardDirectory(const QString& kind,const QString& selectedProvider){
 if(!allowNetwork||busy||!isVisible()||(kind!="industry"&&kind!="concept"))return;cancel();QSignalBlocker p(provider),t(taxonomy);provider->setCurrentIndex(provider->findData(selectedProvider));taxonomy->setCurrentIndex(taxonomy->findData(kind));catalog={};current={};board={};selected={};restoreBoard.clear();boards->setRowCount(0);members->setRowCount(0);chart->setSeries({}, {},true);quoteState->setText("更新明确选择的来源与分类；不跨供应商替换");fetch(true);
}
void SectorWatchPage::setHostError(const QString& message){state->setText(message);}
void SectorWatchPage::exportSnapshot(const QString& path){if(busy)return;auto frozen=current.isEmpty()?catalog:current;if(frozen.isEmpty()){state->setText("没有可导出的集合");return;}run([frozen,path](auto cancel){sectorWatch::exportNew(frozen,path,cancel);return QJsonObject{};},[this,path](QJsonObject){state->setText("已导出冻结集合到新文件："+path);});}
void SectorWatchPage::hideEvent(QHideEvent* e){cancel();QWidget::hideEvent(e);}
void SectorWatchPage::showEvent(QShowEvent* e){QWidget::showEvent(e);loadCache(catalog.isEmpty()||board.isEmpty());}
