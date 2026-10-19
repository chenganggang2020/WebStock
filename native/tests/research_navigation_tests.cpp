#include "business_pages.hpp"
#include <QtWidgets>
#include <iostream>

static void need(bool value, const char* message) {
  if (!value) throw std::runtime_error(message);
}
int main(int argc, char** argv) {
  QApplication app(argc, argv);
  try {
    QTemporaryDir directory;
    auto store = std::make_shared<BusinessStore>(directory.filePath("business.sqlite"));
    auto first = store->save("docs", {{"title", "第一次处理"}, {"text", "第一份校对原文"}});
    auto second = store->save("docs", {{"title", "第二次处理"}, {"text", "第二份校对原文"}});
    std::unique_ptr<QWidget> workspace(researchPage(store, nullptr));
    auto body = workspace->findChild<QPlainTextEdit*>("evidenceText");
    auto title = workspace->findChild<QLineEdit*>("evidenceTitle");
    auto state = workspace->findChild<QLabel*>("evidenceState");
    auto save = workspace->findChild<QPushButton*>("saveEvidence");
    auto discard = workspace->findChild<QPushButton*>("discardEvidenceDraft");
    openResearchDocument(workspace.get(), first);
    need(body->toPlainText() == first["text"].toString(), "exact first document not loaded");
    title->setText("未保存草稿");
    bool refused = false;
    try { openResearchDocument(workspace.get(), second); } catch (...) { refused = true; }
    need(refused && title->text() == "未保存草稿" && body->toPlainText() == first["text"].toString(),
         "external navigation replaced unsaved research draft");
    discard->click();
    openResearchDocument(workspace.get(), second);
    need(body->toPlainText() == second["text"].toString(), "exact second document not loaded");
    auto changed = second; changed["text"] = "其他操作更新过的原文";
    changed = store->save("docs", changed);
    refused = false;
    try { openResearchDocument(workspace.get(), second); } catch (...) { refused = true; }
    need(refused && body->toPlainText() == second["text"].toString(), "stale source snapshot accepted");
    title->setText("迟到的编辑"); save->click();
    need(state->text().contains("其他操作") && title->text() == "迟到的编辑", "stale save did not preserve draft");
    need(store->read("docs")[1].toObject()["text"] == changed["text"] ||
         store->read("docs")[0].toObject()["text"] == changed["text"], "latest source text overwritten");
    discard->click(); openResearchDocument(workspace.get(), changed);
    body->setPlainText("手动校对完成"); save->click();
    need(state->text().contains("已保存"), "legitimate same-baseline edit blocked");
    auto missing = changed; missing["id"] = "absent";
    refused = false;
    try { openResearchDocument(workspace.get(), missing); } catch (...) { refused = true; }
    need(refused && body->toPlainText() == "手动校对完成", "missing id opened wrong document");
    std::cout << "PASS exact research navigation, unsaved-draft protection, stale snapshot/save refusal and valid editing\n";
  } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
  return 0;
}
