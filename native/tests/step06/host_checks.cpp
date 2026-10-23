#include "window.hpp"
#include "global_market_page.hpp"
#include "../step05/fixtures.hpp"
#include "../step05/font_preflight.hpp"
#include <QtTest>
#include <QtWidgets>
#include <QProcess>

namespace {
QString output(){return qEnvironmentVariable("STEP06_OUTPUT");}
bool until(std::function<bool()> predicate){QElapsedTimer t;t.start();while(!predicate()&&t.elapsed()<10000){QCoreApplication::processEvents(QEventLoop::AllEvents,2);QTest::qWait(1);}return predicate();}
void settle(){QTest::qWait(30);}
void seed(const QString& dir){auto day=fixture::make("daily64"),minute=fixture::make("minute30000");auto state=day.state;auto series=state["series"].toObject();series[minute.key+":intraday"]=minute.series;state["series"]=series;fixture::write(dir+"/global-market-native-v1.json",QJsonDocument(state).toJson());}
QAction* route(Window& w,const QString& key){for(auto* a:w.findChildren<QAction*>())if(a->data().toString()==key)return a;return nullptr;}
GlobalMarketPage* enter(Window& w){auto* a=route(w,"globalMarket");if(!a)return nullptr;a->trigger();settle();return w.findChild<GlobalMarketPage*>();}
bool ready(GlobalMarketPage* p){return p&&!p->sourceEvidence()["series"].toObject().isEmpty()&&!p->findChild<QPushButton*>("globalCancel")->isEnabled();}
void pick(GlobalMarketPage* p,const QString& period){p->findChild<QCheckBox*>("globalAutomatic")->setChecked(false);p->findChild<QComboBox*>("globalInstrument")->setCurrentIndex(p->findChild<QComboBox*>("globalInstrument")->findData("nasdaq-composite"));p->findChild<QComboBox*>("globalPeriod")->setCurrentIndex(p->findChild<QComboBox*>("globalPeriod")->findData(period));}
void inspect(GlobalMarketPage* p){auto* plot=p->findChild<QWidget*>("globalPlot");QTest::mouseClick(plot,Qt::LeftButton,Qt::NoModifier,QPoint(plot->width()/2,plot->height()/2));settle();}
void changeRange(GlobalMarketPage* p){auto* plot=p->findChild<QWidget*>("globalPlot");QPoint center(plot->width()/2,plot->height()/2);QWheelEvent wheel(center,plot->mapToGlobal(center),QPoint(),QPoint(0,120),Qt::NoButton,Qt::NoModifier,Qt::NoScrollPhase,false);QCoreApplication::sendEvent(plot,&wheel);QTest::mousePress(plot,Qt::LeftButton,Qt::NoModifier,center);QTest::mouseMove(plot,center+QPoint(80,0));QTest::mouseRelease(plot,Qt::LeftButton,Qt::NoModifier,center+QPoint(80,0));settle();}
bool shot(Window& w,const QString& name){settle();return w.grab().save(output()+"/"+name+".png");}
bool closeNormally(Window& w){w.close();return until([&]{return !w.isVisible();});}
QJsonObject snapshot(GlobalMarketPage* p){return {{"view",p->saveState()},{"readout",p->findChild<QLabel*>("globalPoint")->text()},{"seriesHash",fixture::hash(QJsonDocument(p->sourceEvidence()["series"].toObject()).toJson(QJsonDocument::Compact))}};}
int child(const QStringList& args){
 const auto mode=args[2],dir=args[3],period=args[4];Window w(true,dir+"/review.ini",dir);w.resize(1280,900);w.show();settle();auto* p=enter(w);if(!p)return 10;
 if(mode=="write")pick(p,period);
 if(!until([&]{return ready(p);}))return 11;
 if(mode=="write"){p->findChild<QComboBox*>("globalHistoryRange")->setCurrentIndex(4);changeRange(p);inspect(p);}
 auto actual=snapshot(p);fixture::write(output()+"/"+period+"-"+mode+".json",QJsonDocument(actual).toJson());if(!shot(w,period+"-"+mode))return 12;
 if(!closeNormally(w))return 13;
 if(mode=="read"){auto prior=QJsonDocument::fromJson(fixture::read(output()+"/"+period+"-write.json")).object();if(actual!=prior)return 14;}
 return 0;
}
}
class HostChecks:public QObject{
 Q_OBJECT
private slots:
 void navigation_data(){QTest::addColumn<QString>("period");QTest::newRow("daily")<<QString("daily");QTest::newRow("intraday")<<QString("intraday");}
 void navigation(){QFETCH(QString,period);QTemporaryDir dir;QVERIFY(dir.isValid());seed(dir.path());auto original=fixture::read(dir.filePath("global-market-native-v1.json"));Window w(true,dir.filePath("review.ini"),dir.path());w.resize(1280,900);w.show();settle();auto* p=enter(w);QVERIFY(p);pick(p,period);QVERIFY(until([&]{return ready(p);}));changeRange(p);inspect(p);auto before=snapshot(p);QVERIFY(before["view"].toObject()["visibleCount"].toInt()<(period=="daily"?64:30000));fixture::write(output()+"/"+period+"-navigation.json",QJsonDocument(before).toJson());QVERIFY(shot(w,period+"-before-return"));
  QTest::mouseClick(p->findChild<QPushButton*>("globalBack"),Qt::LeftButton);settle();QVERIFY(!p->isVisible());QVERIFY(w.findChild<QTabWidget*>("workspaceTabs")->currentWidget()!=p);QCOMPARE(enter(w),p);QVERIFY(ready(p));QVERIFY(shot(w,period+"-after-return"));QCOMPARE(snapshot(p),before);QVERIFY(route(w,"globalMarket")->isChecked());QVERIFY(closeNormally(w));QCOMPARE(fixture::read(dir.filePath("global-market-native-v1.json")),original);
 }
 void restart_data(){navigation_data();}
 void restart(){QFETCH(QString,period);QTemporaryDir dir;QVERIFY(dir.isValid());seed(dir.path());auto original=fixture::read(dir.filePath("global-market-native-v1.json"));for(auto mode:{"write","read"}){QProcess process;process.start(QCoreApplication::applicationFilePath(),{"--child",mode,dir.path(),period});QVERIFY(process.waitForStarted());QVERIFY(process.waitForFinished(30000));fixture::write(output()+"/"+period+"-"+mode+"-process.txt",process.readAllStandardOutput()+process.readAllStandardError());QCOMPARE(process.exitStatus(),QProcess::NormalExit);QCOMPARE(process.exitCode(),0);}QCOMPARE(fixture::read(dir.filePath("global-market-native-v1.json")),original);}
};
int main(int argc,char**argv){QApplication app(argc,argv);app.setQuitOnLastWindowClosed(false);QApplication::setStyle("Fusion");QJsonObject proof;try{fontCheck::prepare(app,fontCheck::load(),proof);if(app.arguments().contains("--child"))return child(app.arguments());HostChecks tests;return QTest::qExec(&tests,argc,argv);}catch(const std::exception& e){qCritical()<<e.what();return 20;}}
#include "host_checks.moc"
