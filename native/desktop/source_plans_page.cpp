#include "source_plans_page.hpp"
#include "legacy_data.hpp"
#include <QThread>
namespace {
QString stateText(const QString& state) {
  if (state == "running") return "来源读取中";
  if (state == "complete") return "来源完成 · 下游另查";
  if (state == "failed") return "失败 · 计划已暂停";
  if (state == "cancelled") return "已停止";
  if (state == "interrupted") return "上次中断";
  return "未运行";
}
QString timeText(const QJsonValue& value) {
  auto ms = qint64(value.toDouble());
  return ms > 0 ? QDateTime::fromMSecsSinceEpoch(ms).toString("MM-dd HH:mm:ss")
                : "待首次运行";
}
}  // namespace
SourcePlansPage::SourcePlansPage(std::shared_ptr<SourceSchedule> value,
                                 SourcePage* page, QWidget* parent)
    : QWidget(parent), ledger(std::move(value)), source(page) {
  setObjectName("sourcePlansPage");
  auto root = new QVBoxLayout(this);
  auto form = new QGridLayout;
  root->addLayout(form);
  name = new QLineEdit;
  profile = new QLineEdit;
  rights = new QLineEdit;
  name->setObjectName("planName");
  profile->setObjectName("planProfile");
  rights->setObjectName("planRights");
  name->setPlaceholderText("作者名称");
  profile->setPlaceholderText("https://www.douyin.com/user/作者身份");
  rights->setPlaceholderText("有权处理该来源音视频的依据");
  limit = new QSpinBox;
  limit->setRange(1, 50);
  limit->setValue(20);
  limit->setSuffix(" 条/轮");
  interval = new QSpinBox;
  interval->setRange(10, 1440);
  interval->setValue(30);
  interval->setSuffix(" 分钟");
  form->addWidget(new QLabel("作者"), 0, 0);
  form->addWidget(name, 0, 1);
  form->addWidget(new QLabel("主页"), 0, 2);
  form->addWidget(profile, 0, 3, 1, 3);
  form->addWidget(new QLabel("依据"), 1, 0);
  form->addWidget(rights, 1, 1, 1, 3);
  form->addWidget(limit, 1, 4);
  form->addWidget(interval, 1, 5);
  contentType=new QComboBox;
  contentType->setObjectName("planContentType");
  contentType->setAccessibleName("作者采集内容类型");
  contentType->addItem("视频与图文","all");
  contentType->addItem("仅视频","video");
  contentType->addItem("仅图文","note");
  contentType->setToolTip("保存后用于该作者之后的单次及定时采集；不删除已有资料或停止在途任务。");
  form->addWidget(new QLabel("采集内容"),2,0);
  form->addWidget(contentType,2,1);
  auto bar = new QHBoxLayout;
  root->addLayout(bar);
  auto add = new QPushButton("新作者"), save = new QPushButton("保存作者计划"),
       toggle = new QPushButton("启用 / 停用选中"),
       runOne = new QPushButton("运行选中一次"),
       resume = new QPushButton("恢复已启用计划"),
       stop = new QPushButton("暂停计划并停止本轮");
  save->setObjectName("saveSourcePlan");
  add->setObjectName("newSourcePlan");
  toggle->setObjectName("toggleSourcePlan");
  runOne->setObjectName("runSourcePlan");
  resume->setObjectName("resumeSourcePlans");
  stop->setObjectName("pauseSourcePlans");
  for (auto button : {add, save, toggle, runOne, resume, stop})
    bar->addWidget(button);
  state = new QLabel(
      "调度暂停。保存不等于执行；重启后需主动恢复。每轮只读已加载作品，不代表全"
      "历史；下游识别/入库请到任务页查看。");
  state->setObjectName("sourcePlansState");
  state->setWordWrap(true);
  root->addWidget(state);
  split = new QSplitter(Qt::Vertical);
  root->addWidget(split, 1);
  plans = new QTableWidget(0, 7);
  plans->setObjectName("savedSourcePlans");
  plans->setHorizontalHeaderLabels(
      {"作者", "参与调度", "采集内容", "单轮", "间隔", "下一次", "最近来源阶段"});
  plans->setSelectionBehavior(QAbstractItemView::SelectRows);
  plans->setSelectionMode(QAbstractItemView::SingleSelection);
  plans->setEditTriggers(QAbstractItemView::NoEditTriggers);
  plans->horizontalHeader()->setSectionResizeMode(0, QHeaderView::Stretch);
  plans->horizontalHeader()->setSectionResizeMode(6, QHeaderView::Stretch);
  split->addWidget(plans);
  auto lower = new QWidget;
  auto lowerLayout = new QVBoxLayout(lower);
  auto historyBar=new QHBoxLayout;lowerLayout->addLayout(historyBar);
  historyKind=new QComboBox;historyKind->setObjectName("sourceHistoryKind");historyKind->addItems({"本机原生轮次","旧程序历史档案"});historyBar->addWidget(historyKind);
  auto prev=new QPushButton("上一页"),next=new QPushButton("下一页"),reload=new QPushButton("刷新历史"),import=new QPushButton("读取旧历史文件"),confirm=new QPushButton("确认导入历史"),exportAll=new QPushButton("导出此类全部历史");
  prev->setObjectName("previousSourceHistory");next->setObjectName("nextSourceHistory");reload->setObjectName("reloadSourceHistory");confirm->setObjectName("confirmSourceHistory");
  for(auto b:{prev,next,reload,import,confirm,exportAll})historyBar->addWidget(b);
  historySummary=new QLabel;historySummary->setObjectName("sourceHistorySummary");historySummary->setWordWrap(true);lowerLayout->addWidget(historySummary);
  history = new QTableWidget(0, 7);
  history->setObjectName("sourcePlanHistory");
  history->setHorizontalHeaderLabels(
      {"开始", "作者", "来源阶段", "已加载", "已处理", "已排队", "说明"});
  history->setEditTriggers(QAbstractItemView::NoEditTriggers);
  history->horizontalHeader()->setSectionResizeMode(6, QHeaderView::Stretch);
  history->setColumnWidth(0,200);history->setColumnWidth(1,180);history->setColumnWidth(2,130);
  lowerLayout->addWidget(history,3);
  history->setSelectionBehavior(QAbstractItemView::SelectRows);
  historyDetail=new QTextBrowser;historyDetail->setObjectName("sourceHistoryDetail");historyDetail->setOpenLinks(false);lowerLayout->addWidget(historyDetail,2);
  connect(historyKind,&QComboBox::currentIndexChanged,this,[this]{historyAnchor=-1;historyOffset=0;split->setSizes(historyKind->currentIndex()==1?QList<int>{0,1000}:QList<int>{350,650});try{refreshHistory();}catch(const std::exception&e){state->setText(e.what());}});
  connect(reload,&QPushButton::clicked,this,[this]{historyAnchor=-1;historyOffset=0;try{refreshHistory();}catch(const std::exception&e){state->setText(e.what());}});
  connect(prev,&QPushButton::clicked,this,[this]{historyOffset=std::max(0,historyOffset-50);try{refreshHistory();}catch(const std::exception&e){state->setText(e.what());}});
  connect(next,&QPushButton::clicked,this,[this]{try{if(historyOffset+50<ledger->historyCount(historyKind->currentIndex()==1,historyAnchor))historyOffset+=50;refreshHistory();}catch(const std::exception&e){state->setText(e.what());}});
  connect(import,&QPushButton::clicked,this,[this]{auto path=QFileDialog::getOpenFileName(this,"只读选择旧库或历史档案",{},"旧库/档案 (*.db *.sqlite *.json)");if(path.isEmpty())return;try{previewHistoryFile(path);}catch(const std::exception&e){state->setText(e.what());}});
  connect(confirm,&QPushButton::clicked,this,[this]{try{
    business::require(!pendingHistory.isEmpty(),"请先读取旧历史文件");auto data=pendingHistory;auto db=ledger;
    historyWork([db,data]{return QJsonObject{{"added",db->importHistory(data)}};},[this](QJsonObject result){
      pendingHistory={};historyKind->setCurrentIndex(1);historyAnchor=-1;historyOffset=0;refreshHistory();
      state->setText(QString("已新增%1轮只读档案；未启动任务、未覆盖原稿").arg(result["added"].toInt()));
    });
  }catch(const std::exception&e){state->setText(e.what());}});
  connect(exportAll,&QPushButton::clicked,this,[this]{auto path=QFileDialog::getSaveFileName(this,"导出刷新时刻的此类全部历史","来源历史.json","JSON (*.json)");if(path.isEmpty())return;try{exportHistoryFile(path);}catch(const std::exception&e){state->setText(e.what());}});
  connect(history,&QTableWidget::currentCellChanged,this,[this](int r,int,int,int){showHistoryDetail(r);});
  connect(historyDetail,&QTextBrowser::anchorClicked,this,[this](const QUrl& link){if(link.scheme()!="manuscript")return;bool ok=false;int i=link.path().toInt(&ok);if(!ok||i<0||i>=displayedHistoryItems.size())return;auto item=displayedHistoryItems[i].toObject();emit openHistoryManuscript(item["contentId"].toString(),item["sourceUrl"].toString());});
  connect(historyDetail,&QTextBrowser::anchorClicked,this,[this](const QUrl& link){
    if(link.scheme()!="run-collection")return;
    bool ok=false;int i=link.path().toInt(&ok);
    if(!ok||i<0||i>=displayedHistoryItems.size())return;
    auto item=displayedHistoryItems[i].toObject();
    if(item["canOpen"].toBool())emit openRunCollection(item["collectionId"].toString(),item["executionRevision"].toString());
  });
  connect(historyDetail, &QTextBrowser::anchorClicked, this, [this](const QUrl& link) {
    if (link.scheme() != "run-research" && link.scheme() != "research-text") return;
    try {
      bool ok = false; int i = link.path().toInt(&ok);
      business::require(ok && i >= 0 && i < displayedHistoryItems.size() && bool(source), "本轮资料绑定已失效，请刷新");
      auto doc = source->researchRecord(displayedHistoryItems[i].toObject());
      if (link.scheme() == "run-research") emit openRunResearch(doc);
      else historyDetail->setHtml("<h3>" + doc["title"].toString().toHtmlEscaped() + "</h3><p>本轮精确研究资料 · 当前校对稿 · "
          + (doc["verification"].toString() == "manuallyVerified" ? QString("人工已核验") : QString("待人工核验"))
          + "</p><p>" + doc["id"].toString().toHtmlEscaped() + "</p><pre>"
          + doc["text"].toString().toHtmlEscaped() + "</pre><p>点刷新历史返回本轮回执；未启动任务。</p>");
    } catch (const std::exception& e) { state->setText(QString::fromUtf8(e.what())); }
  });
  split->addWidget(lower);
  split->setSizes({350, 400});
  connect(plans, &QTableWidget::itemSelectionChanged, this,
          &SourcePlansPage::loadSelection);
  connect(add, &QPushButton::clicked, this, [this] {
    selected.clear();
    plans->clearSelection();
    name->clear();
    profile->clear();
    rights->clear();
    contentType->setCurrentIndex(0);
  });
  connect(save, &QPushButton::clicked, this, [this] {
    try {
      auto saved = ledger->save({{"name", name->text()},
                                 {"profileUrl", profile->text()},
                                 {"rightsBasis", rights->text()},
                                 {"contentType", contentType->currentData().toString()},
                                 {"limit", limit->value()},
                                 {"intervalMinutes", interval->value()}});
      selected = saved["id"].toString();
      refresh();
      state->setText(
          "计划已保存；新计划默认停用，启用后还需恢复调度。修改主页地址会另存该"
          "作者，不改写旧运行记录。");
    } catch (const std::exception& e) {
      report(e);
    }
  });
  connect(toggle, &QPushButton::clicked, this, [this] {
    try {
      business::require(!selected.isEmpty(), "请先选中计划");
      for (auto value : ledger->plans()) {
        auto p = value.toObject();
        if (p["id"].toString() != selected) continue;
        bool on = !p["enabled"].toBool();
        // Stopping execution must not depend on being able to write the ledger.
        if (!on && source) {
          if (activePlan == selected)
            source->stopPlan(activeRun);
          else if (activeRun.isEmpty() && lastPlan == selected)
            source->stopPlan(lastRun);
        }
        ledger->enable(selected, on);
        refresh();
        state->setText(on ? "已启用选中作者；当前全局调度状态未改变"
                          : "已停用选中作者，历史记录保留");
        break;
      }
    } catch (const std::exception& e) {
      report(e);
    }
  });
  connect(runOne, &QPushButton::clicked, this, [this] {
    try {
      business::require(!selected.isEmpty(), "请先选中计划");
      for (auto value : ledger->plans())
        if (value.toObject()["id"].toString() == selected) {
          run(value.toObject(), true);
          break;
        }
    } catch (const std::exception& e) {
      report(e);
    }
  });
  connect(resume, &QPushButton::clicked, this, [this] {
    enabled = true;
    if (source) source->setPlanScheduling(true);
    timer.start(5000);
    state->setText(
        "已恢复启用的作者计划；到期串行执行，失败会暂停，不补跑错过的每个周期");
    tick();
  });
  connect(stop, &QPushButton::clicked, this, [this] { pause(true); });
  connect(&timer, &QTimer::timeout, this, &SourcePlansPage::tick);
  connect(source, &SourcePage::planFinished, this, &SourcePlansPage::ended);
  connect(source, &SourcePage::sourceStopped, this, [this] { pause(false); });
  connect(source, &SourcePage::manualModeRequested, this,
          [this] { pause(false); });
  refresh();
}
SourcePlansPage::~SourcePlansPage() {
  if(historyWorker)historyWorker->requestInterruption();
  timer.stop();
  if (source) {
    source->setPlanScheduling(false);
    source->stopPlan(activeRun);
  }
}
void SourcePlansPage::report(const std::exception& e) {
  enabled = false;
  timer.stop();
  if (source) {
    source->setPlanScheduling(false);
    source->stopPlan(activeRun);
  }
  state->setText(QString::fromUtf8(e.what()) +
                 "；调度已暂停，已请求停止本轮；已有资料保留，运行记录需核对");
}
void SourcePlansPage::pause(bool stopCurrent) {
  enabled = false;
  timer.stop();
  if (source) {
    source->setPlanScheduling(false);
    if (stopCurrent)
      source->stopPlan(activeRun.isEmpty() ? lastRun : activeRun);
  }
  state->setText(activeRun.isEmpty()
                     ? "调度已暂停；不自动重启，既有下游任务状态请到任务页查看"
                     : "调度已暂停；本轮来源运行/结果待处理");
}
void SourcePlansPage::run(const QJsonObject& plan, bool manual) {
  business::require(source && !source->busy() && activeRun.isEmpty(),
                    "来源正在使用，请等待或停止本轮");
  auto run = ledger->begin(plan["id"].toString(),
                           QDateTime::currentMSecsSinceEpoch(), manual);
  activeRun = run["id"].toString();
  activePlan = plan["id"].toString();
  lastRun = activeRun;
  lastPlan = activePlan;
  if(historyKind->currentIndex()==0&&historyOffset==0)historyAnchor=-1;
  refresh();
  state->setText("正在读取 " + plan["name"].toString() +
                 "，身份核验后才入下载/转写队列");
  try {
    source->runPlan(run["plan"].toObject(), activeRun,
                    [db=ledger](const QString& ticket, const QJsonObject& item) {
                      db->recordItem(ticket, item);
                    });
  } catch (const std::exception& e) {
    ended(activeRun, "failed", {}, QString::fromUtf8(e.what()));
  }
}
void SourcePlansPage::tick() {
  if (historyBusy || !enabled || !activeRun.isEmpty() || !source || source->busy()) return;
  try {
    auto next = ledger->due(QDateTime::currentMSecsSinceEpoch());
    if (!next.isEmpty()) run(next, false);
  } catch (const std::exception& e) {
    report(e);
  }
}
void SourcePlansPage::ended(QString ticket, QString result, QJsonObject counts,
                            QString message) {
  if (ticket != activeRun || ticket.isEmpty()) return;
  try {
    business::require(
        ledger->finish(ticket, result, QDateTime::currentMSecsSinceEpoch(),
                       counts, message),
        "运行记录已改变，结果未覆盖");
    activeRun.clear();
    activePlan.clear();
    if (result != "complete") {
      enabled = false;
      timer.stop();
      if (source) source->setPlanScheduling(false);
    }
    refresh();
    state->setText(stateText(result) + "：" + message);
  } catch (const std::exception& e) {
    report(e);
  }
}
void SourcePlansPage::loadSelection() {
  int row = plans->currentRow();
  if (row < 0 || !plans->item(row, 0)) return;
  selected = plans->item(row, 0)->data(Qt::UserRole).toString();
  try {
    for (auto value : ledger->plans()) {
      auto p = value.toObject();
      if (p["id"].toString() != selected) continue;
      name->setText(p["name"].toString());
      profile->setText(p["profileUrl"].toString());
      rights->setText(p["rightsBasis"].toString());
      limit->setValue(p["limit"].toInt());
      interval->setValue(p["intervalMinutes"].toInt());
      contentType->setCurrentIndex(contentType->findData(sourceCapture::contentType(p.value("contentType"))));
      break;
    }
  } catch (const std::exception& e) {
    report(e);
  }
}
void SourcePlansPage::refresh() {
  auto all = ledger->plans();
  QSignalBlocker blocker(plans);
  plans->setRowCount(all.size());
  for (int row = 0; row < all.size(); ++row) {
    auto p = all[row].toObject();
    QStringList cells{p["name"].toString(),
                      p["enabled"].toBool() ? "已启用" : "停用",
                      sourceCapture::contentTypeName(p.value("contentType")),
                      QString::number(p["limit"].toInt()),
                      QString::number(p["intervalMinutes"].toInt()) + "分钟",
                      timeText(p["nextAt"]),
                      stateText(p["lastState"].toString())};
    for (int col = 0; col < cells.size(); ++col)
      plans->setItem(row, col, new QTableWidgetItem(cells[col]));
    plans->item(row, 0)->setData(Qt::UserRole, p["id"].toString());
    if (p["id"].toString() == selected) plans->selectRow(row);
  }
  refreshHistory();
}
void SourcePlansPage::refreshHistory() {
  bool legacy=historyKind->currentIndex()==1;
  if(historyAnchor<0)historyAnchor=ledger->historyAnchor(legacy);
  auto runs=ledger->historyPage(legacy,historyAnchor,historyOffset);historyRows=runs;
  int total=ledger->historyCount(legacy,historyAnchor);
  historySummary->setText(QString("第%1–%2 / 共%3轮 · 每页50 · 新记录点刷新 · ").arg(total?historyOffset+1:0).arg(historyOffset+runs.size()).arg(total)+(legacy?"旧completed只是轮次结束；原转写状态见明细，不代表入库成功":"排队不是下载/转写/入库成功，以下为来源阶段计数"));
  QSignalBlocker blocker(history);historyDetail->clear();displayedHistoryItems={};history->setCurrentCell(-1,-1);history->setRowCount(runs.size());
  for (int row = 0; row < runs.size(); ++row) {
    auto r = runs[row].toObject(), c = r["counts"].toObject();
    auto count=[&](QString key){return c.contains(key)&&!c[key].isNull()?QString::number(c[key].toDouble(),'g',12):QString("—");};
    QStringList cells{legacy?r["startedAt"].toString():timeText(r["startedAt"]),
                      legacy?r["author"].toString():r["plan"].toObject()["name"].toString(),
                      legacy?r["status"].toString():stateText(r["state"].toString()),
                      legacy ? count("discovered_count") : QString("本页%1 / 续办%2").arg(count("discovered")).arg(c.value("resumed").toInt()),
                      count(legacy?"detailed_count":"processed"),
                      legacy?QString("—"):count("queued"),
                      r["message"].toString()};
    for (int col = 0; col < cells.size(); ++col)
      history->setItem(row, col, new QTableWidgetItem(cells[col]));
  }
  if(!runs.isEmpty()){history->setCurrentCell(0,0);showHistoryDetail(0);}
}
void SourcePlansPage::previewHistoryFile(const QString& path) {
  business::require(!historyBusy,"正在处理历史文件，请稍候");pendingHistory={};
  historyWork([path]{QJsonObject file;
  if(QFileInfo(path).suffix().toLower()=="json") {QFile f(path);business::require(f.open(QIODevice::ReadOnly)&&f.size()<=32*1024*1024,"历史文件不可读或超过32MiB");QJsonParseError error;auto json=QJsonDocument::fromJson(f.readAll(),&error);business::require(error.error==QJsonParseError::NoError&&json.isObject(),"历史JSON损坏");file=json.object();}
  else file=legacydata::readSourceHistory(path);
  return sourceHistory::bundle(sourceHistory::validate(file));},[this](QJsonObject result){pendingHistory=result;
  state->setText(QString("已预览%1轮旧历史，点击确认导入才保存；重复保留、冲突拒绝，不带执行许可").arg(pendingHistory["runs"].toArray().size()));
  });
}
void SourcePlansPage::exportHistoryFile(const QString& path) {
  sourceHistory::requireNewJson(path);auto db=ledger;bool legacy=historyKind->currentIndex()==1;auto anchor=historyAnchor;
  historyWork([db,legacy,anchor,path]{sourceHistory::saveNewJson(path,db->exportHistory(legacy,anchor));return QJsonObject{};},[this](QJsonObject){state->setText("已导出当前刷新快照的此类全部轮次，不只是本页；文件不含媒体、模型或执行许可");});
}
void SourcePlansPage::historyWork(std::function<QJsonObject()> work,std::function<void(QJsonObject)> done) {
  business::require(!historyBusy,"正在处理历史文件，请稍候");historyBusy=true;state->setText("正在处理历史文件；可继续切换子页");
  struct Result {QJsonObject value;QString error;};auto result=std::make_shared<Result>();
  auto thread=QThread::create([work,result]{try{result->value=work();}catch(const std::exception&e){result->error=QString::fromUtf8(e.what());}});
  historyWorker=thread;
  connect(thread,&QThread::finished,this,[this,result,done]{historyBusy=false;historyWorker=nullptr;
    if(!result->error.isEmpty()){state->setText("历史文件处理失败："+result->error);return;}
    try{done(result->value);}catch(const std::exception&e){state->setText(e.what());}
  });
  connect(thread,&QThread::finished,thread,&QObject::deleteLater);thread->start();
}
void SourcePlansPage::showHistoryDetail(int row) {
  displayedHistoryItems={};if(row<0||row>=historyRows.size()){historyDetail->clear();return;}auto r=historyRows[row].toObject();
  QString text="<h3>"+r["id"].toString().toHtmlEscaped()+"</h3><p>"+r["message"].toString().toHtmlEscaped()+"</p>";
  auto counts=r["counts"].toObject();
  if(historyKind->currentIndex()==1){
    const QStringList names={"作品总量","发现","候选","详情完成","详情失败","尝试转写","转写完成","缺媒体","转写失败","新增","更新","未变化"};text+="<table cellspacing='8'>";
    for(int i=0;i<sourceHistory::countKeys.size();++i){auto value=counts[sourceHistory::countKeys[i]];if(i%4==0)text+="<tr>";text+="<td>"+names[i]+"：<b>"+(value.isUndefined()||value.isNull()?QString("—"):QString::number(value.toDouble(),'g',12))+"</b></td>";if(i%4==3)text+="</tr>";}text+="</table>";
  }else{const QMap<QString,QString> labels{{"discovered","本页发现"},{"resumed","本机续办"},{"processed","详情处理"},{"queued","本轮入队"}};
    for(auto key:counts.keys())text+=labels.value(key,key).toHtmlEscaped()+"："+QString::number(counts[key].toDouble(),'g',12)+"　";}
  if(historyKind->currentIndex()==1) {text+="<p>旧轮次原状态："+r["status"].toString().toHtmlEscaped()+"；错误："+r["error"].toString().toHtmlEscaped()+"</p>";auto items=r["items"].toArray();
    displayedHistoryItems=items;for(int i=0;i<items.size();++i){auto v=items[i].toObject();text+="<p>"+v["title"].toString().toHtmlEscaped()+" · "+v["contentId"].toString().toHtmlEscaped()+"<br>详情："+v["detail_status"].toString().toHtmlEscaped()+" / 转写："+v["transcription_status"].toString().toHtmlEscaped()+"<br>"+v["message"].toString().toHtmlEscaped()+QString(" <a href='manuscript:%1'>查看本机对应文稿</a></p>").arg(i);}
    if(items.isEmpty())text+="<p>旧库此轮没有明细，不推断为零失败或全部成功。</p>";
  }else {
    text+="<h4>本轮逐任务回执 / 当前下游状态</h4><p>来源计数是结束时快照；下面按精确任务修订读取。后续手工重试不算成本轮成功。点刷新更新。</p>";
    try {
      auto items=r["items"].toArray();
      if(items.isEmpty())text+="<p>此轮没有持久明细（旧原生轮次或尚未处理）；不推断为全部成功。</p>";
      else {
        business::require(bool(source),"来源页面已关闭，无法读取本机任务");
        displayedHistoryItems=source->taskReadout(items);
        for(int i=0;i<displayedHistoryItems.size();++i){auto item=displayedHistoryItems[i].toObject();
          text+="<p><b>"+item["title"].toString().toHtmlEscaped()+"</b> · "+item["contentId"].toString().toHtmlEscaped()+"<br>本次："+item["receiptState"].toString("未关联").toHtmlEscaped()+"<br>当前任务："+item["currentState"].toString().toHtmlEscaped()+"<br>"+item["receiptMessage"].toString().toHtmlEscaped()+" "+item["currentMessage"].toString().toHtmlEscaped();
          if(item["canOpen"].toBool())text+=QString(" <a href='run-collection:%1'>打开本轮精确文稿</a>").arg(i);
          if(!item["researchId"].toString().isEmpty())text+="<br>研究资料ID："+item["researchId"].toString().toHtmlEscaped();
          if(item["canOpenResearch"].toBool()) text+=QString(" <a href='research-text:%1'>查看本轮研究原文</a> <a href='run-research:%1'>打开本轮研究条目</a>").arg(i);
          text+="</p>";
        }
      }
    }catch(const std::exception&e){text+="<p>下游状态读取失败："+QString::fromUtf8(e.what()).toHtmlEscaped()+"</p>";}
  }historyDetail->setHtml(text);
}
