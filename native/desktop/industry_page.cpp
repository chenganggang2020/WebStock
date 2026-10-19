#include "industry_page.hpp"
#include "business_read_request.hpp"
#include "research_companies_page.hpp"
#include "industry_version_page.hpp"

#include <QtWidgets>
static QWidget* industryEvidenceEditor(std::shared_ptr<BusinessStore> store, QWidget* parent) {
  auto page = new QWidget(parent);
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
  auto* reads=new BusinessReadRequest(store->filePath(),page);
  auto updateSaveState=[=]{
    const bool documentReady=!confirmedDocument->isEmpty()&&*confirmedDocument==*wantedDocument&&docs->currentData().toJsonObject()["id"]==*confirmedDocument;
    const bool topicReady=!wantedTopic->isEmpty()&&topics->currentData().toString()==*wantedTopic;
    selectedQuote->setEnabled(documentReady);save->setEnabled(documentReady&&topicReady);
    if(save->isEnabled())state->setText("当前主题与资料已载入；人工稿保留，可保存");
  };
  auto offset=std::make_shared<int>(0);auto batch=new QHBoxLayout;ll->insertLayout(1,batch);auto previous=new QPushButton("上一页");previous->setObjectName("relationPrevious");auto next=new QPushButton("下一页");next->setObjectName("relationNext");auto count=new QLabel;batch->addWidget(previous);batch->addWidget(count,1);batch->addWidget(next);
  const QStringList stages{"materials", "equipment", "components",
                           "manufacturing", "applications"};
  auto readSource = [=] {
    auto d = docs->currentData().toJsonObject();
    auto id=d["id"].toString();if(!id.isEmpty())*wantedDocument=id;
    confirmedDocument->clear();updateSaveState();
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
    chosen->clear();
    auto id=topics->currentData().toString();if(!id.isEmpty())*wantedTopic=id;*offset=0;
    render();updateSaveState();
  });
  QObject::connect(docs, &QComboBox::currentIndexChanged, page, readSource);
  QObject::connect(reload, &QPushButton::clicked, page, refreshDocs);
  QObject::connect(selectedQuote, &QPushButton::clicked, page, [=] {
    quote->setPlainText(
        source->textCursor().selectedText().replace(QChar(0x2029), '\n'));
  });
  QObject::connect(fresh, &QPushButton::clicked, page, [=] {
    chosen->clear();
    claim->clear();
    quote->clear();
    verification->setCurrentIndex(0);
  });
  QObject::connect(save, &QPushButton::clicked, page, [=] {
    try {
      business::require(save->isEnabled()&&!wantedTopic->isEmpty()&&topics->currentData().toString()==*wantedTopic&&!confirmedDocument->isEmpty()&&docs->currentData().toJsonObject()["id"]==*confirmedDocument,"主题或原资料尚未确认；人工稿保留，未保存");
      QJsonObject relation;
      if(!chosen->isEmpty())relation=BusinessStore::readRecord(store->filePath(),"relations",*chosen);
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
      *chosen = r["id"].toString();
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
      for(int i=relations->size()-1;i>=0;--i)if(relations->at(i).toObject()["id"]==*chosen)relations->removeAt(i);
      chosen->clear();
      render();
    } catch (const std::exception& e) {
      state->setText(e.what());
    }
  });
  QObject::connect(table, &QTableWidget::cellClicked, page, [=](int row, int) {
    auto r = table->item(row,0)->data(Qt::UserRole).toJsonObject();
    *chosen = r["id"].toString();
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
      {QSignalBlocker block(topics);topics->clear();for(auto v:snapshot["topics"].toArray()){auto t=v.toObject();topics->addItem(t["name"].toString(),t["id"].toString());}auto index=wantedTopic->isEmpty()?(topics->count()?0:-1):topics->findData(*wantedTopic);topics->setCurrentIndex(index);if(wantedTopic->isEmpty()&&index>=0)*wantedTopic=topics->currentData().toString();}
      {QSignalBlocker block(docs);docs->clear();for(auto v:snapshot["docs"].toArray()){auto d=v.toObject();docs->addItem(d["title"].toString(),d);}if(!wantedDocument->isEmpty()){int index=-1;for(int i=0;i<docs->count();++i)if(docs->itemData(i).toJsonObject()["id"]==*wantedDocument){index=i;break;}docs->setCurrentIndex(index);}}
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
