#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "business_store.hpp"
#include "sector_research_page.hpp"
#include "sector_research_store.hpp"
namespace {
QPushButton* action(QWidget* p,const QString& text){for(auto* b:p->findChildren<QPushButton*>())if(b->text()==text)return b;throw std::runtime_error(("Missing button: "+text).toStdString());}
}
class MigrationV32SectorTests:public QObject {
 Q_OBJECT
private slots:
 void host(){try{for(QString layout:{QString("quotes"),QString("classic"),QString("focus")}){
  QTemporaryDir dir;BusinessStore business(dir.filePath("business-v1.sqlite"));
  auto topic=business.save("topics",{{"name","宿主受控产业主题"}});
  auto doc=business.save("docs",{{"title","宿主来源材料"},{"text","完整受控来源；不是真实行业结论。"}});
  const auto before=business.read("docs");
  Window w(true,dir.filePath("settings.ini"),dir.path());w.resize(1600,1000);w.show();w.setLayoutMode(layout);
  w.findChild<QPushButton*>("workspace研究")->click();auto* entry=w.findChild<QPushButton*>("researchOpenSectorResearch");
  QVERIFY2(entry,"Actual sector research host entry must exist");entry->click();
  auto* page=w.findChild<QWidget*>("sectorResearchPage");QVERIFY(page&&page->isVisible());
  QVERIFY(sectorResearchSelectScope(page,"industry","business:topics:"+topic["id"].toString()));
  auto* sources=page->findChild<QListWidget*>();QVERIFY(sources&&sources->count()==1);sources->item(0)->setSelected(true);
  auto* input=page->findChild<QPlainTextEdit*>("sectorResearchInput");input->setPlainText("人工补充材料");
  action(page,"冻结材料")->click();SectorResearchStore store(dir.filePath("business-v1.sqlite.sector-research.sqlite"));
  QString diagnostics;for(auto* label:page->findChildren<QLabel*>())diagnostics+=label->text()+"\n";
  QVERIFY2(store.list("packets").size()==1,qPrintable(diagnostics));auto packet=store.list("packets")[0].toObject();
  QCOMPARE(packet["scope"].toObject()["snapshot"].toObject(),topic);
  QCOMPARE(packet["documents"].toArray()[0].toObject()["snapshot"].toObject()["text"].toString(),doc["text"].toString());
  const auto reply=QJsonObject{{"schema","sector-research-return-v1"},{"packetId",packet["id"]},{"scopeId",packet["scope"].toObject()["id"]},{"report","宿主人工回填全文。未执行在线AI。"}};
  input->setPlainText(QString::fromUtf8(QJsonDocument(reply).toJson()));action(page,"预览回填")->click();
  QCOMPARE(store.list("results").size(),0);action(page,"确认保存")->click();QCOMPARE(store.list("results").size(),0);
  page->findChild<QCheckBox*>()->setChecked(true);action(page,"确认保存")->click();QCOMPARE(store.list("results").size(),1);
  QCOMPARE(store.list("results")[0].toObject()["verification"].toString(),QString("manual-unverified"));
  action(page,"人工回填")->click();bool full=false;for(auto* r:page->findChildren<QPlainTextEdit*>())if(r->isReadOnly()&&r->toPlainText().contains("宿主人工回填全文"))full=true;QVERIFY(full);
  QCOMPARE(business.read("docs"),before);SectorResearchStore copy(dir.filePath("copy.sqlite"));copy.merge(copy.preview(store.backup()));
  QCOMPARE(copy.list("results"),store.list("results"));QVERIFY(copy.state().value("input").toString().isEmpty());
  w.findChild<QPushButton*>("theme")->click();if(layout=="classic"&&!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v32-sector.png"));
  QTest::keyClick(&w,Qt::Key_Escape);QVERIFY(!page->isVisible());QCOMPARE(w.layoutMode(),layout);
  w.findChild<QPushButton*>("workspace研究")->click();entry->click();QVERIFY(page->isVisible());QCOMPARE(store.list("results").size(),1);
 }}catch(const std::exception&e){QFAIL(e.what());}}
};
QTEST_MAIN(MigrationV32SectorTests)
#include "migration_v32_sector_tests.moc"
