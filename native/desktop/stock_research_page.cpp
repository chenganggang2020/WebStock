#include "stock_research_page.hpp"
#include "compact_actions.hpp"
#include "business_search_model.hpp"
#include "research_presentation.hpp"
#include <QTextBrowser>
#include <QLineEdit>
#include <QPlainTextEdit>
#include <QListWidget>
#include <QLabel>
#include <QPushButton>
#include <QTabWidget>
#include <QBoxLayout>
#include <QSplitter>
#include <QScrollArea>
#include <QSaveFile>
#include <QFileDialog>
#include <QFile>
#include <QTimer>
#include <QComboBox>
#include <QStackedWidget>
#include <QHideEvent>
#include <QSignalBlocker>
#include "stock_profile_service.hpp"
#include "page_snapshot_reader.hpp"
namespace {
QString viewHash(const QByteArray& raw){return QString::fromLatin1(QCryptographicHash::hash(raw,QCryptographicHash::Sha256).toHex());}
QJsonObject checkedView(QJsonObject view){
 stockResearch::need(view["schema"]=="stock-research-view/v1"&&view["drafts"].isObject(),"研究视图状态无效，原件保留");
 const auto selected=view["instrumentId"].toString();
 if(!selected.isEmpty()){
  stockResearch::identity(selected);
  stockResearch::bundle(selected,view["current"].toObject());
  if(!view["reading"].toObject().isEmpty())stockResearch::bundle(selected,view["reading"].toObject());
 }
 for(auto key:view["drafts"].toObject().keys()){
  stockResearch::identity(key);auto draft=view["drafts"].toObject()[key].toObject();
  stockResearch::need(draft["text"].isString()&&draft["baseline"].isObject(),"研究草稿无效，原件保留");
  if(!draft["baseline"].toObject().isEmpty()){auto baseline=stockResearch::validate("notes",draft["baseline"].toObject());stockResearch::need(baseline["id"]==key,"草稿基线身份不符");}
 }
 if(view["pending"].toBool()){
  stockResearch::decode(stockResearch::bytes(view["incoming"]));
  stockResearch::decode(stockResearch::bytes(view["baseline"]));
 }
 return view;
}
QByteArray readViewBytes(QIODevice& file){
  constexpr qint64 limit=64*1024*1024;QByteArray raw;char block[64*1024];
  for(;;){
    const auto got=file.read(block,qMin<qint64>(sizeof(block),limit+1-raw.size()));
    stockResearch::need(got>=0,"研究视图读取失败，原件保留");
    if(!got){stockResearch::need(file.atEnd(),"研究视图读取失败，原件保留");break;}
    raw.append(block,got);stockResearch::need(raw.size()<=limit,"研究视图长度/UTF-8无效");
  }
  return raw;
}
QJsonObject readView(const QString& path,QString& hash){
 if(!QFileInfo::exists(path)){hash.clear();return {};}
 stockResearch::need(QFileInfo(path).isFile()&&!QFileInfo(path).isSymLink(),"研究视图不是普通文件，原件保留");
 QFile file(path);stockResearch::need(file.open(QIODevice::ReadOnly)&&file.size()<=64*1024*1024,"研究视图不可读或超过64MB，原件保留");
 auto raw=readViewBytes(file);stockResearch::need(raw.size()<=64*1024*1024&&QString::fromUtf8(raw).toUtf8()==raw,"研究视图长度/UTF-8无效");
 watchlistBackup::JsonGate{QString::fromUtf8(raw)}.run();
 QJsonParseError error;auto parsed=QJsonDocument::fromJson(raw,&error);
 stockResearch::need(error.error==QJsonParseError::NoError&&parsed.isObject(),"研究视图JSON无效，原件保留");
 auto result=checkedView(parsed.object());hash=viewHash(raw);return result;
}
}
StockResearchPage::StockResearchPage(std::shared_ptr<StockResearchStore> s,std::function<QJsonObject(QString)> read,std::function<void(QJsonObject)> source,std::function<void(QString)> instrument,QWidget* parent):QWidget(parent),store(std::move(s)),existingSnapshot(std::move(read)),openSource(std::move(source)),openInstrument(std::move(instrument)){
 setObjectName("stockResearchPage");auto layout=new QVBoxLayout(this);auto identityRow=new QHBoxLayout;layout->addLayout(identityRow);identityInput=new QLineEdit;identityInput->setPlaceholderText("完整身份，例如 SH:stock:600001");identityInput->setObjectName("stockResearchIdentity");identityRow->addWidget(identityInput,1);auto choose=new QPushButton("打开本机研究");choose->setObjectName("stockResearchSelect");identityRow->addWidget(choose);connect(choose,&QPushButton::clicked,this,[this]{setInstrument(identityInput->text().trimmed());});auto actions=new QHBoxLayout;layout->addLayout(actions);
 auto button=[&](QString label,QString tag,std::function<void()> fn){auto b=new QPushButton(label);b->setObjectName(tag);actions->addWidget(b);connect(b,&QPushButton::clicked,this,[this,fn]{safe(fn);});};button("重读已有资料","stockResearchReload",[this]{refreshSources();});button("回行情","stockResearchChart",[this]{stockResearch::identity(id);if(openInstrument)openInstrument(id);});button("导入预览","stockResearchImport",[this]{importFile();});button("导出研究备份","stockResearchExport",[this]{exportFile();});
 auto*compact=new CompactActions;layout->insertLayout(0,compact);layout->removeItem(identityRow);compact->takeFrom(identityRow);delete identityRow;layout->removeItem(actions);compact->takeFrom(actions);delete actions;identityInput->setMinimumWidth(180);identityInput->setMaximumWidth(280);tabs=new QTabWidget;tabs->setObjectName("stockResearchTabs");layout->addWidget(tabs,1);auto sourcePage=new QWidget;auto sl=new QVBoxLayout(sourcePage);auto split=new QSplitter;sl->addWidget(split,1);documents=new QListWidget;documents->setObjectName("stockResearchDocuments");reader=new QPlainTextEdit;reader->setReadOnly(true);reader->setObjectName("stockResearchOriginal");split->addWidget(documents);split->addWidget(reader);split->setStretchFactor(1,3);auto locate=new QPushButton("定位选中来源原记录");locate->setObjectName("stockResearchOpenSource");sl->addWidget(locate);auto* details=new QPushButton("来源详情");details->setObjectName("stockResearchDocumentDetails");sl->addWidget(details);connect(details,&QPushButton::clicked,this,[this]{int n=documents->currentRow();auto docs=reading["documents"].toArray();reader->setPlainText(stockResearch::pretty(n>=0&&n<docs.size()?docs[n].toObject():reading));});connect(documents,&QListWidget::currentRowChanged,this,[this](int n){if(n<0)return;auto docs=reading["documents"].toArray();if(n<docs.size()){auto d=docs[n].toObject();reader->setPlainText(d["title"].toString()+"\n\n"+d["text"].toString());reader->setToolTip("完整来源字段可通过「来源详情」查看");}});connect(locate,&QPushButton::clicked,this,[this]{safe([this]{auto n=documents->currentRow();auto docs=reading["documents"].toArray();stockResearch::need(n>=0&&n<docs.size(),"先选择明确关联的来源记录");stockResearch::need(bool(openSource),"宿主未接来源定位");openSource(docs[n].toObject());});});tabs->addTab(sourcePage,"资料 / 原文");
 auto notesPage=new QWidget;auto nl=new QVBoxLayout(notesPage);noteEditor=new QPlainTextEdit;noteEditor->setObjectName("stockResearchNote");noteEditor->setPlaceholderText("手动研究笔记；没有自动模型结果");nl->addWidget(noteEditor,1);auto notesActions=new QHBoxLayout;nl->addLayout(notesActions);auto noteButton=[&](QString label,QString tag,std::function<void()> fn){auto b=new QPushButton(label);b->setObjectName(tag);notesActions->addWidget(b);connect(b,&QPushButton::clicked,this,[this,fn]{safe(fn);});};noteButton("保存笔记","stockResearchSaveNote",[this]{saveNote();});noteButton("显式放弃草稿","stockResearchDiscardNote",[this]{discardNote();});noteButton("保存当前资料研究快照","stockResearchSaveSnapshot",[this]{saveSnapshot();});tabs->addTab(notesPage,"手动笔记");connect(noteEditor,&QPlainTextEdit::textChanged,this,[this]{captureDraft();});
 history=new QListWidget;history->setObjectName("stockResearchHistory");tabs->addTab(history,"本机快照");connect(history,&QListWidget::itemClicked,this,[this](QListWidgetItem* item){safe([this,item]{auto key=item->data(Qt::UserRole).toString();for(auto v:researchSnapshot["snapshots"].toArray()){auto r=v.toObject();if(r["id"]==key){snapshotReader->cancel();setProperty("stockResearchLoading",false);cancelProfile();profileHistorical=true;showBundle(r["bundle"].toObject());reader->setPlainText("历史冻结快照 · 本机保存："+r["capturedAt"].toString()+"\n当时手动笔记\n"+r["note"].toString()+"\n\n"+stockResearch::overview(reading));tabs->setCurrentIndex(0);return;}}});});
 auto previewPage=new QWidget;auto pl=new QVBoxLayout(previewPage);previewReader=new QPlainTextEdit;previewReader->setReadOnly(true);previewReader->setObjectName("stockResearchPreview");pl->addWidget(previewReader,1);auto pa=new QHBoxLayout;pl->addLayout(pa);confirm=new QPushButton("确认合并，保留冲突");confirm->setObjectName("stockResearchConfirm");confirm->setEnabled(false);auto cancel=new QPushButton("取消预览");cancel->setObjectName("stockResearchCancel");pa->addWidget(confirm);pa->addWidget(cancel);connect(confirm,&QPushButton::clicked,this,[this]{confirmImport();});connect(cancel,&QPushButton::clicked,this,[this]{cancelImport();});tabs->addTab(previewPage,"导入预览");state=new QLabel("先明确完整证券身份；本机已有数据和来源分别显示。");state->setWordWrap(true);state->setObjectName("stockResearchState");layout->addWidget(state);profileUi();timer=new QTimer(this);timer->setSingleShot(true);connect(timer,&QTimer::timeout,this,[this]{persist();});diskRestore();
}
StockResearchPage::~StockResearchPage(){if(snapshotReader)snapshotReader->cancel();cancelProfile();persist(false);}
void StockResearchPage::setLegacyProfileReader(std::function<QJsonObject(QString)> read){legacyProfileReader=std::move(read);if(!profileHistorical)requestSnapshot(false,true);}
void StockResearchPage::setSnapshotReader(std::function<QJsonObject(QString)> read){existingSnapshot=std::move(read);snapshotFactory={};}
void StockResearchPage::setSnapshotReaderFactory(std::function<std::function<QJsonObject(QString)>()> factory){snapshotFactory=std::move(factory);}
void StockResearchPage::showCompanyProfile(){tabs->setCurrentIndex(4);}
void StockResearchPage::setProfileAccess(bool allow,QNetworkAccessManager* fake){cancelProfile();if(profiles)delete profiles;profiles=new StockProfileService(store->filePath()+".profiles",allow,this,fake);profileEnabled=allow||fake;if(profileSource&&profileSource->findText(businessSearch::legacyLabel)<0)profileSource->addItem(businessSearch::legacyLabel);renderProfile();}
void StockResearchPage::safe(std::function<void()> fn){try{fn();}catch(const std::exception& e){state->setText(QString::fromUtf8(e.what()));}}
void StockResearchPage::setInstrument(QString next){safe([this,next]{stockResearch::identity(next);if(next==id){identityInput->setText(id);return;}cancelProfile();profileHistorical=false;++selectionVersion;id=next;identityInput->setText(id);noteReady=false;loadNote();current={{"id",id}};showBundle(current);viewDirty=true;refreshSources();});}
void StockResearchPage::loadNote(){noteBaseline={};for(auto value:researchSnapshot["notes"].toArray())if(value.toObject()["id"]==id)noteBaseline=value.toObject();const auto draft=drafts.value(id).toObject();filling=true;noteEditor->setPlainText(draft.isEmpty()?noteBaseline.value("text").toString():draft.value("text").toString());if(!draft.isEmpty())noteBaseline=draft.value("baseline").toObject();filling=false;}
void StockResearchPage::showBundle(const QJsonObject& b){reading=b;documents->clear();for(auto v:b["documents"].toArray()){auto d=v.toObject();auto* item=new QListWidgetItem(d["title"].toString(),documents);item->setToolTip(d["id"].toString());}reader->setPlainText(researchPresentation::overview(b));renderProfile();}
void StockResearchPage::refreshSources(){stockResearch::identity(id);cancelProfile();profileHistorical=false;requestSnapshot(true);}
void StockResearchPage::captureDraft(){if(filling||id.isEmpty())return;if(!noteReady)provisionalDrafts.insert(id);drafts[id]=QJsonObject{{"text",noteEditor->toPlainText()},{"baseline",noteBaseline}};viewDirty=true;state->setText("有未保存笔记草稿；明确保存或放弃，换证券不覆盖。");timer->start(300);}
void StockResearchPage::saveNote(){stockResearch::need(noteReady,"笔记基线仍在读取，请稍后明确保存");noteBaseline=store->saveNote(id,noteEditor->toPlainText(),noteBaseline);drafts.remove(id);provisionalDrafts.remove(id);persist();state->setText("手动笔记已保存；未改账户、自选或任何旧报告。");}
void StockResearchPage::discardNote(){stockResearch::identity(id);drafts.remove(id);provisionalDrafts.remove(id);noteReady=false;viewDirty=true;requestSnapshot();state->setText("草稿已显式放弃，正在读取当前已保存笔记。");}
void StockResearchPage::saveSnapshot(){stockResearch::need(noteReady&&!property("stockResearchLoading").toBool(),"研究资料仍在后台读取；请稍后明确保存快照");auto r=stockResearch::snapshot(QUuid::createUuid().toString(QUuid::WithoutBraces),id,reading.isEmpty()?current:reading,noteEditor->toPlainText(),QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));store->saveSnapshot(r);historyReload();state->setText("研究快照已保存：当前显示资料与当前手动文本，源时点不变；笔记草稿未自动提交。");}
void StockResearchPage::historyReload(){requestSnapshot();}
void StockResearchPage::renderHistory(){history->clear();auto rows=researchSnapshot["snapshots"].toArray();for(int i=rows.size()-1;i>=0;--i){auto r=rows[i].toObject();if(r["instrumentId"]!=id)continue;auto item=new QListWidgetItem(r["capturedAt"].toString()+" · "+r["id"].toString(),history);item->setData(Qt::UserRole,r["id"].toString());}}
void StockResearchPage::previewImport(const QByteArray& input){cancelImport();try{incoming=stockResearch::decode(input);importBaseline=store->backup();auto p=stockResearch::preview(incoming,importBaseline);previewReader->setPlainText("新增 / 同文 / 冲突预览\n"+stockResearch::pretty(p)+"\n完整待导入原文\n"+stockResearch::pretty(incoming));pending=true;stockResearch::need(persist(),"预览状态保存失败或超过64MB，未启用确认");confirm->setEnabled(true);tabs->setCurrentIndex(3);}catch(const std::exception& e){cancelImport();state->setText(QString::fromUtf8(e.what()));}}
void StockResearchPage::confirmImport(){if(!pending)return;safe([this]{store->merge(incoming,importBaseline);cancelImport();if(!id.isEmpty()){if(!drafts.contains(id))loadNote();historyReload();}state->setText("研究备份已合并，冲突保留；当前笔记草稿未覆盖，历史快照未补新行情。");});}
void StockResearchPage::cancelImport(){++importVersion;pending=false;incoming={};importBaseline={};confirm->setEnabled(false);previewReader->clear();persist();}
void StockResearchPage::importFile(){auto path=QFileDialog::getOpenFileName(this,"选择本地个股研究备份",{},"JSON (*.json)");if(path.isEmpty())return;QFile f(path);stockResearch::need(f.open(QIODevice::ReadOnly)&&f.size()<=32*1024*1024,"文件不可读或超过32MB");previewImport(f.readAll());}
void StockResearchPage::exportFile(){auto path=QFileDialog::getSaveFileName(this,"导出个股研究备份",{},"JSON (*.json)");if(path.isEmpty())return;auto bytes=QJsonDocument(store->backup()).toJson();QSaveFile f(path);stockResearch::need(f.open(QIODevice::WriteOnly)&&f.write(bytes)==bytes.size()&&f.commit(),"导出失败，未替换原文件");state->setText("独立个股研究笔记和冻结快照已导出。");}
QJsonObject StockResearchPage::saveState()const{return {{"schema","stock-research-view/v1"},{"instrumentId",id},{"drafts",drafts},{"current",current},{"reading",reading},{"tab",tabs->currentIndex()},{"pending",pending},{"incoming",incoming},{"baseline",importBaseline},{"profileHistorical",profileHistorical},{"profileSource",profileSource?profileSource->currentText():QString("CompanySurvey")},{"profileOffset",profileOffset},{"profileOriginalMode",profileViews&&profileViews->currentIndex()==1}};}
void StockResearchPage::restoreState(const QJsonObject& s){safe([this,s]{cancelProfile();viewDirty=true;++selectionVersion;requestSnapshot(false,false,s);});}
bool StockResearchPage::persist(bool changed){
 if(changed)viewDirty=true;if(!viewDirty)return true;
 if(!viewLoaded||!viewWritable){state->setText("研究原视图尚未核验或已损坏；保留原件，当前草稿请明确另存。");return false;}
 if(!provisionalDrafts.isEmpty()){state->setText("笔记基线仍在读取；草稿保留在内存，暂不覆盖原视图。");return false;}
 auto bytes=QJsonDocument(saveState()).toJson();if(bytes.size()>64*1024*1024){state->setText("研究视图状态超过64MB，请先导出或缩小导入批次；未截断草稿。");return false;}
 const auto path=store->filePath()+".view.json";QFile before(path);
 if((QFileInfo::exists(path)&&(!before.open(QIODevice::ReadOnly)||before.size()>64*1024*1024||viewHash(before.readAll())!=viewBaseline))||(!QFileInfo::exists(path)&&!viewBaseline.isEmpty())){viewWritable=false;state->setText("研究原视图已变化；保留原件，未自动覆盖。");return false;}
 before.close();QSaveFile file(path);if(!file.open(QIODevice::WriteOnly)||file.write(bytes)!=bytes.size()||!file.commit()){state->setText("本机研究草稿状态保存失败，请明确另存笔记。");return false;}
 viewBaseline=viewHash(bytes);viewDirty=false;return true;
}
void StockResearchPage::diskRestore(){
 snapshotReader=new PageSnapshotReader(this,[]{return QJsonObject{};},[this](QJsonObject data,QString error){applySnapshot(std::move(data),std::move(error));});
 requestSnapshot();
}
void StockResearchPage::requestSnapshot(bool sources,bool legacyOnly,QJsonObject suppliedView){
 if(!snapshotReader)return;
 snapshotReader->cancel();lastSources=sources;lastLegacy=legacyOnly;lastViewInput=suppliedView;
 const auto path=store->filePath(),selected=id;const auto version=selectionVersion,importAt=importVersion;
 const auto profileAt=profileVersion;
 const bool needView=!viewLoaded||!suppliedView.isEmpty();
 auto sourceRead=sources&&snapshotFactory?snapshotFactory():existingSnapshot;
 auto legacyRead=legacyProfileReader;auto prior=current,priorReading=reading;const bool historical=profileHistorical;
 setProperty("stockResearchLoading",true);state->setText("正在后台读取本机研究资料；可切换证券或继续编辑草稿。");
 snapshotReader->request([path,selected,version,importAt,profileAt,needView,sources,legacyOnly,suppliedView,sourceRead,legacyRead,prior,priorReading,historical]{
  QJsonObject out{{"version",double(version)},{"importVersion",double(importAt)},{"profileVersion",double(profileAt)},{"sources",sources},{"needView",needView},{"explicitView",!suppliedView.isEmpty()}};
  QJsonObject view;QString baseline;
  if(needView)try{auto disk=readView(path+".view.json",baseline);view=suppliedView.isEmpty()?disk:checkedView(suppliedView);out["view"]=view;out["viewBaseline"]=baseline;}
   catch(const std::exception& e){out["viewError"]=QString::fromUtf8(e.what());}
  const auto target=selected.isEmpty()||!suppliedView.isEmpty()?view["instrumentId"].toString():selected;out["id"]=target;
  try{out["research"]=StockResearchStore::readSnapshot(path);}catch(const std::exception& e){out["researchError"]=QString::fromUtf8(e.what());}
  if(target.isEmpty())return out;
  QJsonObject bundle=needView&&view["instrumentId"]==target?view["current"].toObject():prior;
  if(bundle["id"]!=target)bundle={{"id",target}};
  if(sources){
   try{stockResearch::need(bool(sourceRead),"宿主未接本机快照");bundle=stockResearch::bundle(target,sourceRead(target));bundle.remove("acquisitionError");}
   catch(const std::exception&e){bundle["acquisitionError"]=QString::fromUtf8(e.what());}
   try{bundle["companyProfile"]=StockProfileCache(path+".profiles").capture(target,QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)).packet;bundle.remove("companyProfileError");}
   catch(const std::exception&e){bundle["companyProfileError"]=QString::fromUtf8(e.what());}
  }
  const bool frozen=needView&&view["instrumentId"]==target&&!sources?view["profileHistorical"].toBool():historical;
  if(legacyRead&&!frozen&&(sources||legacyOnly)){
   auto previous=bundle["legacyCompanyProfile"].toObject();
   try{auto raw=legacyRead(target);if(raw.isEmpty())bundle.remove("legacyCompanyProfile");else bundle["legacyCompanyProfile"]=businessSearch::legacyProfile(target,raw);bundle.remove("legacyCompanyProfileError");}
   catch(const std::exception&e){bundle.remove("legacyCompanyProfile");if(!previous.isEmpty())try{businessSearch::validateLegacy(target,previous);bundle["legacyCompanyProfile"]=previous;}catch(...){}bundle["legacyCompanyProfileError"]=QString::fromUtf8(e.what());}
  }
  out["current"]=stockResearch::bundle(target,bundle);
  auto displayed=bundle;
  if(!sources&&!(legacyOnly&&!historical)){
   if(needView&&view["instrumentId"]==target&&!view["reading"].toObject().isEmpty())displayed=view["reading"].toObject();
   else if(priorReading["id"]==target)displayed=priorReading;
  }
  out["reading"]=displayed;
  return out;
 });
}
void StockResearchPage::applySnapshot(QJsonObject result,QString error){
 setProperty("stockResearchLoading",false);
 if(!error.isEmpty()){state->setText("本机研究读取失败；原件及当前草稿保留："+error);return;}
 if(quint64(result["version"].toDouble())!=selectionVersion)return;
 const auto view=result["view"].toObject();
 if(result["needView"].toBool()){
  viewLoaded=true;viewError=result["viewError"].toString();viewWritable=viewError.isEmpty();viewBaseline=result["viewBaseline"].toString();
  if(viewWritable&&!view.isEmpty()){
   auto restored=view["drafts"].toObject();for(auto key:drafts.keys())restored[key]=drafts[key];drafts=restored;
   if(id.isEmpty()||result["explicitView"].toBool()){id=view["instrumentId"].toString();identityInput->setText(id);}
   if(view["instrumentId"]==id&&!result["sources"].toBool()){
    profileHistorical=view["profileHistorical"].toBool();profileOffset=qBound(0,view["profileOffset"].toInt(),8*stockProfile::limit);
    {QSignalBlocker block(profileSource);if(profileSource->findText(view["profileSource"].toString())>=0)profileSource->setCurrentText(view["profileSource"].toString());}
    profileViews->setCurrentIndex(view["profileOriginalMode"].toBool()?1:0);tabs->setCurrentIndex(qBound(0,view["tab"].toInt(),4));
   }
   if(result["explicitView"].toBool()&&quint64(result["importVersion"].toDouble())==importVersion){
    pending=false;incoming={};importBaseline={};confirm->setEnabled(false);previewReader->clear();
   }
   if(!pending&&view["pending"].toBool()&&quint64(result["importVersion"].toDouble())==importVersion){
    incoming=view["incoming"].toObject();importBaseline=view["baseline"].toObject();pending=true;
    previewReader->setPlainText("恢复原待确认预览\n"+stockResearch::pretty(stockResearch::preview(incoming,importBaseline))+"\n"+stockResearch::pretty(incoming));confirm->setEnabled(true);
   }
  }
 }
 if(result["id"].toString()!=id)return;
 if(!result.contains("researchError")){
  researchSnapshot=result["research"].toObject();noteReady=true;
  for(const auto& unresolved:provisionalDrafts){
   QJsonObject baseline;for(auto value:researchSnapshot["notes"].toArray())if(value.toObject()["id"]==unresolved)baseline=value.toObject();
   auto draft=drafts[unresolved].toObject();draft["baseline"]=baseline;drafts[unresolved]=draft;
  }
  provisionalDrafts.clear();
  if(!id.isEmpty())loadNote();renderHistory();
 }
 if(!id.isEmpty()){
  auto next=result["current"].toObject(),displayed=result["reading"].toObject();
  if(quint64(result["profileVersion"].toDouble())!=profileVersion&&current.value("id")==id)
   for(auto key:{"companyProfile","companyProfileError"}){
    if(current.contains(key)){next[key]=current.value(key);if(!profileHistorical)displayed[key]=current.value(key);}
    else{next.remove(key);if(!profileHistorical)displayed.remove(key);}
   }
  current=next;profileOffset=result["sources"].toBool()?0:profileOffset;showBundle(displayed);
 }
 state->setText(!viewError.isEmpty()?"原研究视图读取失败，已保护原件："+viewError:
   result.contains("researchError")?"研究库读取失败，当前草稿保留："+result["researchError"].toString():
   current.contains("acquisitionError")?"本机资料读取失败，保留当前快照："+current["acquisitionError"].toString():QString("本机资料已读取；手动草稿保持原样。"));
}

void StockResearchPage::profileUi(){
 profilePane=new QWidget;profilePane->setObjectName("stockResearchProfilePane");auto layout=new QVBoxLayout(profilePane);auto actions=new QHBoxLayout;layout->addLayout(actions);profileUpdate=new QPushButton("更新公司资料");profileUpdate->setObjectName("stockResearchProfileUpdate");profileCancel=new QPushButton("取消读取");profileCancel->setObjectName("stockResearchProfileCancel");auto summary=new QPushButton("主营概览"),original=new QPushButton("来源详情");summary->setObjectName("stockResearchProfileSummaryMode");original->setObjectName("stockResearchProfileOriginalMode");for(auto b:{profileUpdate,profileCancel,summary,original})actions->addWidget(b);
 profileViews=new QStackedWidget;layout->addWidget(profileViews,1);profileSummary=new QTextBrowser;profileSummary->setOpenLinks(false);profileSummary->document()->setDocumentMargin(18);profileSummary->setObjectName("stockResearchProfileSummary");profileViews->addWidget(profileSummary);auto raw=new QWidget;auto rl=new QVBoxLayout(raw);profileSource=new QComboBox;profileSource->setObjectName("stockResearchProfileSource");profileSource->addItems(stockProfile::kinds);rl->addWidget(profileSource);profileOriginal=new QPlainTextEdit;profileOriginal->setReadOnly(true);profileOriginal->setObjectName("stockResearchProfileOriginal");rl->addWidget(profileOriginal,1);auto paging=new QHBoxLayout;rl->addLayout(paging);profilePrevious=new QPushButton("上一段原字段");profilePrevious->setObjectName("stockResearchProfilePrevious");profileNext=new QPushButton("下一段原字段");profileNext->setObjectName("stockResearchProfileNext");paging->addWidget(profilePrevious);paging->addWidget(profileNext);profileViews->addWidget(raw);tabs->addTab(profilePane,"公司主营概况");
 connect(profileUpdate,&QPushButton::clicked,this,[this]{safe([this]{updateProfile();});});connect(profileCancel,&QPushButton::clicked,this,[this]{cancelProfile(true);});connect(summary,&QPushButton::clicked,this,[this]{profileViews->setCurrentIndex(0);});connect(original,&QPushButton::clicked,this,[this]{profileViews->setCurrentIndex(1);renderProfileOriginal();});connect(profileSource,&QComboBox::currentTextChanged,this,[this]{profileOffset=0;renderProfileOriginal();});connect(profilePrevious,&QPushButton::clicked,this,[this]{profilePageText(-1);});connect(profileNext,&QPushButton::clicked,this,[this]{profilePageText(1);});connect(tabs,&QTabWidget::currentChanged,this,[this](int index){if(index!=4)cancelProfile();});setProfileAccess(false);
}
void StockResearchPage::renderProfile(){
 if(!profileSummary)return;auto p=reading.value("companyProfile").toObject(),old=reading.value("legacyCompanyProfile").toObject();QString nativeText,legacyText;bool nativeData=false,legacyValid=false;
 try{if(p.isEmpty())nativeText=reading.contains("companyProfileError")?"本机主营缓存读取失败，原件保留："+reading.value("companyProfileError").toString():"尚无原生F10响应；可在本页明确更新公司公开源。";else{stockProfile::validate(id,p);nativeText=stockProfile::overview(p);for(auto kind:stockProfile::kinds)nativeData|=p.value("sources").toObject().value(kind).toObject().value("data").isObject();}}
 catch(const std::exception& e){nativeText="原生主营资料不能解释："+QString::fromUtf8(e.what());}
 try{if(!old.isEmpty()){businessSearch::validateLegacy(id,old);legacyValid=true;legacyText=businessSearch::legacyOverview(old);}if(reading.contains("legacyCompanyProfileError"))legacyText+="\n旧资料重读失败，保留已显示原摘录："+reading.value("legacyCompanyProfileError").toString();}
 catch(const std::exception& e){legacyText="旧主营摘录不能解释，原文保留："+QString::fromUtf8(e.what());}
 auto title=profileHistorical?QString("历史冻结公司资料 · 原来源时点保持\n\n"):QString{};if(id.isEmpty())title+="先选择完整证券身份。\n";QString content;try{if(nativeData){stockProfile::validate(id,p);content=researchPresentation::company(id,p,profileHistorical);}else if(legacyValid){auto raw=old["row"].toObject()["legacy"].toObject()["payload_json"].toString();content=researchPresentation::company(id,QJsonDocument::fromJson(raw.toUtf8()).object(),true);}else content=researchPresentation::company(id,{},profileHistorical);}catch(const std::exception& e){content="<h2>资料无法读取</h2><p>"+QString::fromUtf8(e.what()).toHtmlEscaped()+"</p>";}if(!reading.value("companyProfileError").toString().isEmpty())content+="<p>资料读取失败："+reading.value("companyProfileError").toString().toHtmlEscaped()+"</p>";if(!nativeData&&p["degraded"].toBool())content+="<p>部分公司资料尚未取得，请查看来源详情。</p>";if(!old.isEmpty()&&!legacyValid)content+="<p>"+legacyText.toHtmlEscaped()+"</p>";if(!reading.value("legacyCompanyProfileError").toString().isEmpty())content+="<p>旧资料读取失败："+reading.value("legacyCompanyProfileError").toString().toHtmlEscaped()+"</p>";profileSummary->setHtml(content);
 bool supported=false;try{supported=!id.isEmpty()&&stockProfile::supported(id);}catch(...){ }profileUpdate->setEnabled(profileEnabled&&supported&&!profileHistorical&&profileToken.isEmpty());profileCancel->setEnabled(!profileToken.isEmpty());renderProfileOriginal();
}
void StockResearchPage::renderProfileOriginal(){
 if(!profileOriginal)return;auto p=reading.value("companyProfile").toObject(),old=reading.value("legacyCompanyProfile").toObject();
 try{if(profileSource->currentText()==businessSearch::legacyLabel)profileOriginalText=old.isEmpty()?QString("该证券没有可核旧主营摘录；未伪造F10原响应。"):businessSearch::legacyOriginal(old);else profileOriginalText=p.isEmpty()?QString("尚无完整来源原字段"):(stockProfile::validate(id,p),stockProfile::original(p,profileSource->currentText()));}
 catch(const std::exception& e){profileOriginalText="主营原字段不可读："+QString::fromUtf8(e.what());}
 profileOffset=qBound(0,profileOffset,qMax(0,profileOriginalText.size()-1));profileOriginal->setPlainText(profileOriginalText.mid(profileOffset,32768));profilePrevious->setEnabled(profileOffset>0);profileNext->setEnabled(profileOffset+32768<profileOriginalText.size());
}
void StockResearchPage::profilePageText(int delta){profileOffset=qBound(0,profileOffset+delta*32768,qMax(0,profileOriginalText.size()-1));renderProfileOriginal();}
void StockResearchPage::cancelProfile(bool announce){auto token=profileToken;profileToken.clear();if(profiles&&!token.isEmpty())profiles->cancel(token);if(profileSummary&&(!token.isEmpty()||announce))renderProfile();if((announce||!token.isEmpty())&&state)state->setText("公司资料读取已取消，未保存新缓存。");}
void StockResearchPage::updateProfile(){stockProfile::need(profiles&&profileEnabled&&isVisible()&&tabs->currentIndex()==4&&!profileHistorical&&!id.isEmpty()&&stockProfile::supported(id)&&profileToken.isEmpty(),"请在当前证券主营概况页明确更新");++profileVersion;auto selected=id,token=QUuid::createUuid().toString(QUuid::WithoutBraces);profileToken=token;renderProfile();state->setText("正在读取三个公司公开源；可明确取消。");try{profiles->start(token,selected,[this,selected,token]{return isVisible()&&!window()->isMinimized()&&tabs->currentIndex()==4&&!profileHistorical&&id==selected&&profileToken==token;},[this,selected,token](QString,QJsonObject packet,QString error){if(id!=selected||profileToken!=token)return;profileToken.clear();if(error.isEmpty()){stockProfile::validate(selected,packet);current["companyProfile"]=packet;current.remove("companyProfileError");reading["companyProfile"]=packet;reading.remove("companyProfileError");profileOffset=0;renderProfile();if(documents->currentRow()<0)reader->setPlainText(researchPresentation::overview(reading));persist();state->setText("本次公司源读取结束；各源结果分别显示，失败源保留原缓存。");}else{renderProfile();state->setText("公司资料未更新："+error);}});}catch(...){profileToken.clear();renderProfile();throw;}}
void StockResearchPage::hideEvent(QHideEvent* event){cancelProfile();QWidget::hideEvent(event);}

void StockResearchPage::showEvent(QShowEvent* event){window()->installEventFilter(this);QWidget::showEvent(event);if(snapshotReader&&snapshotReader->busy())safe([this]{requestSnapshot(lastSources,lastLegacy,lastViewInput);});}
bool StockResearchPage::eventFilter(QObject* watched,QEvent* event){
 if(watched==window()&&event->type()==QEvent::WindowStateChange){
  if(window()->isMinimized()){cancelProfile();readPaused=snapshotReader&&snapshotReader->busy();if(snapshotReader)snapshotReader->cancel();}
  else if(readPaused){readPaused=false;safe([this]{requestSnapshot(lastSources,lastLegacy,lastViewInput);});}
 }
 return QWidget::eventFilter(watched,event);
}
