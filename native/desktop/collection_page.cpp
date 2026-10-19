#include "collection_page.hpp"
#include "business_read_request.hpp"
#include "detail_disclosure.hpp"

#include <QtWidgets>

#include "collection_pipeline.hpp"
#include "collection_runner.hpp"
#include "source_page.hpp"
#include "source_plans_page.hpp"
#include "source_analysis_page.hpp"
#include "source_handoff_page.hpp"
#include "collection_presentation.hpp"
#include "collection_covers.hpp"
#include "archive_video_review_page.hpp"
#include "creator_legacy.hpp"
#include "collection_engine_config.hpp"
namespace {
QJsonObject collectionRecord(const QString& file,const QString& id){
 if(id.isEmpty())return {};
 return BusinessStore::readRecord(file,"collections",id);
}
class CollectionDocumentHandle : public QObject {
 public:
  std::function<void(const QJsonObject&)> open;
  explicit CollectionDocumentHandle(QObject* parent) : QObject(parent) { setObjectName("collectionDocumentHandle"); }
};
}
void openCollectionDocument(QWidget* page, const QJsonObject& expected) {
  business::require(page != nullptr, "文稿页不存在");
  auto handle = dynamic_cast<CollectionDocumentHandle*>(page->findChild<QObject*>("collectionDocumentHandle"));
  business::require(handle && bool(handle->open), "精确文稿入口尚未就绪"); handle->open(expected);
}
QWidget* collectionPage(std::shared_ptr<BusinessStore> store, QWidget* parent,
                        CollectionPipeline* pipeline, std::function<void(const QJsonObject&)> openResearch,
                        std::function<void(const QJsonObject&)> openVideo) {
  auto page = new QWidget(parent);
  page->setObjectName("collectionPage");
  if (!pipeline)
    pipeline = new CollectionPipeline(
        store,
        QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation) +
            "/collection-media",
        page);
  auto runner = pipeline->runner();
  auto outer = new QVBoxLayout(page);
  auto ownershipBar = new QHBoxLayout;
  auto ownership = new QLabel;
  ownership->setObjectName("collectionOwnership");
  ownership->setWordWrap(true);
  auto acquire = new QPushButton("重试接管采集队列");
  acquire->setObjectName("acquireCollectionQueue");
  ownershipBar->addWidget(ownership, 1);
  ownershipBar->addWidget(acquire);
  outer->addLayout(ownershipBar);
  auto sections = new QTabWidget;
  sections->setObjectName("collectionSections");
  outer->addWidget(sections);
  auto editor = new QWidget;
  sections->addTab(editor, "作者视频 / 文稿");
  auto sources=std::make_shared<QPointer<SourcePage>>();auto sourcesChanged=std::make_shared<std::function<void()>>();
  auto sourceHost=new QWidget(sections);auto sourceLayout=new QVBoxLayout(sourceHost);sourceLayout->setContentsMargins(0,0,0,0);
  sections->addTab(sourceHost, "来源 / 自动采集");
  auto ensureSources=[=]{if(!*sources){*sources=new SourcePage(store,pipeline,sourceHost);sourceLayout->addWidget(sources->data());QObject::connect(sources->data(),&SourcePage::recordsChanged,page,[sourcesChanged]{if(*sourcesChanged)(*sourcesChanged)();});}return sources->data();};
  auto plansHost = new QWidget;
  auto plansLayout = new QVBoxLayout(plansHost);
  auto plansMessage = new QLabel("当前只读；作者计划由执行窗口管理，接管队列后在此打开。");
  plansMessage->setWordWrap(true);
  auto retryPlans = new QPushButton("重试打开作者计划");
  plansLayout->addWidget(plansMessage);
  plansLayout->addWidget(retryPlans);
  sections->addTab(plansHost, "作者计划 / 运行历史");
  auto root = new QVBoxLayout(editor);
  auto bar = new QHBoxLayout;
  root->addLayout(bar);
  auto search = new QLineEdit;
  search->setObjectName("collectionSearch");
  search->setPlaceholderText("搜索标题 / 作者 / 文稿");
  bar->addWidget(search, 1);
  auto author = new QComboBox;
  author->setObjectName("collectionAuthor");
  author->addItem("全部作者 / 来源", "");
  bar->insertWidget(0,author);
  auto visibleCount=new QLabel;visibleCount->setObjectName("collectionVisibleCount");root->addWidget(visibleCount);
  auto add = new QPushButton("添加本机媒体"),
       import = new QPushButton("导入授权文稿"),
       refresh = new QPushButton("刷新作品");
  for (auto b : {add, import, refresh}) bar->addWidget(b);
  auto link = new QPushButton("新建链接任务");
  link->setObjectName("newCollectionLink");
  bar->addWidget(link);
  auto state = new QLabel(
      "选择作品阅读文稿或打开视频");
  state->setObjectName("collectionState");
  state->setWordWrap(true);
  root->addWidget(state);
  auto split = new QSplitter;
  root->addWidget(split, 1);
  auto list = new QListWidget;
  list->setObjectName("collectionList");
  list->setMinimumWidth(230);
  list->setUniformItemSizes(true);
  auto covers=new CollectionCovers(QFileInfo(store->filePath()).absolutePath()+"/collection-media",page);
  auto delegate=new CollectionCardDelegate(covers,list);list->setItemDelegate(delegate);
  auto viewMode=new QComboBox;viewMode->setObjectName("collectionViewMode");viewMode->addItem("列表","list");viewMode->addItem("封面","cards");bar->addWidget(viewMode);
  const auto preferenceFile=QFileInfo(store->filePath()).absolutePath()+"/collection-view.ini";
  QSettings viewSettings(preferenceFile,QSettings::IniFormat);
  viewMode->setCurrentIndex(viewSettings.value("view","list").toString()=="cards"?1:0);
  auto setView=[=]{bool cards=viewMode->currentData()=="cards";delegate->cards=cards;list->setViewMode(cards?QListView::IconMode:QListView::ListMode);list->setResizeMode(QListView::Adjust);list->setMovement(QListView::Static);list->setWrapping(cards);list->setGridSize(cards?QSize(184,174):QSize());list->doItemsLayout();list->viewport()->update();};setView();
  QObject::connect(viewMode,&QComboBox::currentIndexChanged,page,[=]{setView();QSettings s(preferenceFile,QSettings::IniFormat);s.setValue("view",viewMode->currentData());});
  split->addWidget(list);
  auto detail=new QSplitter(Qt::Horizontal);detail->setObjectName("collectionDetailSplit");detail->setChildrenCollapsible(false);split->addWidget(detail);
  auto panel = new QWidget;
  auto form = new QVBoxLayout(panel);
  auto videoHost=new QWidget;videoHost->setObjectName("collectionVideoHost");auto videoLayout=new QVBoxLayout(videoHost);videoLayout->setContentsMargins(0,0,0,0);videoHost->setMinimumSize(300,480);
  auto cover=new CollectionCoverLabel(videoHost);cover->setText("选择作品查看视频");cover->setObjectName("collectionCover");cover->setAlignment(Qt::AlignCenter);cover->setMinimumHeight(420);videoLayout->addWidget(cover,1);
  detail->addWidget(videoHost);detail->addWidget(panel);detail->setSizes({370,580});detail->setStretchFactor(0,2);detail->setStretchFactor(1,3);
  auto title = new QLineEdit, source = new QLineEdit, rights = new QLineEdit,
       media = new QLineEdit, mediaUrl = new QLineEdit;
  title->setObjectName("collectionTitle");
  source->setObjectName("collectionSource");
  rights->setObjectName("collectionRights");
  media->setObjectName("collectionMedia");
  mediaUrl->setObjectName("collectionMediaUrl");
  mediaUrl->setPlaceholderText(
      "已有授权的抖音CDN HTTPS媒体地址；不是作品网页链接");
  auto titleRow=new QFormLayout;titleRow->addRow("标题",title);form->addLayout(titleRow);
  auto metadata=new QWidget;auto grid = new QFormLayout(metadata);addDataDetails(form,metadata,"collectionSourceDetails");
  grid->addRow("来源链接", source);
  grid->addRow("授权依据", rights);
  grid->addRow("本机媒体", media);
  grid->addRow("媒体地址", mediaUrl);
  auto tabs = new QTabWidget;
  tabs->setObjectName("collectionDocumentTabs");
  form->addWidget(tabs, 1);
  auto text = new QPlainTextEdit;
  text->setObjectName("collectionText");
  auto original = new QPlainTextEdit;
  original->setReadOnly(true);
  original->setObjectName("collectionOriginal");
  auto segments = new QTableWidget(0, 3);
  segments->setHorizontalHeaderLabels({"开始秒", "结束秒", "识别原文"});
  segments->setEditTriggers(QAbstractItemView::NoEditTriggers);
  segments->horizontalHeader()->setSectionResizeMode(2, QHeaderView::Stretch);
  tabs->addTab(text, "校对文稿");
  tabs->addTab(original, "保留原稿");
  tabs->addTab(segments, "本次识别分段");
  auto commentsPanel=new QWidget;auto commentsLayout=new QVBoxLayout(commentsPanel);auto commentState=new QLabel;commentState->setWordWrap(true);commentState->setObjectName("collectionCommentsState");commentsLayout->addWidget(commentState);
  auto comments=new QTableWidget(0,3);comments->setObjectName("collectionComments");comments->setHorizontalHeaderLabels({"作者","评论","发表时间"});comments->setEditTriggers(QAbstractItemView::NoEditTriggers);comments->horizontalHeader()->setSectionResizeMode(1,QHeaderView::Stretch);commentsLayout->addWidget(comments,1);
  auto commentBar=new QHBoxLayout;auto previousComments=new QPushButton("上一页"),nextComments=new QPushButton("下一页");commentBar->addWidget(previousComments);commentBar->addWidget(nextComments);commentsLayout->addLayout(commentBar);tabs->addTab(commentsPanel,"评论");
  auto analysis=new QTextBrowser;analysis->setObjectName("collectionAnalysis");analysis->setOpenLinks(false);tabs->addTab(analysis,"分析");
  auto qualityPanel=new QWidget;auto qualityLayout=new QVBoxLayout(qualityPanel);
  auto qualityState=new QLabel;qualityState->setObjectName("collectionQualityState");qualityState->setWordWrap(true);qualityLayout->addWidget(qualityState);
  auto qualityHistory=new QPlainTextEdit;qualityHistory->setObjectName("qualityReviewHistory");qualityHistory->setReadOnly(true);qualityLayout->addWidget(qualityHistory,1);
  auto qualityNote=new QPlainTextEdit;qualityNote->setObjectName("qualityReviewNote");qualityNote->setPlaceholderText("本次核对了什么？尚有哪些疑点？（记录不等于外部事实核验）");qualityNote->setMaximumHeight(100);qualityLayout->addWidget(qualityNote);
  auto review=new QPushButton("记录本次复核");review->setObjectName("saveQualityReview");qualityLayout->addWidget(review);
  tabs->addTab(qualityPanel,"文稿质检");
  auto actions = new QGridLayout;
  form->addLayout(actions);
  auto save = new QPushButton("保存校对"),
       publish = new QPushButton("入研究资料"),
       useAsr = new QPushButton("使用本次识别稿");
  save->setObjectName("saveCollection");
  publish->setObjectName("publishCollection");
  auto viewRoot = new QPushButton("查看来源初版");
  viewRoot->setObjectName("viewSourceRoot"); viewRoot->setEnabled(false);
  int actionColumn=0;for (auto b : {save, publish, useAsr, viewRoot}) actions->addWidget(b,0,actionColumn++);
  auto engine =
      new QGroupBox("本机引擎与队列（CPU · 自动任务失败退避，5次失败后暂停）");
  addDataDetails(form,engine,"collectionEngineDetails");
  auto ef = new QFormLayout(engine);
  QSettings settings;
  auto python = new QLineEdit(collectionEngineConfig::python(settings));
  auto model = new QLineEdit(collectionEngineConfig::model(settings));
  python->setObjectName("collectionPython");
  model->setObjectName("collectionModel");
  ef->addRow("Python（已有faster-whisper）", python);
  ef->addRow("本机模型目录", model);
  auto saveEngine = new QPushButton("保存引擎配置（来源自动采集共用）");
  saveEngine->setObjectName("saveCollectionEngine");
  ef->addRow(saveEngine);
  auto run = new QPushButton("排队 / 重试转写"),
       cancel = new QPushButton("停止选中任务");
  run->setObjectName("startTranscription");
  cancel->setObjectName("cancelTranscription");
  actions->addWidget(run,1,0);actions->addWidget(cancel,1,1);
  run->setText("识别 / 重新识别");
  auto folder=new QPushButton("打开视频位置");folder->setObjectName("openCollectionMediaFolder");actions->addWidget(folder,1,2,1,2);
  auto startPipeline = new QPushButton("启用下载→转写→自动入库"),
       stopPipeline = new QPushButton("停止自动链路");
  startPipeline->setObjectName("startCollectionPipeline");
  stopPipeline->setObjectName("stopCollectionPipeline");
  ef->addRow(startPipeline, stopPipeline);
  auto showOwnership = [=] {
    const bool owner = pipeline->ownsQueue();
    ownership->setText(owner ? "" : pipeline->errorMessage());
    ownership->setVisible(!owner);acquire->setVisible(!owner);
    acquire->setEnabled(!owner);
    retryPlans->setEnabled(owner);
    for (auto button : {add, import, link, save, publish, useAsr, review,
                         saveEngine, run, cancel, startPipeline, stopPipeline})
      button->setEnabled(owner);
    for (auto field : {title, source, rights, media, mediaUrl, python, model})
      field->setReadOnly(!owner);
    text->setReadOnly(!owner);
    qualityNote->setReadOnly(!owner);
  };
  QObject::connect(pipeline, &CollectionPipeline::changed, page, showOwnership);
  QObject::connect(acquire, &QPushButton::clicked, page, [=] {
    try {
      if (pipeline->tryAcquireQueue())
        state->setText("已接管采集队列；仅恢复本机已批准任务，未批准任务不会启动");
    } catch (const std::exception& e) {
      state->setText(QString::fromUtf8(e.what()));
    }
    showOwnership();
  });
  showOwnership();
  auto current = std::make_shared<QString>();
  auto baseline = std::make_shared<QJsonObject>();
  auto loading = std::make_shared<bool>(false),
       dirty = std::make_shared<bool>(false);
  auto record = [=](QString id) {
    return collectionRecord(store->filePath(),id);
  };
  auto library=std::make_shared<QList<QJsonObject>>();
  auto authorAliases=std::make_shared<QMap<QString,QString>>();
  auto* reads=new BusinessReadRequest(store->filePath(),page);
  auto offset=std::make_shared<int>(0);
  auto* batch=new QHBoxLayout;root->addLayout(batch);
  auto* previousBatch=new QPushButton("上一页");previousBatch->setObjectName("collectionPrevious");batch->addWidget(previousBatch);
  auto* nextBatch=new QPushButton("下一页");nextBatch->setObjectName("collectionNext");batch->addWidget(nextBatch);batch->addStretch();
  auto reload=[=]{reads->list("collections",search->text().trimmed());};
  auto render = [=] {
    QSignalBlocker block(list);
    list->clear();
    QList<QJsonObject> matches;
    for (const auto& j : *library) {
      if(!author->currentData().toString().isEmpty()&&collectionPresentation::authorKey(j,*authorAliases)!=author->currentData().toString())continue;
      if(j.contains("_queryMatch")&&!j["_queryMatch"].toBool())continue;
      matches.append(j);
    }
    *offset=qBound(0,*offset,qMax(0,((int(matches.size())-1)/100)*100));
    for(int i=*offset;i<qMin(*offset+100,int(matches.size()));++i){const auto j=matches[i];
      const auto status=collectionPresentation::status(j);
      auto item = new QListWidgetItem(collectionPresentation::title(j)+"\n"+collectionPresentation::dateLabel(j)+(status.isEmpty()?QString():" · "+status),list);
      item->setData(Qt::UserRole, j["id"].toString());
      item->setData(Qt::UserRole+1,j);
      item->setToolTip(collectionPresentation::title(j)+"\n"+j["channel"].toString()+" · "+collectionPresentation::dateLabel(j));
      if (j["id"] == *current) list->setCurrentItem(item);
    }
    previousBatch->setEnabled(*offset>0);nextBatch->setEnabled(*offset+100<matches.size());
    visibleCount->setText(QString("%1 · 匹配 %2 条 · 第%3/%4页 · 全部历史仍可翻页").arg(author->currentText()).arg(matches.size()).arg(*offset/100+1).arg(qMax(1,(int(matches.size())+99)/100)));
  };
  QObject::connect(previousBatch,&QPushButton::clicked,page,[=]{*offset=qMax(0,*offset-100);render();});
  QObject::connect(nextBatch,&QPushButton::clicked,page,[=]{*offset+=100;render();});
  QObject::connect(author,&QComboBox::currentIndexChanged,page,[=]{*offset=0;render();});
  auto player=std::make_shared<QPointer<ArchiveVideoReviewPage>>();
  auto clearPlayer=[=]{if(*player){(*player)->close();(*player)->hide();(*player)->deleteLater();*player=nullptr;}cover->show();if(auto*b=videoHost->findChild<QPushButton*>("openArchiveVideo"))b->show();};
  auto updateCover=[=]{list->viewport()->update();if(baseline->isEmpty())return;auto image=covers->get(*baseline);cover->setCover(image);if(image.isNull())cover->setText(baseline->value("assetPath").toString().isEmpty()?"尚无视频文件":"视频封面正在准备或不可用");};
  covers->changed=updateCover;
  auto commentRows=std::make_shared<QJsonArray>();auto commentOffset=std::make_shared<int>(0);auto commentLoaded=std::make_shared<QString>();auto analysisLoaded=std::make_shared<QString>();
  auto renderComments=[=]{comments->setRowCount(0);for(int i=*commentOffset;i<qMin(*commentOffset+100,int(commentRows->size()));++i){auto c=commentRows->at(i).toObject();int n=comments->rowCount();comments->insertRow(n);comments->setItem(n,0,new QTableWidgetItem(c["author_name"].toString(c["authorName"].toString())));comments->setItem(n,1,new QTableWidgetItem(c["comment_text"].toString(c["text"].toString())));comments->setItem(n,2,new QTableWidgetItem(collectionPresentation::dateLabel({{"publishedAt",c["published_at"].toString(c["publishedAt"].toString())}})));}previousComments->setEnabled(*commentOffset>0);nextComments->setEnabled(*commentOffset+100<commentRows->size());};
  auto loadSupporting=[=]{try{
    if(tabs->currentWidget()==commentsPanel&&*commentLoaded!=*current){
      *commentRows=baseline->value("comments").toArray();*commentOffset=0;QString coverage="尚未取得评论，不能据此判断没有评论";
      if(baseline->value("legacySource")=="expert_observations"){
        auto old=baseline->value("legacyOriginal").toObject();auto h=creatorLegacy::history(store->filePath()+".comment-workshop.sqlite",old["channel_id"].toVariant().toString(),old["id"].toVariant().toString());
        if(h["available"].toBool()){*commentRows=h["comments"].toArray();coverage=QString("已保存 %1 条评论 · 不代表平台全部评论").arg(commentRows->size());}
      }else if(!commentRows->isEmpty())coverage=QString("已保存 %1 条评论").arg(commentRows->size());
      commentState->setText(coverage);*commentLoaded=*current;renderComments();
    }
    if(tabs->currentWidget()==analysis&&*analysisLoaded!=*current){
      QString html;for(auto v:store->read("docs")){auto d=v.toObject();if(d["collectionId"]!=*current)continue;html+="<h3>"+d["title"].toString().toHtmlEscaped()+"</h3><p>"+d["text"].toString().toHtmlEscaped().replace("\n","<br>")+"</p>";}
      if(html.isEmpty())html="<p>这篇作品尚无关联研究资料。可保存校对稿后使用“入研究资料”，或进入“分析材料 / 交接”整理证据。</p>";
      analysis->setHtml(html);*analysisLoaded=*current;
    }
  }catch(const std::exception&e){state->setText(QString::fromUtf8(e.what()));}};
  QObject::connect(tabs,&QTabWidget::currentChanged,page,loadSupporting);
  QObject::connect(previousComments,&QPushButton::clicked,page,[=]{*commentOffset=qMax(0,*commentOffset-100);renderComments();});
  QObject::connect(nextComments,&QPushButton::clicked,page,[=]{*commentOffset+=100;renderComments();});
  auto loadRow = [=](const QJsonObject& j) {
    const auto id=j["id"].toString();business::require(!id.isEmpty(),"所选文稿已不存在；原显示保留");
    business::require(*current==id||qualityNote->toPlainText().trimmed().isEmpty(),"复核说明尚未记录；请先记录或清空说明，再切换文稿");
    *loading = true;
    if(*current!=id)qualityNote->clear();
    if(j!=*baseline){clearPlayer();commentLoaded->clear();analysisLoaded->clear();comments->setRowCount(0);analysis->clear();}
    *baseline = j;
    *current = id;
    title->setText(collectionPresentation::title(j));
    source->setText(j["sourceUrl"].toString());
    rights->setText(j["rightsBasis"].toString());
    media->setText(j["assetPath"].toString());
    mediaUrl->setText(j["mediaUrl"].toString());
    text->setPlainText(j["text"].toString());
    original->setPlainText(j["originalText"].toString());
    qualityState->setText(collectionQuality::describe(j));
    QStringList history;
    for(auto v:j["qualityReviews"].toArray()){const auto r=v.toObject();history<<r["reviewedAt"].toString()+" · 正文 "+r["bodyHash"].toString().left(12)+"\n"+r["note"].toString();}
    qualityHistory->setPlainText(history.isEmpty()?"尚无人工复核记录；自动转写完成不会生成复核记录。":history.join("\n\n"));
    segments->setRowCount(0);
    for (auto v : j["asrResult"].toObject()["segments"].toArray()) {
      auto s = v.toObject();
      int n = segments->rowCount();
      segments->insertRow(n);
      segments->setItem(
          n, 0, new QTableWidgetItem(QString::number(s["start"].toDouble())));
      segments->setItem(
          n, 1, new QTableWidgetItem(QString::number(s["end"].toDouble())));
      segments->setItem(n, 2, new QTableWidgetItem(s["text"].toString()));
    }
    viewRoot->setEnabled(!j["sourceRootId"].toString().isEmpty());
    QStringList statusParts{j["channel"].toString(),collectionPresentation::dateLabel(j),collectionPresentation::status(j)};statusParts.removeAll("");
    if(!j["error"].toString().isEmpty())statusParts<<j["error"].toString();
    if(j["status"]=="completed"||!j["asrResult"].toObject().isEmpty())statusParts<<"识别稿待核对";
    state->setText(statusParts.join(" · "));
    state->setToolTip(j["pipelineMessage"].toString());
    if (!pipeline->errorMessage().isEmpty())
      state->setText(pipeline->errorMessage());
    *loading = false;
    *dirty = false;
    updateCover();loadSupporting();folder->setEnabled(QFileInfo(j["assetPath"].toString()).isFile());
  };
  auto load=[=](QString id){loadRow(record(id));};
  auto videoReview=new QPushButton("▶ 播放视频");videoReview->setMinimumHeight(36);videoReview->setObjectName("openArchiveVideo");videoLayout->addWidget(videoReview);
  QObject::connect(videoReview,&QPushButton::clicked,page,[=]{try{
    business::require(!*dirty&&qualityNote->toPlainText().trimmed().isEmpty(),"请先保存校对或记录复核说明；未自动保存");
    const auto row=record(*current);business::require(!row.isEmpty()&&row==*baseline,"当前文稿已变化，请重读列表后选择");
    clearPlayer();QStringList roots{QFileInfo(store->filePath()).absolutePath()+"/collection-media"};if(row["legacySource"]=="expert_observations")roots<<"D:/WebstockRuntime/data/media-library/douyin"<<"D:/WebstockRuntime/releases/WebStockData/media-library/douyin";
    auto view=new ArchiveVideoReviewPage(row,roots,record,videoHost,true);*player=view;cover->hide();videoReview->hide();videoLayout->insertWidget(0,view,1);view->show();view->openMedia(true);
  }catch(const std::exception& e){state->setText(QString::fromUtf8(e.what()));}});
  QObject::connect(folder,&QPushButton::clicked,page,[=]{try{auto row=record(*current);business::require(row==*baseline,"作品已变化，请重新选择");auto file=QFileInfo(row["assetPath"].toString());business::require(file.isAbsolute()&&file.isFile()&&!file.filePath().startsWith("//")&&!file.filePath().startsWith("\\\\"),"视频文件不存在或不是本机路径");QDesktopServices::openUrl(QUrl::fromLocalFile(file.absolutePath()));}catch(const std::exception&e){state->setText(QString::fromUtf8(e.what()));}});
  auto documentHandle = new CollectionDocumentHandle(page);
  documentHandle->open = [=](const QJsonObject& expected) {
    business::require(!*dirty && qualityNote->toPlainText().trimmed().isEmpty(), "请先保存当前校对或记录复核说明，再打开来源原版本");
    const auto id = expected["id"].toString(); const auto currentRow = record(id);
    business::require(!id.isEmpty() && !currentRow.isEmpty() && currentRow == expected,
                      "来源文稿已编辑、恢复或删除；拒绝打开同ID新版本");
    QSignalBlocker block(list); search->clear(); render(); loadRow(currentRow);
    for (int n=0;n<list->count();++n) if (list->item(n)->data(Qt::UserRole).toString()==id) {list->setCurrentRow(n);break;}
    sections->setCurrentIndex(0);
  };
  SourceHandoffOpener sourceOpener = [=](const QString& kind, const QJsonObject& currentRow) {
    business::require(!*dirty && qualityNote->toPlainText().trimmed().isEmpty(), "请先保存当前校对或记录复核说明，再打开交接来源");
    if (kind=="collections") documentHandle->open(currentRow);
    else {business::require(bool(openResearch), "研究编辑入口待宿主接线");openResearch(currentRow);}
  };
  auto addLazySection=[=](QString title,std::function<QWidget*(QWidget*)> create){auto host=new QWidget(sections);auto layout=new QVBoxLayout(host);layout->setContentsMargins(0,0,0,0);int index=sections->addTab(host,title);QObject::connect(sections,&QTabWidget::currentChanged,host,[=](int chosen){if(chosen!=index||host->property("loaded").toBool())return;try{layout->addWidget(create(host));host->setProperty("loaded",true);}catch(const std::exception&e){auto label=new QLabel(QString::fromUtf8(e.what()),host);label->setWordWrap(true);layout->addWidget(label);}});};
  addLazySection("分析材料 / 手动交接",[=](QWidget* host){return sourceAnalysisPage(store,host,sourceOpener);});
  addLazySection("交接历史",[=](QWidget* host){return sourceHandoffPage(store,host,sourceOpener);});
  auto openPlans = [=] {
    if (!pipeline->ownsQueue() || plansHost->findChild<SourcePlansPage*>()) return;
    try {
      auto plans = std::make_shared<SourceSchedule>(store->filePath() + ".sources.sqlite");
      auto historyPage = new SourcePlansPage(plans, ensureSources(), plansHost);
      plansLayout->addWidget(historyPage, 1);
      plansMessage->hide();retryPlans->hide();
      QObject::connect(historyPage,&SourcePlansPage::openHistoryManuscript,page,[=](QString contentId,QString url){
    try {
      business::require(!*dirty,"请先保存当前校对，再打开历史文稿");QString found;
      for(auto r:*library){
        if((!url.isEmpty()&&sourceHistory::clean(r["sourceUrl"].toString())==url)||(!contentId.isEmpty()&&r["legacyOriginal"].toObject()["external_content_id"].toString()==contentId)){
          business::require(found.isEmpty(),"匹配到多个文稿版本，请从任务列表按来源选择");found=r["id"].toString();}}
      business::require(!found.isEmpty(),"没有匹配的本机文稿；旧历史状态保留，未触发采集");
      search->clear();render();for(int n=0;n<list->count();++n)if(list->item(n)->data(Qt::UserRole).toString()==found){list->setCurrentRow(n);break;}load(found);sections->setCurrentIndex(0);
    }catch(const std::exception&e){historyPage->findChild<QLabel*>("sourcePlansState")->setText(e.what());}
      });
      QObject::connect(historyPage,&SourcePlansPage::openRunCollection,page,
                       [=](const QString& id,const QString& revision){
        try {
          business::require(!*dirty,"请先保存当前校对，再打开本轮文稿");
          const auto job=record(id);
          business::require(!job.isEmpty(),"本轮文稿已不存在，未触发采集");
          business::require(job["executionRevision"].toString()==revision,
                            "本轮文稿已被恢复替换；不会打开同ID新记录");
          search->clear();render();
          for(int n=0;n<list->count();++n)
            if(list->item(n)->data(Qt::UserRole).toString()==id){list->setCurrentRow(n);break;}
          load(id);sections->setCurrentIndex(0);
        }catch(const std::exception&e){historyPage->findChild<QLabel*>("sourcePlansState")->setText(e.what());}
      });
      QObject::connect(historyPage, &SourcePlansPage::openRunResearch, page, [=](QJsonObject doc) {
        try {
          business::require(!*dirty, "请先保存当前校对，再打开本轮研究资料");
          business::require(bool(openResearch), "研究编辑入口待宿主接线；可先查看本轮研究原文，未启动采集");
          openResearch(doc);
        } catch (const std::exception& e) { historyPage->findChild<QLabel*>("sourcePlansState")->setText(e.what()); }
      });
    } catch (const std::exception& e) {
      plansMessage->setText(QString("作者计划未打开：") + QString::fromUtf8(e.what()) +
                            "。任务和文稿仍可用；释放计划占用后可在此重试。");
    }
  };
  QObject::connect(acquire, &QPushButton::clicked, page, openPlans);
  QObject::connect(retryPlans, &QPushButton::clicked, page, openPlans);
  QObject::connect(sections,&QTabWidget::currentChanged,page,[=](int index){if(index==1)ensureSources();else if(index==2)openPlans();});
  QObject::connect(viewRoot, &QPushButton::clicked, page, [=] {
    try {
      if (*dirty) { state->setText("请先保存当前校对，再查看初版"); return; }
      auto rootId = record(*current)["sourceRootId"].toString();
      business::require(!rootId.isEmpty() && !record(rootId).isEmpty(), "来源初版不存在，请核对备份中的资料");
      search->clear(); render();
      for (int n = 0; n < list->count(); ++n)
        if (list->item(n)->data(Qt::UserRole).toString() == rootId) { list->setCurrentRow(n); return; }
    } catch (const std::exception& e) { state->setText(QString::fromUtf8(e.what())); }
  });
  auto persist = [=] {
    pipeline->requireOwnership();
    business::require(!current->isEmpty(), "请先选择或导入记录");
    auto j = record(*current);
    // Merge only fields the editor changed; async downloads/ASR may have saved
    // meanwhile.
    const QJsonObject edited{{"title", title->text()},
                             {"sourceUrl", source->text().trimmed()},
                             {"rightsBasis", rights->text()},
                             {"assetPath", media->text().trimmed()},
                             {"mediaUrl", mediaUrl->text().trimmed()},
                             {"text", text->toPlainText()}};
    for (auto it = edited.begin(); it != edited.end(); ++it)
      if (it.value().toString() != (it.key()=="title"?collectionPresentation::title(*baseline):baseline->value(it.key()).toString()))
        j[it.key()] = it.value();
    store->save("collections", j);
    *dirty = false;
    load(*current);
    reload();render();
  };
  auto guarded = [=](std::function<void()> f) {
    try {
      f();
    } catch (const std::exception& e) {
      state->setText(e.what());
    }
  };
  QObject::connect(review,&QPushButton::clicked,page,[=]{guarded([=]{
    pipeline->requireOwnership();
    business::require(!*dirty,"请先保存当前校对，再记录复核");
    store->reviewCollection(*current,collectionQuality::bodyHash(baseline->value("text").toString()),qualityNote->toPlainText());
    qualityNote->clear();load(*current);state->setText("已记录当前正文复核；机器异常与事实核验状态未被覆盖");
  });});
  auto saveEngineSettings = [=] {
    pipeline->requireOwnership();
    QSettings s;
    s.setValue("asr/python", python->text().trimmed());
    s.setValue("asr/model", model->text().trimmed());
    s.sync();
    business::require(s.status() == QSettings::NoError, "本机引擎配置保存失败");
  };
  QObject::connect(saveEngine, &QPushButton::clicked, page, [=] {
    guarded([=] {
      saveEngineSettings();
      state->setText(
          "已保存引擎配置；来源自动采集与手工任务共用，启动时再校验可用性");
    });
  });
  for (auto e : {title, source, rights, media, mediaUrl})
    QObject::connect(e, &QLineEdit::textEdited, page, [=] {
      if (!*loading) *dirty = true;
    });
  QObject::connect(text, &QPlainTextEdit::textChanged, page, [=] {
    if (!*loading) *dirty = true;
  });
  QObject::connect(list, &QListWidget::currentItemChanged, page,
                   [=](QListWidgetItem* i, QListWidgetItem*) {
                     if (!i) return;
                     QString id = i->data(Qt::UserRole).toString();
                     guarded([=] {
                       if (*dirty) persist();
                       auto metadata=i->data(Qt::UserRole+1).toJsonObject();reads->record("collections",id,metadata["_recordSha256"].toString());state->setText("正在读取所选完整文稿…");
                     });
                     // A normal selection only changes the reader. A save may
                     // rebuild the list; a blocked draft must restore selection.
                     QSignalBlocker block(list);
                     for(int n=0;n<list->count();++n)
                       if(list->item(n)->data(Qt::UserRole).toString()==*current){list->setCurrentRow(n);break;}
                   });
  auto searchDelay=new QTimer(page);searchDelay->setSingleShot(true);searchDelay->setInterval(150);
  QObject::connect(search, &QLineEdit::textChanged, page, [=]{*offset=0;searchDelay->start();});
  QObject::connect(searchDelay,&QTimer::timeout,page,reload);
  *sourcesChanged = [=] {
    guarded([=] {
      reload();
    });
  };
  QObject::connect(refresh, &QPushButton::clicked, page, [=] {
    guarded([=] {
      if (*dirty) persist();
      reload();
    });
  });
  QObject::connect(save, &QPushButton::clicked, page, [=] {
    guarded([=] {
      persist();
      state->setText("校对稿已保存；识别原稿保持不变");
    });
  });
  QObject::connect(publish, &QPushButton::clicked, page, [=] {
    guarded([=] {
      persist();
      auto doc = publishCollection(store, *current);
      state->setText("已入研究资料：" + doc["title"].toString() +
                     "；请在研究页重读列表");
    });
  });
  QObject::connect(useAsr, &QPushButton::clicked, page, [=] {
    guarded([=] {
      auto j = record(*current);
      business::require(!j["asrText"].toString().isEmpty(), "尚无本次识别结果");
      text->setPlainText(j["asrText"].toString());
    });
  });
  QObject::connect(run, &QPushButton::clicked, page, [=] {
    guarded([=] {
      persist();
      saveEngineSettings();
      runner->enqueue(*current, python->text(), model->text());
    });
  });
  QObject::connect(cancel, &QPushButton::clicked, page,
                   [=] { guarded([=] { pipeline->cancel(*current); }); });
  QObject::connect(startPipeline, &QPushButton::clicked, page, [=] {
    guarded([=] {
      persist();
      saveEngineSettings();
      const auto job = record(*current);
      if (!job["sourceProfile"].toString().isEmpty() && job["assetPath"].toString().isEmpty() &&
          job["text"].toString().isEmpty() && job["originalText"].toString().isEmpty() && job["asrText"].toString().isEmpty()) {
        ensureSources()->retryJob(job);
        sections->setCurrentIndex(1);
      } else pipeline->enqueue(*current, python->text(), model->text());
    });
  });
  QObject::connect(stopPipeline, &QPushButton::clicked, page,
                   [=] { guarded([=] { pipeline->cancel(*current); }); });
  QObject::connect(pipeline, &CollectionPipeline::changed, page, [=] {
    reload();
    if (!pipeline->errorMessage().isEmpty())
      state->setText(pipeline->errorMessage());
  });
  QObject::connect(runner, &CollectionRunner::changed, page, [=] {
    reload();
  });
  QObject::connect(runner, &CollectionRunner::progress, page,
                   [=](QString id, QString message) {
                     if (id == *current) state->setText(message);
                   });
  QObject::connect(add, &QPushButton::clicked, page, [=] {
    guarded([=] {
      pipeline->requireOwnership();
      business::require(qualityNote->toPlainText().trimmed().isEmpty(),"请先记录或清空复核说明，再添加媒体");
      if (*dirty) persist();
      auto path = QFileDialog::getOpenFileName(
          page, "选择你有权处理的本机媒体", {},
          "音视频 (*.mp4 *.m4a *.wav *.mp3 *.flac *.mkv);;全部文件 (*)");
      if (path.isEmpty()) return;
      auto j = store->save("collections",
                           {{"title", QFileInfo(path).completeBaseName()},
                            {"assetPath", path},
                            {"status", "imported"},
                            {"text", ""},
                            {"originalText", ""}});
      load(j["id"].toString());
      reload();render();
      state->setText("请填写授权依据后排队转写；不上传媒体");
    });
  });
  QObject::connect(link, &QPushButton::clicked, page, [=] {
    guarded([=] {
      pipeline->requireOwnership();
      business::require(qualityNote->toPlainText().trimmed().isEmpty(),"请先记录或清空复核说明，再新建文稿");
      if (*dirty) persist();
      auto j = store->save("collections", {{"title", "新媒体任务"},
                                           {"status", "imported"},
                                           {"text", ""},
                                           {"originalText", ""}});
      load(j["id"].toString());
      reload();render();
      state->setText(
          "填写来源、授权依据和有效媒体地址后启用；作品网页地址不能直接作为媒体"
          "下载");
    });
  });
  QObject::connect(import, &QPushButton::clicked, page, [=] {
    guarded([=] {
      pipeline->requireOwnership();
      business::require(qualityNote->toPlainText().trimmed().isEmpty(),"请先记录或清空复核说明，再导入文稿");
      if (*dirty) persist();
      auto path = QFileDialog::getOpenFileName(
          page, "导入授权文稿", {},
          "文本/字幕 (*.txt *.srt *.vtt);;全部文件 (*)");
      if (path.isEmpty()) return;
      QFile f(path);
      business::require(
          f.size() <= 2 * 1024 * 1024 && f.open(QIODevice::ReadOnly),
          "无法读取文稿或超过2MiB");
      auto value = QString::fromUtf8(f.readAll());
      business::require(!value.trimmed().isEmpty(), "文稿为空");
      auto j = store->save("collections",
                           {{"title", QFileInfo(path).completeBaseName()},
                            {"status", "imported"},
                            {"text", value},
                            {"originalText", value},
                            {"rightsBasis", "用户主动导入本机文稿"}});
      load(j["id"].toString());
      reload();render();
    });
  });
  reads->shown=reload;
  reads->completed=[=](QJsonObject result){guarded([=]{
    if(!result["error"].toString().isEmpty()){state->setText(result["error"].toString()+"；旧结果和草稿保留");return;}
    if(result["operation"]=="list"){
      if(result["query"]!=search->text().trimmed())return;
      auto next=collectionPresentation::newestFirst(result["rows"].toArray());QString beforeHash,afterHash;
      for(auto r:*library)if(r["id"]==*current)beforeHash=r["_recordSha256"].toString();
      for(auto r:next)if(r["id"]==*current)afterHash=r["_recordSha256"].toString();
      if(*library!=next){*library=next;*authorAliases=collectionPresentation::authorAliases(next);QSignalBlocker block(author);auto selectedAuthor=author->currentData().toString();auto resolvedAuthor=authorAliases->value(selectedAuthor,selectedAuthor);if(resolvedAuthor!=selectedAuthor)*offset=0;author->clear();author->addItem("全部作者 / 来源","");QMap<QString,QString> names;for(auto r:*library)if(!r["channel"].toString().isEmpty())names[collectionPresentation::authorKey(r,*authorAliases)]=r["channel"].toString();for(auto i=names.cbegin();i!=names.cend();++i)author->addItem(i.value(),i.key());author->setCurrentIndex(qMax(0,author->findData(resolvedAuthor)));render();}
      page->setProperty("listReady",true);
      if(current->isEmpty()&&!*dirty&&qualityNote->toPlainText().isEmpty()&&list->count())list->setCurrentRow(0);
      else if(!*dirty&&!current->isEmpty()&&!afterHash.isEmpty()&&beforeHash!=afterHash)reads->record("collections",*current,afterHash);
    }else{
      if(*dirty){state->setText("载入期间有未保存校对；草稿保留，未替换正文");return;}
      auto row=result["row"].toObject();business::require(!row.isEmpty(),"原文稿已删除，当前草稿保留");loadRow(row);QSignalBlocker block(list);for(int i=0;i<list->count();++i)if(list->item(i)->data(Qt::UserRole)==*current){list->setCurrentRow(i);break;}
    }
  });};
  render();
  split->setSizes({350, 950});
  return page;
}
