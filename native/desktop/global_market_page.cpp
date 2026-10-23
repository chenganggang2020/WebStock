#include "global_market_page.hpp"
#include "compact_actions.hpp"
#include "global_market_model.hpp"
#include "global_market_session.hpp"
#include "global_market_cache.hpp"
#include "global_market_transport.hpp"
#include "appearance.hpp"
#include "detail_disclosure.hpp"
#include "market_refresh_policy.hpp"
#include "native_read_pool.hpp"
#include "candle_raster.hpp"
#include <QtWidgets>
#include <QTimeZone>
#include <functional>
#include <cmath>
#include <limits>
#include <atomic>
namespace {
QString value(QJsonValue v,int digits=2){return v.isDouble()?QString::number(v.toDouble(),'f',digits):QString("未取得");}
QString known(QString text){return text.isEmpty()?QString("来源未提供"):text;}
QString origin(QString text){return text=="fresh"?QString("本次来源响应"):text=="legacy-cache"?QString("旧版历史缓存（非实时）"):QString("本机缓存（非实时）");}
QString stamp(QJsonObject row,bool minute){return minute?QDateTime::fromMSecsSinceEpoch(qint64(row["time"].toDouble()),QTimeZone::UTC).addSecs(8*3600).toString("MM-dd HH:mm"):row["date"].toString();}
class GlobalPlot final:public QWidget {
 struct LayerKey {
  quint64 data=0,environment=0,palette=0;int count=0,end=0,dpiX=0,dpiY=0;QSize size;qreal dpr=0;QFont font;QString theme;Qt::LayoutDirection direction=Qt::LeftToRight;QPalette::ColorGroup group=QPalette::Active;QPainter::RenderHints hints;QBrush background;
  bool operator==(const LayerKey& other)const{return data==other.data&&environment==other.environment&&palette==other.palette&&count==other.count&&end==other.end&&dpiX==other.dpiX&&dpiY==other.dpiY&&size==other.size&&dpr==other.dpr&&font==other.font&&theme==other.theme&&direction==other.direction&&group==other.group&&hints==other.hints&&background==other.background;}
 };
 static constexpr qsizetype LayerByteLimit=32*1024*1024;
 static QSize boundedLayerPixels(QSize logical,qreal dpr){
  if(logical.width()<=0||logical.height()<=0||!std::isfinite(dpr)||dpr<=0)return {};
  const qreal w=std::ceil(logical.width()*dpr),h=std::ceil(logical.height()*dpr);
  if(!std::isfinite(w)||!std::isfinite(h)||w<1||h<1||w>LayerByteLimit/4||h>LayerByteLimit/(4*qint64(w)))return {};
  return QSize(int(w),int(h));
 }
 QImage staticLayer;LayerKey layerKey;bool layerReady=false,selectionEligible=false;quint64 dataRevision=0,environmentRevision=0;
 QPointer<QWidget> layerOwner;QPointer<QWindow> layerWindow;QPointer<QScreen> layerScreen;QMetaObject::Connection screenConnection,dpiConnection;
 void clearLayer(){staticLayer=QImage();layerReady=false;selectionEligible=false;}
 void invalidateLayer(){clearLayer();++environmentRevision;update();}
 void bindLayerEnvironment(){
  auto* owner=window();auto* handle=owner?owner->windowHandle():nullptr;auto* screen=handle?handle->screen():nullptr;
  if(layerOwner==owner&&layerWindow==handle&&layerScreen==screen)return;
  if(layerOwner)layerOwner->removeEventFilter(this);disconnect(screenConnection);disconnect(dpiConnection);
  layerOwner=owner;layerWindow=handle;layerScreen=screen;
  if(owner)owner->installEventFilter(this);
  if(handle)screenConnection=connect(handle,&QWindow::screenChanged,this,[this]{invalidateLayer();});
  if(screen)dpiConnection=connect(screen,&QScreen::logicalDotsPerInchChanged,this,[this]{invalidateLayer();});
  clearLayer();++environmentRevision;
 }
 LayerKey currentLayerKey(const QPainter& painter)const{
  return {dataRevision,environmentRevision,quint64(palette().cacheKey()),count,end,logicalDpiX(),logicalDpiY(),size(),devicePixelRatioF(),painter.font(),window()->property("stockTheme").toString(),painter.layoutDirection(),palette().currentColorGroup(),painter.renderHints(),painter.background()};
 }
 bool layerSize(const QPainter& painter,QSize& pixels)const{
  const qreal dpr=devicePixelRatioF();const auto transform=painter.deviceTransform();const auto base=palette().color(QPalette::Base);
  if(!std::isfinite(dpr)||dpr<=0||width()<=0||height()<=0||logicalDpiX()<=0||logicalDpiY()<=0||base.alpha()!=255||painter.background().style()!=Qt::SolidPattern||painter.background().color().alpha()!=255||testAttribute(Qt::WA_TranslucentBackground)||testAttribute(Qt::WA_NoSystemBackground)||painter.opacity()!=1||painter.compositionMode()!=QPainter::CompositionMode_SourceOver||!qFuzzyCompare(transform.m11(),dpr)||!qFuzzyCompare(transform.m22(),dpr)||!qFuzzyIsNull(transform.m12())||!qFuzzyIsNull(transform.m21())||!transform.isAffine())return false;
  pixels=boundedLayerPixels(size(),dpr);return !pixels.isEmpty();
 }
 void paintSelection(QPainter& painter,bool eligible){
  if(eligible&&selected>=start()&&selected<end){const auto chart=area();const auto x=pointX(selected);painter.setPen(QPen(palette().color(QPalette::Text),1,Qt::DashLine));painter.drawLine(QPointF(x,chart.top()),QPointF(x,chart.bottom()));}
 }
 QJsonObject series,session;QJsonArray rows;int count=0,end=0,selected=-1;bool dragging=false,readingDrag=false,anchored=false;QPoint pressed;int pressedEnd=0;
 QRectF area()const{return QRectF(75,38,std::max(1,width()-(minute()&&series["previousClose"].toDouble()>0?160:95)),std::max(1,height()-108));}
 bool minute()const{return series["period"]=="intraday";}
 bool fixedSession()const{return minute()&&!session.isEmpty()&&count>=rows.size();}
 double pointX(int index)const{
  const auto box=area();
  const double fraction=fixedSession()?(rows[index].toObject()["time"].toDouble()-session["start"].toDouble())/(session["end"].toDouble()-session["start"].toDouble()):(index-start()+.5)/std::max(1,count);
  return box.left()+box.width()*fraction;
 }
 int start()const{return std::max(0,end-count);}
 QJsonValue identity(int index)const{if(index<0||index>=rows.size())return QJsonValue::Null;return rows[index].toObject().value(minute()?"time":"date");}
 bool validIdentity(const QJsonValue& value)const{return minute()?value.isDouble()&&std::isfinite(value.toDouble())&&value.toDouble()>0&&std::floor(value.toDouble())==value.toDouble():value.isString()&&QDate::fromString(value.toString(),Qt::ISODate).isValid();}
 int lower(const QJsonValue& value)const{int first=0,last=rows.size();while(first<last){int middle=first+(last-first)/2;const auto at=identity(middle);if(minute()?at.toDouble()<value.toDouble():at.toString()<value.toString())first=middle+1;else last=middle;}return first;}
 int exact(const QJsonValue& value)const{if(!validIdentity(value))return -1;int index=lower(value);return index<rows.size()&&identity(index)==value?index:-1;}
 int atPosition(double x)const{
  const double fraction=std::clamp((x-area().left())/area().width(),0.,1.);
  if(!fixedSession())return start()+std::clamp(int(fraction*count),0,std::max(0,count-1));
  const double time=session["start"].toDouble()+fraction*(session["end"].toDouble()-session["start"].toDouble());
  int lastValid=rows.size()-1;while(lastValid>=0&&!rows[lastValid].toObject()["close"].isDouble())--lastValid;
  if(lastValid>=0&&time>=identity(lastValid).toDouble())return lastValid;
  int index=lower(time);
  if(index>0&&(index>=rows.size()||time-identity(index-1).toDouble()<identity(index).toDouble()-time))--index;
  return index<rows.size()&&std::abs(identity(index).toDouble()-time)<=30000?index:-1;
 }
 void changed(){setProperty("visibleCount",count);setProperty("endIndex",end);update();}
 void inspect(int index){
  if(index<0||index>=rows.size()){selected=-1;if(onSelection)onSelection({});if(onInspect)onInspect("该时点价格 / 涨跌幅未取得；未用最新价代替。");update();return;}
  selected=index;const auto row=rows[index].toObject();const int digits=series["digits"].toInt(2);QString text=stamp(row,minute());
  if(minute())text+=" 北京时间 · 价格 "+value(row["close"],digits);
  else text+=" · 开 "+value(row["open"],digits)+" / 高 "+value(row["high"],digits)+" / 低 "+value(row["low"],digits)+" / 收 "+value(row["close"],digits);
  const double base=minute()?series["previousClose"].toDouble():index>0?rows[index-1].toObject()["close"].toDouble():0;
  text+=" · 涨跌幅 ";
  if(base>0&&row["close"].isDouble()){const double pct=(row["close"].toDouble()/base-1)*100;text+=(pct>0?"+":"")+QString::number(pct,'f',2)+"%";}else text+="未取得";
  text+=minute()?"（较昨收）":"（较前一根收盘）";
  text+=" · 原成交量 "+(row["volume"].isDouble()?QString::number(row["volume"].toDouble(),'g',12):QString("未取得"))+"（单位未核验）";
  if(onSelection)onSelection({{"value",row["close"]},{"changePct",base>0&&row["close"].isDouble()?QJsonValue((row["close"].toDouble()/base-1)*100):QJsonValue(QJsonValue::Null)},{"stamp",stamp(row,minute())},{"selected",true}});
  if(onInspect)onInspect(text);update();
 }
public:
 std::function<void(QString)> onInspect;
 std::function<void(QJsonObject)> onSelection;
 explicit GlobalPlot(QWidget* p):QWidget(p){setObjectName("globalPlot");setMinimumSize(280,260);setMouseTracking(true);setFocusPolicy(Qt::StrongFocus);connect(qApp,&QGuiApplication::fontDatabaseChanged,this,[this]{invalidateLayer();});}
 ~GlobalPlot()override{clearLayer();if(layerOwner)layerOwner->removeEventFilter(this);}
 QJsonObject timeAnchors()const{return {{"first",identity(start())},{"last",identity(end-1)},{"selected",identity(selected)},{"anchored",anchored}};}
 void setSeries(QJsonObject data,bool reset){
  ++dataRevision;clearLayer();const auto prior=timeAnchors();const auto pressedAnchor=identity(pressedEnd-1);const int visible=count,last=end;const bool atEnd=end>=rows.size(),full=count>=rows.size();
  const bool same=!reset&&series["key"]==data["key"]&&series["period"]==data["period"];
  series=std::move(data);rows=series[minute()?"points":"candles"].toArray();session=globalMarket::intradaySession(series);selected=-1;
  if(!same||rows.isEmpty()){dragging=false;readingDrag=false;}
  else if(dragging&&validIdentity(pressedAnchor)){int after=lower(pressedAnchor);if(after<rows.size()&&identity(after)==pressedAnchor)++after;pressedEnd=std::clamp(after,std::min(visible,int(rows.size())),int(rows.size()));}
  if(!same||visible==0){count=minute()?rows.size():std::min(64,int(rows.size()));end=rows.size();anchored=false;}
  else if(anchored){restoreRange(visible,last,prior);return;}
  else{count=minute()&&full?rows.size():std::min(visible,int(rows.size()));end=atEnd?rows.size():std::clamp(last,count,int(rows.size()));}
  changed();if(same){const int index=exact(prior["selected"]);if(index>=0)inspect(index);}
 }
 void showYears(int years){if(rows.isEmpty())return;anchored=true;end=rows.size();count=rows.size();if(years>0&&!minute()){auto cutoff=QDate::fromString(rows.last().toObject()["date"].toString(),Qt::ISODate).addYears(-years);count=rows.size()-std::min(lower(cutoff.toString(Qt::ISODate)),int(rows.size())-1);}changed();}
 void resetZoom(){anchored=false;count=minute()?rows.size():std::min(64,int(rows.size()));end=rows.size();changed();}
 void restoreRange(int visible,int last,const QJsonObject& anchors={}){
  if(visible<=0||last<=0||(minute()&&anchors["anchored"].isBool()&&!anchors["anchored"].toBool())){resetZoom();return;}
  if(rows.isEmpty())return;count=std::clamp(visible,1,int(rows.size()));end=std::clamp(last,count,int(rows.size()));anchored=anchors["anchored"].toBool(true);selected=-1;
  if(validIdentity(anchors["first"])&&validIdentity(anchors["last"])){const int first=lower(anchors["first"]);int after=lower(anchors["last"]);if(after<rows.size()&&identity(after)==anchors["last"])++after;if(after>first){count=after-first;end=after;}else end=std::clamp(first+count,count,int(rows.size()));}
  changed();const int index=exact(anchors["selected"]);if(index>=0)inspect(index);
 }
protected:
 bool paintStatic(QPainter& p){
  p.setRenderHint(QPainter::Antialiasing);p.fillRect(rect(),palette().color(QPalette::Base));p.setPen(palette().color(QPalette::Text));
  const auto reserved=area();QColor frameInk=palette().color(QPalette::Text);frameInk.setAlpha(45);p.setPen(frameInk);p.drawRect(reserved);
  for(int i=0;i<5;++i){auto y=reserved.top()+reserved.height()*i/4;p.drawLine(QPointF(reserved.left(),y),QPointF(reserved.right(),y));}
  p.setPen(palette().color(QPalette::Text));
  if(rows.isEmpty()){p.drawText(rect().adjusted(15,15,-15,-15),Qt::AlignCenter|Qt::TextWordWrap,"该周期未可用\n请切换周期或刷新数据。");return false;}
  auto chart=area();double low=std::numeric_limits<double>::infinity(),high=-low;
  const bool isMinute=minute();const QStringList priceKeys=isMinute?QStringList{"close"}:QStringList{"open","high","low","close"};
  for(int i=start();i<end;++i){const auto r=rows[i].toObject();for(const auto& key:priceKeys){const auto price=r[key];if(price.isDouble()&&price.toDouble()>0){low=std::min(low,price.toDouble());high=std::max(high,price.toDouble());}}}
  if(!std::isfinite(low)){p.drawText(rect(),Qt::AlignCenter,"当前窗口没有有效价格；缺口保留。");return false;}
  const auto previous=series["previousClose"];
  const auto bounds=globalMarket::priceRange(low,high,minute()?previous.toDouble():0.);low=bounds.first;high=bounds.second;setProperty("priceAxisLow",low);setProperty("priceAxisHigh",high);
  auto y=[&](double price){return chart.bottom()-(price-low)/(high-low)*chart.height();};auto x=[&](int index){return pointX(index);};
  const auto text=palette().color(QPalette::Text);QColor grid=text;grid.setAlpha(45);for(int i=0;i<=4;++i){double price=low+(high-low)*i/4;p.setPen(QPen(grid,1));p.drawLine(QPointF(chart.left(),y(price)),QPointF(chart.right(),y(price)));p.setPen(text);p.drawText(QRectF(0,y(price)-10,68,22),Qt::AlignRight|Qt::AlignVCenter,QString::number(price,'f',series["digits"].toInt(2)));}
  if(minute()&&previous.toDouble()>0){
   const auto theme=appearance::theme(window()->property("stockTheme").toString());
   for(int i=0;i<=4;++i){const double price=low+(high-low)*i/4,pct=(price/previous.toDouble()-1)*100;
    p.setPen(pct>0?theme.up:pct<0?theme.down:text);
    p.drawText(QRectF(chart.right()+5,y(price)-10,76,22),Qt::AlignLeft|Qt::AlignVCenter,(pct>0?"+":"")+QString::number(pct,'f',2)+"%");
   }
  }
  p.setPen(grid);p.drawRect(chart);if(minute()&&previous.isDouble()&&previous.toDouble()>0){p.setPen(QPen(QColor("#d79737"),1,Qt::DashLine));p.drawLine(QPointF(chart.left(),y(previous.toDouble())),QPointF(chart.right(),y(previous.toDouble())));p.drawText(chart.left()+5,y(previous.toDouble())-3,"前收 "+value(previous));}
  bool lastValid=false;QPointF last;const auto theme=appearance::theme(window()->property("stockTheme").toString());const QColor up=theme.up,down=theme.down,line=theme.accent;
  if(!isMinute){
   const candleRaster::View view{rows,chart,start(),end,count,low,high,up,down,line};QImage parallelImage;
   if(count>=4096&&p.device()->devType()==QInternal::Image&&p.worldTransform().isIdentity()&&p.opacity()==1&&p.compositionMode()==QPainter::CompositionMode_SourceOver)
    parallelImage=candleRaster::parallel(*static_cast<QImage*>(p.device()),view);
   if(parallelImage.isNull())candleRaster::draw(p,view,start(),end);else p.drawImage(QPointF(0,0),parallelImage);
  }else{
  const QPen minutePen(line,1.5);
  for(int i=start();i<end;++i){const auto r=rows.at(i).toObject();const auto close=r[QStringLiteral("close")];if(!close.isDouble()||close.toDouble()<=0){lastValid=false;continue;}const double px=x(i);const QPointF point(px,y(close.toDouble()));
   p.setPen(minutePen);if(lastValid)p.drawLine(last,point);else p.drawEllipse(point,1.5,1.5);last=point;lastValid=true;
  }
  }
  p.setPen(text);p.drawText(75,20,minute()?"1分钟 · 北京时间 · "+(session.isEmpty()?QString("来源时段未提供，按已有数据范围"):session["estimated"].toBool()?QString("常规时段，特殊休市未核验"):QString("来源完整交易时段")):QString("日K"));
  const int ticks=fixedSession()&&chart.width()>600?4:2;
  for(int j=0;j<=ticks;++j){int index=start()+(count-1)*j/ticks;
   auto label=fixedSession()?stamp(QJsonObject{{"time",session["start"].toDouble()+(session["end"].toDouble()-session["start"].toDouble())*j/ticks}},true):stamp(rows[index].toObject(),minute());
   const double px=fixedSession()?chart.left()+chart.width()*j/ticks:x(index);
   p.drawText(QRectF(std::clamp(px-70,0.,double(this->width()-140)),chart.bottom()+7,140,24),Qt::AlignCenter,label);
  }
  p.drawText(QRectF(75,chart.bottom()+34,chart.width(),28),Qt::AlignLeft|Qt::AlignVCenter,QString("显示 %1–%2 / 完整 %3 条 · 滚轮缩放，全分时拖动读数，缩放后拖动平移").arg(start()+1).arg(end).arg(rows.size()));
  return true;
 }
 bool event(QEvent* event)override{
  const auto type=event->type();const bool handled=QWidget::event(event);
  switch(type){
   case QEvent::Resize:case QEvent::FontChange:case QEvent::ApplicationFontChange:case QEvent::PaletteChange:case QEvent::ApplicationPaletteChange:case QEvent::StyleChange:case QEvent::LayoutDirectionChange:case QEvent::EnabledChange:case QEvent::DevicePixelRatioChange:case QEvent::ParentChange:case QEvent::WinIdChange:invalidateLayer();break;
   default:break;
  }
  return handled;
 }
 bool eventFilter(QObject* object,QEvent* event)override{
  if(object==layerOwner&&(event->type()==QEvent::WindowActivate||event->type()==QEvent::WindowDeactivate||event->type()==QEvent::WinIdChange||event->type()==QEvent::DevicePixelRatioChange||(event->type()==QEvent::DynamicPropertyChange&&static_cast<QDynamicPropertyChangeEvent*>(event)->propertyName()=="stockTheme")))invalidateLayer();
  return QWidget::eventFilter(object,event);
 }
 void hideEvent(QHideEvent* event)override{clearLayer();QWidget::hideEvent(event);}
 void paintEvent(QPaintEvent* event)override{
  bindLayerEnvironment();QPainter painter(this);painter.setRenderHint(QPainter::Antialiasing);const auto key=currentLayerKey(painter);QSize pixels;
  if(!layerSize(painter,pixels)){clearLayer();paintSelection(painter,paintStatic(painter));return;}
  if(!layerReady||!(layerKey==key)){
   clearLayer();QImage next(pixels,QImage::Format_RGB32);
   if(next.isNull()||next.sizeInBytes()>LayerByteLimit){paintSelection(painter,paintStatic(painter));return;}
   next.setDevicePixelRatio(key.dpr);next.setDotsPerMeterX(qRound(key.dpiX/0.0254));next.setDotsPerMeterY(qRound(key.dpiY/0.0254));next.fill(painter.background().color());
   QPainter imagePainter(&next);
   if(!imagePainter.isActive()){paintSelection(painter,paintStatic(painter));return;}
   imagePainter.setFont(painter.font());imagePainter.setLayoutDirection(painter.layoutDirection());imagePainter.setRenderHints(painter.renderHints());imagePainter.setBackground(painter.background());imagePainter.setBackgroundMode(painter.backgroundMode());
   const bool eligible=paintStatic(imagePainter);imagePainter.end();staticLayer=std::move(next);layerKey=key;selectionEligible=eligible;layerReady=true;
   if(event->region()!=QRegion(rect()))update();
  }
  painter.drawImage(QPointF(0,0),staticLayer);paintSelection(painter,selectionEligible);
 }
 void wheelEvent(QWheelEvent* e)override{if(rows.isEmpty())return;const int next=std::clamp(int(count*(e->angleDelta().y()>0?.8:1.25)),std::min(5,int(rows.size())),int(rows.size()));if(next==count)return;anchored=true;const int center=start()+count/2;count=next;end=std::clamp(center+count/2,count,int(rows.size()));changed();e->accept();}
 void mousePressEvent(QMouseEvent* e)override{if(e->button()!=Qt::LeftButton||rows.isEmpty())return;pressed=e->position().toPoint();pressedEnd=end;dragging=true;readingDrag=minute()&&count>=rows.size();if(!readingDrag)anchored=true;setFocus();if(readingDrag)inspect(atPosition(e->position().x()));}
 void mouseMoveEvent(QMouseEvent* e)override{if(dragging){if(readingDrag)inspect(atPosition(e->position().x()));else{const int offset=int((e->position().x()-pressed.x())/area().width()*count);end=std::clamp(pressedEnd-offset,count,int(rows.size()));changed();}}}
 void mouseReleaseEvent(QMouseEvent* e)override{if(!dragging)return;dragging=false;if(readingDrag||(e->position().toPoint()-pressed).manhattanLength()<6)inspect(atPosition(e->position().x()));}
};
}
namespace {
void retireGlobalCache(std::shared_ptr<globalMarket::Cache> value){
 if(!value)return;auto* app=QCoreApplication::instance();
 if(!app||QThread::currentThread()!=app->thread()){value.reset();return;}
 nativeReadPool()->start([value=std::move(value)]()mutable{value.reset();},1);
}
struct GlobalCacheJob {
 quint64 serial=0;int viewGeneration=0;bool write=false,committed=false,seriesUpdated=false,quoteUpdated=false;QString key,period,error;QStringList errors;
 std::shared_ptr<std::atomic_bool> cancel=std::make_shared<std::atomic_bool>(false);
 std::shared_ptr<globalMarket::Cache> value;
};
}
struct GlobalMarketPage::Private {
 GlobalMarketPage* page;QString directory;std::shared_ptr<globalMarket::Cache> cache;GlobalMarketTransport* transport;bool online;int generation=0,failures=0;bool rendering=false;
 bool cacheRunning=false,pendingRead=true,needsRead=true,renderPending=false;quint64 cacheSerial=0;
 std::shared_ptr<std::atomic_bool> cacheCancelled=std::make_shared<std::atomic_bool>(false);QJsonObject pendingView;
 QComboBox *instrument,*period;QLabel *summary,*source,*quote,*point;QPlainTextEdit* status;QTableWidget* table;GlobalPlot* plot;QPushButton *refresh,*cancel;QCheckBox* automatic;QTimer timer;
 Private(GlobalMarketPage* p,QString dir,bool allow,QNetworkAccessManager* network):page(p),directory(std::move(dir)),transport(new GlobalMarketTransport(p,network)),online(allow){}
 ~Private(){cacheCancelled->store(true);retireGlobalCache(std::move(cache));}
 QJsonObject snapshot()const{return cache?cache->snapshot():QJsonObject{{"schema","native-global-market/v1"},{"series",QJsonObject{}},{"quotes",QJsonObject{}},{"attempts",QJsonObject{}}};}
 QString key()const{return instrument->currentData().toString();}QString timeframe()const{return period->currentData().toString();}
 bool allowed()const{return page->isVisible()&&page->window()->isVisible()&&!page->window()->isMinimized();}
 void stop(bool message=false){const bool interrupted=transport->busy()||cacheRunning||pendingRead;++generation;++cacheSerial;transport->cancel();timer.stop();pendingRead=false;if(cacheRunning){cacheCancelled->store(true);needsRead=true;}if(message||interrupted)status->setPlainText("已取消未提交的所选请求；已获授权的保存会确认真实结果。");controls();}
 void controls(){refresh->setEnabled(online&&cache&&!needsRead&&!cacheRunning&&!pendingRead&&!transport->busy());cancel->setEnabled(transport->busy()||cacheRunning||pendingRead);}
 QJsonObject current()const{return snapshot()["series"].toObject().value(key()+":"+timeframe()).toObject();}
 void schedule(bool immediate=false){timer.stop();if(online&&cache&&!needsRead&&!cacheRunning&&!pendingRead&&automatic->isChecked()&&allowed())timer.start(immediate?120:marketRefresh::globalInterval(globalMarket::definition(key()),timeframe(),QDateTime::currentDateTimeUtc(),failures));}
 void runCache(bool write,std::shared_ptr<globalMarket::Cache> seed={},QString selected={},QString selectedPeriod={},QJsonObject series={},QJsonObject quote={},QStringList errors={}){
  auto job=std::make_shared<GlobalCacheJob>();job->serial=cacheSerial;job->viewGeneration=generation;job->write=write;job->seriesUpdated=!series.isEmpty();job->quoteUpdated=!quote.isEmpty();job->key=selected;job->period=selectedPeriod;job->errors=errors;job->value=std::move(seed);
  cacheRunning=true;cacheCancelled=job->cancel;controls();auto path=directory;auto at=QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs);QPointer<GlobalMarketPage> owner(page);QPointer<QObject> app(QCoreApplication::instance());
  nativeReadPool()->start([job,path,at,owner,app,series=std::move(series),quote=std::move(quote)]()mutable{
   auto cancelled=[flag=job->cancel]{return flag->load();};
   try{if(job->write){job->value->apply(job->key,job->period,series,quote,job->errors,at,cancelled);job->committed=true;}else job->value=std::make_shared<globalMarket::Cache>(path,cancelled);}catch(const std::exception& e){job->error=QString::fromUtf8(e.what());}
   series={};quote={};if(job->cancel->load()&&!job->committed){job->value.reset();job->error.clear();}
   if(!app||!QMetaObject::invokeMethod(app,[owner,job]{if(owner)owner->d->cacheFinished(job);else retireGlobalCache(std::move(job->value));},Qt::QueuedConnection))job->value.reset();
  });
 }
 void dispatchRead(){if(cacheRunning||!pendingRead||!allowed())return;pendingRead=false;status->setPlainText("正在读取本机全球缓存；已有图表保留。");runCache(false);}
 void requestRead(){++cacheSerial;pendingRead=true;needsRead=true;if(cacheRunning)cacheCancelled->store(true);dispatchRead();controls();}
 void resume(){if(!allowed()||cacheRunning)return;if(needsRead||!cache){if(!pendingRead)requestRead();else dispatchRead();}else{if(renderPending)render(false);schedule(true);}}
 void cacheFinished(const std::shared_ptr<GlobalCacheJob>& job){
  cacheRunning=false;const bool current=job->serial==cacheSerial&&!job->cancel->load();const bool viewCurrent=current&&job->viewGeneration==generation&&allowed();
  if(job->committed||(!job->write&&current&&job->value&&job->error.isEmpty())){
   retireGlobalCache(std::move(cache));cache=std::move(job->value);renderPending=true;needsRead=job->committed?!viewCurrent:false;
   if(viewCurrent){render(false);if(job->write){const auto latest=currentSeriesThrough();const bool changed=snapshot()["attempts"].toObject().value(key()+":"+timeframe()).toObject()["dataChanged"].toBool();status->setPlainText(job->errors.isEmpty()?(changed?QString("数据已变化 · 数据截至 "):QString("来源已核验，数据未变化 · 数据截至 "))+latest:((!job->seriesUpdated&&!job->quoteUpdated)?"更新未成功；保留原日期数据。\n":"部分来源已更新。\n")+job->errors.join('\n'));}else{QStringList errors;for(auto e:snapshot()["loadErrors"].toArray())errors.append(e.toString());const auto attempt=snapshot()["attempts"].toObject().value(key()+":"+timeframe()).toObject();QString loaded="数据已载入";if(attempt["state"]=="failed"||attempt["state"]=="partial"){loaded=attempt["state"]=="failed"?"上次刷新未成功；保留原日期数据。":"上次刷新仅部分成功；未更新部分保留原日期数据。";loaded+="\n上次尝试 "+known(attempt["at"].toString());for(auto e:attempt["errors"].toArray())loaded+="\n"+e.toString();}status->setPlainText(errors.isEmpty()?loaded:"缓存载入存在错误；悬停查看详情。\n"+errors.join('\n'));}}
   else if(job->committed&&allowed()){pendingRead=true;status->setPlainText("保存已提交并确认；正在重读当前选择。");}
  }else if(job->cancel->load())needsRead=pendingRead||!cache||!allowed();
  else if(viewCurrent&&!job->error.isEmpty())status->setPlainText("缓存操作未采用；原数据保留："+job->error);
  retireGlobalCache(std::move(job->value));controls();if(pendingRead)dispatchRead();else schedule(!job->write);
 }
 QString currentSeriesThrough()const{return globalMarket::lastDataTime(current());}
 void showQuote(const QJsonObject& selected={}){
  const auto def=globalMarket::definition(key());auto row=selected;const bool reading=row["selected"].toBool();
  if(!reading){row=snapshot()["quotes"].toObject().value(key()).toObject();if(row.isEmpty())row=current();}
  auto theme=appearance::theme(page->window()->property("stockTheme").toString());const auto pct=row["changePct"];const auto color=pct.isDouble()?pct.toDouble()>0?theme.up:pct.toDouble()<0?theme.down:theme.text:theme.text;
  auto when=reading?row["stamp"].toString()+" · 选中点":row["observedAt"].toString()+" · 最新来源值";
  quote->setText(QString("<b>%1</b>  <span style='font-size:24px;color:%2'>%3%4</span>  <span style='font-size:22px;color:%2'>%5%</span><br><span style='font-size:12px'>%6 · 公开源延迟未保证</span>")
   .arg(def["name"].toString().toHtmlEscaped(),color.name(),value(row["value"],def["digits"].toInt(2)),def["unit"]=="收益率%"?"%":"",value(pct,2),when.toHtmlEscaped()));
 }
 void render(bool reset=false){
  const auto state=snapshot(),series=current(),def=globalMarket::definition(key());const int digits=def["digits"].toInt(2);const auto q=state["quotes"].toObject().value(key()).toObject();renderPending=false;
  summary->setText(def["name"].toString()+" · "+(def["kind"]=="cfd"?QString("期货CFD"):def["kind"]=="fx"?QString("汇率"):def["kind"]=="yield"?QString("国债收益率"):QString("指数"))+" · "+(series.isEmpty()?QString("暂无该周期数据"):timeframe()=="daily"?"收盘 "+value(series["value"],digits)+" · "+series["observedAt"].toString():"分时来源值 "+value(series["value"],digits))+" · 单位 "+def["unit"].toString());
  QString details=series.isEmpty()?"此周期暂无已保存来源数据。":origin(series["cacheState"].toString())+" · "+series["source"].toString()+"\n数据时间 "+known(series["observedAt"].toString())+" · 获取时间 "+known(series["fetchedAt"].toString())+"\n";
  if(!series.isEmpty())details+=timeframe()=="daily"?QString("来源交易日 %1 至 %2 · 有效OHLC %3 / 完整 %4根；%5").arg(series["candles"].toArray().first().toObject()["date"].toString(),series["candles"].toArray().last().toObject()["date"].toString()).arg(series["validCandleCount"].toInt()).arg(series["candles"].toArray().size()).arg(series["dateConvention"].toString()):QString("来源交易日 %1 · 市场/来源时区 %2 · 横轴北京时间 · 有效 %3 / 完整 %4分钟点").arg(known(series["sessionDate"].toString()),series["zone"].toString()).arg(series["validCloseCount"].toInt()).arg(series["points"].toArray().size());source->setText(details);
  const auto shown=q.isEmpty()?series:q;
  QString quoteText=q.isEmpty()?(series.isEmpty()?QString("暂无该周期行情及报价"):QString("暂无独立报价；图表显示所标日期的价格")):(q["priceKind"]=="daily-close"?QString("日线收盘 "):QString("来源报价 "))+value(q["value"],digits)+" · "+value(q["changePct"],2)+"%";
  if(!shown.isEmpty())quoteText+=" · 数据时间 "+known(shown["observedAt"].toString())+"\n"+origin(shown["cacheState"].toString())+" · "+known(shown["source"].toString())+" · 公开源延迟未保证";
  showQuote();quote->setToolTip(quoteText+(shown.isEmpty()?QString():"\n获取时间 "+known(shown["fetchedAt"].toString())));
  const auto catalog=globalMarket::catalog();table->setRowCount(catalog.size());for(int i=0;i<catalog.size();++i){auto d=catalog[i].toObject();const auto day=state["series"].toObject().value(d["key"].toString()+":daily").toObject(),minute=state["series"].toObject().value(d["key"].toString()+":intraday").toObject();QStringList cells{d["name"].toString()};for(int c=0;c<cells.size();++c){auto item=new QTableWidgetItem(cells[c]);item->setData(Qt::UserRole,d["key"].toString());item->setToolTip(QString("%1\n日线：%2 根 · 分时：%3 点").arg(d["name"].toString()).arg(day["candles"].toArray().size()).arg(minute["points"].toArray().size()));table->setItem(i,c,item);}}
  {QSignalBlocker block(table);table->setCurrentCell(instrument->currentIndex(),0,QItemSelectionModel::ClearAndSelect|QItemSelectionModel::Rows);}
  point->setText(series.isEmpty()?QString():"数据截至 "+globalMarket::lastDataTime(series)+(timeframe()=="intraday"?" 北京时间 · 来源交易日 "+series["sessionDate"].toString():QString()));plot->setSeries(series,reset);
  if(!pendingView.isEmpty()&&pendingView["key"]==key()&&pendingView["period"]==timeframe()&&!series.isEmpty()){auto state=std::move(pendingView);pendingView={};plot->restoreRange(state["visibleCount"].toInt(),state["endIndex"].toInt(),state["timeAnchors"].toObject());}controls();
 }
 void refreshNow(){
  if(!allowed()||!online||!cache||needsRead||cacheRunning||pendingRead||transport->busy())return;const int token=++generation;const auto selected=key(),selectedPeriod=timeframe();QPointer<GlobalMarketPage> guard(page);status->setPlainText("正在刷新所选来源，已有图表保留；可取消。未请求其他标的。");
  try{transport->start(selected,selectedPeriod,[this,guard,token,selected,selectedPeriod](auto series,auto quote,QStringList errors){if(!guard||token!=generation||!page->isVisible()||page->window()->isMinimized()||key()!=selected||timeframe()!=selectedPeriod)return;failures=series.isEmpty()?std::min(3,failures+1):0;++cacheSerial;runCache(true,std::make_shared<globalMarket::Cache>(*cache),selected,selectedPeriod,std::move(series),std::move(quote),errors);});controls();}catch(const std::exception&e){status->setPlainText(QString::fromUtf8(e.what()));++failures;controls();schedule();}
 }
};
GlobalMarketPage::GlobalMarketPage(QString directory,bool online,QWidget* parent,QNetworkAccessManager* network):QWidget(parent),d(new Private(this,directory,online,network)){
 setObjectName("globalMarketPage");auto root=new QVBoxLayout(this);auto head=new QHBoxLayout;auto title=new QLabel("全球行情 · 指数 / 期货CFD / 汇率");head->addWidget(title,1);auto back=new QPushButton("返回主页");back->setObjectName("globalBack");head->addWidget(back);root->addLayout(head);
 auto selection=new QGridLayout;d->instrument=new QComboBox;d->instrument->setObjectName("globalInstrument");d->instrument->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);d->instrument->setMinimumContentsLength(12);for(auto v:globalMarket::catalog()){const auto c=v.toObject();d->instrument->addItem(c["name"].toString(),c["key"].toString());}d->instrument->setCurrentIndex(d->instrument->findData("nikkei225"));d->period=new QComboBox;d->period->setObjectName("globalPeriod");d->period->addItem("日K","daily");d->period->addItem("1分钟分时","intraday");selection->addWidget(new QLabel("标的"),0,0);selection->addWidget(d->instrument,0,1);selection->addWidget(new QLabel("周期"),0,2);selection->addWidget(d->period,0,3);selection->setColumnStretch(1,1);root->addLayout(selection);
 auto actions=new CompactActions;d->refresh=new QPushButton("刷新行情");d->refresh->setObjectName("globalRefresh");d->cancel=new QPushButton("取消请求");d->cancel->setObjectName("globalCancel");auto reload=new QPushButton("重新载入");reload->setObjectName("globalReload");auto reset=new QPushButton("重置缩放");reset->setObjectName("globalResetZoom");for(auto b:{d->refresh,d->cancel,reload,reset})actions->addWidget(b);auto range=new QComboBox;range->setObjectName("globalHistoryRange");range->addItem("历史范围",-1);range->addItem("近1年",1);range->addItem("近3年",3);range->addItem("近5年",5);range->addItem("全部历史",0);actions->addWidget(range);root->addLayout(actions);connect(range,&QComboBox::currentIndexChanged,this,[this,range](int){if(range->currentData().toInt()>=0){d->pendingView={};d->plot->showYears(range->currentData().toInt());QSignalBlocker b(range);range->setCurrentIndex(0);}});
 d->automatic=new QCheckBox("本页定时刷新：日K 5分钟 / 分时30秒（只限所选标的）");d->automatic->setObjectName("globalAutomatic");d->automatic->setEnabled(online);root->addWidget(d->automatic);
 d->summary=new QLabel;d->summary->setObjectName("globalSummary");d->source=new QLabel;d->source->setObjectName("globalSource");d->quote=new QLabel;d->quote->setFixedHeight(qMax(64,d->quote->fontMetrics().height()*3+8));d->quote->setObjectName("globalQuote");for(auto label:{d->summary,d->quote}){label->setWordWrap(true);label->setTextFormat(Qt::PlainText);root->addWidget(label);}
 auto split=new QSplitter;root->addWidget(split,1);d->table=new QTableWidget(0,1);d->table->setObjectName("globalCatalog");d->table->setHorizontalHeaderLabels({"名称"});d->table->verticalHeader()->hide();d->table->setEditTriggers(QAbstractItemView::NoEditTriggers);d->table->setSelectionBehavior(QAbstractItemView::SelectRows);d->table->setMinimumWidth(190);d->table->horizontalHeader()->setSectionResizeMode(0,QHeaderView::Stretch);split->addWidget(d->table);d->plot=new GlobalPlot(split);split->addWidget(d->plot);split->setStretchFactor(1,1);split->setSizes({190,790});
 d->quote->setTextFormat(Qt::RichText);
 d->point=new QLabel;d->point->setObjectName("globalPoint");d->point->setWordWrap(true);d->point->setFixedHeight(d->point->fontMetrics().height()*2+8);d->point->setTextFormat(Qt::PlainText);root->addWidget(d->point);d->plot->onInspect=[this](QString text){d->point->setText(text);};d->plot->onSelection=[this](QJsonObject row){d->showQuote(row);};
 auto boundary=new QLabel("公开来源延迟未保证；旧缓存不是今日实时。CFD独立标识，不等于交易所合约。VIX反映波动率，不是涨跌方向。缺数和未核验的成交量单位保留。");boundary->setWordWrap(true);auto* details=new QWidget(this);auto* detailsLayout=new QVBoxLayout(details);d->source->setWordWrap(true);d->source->setTextFormat(Qt::PlainText);detailsLayout->addWidget(d->source);detailsLayout->addWidget(boundary);addDataDetails(root,details,"globalDataDetails");d->status=new QPlainTextEdit;d->status->setObjectName("globalStatus");d->status->setReadOnly(true);d->status->setFixedHeight(d->status->fontMetrics().height()+8);connect(d->status,&QPlainTextEdit::textChanged,this,[this]{d->status->setToolTip(d->status->toPlainText());});d->status->setVerticalScrollBarPolicy(Qt::ScrollBarAlwaysOff);d->status->setFrameShape(QFrame::NoFrame);root->addWidget(d->status);
 d->automatic->setText("自动更新");d->automatic->setChecked(true);d->automatic->setToolTip("进入页面或切换时立即更新；交易时段分时30秒、日K5分钟，休市降低频率。手动刷新强制请求来源。");
 // Keep selection and actions on one compact row rather than stretching the
 // instrument selector across the entire window.
 selection->removeWidget(d->instrument);selection->removeWidget(d->period);d->instrument->setMaximumWidth(230);d->period->setMaximumWidth(130);
 while(auto item=selection->takeAt(0)){if(auto widget=item->widget())delete widget;delete item;}root->removeItem(selection);delete selection;
 actions->insertWidget(0,d->instrument);actions->insertWidget(1,d->period);root->removeWidget(d->automatic);actions->addWidget(d->automatic);root->removeItem(head);actions->takeFrom(head);delete head;root->removeWidget(d->summary);d->summary->hide();
 auto changed=[this]{if(d->rendering)return;d->stop();d->failures=0;d->pendingView={};d->render(true);d->status->setPlainText(!d->online?"离线模式：仅查看本机缓存，不请求行情来源。":d->automatic->isChecked()?"正在自动更新所选行情":"自动更新已暂停");if(d->needsRead||!d->cache)d->requestRead();else d->schedule(true);};connect(d->instrument,qOverload<int>(&QComboBox::currentIndexChanged),this,changed);connect(d->period,qOverload<int>(&QComboBox::currentIndexChanged),this,changed);
 connect(d->table,&QTableWidget::cellClicked,this,[this](int row,int){if(row>=0&&d->table->item(row,0))d->instrument->setCurrentIndex(d->instrument->findData(d->table->item(row,0)->data(Qt::UserRole).toString()));});
 connect(d->refresh,&QPushButton::clicked,this,[this]{d->refreshNow();});connect(d->cancel,&QPushButton::clicked,this,[this]{if(d->allowed()){d->stop(true);d->schedule();}});connect(reload,&QPushButton::clicked,this,[this]{if(!d->allowed())return;d->stop();d->requestRead();});
 connect(reset,&QPushButton::clicked,this,[this]{if(d->allowed()){d->pendingView={};d->plot->resetZoom();}});connect(back,&QPushButton::clicked,this,[this]{if(d->allowed()){d->stop();emit backRequested();}});d->timer.setParent(this);d->timer.setObjectName("globalAutomaticTimer");d->timer.setSingleShot(true);connect(&d->timer,&QTimer::timeout,this,[this]{if(d->allowed())d->refreshNow();else d->schedule();});connect(d->automatic,&QCheckBox::toggled,this,[this](bool enabled){const bool queued=d->timer.isActive();d->schedule(true);if(!enabled&&queued&&!d->transport->busy()&&!d->cacheRunning&&!d->pendingRead)d->status->setPlainText("自动更新已暂停；可手动刷新所选行情。");});
 connect(qApp,&QGuiApplication::applicationStateChanged,this,[this](Qt::ApplicationState value){if(value==Qt::ApplicationActive)d->resume();});
 d->render(true);d->status->setPlainText("等待读取本机全球缓存；可切换标的或取消。");
}
GlobalMarketPage::~GlobalMarketPage(){d->stop();}
void GlobalMarketPage::reloadSaved(const QString& selection){if(selection!=d->key()+":"+d->timeframe())return;d->needsRead=true;if(!d->allowed())return;if(d->cacheRunning||d->transport->busy()){d->pendingRead=true;return;}d->requestRead();}
QJsonObject GlobalMarketPage::sourceEvidence()const{return {{"catalog",globalMarket::catalog()},{"state",d->snapshot()},{"series",d->current()},{"quote",d->snapshot()["quotes"].toObject().value(d->key())},{"selection",QJsonObject{{"key",d->key()},{"period",d->timeframe()}}},{"requests",d->transport->responses()},{"range",QJsonObject{{"visibleCount",d->plot->property("visibleCount").toInt()},{"endIndex",d->plot->property("endIndex").toInt()}}}};}
QJsonObject GlobalMarketPage::saveState()const{QJsonObject state{{"schema","native-global-market-ui/v1"},{"key",d->key()},{"period",d->timeframe()},{"automatic",d->automatic->isChecked()},{"visibleCount",d->plot->property("visibleCount").toInt()},{"endIndex",d->plot->property("endIndex").toInt()},{"timeAnchors",d->plot->timeAnchors()}};if(!d->pendingView.isEmpty()&&d->pendingView["key"]==d->key()&&d->pendingView["period"]==d->timeframe())for(auto key:{"visibleCount","endIndex","timeAnchors"})state[key]=d->pendingView.value(key);return state;}
void GlobalMarketPage::restoreState(const QJsonObject& state){globalMarket::definition(state["key"].toString());if(state["schema"]!="native-global-market-ui/v1"||!QStringList{"daily","intraday"}.contains(state["period"].toString()))throw std::runtime_error("全球页面状态格式不支持");d->stop();d->rendering=true;d->instrument->setCurrentIndex(d->instrument->findData(state["key"].toString()));d->period->setCurrentIndex(d->period->findData(state["period"].toString()));d->automatic->setChecked(state["automatic"].toBool(true));d->rendering=false;d->pendingView=state;d->render(true);d->status->setPlainText("所选标的和图表位置已恢复");if(d->needsRead||!d->cache)d->requestRead();else d->schedule(true);}
void GlobalMarketPage::hideEvent(QHideEvent* e){d->stop();QWidget::hideEvent(e);}
void GlobalMarketPage::showEvent(QShowEvent* e){QWidget::showEvent(e);d->resume();}
