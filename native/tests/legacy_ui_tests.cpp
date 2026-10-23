#include <QComboBox>
#include <QDoubleSpinBox>
#include <QLineEdit>
#include <QListWidget>
#include <QPushButton>
#include <QTabWidget>
#include <QTableWidget>
#include <QTemporaryDir>
#include <QtTest>
#include <QLabel>
#include <memory>

#include "business_pages.hpp"

namespace {
QJsonObject legacyTrade(const QString& side,
                        const QString& instrument = "SZ:stock:000001") {
  const double amount = side == "dividend" ? 100. : 25.;
  return {{"id", "legacy-webstock:trade:17"},
          {"accountId", "local"},
          {"instrumentId", instrument},
          {"name", "旧证券"},
          {"date", "2026-10-09"},
          {"side", side},
          {"quantity", 0.},
          {"price", 0.},
          {"fee", 0.},
          {"tax", 0.},
          {"amount", amount},
          {"note", "旧备注"},
          {"legacySource", "trades"},
          {"legacyOriginal", QJsonObject{{"id", 17},
                                         {"source_type", "manual"},
                                         {"amount", amount},
                                         {"note", "旧备注"}}}};
}
QJsonArray roster() {
  return {QJsonObject{
      {"id", "SZ:stock:000001"}, {"name", "自选证券"}, {"symbol", "sz000001"}}};
}
void showTrades(QWidget* page) {
  page->resize(1280, 800);
  page->show();
  page->findChild<QTabWidget*>("ledgerViews")->setCurrentIndex(1);
  QCoreApplication::processEvents();
}
void clickRow(QTableWidget* table, int row) {
  QTest::mouseClick(table->viewport(), Qt::LeftButton, Qt::NoModifier,
                    table->visualItemRect(table->item(row, 0)).center());
}
}  // namespace

// These are factory-created native widgets and an isolated store, not
// screenshots or a direct store-only stand-in for the edit/save UI path.
class LegacyUiTests : public QObject {
  Q_OBJECT

 private slots:
  void editingOnlyImportedCashFlowNotePreservesAmountAndProvenance_data() {
    QTest::addColumn<QString>("side");
    QTest::newRow("dividend") << QString("dividend");
    QTest::newRow("fee") << QString("fee");
  }

  void editingOnlyImportedCashFlowNotePreservesAmountAndProvenance() {
    QFETCH(QString, side);
    QTemporaryDir temporary;
    QVERIFY(temporary.isValid());
    auto store =
        std::make_shared<BusinessStore>(temporary.filePath("native.sqlite"));
    const auto original = store->save("trades", legacyTrade(side));
    std::unique_ptr<QWidget> page(portfolioPage(
        store, false, roster, [](QString) {}, nullptr));
    showTrades(page.get());
    auto* table = page->findChild<QTableWidget*>("tradeTable");
    auto* note = page->findChild<QLineEdit*>("tradeNote");
    auto* save = page->findChild<QPushButton*>("saveTrade");
    QVERIFY(table && note && save);
    QCOMPARE(table->rowCount(), 1);
    clickRow(table, 0);
    note->setText("只修改这条备注");
    QTest::mouseClick(save, Qt::LeftButton);
    const auto records = store->read("trades");
    QCOMPARE(records.size(), 1);
    const auto edited = records[0].toObject();
    QCOMPARE(edited["id"], original["id"]);
    QCOMPARE(edited["note"].toString(), QString("只修改这条备注"));
    QCOMPARE(edited["amount"], original["amount"]);
    QCOMPARE(edited["legacyOriginal"], original["legacyOriginal"]);
    QCOMPARE(edited["legacySource"], original["legacySource"]);
    const auto ledger = business::portfolio(records, {}, "local");
    QCOMPARE(ledger["realized"].toDouble(), side == "dividend" ? 100. : -25.);
  }

  void importedTotalAmountIsVisibleAndExplicitlyEditable() {
    QTemporaryDir temporary;
    auto store =
        std::make_shared<BusinessStore>(temporary.filePath("native.sqlite"));
    const auto original = store->save("trades", legacyTrade("dividend"));
    std::unique_ptr<QWidget> page(portfolioPage(
        store, false, roster, [](QString) {}, nullptr));
    showTrades(page.get());
    auto* table = page->findChild<QTableWidget*>("tradeTable");
    QVERIFY(table && table->rowCount() == 1);
    clickRow(table, 0);
    auto* amount = page->findChild<QDoubleSpinBox*>("tradeAmount");
    QVERIFY2(amount, "Imported total cash amount needs its own edit field");
    QCOMPARE(amount->value(), 100.);
    amount->setValue(125.);
    auto* save = page->findChild<QPushButton*>("saveTrade");
    QVERIFY(save);
    QTest::mouseClick(save, Qt::LeftButton);
    const auto edited = store->read("trades")[0].toObject();
    QCOMPARE(edited["amount"].toDouble(), 125.);
    QCOMPARE(edited["legacyOriginal"], original["legacyOriginal"]);
  }

  void importedSecurityOutsideWatchlistStillLoadsAndSavesUnderItsOwnIdentity() {
    QTemporaryDir temporary;
    auto store =
        std::make_shared<BusinessStore>(temporary.filePath("native.sqlite"));
    const auto original =
        store->save("trades", legacyTrade("dividend", "SH:stock:600000"));
    std::unique_ptr<QWidget> page(portfolioPage(
        store, false, roster, [](QString) {}, nullptr));
    showTrades(page.get());
    auto* table = page->findChild<QTableWidget*>("tradeTable");
    auto* symbols = page->findChild<QComboBox*>("tradeInstrument");
    auto* note = page->findChild<QLineEdit*>("tradeNote");
    auto* save = page->findChild<QPushButton*>("saveTrade");
    QVERIFY(table && symbols && note && save);
    QCOMPARE(table->rowCount(), 1);
    clickRow(table, 0);
    QCOMPARE(symbols->currentData().toString(), QString("SH:stock:600000"));
    note->setText("非自选旧证券仍可编辑");
    QTest::mouseClick(save, Qt::LeftButton);
    const auto records = store->read("trades");
    QCOMPARE(records.size(), 1);
    const auto edited = records[0].toObject();
    QCOMPARE(edited["instrumentId"], original["instrumentId"]);
    QCOMPARE(edited["amount"], original["amount"]);
    QCOMPARE(edited["note"].toString(), QString("非自选旧证券仍可编辑"));
  }

  void changingImportedEvidenceTitleKeepsOriginalSourceDocument() {
    QTemporaryDir temporary;
    auto store =
        std::make_shared<BusinessStore>(temporary.filePath("native.sqlite"));
    const auto original = store->save(
        "docs",
        {{"id", "legacy-webstock:knowledge:8"},
         {"title", "旧标题"},
         {"text", "原始正文"},
         {"sourceUrl", "https://example.com/evidence"},
         {"verification", "unverified"},
         {"legacySource", "knowledge_sources"},
         {"legacyOriginal", QJsonObject{{"id", 8},
                                        {"source_key", "legacy-key-8"},
                                        {"original_content", "原始正文"}}}});
    std::unique_ptr<QWidget> page(researchPage(store, nullptr));
    page->resize(1280, 800);
    page->show();
    QCoreApplication::processEvents();
    auto* list = page->findChild<QListWidget*>("evidenceList");
    auto* title = page->findChild<QLineEdit*>("evidenceTitle");
    auto* save = page->findChild<QPushButton*>("saveEvidence");
    QVERIFY(list && title && save);
    QCOMPARE(list->count(), 1);
    const auto displayed = list->item(0)->data(Qt::UserRole).toJsonObject();
    QCOMPARE(displayed, store->read("docs")[0].toObject());
    QCOMPARE(displayed["id"].toString(), original["id"].toString());
    QTest::mouseClick(list->viewport(), Qt::LeftButton, Qt::NoModifier,
                      list->visualItemRect(list->item(0)).center());
    QVERIFY2(title->text() == QString("旧标题"), qPrintable(page->findChild<QLabel*>("evidenceState")->text()));
    title->setText("仅修改标题");
    QTest::mouseClick(save, Qt::LeftButton);
    const auto docs = store->read("docs");
    QCOMPARE(docs.size(), 1);
    const auto edited = docs[0].toObject();
    QCOMPARE(edited["title"].toString(), QString("仅修改标题"));
    QCOMPARE(edited["text"], original["text"]);
    QCOMPARE(edited["legacyOriginal"], original["legacyOriginal"]);
    QCOMPARE(edited["legacySource"], original["legacySource"]);
  }
};

QTEST_MAIN(LegacyUiTests)
#include "legacy_ui_tests.moc"
