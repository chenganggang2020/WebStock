#include "window.hpp"
#include "appearance.hpp"
#include <QtTest>
#include <QtWidgets>

class NavigationChecks:public QObject {
 Q_OBJECT
private slots:
 void childViewsAndColors(){
  QTemporaryDir data;Window w(true,data.filePath("settings.ini"),data.path());
  w.resize(1560,980);w.show();QTest::qWait(150);
  auto out=qEnvironmentVariable("UI_STEP03_OUTPUT");QDir().mkpath(out);
  QVERIFY(w.grab().save(out+"/watchboard.png"));
  QVERIFY(!w.findChild<QPushButton*>("toggleQuoteDetails"));
  auto* gear=w.findChild<QPushButton*>("workbenchSettings");
  auto* details=w.findChild<QAction*>("showQuoteDetails");
  QVERIFY(gear->menu()->actions().contains(details));
  details->setChecked(false);QVERIFY(!w.findChild<QWidget*>("quoteDetails")->isVisible());
  details->setChecked(true);QVERIFY(w.findChild<QWidget*>("quoteDetails")->isVisible());
  const auto id=w.instrumentId();const auto count=w.chart->bars.size();const auto selected=w.chart->selected;
  auto stable=[&]{return w.instrumentId()==id&&w.chart->bars.size()==count&&w.chart->selected==selected;};
  auto* toolbar=w.findChild<QToolBar*>("navigationToolbar");
  QVERIFY(!toolbar->actions().contains(w.findChild<QAction*>("nav_publicPriceDetails")));
  auto* history=w.findChild<QPushButton*>("openPublicPriceDetails");
  QCOMPARE(history->text(),QString("历史报价记录"));history->click();QTest::qWait(60);
  auto* back=w.findChild<QPushButton*>("publicPriceBack");QVERIFY(back);QVERIFY(back->isVisible());
  QVERIFY(w.grab().save(out+"/history.png"));back->click();QVERIFY(w.chart->isVisible());QVERIFY(stable());
  history->click();QTest::keyClick(&w,Qt::Key_Escape);QVERIFY(w.chart->isVisible());QVERIFY(stable());
  auto* signal=w.findChild<QPushButton*>("signalDetails");QCOMPARE(signal->text(),QString("信号说明"));
  signal->click();QTest::qWait(60);auto* signalBack=w.findChild<QPushButton*>("signalBack");
  QVERIFY(signalBack);QVERIFY(signalBack->isVisible());
  QCOMPARE(w.findChild<QWidget*>("moduleNavigation")->property("workspace").toString(),QString("主页"));
  QVERIFY(w.grab().save(out+"/signal.png"));signalBack->click();QVERIFY(w.chart->isVisible());QVERIFY(stable());
  signal->click();QTest::keyClick(&w,Qt::Key_Escape);QVERIFY(w.chart->isVisible());QVERIFY(stable());
  for(auto id:{"navy","graphite"}){auto t=appearance::theme(id);QCOMPARE(t.up,QColor("#ff4040"));QCOMPARE(t.down,QColor("#00d060"));}
  w.close();QTRY_VERIFY(!w.isVisible());
 }
 void readableWatchVisibility(){
  QTemporaryDir data;Window w(true,data.filePath("settings.ini"),data.path());
  w.resize(1560,980);w.show();QTest::qWait(60);
  auto* manage=w.findChild<QPushButton*>("manage");QVERIFY(manage);manage->click();
  QPushButton* visibility=nullptr;
  for(auto* button:w.findChildren<QPushButton*>())if(button->text()=="添加 / 显示隐藏")visibility=button;
  QVERIFY(visibility);bool inspected=false,readable=true;int count=0;
  QTimer::singleShot(50,[&]{
   auto* dialog=qobject_cast<QDialog*>(QApplication::activeModalWidget());
   if(!dialog)return;
   inspected=true;
   for(auto* check:dialog->findChildren<QCheckBox*>()){
    ++count;readable=readable&&!check->text().contains(':')&&QRegularExpression(" [0-9]{6}$").match(check->text()).hasMatch();
   }
   dialog->reject();
  });
  visibility->click();QVERIFY(inspected);QVERIFY(count>0);QVERIFY(readable);
  w.close();QTRY_VERIFY(!w.isVisible());
 }
};
int main(int argc,char**argv){QApplication app(argc,argv);app.setQuitOnLastWindowClosed(false);QFontDatabase::addApplicationFont("C:/Windows/Fonts/msyh.ttc");app.setFont(QFont("Microsoft YaHei UI",10));QApplication::setStyle("Fusion");NavigationChecks checks;return QTest::qExec(&checks,argc,argv);}
#include "ui_step03_navigation_tests.moc"
