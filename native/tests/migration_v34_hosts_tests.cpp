#include <QtTest>
#include <QtWidgets>
#include "window.hpp"
#include "material_library_store.hpp"
#include "data_source_status_page.hpp"
namespace {
QPushButton* action(QWidget* p,QString title){for(auto* b:p->findChildren<QPushButton*>())if(b->text()==title)return b;return nullptr;}
QJsonObject stable(BusinessStore& s){auto b=s.backup();b.remove("createdAt");return b;}
}
class MigrationV34HostsTests:public QObject {
 Q_OBJECT
private slots:
 void host(){try{for(QString layout:{QString("quotes"),QString("classic"),QString("focus")}){
  QTemporaryDir dir;Window w(true,dir.filePath("settings.ini"),dir.path());w.resize(1600,1000);w.show();w.setLayoutMode(layout);
  BusinessStore business(dir.filePath("business-v1.sqlite"));
  business.save("docs",{{"title","资料宿主原文"},{"text",QString("完整长原文。").repeated(3000)},{"originalText","原始文字保持"}});
  const auto before=stable(business);
  w.findChild<QPushButton*>("workspace研究")->click();
  auto* library=w.findChild<QPushButton*>("researchOpenLibrary");QVERIFY(library);library->click();
  auto* page=w.findChild<QWidget*>("materialLibraryPage");QVERIFY(page&&page->isVisible());
  auto* search=page->findChild<QLineEdit*>("materialLibrarySearch");auto* list=page->findChild<QListWidget*>("materialLibraryRows");
  QVERIFY(search&&list);search->setText("资料宿主原文");QCOMPARE(list->count(),1);list->setCurrentRow(0);
  action(page,"完整原文/分类")->click();auto* body=page->findChild<QPlainTextEdit*>("materialLibraryBody");
  QVERIFY(body->isVisible()&&body->toPlainText().contains("原始文字保持"));
  page->findChild<QLineEdit*>("materialLibraryCategory")->setText("人工观察");
  page->findChild<QPlainTextEdit*>("materialLibraryNotes")->setPlainText("实际保存笔记");
  action(page,"保存人工分类")->click();
  MaterialLibraryStore side(dir.filePath("material-library-v1.sqlite"));QCOMPARE(side.history().size(),1);
  QCOMPARE(stable(business),before);
  page->findChild<QPlainTextEdit*>("materialLibraryNotes")->setPlainText("未保存修改");action(page,"放弃未保存分类")->click();
  QCOMPARE(page->findChild<QPlainTextEdit*>("materialLibraryNotes")->toPlainText(),QString("实际保存笔记"));
  QTest::keyClick(&w,Qt::Key_Escape);QVERIFY(page->isVisible());QTest::keyClick(&w,Qt::Key_Escape);QVERIFY(!page->isVisible());QCOMPARE(w.layoutMode(),layout);
  // Isolated in-memory source evidence only; it is not real-provider acceptance.
  auto item=w.instruments[0].toObject();const QString id=item["id"].toString();
  item["quote"]=QJsonObject{{"source","新浪公开报价"},{"price",10},{"tradeDate","2026-10-12"},{"tradeTime","14:00:00"},{"checkedAt","2026-10-12T06:00:05Z"},{"cached",true}};w.instruments[0]=item;
  w.findChild<QPushButton*>("workspace设置")->click();auto* source=w.findChild<QPushButton*>("settingsOpenSources");QVERIFY(source);source->click();
  auto* status=qobject_cast<DataSourceStatusPage*>(w.findChild<QWidget*>("dataSourceStatusPage"));QVERIFY(status&&status->isVisible());
  const auto evidence=QJsonDocument::fromJson(status->exportEvidence()).object()["records"].toArray();QVERIFY(!evidence.isEmpty());
  const auto record=evidence[0].toObject();QCOMPARE(record["authorization"].toString(),QString("unknown"));QVERIFY(record["sourceTime"]!=record["fetchedAt"]);
  auto bad=dataSourceStatus::navigation(record);bad["id"]="SH:stock:999999";bool refused=false;
  try{w.openDataSourceTarget("detail",bad);}catch(...){refused=true;}QVERIFY(refused);QVERIFY(status->isVisible());
  status->findChild<QPushButton*>("dataSourceFilters")->click();QCoreApplication::processEvents();
  auto* field=status->findChild<QLineEdit*>("dataSourceSearch");QVERIFY(field&&field->isVisible());
  QVERIFY(field->parentWidget()->rect().contains(field->geometry()));
  status->findChild<QPushButton*>("dataSourceFilters")->click();
  if(layout=="classic"&&!qEnvironmentVariable("NATIVE_QA_OUTPUT").isEmpty())QVERIFY(w.grab().save(qEnvironmentVariable("NATIVE_QA_OUTPUT")+"/qt-v34-sources.png"));
  status->findChild<QPushButton*>("dataSourceOpen")->click();QCOMPARE(w.instrumentId(),id);QVERIFY(!status->isVisible());QVERIFY(!w.sourceEvidenceNavigation);
  w.findChild<QPushButton*>("workspace设置")->click();source->click();w.findChild<QPushButton*>("theme")->click();QTest::keyClick(&w,Qt::Key_Escape);
  QVERIFY(!status->isVisible());QCOMPARE(w.layoutMode(),layout);QCOMPARE(stable(business),before);
 }}catch(const std::exception& e){QFAIL(e.what());}}
};
QTEST_MAIN(MigrationV34HostsTests)
#include "migration_v34_hosts_tests.moc"
