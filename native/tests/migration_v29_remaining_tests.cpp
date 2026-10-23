#include <QtTest>
#include <QtWidgets>
#include <QTemporaryDir>
#include "window.hpp"
#include "news_page.hpp"
#include "comment_workshop_page.hpp"
#include "comment_workshop_store.hpp"
class MigrationV29RemainingTests:public QObject {
 Q_OBJECT
 static QPushButton* textButton(QWidget* root,QString text) {
  for(auto* b:root->findChildren<QPushButton*>())if(b->text()==text&&b->isVisible())return b;
  return nullptr;
 }
private slots:
 void newsHostImportSaveReopen() {
  QTemporaryDir dir;Window window(true,dir.filePath("settings.ini"),dir.path());
  window.resize(1600,1000);window.show();
  const auto id=window.instrumentId();
  for(const QString mode:{QString("quotes"),QString("classic"),QString("focus")}) {
   window.setLayoutMode(mode);window.findChild<QPushButton*>("workspace研究")->click();
   window.findChild<QPushButton*>("researchOpenNews")->click();
   auto* p=window.findChild<NewsPage*>("newsPage");QVERIFY(p&&p->isVisible());
   QTRY_VERIFY(!p->findChild<QPushButton*>("newsCancel")->isEnabled());
   QCOMPARE(p->findChild<QLineEdit*>("newsFullId")->text(),id);
   QJsonObject raw{{"id",mode},{"title","受控资讯 "+mode},{"source","主机检查"},{"provider","fixture"},
     {"time","2026-10-13T00:00:00Z"},{"timeProvenance","upstream-field"},{"summary","保留完整原始摘要 "+mode},
     {"link","https://finance.sina.com.cn/test/"+mode+".shtml"},{"type","market"}};
   p->previewImport(QJsonDocument(QJsonArray{raw}).toJson());
   QTRY_VERIFY(p->findChild<QPlainTextEdit*>("newsImportState")->toPlainText().contains("预览"));
   QTRY_VERIFY(!p->findChild<QPushButton*>("newsCancel")->isEnabled());
   const auto before=publicNews::Store(dir.filePath("news-public-v1.sqlite")).archive()["items"].toArray().size();
   p->findChild<QPushButton*>("newsApplyImport")->click();
   QTRY_COMPARE(publicNews::Store(dir.filePath("news-public-v1.sqlite")).archive()["items"].toArray().size(),before+1);
   QTRY_VERIFY(!p->findChild<QPushButton*>("newsCancel")->isEnabled());
   auto* list=p->findChild<QTableWidget*>("newsList");list->selectRow(0);
   QTRY_VERIFY(!p->findChild<QPushButton*>("newsCancel")->isEnabled());
   QVERIFY(p->findChild<QPlainTextEdit*>("newsBody")->toPlainText().contains("保留完整原始摘要"));
   auto* note=p->findChild<QPlainTextEdit*>("newsNote");note->setPlainText("未保存备注 "+mode);
   window.findChild<QPushButton*>("workspace主页")->click();
   window.findChild<QPushButton*>("openNews")->click();
   QCOMPARE(note->toPlainText(),"未保存备注 "+mode);
   p->findChild<QPushButton*>("newsSave")->click();
   QTRY_VERIFY(!p->findChild<QPushButton*>("newsCancel")->isEnabled());
   QVERIFY2(p->findChild<QLabel*>("newsState")->text().contains("保存"),qPrintable(p->findChild<QLabel*>("newsState")->text()));
   QCOMPARE(window.layoutMode(),mode);
   window.findChild<QPushButton*>("workspace主页")->click();
  }
 }
 void commentHostCardDraftInternalReader() {
  QTemporaryDir dir;Window window(true,dir.filePath("settings.ini"),dir.path());
  window.resize(1600,1000);window.show();window.findChild<QPushButton*>("workspace研究")->click();
  auto* page=window.findChild<QWidget*>("commentWorkshopPage");QVERIFY(page);
  auto* parent=qobject_cast<QTabWidget*>(page->parentWidget()->parentWidget());QVERIFY(parent);parent->setCurrentWidget(page);
  auto* tabs=page->findChild<QTabWidget*>();QVERIFY(tabs);tabs->setCurrentIndex(2);
  page->findChild<QPlainTextEdit*>("commentRule_title")->setPlainText("主机规则草稿");
  auto* field=page->findChild<QPlainTextEdit*>("commentRule_entryRule");field->setPlainText("保留人工入场规则全文");
  window.findChild<QPushButton*>("workspace主页")->click();window.findChild<QPushButton*>("workspace研究")->click();
  QCOMPARE(field->toPlainText(),QString("保留人工入场规则全文"));
  auto* save=textButton(page,"明确保存规则卡（未验证）");QVERIFY(save);save->click();
  QVERIFY2(page->findChild<QLabel*>("commentWorkshopState")->text().contains("已保存"),qPrintable(page->findChild<QLabel*>("commentWorkshopState")->text()));
  auto* history=textButton(page,"查看分类原记录（含缺失来源）");QVERIFY(history);history->click();
  QCOMPARE(page->findChild<QStackedWidget*>("commentWorkshopViews")->currentIndex(),1);
  QVERIFY(commentWorkshopBack(page));QCOMPARE(field->toPlainText(),QString("保留人工入场规则全文"));
  QVERIFY(!window.findChild<QDialog*>());
 }
};
QTEST_MAIN(MigrationV29RemainingTests)
#include "migration_v29_remaining_tests.moc"
