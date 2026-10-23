#include <QApplication>
#include <QLabel>
#include <QLineEdit>
#include <QListWidget>
#include <QPlainTextEdit>
#include <QSettings>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QThreadPool>
#include <QtTest>
#include <QSqlDatabase>
#include <QSqlQuery>

#include "collection_page.hpp"
#include "collection_pipeline.hpp"
#include "native_read_pool.hpp"

// These exercise the real collection page and its asynchronous SQLite reader.
// Every record, queue lock, preference file and database is private to the test.
class R02CollectionSwitchTests : public QObject {
  Q_OBJECT

  static int rowFor(const QListWidget* list, const QString& id) {
    for (int row = 0; row < list->count(); ++row)
      if (list->item(row)->data(Qt::UserRole).toString() == id) return row;
    return -1;
  }

  static void seed(const std::shared_ptr<BusinessStore>& store) {
    store->save("collections", {{"id", "A"}, {"title", "A title"},
      {"text", "A original text"}, {"originalText", "A original text"},
      {"publishedAt", "2026-10-19T02:00:00.000Z"}, {"status", "imported"}});
    store->save("collections", {{"id", "B"}, {"title", "B title"},
      {"text", "B original text"}, {"originalText", "B original text"},
      {"publishedAt", "2026-10-18T02:00:00.000Z"}, {"status", "imported"}});
  }

 private slots:
  void initTestCase() {
    QStandardPaths::setTestModeEnabled(true);
    QCoreApplication::setOrganizationName("NativeMarketReviewTests");
    QCoreApplication::setApplicationName("R02CollectionSwitch-" +
      QUuid::createUuid().toString(QUuid::WithoutBraces));
  }

  void cleanup() {
    nativeReadPool()->waitForDone();
    QCoreApplication::sendPostedEvents(nullptr, QEvent::DeferredDelete);
    QCoreApplication::processEvents();
    QSettings settings;
    settings.clear();
    settings.sync();
  }

  void dirtySelectionSavesAAndLoadsExactB() {
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    auto store = std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    seed(store);
    CollectionPipeline pipeline(store, dir.filePath("media"));
    QVERIFY(pipeline.ownsQueue());
    std::unique_ptr<QWidget> page(collectionPage(store, nullptr, &pipeline));
    page->resize(1400, 950);
    page->show();
    auto list = page->findChild<QListWidget*>("collectionList");
    auto title = page->findChild<QLineEdit*>("collectionTitle");
    auto text = page->findChild<QPlainTextEdit*>("collectionText");
    QVERIFY(list && title && text);
    QTRY_VERIFY_WITH_TIMEOUT(page->property("listReady").toBool(), 5000);
    QTRY_COMPARE_WITH_TIMEOUT(title->text(), QString("A title"), 5000);
    QCOMPARE(list->count(), 2);
    QCOMPARE(list->currentItem()->data(Qt::UserRole).toString(), QString("A"));

    text->setPlainText("A corrected draft");
    const int target = rowFor(list, "B");
    QVERIFY(target >= 0);
    list->setCurrentRow(target);

    QTRY_COMPARE_WITH_TIMEOUT(title->text(), QString("B title"), 5000);
    QCOMPARE(text->toPlainText(), QString("B original text"));
    QTRY_VERIFY_WITH_TIMEOUT(list->currentItem() &&
      list->currentItem()->data(Qt::UserRole).toString() == "B", 5000);
    const auto savedA = BusinessStore::readRecord(store->filePath(), "collections", "A");
    const auto unchangedB = BusinessStore::readRecord(store->filePath(), "collections", "B");
    QCOMPARE(savedA["text"].toString(), QString("A corrected draft"));
    QCOMPARE(savedA["originalText"].toString(), QString("A original text"));
    QCOMPARE(unchangedB["title"].toString(), QString("B title"));
    QCOMPARE(unchangedB["text"].toString(), QString("B original text"));
    QCOMPARE(store->read("docs").size(), 0);
    page.reset();
  }

  void changedTargetVersionIsRejectedAndCurrentTextIsPreserved() {
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    auto store = std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    seed(store);
    CollectionPipeline pipeline(store, dir.filePath("media"));
    QVERIFY(pipeline.ownsQueue());
    std::unique_ptr<QWidget> page(collectionPage(store, nullptr, &pipeline));
    page->resize(1400, 950);
    page->show();
    auto list = page->findChild<QListWidget*>("collectionList");
    auto title = page->findChild<QLineEdit*>("collectionTitle");
    auto text = page->findChild<QPlainTextEdit*>("collectionText");
    auto state = page->findChild<QLabel*>("collectionState");
    QVERIFY(list && title && text && state);
    QTRY_VERIFY_WITH_TIMEOUT(page->property("listReady").toBool(), 5000);
    QTRY_COMPARE_WITH_TIMEOUT(title->text(), QString("A title"), 5000);
    const int target = rowFor(list, "B");
    QVERIFY(target >= 0);
    const auto selectedVersion = list->item(target)->data(Qt::UserRole + 1).toJsonObject();
    QVERIFY(!selectedVersion["_recordSha256"].toString().isEmpty());

    auto replacementB = BusinessStore::readRecord(store->filePath(), "collections", "B");
    replacementB["title"] = "B replacement title";
    replacementB["text"] = "B replacement text";
    store->save("collections", replacementB);
    // No list reload: the user's selected row still denotes the earlier B.
    text->setPlainText("A corrected before stale B selection");
    list->setCurrentRow(target);

    QTRY_VERIFY_WITH_TIMEOUT(state->text().contains("资料原版本已变化"), 5000);
    QCOMPARE(title->text(), QString("A title"));
    QCOMPARE(text->toPlainText(), QString("A corrected before stale B selection"));
    QCOMPARE(BusinessStore::readRecord(store->filePath(), "collections", "A")
      ["text"].toString(), QString("A corrected before stale B selection"));
    QCOMPARE(BusinessStore::readRecord(store->filePath(), "collections", "B")
      ["text"].toString(), QString("B replacement text"));
    QCOMPARE(store->read("docs").size(), 0);
    page.reset();
  }

  void failedSaveKeepsCurrentAndHighlightedRecordTogether() {
    QTemporaryDir dir;
    auto store = std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    seed(store);
    CollectionPipeline pipeline(store, dir.filePath("media"));
    std::unique_ptr<QWidget> page(collectionPage(store, nullptr, &pipeline));
    page->resize(1400, 950);page->show();
    auto list = page->findChild<QListWidget*>("collectionList");
    auto title = page->findChild<QLineEdit*>("collectionTitle");
    auto text = page->findChild<QPlainTextEdit*>("collectionText");
    QTRY_COMPARE_WITH_TIMEOUT(title->text(), QString("A title"), 5000);
    const auto connection = QUuid::createUuid().toString();
    {
      auto db = QSqlDatabase::addDatabase("QSQLITE", connection);
      db.setDatabaseName(store->filePath());QVERIFY(db.open());
      {QSqlQuery q(db);QVERIFY(q.exec("CREATE TRIGGER refuse_test_A BEFORE UPDATE OF payload ON records "
        "WHEN NEW.kind='collections' AND NEW.id='A' BEGIN SELECT RAISE(ABORT,'private save failure'); END"));}
      db.close();
    }
    QSqlDatabase::removeDatabase(connection);
    text->setPlainText("retained manual draft A");
    auto target = list->item(rowFor(list, "B"));QVERIFY(target);
    list->scrollToItem(target);
    QTest::mouseClick(list->viewport(), Qt::LeftButton, Qt::NoModifier, list->visualItemRect(target).center());
    QCoreApplication::processEvents();
    QCOMPARE(text->toPlainText(), QString("retained manual draft A"));
    QCOMPARE(title->text(), QString("A title"));
    QCOMPARE(list->currentItem()->data(Qt::UserRole).toString(), QString("A"));
    QCOMPARE(list->selectedItems().size(), 1);
    QCOMPARE(list->selectedItems().first()->data(Qt::UserRole).toString(), QString("A"));
    QCOMPARE(BusinessStore::readRecord(store->filePath(),"collections","A")["text"].toString(),QString("A original text"));
    page.reset();
  }
};

QTEST_MAIN(R02CollectionSwitchTests)
#include "r02_collection_switch_tests.moc"
