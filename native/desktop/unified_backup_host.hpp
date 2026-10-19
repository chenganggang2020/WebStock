#pragma once
#include "unified_backup_files.hpp"
#include "unified_backup_adapters.hpp"
#include "watchlist_workspace_store.hpp"
#include "sector_leader_store.hpp"
#include "recent_store.hpp"
#include "local_candidate_store.hpp"
#include "candidate_restore.hpp"
#include "business_restore_store.hpp"
#include "industry_archive_store.hpp"
#include "legacy_industry_source.hpp"

namespace unifiedBackup {
struct Paths {QString groups,leaders,recent,candidates,receipts,background,business;};
using SaveGroups=std::function<QJsonObject(QJsonObject,QJsonObject)>;
// Use on one root-owned lane shared with all authoritative roster/group writers.
class Host final {
 Paths paths;QString producer;QList<Adapter> adapters;
 std::shared_ptr<FileJournal> journal;std::shared_ptr<Coordinator> core;
public:
 Host(Paths p,QString version,ReadObject freshInputs,SaveGroups saveGroups,QJsonArray selectedCandidates={},QJsonArray selectedBackground={},QStringList selectedIndustry={}):paths(std::move(p)),producer(std::move(version)){
  auto groupPath=paths.groups;
  ReadObject read=freshInputs?ReadObject([groupPath,freshInputs]{return WatchlistWorkspaceStore::readExisting(groupPath,freshInputs())["snapshot"].toObject();}):ReadObject{};
  Confirm save=(freshInputs&&saveGroups)?Confirm([freshInputs,saveGroups](QJsonObject change){return saveGroups(change,freshInputs());}):Confirm{};
  auto leadersStore=std::make_shared<sectorLeader::Store>(paths.leaders);
  auto recentStore=std::make_shared<RecentStore>(paths.recent);
  auto backgroundPath=paths.background.isEmpty()?QFileInfo(paths.candidates).absolutePath()+"/local-candidate-background-v2.sqlite":paths.background;
  auto frozen=::candidateRestore::adapter(paths.candidates,false,selectedCandidates);
  auto backgrounds=::candidateRestore::adapter(backgroundPath,true,selectedBackground);
  auto businessDomain=business();
  if(!paths.business.isEmpty()){auto store=std::make_shared<::businessRestore::Store>(paths.business);businessDomain=business([store]{return store->capture();},[store](QJsonObject input,QJsonObject before){auto p=store->preview(input,before);need(p["issues"].toArray().isEmpty(),::businessRestore::describePreview(p));return p;},[store](QJsonObject p){return store->commit(p);},[store](QJsonObject p,QJsonObject r,QJsonObject after){return store->verify(p,r,after);});}
  adapters={groups(read,save),leaders([leadersStore]{return leadersStore->read();},[leadersStore](QJsonObject preview){return leadersStore->importPreview(preview);}),
    restorableRecent([recentStore]{return recentStore->restoreSnapshot();},[recentStore](QJsonObject p,QJsonObject before){return recentStore->previewRestore(p,before);},[recentStore](QJsonObject p){return recentStore->commitRestore(p);},[recentStore](QJsonObject p,QJsonObject r,QJsonObject after){return recentStore->verifyRestore(p,r,after);}),frozen,backgrounds,paths.business.isEmpty()?industryArchive::unavailableAdapter():industryArchive::Store::adapter(paths.business,selectedIndustry),businessDomain,observations([leadersStore]{return leadersStore->restoreSnapshot();},[leadersStore](QJsonObject p,QJsonObject before){return leadersStore->previewRestore(p,before);},[leadersStore](QJsonObject p){return leadersStore->commitRestore(p);},[leadersStore](QJsonObject p,QJsonObject r,QJsonObject after){return leadersStore->verifyRestore(p,r,after);})};
  journal=std::make_shared<FileJournal>(FileJournal::newPath(paths.receipts));
  core=std::make_shared<Coordinator>(producer,adapters,Journal{[j=journal](QJsonObject v){j->save(v);},[j=journal]{return j->load();}});
 }
 std::shared_ptr<Coordinator> coordinator()const{return core;}
 QString receiptPath()const{return journal->path();}
 QByteArray readImport(QString path)const{
  QFile file(path);need(file.open(QIODevice::ReadOnly),"产业/统一备份文件不可读");auto header=file.read(16);file.close();
  if(header==QByteArray("SQLite format 3\0",16))return encode(industryArchive::sourceBundle(industryArchive::oldSqliteSource(path,paths.business)));
  auto bytes=boundedRead(path,BUNDLE_LIMIT);need(QString::fromUtf8(bytes).toUtf8()==bytes,"备份UTF8损坏");watchlistBackup::JsonGate{QString::fromUtf8(bytes)}.run();auto object=QJsonDocument::fromJson(bytes).object();
  if(object["schema"]=="native-unified-backup/v1"){decode(bytes);return bytes;}return encode(industryArchive::sourceBundle(QString::fromUtf8(bytes)));
 }
 QJsonObject exportPreview(QByteArray bytes)const{return exportSummary(bytes);}
 void saveExportNew(QString path,QByteArray bytes)const{exportNewVerified(path,bytes);}
 QJsonObject inspectReceipt(QString path)const{
  auto owned=FileJournal::inspectedPath(paths.receipts,path);
  Coordinator reader(producer,adapters,Journal{[](QJsonObject){need(false,"历史回执只读，禁止继续执行");},[owned]{return decodeReceipt(boundedRead(owned,JOURNAL_LIMIT));}});
  return reader.rereadReceipt();
 }
};
}
