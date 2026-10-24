#include "rotation_page.hpp"
#include "trading_day_selection.hpp"
#include "rotation_sampling_session.hpp"
#include <QFileInfo>
#include <QDir>
#include <QGuiApplication>
#include "dark_rotation.hpp"
#include "detail_disclosure.hpp"
#include "rotation_curve.hpp"
#include <QLineEdit>
#include <QComboBox>
#include <QDateEdit>
#include <QFileDialog>
#include <QFile>
#include <QHeaderView>
#include <QLabel>
#include <QNetworkReply>
#include <QPushButton>
#include <QSaveFile>
#include <QSignalBlocker>
#include <QSlider>
#include <QSplitter>
#include <QTableWidget>
#include "financial_delegate.hpp"
#include <QTimeZone>
#include <QTimer>
#include <QVBoxLayout>
#include <QSet>
#include <QCoreApplication>
#include <QHideEvent>
#include <memory>

namespace {
QString local(const QString& at){auto d=QDateTime::fromString(at,Qt::ISODateWithMs);return d.isValid()?d.toTimeZone(QTimeZone::fromSecondsAheadOfUtc(28800)).toString("yyyy-MM-dd HH:mm:ss.zzz"):"时刻未知";}
void require(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
template<class F> void deliver(QPointer<RotationPage> page,F callback){QMetaObject::invokeMethod(QCoreApplication::instance(),[page,callback]{if(page)callback(page.data());},Qt::QueuedConnection);}
QTableWidget* grid(QStringList headers,QWidget* parent){auto* t=new QTableWidget(0,headers.size(),parent);t->setHorizontalHeaderLabels(headers);t->verticalHeader()->hide();t->setEditTriggers(QAbstractItemView::NoEditTriggers);t->setSelectionBehavior(QAbstractItemView::SelectRows);t->setSelectionMode(QAbstractItemView::SingleSelection);t->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch);return t;}
}
RotationPage::RotationPage(QString path,bool enabled,QWidget* parent,RotationSamplingHooks injected,QString evidence):QWidget(parent),file(std::move(path)),evidenceDirectory(evidence.isEmpty()?QFileInfo(file).absolutePath()+"/paper-session-2026-july-v1":evidence),allowNetwork(enabled),hooks(std::move(injected)){
  elapsed.start();
  connect(qApp,&QGuiApplication::applicationStateChanged,this,[this](Qt::ApplicationState state){if(state!=Qt::ApplicationActive&&(sampling||scanBusy)){stop();samplingState->setText("应用已离开前台；已提交档案保留，请手动重新开始");}});
  setObjectName("rotationPage");auto* root=new QVBoxLayout(this);auto* tools=new QHBoxLayout;root->addLayout(tools);
  scope=new QComboBox;scope->setObjectName("rotationScope");scope->addItem("行业","industry");scope->addItem("概念","concept");tools->addWidget(scope);
  date=new QDateEdit(QDate::currentDate());date->setDisplayFormat("yyyy-MM-dd");date->setCalendarPopup(true);date->setObjectName("rotationDate");tools->addWidget(date);
  kind=new QComboBox;kind->setObjectName("rotationKind");kind->addItems({"盘中采样回放","每日资金榜"});kind->setCurrentIndex(1);tools->addWidget(kind);
  auto button=[&](QString text,QString name){auto* b=new QPushButton(text);b->setObjectName(name);tools->addWidget(b);return b;};
  refresh=button("刷新所选日期","rotationRefresh");refresh->setEnabled(allowNetwork);cancel=button("取消任务","rotationCancel");cancel->setEnabled(false);
  auto* previousDay=button("前一日","rotationPreviousDay");connect(previousDay,&QPushButton::clicked,this,[this]{date->setDate(date->date().addDays(-1));kind->setCurrentIndex(1);});auto* imports=button("导入旧轮动档案","rotationImport");auto* exports=button("导出当前档案","rotationExport");tools->addStretch();
  state=new QLabel;state->setWordWrap(true);state->setObjectName("rotationState");root->addWidget(state);
  auto* samplingTools=new QHBoxLayout;root->addLayout(samplingTools);
  samplingStart=new QPushButton("开始60秒采样");samplingStart->setObjectName("rotationSamplingStart");samplingTools->addWidget(samplingStart);samplingStart->setEnabled(allowNetwork||bool(hooks.page));
  samplingStop=new QPushButton("停止采样");samplingStop->setObjectName("rotationSamplingStop");samplingTools->addWidget(samplingStop);samplingStop->setEnabled(false);
  samplingState=new QLabel("自动采样未开启");samplingState->setObjectName("rotationSamplingState");samplingState->setWordWrap(true);samplingTools->addWidget(samplingState,1);
  samplingTimer=new QTimer(this);samplingTimer->setInterval(1000);connect(samplingTimer,&QTimer::timeout,this,&RotationPage::sampleDue);
  connect(samplingStart,&QPushButton::clicked,this,&RotationPage::startSampling);connect(samplingStop,&QPushButton::clicked,this,[this]{stop();});
  auto* notes=new QLabel("东方财富明/暗盘模型估算 · 单位万元；不是交易所逐笔流入或机构持仓。源时钟未知，板块可能重叠，不合计全市场。接口非文档化，许可未核验。");notes->setWordWrap(true);addDataDetails(root,notes,"rotationDataDetails");
  auto* replay=new QHBoxLayout;root->addLayout(replay);replay->addWidget(new QLabel("采样时点"));cursor=new QSlider(Qt::Horizontal);cursor->setObjectName("rotationCursor");replay->addWidget(cursor,1);
  metric=new QComboBox;metric->addItem("合计净额","combinedNetCents");metric->addItem("暗盘净额","darkNetCents");metric->addItem("明盘净额","visibleNetCents");metric->setObjectName("rotationMetric");replay->addWidget(metric);
  minutes=new QComboBox;for(int n:{5,15,30})minutes->addItem(QString::number(n)+"交易分钟",n);minutes->setObjectName("rotationMinutes");replay->addWidget(minutes);
  rank=new QComboBox;rank->setObjectName("rotationRank");rank->addItems({"全部板块","净额增加","净额减少","速度提升","速度下降"});replay->addWidget(rank);
  search=new QLineEdit;search->setObjectName("rotationSearch");search->setPlaceholderText("名称 / 板块代码");search->setMaximumWidth(180);replay->addWidget(search);
  auto* split=new QSplitter;root->addWidget(split,1);table=grid({"板块 / 代码","暗盘净额","明盘净额","合计净额","涨跌幅","区间变化","速度 万/分","速度变化 万/分","状态"},split);table->setObjectName("rotationTable");financialVisual::install(table,{1,2,3,5});financialVisual::install(table,{4,6,7},false);
  auto* side=new QWidget(split);auto* sl=new QVBoxLayout(side);detail=new QLabel("选择板块查看实际采样和窗口变化");detail->setObjectName("rotationDetail");detail->setWordWrap(true);sl->addWidget(detail);curve=new RotationCurve(side);sl->addWidget(curve,2);history=grid({"抓取时刻（同日）","暗盘","明盘","合计"},side);history->setObjectName("rotationHistory");financialVisual::install(history,{1,2,3});sl->addWidget(history,1);split->setSizes({820,560});table->horizontalHeader()->setMinimumSectionSize(85);table->horizontalHeader()->setSectionResizeMode(0,QHeaderView::Interactive);table->setColumnWidth(0,155);
  connect(scope,&QComboBox::currentIndexChanged,this,[this]{stop();load();});connect(kind,&QComboBox::currentIndexChanged,this,[this]{stop();load();});connect(date,&QDateEdit::dateChanged,this,[this]{stop();load();});
  connect(cursor,&QSlider::valueChanged,this,&RotationPage::render);connect(table,&QTableWidget::itemSelectionChanged,this,&RotationPage::selected);connect(metric,&QComboBox::currentIndexChanged,this,&RotationPage::render);connect(minutes,&QComboBox::currentIndexChanged,this,&RotationPage::render);connect(rank,&QComboBox::currentIndexChanged,this,&RotationPage::draw);connect(search,&QLineEdit::textChanged,this,&RotationPage::draw);
  connect(refresh,&QPushButton::clicked,this,&RotationPage::refreshSource);connect(cancel,&QPushButton::clicked,this,[this]{stop();state->setText("已请求取消；未提交的导入回滚，已保存档案保留");});
  connect(imports,&QPushButton::clicked,this,[this]{if(!isVisible()||window()->isMinimized()||!foreground()||sampling||scanBusy||savePending)return;auto p=QFileDialog::getOpenFileName(this,"只读导入旧轮动文件",{},"轮动档案 (*.jsonl *.json)");if(!p.isEmpty())importArchive(p);});
  connect(exports,&QPushButton::clicked,this,[this]{if(!isVisible()||window()->isMinimized()||!foreground()||sampling||scanBusy||savePending)return;auto p=QFileDialog::getSaveFileName(this,"导出当前范围所有采样","轮动档案.jsonl","JSONL (*.jsonl)");if(!p.isEmpty())exportArchive(p);});
  discoverDate();
}
RotationPage::~RotationPage(){stop();}
bool RotationPage::foreground()const{return hooks.foreground?hooks.foreground():QGuiApplication::applicationState()==Qt::ApplicationActive;}
bool RotationPage::sessionAllowed(const QString& start,const QString& end)const{return rotationSampling::session(evidenceDirectory,start,end).value("allowed").toBool();}
QDateTime RotationPage::now() const{return hooks.now?hooks.now():QDateTime::currentDateTimeUtc();}
qint64 RotationPage::monotonic() const{return hooks.elapsed?hooks.elapsed():elapsed.elapsed();}
void RotationPage::hideEvent(QHideEvent* event){stop();QWidget::hideEvent(event);}
void RotationPage::startSampling(){
  if((!allowNetwork&&!hooks.page)||sampling||scanBusy||savePending)return;
  stop();auto at=now().toUTC();auto day=at.toOffsetFromUtc(28800).date().toString(Qt::ISODate),stamp=at.toString(Qt::ISODateWithMs);
  if(!foreground()||!isVisible()||window()->isMinimized()||!sessionAllowed(stamp,stamp)){samplingState->setText("已停止：仅前台可见页且官方证据覆盖的连续时段可采样；缺失证据、午休/休市不补跑");return;}
  {QSignalBlocker d(date),k(kind);date->setDate(QDate::fromString(day,Qt::ISODate));kind->setCurrentIndex(0);}
  sampling=true;samplingStart->setEnabled(false);samplingStop->setEnabled(true);samplingTimer->start();load();sampleDue();
}
void RotationPage::sampleDue(){
  if(!sampling)return;auto at=now().toUTC();auto day=at.toOffsetFromUtc(28800).date().toString(Qt::ISODate),stamp=at.toString(Qt::ISODateWithMs);
  if(!foreground()||!isVisible()||window()->isMinimized()||day!=date->date().toString(Qt::ISODate)||!sessionAllowed(stamp,stamp)){stop();samplingState->setText("已停止：离页、交易日变化或进入午休/休市；不补跑，请在有效时段重新开始");return;}
  if(scanBusy){if(monotonic()-roundMonotonic>40000||!sessionAllowed(roundStart,stamp))fail("本轮超时或跨交易时段；取消未完成部分，已提交记录保留");return;}
  auto wait=nextDue-monotonic();for(auto s:QStringList{"industry","concept"})if(attempts.contains(day+":"+s))wait=std::max(wait,60000-(at.toMSecsSinceEpoch()-attempts[day+":"+s]));
  if(wait>0){samplingState->setText(QString("采样已开启 · %1秒后检查下一轮 · 最近尝试 %2 · 源时钟未知").arg((wait+999)/1000).arg(local(roundStart)));return;}
  ++generation;cancelled->store(true);cancelled=std::make_shared<std::atomic_bool>(false);
  scanBusy=true;roundSnapshots={};roundStart=stamp;roundMonotonic=monotonic();nextDue=roundMonotonic+60000;
  for(auto s:QStringList{"industry","concept"})attempts[day+":"+s]=at.toMSecsSinceEpoch();
  scanDate=day;scanScope="industry";scanDaily=false;scanStart=stamp;scanPage=0;scanTotal=0;scanRows={};scanBase={};
  cancel->setEnabled(true);refresh->setEnabled(false);samplingState->setText("尝试 "+local(roundStart)+" · 行业 → 概念；整轮归档 · 源时钟未知");
  const auto token=generation;QTimer::singleShot(40000,this,[this,token]{if(token==generation&&scanBusy)fail("本轮超过40秒；取消未完成部分，已提交记录保留");});nextPage(token);
}
void RotationPage::discoverDate(){
  auto token=++generation;auto path=file;QPointer<RotationPage> weak(this);state->setText("读取本机日期…");
  QThreadPool::globalInstance()->start([weak,token,path]{QStringList days;bool daily=true;QString error;try{darkRotation::Store store(path);days=store.dates();if(!days.isEmpty())daily=!store.read(days.first(),"industry",true).isEmpty();}catch(const std::exception& e){error=QString::fromUtf8(e.what());}deliver(weak,[token,days,daily,error](RotationPage* p){if(token!=p->generation)return;if(!error.isEmpty()){p->fail(error);return;}if(!days.isEmpty()){QSignalBlocker b(p->date),k(p->kind);p->date->setDate(QDate::fromString(days.first(),Qt::ISODate));p->kind->setCurrentIndex(daily?1:0);}p->load();});});
}
void RotationPage::fail(const QString& message){bool running=sampling;auto start=roundStart;int completed=roundSnapshots.size();stop();if(running)samplingState->setText("已停止："+message+"；尝试 "+local(start)+QString(" · 已读%1/2范围；本轮未提交，旧档案保留").arg(completed));state->setText("未更新，保留原档案："+message);}
void RotationPage::stop(){++generation;++analysisGeneration;analysisCancelled->store(true);cancelled->store(true);cancelled=std::make_shared<std::atomic_bool>(false);sampling=false;samplingTimer->stop();roundSnapshots={};if(reply){reply->abort();reply=nullptr;}if(!savePending)scanBusy=false;samplingStart->setEnabled((allowNetwork||bool(hooks.page))&&!savePending);samplingStop->setEnabled(false);samplingState->setText("采样已停止");cancel->setEnabled(false);refresh->setEnabled(allowNetwork&&!savePending);}
void RotationPage::load(){
  auto token=++generation;auto d=tradingDaySelection::effective(date->date()).toString(Qt::ISODate),s=scope->currentData().toString();bool daily=kind->currentIndex()==1;
  snapshots={};render();state->setText("读取本机档案…");auto path=file;
  QPointer<RotationPage> weak(this);QThreadPool::globalInstance()->start([weak,token,path,d,s,daily]{QJsonArray data;QString error;try{data=darkRotation::Store(path).read(d,s,daily);}catch(const std::exception& e){error=QString::fromUtf8(e.what());}
    deliver(weak,[token,data,error](RotationPage* p){if(token!=p->generation)return;if(!error.isEmpty()){p->fail(error);return;}p->snapshots=data;QSignalBlocker b(p->cursor);p->cursor->setRange(0,std::max(0,int(data.size())-1));p->cursor->setValue(p->cursor->maximum());p->render();});
  });
}
void RotationPage::render(){
  ++analysisGeneration;analysisCancelled->store(true);analysisCancelled=std::make_shared<std::atomic_bool>(false);analysis={};draw();
  if(snapshots.isEmpty()){state->setText("所选日期暂无榜单，请刷新或选择已发布日期。");return;}
  QJsonArray data;for(int i=0;i<=cursor->value()&&i<snapshots.size();i++)data.append(snapshots[i]);auto s=data.last().toObject();
  baseStatus=QString("%1 · %2 · %3/%4次 · %5板块 · 所选抓取 %6（非源时间）").arg(s["date"].toString(),scope->currentText()).arg(cursor->value()+1).arg(snapshots.size()).arg(s["rows"].toArray().size()).arg(local(s["receivedAt"].toString()));
  state->setText(baseStatus+"\n计算共同分析终点…");auto token=analysisGeneration,epoch=generation;auto field=metric->currentData().toString();auto n=minutes->currentData().toInt();auto flag=analysisCancelled;QPointer<RotationPage> weak(this);
  QThreadPool::globalInstance()->start([weak,token,epoch,data,field,n,flag]{QJsonObject result;QString error;try{result=darkRotation::analyze(data,field,n,QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs),[flag]{return flag->load();});}catch(const std::exception& e){error=QString::fromUtf8(e.what());}
    deliver(weak,[token,epoch,result,error](RotationPage* p){if(token!=p->analysisGeneration||epoch!=p->generation)return;if(!error.isEmpty()){p->state->setText("分析不可用："+error);return;}p->analysis=result;p->draw();});
  });
}
void RotationPage::draw(){
  QString code;if(table->currentRow()>=0)code=table->item(table->currentRow(),0)->data(Qt::UserRole).toString();
  QSignalBlocker block(table);table->setRowCount(0);history->setRowCount(0);curve->setData({});detail->setText("选择板块查看实际采样和窗口变化");
  QString key=QStringList{"rows","inflow","outflow","accelerating","decelerating"}.value(rank->currentIndex(),"rows");auto query=search->text().trimmed();int select=0;
  for(auto v:analysis[key].toArray()){
    auto r=v.toObject();if(!query.isEmpty()&&!r["name"].toString().contains(query,Qt::CaseInsensitive)&&!r["code"].toString().contains(query,Qt::CaseInsensitive))continue;
    int i=table->rowCount();table->insertRow(i);auto speed=[&](QString k){return r[k].isDouble()?QString::number(r[k].toDouble()/10000.,'f',2):"—";};
    QStringList values{r["name"].toString()+" · "+r["code"].toString(),darkRotation::money(r["darkNetCents"]),darkRotation::money(r["visibleNetCents"]),darkRotation::money(r["combinedNetCents"]),r["changeRatio"].isDouble()?QString::number(r["changeRatio"].toDouble()*100,'f',2)+"%":"—",darkRotation::money(r["deltaCents"]),speed("speedYuanPerMinute"),speed("speedChange"),r["state"].toString()+(r["divergence"].toBool()?" · 明暗反向":"")};
    for(int k=0;k<values.size();k++){auto* item=new QTableWidgetItem(values[k]);item->setData(Qt::UserRole,r["code"].toString());item->setToolTip(values[k]);if(k>0&&k<8){item->setTextAlignment(Qt::AlignRight|Qt::AlignVCenter);bool ok=false;double value=QString(values[k]).remove('%').toDouble(&ok);if(ok&&value!=0)item->setForeground(value<0?QColor(21,151,127):QColor(205,56,70));}table->setItem(i,k,item);}if(r["code"]==code)select=i;
  }
  if(!analysis.isEmpty())state->setText(baseStatus+"\n"+(analysis["windowEndAt"].isString()?"历史窗口终点 "+local(analysis["windowEndAt"].toString()):"没有有效盘中窗口")+QString(" · 可计算 %1/%2 · 当前榜 %3项；速度变化非买卖建议").arg(analysis["eligible"].toInt()).arg(analysis["rows"].toArray().size()).arg(table->rowCount()));
  if(table->rowCount())table->selectRow(select);else detail->setText("当前筛选无符合方向的板块；缺数不是0。可切回全部板块。");block.unblock();selected();
}
void RotationPage::selected(){
  if(table->currentRow()<0||snapshots.isEmpty())return;auto code=table->item(table->currentRow(),0)->data(Qt::UserRole).toString();QJsonArray subset;history->setRowCount(0);
  for(int i=0;i<=cursor->value()&&i<snapshots.size();i++){auto s=snapshots[i].toObject();QJsonArray only;for(auto v:s["rows"].toArray())if(v.toObject()["code"]==code){auto r=v.toObject();only.append(r);int n=history->rowCount();history->insertRow(n);auto at=local(r.contains("receivedAt")?r["receivedAt"].toString():s["receivedAt"].toString());QStringList values{at.right(12),darkRotation::money(r["darkNetCents"]),darkRotation::money(r["visibleNetCents"]),darkRotation::money(r["combinedNetCents"])};for(int k=0;k<values.size();k++){auto* item=new QTableWidgetItem(values[k]);item->setToolTip(at);if(k)item->setTextAlignment(Qt::AlignRight|Qt::AlignVCenter);history->setItem(n,k,item);}break;}s["rows"]=only;subset.append(s);}
  try{
    QJsonObject w;for(auto v:analysis["rows"].toArray())if(v.toObject()["code"]==code){w=v.toObject();break;}
    auto speed=[&](QString key){return w[key].isDouble()?QString::number(w[key].toDouble()/10000.,'f',2):"—";};
    detail->setText(table->item(table->currentRow(),0)->text()+"\n"+metric->currentText()+" · "+minutes->currentText()+"变化 "+darkRotation::money(w["deltaCents"])+" 万元 · "+w["state"].toString()+"\n速度 "+speed("speedYuanPerMinute")+" / 速度变化 "+speed("speedChange")+" 万元/分钟\n"+(w["deltaCents"].isString()?local(w["startAt"].toString())+" → "+local(w["endAt"].toString()):"数据不足；需同日同源连续样本")+"\n累计净额变化非逐笔流入；曲线至所选采样，午休压缩、断流留空。");
    curve->setData(darkRotation::series(subset,code,metric->currentData().toString()));
  }catch(const std::exception& e){detail->setText(QString::fromUtf8(e.what()));curve->setData({});}
  history->scrollToBottom();
}
void RotationPage::importArchive(const QString& input){
  if(sampling){state->setText("请先停止采样，再导入档案");return;}
  if(savePending){state->setText("上一项写入尚未退出；请等待后再导入，旧档案保留");return;}
  stop();savePending=true;scanBusy=true;samplingStart->setEnabled(false);refresh->setEnabled(false);auto token=generation;auto path=file;state->setText("后台核对与导入；原文件只读…");
  cancel->setEnabled(true);auto flag=cancelled;QPointer<RotationPage> weak(this);
  QThreadPool::globalInstance()->start([weak,token,path,input,flag]{QString error;int count=0;try{count=darkRotation::Store(path).importFile(input,[flag]{return flag->load();});}catch(const std::exception& e){error=QString::fromUtf8(e.what());}
    deliver(weak,[token,error,count](RotationPage* p){p->savePending=false;p->scanBusy=false;p->samplingStart->setEnabled(p->allowNetwork||bool(p->hooks.page));p->refresh->setEnabled(p->allowNetwork);if(token!=p->generation)return;p->cancel->setEnabled(false);if(!error.isEmpty()){p->fail(error);return;}p->setToolTip(QString("本次新增%1次采样，重复已跳过").arg(count));p->discoverDate();});
  });
}
void RotationPage::exportArchive(const QString& path){
  if(sampling){state->setText("请先停止采样，再导出档案");return;}
  if(snapshots.isEmpty()){state->setText("没有可导出的本机档案");return;}auto data=snapshots;auto token=generation;
  QPointer<RotationPage> weak(this);QThreadPool::globalInstance()->start([weak,token,path,data]{QString error;try{require(path.endsWith(".jsonl",Qt::CaseInsensitive),"导出须选择新的.jsonl文件");QFile f(path);require(f.open(QIODevice::WriteOnly|QIODevice::NewOnly),"只能导出到新文件，不覆盖现有档案或数据库");try{for(auto v:data){auto b=QJsonDocument(v.toObject()).toJson(QJsonDocument::Compact)+"\n";require(f.write(b)==b.size(),"导出写入失败");}require(f.flush(),"导出提交失败");}catch(...){f.close();f.remove();throw;}}catch(const std::exception& e){error=QString::fromUtf8(e.what());}deliver(weak,[token,error](RotationPage* p){if(token==p->generation)p->state->setText(error.isEmpty()?"已导出当前范围原始采样；来源时刻与缺数状态保留":"未导出："+error);});});
}
void RotationPage::refreshSource(){
  if((!allowNetwork&&!hooks.page)||!isVisible()||window()->isMinimized()||!foreground()||sampling||scanBusy||savePending)return;auto d=tradingDaySelection::effective(date->date()).toString(Qt::ISODate),s=scope->currentData().toString();bool daily=kind->currentIndex()==1;
  auto at=now().toUTC();
  if(!daily&&(!foreground()||!sessionAllowed(at.toString(Qt::ISODateWithMs),at.toString(Qt::ISODateWithMs)))){fail("当前不是已知交易日的盘中采样时段，请切换日榜；历史查询不回填分时。");return;}
  auto key=d+":"+s;auto ms=at.toMSecsSinceEpoch();if(attempts.contains(key)&&ms-attempts[key]<60000){fail("同范围至少间隔60秒，请先查看本机记录。");return;}attempts[key]=ms;
  stop();scanBusy=true;roundMonotonic=monotonic();scanDate=d;scanScope=s;scanDaily=daily;scanStart=at.toString(Qt::ISODateWithMs);scanRows={};scanBase={};scanPage=0;scanTotal=0;cancel->setEnabled(true);refresh->setEnabled(false);const auto token=generation;QTimer::singleShot(40000,this,[this,token]{if(token==generation&&scanBusy)fail("扫描超过40秒；不保存半榜");});nextPage(token);
}
void RotationPage::nextPage(quint64 token){
  if(token!=generation)return;if(!isVisible()||window()->isMinimized()||!foreground()){stop();return;}if(++scanPage>10||monotonic()-roundMonotonic>40000){fail("扫描超过边界；不保存半榜");return;}
  state->setText(QString("读取%1第%2页，完成整榜与金额校验后才入库…").arg(scanScope=="industry"?"行业":"概念").arg(scanPage));
  if(hooks.page){QPointer<RotationPage> weak(this);hooks.page(scanDate,scanScope,scanPage,[weak,token](QJsonObject raw,QString error){deliver(weak,[token,raw,error](RotationPage* p){p->receivePage(token,raw,error);});});return;}
  QNetworkRequest request{QUrl(darkRotation::url(scanDate,scanScope,scanPage))};request.setTransferTimeout(10000);request.setAttribute(QNetworkRequest::RedirectPolicyAttribute,QNetworkRequest::ManualRedirectPolicy);request.setRawHeader("Referer","https://emrnweb.eastmoney.com/graymarket/");request.setRawHeader("rnProjectId","emrn.GrayMarketRank");
  auto* r=network.get(request);reply=r;auto bytes=std::make_shared<QByteArray>();auto tooLarge=std::make_shared<bool>(false);
  connect(r,&QIODevice::readyRead,this,[r,bytes,tooLarge]{bytes->append(r->readAll());if(bytes->size()>2*1024*1024){*tooLarge=true;r->abort();}});
  connect(r,&QNetworkReply::finished,this,[this,r,bytes,tooLarge,token]{r->deleteLater();if(token!=generation)return;reply=nullptr;
    try{require(!*tooLarge&&r->error()==QNetworkReply::NoError&&r->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt()==200,"来源访问失败；没有回退伪造数据");bytes->append(r->readAll());require(bytes->size()<=2*1024*1024,"响应超过2MiB");QJsonParseError e;auto doc=QJsonDocument::fromJson(*bytes,&e);require(e.error==QJsonParseError::NoError&&doc.isObject(),"来源不是有效JSON");
      receivePage(token,doc.object(),{});
    }catch(const std::exception& e){fail(QString::fromUtf8(e.what()));}
  });
}
void RotationPage::receivePage(quint64 token,const QJsonObject& raw,const QString& error){
  if(token!=generation)return;
  if(!isVisible()||window()->isMinimized()||!foreground()){stop();return;}
  try{
    if(!error.isEmpty())throw std::runtime_error(error.toStdString());
    require(monotonic()-roundMonotonic<=40000,"扫描超过40秒；不保存半榜");
    auto at=now().toUTC().toString(Qt::ISODateWithMs);auto part=darkRotation::normalize(raw,scanDate,scanScope,scanPage,at);auto rows=part["rows"].toArray();int total=part["coverage"].toObject()["totalReported"].toInt();
    if(scanPage==1){scanBase=part;scanTotal=total;}require(total==scanTotal&&total>0&&rows.size()==std::min(100,total-(scanPage-1)*100),"分页覆盖发生变化或不完整");
    for(auto v:rows)scanRows.append(v);if(scanRows.size()<total){QTimer::singleShot(250,this,[this,token]{nextPage(token);});return;}
    require(scanDaily||(foreground()&&sessionAllowed(scanStart,at)),"跨越交易时段或扫描超时；不保存为盘中采样");
    auto final=scanBase;final["schema"]=scanDaily?"webstock.rotation-daily/v1":"webstock.rotation-snapshot/v1";final["date"]=scanDate;final["sourceKey"]=darkRotation::sourceKey(final);final["startedAt"]=scanStart;final["receivedAt"]=at;final["rows"]=scanRows;final["coverage"]=QJsonObject{{"complete",true},{"totalReported",total},{"receivedRows",scanRows.size()},{"pages",scanPage},{"paginationSnapshotConsistent",false}};darkRotation::validate(final);
    if(sampling){
      require(foreground()&&isVisible()&&!window()->isMinimized()&&sessionAllowed(roundStart,at),"本轮离页或跨交易时段；整轮未提交");
      roundSnapshots.append(final);
      if(scanScope=="industry"){scanScope="concept";scanStart=at;scanPage=0;scanTotal=0;scanRows={};scanBase={};QTimer::singleShot(250,this,[this,token]{nextPage(token);});return;}
      for(int i=0;i<roundSnapshots.size();i++){auto s=roundSnapshots[i].toObject();s["roundStartedAt"]=roundStart;s["roundCompletedAt"]=at;s["samplingSession"]=rotationSampling::session(evidenceDirectory,roundStart,at);roundSnapshots[i]=s;}
    }
    auto path=file;auto evidencePath=evidenceDirectory;auto capturedNow=hooks.now;auto flag=cancelled;auto pair=roundSnapshots;bool whole=sampling;savePending=true;QPointer<RotationPage> weak(this);
    QThreadPool::globalInstance()->start([weak,path,evidencePath,capturedNow,final,pair,whole,token,flag]{QString error;try{darkRotation::Store store(path);auto allowed=[&]{if(flag->load())return false;auto at=(capturedNow?capturedNow():QDateTime::currentDateTimeUtc()).toUTC().toString(Qt::ISODateWithMs);auto start=whole?pair[0].toObject().value("roundStartedAt").toString():final.value("startedAt").toString();return final.value("schema")=="webstock.rotation-daily/v1"||rotationSampling::session(evidencePath,start,at).value("allowed").toBool();};if(whole)store.saveRound(pair,[&]{return !allowed();});else store.save(final,[&]{return !allowed();});}catch(const std::exception& e){error=QString::fromUtf8(e.what());}
      deliver(weak,[token,error,whole](RotationPage* p){p->savePending=false;p->scanBusy=false;p->samplingStart->setEnabled((p->allowNetwork||bool(p->hooks.page))&&!p->sampling);p->refresh->setEnabled(p->allowNetwork);if(token!=p->generation)return;p->cancel->setEnabled(false);if(!error.isEmpty()){p->fail(error);return;}if(whole)p->samplingState->setText("本轮行业/概念已同时归档 · 抓取时刻非行情时刻 · 等待下一轮");p->load();});
    });
  }catch(const std::exception& e){fail(QString::fromUtf8(e.what()));}
}
