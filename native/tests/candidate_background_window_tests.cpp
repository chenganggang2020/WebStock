#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "local_candidate_page.hpp"
class CandidateBackgroundWindowTests:public QObject {
 Q_OBJECT
private slots:
 void actualHost(){
  QTemporaryDir dir;Window w(true,dir.filePath("settings.ini"),dir.path());w.resize(1600,1000);w.show();
  QFile input(qEnvironmentVariable("NATIVE_CANDIDATE_FIXTURE"));QVERIFY(input.open(QIODevice::ReadOnly));w.instruments=QJsonDocument::fromJson(input.readAll()).array();QCOMPARE(w.instruments.size(),1);
  w.localCandidateView();auto*p=w.pages.value("localCandidates")->findChild<LocalCandidatePage*>();QVERIFY(p);QVERIFY(p->isVisible());
  auto click=[&](const char*key){auto*b=p->findChild<QPushButton*>(key);if(!b||!b->isEnabled())throw std::runtime_error(key);b->click();};
  auto*mode=p->findChild<QComboBox*>("candidateBackgroundMode");QCOMPARE(mode->currentIndex(),0);click("candidateChooseVisible");click("candidateCalculate");QTRY_VERIFY_WITH_TIMEOUT(!p->saveState()["draftHash"].toString().isEmpty(),10000);auto v1=p->saveState();
  mode->setCurrentIndex(1);click("candidateCalculate");QVERIFY(p->saveState()["draftHash"].toString().isEmpty());QVERIFY(p->findChild<QLabel*>("candidateState")->text().contains("账户"));
  click("candidateBackgroundAccounts");QTRY_VERIFY_WITH_TIMEOUT(p->findChild<QListWidget*>("candidateBackgroundAccountChoices"),5000);auto*choices=p->findChild<QListWidget*>("candidateBackgroundAccountChoices");QCOMPARE(choices->count(),1);QCOMPARE(choices->item(0)->checkState(),Qt::Unchecked);QVERIFY(!QApplication::activeModalWidget());
  choices->item(0)->setCheckState(Qt::Checked);click("candidateBackgroundAccountApply");QCOMPARE(p->saveState()["backgroundAccounts"].toArray().size(),1);click("candidateCalculate");QTRY_VERIFY_WITH_TIMEOUT(!p->saveState()["draftHash"].toString().isEmpty(),10000);
  QString folder=QFileInfo(w.businessStore->filePath()).absolutePath();candidateBackgroundHost::Host store({w.businessStore->filePath(),folder+"/recent-v1.sqlite",folder+"/sector-leaders-v1.sqlite",folder+"/local-candidate-background-v2.sqlite"});auto bundle=store.readDraft(p->saveState()["draftHash"].toString());QCOMPARE(bundle["result"].toObject()["model"].toString(),QString("native-local-candidates/v2-background"));
  p->findChild<QLineEdit*>("candidateTitle")->setText("本机背景操作验证");click("candidateSave");QTRY_VERIFY_WITH_TIMEOUT(!p->saveState()["namedId"].toString().isEmpty(),10000);auto saved=p->saveState();QCOMPARE(store.list().size(),1);
  p->findChild<QTableWidget*>("candidateResults")->selectRow(0);QVERIFY(p->findChild<QPlainTextEdit*>()->toPlainText().contains("来源"));
  for(QString layout:{"quotes","classic","focus"}){w.setLayoutMode(layout);w.localCandidateView();QVERIFY(p->isVisible());QCOMPARE(p->saveState()["namedId"],saved["namedId"]);QTest::qWait(50);if(!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v39-candidate-"+layout+".png"));}
  click("candidateBackgroundAccounts");QTRY_VERIFY_WITH_TIMEOUT(p->findChild<QWidget*>("candidateBackgroundAccountPanel"),5000);QVERIFY(w.closeInternalReader());QVERIFY(p->isVisible());QVERIFY(!w.closeInternalReader());QCOMPARE(store.list().size(),1);
  w.home();w.localCandidateView();p->restoreState(saved);QTRY_COMPARE_WITH_TIMEOUT(p->findChild<QTableWidget*>("candidateResults")->rowCount(),1,10000);QCOMPARE(p->saveState()["namedId"],saved["namedId"]);
  p->restoreState(v1);QTRY_COMPARE_WITH_TIMEOUT(mode->currentIndex(),0,5000);QTRY_COMPARE_WITH_TIMEOUT(p->findChild<QTableWidget*>("candidateResults")->rowCount(),1,10000);QCOMPARE(p->saveState()["draftHash"],v1["draftHash"]);w.home();
 }
};
QTEST_MAIN(CandidateBackgroundWindowTests)
#include "candidate_background_window_tests.moc"
