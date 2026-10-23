#include <QApplication>
#include <QComboBox>
#include <QJsonDocument>
#include <QLabel>
#include <QLineEdit>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QSettings>
#include <QStandardPaths>
#include <QTableWidget>
#include <QTemporaryDir>
#include <QtTest>

#include "industry_page.hpp"
#include "industry_topic_page.hpp"
#include "business_restore_store.hpp"
#include "native_read_pool.hpp"
#include "source_plans_page.hpp"

// The browser never becomes ready: the saved-plan dispatch contract can be
// inspected without visiting a page, capturing a work, downloading or ASR.
class R02UnreadyBrowser final : public SourceBrowser {
 public:
  int visits = 0;
  void initialize(const QString&) override {}
  void navigate(const QUrl&) override { ++visits; }
  void capture() override {}
  void stop() override {}
};

class R02ResearchDraftTests : public QObject {
  Q_OBJECT

  static void edit(QLineEdit* field, const QString& value) {
    field->selectAll();
    QTest::keyClicks(field, value);
  }

  static int relationRow(QTableWidget* table, const QString& id) {
    for (int row = 0; row < table->rowCount(); ++row)
      if (table->item(row, 0)->data(Qt::UserRole).toJsonObject()["id"] == id)
        return row;
    return -1;
  }

  static void chooseRelation(QTableWidget* table, int row) {
    table->setCurrentCell(row, 0);
    table->cellClicked(row, 0);
  }

  static int planRow(QTableWidget* table, const QString& id) {
    for (int row = 0; row < table->rowCount(); ++row)
      if (table->item(row, 0)->data(Qt::UserRole).toString() == id) return row;
    return -1;
  }

  static void seedRelations(const std::shared_ptr<BusinessStore>& store) {
    store->save("topics", {{"id", "topic-A"}, {"name", "Topic A"}});
    store->save("topics", {{"id", "topic-B"}, {"name", "Topic B"}});
    store->save("docs", {{"id", "doc-A"}, {"title", "Private evidence"},
      {"text", "quoted A; quoted B; corrected quotation"},
      {"sourceUrl", "https://example.org/private-fixture"}});
    for (const auto& id : {QString("relation-A"), QString("relation-B")})
      store->save("relations", {{"id", id}, {"topicId", "topic-A"},
        {"documentId", "doc-A"}, {"stage", "materials"},
        {"claim", id + " saved claim"},
        {"quote", id == "relation-A" ? "quoted A" : "quoted B"},
        {"polarity", "supports"}, {"verification", "unverified"}});
  }

  static QJsonObject plan(const QString& name, const QString& suffix) {
    return {{"name", name},
      {"profileUrl", "https://www.douyin.com/user/" + suffix},
      {"rightsBasis", "isolated fixture permission"}, {"limit", 5},
      {"intervalMinutes", 30}, {"contentType", "video"}};
  }

  static QString topicArchive() {
    QJsonArray topics;
    for (const auto& id : {QString("topic-A"), QString("topic-B")})
      topics.append(QJsonObject{{"id", id}, {"name", id},
        {"aliases", QJsonArray{}}, {"sourceUrls", QJsonArray{}},
        {"enabled", false}, {"intervalMinutes", 1440},
        {"lastAttemptAt", QJsonValue(QJsonValue::Null)},
        {"lastSuccessAt", QJsonValue(QJsonValue::Null)},
        {"nextDueAt", QJsonValue(QJsonValue::Null)},
        {"currentVersionId", QJsonValue(QJsonValue::Null)},
        {"config", QJsonObject{}}});
    return QString::fromUtf8(QJsonDocument(QJsonObject{{"topics", topics},
      {"evidence", QJsonArray{}}, {"versions", QJsonArray{}},
      {"runs", QJsonArray{}}}).toJson(QJsonDocument::Compact));
  }

 private slots:
  void initTestCase() {
    QStandardPaths::setTestModeEnabled(true);
    QCoreApplication::setOrganizationName("NativeMarketReviewTests");
    QCoreApplication::setApplicationName("R02ResearchDrafts-" +
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

  void relationSwitchRestoresDraftForItsOwnRelation() {
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    auto store = std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    seedRelations(store);
    const auto before = store->read("relations");
    std::unique_ptr<QWidget> page(industryPage(store, nullptr));
    page->resize(1400, 950);
    page->show();
    auto editor = page->findChild<QWidget*>("industryEvidence");
    auto topics = page->findChild<QComboBox*>("researchTopics");
    auto table = page->findChild<QTableWidget*>("relationTable");
    auto claim = page->findChild<QLineEdit*>("relationClaim");
    auto quote = page->findChild<QPlainTextEdit*>("relationQuote");
    QVERIFY(editor && topics && table && claim && quote);
    QTRY_VERIFY_WITH_TIMEOUT(editor->property("industryReady").toBool(), 5000);
    topics->setCurrentIndex(topics->findData("topic-A"));
    QVERIFY(relationRow(table, "relation-A") >= 0);
    QVERIFY(relationRow(table, "relation-B") >= 0);
    chooseRelation(table, relationRow(table, "relation-A"));
    QCOMPARE(claim->text(), QString("relation-A saved claim"));
    edit(claim, "A unsaved corrected claim");
    quote->setPlainText("corrected quotation");

    chooseRelation(table, relationRow(table, "relation-B"));
    QCOMPARE(claim->text(), QString("relation-B saved claim"));
    QCOMPARE(quote->toPlainText(), QString("quoted B"));
    chooseRelation(table, relationRow(table, "relation-A"));
    QCOMPARE(claim->text(), QString("A unsaved corrected claim"));
    QCOMPARE(quote->toPlainText(), QString("corrected quotation"));
    QCOMPARE(store->read("relations"), before);
  }

  void topicSwitchDoesNotCarryRelationDraftIntoAnotherTopic() {
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    auto store = std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    seedRelations(store);
    const auto before = store->read("relations");
    std::unique_ptr<QWidget> page(industryPage(store, nullptr));
    page->resize(1400, 950);
    page->show();
    auto editor = page->findChild<QWidget*>("industryEvidence");
    auto topics = page->findChild<QComboBox*>("researchTopics");
    auto table = page->findChild<QTableWidget*>("relationTable");
    auto claim = page->findChild<QLineEdit*>("relationClaim");
    auto quote = page->findChild<QPlainTextEdit*>("relationQuote");
    QTRY_VERIFY_WITH_TIMEOUT(editor->property("industryReady").toBool(), 5000);
    topics->setCurrentIndex(topics->findData("topic-A"));
    QVERIFY(relationRow(table, "relation-A") >= 0);
    chooseRelation(table, relationRow(table, "relation-A"));
    edit(claim, "Topic A unsaved relation");
    quote->setPlainText("corrected quotation");

    topics->setCurrentIndex(topics->findData("topic-B"));
    QCOMPARE(topics->currentData().toString(), QString("topic-B"));
    QVERIFY(claim->text() != "Topic A unsaved relation");
    topics->setCurrentIndex(topics->findData("topic-A"));
    QCOMPARE(claim->text(), QString("Topic A unsaved relation"));
    QCOMPARE(quote->toPlainText(), QString("corrected quotation"));
    QCOMPARE(store->read("relations"), before);
  }

  void authorPlanSelectionRestoresEachAuthorsUnsavedDraft() {
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    auto ledger = std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));
    const auto a = ledger->save(plan("Author A", "fixture_author_a"));
    const auto b = ledger->save(plan("Author B", "fixture_author_b"));
    const auto before = ledger->plans();
    SourcePlansPage page(ledger, nullptr);
    auto table = page.findChild<QTableWidget*>("savedSourcePlans");
    auto name = page.findChild<QLineEdit*>("planName");
    auto rights = page.findChild<QLineEdit*>("planRights");
    auto content = page.findChild<QComboBox*>("planContentType");
    QVERIFY(table && name && rights && content);
    table->selectRow(planRow(table, a["id"].toString()));
    QCOMPARE(name->text(), QString("Author A"));
    edit(name, "Author A unsaved title");
    edit(rights, "Author A unsaved permission");
    content->setCurrentIndex(content->findData("note"));

    table->selectRow(planRow(table, b["id"].toString()));
    QCOMPARE(name->text(), QString("Author B"));
    QCOMPARE(content->currentData().toString(), QString("video"));
    table->selectRow(planRow(table, a["id"].toString()));
    QCOMPARE(name->text(), QString("Author A unsaved title"));
    QCOMPARE(rights->text(), QString("Author A unsaved permission"));
    QCOMPARE(content->currentData().toString(), QString("note"));
    QCOMPARE(ledger->plans(), before);
    QVERIFY(ledger->history().isEmpty());
    QVERIFY(!page.scheduling());
  }

  void manualPlanDispatchNeverUsesUncommittedEditorConfiguration() {
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    auto business = std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
    auto ledger = std::make_shared<SourceSchedule>(dir.filePath("plans.sqlite"));
    const auto saved = ledger->save(plan("Saved Author", "fixture_saved_author"));
    CollectionPipeline pipeline(business, dir.filePath("media"));
    auto browser = new R02UnreadyBrowser;
    SourcePage source(business, &pipeline, nullptr, browser);
    SourcePlansPage page(ledger, &source);
    auto table = page.findChild<QTableWidget*>("savedSourcePlans");
    table->selectRow(planRow(table, saved["id"].toString()));
    edit(page.findChild<QLineEdit*>("planName"), "Unsaved Author");
    edit(page.findChild<QLineEdit*>("planProfile"),
      "https://www.douyin.com/user/unsaved_other_author");
    auto content = page.findChild<QComboBox*>("planContentType");
    content->setCurrentIndex(content->findData("note"));
    page.findChild<QPushButton*>("runSourcePlan")->click();

    // Both explicit refusal and dispatching the persisted version are safe.
    // In neither case may editing silently authorize another author's source.
    const auto history = ledger->history();
    QVERIFY(history.size() <= 1);
    if (!history.isEmpty()) QCOMPARE(history[0].toObject()["plan"].toObject(), saved);
    else QVERIFY(!source.busy());
    QCOMPARE(ledger->plans()[0].toObject()["profileUrl"], saved["profileUrl"]);
    QCOMPARE(ledger->plans()[0].toObject()["contentType"], saved["contentType"]);
    QCOMPARE(browser->visits, 0);
    QVERIFY(business->read("collections").isEmpty());
    QVERIFY(business->read("docs").isEmpty());
    page.findChild<QPushButton*>("pauseSourcePlans")->click();
    QVERIFY(!source.busy());
  }

  void unavailableCatalogueDoesNotBlockNewDraftSave() {
    QTemporaryDir dir;
    industryTopicUpdate::Runtime runtime(dir.filePath("state.json"), [] { return QJsonArray{}; });
    IndustryTopicPage page(dir.path(), &runtime, []() -> QJsonArray {
      throw std::runtime_error("catalogue unavailable");
    });
    page.findChild<QPlainTextEdit*>("f08Urls")->setPlainText("https://example.org/retained-draft");
    QVERIFY(page.findChild<QLabel*>("f08State")->text().contains("catalogue unavailable"));
    QJsonObject saved;
    try { saved = page.saveState(); }
    catch (const std::exception& e) { QFAIL(e.what()); }
    industryTopicUpdate::Draft draft(dir.filePath("draft.json"));
    QCOMPARE(draft.read(saved["sha256"].toString())["current"].toObject()["sourceUrls"].toString(),
             QString("https://example.org/retained-draft"));
    QVERIFY(!QFile::exists(dir.filePath("state.json")));
    QVERIFY(!runtime.isBusy());
  }

  void inspectRetainedCatalogue() {
    const auto file = qEnvironmentVariable("STOCK_INSPECT_BUSINESS");
    if (file.isEmpty()) return;
    try { businessRestore::Store(file).capture(); qInfo("Retained catalogue readable"); }
    catch (const std::exception& e) { qInfo("Retained catalogue error: %s", e.what()); }
  }

  void unreadOriginalStillBlocksOverwrite() {
    QTemporaryDir dir;
    QFile original(dir.filePath("draft.json"));
    QVERIFY(original.open(QIODevice::WriteOnly));
    const QByteArray retained("{broken original");
    QCOMPARE(original.write(retained), retained.size());
    original.close();
    industryTopicUpdate::Runtime runtime(dir.filePath("state.json"), [] { return QJsonArray{}; });
    IndustryTopicPage page(dir.path(), &runtime, [] { return QJsonArray{}; });
    QVERIFY_EXCEPTION_THROWN(page.saveState(), std::runtime_error);
    QVERIFY(original.open(QIODevice::ReadOnly));
    QCOMPARE(original.readAll(), retained);
  }

  void industryTopicSwitchRestoresUrlsAndProposalsByTopic() {
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    const QString file = dir.filePath("state.json");
    industryTopicUpdate::Store store(file);
    store.initialize(topicArchive(), true);
    const auto before = store.snapshot();
    industryTopicUpdate::Runtime runtime(file, [] { return QJsonArray{}; });
    IndustryTopicPage page(dir.path(), &runtime, [] { return QJsonArray{}; });
    page.resize(1200, 950);
    page.show();
    page.setActive(true);
    auto topics = page.findChild<QComboBox*>("f08Topic");
    auto urls = page.findChild<QPlainTextEdit*>("f08Urls");
    auto proposals = page.findChild<QPlainTextEdit*>("f08Proposals");
    topics->setCurrentIndex(topics->findData("topic-A"));
    const QString aUrls = "https://example.org/topic-a\nhttps://example.org/extra";
    const QString aProposals = "[{\"stage\":\"materials\",\"product\":\"A\",\"claim\":\"A draft\"}]";
    urls->setPlainText(aUrls);
    proposals->setPlainText(aProposals);

    topics->setCurrentIndex(topics->findData("topic-B"));
    QVERIFY(urls->toPlainText() != aUrls);
    const QString bUrls = "https://example.org/topic-b";
    urls->setPlainText(bUrls);
    topics->setCurrentIndex(topics->findData("topic-A"));
    QCOMPARE(urls->toPlainText(), aUrls);
    QCOMPARE(proposals->toPlainText(), aProposals);
    topics->setCurrentIndex(topics->findData("topic-B"));
    QCOMPARE(urls->toPlainText(), bUrls);
    QCOMPARE(store.snapshot(), before);
    QVERIFY(!runtime.isBusy());
    page.setActive(false);
  }

  void industryTopicReloadPreservesUncommittedEditorConfiguration() {
    QTemporaryDir dir;
    QVERIFY(dir.isValid());
    const QString file = dir.filePath("state.json");
    industryTopicUpdate::Store store(file);
    store.initialize(topicArchive(), true);
    const auto before = store.snapshot();
    industryTopicUpdate::Runtime runtime(file, [] { return QJsonArray{}; });
    IndustryTopicPage page(dir.path(), &runtime, [] { return QJsonArray{}; });
    page.resize(1200, 950);
    page.show();
    page.setActive(true);
    auto urls = page.findChild<QPlainTextEdit*>("f08Urls");
    auto proposals = page.findChild<QPlainTextEdit*>("f08Proposals");
    auto interval = page.findChild<QLineEdit*>("f08Interval");
    const QString draftUrls = "https://example.org/unsaved-source";
    const QString draftProposals = "[{\"stage\":\"materials\",\"product\":\"R\",\"claim\":\"Reload draft\"}]";
    urls->setPlainText(draftUrls);
    proposals->setPlainText(draftProposals);
    edit(interval, "360");

    page.reload();
    QCOMPARE(urls->toPlainText(), draftUrls);
    QCOMPARE(proposals->toPlainText(), draftProposals);
    QCOMPARE(interval->text(), QString("360"));
    QCOMPARE(store.snapshot(), before);
    QVERIFY(!runtime.isBusy());
    page.setActive(false);
  }
};

QTEST_MAIN(R02ResearchDraftTests)
#include "r02_research_drafts_tests.moc"
