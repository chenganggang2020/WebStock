#include "global_market_page.hpp"
#include "appearance.hpp"
#include "fixtures.hpp"
#include "font_preflight.hpp"
#include <QtTest>
#include <QtWidgets>
#include <algorithm>
#include <functional>

namespace {
struct Failure:std::runtime_error {bool invariant;Failure(QString text,bool inv):std::runtime_error(text.toUtf8().constData()),invariant(inv){}};
void need(bool ok,QString text,bool invariant=true){if(!ok)throw Failure(text,invariant);}
bool until(const std::function<bool()>& predicate){
 if(predicate())return true;QEventLoop loop;QTimer poll,deadline;bool met=false;poll.setInterval(1);deadline.setSingleShot(true);
 QObject::connect(&poll,&QTimer::timeout,&loop,[&]{if(predicate()){met=true;loop.quit();}});QObject::connect(&deadline,&QTimer::timeout,&loop,&QEventLoop::quit);poll.start();deadline.start(10000);loop.exec();return met;
}
void quiet(){QEventLoop loop;QTimer::singleShot(20,&loop,&QEventLoop::quit);loop.exec();}
struct Paint {QString input,phase;qint64 start=0,end=0;int visible=0,last=0;QSize size;};
struct Beat {QString input,phase;qint64 at=0,gap=0;};
struct Trace {
 QElapsedTimer clock;QTimer heartbeat;QPointer<QWidget> plot;QString input,phase;int fullCount=0;bool active=false;qint64 lastBeat=0;QList<Paint> paints;QList<Beat> beats;
 Trace(){clock.start();paints.reserve(256);beats.reserve(10000);heartbeat.setInterval(5);heartbeat.setTimerType(Qt::PreciseTimer);QObject::connect(&heartbeat,&QTimer::timeout,[this]{const auto at=clock.nsecsElapsed();if(active)beats.append({input,phase,at,at-lastBeat});lastBeat=at;});}
 void begin(QString name,QString label,QWidget* widget,int count){input=name;phase=label;plot=widget;fullCount=count;active=true;lastBeat=clock.nsecsElapsed();heartbeat.start();}
 void end(){active=false;heartbeat.stop();}
};
class PaintApplication final:public QApplication {
public:
 Trace* trace=nullptr;
 using QApplication::QApplication;
 bool notify(QObject* receiver,QEvent* event)override{
  const bool watch=QThread::currentThread()==thread()&&trace&&trace->active&&receiver==trace->plot&&event->type()==QEvent::Paint;
  const auto begin=watch?trace->clock.nsecsElapsed():0;
  const bool handled=QApplication::notify(receiver,event);
  if(watch){const auto end=trace->clock.nsecsElapsed();auto* widget=trace->plot.data();trace->paints.append({trace->input,trace->phase,begin,end,widget->property("visibleCount").toInt(),widget->property("endIndex").toInt(),widget->size()});}
  return handled;
 }
};
QJsonObject stats(QList<qint64> values){
 if(values.isEmpty())return {{"samples",0},{"minMs",QJsonValue::Null},{"medianMs",QJsonValue::Null},{"maxMs",QJsonValue::Null}};
 std::sort(values.begin(),values.end());const int n=values.size();const double median=n%2?values[n/2]:(double(values[n/2-1])+values[n/2])/2.;return {{"samples",n},{"minMs",values.first()/1e6},{"medianMs",median/1e6},{"maxMs",values.last()/1e6}};
}
QPoint at(QWidget* plot,double fraction){return {qRound(75+(plot->width()-95)*fraction),qRound(38+(plot->height()-108)*.4)};}
void mouse(QWidget* plot,QEvent::Type type,QPoint point,Qt::MouseButton button,Qt::MouseButtons buttons){QMouseEvent event(type,QPointF(point),QPointF(plot->mapToGlobal(point)),button,buttons,Qt::NoModifier);QApplication::sendEvent(plot,&event);}
void click(QWidget* plot,double fraction){auto point=at(plot,fraction);mouse(plot,QEvent::MouseButtonPress,point,Qt::LeftButton,Qt::LeftButton);mouse(plot,QEvent::MouseButtonRelease,point,Qt::LeftButton,Qt::NoButton);}
void wheel(QWidget* plot){auto point=at(plot,.5);QWheelEvent event(QPointF(point),QPointF(plot->mapToGlobal(point)),{},QPoint(0,120),Qt::NoButton,Qt::NoModifier,Qt::NoScrollPhase,false);QApplication::sendEvent(plot,&event);}
QJsonObject series(GlobalMarketPage& page){return page.sourceEvidence()["series"].toObject();}
QJsonObject frame(QWidget* widget){const auto r=widget->geometry();return {{"x",r.x()},{"y",r.y()},{"w",r.width()},{"h",r.height()}};}
}

class PaintChecks final:public QObject {
 Q_OBJECT
 Trace& trace;QString output;QJsonArray cases;QJsonObject fontPins,fontProof;
 QJsonObject phase(const fixture::Data& data,QWidget* plot,QString label,const std::function<void()>& action,const std::function<bool()>& prerequisite={}){
  const int firstPaint=trace.paints.size(),firstBeat=trace.beats.size();trace.begin(data.name,label,plot,data.count);const auto begin=trace.clock.nsecsElapsed();qint64 actionEnd=begin;
  try{action();actionEnd=trace.clock.nsecsElapsed();need(until([&]{return trace.paints.size()>firstPaint&&(!prerequisite||prerequisite());}),"actual Paint/readiness prerequisite not established: "+label,false);quiet();}catch(...){trace.end();throw;}
  const auto end=trace.clock.nsecsElapsed();trace.end();QList<qint64> paints,beats;for(int i=firstPaint;i<trace.paints.size();++i)paints.append(trace.paints[i].end-trace.paints[i].start);for(int i=firstBeat;i<trace.beats.size();++i)beats.append(trace.beats[i].gap);
  // Capture only after timing stops; never include screenshot work in latency samples.
  need(QDir().mkpath(output+"/phase-shots"),"phase screenshot directory",false);
  need(plot->grab().save(output+"/phase-shots/"+data.name+"-"+label+".png"),"phase screenshot save",false);
  return {{"phase",label},{"beginNs",double(begin)},{"endNs",double(end)},{"actionWallMs",(actionEnd-begin)/1e6},{"phaseWallMs",(end-begin)/1e6},{"paint",stats(paints)},{"heartbeatGap",stats(beats)},{"firstPaintIndex",firstPaint},{"paintCount",paints.size()},{"firstHeartbeatIndex",firstBeat},{"heartbeatCount",beats.size()},{"geometry",frame(plot)},{"visible",plot->property("visibleCount").toInt()},{"endIndex",plot->property("endIndex").toInt()},{"settleMs",20}};
 }
 void run(QString name,QJsonObject& record){
  auto data=fixture::make(name);const auto inputDir=output+"/inputs";need(QDir().mkpath(inputDir),"cannot create retained input directory",false);const auto retained=inputDir+"/"+name+".json";fixture::write(retained,data.bytes);
  QTemporaryDir temp(output+"/temp-"+name+"-XXXXXX");need(temp.isValid(),"temporary cache directory unavailable",false);const auto cacheFile=temp.path()+"/global-market-native-v1.json";fixture::write(cacheFile,data.bytes);
  record={{"input",name},{"period",data.period},{"fullCount",data.count},{"nullCloses",data.nulls},{"zeroVolumes",data.zeroVolumes},{"inputBytes",data.bytes.size()},{"inputSha256",fixture::hash(data.bytes)},{"retainedInput",retained},{"synthetic",true},{"nativeCacheModelValidated",true},{"note",data.period=="intraday"?"30000 cache-valid synthetic minute points span multiple dates; not a real single-session/provider dataset":"synthetic dated cache, including calendar days; not actual provider trading history"}};
  fixture::Network network;GlobalMarketPage page(temp.path(),false,nullptr,&network);page.setProperty("stockTheme","graphite");page.setPalette(appearance::palette(appearance::theme("graphite")));page.resize(1100,760);
  auto* instrument=page.findChild<QComboBox*>("globalInstrument");auto* period=page.findChild<QComboBox*>("globalPeriod");auto* range=page.findChild<QComboBox*>("globalHistoryRange");auto* plot=page.findChild<QWidget*>("globalPlot");auto* cancel=page.findChild<QPushButton*>("globalCancel");auto* reset=page.findChild<QPushButton*>("globalResetZoom");
  need(instrument&&period&&range&&plot&&cancel&&reset,"real page controls missing",false);instrument->setCurrentIndex(instrument->findData(data.key));period->setCurrentIndex(period->findData(data.period));page.findChild<QCheckBox*>("globalAutomatic")->setChecked(false);
  QJsonArray phases;auto add=[&](QString label,const std::function<void()>& action,const std::function<bool()>& ready=std::function<bool()>{}){phases.append(phase(data,plot,label,action,ready));record["phases"]=phases;};
  const int startupPaint=trace.paints.size();add("startup-load-adopt-first-paints",[&]{page.show();},[&]{return !cancel->isEnabled()&&plot->property("visibleCount").toInt()>0&&std::any_of(trace.paints.begin()+startupPaint,trace.paints.end(),[](const Paint& p){return p.visible>0;});});
  need(plot->isVisible()&&plot->width()>200&&plot->height()>200,"plot not visibly laid out",false);
  const auto first=series(page);const auto field=data.period=="daily"?"candles":"points";need(first[field].toArray().size()==data.count,"full input row count changed during load");need(first==data.series,"real cache normalization changed retained expected data");
  const auto contentHash=fixture::hash(QJsonDocument(first).toJson(QJsonDocument::Compact));const auto geometry=frame(plot);record["defaultView"]=page.saveState();record["plotGeometry"]=geometry;record["devicePixelRatio"]=plot->devicePixelRatioF();record["logicalDpiX"]=plot->logicalDpiX();record["logicalDpiY"]=plot->logicalDpiY();record["normalizedSeriesSha256"]=contentHash;
  QJsonObject actualFont;fontCheck::describe(plot->font(),fontPins,actualFont);record["actualPlotFont"]=actualFont;QJsonObject slotGeometry;for(const auto& name:QStringList{"globalQuote","globalPoint","globalStatus","globalHistoryRange","globalRefresh","globalInstrument","globalPeriod","globalBack","globalCatalog","globalPlot"}){auto* widget=page.findChild<QWidget*>(name);need(widget,"font geometry control missing: "+name,false);slotGeometry[name]=fontCheck::geometry(widget,&page);}record["fontLayoutGeometry"]=slotGeometry;
  add("stable-default-1",[&]{plot->update();});add("stable-default-2",[&]{plot->update();});
  add("select-all-history",[&]{range->setCurrentIndex(range->findData(0));});need(plot->property("visibleCount").toInt()==data.count,"all-history control did not expose complete input");
  add("stable-full-1",[&]{plot->update();});add("stable-full-2",[&]{plot->update();});
  need(QDir().mkpath(output+"/screenshots"),"cannot create screenshot directory",false);const auto screen=output+"/screenshots/"+name+"-full.png";need(plot->grab().save(screen),"cannot retain actual plot screenshot",false);record["fullScreenshot"]=screen;
  const auto pageScreen=output+"/screenshots/"+name+"-page.png";need(page.grab().save(pageScreen),"cannot retain full font layout screenshot",false);record["fullPageScreenshot"]=pageScreen;
  if(data.period=="daily"){
   for(int i=0;i<3;++i)add("full-click-readout-"+QString::number(i),[&,i]{click(plot,.2+.3*i);});
   add("select-one-year",[&]{range->setCurrentIndex(range->findData(1));});record["oneYearView"]=page.saveState();
   add("return-all-history",[&]{range->setCurrentIndex(range->findData(0));});
  }else{
   add("full-readout-press",[&]{mouse(plot,QEvent::MouseButtonPress,at(plot,.2),Qt::LeftButton,Qt::LeftButton);});
   for(int i=0;i<4;++i)add("full-readout-move-"+QString::number(i),[&,i]{mouse(plot,QEvent::MouseMove,at(plot,.3+.15*i),Qt::NoButton,Qt::LeftButton);});
   add("full-readout-release",[&]{mouse(plot,QEvent::MouseButtonRelease,at(plot,.75),Qt::LeftButton,Qt::NoButton);});
   need(page.saveState()["timeAnchors"].toObject()["selected"].isDouble(),"minute drag lost selected time identity");
   // Read within the deliberately wide retained null interval, using normal input events.
   add("full-null-gap-readout",[&]{click(plot,12500.5/data.count);});
   need(page.findChild<QLabel*>("globalPoint")->text().contains("未取得"),"null gap readout is no longer missing");
  }
  // Own the value rather than a QJsonValueRef into a temporary object.
  const QJsonValue selectedBefore=page.saveState()["timeAnchors"].toObject()["selected"];record["selectedAfterFullReadout"]=selectedBefore;
  add("wheel-zoom",[&]{wheel(plot);});need(plot->property("visibleCount").toInt()<data.count,"wheel did not change actual viewport");record["zoomedView"]=page.saveState();
  add("zoomed-pan",[&]{mouse(plot,QEvent::MouseButtonPress,at(plot,.5),Qt::LeftButton,Qt::LeftButton);mouse(plot,QEvent::MouseMove,at(plot,.7),Qt::NoButton,Qt::LeftButton);mouse(plot,QEvent::MouseButtonRelease,at(plot,.7),Qt::LeftButton,Qt::NoButton);});record["pannedView"]=page.saveState();
  need(record["zoomedView"].toObject()["endIndex"]!=record["pannedView"].toObject()["endIndex"],"zoomed normal drag did not move historical range");
  const auto view=page.saveState();page.restoreState(view);need(until([&]{return page.saveState()["timeAnchors"]==view["timeAnchors"];}),"public restore changed saved time anchors");quiet();
  need(page.saveState()["timeAnchors"]==view["timeAnchors"],"time anchors changed after restoration settled");
  add("reset-zoom",[&]{reset->click();});need(!page.saveState()["timeAnchors"].toObject()["anchored"].toBool(),"explicit reset did not clear anchored view");
  need(frame(plot)==geometry,"plot geometry changed with readout/range");need(network.calls==0,"baseline unexpectedly attempted network");need(fixture::read(cacheFile)==data.bytes,"offline page modified native cache bytes");need(series(page)==first,"view operations changed complete source data");
  const auto actualRows=series(page)[field].toArray();int nulls=0,zeros=0;for(auto v:actualRows){const auto row=v.toObject();if(row["close"].isNull())++nulls;if(row["volume"].isDouble()&&row["volume"].toDouble()==0)++zeros;}
  need(nulls==data.nulls&&zeros==data.zeroVolumes,"null gaps/explicit zero volume changed");record["finalSeriesSha256"]=fixture::hash(QJsonDocument(series(page)).toJson(QJsonDocument::Compact));need(record["finalSeriesSha256"]==contentHash,"full source hash changed");record["finalView"]=page.saveState();record["networkRequests"]=network.calls;record["cacheBytesUnchanged"]=true;record["fullRowsIdentityGapsZeroAndTimeAnchorsPreserved"]=true;record["status"]="MEASURED_INVARIANTS_OK_NO_PERFORMANCE_BUDGET";
 }
private slots:
 void baseline_data(){QTest::addColumn<QString>("name");QTest::newRow("small-64")<<QString("daily64");QTest::newRow("long-50000")<<QString("daily50000");QTest::newRow("minute-null-30000")<<QString("minute30000");}
 void baseline(){QFETCH(QString,name);QJsonObject record;try{run(name,record);cases.append(record);}catch(const Failure& e){trace.end();record["input"]=name;record["status"]=e.invariant?"INVARIANT_FAILURE":"INFRASTRUCTURE_FAILURE";record["error"]=QString::fromUtf8(e.what());record["lastPhase"]=trace.phase;cases.append(record);QFAIL(e.what());}catch(const std::exception& e){trace.end();record["input"]=name;record["status"]="INFRASTRUCTURE_FAILURE";record["error"]=QString::fromUtf8(e.what());cases.append(record);QFAIL(e.what());}}
 void cleanupTestCase(){
  QJsonArray paints,beats;for(const auto& p:trace.paints)paints.append(QJsonObject{{"input",p.input},{"phase",p.phase},{"startNs",double(p.start)},{"endNs",double(p.end)},{"durationNs",double(p.end-p.start)},{"visible",p.visible},{"endIndex",p.last},{"width",p.size.width()},{"height",p.size.height()}});for(const auto& b:trace.beats)beats.append(QJsonObject{{"input",b.input},{"phase",b.phase},{"atNs",double(b.at)},{"gapNs",double(b.gap)}});
  bool complete=cases.size()==3;for(auto v:cases)complete&=v.toObject()["status"]=="MEASURED_INVARIANTS_OK_NO_PERFORMANCE_BUDGET";
  const QJsonObject report{{"schema","r05-paint09-baseline/v1"},{"status",complete?"MEASURED_INVARIANTS_OK_NO_PERFORMANCE_BUDGET":"INCOMPLETE_OR_FAILED_BASELINE_NOT_PERFORMANCE_RED"},{"performanceBudget",QJsonValue::Null},{"performanceVerdict","NOT_DEFINED"},{"qt",qVersion()},{"platform",QApplication::platformName()},{"fontFamily",QFontInfo(qApp->font()).family()},{"fontPointSize",qApp->font().pointSizeF()},{"theme","graphite"},{"windowWidth",1100},{"windowHeight",760},{"heartbeatIntervalMs",5},{"readinessPollMs",1},{"readinessDeadlineMs",10000},{"readinessTimeoutMeaning","infrastructure only, not paint performance budget"},{"processId",double(QCoreApplication::applicationPid())},{"createdAtUtc",QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},{"cases",cases},{"rawSamples","raw-samples.json"},{"observer","QApplication::notify calls original handler exactly once; before/after actual globalPlot Paint only"},{"instrumentationLimits","heartbeat includes small observer/timer overhead; 20ms settle in each phase; probe JSON and screenshots excluded; one offscreen process, no performance acceptance/installed UI claim"}};
  auto withFont=report;withFont["schema"]="r05-font10-baseline/v1";withFont["fontPreflight"]=fontProof;withFont["fixedOriginalInputs"]=true;fixture::write(output+"/raw-samples.json",QJsonDocument(QJsonObject{{"paints",paints},{"heartbeats",beats}}).toJson(QJsonDocument::Indented));fixture::write(output+"/report.json",QJsonDocument(withFont).toJson(QJsonDocument::Indented));
 }
public:
 explicit PaintChecks(Trace& t,QJsonObject pins,QJsonObject proof):trace(t),output(qEnvironmentVariable("D05_PAINT_OUTPUT")),fontPins(std::move(pins)),fontProof(std::move(proof)){fixture::need(!output.isEmpty()&&QDir(output).exists(),"runner output directory missing");}
};
int main(int argc,char** argv){PaintApplication app(argc,argv);QApplication::setStyle("Fusion");QJsonObject pins,proof;const auto output=qEnvironmentVariable("D05_PAINT_OUTPUT");try{pins=fontCheck::load();fontCheck::prepare(app,pins,proof);fixture::write(output+"/font-preflight.json",QJsonDocument(proof).toJson(QJsonDocument::Indented));}catch(const std::exception& e){proof["status"]="FONT_PREFLIGHT_INFRASTRUCTURE_FAILURE";proof["error"]=QString::fromUtf8(e.what());fixture::write(output+"/font-preflight.json",QJsonDocument(proof).toJson(QJsonDocument::Indented));return 2;}app.setPalette(appearance::palette(appearance::theme("graphite")));Trace trace;app.trace=&trace;PaintChecks checks(trace,pins,proof);const int code=QTest::qExec(&checks,argc,argv);app.trace=nullptr;return code;}
#include "paint_checks.moc"
