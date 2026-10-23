#include "board_series_widget.hpp"
#include "compact_actions.hpp"
#include "detail_disclosure.hpp"
#include "market_refresh_policy.hpp"
#include <QTimer>
#include "board_series_feed.hpp"
#include "chart.hpp"
#include "sector_watch_model.hpp"
#include <QComboBox>
#include <QLineEdit>
#include <QLabel>
#include <QPushButton>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QFile>
#include <QFileInfo>
#include <QDateTime>
#include <QSignalBlocker>
#include <QHideEvent>
#include <QShowEvent>
#include <QEvent>
#include <QFontMetrics>
#include <algorithm>
#include <cmath>
#include <stdexcept>
namespace {
class ReservedStatusLine final:public QLabel {
 bool reserving=false;
 int lineCount=1;
 void reserveHeight(){
  if(reserving)return;
  reserving=true;
  const auto metrics=fontMetrics();
  // Reserve one line for Chinese, Latin and numeric status text, even when empty.
  const int line=std::max({metrics.height(),metrics.lineSpacing(),metrics.boundingRect(QStringLiteral("国Ag0123456789")).height()});
  const auto insets=contentsMargins();
  const int edges=std::max(insets.top()+insets.bottom(),2*frameWidth());
  const int height=line*lineCount+edges+2*margin()+6;
  if(minimumHeight()!=height||maximumHeight()!=height)setFixedHeight(height);
  reserving=false;
 }
protected:
 bool event(QEvent*event)override{
  const auto type=event->type();
  const bool handled=QLabel::event(event);
  if(type==QEvent::Polish||type==QEvent::FontChange||type==QEvent::ApplicationFontChange||type==QEvent::StyleChange||type==QEvent::ContentsRectChange)reserveHeight();
  return handled;
 }
public:
 explicit ReservedStatusLine(QWidget*parent,int lines=1):QLabel(parent),lineCount(lines){reserveHeight();}
};
void updateBoardReadout(QLabel* readout,Chart* chart,int index){
 QString text="选点 —\n暂无可读数据";
 if(index>=0&&index<int(chart->bars.size())){
  const auto& bar=chart->bars[index];auto date=chart->labels.value(index);if(date.isEmpty())date="日期未取得";
  if(!market::valid(bar))text=date+" · 数据缺口 / 不可用\n开 —　高 —　低 —　收 —　原量 —（不可用）";
  else{auto price=[chart](double value){return QString::number(value,'f',chart->priceDecimals);};auto volume=std::isfinite(bar.volume)&&bar.volume>=0?QString::number(bar.volume,'g',15):QString("—（不可用）");
   text=QString("%1 · %2\n开 %3　高 %4　低 %5　收 %6　原量 %7").arg(date,chart->periodName,price(bar.open),price(bar.high),price(bar.low),price(bar.close),volume);
  }
 }
 readout->setText(text);readout->setToolTip(text);
}
}
BoardSeriesWidget::BoardSeriesWidget(QString directory,bool allow,QWidget* parent,QNetworkAccessManager* manager):QWidget(parent),cache(directory),cacheDirectory(directory),network(allow),feed(new boardSeries::Feed(this,manager)){
 setObjectName("boardSeriesWidget");automatic=new QTimer(this);automatic->setObjectName("boardAutomaticTimer");automatic->setSingleShot(true);connect(automatic,&QTimer::timeout,this,[this]{if(window()->isMinimized()){scheduleAutomatic();return;}refreshSource();});auto layout=new QVBoxLayout(this);auto identity=new QHBoxLayout;taxonomy=new QComboBox(this);taxonomy->setObjectName("boardSeriesTaxonomy");taxonomy->addItem("行业","industry");taxonomy->addItem("概念","concept");filter=new QLineEdit(this);filter->setObjectName("boardSeriesFilter");filter->setPlaceholderText("板块名称 / 来源代码");boards=new QComboBox(this);boards->setObjectName("boardSeriesBoard");boards->setMinimumWidth(180);source=new QComboBox(this);source->setObjectName("boardSeriesProvider");source->addItem("东方财富","eastmoney-public-board");source->addItem("同花顺","ths-public-board");source->addItem("新浪分类（无板块K线）","sina");identity->addWidget(source);identity->addWidget(taxonomy);identity->addWidget(filter,1);identity->addWidget(boards,2);layout->addLayout(identity);
 auto actions=new QHBoxLayout;period=new QComboBox(this);period->setObjectName("boardSeriesPeriod");period->addItem("日K","day");period->addItem("周K","week");period->addItem("月K","month");refresh=new QPushButton("刷新",this);refresh->setObjectName("boardSeriesRefresh");cancelButton=new QPushButton("取消",this);cancelButton->setObjectName("boardSeriesCancel");directoryButton=new QPushButton("更新目录",this);directoryButton->setObjectName("boardSeriesDirectoryRefresh");auto back=new QPushButton("返回成分",this);back->setObjectName("boardSeriesBack");for(auto widget:QList<QWidget*>{period,refresh,cancelButton})actions->addWidget(widget);actions->addStretch();layout->addLayout(actions);auto navigation=new QHBoxLayout;navigation->addWidget(directoryButton);navigation->addWidget(back);navigation->addStretch();layout->addLayout(navigation);auto*compact=new CompactActions;layout->insertLayout(0,compact);layout->removeItem(identity);compact->takeFrom(identity);delete identity;layout->removeItem(actions);compact->takeFrom(actions);delete actions;layout->removeItem(navigation);compact->takeFrom(navigation);delete navigation;filter->setMaximumWidth(200);boards->setMaximumWidth(220);
 status=new ReservedStatusLine(this);status->setObjectName("boardSeriesStatus");status->setTextFormat(Qt::PlainText);status->setWordWrap(false);layout->addWidget(status);auto*details=new QLabel(this);details->setObjectName("boardSeriesDetails");details->setWordWrap(true);details->setTextFormat(Qt::PlainText);addDataDetails(layout,details,"boardSeriesDataDetails");chart=new Chart(this);chart->setObjectName("boardSeriesChart");chart->minute=false;chart->overlay=false;chart->showNine=false;chart->volumeLabel="成交量 · 来源单位未核验";
 auto* readout=new ReservedStatusLine(this,2);readout->setObjectName("boardSeriesReadout");readout->setTextFormat(Qt::PlainText);readout->setWordWrap(false);readout->setMinimumWidth(0);readout->setSizePolicy(QSizePolicy::Ignored,QSizePolicy::Fixed);layout->addWidget(readout);layout->addWidget(chart,1);updateBoardReadout(readout,chart,-1);
 connect(chart,&Chart::barSelected,this,[this,readout](int index){updateBoardReadout(readout,chart,index);});
 connect(source,&QComboBox::currentIndexChanged,this,[this]{if(!rebuilding)rebuild();});connect(taxonomy,&QComboBox::currentIndexChanged,this,[this]{if(!rebuilding)rebuild();});connect(filter,&QLineEdit::textChanged,this,[this]{if(!rebuilding)rebuild();});connect(boards,&QComboBox::currentIndexChanged,this,[this]{if(!rebuilding)select();});connect(period,&QComboBox::currentIndexChanged,this,[this]{if(!rebuilding)select();});connect(refresh,&QPushButton::clicked,this,[this]{refreshSource();});connect(cancelButton,&QPushButton::clicked,this,[this]{stop();render("已取消；旧缓存保留，不发布晚返回",false);});connect(back,&QPushButton::clicked,this,[this]{stop();emit backRequested();});connect(directoryButton,&QPushButton::clicked,this,[this]{if(!network||!isVisible())return;stop();emit directoryRefreshRequested(taxonomy->currentData().toString(),source->currentData().toString());});
 connect(feed,&boardSeries::Feed::finished,this,[this](QJsonObject q,QJsonObject result,QString error){if(q!=current||!isVisible())return;busy=false;refreshFailures=error.isEmpty()?0:std::min(3,refreshFailures+1);auto at=QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);try{if(error.isEmpty())cache.save(result);else cache.failure(q,error,at);readCache(false);render(error.isEmpty()?(result["windowComplete"].toBool()?"已读取网络历史 · 申请窗口完整":QString("已读取真实历史 %1/%2 根 · 来源历史不足，未补造").arg(result["rawCount"].toInt()).arg(q["rawDays"].toInt())):QString(),false);}catch(const std::exception& e){QString why=QString::fromUtf8(e.what());try{cache.failure(q,why.left(2000),at);readCache(false);}catch(const std::exception&){}render("新结果未接收："+why,false);refreshFailures=std::min(3,refreshFailures+1);}scheduleAutomatic();});
 QString catalogError;try{QFile file(QFileInfo(cacheDirectory).absolutePath()+"/legacy-archive/files/market-board-catalog.json");if(file.exists()){if(!file.open(QIODevice::ReadOnly)||file.size()>2*1024*1024)throw std::runtime_error("Legacy board catalog unreadable or oversized");auto saved=boardSeries::legacyCatalog(file.readAll());catalog=saved["items"].toArray();for(auto row:saved["unsupported"].toArray())catalog.append(row);}}catch(const std::exception& e){catalogError=QString::fromUtf8(e.what());}
 bool industry=false,concept=false;for(auto raw:catalog){auto row=raw.toObject();if(row["provider"]=="eastmoney-public-board"){industry|=row["taxonomy"]=="industry";concept|=row["taxonomy"]=="concept";}}if(!industry&&concept){QSignalBlocker hold(taxonomy);taxonomy->setCurrentIndex(1);}rebuild();if(!catalogError.isEmpty())render("旧目录未读入："+catalogError);
}
void BoardSeriesWidget::setProvider(const QString& provider){int i=source->findData(provider);if(i>=0)source->setCurrentIndex(i);}
void BoardSeriesWidget::setBoard(const QJsonObject& row){
 stop();if(row.isEmpty())return;if(!current.isEmpty()&&current["provider"]==row["provider"]&&current["taxonomy"]==row["taxonomy"]&&current["code"]==row["code"]&&current["period"]==period->currentData().toString()){readCache(false);return;}auto kind=row["taxonomy"].toString();if(kind!="industry"&&kind!="concept"){current={};series={};render("此来源没有支持的行业/概念板块身份");return;}QJsonArray next;for(auto raw:catalog){auto old=raw.toObject();if(old["provider"]==row["provider"]&&old["taxonomy"]==row["taxonomy"]&&old["code"]==row["code"])continue;next.append(old);}next.append(row);catalog=next;
 rebuilding=true;source->setCurrentIndex(source->findData(row["provider"].toString().startsWith("sina-")?"sina":row["provider"].toString()));taxonomy->setCurrentIndex(taxonomy->findData(kind));filter->clear();rebuilding=false;rebuild();for(int i=0;i<boards->count();++i){auto item=boards->itemData(i).toJsonObject();if(item["provider"]==row["provider"]&&item["code"]==row["code"]){boards->setCurrentIndex(i);select();break;}}
}
void BoardSeriesWidget::setDirectory(const QJsonObject& snapshot){
 if(snapshot.isEmpty())return;
 try{sectorWatch::validate(snapshot);auto q=snapshot["query"].toObject();if(q["kind"]!="catalog"||(q["provider"]!="eastmoney-public-board"&&q["provider"]!="ths-public-board"))return;QJsonArray next;for(auto raw:catalog)if(raw.toObject()["taxonomy"]!=q["taxonomy"]||raw.toObject()["provider"]!=q["provider"])next.append(raw);for(auto raw:snapshot["items"].toArray()){auto row=raw.toObject();row["archiveFetchedAt"]=snapshot["fetchedAt"];row["archiveReadOnly"]=false;next.append(row);}catalog=next;rebuild();}catch(const std::exception& e){render("目录未接收："+QString::fromUtf8(e.what()),false);}
}
bool BoardSeriesWidget::hasCatalog()const{return !catalog.isEmpty();}
QJsonObject BoardSeriesWidget::evidence()const{return {{"query",current},{"series",series},{"lastAttempt",lastAttempt}};}
void BoardSeriesWidget::rebuild(){
 stop();auto keep=boards->currentData().toJsonObject();auto kind=taxonomy->currentData().toString(),text=filter->text().trimmed();rebuilding=true;boards->clear();int selected=-1;for(auto raw:catalog){auto row=raw.toObject();if((source->currentData()=="sina"?!row["provider"].toString().startsWith("sina-"):row["provider"]!=source->currentData().toString())||row["taxonomy"]!=kind||(!text.isEmpty()&&!row["name"].toString().contains(text,Qt::CaseInsensitive)&&!row["code"].toString().contains(text,Qt::CaseInsensitive)))continue;boards->addItem(row["name"].toString()+" · "+row["code"].toString(),row);if(row["provider"]==keep["provider"]&&row["code"]==keep["code"])selected=boards->count()-1;}if(selected>=0)boards->setCurrentIndex(selected);rebuilding=false;select();
}
void BoardSeriesWidget::select(){
 stop();const auto previous=current;current={};auto row=boards->currentData().toJsonObject();try{if(row["provider"]=="eastmoney-public-board"||row["provider"]=="ths-public-board")current=boardSeries::query(row["taxonomy"].toString(),row["code"].toString(),period->currentData().toString(),640,row["provider"].toString());}catch(const std::exception& e){series={};lastAttempt={};render("板块身份无效："+QString::fromUtf8(e.what()));return;}const bool reset=current!=previous;if(reset){series={};lastAttempt={};}readCache(reset);refreshFailures=0;scheduleAutomatic(true);
}
void BoardSeriesWidget::readCache(bool reset){
 if(!current.isEmpty())try{auto saved=cache.read(current);series=saved["series"].toObject();lastAttempt=saved["lastAttempt"].toObject();}catch(const std::exception& e){render("缓存未读入："+QString::fromUtf8(e.what()),reset);return;}render({},reset);
}
void BoardSeriesWidget::render(const QString& note,bool reset){
 auto choice=boards->currentData().toJsonObject();QString text=choice["name"].toString()+" · "+choice["code"].toString()+" · "+choice["provider"].toString();if(!choice["archiveFetchedAt"].toString().isEmpty())text+="\n目录来源日期 "+choice["archiveFetchedAt"].toString()+(choice["archiveReadOnly"].toBool()?" · 旧归档只读":" · 本机目录缓存");std::vector<market::Bar> bars;QStringList labels;
 for(auto raw:series.value("rows").toArray()){auto row=raw.toObject();bars.push_back({row["time"].toDouble(),row["open"].toDouble(),row["high"].toDouble(),row["low"].toDouble(),row["close"].toDouble(),row["volume"].isNull()?NAN:row["volume"].toDouble(),row["valid"].toBool(),row["closed"].toBool()});labels.append(row["date"].toString());}
 chart->dark=palette().color(QPalette::Window).lightness()<128;chart->periodName=period->currentText();chart->setSeries(bars,labels,false,reset);
 updateBoardReadout(findChild<QLabel*>("boardSeriesReadout",Qt::FindDirectChildrenOnly),chart,chart->selected);
 if(current.isEmpty())text+="\n此来源不提供可核对的板块自身指数；不使用成分股或同名板块代替。请选择明确来源，再更新该来源目录。";
 else if(series.isEmpty())text+="\n尚无此身份/周期历史缓存，请明确刷新。";
 else text+="\n"+source->currentText()+QString("板块自身日线 · 数据日期 %1 · 原始日线 %2/%3 · 图中%4根 · %5\n检查 %6；源时刻未知，周/月按自身日线聚合，末组闭合按日历边界保守标记。") .arg(series["dataDate"].toString()).arg(series["rawCount"].toInt()).arg(current["rawDays"].toInt()).arg(bars.size()).arg(series["availability"]=="available"?"字段/申请窗口完整":"窗口或量额有缺项，未称完整").arg(series["checkedAt"].toString());
 if(current["provider"]=="ths-public-board"&&!series.isEmpty()){auto inv=series["sourceInventory"].toObject();text+=QString("\n来源声明自 %1 起共 %2 根；本轮各年条数和最新OHLC已与来源清单核对。目录代码 %3，图表代码 %4。").arg(inv["startDate"].toString()).arg(inv["total"].toInt()).arg(current["code"].toString(),series["chartCode"].toString());}const auto failure=lastAttempt.value("error").toString();if(!failure.isEmpty())text+="\n最近失败 "+lastAttempt.value("checkedAt").toString()+"："+failure+(series.isEmpty()?"；无可用历史，未生成替代数据。":"；显示此前缓存，不是本轮更新。");if(!note.isEmpty())text+="\n"+note;status->setToolTip(text);findChild<QLabel*>("boardSeriesDetails")->setText(text);
 status->setText(!note.isEmpty()?note:!failure.isEmpty()?(series.isEmpty()?"更新失败 · 无可用历史：":"更新失败 · 当前显示旧缓存：")+failure:current.isEmpty()?QString("请选择支持的板块"):series.isEmpty()?QString("正在等待此板块历史"):source->currentText()+" · "+choice["name"].toString()+" · 数据截至 "+series.value("dataDate").toString());controls();
}
void BoardSeriesWidget::controls(){refresh->setEnabled(network&&isVisible()&&!busy&&!current.isEmpty());cancelButton->setEnabled(busy);directoryButton->setEnabled(network&&isVisible()&&!busy);}
void BoardSeriesWidget::scheduleAutomatic(bool immediate){
 automatic->stop();if(network&&isVisible()&&!current.isEmpty()&&!busy)
  automatic->start(immediate?180:marketRefresh::chinaInterval(QDateTime::currentDateTimeUtc(),refreshFailures,60000));
}
void BoardSeriesWidget::refreshSource(){
 if(!network||!isVisible()||window()->isMinimized()||busy||current.isEmpty())return;automatic->stop();try{busy=true;controls();if(!feed->start(current)){busy=false;render("已有板块读取在进行",false);return;}status->setText("正在更新板块行情…");}catch(const std::exception& e){busy=false;render("未开始读取："+QString::fromUtf8(e.what()),false);}
}
void BoardSeriesWidget::stop(){if(automatic)automatic->stop();feed->cancel();busy=false;if(refresh)controls();}
void BoardSeriesWidget::cancelRead(){bool active=busy;stop();if(active)render("原页操作已取消板块读取；旧缓存保留。",false);}
void BoardSeriesWidget::hideEvent(QHideEvent* event){stop();QWidget::hideEvent(event);}
void BoardSeriesWidget::showEvent(QShowEvent* event){readCache(false);controls();QWidget::showEvent(event);scheduleAutomatic(true);}
