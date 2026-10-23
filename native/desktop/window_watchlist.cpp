#include "window.hpp"
#include "page_snapshot_reader.hpp"
#include "watchlist_host_adapter.hpp"
#include "watchlist_host_adapter_state.hpp"
#include "watchlist_workspace_page.hpp"
#include "watchlist_reconciliation_page.hpp"
#include <QtWidgets>
#include <QThread>
// Add to Window.cpp; headers are copied/registered by root.
// #include "watchlist_host_adapter.hpp"
// #include "watchlist_host_adapter_state.hpp"
// #include "watchlist_workspace_page.hpp"
// #include "watchlist_reconciliation_page.hpp"
// #include <QThread>
// #include <QPlainTextEdit>
QString Window::watchlistBridgePath() const{return QFileInfo(businessStore->filePath()).absolutePath()+"/watchlist-workspace-v35.sqlite";}
QJsonObject Window::watchlistBridgeRead(QJsonObject inputs){if(!QFile::exists(watchlistBridgePath()))return {{"schema","watchlist-workspace-store-result/v1"},{"state","uninitialized"}};return watchlistBridgeStore()->read(inputs);}
std::shared_ptr<WatchlistWorkspaceStore> Window::watchlistBridgeStore(bool create) {
  watchlistWorkspace::need(QThread::currentThread()==thread(),"分组侧库须在宿主主线程使用");
  watchlistWorkspace::need(create||QFile::exists(watchlistBridgePath()),"未明确初始化，普通读取不创建侧库");
  if(!watchlistGroupStore)watchlistGroupStore=std::make_shared<WatchlistWorkspaceStore>(watchlistBridgePath());
  return watchlistGroupStore;
}
QJsonObject Window::watchlistBridgeRawInputs() const {
  watchlistWorkspace::need(QThread::currentThread()==thread(),"完整主自选输入须在宿主主线程捕获");
  QJsonObject colors;
  for(auto v:instruments){auto row=v.toObject();if(row.value("transient").toBool())continue;
    auto name=row.value("group").toString();
    if(settings&&settings->contains("groupColor/"+name))colors[name]=settings->value("groupColor/"+name).toString();
  }
  QJsonObject evidence{{"nativeLocalSingletonContract",true},{"localColors",colors}};
  // No imported source group exists in the current native roster schema.
  // Root may inject verified raw config records; an invalid declared value fails explicitly.
  auto supplied=property("watchlistImportedGroups");
  if(supplied.isValid()){watchlistWorkspace::need(supplied.canConvert<QJsonArray>(),"导入来源组格式未核验");evidence["importedGroups"]=supplied.value<QJsonArray>();}
  return {{"roster",instruments},{"evidence",evidence}};
}
QJsonObject Window::watchlistBridgeCapture() const {auto raw=watchlistBridgeRawInputs();return watchlistHostAdapter::inputs(raw["roster"].toArray(),raw["evidence"].toObject());}
QJsonObject Window::watchlistBridgeLegacyDirectory(const QString& requested) const {
  QJsonArray options{QJsonObject{{"groupId",""},{"name","全部自选"},{"displayName","全部自选"},{"color",""},{"readOnly",true},{"memberIds",QJsonArray{}}}};
  QStringList names;for(auto v:instruments){auto r=v.toObject();if(!r.value("transient").toBool()&&!names.contains(r.value("group").toString()))names<<r.value("group").toString();}
  QString chosen="",chosenName="全部自选";QJsonArray selected;
  for(auto name:names){QJsonArray members;for(auto v:instruments){auto r=v.toObject();if(!r.value("transient").toBool()&&r.value("group").toString()==name)members.append(r.value("id"));}
    options.append(QJsonObject{{"groupId",name},{"selectorKind","legacy-name"},{"name",name},{"displayName",name},{"color",settings?settings->value("groupColor/"+name).toString():QString{}},{"readOnly",false},{"memberIds",members}});
    if(name==requested){chosen=name;chosenName=name;selected=members;}
  }return {{"schema","watchlist-host-directory/v1"},{"state","uninitialized"},{"mode","legacy-native-label"},{"options",options},{"selectedGroupId",chosen},{"selectedName",chosenName},{"memberIds",selected},{"requiresReconciliation",false}};
}
QJsonObject Window::watchlistBridgeDirectory(const QString& requested) {
  QString key=requested.isNull()?(groups&&groups->currentItem()?groups->currentItem()->data(Qt::UserRole).toString():QString{}):requested;
  try{auto capture=watchlistBridgeCapture();auto result=watchlistBridgeRead(capture.value("inputs").toObject());
    auto out=result.value("state")=="uninitialized"?watchlistBridgeLegacyDirectory(key):watchlistHostAdapter::directory(result,groups&&groups->currentItem()&&groups->currentItem()->data(Qt::UserRole+1).toString()=="legacy-native-label"?QString{}:key);
    watchlistBridgeError=watchlistHostAdapter::diagnostics(capture);
    if(result.value("state")=="uninitialized")watchlistBridgeError="本机分组尚未显式初始化。\n"+watchlistBridgeError;
    if(result.value("state")=="needsReconciliation")watchlistBridgeError="主自选范围已变，分组关联需显式协调；旧关系未删除。\n"+watchlistBridgeError;
    out["reason"]=watchlistBridgeError;return out;
  }catch(const std::exception&e){watchlistBridgeError=QString::fromUtf8(e.what());
    auto out=watchlistHostAdapter::directory({{"schema","watchlist-workspace-store-result/v1"},{"state","uninitialized"}},"");
    out["state"]="unavailable";out["reason"]=watchlistBridgeError;return out;
  }
}
void Window::renderWatchlistDirectory(const QString& requested) {
  auto view=watchlistBridgeDirectory(requested);QSignalBlocker blocker(groups);groups->clear();int chosen=0;
  for(auto v:view.value("options").toArray()){auto o=v.toObject();auto*item=new QListWidgetItem(o.value("displayName").toString(),groups);
    item->setData(Qt::UserRole,o.value("groupId").toString());
    item->setToolTip(o.value("groupId").toString()+"\n"+(o.value("readOnly").toBool()?"来源只读":"本地组")+"\n"+view.value("reason").toString());
    auto shade=o.value("color").toString();if(!shade.isEmpty())item->setForeground(QColor(shade));
    item->setData(Qt::UserRole+1,view.value("mode").toString());
    if(o.value("groupId")==view.value("selectedGroupId"))chosen=groups->count()-1;
  }groups->setCurrentRow(chosen);
}
void Window::editGroups() {
  auto*page=pages.value("watchlistHost");
  if(!page){page=businessPage("watchlistHost","自选 / 分组管理","自选与账户");auto*l=new QVBoxLayout(page);
    auto*state=new QLabel;state->setObjectName("watchlistHostState");state->setWordWrap(true);l->addWidget(state);
    auto*read=new QPlainTextEdit;read->setObjectName("watchlistInitReader");read->setReadOnly(true);l->addWidget(read,1);
    auto*ack=new QCheckBox("已核对完整主自选及本机旧组；生成稳定ID并保存到独立组库");ack->setObjectName("watchlistInitAck");l->addWidget(ack);
    auto*bar=new QHBoxLayout;l->addLayout(bar);
    auto add=[this,bar,state](QString title,std::function<void()>action){auto*b=new QPushButton(title);bar->addWidget(b);connect(b,&QPushButton::clicked,this,[state,action]{try{action();}catch(const std::exception&e){state->setText(QString::fromUtf8(e.what()));}});};
    add("预览首次初始化",[this,state,read,ack]{auto captured=watchlistBridgeCapture();state->setText(watchlistHostAdapter::diagnostics(captured));
      watchlistWorkspace::need(watchlistBridgeRead(captured.value("inputs").toObject()).value("state")=="uninitialized","侧库已有配置，不重新投影旧名称");
      watchlistInitPacket=watchlistHostAdapter::initializationPreview(captured);ack->setChecked(false);
      read->setPlainText("本机旧标签将生成持久随机groupId；源只读ID/来源/颜色只采用明确记录。\n"+QString::fromUtf8(QJsonDocument(watchlistInitPacket).toJson(QJsonDocument::Indented)));
    });
    add("确认初始化",[this,state,ack]{watchlistWorkspace::need(!watchlistInitPacket.isEmpty()&&ack->isChecked(),"先预览并明确确认初始化");
      auto capture=watchlistBridgeCapture();watchlistWorkspace::need(watchlistWorkspace::equal(watchlistHostAdapter::initializationPreview(capture),watchlistInitPacket),"初始化预览后主自选或旧组证据已变");
      auto result=watchlistBridgeStore(true)->initialize(watchlistHostAdapter::requireInputs(capture));
      watchlistHostAdapter::verifyInitialization(watchlistInitPacket,result);watchlistInitPacket={};ack->setChecked(false);renderWatchlistDirectory();fillStocks();state->setText("初始化配置已由独立侧库回读确认；主清单和报价未写。");
    });
    add("取消初始化预览",[this,read,ack]{watchlistInitPacket={};ack->setChecked(false);read->clear();});
    add("编辑分组",[this]{watchlistWorkspaceView();});add("显式协调变化",[this]{watchlistReconciliationView();});add("添加 / 显示隐藏",[this]{editWatchVisibility();});
  }
  auto* reader=static_cast<PageSnapshotReader*>(page->findChild<QObject*>("watchlistHostReader"));
  if(!reader){reader=new PageSnapshotReader(page,{},[page](QJsonObject result,QString error){page->setProperty("snapshotLoading",false);auto*state=page->findChild<QLabel*>("watchlistHostState");if(!error.isEmpty()){state->setText("分组暂不可读："+error);return;}state->setText(result["state"]=="ready"?"自选分组已就绪":"分组需要处理："+result["state"].toString());});reader->setObjectName("watchlistHostReader");}
  const auto raw=watchlistBridgeRawInputs();const auto path=watchlistBridgePath();reader->request([raw,path]{auto capture=watchlistHostAdapter::inputs(raw["roster"].toArray(),raw["evidence"].toObject());if(!QFileInfo::exists(path))return QJsonObject{{"state","uninitialized"}};return WatchlistWorkspaceStore::readExisting(path,capture["inputs"].toObject(),false);});page->setProperty("snapshotLoading",true);activatePage(page);
}
void Window::watchlistWorkspaceView() {
  auto read=[this]{auto in=watchlistBridgeCapture().value("inputs").toObject();auto result=watchlistBridgeRead(in);watchlistWorkspace::need(result.value("state")=="ready","先显式初始化或协调主自选变化；旧组关系仍保留");return result.value("snapshot").toObject();};
  auto*page=dynamic_cast<WatchlistWorkspacePage*>(pages.value("watchlistWorkspace"));
  if(!page){page=new WatchlistWorkspacePage(read,[this](QJsonObject change){
      // ALL roster changes must be serialized on this thread; do not pump events here.
      auto result=watchlistBridgeStore()->save(change,watchlistBridgeCapture().value("inputs").toObject());
      renderWatchlistDirectory();fillStocks();return result;
    },workspaceTabs,false);page->setProperty("pageTitle","独立分组管理");page->setProperty("workspace","自选与账户");pages["watchlistWorkspace"]=page;
    page->setAsyncReader([this]{auto raw=watchlistBridgeRawInputs();auto path=watchlistBridgePath();return [raw,path]{auto capture=watchlistHostAdapter::inputs(raw["roster"].toArray(),raw["evidence"].toObject());return WatchlistWorkspaceStore::readExisting(path,capture["inputs"].toObject())["snapshot"].toObject();};});
    page->setBackupActions([this]{
      auto target=QFileDialog::getSaveFileName(this,"导出已保存分组","自选分组备份.json","JSON (*.json)");
      if(!target.isEmpty())watchlistBackupExportPath(target);
    },[this]{auto source=QFileDialog::getOpenFileName(this,"选择分组备份",{},"JSON (*.json)");if(!source.isEmpty())watchlistBackupImportPath(source);});
  }activatePage(page);
}
void Window::watchlistBackupExportPath(const QString& path){
 auto*p=dynamic_cast<WatchlistWorkspacePage*>(pages.value("watchlistWorkspace"));watchlistWorkspace::need(p,"分组页未打开");
 watchlistWorkspace::need(path.endsWith(".json",Qt::CaseInsensitive),"请选择JSON文件；不能覆盖业务库");
 auto bytes=p->exportBackupBytes();QSaveFile file(path);watchlistWorkspace::need(file.open(QIODevice::WriteOnly)&&file.write(bytes)==bytes.size()&&file.commit(),"分组导出失败；已保存配置未改");
}
void Window::watchlistBackupImportPath(const QString& path){
 auto*p=dynamic_cast<WatchlistWorkspacePage*>(pages.value("watchlistWorkspace"));watchlistWorkspace::need(p,"分组页未打开");
 QFile f(path);watchlistWorkspace::need(f.open(QIODevice::ReadOnly)&&f.size()<=watchlistBackup::LIMIT,"备份不可读或超过8MiB");
 auto bytes=f.read(watchlistBackup::LIMIT+1);p->previewBackupImport(bytes);
}
void Window::watchlistReconciliationView() {
  auto*page=dynamic_cast<WatchlistReconciliationPage*>(pages.value("watchlistReconciliation"));
  if(!page){auto store=std::make_shared<WatchlistReconciliationStore>(watchlistBridgePath(),false);
    page=new WatchlistReconciliationPage(store,[this]{return watchlistBridgeCapture().value("inputs").toObject();},[this,store](QJsonObject packet,bool ack){
      watchlistWorkspace::need(QThread::currentThread()==thread(),"协调须在宿主主线程串行捕获及确认");
      auto result=store->confirm(packet,watchlistBridgeCapture().value("inputs").toObject(),ack,QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs));
      renderWatchlistDirectory();fillStocks();return result;
    },workspaceTabs,false);page->setProperty("pageTitle","主自选变化协调");page->setProperty("workspace","自选与账户");pages["watchlistReconciliation"]=page;
    page->setAsyncReader([this,store]{auto raw=watchlistBridgeRawInputs();return [raw,store]{auto capture=watchlistHostAdapter::inputs(raw["roster"].toArray(),raw["evidence"].toObject());auto current=store->current(capture["inputs"].toObject());return QJsonObject{{"current",current},{"history",store->historyList()},{"text",QString::fromUtf8(QJsonDocument(current).toJson(QJsonDocument::Indented))}};};});
  }activatePage(page);
}
void Window::watchlistBridgeSaveViews() {
  watchlistWorkspace::need(!watchlistViewRestoreFailed,"分组旧界面草稿未能恢复，原界面文件保留");
  QJsonObject state{{"schema","watchlist-host-ui-state/v1"},{"initialization",watchlistInitPacket},{"selectedGroupId",groups->currentItem()?groups->currentItem()->data(Qt::UserRole).toString():QString{}}};
  if(auto*p=dynamic_cast<WatchlistWorkspacePage*>(pages.value("watchlistWorkspace")))state["workspace"]=p->saveState();
  if(auto*p=dynamic_cast<WatchlistReconciliationPage*>(pages.value("watchlistReconciliation")))state["reconciliation"]=p->saveState();
  watchlistHostState::save(QFileInfo(businessStore->filePath()).absolutePath()+"/watchlist-host-ui-v36.json",state);
}
void Window::watchlistBridgeRestoreViews() {
  try{auto state=watchlistHostState::read(QFileInfo(businessStore->filePath()).absolutePath()+"/watchlist-host-ui-v36.json");if(state.isEmpty())return;
    watchlistWorkspace::need(state.value("schema")=="watchlist-host-ui-state/v1","分组界面状态格式失效");
    watchlistInitPacket=state.value("initialization").toObject();renderWatchlistDirectory(state.value("selectedGroupId").toString());
    auto index=workspaceTabs->currentIndex();
    if(state.value("workspace").isObject()){watchlistWorkspaceView();dynamic_cast<WatchlistWorkspacePage*>(pages.value("watchlistWorkspace"))->restoreState(state.value("workspace").toObject());}
    if(state.value("reconciliation").isObject()){watchlistReconciliationView();dynamic_cast<WatchlistReconciliationPage*>(pages.value("watchlistReconciliation"))->restoreState(state.value("reconciliation").toObject());}
    workspaceTabs->setCurrentIndex(index);watchlistViewRestoreFailed=false;
  }catch(...){watchlistViewRestoreFailed=true;throw;}
}
