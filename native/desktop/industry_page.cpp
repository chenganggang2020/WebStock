#include "industry_page.hpp"
#include "business_read_request.hpp"
#include "research_companies_page.hpp"
#include "industry_version_page.hpp"
#include "industry_relation_draft.hpp"

#include <QtWidgets>
namespace {
class IndustryEvidenceWidget final:public QWidget{
public:
 using QWidget::QWidget;
 std::function<void()> prepareClose;
};
}
void prepareIndustryClose(QWidget* page){if(auto*p=dynamic_cast<IndustryEvidenceWidget*>(page))if(p->prepareClose)p->prepareClose();}
static QWidget* industryEvidenceEditor(std::shared_ptr<BusinessStore> store, QWidget* parent) {
  auto page = new IndustryEvidenceWidget(parent);
  page->setObjectName("industryEvidence");
  auto layout = new QVBoxLayout(page);
  auto tools = new QHBoxLayout;
  layout->addLayout(tools);
  auto topics = new QComboBox;
  topics->setObjectName("researchTopics");
  tools->addWidget(topics, 1);
  auto name = new QLineEdit;
  name->setObjectName("topicName");
  name->setPlaceholderText("新主题 / 修改主题名");
  tools->addWidget(name, 1);
  auto add = new QPushButton("新增主题");
  add->setObjectName("saveTopic");
  tools->addWidget(add);
  auto rename = new QPushButton("重命名当前主题");
  tools->addWidget(rename);
  auto state = new QLabel(
      "点击产业关系查看原文与核验记录。");
  state->setObjectName("relationState");
  state->setWordWrap(true);
  layout->addWidget(state);
  auto split = new QSplitter;
  layout->addWidget(split, 1);
  auto left = new QWidget;
  split->addWidget(left);
  auto ll = new QVBoxLayout(left);
  auto table = new QTableWidget(0, 4);
  table->setObjectName("relationTable");
  table->setHorizontalHeaderLabels({"阶段", "关系 / 判断", "证据方向", "核验"});
  table->setEditTriggers(QAbstractItemView::NoEditTriggers);
  table->setSelectionBehavior(QAbstractItemView::SelectRows);
  table->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch);
  ll->addWidget(table);
  auto source = new QPlainTextEdit;
  source->setReadOnly(true);
  source->setObjectName("relationSourceText");
  ll->addWidget(source, 1);
  auto right = new QWidget;
  split->addWidget(right);
  auto rl = new QVBoxLayout(right);
  auto docs = new QComboBox;
  docs->setObjectName("relationDocument");
  docs->setMinimumContentsLength(25);
  docs->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);
  rl->addWidget(new QLabel("引用资料（选中后左下显示完整原文）"));
  rl->addWidget(docs);
  auto reload = new QPushButton("重新读取资料列表");
  rl->addWidget(reload);
  auto stage = new QComboBox;
  stage->addItems({"原材料", "设备", "零部件", "制造", "应用"});
  rl->addWidget(stage);
  auto claim = new QLineEdit;
  claim->setPlaceholderText("具体关系 / 判断，不自动映射股票代码");
  claim->setObjectName("relationClaim");
  rl->addWidget(claim);
  auto quote = new QPlainTextEdit;
  quote->setObjectName("relationQuote");
  quote->setPlaceholderText("粘贴与原文完全一致的引文，最多2000字");
  rl->addWidget(quote, 1);
  auto selectedQuote = new QPushButton("使用左侧选中的原文");
  rl->addWidget(selectedQuote);
  auto polarity = new QComboBox;
  polarity->addItems({"支持", "反证"});
  rl->addWidget(polarity);
  auto verification = new QComboBox;
  verification->addItems({"待核验", "人工已核验"});
  rl->addWidget(verification);
  auto actions = new QHBoxLayout;
  rl->addLayout(actions);
  auto fresh = new QPushButton("新关系"), save = new QPushButton("保存关系"),
       remove = new QPushButton("删除关系");
  save->setObjectName("saveRelation");
  for (auto b : {fresh, save, remove}) actions->addWidget(b);
  auto chosen = std::make_shared<QString>();
  auto records = std::make_shared<QJsonArray>();
  auto relations=std::make_shared<QJsonArray>();
  auto wantedTopic=std::make_shared<QString>();
  auto wantedDocument=std::make_shared<QString>();
  auto confirmedDocument=std::make_shared<QString>();
  auto drafts=std::make_shared<QMap<QPair<QString,QString>,QJsonObject>>();
  auto topicSelection=std::make_shared<QMap<QString,QString>>();
  auto relationSha=std::make_shared<QString>(),documentSha=std::make_shared<QString>();
  auto draftStore=std::make_shared<industryRelationDraft::Store>(QFileInfo(store->filePath()).absolutePath()+"/industry-relations-draft-v1.json");
  auto draftSha=std::make_shared<QString>(),draftError=std::make_shared<QString>();
  auto draftReady=std::make_shared<bool>(false),haveDraft=std::make_shared<bool>(false);
  auto topicIds=std::make_shared<QSet<QString>>();
  const QStringList stages{"materials","equipment","components","manufacturing","applications"};
  const QStringList polarities{"supports","contradicts"},verifications{"unverified","manuallyVerified"};
  auto stashDraft=[=]{
    (*drafts)[qMakePair(*wantedTopic,*chosen)]={{"id",*chosen},{"documentId",*wantedDocument},
      {"claim",claim->text()},{"quote",quote->toPlainText()},{"stageIndex",stage->currentIndex()},
      {"polarityIndex",polarity->currentIndex()},{"verificationIndex",verification->currentIndex()},
      {"relationSha256",*relationSha},{"documentSha256",*documentSha}};
    (*topicSelection)[*wantedTopic]=*chosen;
    *haveDraft=true;
  };
  auto applyDraft=[=](QJsonObject d){
    *chosen=d["id"].toString();claim->setText(d["claim"].toString());quote->setPlainText(d["quote"].toString());
    stage->setCurrentIndex(d["stageIndex"].toInt());polarity->setCurrentIndex(d["polarityIndex"].toInt());verification->setCurrentIndex(d["verificationIndex"].toInt());
    *relationSha=d["relationSha256"].toString();*documentSha=d["documentSha256"].toString();
    *wantedDocument=d["documentId"].toString();QSignalBlocker block(docs);int index=-1;
    for(int i=0;i<docs->count();++i)if(docs->itemData(i).toJsonObject()["id"]==*wantedDocument){index=i;break;}
    if(index<0&&!wantedDocument->isEmpty()){docs->addItem("原资料缺失 · "+*wantedDocument,QJsonObject{{"id",*wantedDocument},{"_missing",true}});index=docs->count()-1;}
    docs->setCurrentIndex(index);confirmedDocument->clear();
  };
  try{
    auto saved=draftStore->load(*draftSha);
    if(!saved.isEmpty()){
      for(auto v:saved["entries"].toArray()){auto d=v.toObject();auto key=industryRelationDraft::key(d);(*drafts)[key]={{"id",key.second},{"documentId",d["documentId"]},{"claim",d["claim"]},{"quote",d["quote"]},{"stageIndex",stages.indexOf(d["stage"].toString())},{"polarityIndex",polarities.indexOf(d["polarity"].toString())},{"verificationIndex",verifications.indexOf(d["verification"].toString())},{"relationSha256",d["relationSha256"]},{"documentSha256",d["documentSha256"]}};}
      for(auto v:saved["selection"].toArray()){auto key=industryRelationDraft::key(v.toObject());(*topicSelection)[key.first]=key.second;}
      auto key=industryRelationDraft::key(saved["currentKey"].toObject());*wantedTopic=key.first;applyDraft(drafts->value(key));*haveDraft=true;
    }
    *draftReady=true;
  }catch(const std::exception&e){*draftError=QString::fromUtf8(e.what());state->setText(*draftError);}
  page->prepareClose=[=]{
    business::require(*draftReady,"关系原草稿尚未完整读取，未覆盖原件："+*draftError);stashDraft();QJsonArray entries,selection;
    for(auto i=drafts->cbegin();i!=drafts->cend();++i){auto d=i.value();auto out=industryRelationDraft::identity(i.key());for(auto k:{"documentId","claim","quote","relationSha256","documentSha256"})out[k]=d[k];out["stage"]=stages.value(d["stageIndex"].toInt());out["polarity"]=polarities.value(d["polarityIndex"].toInt());out["verification"]=verifications.value(d["verificationIndex"].toInt());entries.append(out);}
    for(auto i=topicSelection->cbegin();i!=topicSelection->cend();++i)selection.append(industryRelationDraft::identity({i.key(),i.value()}));
    *draftSha=draftStore->save({{"schema","native-industry-relation-drafts/v1"},{"currentKey",industryRelationDraft::identity({*wantedTopic,*chosen})},{"selection",selection},{"entries",entries}},*draftSha);
  };
  auto* reads=new BusinessReadRequest(store->filePath(),page);
  auto updateSaveState=[=]{
    const bool documentReady=!confirmedDocument->isEmpty()&&*confirmedDocument==*wantedDocument&&docs->currentData().toJsonObject()["id"]==*confirmedDocument&&docs->currentData().toJsonObject()["_recordSha256"]==*documentSha;
    const bool topicReady=!wantedTopic->isEmpty()&&topics->currentData().toString()==*wantedTopic&&topicIds->contains(*wantedTopic);
    bool relationReady=chosen->isEmpty();for(auto v:*relations){auto r=v.toObject();if(r["id"]==*chosen&&r["topicId"]==*wantedTopic&&r["_recordSha256"]==*relationSha)relationReady=true;}
    selectedQuote->setEnabled(documentReady);save->setEnabled(*draftReady&&documentReady&&topicReady&&relationReady);
    if(!*draftReady)state->setText("关系原草稿尚未完整读取，原件保留："+*draftError);
    else if(!relationReady)state->setText("原关系已缺失或版本变化；完整人工稿保留，未改绑或覆盖，保存禁用");
    if(save->isEnabled())state->setText("当前主题与资料已载入；人工稿保留，可保存");
  };
  auto offset=std::make_shared<int>(0);auto batch=new QHBoxLayout;ll->insertLayout(1,batch);auto previous=new QPushButton("上一页");previous->setObjectName("relationPrevious");auto next=new QPushButton("下一页");next->setObjectName("relationNext");auto count=new QLabel;batch->addWidget(previous);batch->addWidget(count,1);batch->addWidget(next);
  auto readSource = [=] {
    auto d = docs->currentData().toJsonObject();
    auto id=d["id"].toString();if(!id.isEmpty())*wantedDocument=id;
    if(documentSha->isEmpty())*documentSha=d["_recordSha256"].toString();
    confirmedDocument->clear();updateSaveState();
    if(d["_missing"].toBool()){state->setText("原资料 "+*wantedDocument+" 已不存在；完整人工稿和原ID保留，保存禁用");return;}
    if(id.isEmpty()){state->setText(wantedDocument->isEmpty()?"尚未选择可读资料；人工稿保留，保存禁用":"原资料 "+*wantedDocument+" 已不存在；人工稿保留，未替换到其他资料，保存禁用");return;}
    reads->record("docs",*wantedDocument,d["_recordSha256"].toString());
  };
  auto refreshDocs = [=] {
    confirmedDocument->clear();updateSaveState();
    state->setText("正在重新读取主题与资料；人工稿保留，保存禁用");
    reads->submit({{"operation","industry"}});
  };
  auto render = [=] {
    table->setRowCount(0);
    *records = {};
    for (auto v : *relations) {
      auto r = v.toObject();
      if (r["topicId"].toString() != topics->currentData().toString()) continue;
      records->append(r);
    }
    for(auto i=drafts->cbegin();i!=drafts->cend();++i){if(i.key().first!=topics->currentData().toString()||i.key().second.isEmpty())continue;bool found=false;for(auto v:*records)found|=v.toObject()["id"]==i.key().second;if(found)continue;auto d=i.value();records->append(QJsonObject{{"id",i.key().second},{"topicId",i.key().first},{"claim","原关系缺失 · "+d["claim"].toString()},{"stage",stages.value(d["stageIndex"].toInt())},{"polarity",polarities.value(d["polarityIndex"].toInt())},{"verification",verifications.value(d["verificationIndex"].toInt())}});}
    *offset=qBound(0,*offset,qMax(0,((int(records->size())-1)/100)*100));
    for(int index=*offset;index<qMin(*offset+100,int(records->size()));++index){auto r=records->at(index).toObject();
      int i = table->rowCount();
      table->insertRow(i);
      QStringList values{
          stage->itemText(stages.indexOf(r["stage"].toString())),
          r["claim"].toString(),
          r["polarity"] == "contradicts" ? "反证" : "支持",
          r["verification"] == "manuallyVerified" ? "人工已核验" : "待核验"};
      for (int j = 0; j < 4; j++){
        auto item=new QTableWidgetItem(values[j]);item->setData(Qt::UserRole,r);table->setItem(i,j,item);
      }
    }
    previous->setEnabled(*offset>0);next->setEnabled(*offset+100<records->size());count->setText(QString("完整%1条 · 第%2/%3页").arg(records->size()).arg(*offset/100+1).arg(qMax(1,(int(records->size())+99)/100)));
  };
  QObject::connect(previous,&QPushButton::clicked,page,[=]{*offset=qMax(0,*offset-100);render();});QObject::connect(next,&QPushButton::clicked,page,[=]{*offset+=100;render();});
  auto refreshTopics = [=](QString select) {
    *wantedTopic=select;refreshDocs();
  };
  auto saveTopic = [=](bool update) {
    try {
      QJsonObject t{{"name", name->text()}};
      if (update) {
        business::require(topics->currentIndex() >= 0, "先选择主题");
        t=BusinessStore::readRecord(store->filePath(),"topics",topics->currentData().toString());business::require(!t.isEmpty(),"原主题已不存在");
        t["name"] = name->text();
      }
      t = store->save("topics", t);
      refreshTopics(t["id"].toString());
      state->setText("主题已保存");
    } catch (const std::exception& e) {
      state->setText(e.what());
    }
  };
  QObject::connect(add, &QPushButton::clicked, page, [=] { saveTopic(false); });
  QObject::connect(rename, &QPushButton::clicked, page,
                   [=] { saveTopic(true); });
  QObject::connect(topics, &QComboBox::currentIndexChanged, page, [=] {
    auto id=topics->currentData().toString();if(id==*wantedTopic)return;
    stashDraft();*wantedTopic=id;*offset=0;
    applyDraft(drafts->value(qMakePair(id,topicSelection->value(id))));
    render();updateSaveState();readSource();
  });
  QObject::connect(docs, &QComboBox::currentIndexChanged, page, [=]{if(docs->currentData().toJsonObject()["id"].toString()!=*wantedDocument)documentSha->clear();readSource();});
  QObject::connect(reload, &QPushButton::clicked, page, refreshDocs);
  QObject::connect(selectedQuote, &QPushButton::clicked, page, [=] {
    quote->setPlainText(
        source->textCursor().selectedText().replace(QChar(0x2029), '\n'));
  });
  QObject::connect(fresh, &QPushButton::clicked, page, [=] {
    stashDraft();
    chosen->clear();
    relationSha->clear();
    claim->clear();
    quote->clear();
    verification->setCurrentIndex(0);
  });
  QObject::connect(save, &QPushButton::clicked, page, [=] {
    try {
      business::require(save->isEnabled()&&!wantedTopic->isEmpty()&&topics->currentData().toString()==*wantedTopic&&!confirmedDocument->isEmpty()&&docs->currentData().toJsonObject()["id"]==*confirmedDocument,"主题或原资料尚未确认；人工稿保留，未保存");
      QJsonObject relation;
      if(!chosen->isEmpty()){relation=BusinessStore::readRecord(store->filePath(),"relations",*chosen,*relationSha);business::require(!relation.isEmpty()&&relation["topicId"]==*wantedTopic,"原关系已缺失或改属，人工稿保留");}
      business::require(!BusinessStore::readRecord(store->filePath(),"docs",*wantedDocument,*documentSha).isEmpty(),"原资料已缺失，人工稿保留");
      const QJsonObject fields{{"id", *chosen},
           {"topicId", topics->currentData().toString()},
           {"documentId", docs->currentData().toJsonObject()["id"]},
           {"stage", stages.value(stage->currentIndex())},
           {"claim", claim->text()},
           {"quote", quote->toPlainText()},
           {"polarity",
            polarity->currentIndex() == 0 ? "supports" : "contradicts"},
           {"verification", verification->currentIndex() == 0
                                ? "unverified"
                                : "manuallyVerified"}};
      for(auto it=fields.begin();it!=fields.end();++it)relation[it.key()]=it.value();
      auto r=store->save("relations",relation);
      drafts->remove(qMakePair(*wantedTopic,*chosen));
      *chosen = r["id"].toString();
      *relationSha=QString::fromLatin1(QCryptographicHash::hash(QJsonDocument(r).toJson(QJsonDocument::Compact),QCryptographicHash::Sha256).toHex());
      r["_recordSha256"]=*relationSha;stashDraft();
      bool replaced=false;for(int i=0;i<relations->size();++i)if(relations->at(i).toObject()["id"]==r["id"]){(*relations)[i]=r;replaced=true;break;}if(!replaced)relations->append(r);
      render();
      state->setText("关系已保存 · 引用与本机原文逐字核对");
    } catch (const std::exception& e) {
      state->setText(e.what());
    }
  });
  QObject::connect(remove, &QPushButton::clicked, page, [=] {
    if (chosen->isEmpty() ||
        QMessageBox::question(page, "删除关系",
                              "仅删除选中的关系，不删除原文？") !=
            QMessageBox::Yes)
      return;
    try {
      store->remove("relations", *chosen);
      drafts->remove(qMakePair(*wantedTopic,*chosen));
      for(int i=relations->size()-1;i>=0;--i)if(relations->at(i).toObject()["id"]==*chosen)relations->removeAt(i);
      chosen->clear();
      relationSha->clear();(*topicSelection)[*wantedTopic]=QString();
      claim->clear();quote->clear();verification->setCurrentIndex(0);
      render();
    } catch (const std::exception& e) {
      state->setText(e.what());
    }
  });
  QObject::connect(table, &QTableWidget::cellClicked, page, [=](int row, int) {
    if(!table->item(row,0))return;
    auto r = table->item(row,0)->data(Qt::UserRole).toJsonObject();
    if(r["id"]==*chosen)return;
    stashDraft();auto cached=drafts->constFind(qMakePair(*wantedTopic,r["id"].toString()));
    if(cached!=drafts->cend()){applyDraft(*cached);readSource();return;}
    *chosen = r["id"].toString();
    *relationSha=r["_recordSha256"].toString();documentSha->clear();
    claim->setText(r["claim"].toString());
    quote->setPlainText(r["quote"].toString());
    stage->setCurrentIndex(stages.indexOf(r["stage"].toString()));
    polarity->setCurrentIndex(r["polarity"] == "contradicts" ? 1 : 0);
    verification->setCurrentIndex(r["verification"] == "manuallyVerified" ? 1
                                                                          : 0);
    *wantedDocument=r["documentId"].toString();bool found=false;
    for (int i = 0; i < docs->count(); i++)
      if (docs->itemData(i).toJsonObject()["id"] == r["documentId"]){QSignalBlocker block(docs);docs->setCurrentIndex(i);found=true;break;}
    if(!found){QSignalBlocker block(docs);docs->setCurrentIndex(-1);confirmedDocument->clear();updateSaveState();state->setText("原关系引用资料 "+*wantedDocument+" 已不存在；人工稿保留，未按名称替换，保存禁用");return;}
    readSource();
  });
  reads->shown=[=]{auto id=topics->currentData().toString();refreshTopics(id.isEmpty()?*wantedTopic:id);};
  reads->completed=[=](QJsonObject result){
    if(!result["error"].toString().isEmpty()){confirmedDocument->clear();updateSaveState();state->setText(result["error"].toString()+"；原结果与人工稿保留，可重读，保存禁用");return;}
    if(result["operation"]=="industry"){
      auto snapshot=result["snapshot"].toObject();*relations=snapshot["relations"].toArray();
      {QSignalBlocker block(topics);topics->clear();topicIds->clear();for(auto v:snapshot["topics"].toArray()){auto t=v.toObject();topicIds->insert(t["id"].toString());topics->addItem(t["name"].toString(),t["id"].toString());}for(auto i=drafts->cbegin();i!=drafts->cend();++i)if(topics->findData(i.key().first)<0)topics->addItem("原主题缺失 · "+i.key().first,i.key().first);auto index=!*haveDraft&&wantedTopic->isEmpty()?(topics->count()?0:-1):topics->findData(*wantedTopic);topics->setCurrentIndex(index);if(!*haveDraft&&wantedTopic->isEmpty()&&index>=0)*wantedTopic=topics->currentData().toString();}
      {QSignalBlocker block(docs);docs->clear();for(auto v:snapshot["docs"].toArray()){auto d=v.toObject();docs->addItem(d["title"].toString(),d);}if(*haveDraft||!wantedDocument->isEmpty()){int index=-1;for(int i=0;i<docs->count();++i)if(docs->itemData(i).toJsonObject()["id"]==*wantedDocument){index=i;break;}if(index<0&&!wantedDocument->isEmpty()){docs->addItem("原资料缺失 · "+*wantedDocument,QJsonObject{{"id",*wantedDocument},{"_missing",true}});index=docs->count()-1;}docs->setCurrentIndex(index);}}
      if(topics->currentIndex()<0&&!wantedTopic->isEmpty())state->setText("原主题 "+*wantedTopic+" 已不存在；人工稿保留，未替换到其他主题，保存禁用");
      render();page->setProperty("industryReady",true);readSource();
    }else{
      auto d=result["row"].toObject();if(d.isEmpty()||d["id"]!=docs->currentData().toJsonObject()["id"]||d["id"]!=*wantedDocument){confirmedDocument->clear();updateSaveState();state->setText("原资料已不存在；原结果和人工稿保留，保存禁用");return;}
      source->setPlainText(d["title"].toString()+"\n来源："+d["sourceUrl"].toString()+"\n\n"+d["text"].toString());*confirmedDocument=d["id"].toString();updateSaveState();
    }
  };
  selectedQuote->setEnabled(false);save->setEnabled(false);
  split->setSizes({760, 420});
  return page;
}
QWidget* industryPage(std::shared_ptr<BusinessStore> store,QWidget* parent){
 auto tabs=new QTabWidget(parent);tabs->setObjectName("industryWorkspace");auto evidence=industryEvidenceEditor(store,tabs);
 auto companyHost=new QWidget(tabs);auto companyLayout=new QVBoxLayout(companyHost);companyLayout->setContentsMargins(0,0,0,0);
 tabs->addTab(evidence,"原文关系 / 人工核验");tabs->addTab(companyHost,"公司清单 / 环节图");auto history=new IndustryVersionPage(store,{},tabs);tabs->addTab(history,"历史版本 / 完整原件");auto topics=evidence->findChild<QComboBox*>("researchTopics");
 QObject::connect(tabs,&QTabWidget::currentChanged,tabs,[store,companyHost,companyLayout,topics,history](int index){
  if(index==1){auto companies=companyLayout->count()?dynamic_cast<ResearchCompaniesPage*>(companyLayout->itemAt(0)->widget()):nullptr;if(!companies){companies=new ResearchCompaniesPage(store,companyHost);companyLayout->addWidget(companies);companies->topicChanged=[topics](QString id){int i=topics->findData(id);if(i>=0)topics->setCurrentIndex(i);};}companies->setTopic(topics->currentData().toString());}
  if(index==2)history->setTopic(topics->currentData().toString());
 });return tabs;
}
