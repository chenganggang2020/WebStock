#include <QtWidgets>
#include <QTemporaryDir>
#include <QtSql>
#include "source_analysis_packet.hpp"
#include "source_handoff_store.hpp"
#include "source_analysis_page.hpp"
#include "source_handoff_page.hpp"
#include "collection_page.hpp"
#include "collection_pipeline.hpp"
namespace {
void check(bool b,const char* message){if(!b)throw std::runtime_error(message);}
template<class F> void rejects(F f){bool denied=false;try{f();}catch(const std::exception&){denied=true;}check(denied,"risk operation should be rejected");}
QPushButton* button(QWidget* p,const QString& label){for(auto b:p->findChildren<QPushButton*>())if(b->text()==label)return b;throw std::runtime_error("button missing");}
}
int main(int argc,char** argv){QApplication app(argc,argv);QCoreApplication::setOrganizationName("NativeHandoffTests");QCoreApplication::setApplicationName("SourceAnalysisHandoff");
try {
  QTemporaryDir dir;check(dir.isValid(),"isolated directory failed");
  auto business=std::make_shared<BusinessStore>(dir.filePath("business.sqlite"));
  auto a=business->save("collections",{{"title","日期边界原稿"},{"text",QString(10000,'x')+"完整尾文"},{"originalText","识别原稿"},{"sourceUrl","https://someone:secret@www.douyin.com/video/7259684447530929443?signature=secret#token"},{"author","受控作者"},{"publishedAt","2026-10-11T16:00:00Z"},{"status","imported"}});
  auto b=business->save("collections",{{"title","未知日期"},{"text","页面文字"},{"status","imported"},{"author","受控作者"}});
  const auto before=business->read("collections");
  auto packet=sourceAnalysis::build("受控作者",before,{{"mode","date"},{"purpose","risks"},{"from","2026-10-12"},{"to","2026-10-12"}});
  check(packet["itemCount"].toInt()==1,"Beijing date boundary/unknown must be correct");
  check(packet["markdown"].toString().contains("完整尾文")&&!packet["markdown"].toString().contains("signature")&&!packet["markdown"].toString().contains("secret@"),"full body/public URL contract failed");
  auto ref=packet["sourceReferences"].toArray()[0].toObject();check(sourceAnalysis::exactSource(ref,before)==a,"initial exact source missing version failed");
  auto changed=a;changed["executionRevision"]="restored";rejects([&]{sourceAnalysis::exactSource(ref,QJsonArray{changed});});changed=a;changed["text"]="later edit";rejects([&]{sourceAnalysis::exactSource(ref,QJsonArray{changed});});
  check(sourceAnalysis::extractResult("prefix WEBSTOCK_RESULT_START 结论 WEBSTOCK_RESULT_END suffix")["text"]=="结论","result marker parsing");
  check(sourceAnalysis::extractResult("WEBSTOCK_STOCK_START 股票 WEBSTOCK_STOCK_END")["text"]=="股票","typed marker parsing");
  rejects([&]{sourceAnalysis::extractResult("WEBSTOCK_RESULT_START   WEBSTOCK_RESULT_END");});
  auto huge=a;huge["text"]=QString(sourceAnalysis::ByteLimit+1,'x');rejects([&]{sourceAnalysis::build("",QJsonArray{huge},{{"mode","all"}});});
  SourceHandoffStore history(business->filePath()+".source-handoff.sqlite");
  rejects([&]{history.saveResult(packet,"empty","");});check(history.page().isEmpty(),"empty result wrote history");
  auto saved=history.saveResult(packet,"手动资料","raw WEBSTOCK_RESULT_START 保存结果 WEBSTOCK_RESULT_END tail");
  history.saveDraft({{"packet",packet},{"answer","未保存回填草稿"},{"title","草稿标题"}});
  SourceHandoffStore reopened(business->filePath()+".source-handoff.sqlite");check(reopened.detail(saved["id"].toString())["rawResult"].toString().endsWith("tail")&&reopened.draft()["answer"]=="未保存回填草稿","reopen lost full answer or draft");
  const auto oldDraft=reopened.draft();auto newDraft=oldDraft;newDraft["title"]="其他入口修改";
  const auto updated=reopened.saveDraft(newDraft,oldDraft["draftRevision"].toString());
  rejects([&]{history.saveDraft(oldDraft,oldDraft["draftRevision"].toString());});check(history.draft()==updated,"stale draft overwrote newer entry");
  const auto legacy=QJsonDocument(QJsonArray{QJsonObject{{"title","旧条目"},{"prompt","旧完整提示"},{"result","旧完整结果"},{"kind","paper-monitor"},{"context",QJsonObject{{"source","old"}}},{"savedAt","2025-01-01T00:00:00Z"}}}).toJson();
  auto preview=history.previewImport(legacy,"legacy.json");if(preview["newCount"].toInt()!=1)qCritical()<<QJsonDocument(preview).toJson();check(preview["newCount"].toInt()==1&&history.page().size()==1,"preview must not write");
  check(history.merge(preview)["added"].toInt()==1&&history.merge(preview)["duplicate"].toInt()==1,"merge idempotency failed");
  auto incoming=QJsonDocument::fromJson(legacy).array();auto original=incoming[0].toObject();original["result"]="conflicting answer";incoming[0]=original;
  preview=history.previewImport(QJsonDocument(incoming).toJson(),"legacy.json");check(preview["conflictCount"].toInt()==1&&history.merge(preview)["conflict"].toInt()==1,"conflict must keep existing");
  SourceHandoffStore other(dir.filePath("other.sqlite"));check(other.merge(other.previewImport(history.backup(),"backup.json"))["added"].toInt()==2,"backup reopen/cross-end schema failed");
  auto invalid=history.previewImport("[{\"title\":\"bad\",\"result\":null}]","bad.json");rejects([&]{history.merge(invalid);});check(history.page().size()==2,"invalid preview partially wrote");
  auto analysis=sourceAnalysisPage(business);check(analysis->findChild<QPlainTextEdit*>("sourceAnalysisAnswer")->toPlainText()=="未保存回填草稿","page draft restore failed");
  auto secondPage=sourceAnalysisPage(business);secondPage->findChild<QPlainTextEdit*>("sourceAnalysisAnswer")->setPlainText("另一入口新草稿");analysis->findChild<QPlainTextEdit*>("sourceAnalysisAnswer")->setPlainText("旧页草稿");check(history.draft()["answer"]=="另一入口新草稿","stale UI silently replaced draft");button(analysis,"重读共享草稿（取最新）")->click();check(analysis->findChild<QPlainTextEdit*>("sourceAnalysisAnswer")->toPlainText()=="另一入口新草稿","explicit shared draft reload failed");delete secondPage;
  button(analysis,"新建分析（清当前草稿）")->click();button(analysis,"生成完整材料")->click();analysis->findChild<QPlainTextEdit*>("sourceAnalysisAnswer")->setPlainText("WEBSTOCK_RESULT_START UI保存 WEBSTOCK_RESULT_END");button(analysis,"保存交接记录")->click();check(history.page().size()==3,"native UI save failed");button(analysis,"保存交接记录")->click();check(history.page().size()==3,"double click duplicated save");delete analysis;
  auto restoredPage=sourceAnalysisPage(business);check(restoredPage->findChild<QPlainTextEdit*>("sourceAnalysisAnswer")->toPlainText().contains("UI保存"),"page reopen lost draft");delete restoredPage;
  CollectionPipeline pipeline(business,dir.filePath("media"));auto collection=collectionPage(business,nullptr,&pipeline);
  openCollectionDocument(collection,a);check(collection->findChild<QLineEdit*>("collectionTitle")->text()==a["title"].toString(),"collection exact open failed");
  collection->findChild<QPlainTextEdit*>("collectionText")->setPlainText("未保存校对");rejects([&]{openCollectionDocument(collection,b);});check(collection->findChild<QPlainTextEdit*>("collectionText")->toPlainText()=="未保存校对","opening replaced unsaved draft");delete collection;
  check(business->read("collections")==before,"analysis/navigation mutated collection store");
  qInfo("PASS source analysis/handoff: date/fulltext/25MiB/manual save/reopen/import preview/conflict/backup/exact-source/unsaved-editor; isolated only");return 0;
}catch(const std::exception& e){qCritical()<<e.what();return 1;}}
