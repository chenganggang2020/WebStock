#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "evidence_review_store.hpp"
#include "news_feed.hpp"
#include <QNetworkReply>
class HeldNewsReply : public QNetworkReply {
public:HeldNewsReply(const QNetworkRequest& r,QObject* parent):QNetworkReply(parent){setRequest(r);setUrl(r.url());open(QIODevice::ReadOnly);}
 void abort()override{} qint64 readData(char*,qint64)override{return -1;}
};
class HeldNewsNetwork : public QNetworkAccessManager {
 QNetworkReply* createRequest(Operation,const QNetworkRequest& r,QIODevice*)override{return new HeldNewsReply(r,this);}
};
class MigrationV30EvidenceTests : public QObject {
 Q_OBJECT
 static QPushButton* find(QWidget* page,const QString& label) {
  for(auto* b:page->findChildren<QPushButton*>())if(b->text()==label)return b;
  return nullptr;
 }
private slots:
 void cancelledAnnouncementCannotFinishNewRequest() {
  HeldNewsNetwork transport;publicNews::Feed feed(nullptr,&transport);
  QSignalSpy finished(&feed,&publicNews::Feed::finished);
  QVERIFY(feed.start(publicNews::query("announcement",7,1)));feed.cancel();
  QVERIFY(feed.start(publicNews::query("market",7,1)));
  QTest::qWait(15);QVERIFY(feed.busy());QCOMPARE(finished.count(),0);
  feed.cancel();QVERIFY(!feed.busy());
  QVERIFY(feed.start(publicNews::query("announcement",7,1)));
  QTRY_COMPARE(finished.count(),1);QVERIFY(!feed.busy());
 }
 void evidenceHostedThreeLayouts() {
  for(const QString layout:{QString("quotes"),QString("classic"),QString("focus")}) {
   QTemporaryDir dir;const auto settingsFile=dir.filePath("settings.ini");
   QSettings settings(settingsFile,QSettings::IniFormat);settings.setValue("watch/SZ:stock:000001",false);settings.sync();
   Window w(true,settingsFile,dir.path());w.resize(1600,1000);w.show();w.setLayoutMode(layout);
   w.findChild<QPushButton*>("workspace研究")->click();
   auto* entry=w.findChild<QPushButton*>("researchOpenEvidence");QVERIFY(entry&&entry->isVisible());entry->click();
   auto* p=w.findChild<QWidget*>("evidenceReviewPage");QVERIFY(p&&p->isVisible());
   const QByteArray raw=R"({"title":"主机引用复核","report":"完整报告正文。末尾保留。","candidates":[{"instrumentId":"SZ:stock:000001","name":"平安银行","reason":"受控理由","risk":"仅为检查"}]})";
   auto* input=p->findChild<QPlainTextEdit*>("evidenceReviewInput");input->setPlainText(QString::fromUtf8(raw));
   find(p,"预览粘贴材料（尚未合并）")->click();
   EvidenceReviewStore store(dir.filePath("business-v1.sqlite.evidence-review.sqlite"));
   QVERIFY(store.list("reports").isEmpty());
   QVERIFY(p->findChild<QPlainTextEdit*>("evidenceReviewPreview")->toPlainText().contains("末尾保留"));
   find(p,"明确合并报告 / 恢复已确认备份")->click();QCOMPARE(store.list("reports").size(),1);
   auto* tabs=p->findChild<QTabWidget*>();tabs->setCurrentIndex(1);
   auto* reports=p->findChild<QComboBox*>("evidenceReviewReports");QCOMPARE(reports->count(),1);
   reports->setCurrentIndex(0);QMetaObject::invokeMethod(reports,"activated",Q_ARG(int,0));
   auto* rows=p->findChild<QListWidget*>("evidenceReviewCandidates");QCOMPARE(rows->count(),1);rows->setCurrentRow(0);
   find(p,"明确选择这一行候选")->click();
   find(p,"确认所选候选并保存独立历史")->click();QVERIFY(store.list("batches").isEmpty());
   p->findChild<QCheckBox*>("evidenceReviewAcknowledged")->setChecked(true);
   find(p,"确认所选候选并保存独立历史")->click();QCOMPARE(store.list("batches").size(),1);
   settings.sync();QVERIFY(!settings.value("watch/SZ:stock:000001").toBool());
   find(p,"阅读完整报告、提示词和原记录")->click();
   auto* reader=p->findChild<QPlainTextEdit*>("evidenceReviewFullReader");QVERIFY(reader->isVisible());QVERIFY(reader->toPlainText().contains("末尾保留"));
   w.findChild<QPushButton*>("workspace主页")->click();QVERIFY(p->isVisible());QVERIFY(!reader->isVisible());
   QCOMPARE(input->toPlainText(),QString::fromUtf8(raw));
   tabs->setCurrentIndex(2);auto* history=tabs->widget(2)->findChild<QListWidget*>();QCOMPARE(history->count(),1);history->setCurrentRow(0);
   find(p,"完整历史 / 手动打开K线或加入自选")->click();
   find(p,"明确加入自选 · 平安银行 SZ:stock:000001")->click();settings.sync();QVERIFY(settings.value("watch/SZ:stock:000001").toBool());
   QVERIFY(p->isVisible());w.findChild<QPushButton*>("theme")->click();QVERIFY(reader->isVisible());
   find(p,"打开K线 · 平安银行 SZ:stock:000001")->click();
   QCOMPARE(w.instrumentId(),QString("SZ:stock:000001"));QVERIFY(!p->isVisible());
   QCOMPARE(w.layoutMode(),layout=="quotes"?QString("focus"):layout);
   w.findChild<QPushButton*>("workspace研究")->click();entry->click();QTest::keyClick(&w,Qt::Key_Escape);QVERIFY(p->isVisible());QVERIFY(!reader->isVisible());
   QTest::keyClick(&w,Qt::Key_Escape);QVERIFY(!p->isVisible());
   QCOMPARE(store.list("batches").size(),1);
  }
 }
};
QTEST_MAIN(MigrationV30EvidenceTests)
#include "migration_v30_evidence_tests.moc"
