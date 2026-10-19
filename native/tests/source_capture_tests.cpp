#include <QTemporaryDir>
#include <QtTest>

#include "source_capture.hpp"
#include "source_detail_response.hpp"
class SourceCaptureTests : public QObject {
  Q_OBJECT
  const QString author = "https://www.douyin.com/user/abcdef", id = "7259684447530929443";
  QJsonObject detail(QString title = "来源标题", QString description = "来源说明") {
    auto url = "https://www.douyin.com/video/" + id;
    return {{"pageType", "video"}, {"pageUrl", url}, {"loggedIn", true},
            {"profile", QJsonObject{{"profileUrl", author}}},
            {"items", QJsonArray{QJsonObject{{"contentId", id}, {"sourceUrl", url},
              {"title", title}, {"description", description}}}}};
  }
  QJsonObject merge(BusinessStore& store, QJsonObject page) {
    try { return sourceCapture::mergeDetail(store, page, author, id, "本轮合法授权"); }
    catch (const std::exception& e) { qWarning("merge failed: %s", e.what()); throw; }
  }
 private slots:
  void officialMirrorsPersistOnlyWithExactWorkBinding() {
    QTemporaryDir dir; BusinessStore store(dir.filePath("business.sqlite"));
    auto page = detail(); auto item = page["items"].toArray()[0].toObject();
    const QString first="https://v3.douyinvod.com/one.mp4", next="https://v11.douyinvod.com/two.mp4";
    item["mediaUrl"]=first;
    item["mediaCandidates"]=QJsonArray{first,next,"https://evil.test/a",next};
    item["mediaBinding"]=QJsonObject{{"contentId",id},{"profileUrl",author},{"source","detail_response"}};
    page["items"]=QJsonArray{item};
    auto saved=merge(store,page);
    QCOMPARE(saved["mediaCandidates"].toArray(),QJsonArray({first,next}));
    item["mediaBinding"]=QJsonObject{{"contentId","7259684447530929444"},{"profileUrl",author},{"source","detail_response"}};
    page["items"]=QJsonArray{item}; saved=merge(store,page);
    QVERIFY(!saved.contains("mediaCandidates")); QVERIFY(!saved.contains("mediaUrl"));
  }
  void observedResponseRequiresExactOfficialWorkAndStripsUnrelatedFields() {
    const QUrl page("https://www.douyin.com/video/" + id);
    const QString endpoint = "https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=";
    QVERIFY(sourceDetailResponse::accepts(page, QUrl(endpoint + id)));
    for (const auto request : {endpoint + "7259684447530929444", endpoint + id + "&aweme_id=" + id,
         endpoint + id + "#fragment", QString("https://evil.test/aweme/v1/web/aweme/detail/?aweme_id=") + id,
         QString("https://www.douyin.com/aweme/v1/web/user/profile/?aweme_id=") + id})
      QVERIFY(!sourceDetailResponse::accepts(page, QUrl(request)));
    QVERIFY(!sourceDetailResponse::accepts(QUrl(author), QUrl(endpoint + id)));
    QJsonObject work{{"aweme_id", id}, {"author", QJsonObject{{"sec_uid", "abcdef"},
      {"nickname", "作者"}, {"unrelated", "private"}}}, {"desc", "真实说明"},
      {"video", QJsonObject{{"play_addr", QJsonObject{{"url_list", QJsonArray{"https://v3.douyinvod.com/work.mp4"}}}}}},
      {"unrelated", "private"}};
    auto body = [&](QJsonObject value, int status = 0) {
      return QJsonDocument(QJsonObject{{"status_code", status}, {"aweme_detail", value}}).toJson();
    };
    auto selected = sourceDetailResponse::select(body(work), id);
    QCOMPARE(selected["aweme_id"].toString(), id);
    QVERIFY(!QJsonDocument(selected).toJson().contains("private"));
    QVERIFY(sourceDetailResponse::select(body(work, 1), id).isEmpty());
    QVERIFY(sourceDetailResponse::select(body(work), "7259684447530929444").isEmpty());
    QVERIFY(sourceDetailResponse::select(QByteArray(2 * 1024 * 1024 + 1, ' '), id).isEmpty());
    work.remove("author");
    QVERIFY(sourceDetailResponse::select(body(work), id).isEmpty());
  }
  void persistedInventoryCanExceedOneProfilePageButRoundLimitStaysBounded() {
    QJsonArray candidates;
    for (int i = 0; i < 10000; ++i) {
      auto id = QString::number(7259684447530929443ULL + i);
      candidates.append(QJsonObject{{"contentId", id}, {"sourceUrl", "https://www.douyin.com/video/" + id}});
    }
    const auto result = sourceCapture::selectDetails(candidates, {}, 50);
    QCOMPARE(result.items.size(), 50); QCOMPARE(result.deferredCount, 9950);
    QCOMPARE(result.items[0], candidates[0]);
    candidates.append(candidates[0]);
    QVERIFY_EXCEPTION_THROWN(sourceCapture::selectDetails(candidates, {}, 50), std::exception);
    auto profilePage = QJsonObject{{"pageType", "profile"}, {"pageUrl", author}, {"loggedIn", true},
                                  {"profile", QJsonObject{{"profileUrl", author}}}, {"items", candidates}};
    QVERIFY_EXCEPTION_THROWN(sourceCapture::profileItems(profilePage, author), std::exception);
  }
  void candidatesPrioritizeUnseenThenOldestSuccessfulFamilyCheck() {
    const QString next = "7259684447530929444", unseen = "7259684447530929445",
                  blocked = "7259684447530929446";
    auto item = [](const QString& value) {
      return QJsonObject{{"contentId", value},
                         {"sourceUrl", "https://www.douyin.com/video/" + value}};
    };
    auto row = [&](const QString& value, const QString& checked) {
      return QJsonObject{{"sourceUrl", item(value)["sourceUrl"]},
                         {"sourceMetadata", QJsonObject{{"title", "来源"},
                           {"description", "说明"}, {"capturedAt", checked}}}};
    };
    QJsonArray visible{item(id), item(next), item(unseen), item(blocked)};
    auto root = row(id, "2020-01-01T00:00:00Z"); root["id"] = "root";
    auto version = row(id, "2026-10-12T00:00:00Z"); version["sourceRootId"] = "root";
    auto older = row(next, "2026-10-11T00:00:00Z");
    older["updatedAt"] = "2099-01-01T00:00:00Z";  // Human edit is not a source check.
    auto paused = row(blocked, "2020-01-01T00:00:00Z"); paused["pipelineState"] = "paused";
    QJsonArray records{root, version, older, paused};
    const auto original = records;
    const auto result = sourceCapture::selectDetails(visible, records, 2);
    QCOMPARE(result.items, (QJsonArray{item(unseen), item(next)}));
    QCOMPARE(result.heldCount, 1);
    QCOMPARE(result.deferredCount, 1);
    QCOMPARE(records, original);
  }
  void candidateTiesAndMissingChecksRetainVisibleOrder() {
    const QString next = "7259684447530929444";
    QJsonObject a{{"contentId", id}, {"sourceUrl", "https://www.douyin.com/video/" + id}},
                b{{"contentId", next}, {"sourceUrl", "https://www.douyin.com/video/" + next}};
    QJsonArray visible{a, b}, records;
    for (auto item : visible) records.append(QJsonObject{
        {"sourceUrl", item.toObject()["sourceUrl"]},
        {"sourceMetadata", QJsonObject{{"title", ""}, {"description", ""},
                                       {"capturedAt", "2026-10-12T00:00:00Z"}}}});
    QCOMPARE(sourceCapture::selectDetails(visible, records, 2).items, visible);
    for (auto stamp : {"not-a-time", "2026-10-12T00:00:00Z"}) {
      records = {};
      for (auto item : visible) records.append(QJsonObject{
          {"sourceUrl", item.toObject()["sourceUrl"]},
          {"sourceMetadata", QJsonObject{{"title", "来源"}, {"description", ""},
                                         {"capturedAt", stamp}}}});
      QCOMPARE(sourceCapture::selectDetails(visible, records, 2).items, visible);
    }
  }
  void candidateVersionProtectionCannotBeReorderedAway_data() {
    QTest::addColumn<QString>("field"); QTest::addColumn<QJsonValue>("value");
    for (auto state : {"paused", "held", "downloading", "transcribing", "publishing", "queued"})
      QTest::newRow(state) << QString("pipelineState") << QJsonValue(state);
    for (auto state : {"failed", "cancelled", "interrupted", "running", "queued"})
      QTest::newRow(qPrintable(QString("status-") + state)) << QString("status") << QJsonValue(state);
    QTest::newRow("permission") << QString("autoPipeline") << QJsonValue(true);
    QTest::newRow("failures") << QString("pipelineFailures") << QJsonValue(5);
    for (auto field : {"downloadState", "asrState"})
      for (auto state : {"failed", "cancelled", "interrupted", "importing", "running", "queued"})
        QTest::newRow(qPrintable(QString(field) + "-" + state)) << QString(field) << QJsonValue(state);
  }
  void candidateVersionProtectionCannotBeReorderedAway() {
    QFETCH(QString, field); QFETCH(QJsonValue, value);
    QJsonObject item{{"contentId", id}, {"sourceUrl", "https://www.douyin.com/video/" + id}};
    QJsonObject root{{"id", "root"}, {"sourceUrl", item["sourceUrl"]},
                     {"pipelineState", "complete"}},
                version{{"sourceRootId", "root"}, {"sourceUrl", item["sourceUrl"]},
                        {field, value}};
    const auto result = sourceCapture::selectDetails({item}, {root, version}, 1);
    QVERIFY(result.items.isEmpty());
    QCOMPARE(result.heldCount, 1);
    QCOMPARE(result.deferredCount, 0);
  }
  void selectionRemainsBoundedAndRejectsWrongIdentities() {
    QJsonArray visible;
    for (int n = 0; n < 60; ++n) {
      auto value = QString::number(7259684447530929400LL + n);
      visible.append(QJsonObject{{"contentId", value},
                                {"sourceUrl", "https://www.douyin.com/video/" + value}});
    }
    const auto result = sourceCapture::selectDetails(visible, {}, 50);
    QCOMPARE(result.items.size(), 50);
    QCOMPARE(result.deferredCount, 10);
    QCOMPARE(result.heldCount, 0);
    for (auto limit : {0, -1, 51})
      QVERIFY_EXCEPTION_THROWN(sourceCapture::selectDetails(visible, {}, limit), std::runtime_error);
    auto wrong = visible[0].toObject(); wrong["contentId"] = "7259684447530929500";
    QVERIFY_EXCEPTION_THROWN(sourceCapture::selectDetails({wrong}, {}, 1), std::runtime_error);
  }
  void changedSourceIsSeparateAndIdempotent() {
    QTemporaryDir dir; BusinessStore store(dir.filePath("db"));
    auto root = merge(store, detail());
    root["title"] = "人工标题"; root["text"] = "人工校对"; root["originalText"] = "旧原稿";
    root["pipelineState"] = "complete";
    root = store.save("collections", root);
    auto doc = store.save("docs", {{"id", "manual"}, {"title", "人工研究"}, {"text", "人工研究编辑"}, {"collectionId", root["id"]}});
    auto version = merge(store, detail("来源标题", "新来源说明"));
    QVERIFY(version["id"] != root["id"]);
    QCOMPARE(version["sourceRootId"], root["id"]);
    QVERIFY(version["text"].toString().isEmpty());
    QVERIFY(version["originalText"].toString().isEmpty());
    QCOMPARE(store.read("collections")[0].toObject(), root);
    QCOMPARE(store.read("docs")[0].toObject(), doc);
    QCOMPARE(merge(store, detail("来源标题", "新来源说明"))["id"], version["id"]);
    QCOMPARE(merge(store, detail())["id"], root["id"]);
    QCOMPARE(store.read("collections").size(), 2);
  }
  void existingAuthorConflictMustNotWrite() {
    QTemporaryDir dir; BusinessStore store(dir.filePath("db"));
    auto root = merge(store, detail()); root["sourceProfile"] = "https://www.douyin.com/user/other1";
    root = store.save("collections", root);
    QVERIFY_EXCEPTION_THROWN(merge(store, detail()), std::runtime_error);
    QCOMPARE(store.read("collections")[0].toObject(), root);
  }
  void incompleteDescriptionMustNotCreateUpdate() {
    QTemporaryDir dir; BusinessStore store(dir.filePath("db"));
    auto root = merge(store, detail());
    QVERIFY_EXCEPTION_THROWN(merge(store, detail("来源标题", "")), std::runtime_error);
    QCOMPARE(store.read("collections")[0].toObject(), root);
  }
  void cosmeticChangesAndLegacyBaselineAreNotUpdates() {
    QTemporaryDir dir; BusinessStore store(dir.filePath("db"));
    store.save("collections", {{"id", "legacy"}, {"title", "人工标题"}, {"text", "旧校对稿"}, {"originalText", "原稿"},
        {"sourceUrl", "https://www.douyin.com/video/" + id}, {"status", "completed"}});
    auto first = merge(store, detail("来源 标题", "说明 内容"));
    auto page = detail("\t来源　标题 ", "说明\n内容");
    auto item = page["items"].toArray()[0].toObject();
    item["publishedAt"] = "昨天"; item["transcript"] = "晚加载的字幕";
    item["mediaUrl"] = "https://v3.douyinvod.com/file?new-token";
    page["items"] = QJsonArray{item};
    auto second = merge(store, page);
    QCOMPARE(first["id"], second["id"]);
    QCOMPARE(store.read("collections").size(), 1);
    QCOMPARE(second["text"].toString(), QString("旧校对稿"));
    QCOMPARE(first["sourceFingerprint"], second["sourceFingerprint"]);
  }
  void heldFamilyDoesNotCreateAnotherVersion_data() {
    QTest::addColumn<QString>("state");
    for (auto state : {"held", "paused", "downloading", "transcribing", "publishing"}) QTest::newRow(state) << QString(state);
  }
  void heldFamilyDoesNotCreateAnotherVersion() {
    QFETCH(QString, state);
    QTemporaryDir dir; BusinessStore store(dir.filePath("db"));
    auto root = merge(store, detail());
    auto version = merge(store, detail("新标题"));
    version["pipelineState"] = state; store.save("collections", version);
    auto before = store.read("collections");
    QVERIFY_EXCEPTION_THROWN(merge(store, detail("第三版")), std::runtime_error);
    QCOMPARE(store.read("collections"), before);
  }
  void editedVersionSourceAndFingerprintAreNotOverwritten() {
    QTemporaryDir dir; BusinessStore store(dir.filePath("db"));
    merge(store, detail());
    auto version = merge(store, detail("新标题"));
    version["sourceUrl"] = "https://example.org/changed-source";
    store.save("collections", version);
    auto before = store.read("collections");
    QVERIFY_EXCEPTION_THROWN(merge(store, detail("新标题")), std::runtime_error);
    QCOMPARE(store.read("collections"), before);
  }
  void corruptRootFingerprintRejected() {
    QTemporaryDir dir; BusinessStore store(dir.filePath("db"));
    auto root = merge(store, detail());
    auto metadata = root["sourceMetadata"].toObject(); metadata["description"] = "被改的基线";
    root["sourceMetadata"] = metadata; store.save("collections", root);
    auto before = store.read("collections");
    QVERIFY_EXCEPTION_THROWN(merge(store, detail("新标题")), std::runtime_error);
    QCOMPARE(store.read("collections"), before);
  }
  void actualTaskStatesCannotBeBypassed_data() {
    QTest::addColumn<QString>("field"); QTest::addColumn<QString>("state");
    for (auto state : {"queued", "interrupted"}) QTest::newRow(state) << QString("status") << QString(state);
    for (auto field : {"downloadState", "asrState"})
      for (auto state : {"failed", "cancelled", "interrupted", "importing"})
        QTest::newRow(qPrintable(QString(field) + "-" + state)) << QString(field) << QString(state);
  }
  void actualTaskStatesCannotBeBypassed() {
    QFETCH(QString, field); QFETCH(QString, state);
    QTemporaryDir dir; BusinessStore store(dir.filePath("db"));
    auto root = merge(store, detail()); root[field] = state; store.save("collections", root);
    auto before = store.read("collections");
    QVERIFY_EXCEPTION_THROWN(merge(store, detail("新标题")), std::runtime_error);
    QCOMPARE(store.read("collections"), before);
  }
  void identitiesAndEmptyDoNotPass() {
    const QString profile = "https://www.douyin.com/user/abcdef";
    QJsonObject page{{"pageType", "profile"},
                     {"pageUrl", profile},
                     {"profile", QJsonObject{{"profileUrl", profile}}},
                     {"loggedIn", true},
                     {"items", QJsonArray()}};
    QVERIFY_EXCEPTION_THROWN(sourceCapture::profileItems(page, profile),
                             std::runtime_error);
    page["items"] = QJsonArray{QJsonObject{
        {"contentId", "7259684447530929443"},
        {"sourceUrl", "https://www.douyin.com/video/7259684447530929443"}}};
    QCOMPARE(sourceCapture::profileItems(page, profile).size(), 1);
    QVERIFY_EXCEPTION_THROWN(
        sourceCapture::profileItems(page, "https://www.douyin.com/user/other1"),
        std::runtime_error);
    page["loggedIn"] = false;
    QVERIFY_EXCEPTION_THROWN(sourceCapture::profileItems(page, profile),
                             std::runtime_error);
  }
  void preserveManualAndRejectWrongAuthor() {
    QTemporaryDir dir;
    BusinessStore store(dir.filePath("db"));
    const QString profile = "https://www.douyin.com/user/abcdef",
                  url = "https://www.douyin.com/video/7259684447530929443";
    QJsonObject page{
        {"pageType", "video"},
        {"pageUrl", url},
        {"loggedIn", true},
        {"profile",
         QJsonObject{{"profileUrl", profile}, {"displayName", "作者"}}},
        {"items", QJsonArray{QJsonObject{
                      {"contentId", "7259684447530929443"},
                      {"sourceUrl", url},
                      {"title", "视频"},
                      {"publishedAt", "2023-07-25T00:00:00Z"},
                      {"mediaUrl", "https://v3.douyinvod.com/media"}}}}};
    auto job = sourceCapture::mergeDetail(store, page, profile,
                                          "7259684447530929443", "授权处理");
    QCOMPARE(job["publishedAt"].toString(), QString("2023-07-25T00:00:00Z"));
    QVERIFY(!job.contains("mediaUrl"));
    auto item = page["items"].toArray()[0].toObject();
    item["mediaBinding"] = QJsonObject{{"contentId", "7259684447530929443"},
                                       {"profileUrl", profile},
                                       {"source", "embedded_detail"}};
    page["items"] = QJsonArray{item};
    job = sourceCapture::mergeDetail(store, page, profile,
                                     "7259684447530929443", "授权处理");
    QCOMPARE(job["mediaUrl"].toString(),
             QString("https://v3.douyinvod.com/media"));
    item["mediaBinding"] = QJsonObject{{"contentId", "7259684447530929443"},
                                       {"profileUrl", profile},
                                       {"source", "detail_response"}};
    page["items"] = QJsonArray{item};
    job = sourceCapture::mergeDetail(store, page, profile,
                                     "7259684447530929443", "授权处理");
    QCOMPARE(job["mediaUrl"].toString(), QString("https://v3.douyinvod.com/media"));
    QCOMPARE(job["mediaBinding"].toObject()["source"].toString(), QString("detail_response"));
    item["mediaBinding"] = QJsonObject{{"contentId", "7259684447530929444"},
                                       {"profileUrl", profile},
                                       {"source", "embedded_detail"}};
    page["items"] = QJsonArray{item};
    job = sourceCapture::mergeDetail(store, page, profile,
                                     "7259684447530929443", "授权处理");
    QVERIFY(!job.contains("mediaUrl"));
    job["text"] = "人工修订";
    store.save("collections", job);
    job = sourceCapture::mergeDetail(store, page, profile,
                                     "7259684447530929443", "授权处理");
    QCOMPARE(store.read("collections").size(), 1);
    QCOMPARE(job["text"].toString(), QString("人工修订"));
    page["profile"] =
        QJsonObject{{"profileUrl", "https://www.douyin.com/user/other1"}};
    QVERIFY_EXCEPTION_THROWN(
        sourceCapture::mergeDetail(store, page, profile, "7259684447530929443",
                                   "授权处理"),
        std::runtime_error);
  }
  void stableIdWithEditedSourceMustNeverOverwriteOldText() {
    QTemporaryDir dir;
    BusinessStore store(dir.filePath("db"));
    const QString author = "https://www.douyin.com/user/abcdef",
                  id = "7259684447530929443",
                  url = "https://www.douyin.com/video/" + id;
    auto original = store.save(
        "collections", {{"id", "douyin:" + id},
                        {"title", "人工标题"},
                        {"status", "imported"},
                        {"sourceUrl", "https://example.org/corrected-source"},
                        {"text", "不可覆盖的人工校对"},
                        {"originalText", "旧原文"}});
    QJsonObject page{{"pageType", "video"},
                     {"pageUrl", url},
                     {"loggedIn", true},
                     {"profile", QJsonObject{{"profileUrl", author}}},
                     {"items", QJsonArray{QJsonObject{{"contentId", id},
                                                      {"sourceUrl", url},
                                                      {"title", "新标题"}}}}};
    QVERIFY_EXCEPTION_THROWN(
        sourceCapture::mergeDetail(store, page, author, id, "本次处理"),
        std::runtime_error);
    QCOMPARE(store.read("collections")[0].toObject(), original);
  }
};
QTEST_GUILESS_MAIN(SourceCaptureTests)
#include "source_capture_tests.moc"
