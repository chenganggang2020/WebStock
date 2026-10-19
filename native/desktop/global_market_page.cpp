#include "global_market_page.hpp"
#include "compact_actions.hpp"
#include "global_market_model.hpp"
#include "global_market_cache.hpp"
#include "global_market_transport.hpp"
#include "appearance.hpp"
#include "detail_disclosure.hpp"
#include "market_refresh_policy.hpp"
#include <QtWidgets>
#include <QTimeZone>
#include <functional>
#include <cmath>
#include <limits>
namespace {
QString value(QJsonValue v,int digits=2){return v.isDouble()?QString::number(v.toDouble(),'f',digits):QString("未取得");}
QString known(QString text){return text.isEmpty()?QString("来源未提供"):text;}
QString origin(QString text){return text=="fresh"?QString("本次来源响应"):text=="legacy-cache"?QString("旧版历史缓存（非实时）"):QString("本机缓存（非实时）");}
QString stamp(QJsonObject row,bool minute){return minute?QDateTime::fromMSecsSinceEpoch(qint64(row["time"].toDouble()),QTimeZone::UTC).addSecs(8*3600).toString("MM-dd HH:mm"):row["date"].toString();}
class GlobalPlot final:public QWidget {
 QJsonObject series;QJsonArray rows;int count=0,end=0,selected=-1;bool dragging=false;QPoint pressed;int pressedEnd=0;
 QRectF area()const{return QRectF(75,38,std::max(1,width()-95),std::max(1,height()-108));}
 bool minute()const{return series["period"]=="intraday";}
 int start()const{return std::max(0,end-count);}
 void changed(){setProperty("visibleCount",count);setProperty("endIndex",end);update();}
 void inspect(int index){if(index<0||index>=rows.size())return;selected=index;const auto row=rows[index].toObject();const int digits=series["digits"].toInt(2);QString text=stamp(row,minute());if(minute())text+=" 北京时间 · 价格 "+value(row["close"],digits);else text+=" · 开 "+value(row["open"],digits)+" / 高 "+value(row["high"],digits)+" / 低 "+value(row["low"],digits)+" / 收 "+value(row["close"],digits);text+=" · 原成交量 "+(row["volume"].isDouble()?QString::number(row["volume"].toDouble(),'g',12):QString("未取得"))+"（单位未核验）";if(onInspect)onInspect(text);update();}
public:
 std::function<void(QString)> onInspect;
 explicit GlobalPlot(QWidget* p):QWidget(p){setObjectName("globalPlot");setMinimumSize(280,260);setMouseTracking(true);setFocusPolicy(Qt::StrongFocus);}
 void setSeries(QJsonObject data,bool reset){const bool atEnd=end>=rows.size();series=data;rows=data[minute()?"points":"candles"].toArray();selected=-1;if(reset||count==0){count=minute()?rows.size():std::min(64,int(rows.size()));end=rows.size();}else{count=std::min(count,int(rows.size()));end=atEnd?rows.size():std::clamp(end,count,int(rows.size()));}changed();}
 void showYears(int years){if(rows.isEmpty())return;end=rows.size();count=rows.size();if(years>0&&!minute()){auto cutoff=QDate::fromString(rows.last().toObject()["date"].toString(),Qt::ISODate).addYears(-years);int begin=0;while(begin<rows.size()-1&&QDate::fromString(rows[begin].toObject()["date"].toString(),Qt::ISODate)<cutoff)++begin;count=rows.size()-begin;}changed();}
 void resetZoom(){count=minute()?rows.size():std::min(64,int(rows.size()));end=rows.size();changed();}
 void restoreRange(int visible,int last){if(rows.isEmpty())return;count=std::clamp(visible,1,int(rows.size()));end=std::clamp(last,count,int(rows.size()));changed();}
protected:
 void paintEvent(QPaintEvent*)override{
  QPainter p(this);p.setRenderHint(QPainter::Antialiasing);p.fillRect(rect(),palette().color(QPalette::Base));p.setPen(palette().color(QPalette::Text));
  if(rows.isEmpty()){p.drawText(rect().adjusted(15,15,-15,-15),Qt::AlignCenter|Qt::TextWordWrap,"该周期未可用\n请切换周期或刷新数据。");return;}
  auto chart=area();double low=std::numeric_limits<double>::infinity(),high=-low;
  for(int i=start();i<end;++i){auto r=rows[i].toObject();for(auto key:minute()?QStringList{"close"}:QStringList{"open","high","low","close"})if(r[key].isDouble()&&r[key].toDouble()>0){low=std::min(low,r[key].toDouble());high=std::max(high,r[key].toDouble());}}
  if(!std::isfinite(low)){p.drawText(rect(),Qt::AlignCenter,"当前窗口没有有效价格；缺口保留。");return;}
  const auto previous=series["previousClose"];if(minute()&&previous.isDouble()&&previous.toDouble()>0){low=std::min(low,previous.toDouble());high=std::max(high,previous.toDouble());}
  double margin=std::max((high-low)*.06,std::max(high*.0001,.0001));low=std::max(0.,low-margin);high+=margin;
  auto y=[&](double price){return chart.bottom()-(price-low)/(high-low)*chart.height();};auto x=[&](int index){return chart.left()+chart.width()*(index-start()+.5)/std::max(1,count);};
  const auto text=palette().color(QPalette::Text);QColor grid=text;grid.setAlpha(45);for(int i=0;i<=4;++i){double price=low+(high-low)*i/4;p.setPen(QPen(grid,1));p.drawLine(QPointF(chart.left(),y(price)),QPointF(chart.right(),y(price)));p.setPen(text);p.drawText(QRectF(0,y(price)-10,68,22),Qt::AlignRight|Qt::AlignVCenter,QString::number(price,'f',series["digits"].toInt(2)));}
  p.setPen(grid);p.drawRect(chart);if(minute()&&previous.isDouble()&&previous.toDouble()>0){p.setPen(QPen(QColor("#d79737"),1,Qt::DashLine));p.drawLine(QPointF(chart.left(),y(previous.toDouble())),QPointF(chart.right(),y(previous.toDouble())));p.drawText(chart.left()+5,y(previous.toDouble())-3,"前收 "+value(previous));}
  bool lastValid=false;QPointF last;double width=std::clamp(chart.width()/std::max(1,count)*.68,1.,18.);const auto theme=appearance::theme(window()->property("stockTheme").toString());const QColor up=theme.up,down=theme.down,line=theme.accent;
  for(int i=start();i<end;++i){const auto r=rows[i].toObject();if(!r["close"].isDouble()||r["close"].toDouble()<=0){lastValid=false;continue;}const QPointF point(x(i),y(r["close"].toDouble()));
   if(minute()){p.setPen(QPen(line,1.5));if(lastValid)p.drawLine(last,point);else p.drawEllipse(point,1.5,1.5);last=point;lastValid=true;}
   else if(r["open"].isDouble()&&r["high"].isDouble()&&r["low"].isDouble()){const auto color=r["close"].toDouble()>=r["open"].toDouble()?up:down;p.setPen(QPen(color,1));p.drawLine(QPointF(x(i),y(r["high"].toDouble())),QPointF(x(i),y(r["low"].toDouble())));const auto top=std::min(y(r["open"].toDouble()),point.y()),bottom=std::max(y(r["open"].toDouble()),point.y());p.fillRect(QRectF(x(i)-width/2,top,width,std::max(1.,bottom-top)),color);}
   else{p.setPen(line);p.drawEllipse(point,2,2);}
  }
  if(selected>=start()&&selected<end){p.setPen(QPen(text,1,Qt::DashLine));p.drawLine(QPointF(x(selected),chart.top()),QPointF(x(selected),chart.bottom()));}
  p.setPen(text);p.drawText(75,20,minute()?"1分钟 · 北京时间":"日K");
  for(int j=0;j<=2;++j){int index=start()+(count-1)*j/2;auto label=stamp(rows[index].toObject(),minute());p.drawText(QRectF(std::clamp(x(index)-70,0.,double(this->width()-140)),chart.bottom()+7,140,24),Qt::AlignCenter,label);}
  p.drawText(QRectF(75,chart.bottom()+34,chart.width(),28),Qt::AlignLeft|Qt::AlignVCenter,QString("显示 %1–%2 / 完整 %3 条 · 滚轮缩放，拖动平移，点击查看原值").arg(start()+1).arg(end).arg(rows.size()));
 }
 void wheelEvent(QWheelEvent* e)override{if(rows.isEmpty())return;const int next=std::clamp(int(count*(e->angleDelta().y()>0?.8:1.25)),std::min(5,int(rows.size())),int(rows.size()));if(next==count)return;const int center=start()+count/2;count=next;end=std::clamp(center+count/2,count,int(rows.size()));changed();e->accept();}
 void mousePressEvent(QMouseEvent* e)override{if(e->button()!=Qt::LeftButton||rows.isEmpty())return;pressed=e->position().toPoint();pressedEnd=end;dragging=true;setFocus();}
 void mouseMoveEvent(QMouseEvent* e)override{if(dragging){const int offset=int((e->position().x()-pressed.x())/area().width()*count);end=std::clamp(pressedEnd-offset,count,int(rows.size()));changed();}}
 void mouseReleaseEvent(QMouseEvent* e)override{if(!dragging)return;dragging=false;if((e->position().toPoint()-pressed).manhattanLength()<6){const auto relative=(e->position().x()-area().left())/area().width();inspect(start()+std::clamp(int(relative*count),0,std::max(0,count-1)));}}
};
}
struct GlobalMarketPage::Private {
 GlobalMarketPage* page;globalMarket::Cache cache;GlobalMarketTransport* transport;bool online;int generation=0,failures=0;bool rendering=false;
 QComboBox *instrument,*period;QLabel *summary,*source,*quote,*point;QPlainTextEdit* status;QTableWidget* table;GlobalPlot* plot;QPushButton *refresh,*cancel;QCheckBox* automatic;QTimer timer;
 Private(GlobalMarketPage* p,QString dir,bool allow,QNetworkAccessManager* network):page(p),cache(dir),transport(new GlobalMarketTransport(p,network)),online(allow){}
 QString key()const{return instrument->currentData().toString();}QString timeframe()const{return period->currentData().toString();}
 bool allowed()const{return page->isVisible()&&page->window()->isVisible()&&!page->window()->isMinimized();}
 void stop(bool message=false){++generation;transport->cancel();timer.stop();if(message)status->setPlainText("已取消所选请求；已有价格、原始缓存和获取时间保留。");controls();}
 void controls(){refresh->setEnabled(online&&!transport->busy());cancel->setEnabled(transport->busy());}
 QJsonObject current()const{return cache.snapshot()["series"].toObject().value(key()+":"+timeframe()).toObject();}
 void schedule(bool immediate=false){timer.stop();if(online&&automatic->isChecked()&&allowed())timer.start(immediate?120:marketRefresh::globalInterval(globalMarket::definition(key()),timeframe(),QDateTime::currentDateTimeUtc(),failures));}
 void render(bool reset=false){
  const auto state=cache.snapshot(),series=current(),def=globalMarket::definition(key());const int digits=def["digits"].toInt(2);const auto q=state["quotes"].toObject().value(key()).toObject();plot->setSeries(series,reset);
  summary->setText(def["name"].toString()+" · "+(def["kind"]=="cfd"?QString("期货CFD"):def["kind"]=="fx"?QString("汇率"):QString("指数"))+" · "+(series.isEmpty()?QString("暂无该周期数据"):timeframe()=="daily"?"收盘 "+value(series["value"],digits)+" · "+series["observedAt"].toString():"分时来源值 "+value(series["value"],digits))+" · 单位 "+def["unit"].toString());
  QString details=series.isEmpty()?"此周期暂无已保存来源数据。":origin(series["cacheState"].toString())+" · "+series["source"].toString()+"\n数据时间 "+known(series["observedAt"].toString())+" · 获取时间 "+known(series["fetchedAt"].toString())+"\n";
  if(!series.isEmpty())details+=timeframe()=="daily"?QString("来源交易日 %1 至 %2 · 有效OHLC %3 / 完整 %4根；%5").arg(series["candles"].toArray().first().toObject()["date"].toString(),series["candles"].toArray().last().toObject()["date"].toString()).arg(series["validCandleCount"].toInt()).arg(series["candles"].toArray().size()).arg(series["dateConvention"].toString()):QString("来源交易日 %1 · 市场/来源时区 %2 · 横轴北京时间 · 有效 %3 / 完整 %4分钟点").arg(known(series["sessionDate"].toString()),series["zone"].toString()).arg(series["validCloseCount"].toInt()).arg(series["points"].toArray().size());source->setText(details);
  quote->setText(q.isEmpty()?"图表显示所标日期的价格":(q["priceKind"]=="daily-close"?QString("日线收盘 "):QString("来源报价 "))+value(q["value"],digits)+" · "+value(q["changePct"],2)+"% · "+(q["observedAt"].toString().isEmpty()?QString("时间未提供"):q["observedAt"].toString()));
  const auto catalog=globalMarket::catalog();table->setRowCount(catalog.size());for(int i=0;i<catalog.size();++i){auto d=catalog[i].toObject();const auto day=state["series"].toObject().value(d["key"].toString()+":daily").toObject(),minute=state["series"].toObject().value(d["key"].toString()+":intraday").toObject();QStringList cells{d["name"].toString(),d["kind"]=="cfd"?"CFD":d["kind"]=="fx"?"汇率":"指数",day.isEmpty()?"未可用":QString::number(day["candles"].toArray().size()),minute.isEmpty()?"未可用":QString::number(minute["points"].toArray().size())};for(int c=0;c<cells.size();++c){auto item=new QTableWidgetItem(cells[c]);item->setData(Qt::UserRole,d["key"].toString());table->setItem(i,c,item);}}
  point->setText(series.isEmpty()?QString():"数据截至 "+(timeframe()=="daily"?series["candles"].toArray().last().toObject()["date"].toString():series["sessionDate"].toString()));controls();
 }
 void refreshNow(){
  if(!allowed()||!online||transport->busy())return;const int token=++generation;const auto selected=key(),selectedPeriod=timeframe();QPointer<GlobalMarketPage> guard(page);status->setPlainText("正在刷新所选来源，已有图表保留；可取消。未请求其他标的。");
  try{transport->start(selected,selectedPeriod,[this,guard,token,selected,selectedPeriod](auto series,auto quote,QStringList errors){if(!guard||token!=generation||!page->isVisible()||page->window()->isMinimized()||key()!=selected||timeframe()!=selectedPeriod)return;failures=series.isEmpty()?std::min(3,failures+1):0;try{cache.apply(selected,selectedPeriod,series,quote,errors,QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));render(false);const auto latest=current();const auto candles=latest["candles"].toArray();const auto through=selectedPeriod=="daily"?(candles.isEmpty()?QString():candles.last().toObject()["date"].toString()):latest["sessionDate"].toString();status->setPlainText(errors.isEmpty()?"已更新 · 数据截至 "+through:((series.isEmpty()&&quote.isEmpty())?"更新未成功；保留原日期数据。\n":"部分来源已更新。\n")+errors.join('\n'));}catch(const std::exception&e){status->setPlainText("响应未写入；旧缓存保留："+QString::fromUtf8(e.what()));}controls();schedule();});controls();}catch(const std::exception&e){status->setPlainText(QString::fromUtf8(e.what()));++failures;controls();schedule();}
 }
};
GlobalMarketPage::GlobalMarketPage(QString directory,bool online,QWidget* parent,QNetworkAccessManager* network):QWidget(parent),d(new Private(this,directory,online,network)){
 setObjectName("globalMarketPage");auto root=new QVBoxLayout(this);auto head=new QHBoxLayout;auto title=new QLabel("全球行情 · 指数 / 期货CFD / 汇率");head->addWidget(title,1);auto back=new QPushButton("返回主页");back->setObjectName("globalBack");head->addWidget(back);root->addLayout(head);
 auto selection=new QGridLayout;d->instrument=new QComboBox;d->instrument->setObjectName("globalInstrument");d->instrument->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);d->instrument->setMinimumContentsLength(12);for(auto v:globalMarket::catalog()){const auto c=v.toObject();d->instrument->addItem(c["name"].toString(),c["key"].toString());}d->instrument->setCurrentIndex(d->instrument->findData("nikkei225"));d->period=new QComboBox;d->period->setObjectName("globalPeriod");d->period->addItem("日K","daily");d->period->addItem("1分钟分时","intraday");selection->addWidget(new QLabel("标的"),0,0);selection->addWidget(d->instrument,0,1);selection->addWidget(new QLabel("周期"),0,2);selection->addWidget(d->period,0,3);selection->setColumnStretch(1,1);root->addLayout(selection);
 auto actions=new CompactActions;d->refresh=new QPushButton("刷新行情");d->refresh->setObjectName("globalRefresh");d->cancel=new QPushButton("取消请求");d->cancel->setObjectName("globalCancel");auto reload=new QPushButton("重新载入");reload->setObjectName("globalReload");auto reset=new QPushButton("重置缩放");reset->setObjectName("globalResetZoom");for(auto b:{d->refresh,d->cancel,reload,reset})actions->addWidget(b);auto range=new QComboBox;range->setObjectName("globalHistoryRange");range->addItem("历史范围",-1);range->addItem("近1年",1);range->addItem("近3年",3);range->addItem("近5年",5);range->addItem("全部历史",0);actions->addWidget(range);root->addLayout(actions);connect(range,&QComboBox::currentIndexChanged,this,[this,range](int){if(range->currentData().toInt()>=0){d->plot->showYears(range->currentData().toInt());QSignalBlocker b(range);range->setCurrentIndex(0);}});
 d->automatic=new QCheckBox("本页定时刷新：日K 5分钟 / 分时30秒（只限所选标的）");d->automatic->setObjectName("globalAutomatic");d->automatic->setEnabled(online);root->addWidget(d->automatic);
 d->summary=new QLabel;d->summary->setObjectName("globalSummary");d->source=new QLabel;d->source->setObjectName("globalSource");d->quote=new QLabel;d->quote->setObjectName("globalQuote");for(auto label:{d->summary,d->quote}){label->setWordWrap(true);label->setTextFormat(Qt::PlainText);root->addWidget(label);}
 auto split=new QSplitter;root->addWidget(split,1);d->table=new QTableWidget(0,4);d->table->setObjectName("globalCatalog");d->table->setHorizontalHeaderLabels({"标的","类别","日K","分钟"});d->table->setEditTriggers(QAbstractItemView::NoEditTriggers);d->table->setSelectionBehavior(QAbstractItemView::SelectRows);d->table->setMinimumWidth(190);d->table->horizontalHeader()->setSectionResizeMode(0,QHeaderView::Stretch);for(int i=1;i<4;++i)d->table->setColumnWidth(i,49);split->addWidget(d->table);d->plot=new GlobalPlot(split);split->addWidget(d->plot);split->setStretchFactor(1,1);split->setSizes({280,700});
 d->point=new QLabel;d->point->setObjectName("globalPoint");d->point->setWordWrap(true);d->point->setTextFormat(Qt::PlainText);root->addWidget(d->point);d->plot->onInspect=[this](QString text){d->point->setText(text);};
 auto boundary=new QLabel("公开来源延迟未保证；旧缓存不是今日实时。CFD独立标识，不等于交易所合约。VIX反映波动率，不是涨跌方向。缺数和未核验的成交量单位保留。");boundary->setWordWrap(true);auto* details=new QWidget(this);auto* detailsLayout=new QVBoxLayout(details);d->source->setWordWrap(true);d->source->setTextFormat(Qt::PlainText);detailsLayout->addWidget(d->source);detailsLayout->addWidget(boundary);addDataDetails(root,details,"globalDataDetails");d->status=new QPlainTextEdit;d->status->setObjectName("globalStatus");d->status->setReadOnly(true);d->status->setFixedHeight(d->status->fontMetrics().height()+8);connect(d->status,&QPlainTextEdit::textChanged,this,[this]{d->status->setToolTip(d->status->toPlainText());});d->status->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);d->status->setFrameShape(QFrame::NoFrame);root->addWidget(d->status);
 d->automatic->setText("自动更新");d->automatic->setChecked(true);d->automatic->setToolTip("进入页面或切换时立即更新；交易时段分时30秒、日K5分钟，休市降低频率。手动刷新强制请求来源。");
 // Keep selection and actions on one compact row rather than stretching the
 // instrument selector across the entire window.
 selection->removeWidget(d->instrument);selection->removeWidget(d->period);d->instrument->setMaximumWidth(230);d->period->setMaximumWidth(130);
 while(auto item=selection->takeAt(0)){if(auto widget=item->widget())delete widget;delete item;}root->removeItem(selection);delete selection;
 actions->insertWidget(0,d->instrument);actions->insertWidget(1,d->period);root->removeWidget(d->automatic);actions->addWidget(d->automatic);root->removeItem(head);actions->takeFrom(head);delete head;root->removeWidget(d->summary);d->summary->hide();
 auto changed=[this]{if(d->rendering)return;d->stop();d->failures=0;d->render(true);d->status->setPlainText(d->automatic->isChecked()?"正在自动更新所选行情":"自动更新已暂停");d->schedule(true);};connect(d->instrument,qOverload<int>(&QComboBox::currentIndexChanged),this,changed);connect(d->period,qOverload<int>(&QComboBox::currentIndexChanged),this,changed);
 connect(d->table,&QTableWidget::cellClicked,this,[this](int row,int){if(row>=0&&d->table->item(row,0))d->instrument->setCurrentIndex(d->instrument->findData(d->table->item(row,0)->data(Qt::UserRole).toString()));});
 connect(d->refresh,&QPushButton::clicked,this,[this]{d->refreshNow();});connect(d->cancel,&QPushButton::clicked,this,[this]{if(d->allowed()){d->stop(true);d->schedule();}});connect(reload,&QPushButton::clicked,this,[this]{if(!d->allowed())return;d->stop();d->cache.reload();d->render();QStringList errors;for(auto e:d->cache.snapshot()["loadErrors"].toArray())errors.append(e.toString());d->status->setPlainText("数据已载入\n"+errors.join('\n'));d->schedule();});
 connect(reset,&QPushButton::clicked,this,[this]{if(d->allowed())d->plot->resetZoom();});connect(back,&QPushButton::clicked,this,[this]{if(d->allowed()){d->stop();emit backRequested();}});d->timer.setParent(this);d->timer.setObjectName("globalAutomaticTimer");d->timer.setSingleShot(true);connect(&d->timer,&QTimer::timeout,this,[this]{if(d->allowed())d->refreshNow();else d->schedule();});connect(d->automatic,&QCheckBox::toggled,this,[this]{d->schedule(true);});
 connect(qApp,&QGuiApplication::applicationStateChanged,this,[this](Qt::ApplicationState value){if(value==Qt::ApplicationActive)d->schedule(true);});
 d->render(true);QStringList errors;for(auto e:d->cache.snapshot()["loadErrors"].toArray())errors.append(e.toString());d->status->setPlainText("请选择标的；点击刷新更新行情。"+(errors.isEmpty()?QString():"\n"+errors.join('\n')));
}
GlobalMarketPage::~GlobalMarketPage(){d->stop();}
QJsonObject GlobalMarketPage::sourceEvidence()const{return {{"catalog",globalMarket::catalog()},{"state",d->cache.snapshot()},{"series",d->current()},{"quote",d->cache.snapshot()["quotes"].toObject().value(d->key())},{"selection",QJsonObject{{"key",d->key()},{"period",d->timeframe()}}},{"requests",d->transport->responses()},{"range",QJsonObject{{"visibleCount",d->plot->property("visibleCount").toInt()},{"endIndex",d->plot->property("endIndex").toInt()}}}};}
QJsonObject GlobalMarketPage::saveState()const{return {{"schema","native-global-market-ui/v1"},{"key",d->key()},{"period",d->timeframe()},{"automatic",d->automatic->isChecked()},{"visibleCount",d->plot->property("visibleCount").toInt()},{"endIndex",d->plot->property("endIndex").toInt()}};}
void GlobalMarketPage::restoreState(const QJsonObject& state){globalMarket::definition(state["key"].toString());if(state["schema"]!="native-global-market-ui/v1"||!QStringList{"daily","intraday"}.contains(state["period"].toString()))throw std::runtime_error("全球页面状态格式不支持");d->stop();d->rendering=true;d->instrument->setCurrentIndex(d->instrument->findData(state["key"].toString()));d->period->setCurrentIndex(d->period->findData(state["period"].toString()));d->automatic->setChecked(state["automatic"].toBool(true));d->rendering=false;d->render(true);d->plot->restoreRange(state["visibleCount"].toInt(),state["endIndex"].toInt());d->status->setPlainText("所选标的和图表位置已恢复");d->schedule(true);}
void GlobalMarketPage::hideEvent(QHideEvent* e){d->stop();QWidget::hideEvent(e);}
void GlobalMarketPage::showEvent(QShowEvent* e){QWidget::showEvent(e);d->schedule(true);}
