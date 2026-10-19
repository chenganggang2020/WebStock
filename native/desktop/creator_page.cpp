#include "creator_page.hpp"
#include "business_read_request.hpp"
#include "creator_index_page.hpp"
#include "creator_ai_page.hpp"
#include "creator_legacy.hpp"
#include "comment_workshop_page.hpp"
#include <QtWidgets>

namespace {
class GraphView : public QGraphicsView {
 public:
  explicit GraphView(QWidget* p):QGraphicsView(p) {setDragMode(ScrollHandDrag);setRenderHint(QPainter::Antialiasing);setTransformationAnchor(AnchorUnderMouse);}
 protected:
  void wheelEvent(QWheelEvent* e) override {double factor=e->angleDelta().y()>0?1.12:1/1.12;if(transform().m11()*factor>=.35&&transform().m11()*factor<=3)scale(factor,factor);e->accept();}
};
class CreatorPage : public QWidget {
  std::shared_ptr<BusinessStore> store;
  BusinessReadRequest* reads=nullptr;
  QStackedWidget* internal=nullptr;CreatorAiPage* ai=nullptr;
  QComboBox *documents,*versions,*type,*polarity;
  QLabel *state,*coverage;
  QTableWidget* table;
  QPlainTextEdit *source,*quote;
  QLineEdit *topic,*from,*to,*uncertainty,*summary,*focus;
  QTabWidget *views,*reader;
  GraphView* graph;
  QGraphicsScene* scene;
  QPushButton *save,*remove,*selectedText;
  QJsonObject row,analysis;
  QJsonArray edges;
  QString id,hash,previous;
  int selected=-1,version=0;
  bool loading=false,dirty=false;
  QPlainTextEdit* legacyHistory=nullptr;QLabel* legacyState=nullptr;QPushButton* legacyOpen=nullptr;
  QWidget* commentsPanel=nullptr;QWidget* commentsPage=nullptr;QString legacyBundle;
  bool manualAllowed(const QWidget* origin=nullptr)const{return isVisible()&&isEnabled()&&!window()->isMinimized()&&QGuiApplication::applicationState()==Qt::ApplicationActive&&(!internal||internal->currentWidget()!=ai)&&(!origin||(origin->isVisible()&&origin->isEnabled()));}
  void safe(const std::function<void()>& fn,const QWidget* origin=nullptr){if(!manualAllowed(origin))return;try{fn();}catch(const std::exception& e){state->setText(QString::fromUtf8(e.what()));}}
  void clean(){business::require(!dirty,"当前关系尚未保存，请先保存或点“放弃草稿 / 重读”");}
  void readLegacy(){
    if(!legacyHistory)return;legacyBundle.clear();legacyOpen->setEnabled(false);
    if(row["legacySource"]!="expert_observations"){legacyState->setText("此文稿没有已核旧作者/作品复合ID；不按名字关联评论。");legacyHistory->clear();return;}
    try{auto original=row["legacyOriginal"].toObject();auto channel=creatorLegacy::identity(original["channel_id"]),observation=creatorLegacy::identity(original["id"]);auto path=store->filePath()+".comment-workshop.sqlite";legacyBundle=creatorLegacy::observationId(path,channel,observation);auto history=creatorLegacy::history(path,channel,observation);legacyHistory->setPlainText(creatorLegacy::readableHistory(history));legacyState->setText(QString("原作者 %1 / 作品 %2 · 旧来源原快照，未按显示名称合并；旧同步未恢复。").arg(channel,observation));legacyOpen->setEnabled(!legacyBundle.isEmpty());}
    catch(const std::exception&e){legacyState->setText("原评论/历史不可读："+QString::fromUtf8(e.what()));legacyHistory->clear();}
  }
  bool closeComments(){if(!commentsPanel||internal->currentWidget()!=commentsPanel)return false;if(commentWorkshopBack(commentsPage))return true;internal->setCurrentIndex(0);return true;}
  void openLegacyComments(){safe([&]{clean();business::require(documents->currentData().toString()==id&&row["id"]==id,"所选作品尚未正确载入；未打开其他作品，请重读");auto original=row["legacyOriginal"].toObject();auto exact=creatorLegacy::observationId(store->filePath()+".comment-workshop.sqlite",creatorLegacy::identity(original["channel_id"]),creatorLegacy::identity(original["id"]));business::require(exact==legacyBundle&&!exact.isEmpty(),"原作者/作品快照已变化，请重读后再打开");business::require(!legacyBundle.isEmpty(),"此原作品没有可唯一打开的评论快照");if(commentsPanel){internal->removeWidget(commentsPanel);commentsPanel->deleteLater();commentsPanel=nullptr;commentsPage=nullptr;}auto panel=new QWidget(internal);std::unique_ptr<QWidget> panelGuard(panel);auto layout=new QVBoxLayout(panel);auto back=new QPushButton("返回作者作品（保留评论草稿）",panel);back->setObjectName("creatorLegacyCommentsBack");layout->addWidget(back);auto page=commentWorkshopPage(store,panel,{},legacyBundle);layout->addWidget(page,1);commentsPanel=panelGuard.release();commentsPage=page;panel->setObjectName("creatorLegacyCommentsPanel");internal->addWidget(panel);connect(back,&QPushButton::clicked,this,[this]{closeComments();});internal->setCurrentWidget(panel);});}
  QLineEdit* field(QFormLayout* form,const QString& label,const char* key){auto e=new QLineEdit;e->setObjectName(key);form->addRow(label,e);connect(e,&QLineEdit::textChanged,this,[this]{if(!loading)dirty=true;});return e;}
  void selection(int n){
    if(n<0||n>=edges.size())return;
    safe([&]{clean();selected=n;loading=true;auto e=edges[n].toObject();topic->setText(e["topic"].toString());from->setText(e["from"].toString());to->setText(e["to"].toString());type->setCurrentText(e["relation"].toString());quote->setPlainText(e["quote"].toString());uncertainty->setText(e["uncertainty"].toString());polarity->setCurrentIndex(e["polarity"]=="contradicts"?1:0);loading=false;
      source->setPlainText(analysis.isEmpty()?row["text"].toString():analysis["bodyText"].toString());auto cursor=source->document()->find(e["quote"].toString());source->setTextCursor(cursor);source->ensureCursorVisible();
      QSignalBlocker b(table);table->selectRow(n);});
    if(table->currentRow()!=selected){QSignalBlocker b(table);if(selected>=0)table->selectRow(selected);else table->clearSelection();}
  }
  void clearForm(){loading=true;selected=-1;for(auto e:{topic,from,to,uncertainty})e->clear();quote->clear();type->setCurrentIndex(0);polarity->setCurrentIndex(0);loading=false;table->clearSelection();}
  void draw(){
    scene->clear();QString entity=focus->text().trimmed();if(entity.isEmpty()&&!edges.isEmpty())entity=edges[0].toObject()["from"].toString();
    int total=0,shown=0;
    for(int i=0;i<edges.size();i++){auto e=edges[i].toObject();if(e["from"]!=entity&&e["to"]!=entity)continue;++total;if(shown>=12)continue;double y=50+shown++*90;
      auto color=e["polarity"]=="contradicts"?QColor("#b36c28"):QColor("#317ba8");
      auto left=scene->addText(e["from"].toString()),right=scene->addText(e["to"].toString());left->setPos(0,y-10);right->setPos(500,y-10);
      for(auto node:{left,right}){node->setToolTip(node->toPlainText());node->setTextWidth(150);node->setDefaultTextColor(palette().color(QPalette::Text));}
      auto line=scene->addLine(160,y+4,485,y+4,QPen(color,3));line->setData(0,i);line->setFlag(QGraphicsItem::ItemIsSelectable);
      auto arrow=scene->addPolygon(QPolygonF{QPointF(485,y+4),QPointF(475,y-2),QPointF(475,y+10)},QPen(color),QBrush(color));arrow->setData(0,i);arrow->setFlag(QGraphicsItem::ItemIsSelectable);
      auto label=scene->addText(e["relation"].toString()+" · "+(e["polarity"]=="contradicts"?"相反观点":"作者观点"));label->setPos(230,y-25);label->setDefaultTextColor(color);label->setData(0,i);label->setFlag(QGraphicsItem::ItemIsSelectable);label->setToolTip(e["quote"].toString());
    }
    coverage->setText(QString("局部实体：%1 · 显示 %2 / %3 相邻关系 · 本篇完整 %4 条；列表不截断。滚轮缩放、拖动画布、点击连线看原文。%5").arg(entity).arg(shown).arg(total).arg(edges.size()).arg(version?"历史版本，只读，不代表当前合格关系。":""));
    if(!shown){auto empty=scene->addText("暂无可绘制的关系；查看文稿状态或关系列表。");empty->setDefaultTextColor(palette().color(QPalette::Text));}
    scene->setSceneRect(scene->itemsBoundingRect().adjusted(-20,-20,20,20));
  }
  void display(){
    loading=true;edges=analysis.value("relations").toArray();summary->setText(analysis.value("summary").toString());source->setPlainText(analysis.isEmpty()?row.value("text").toString():analysis.value("bodyText").toString());table->setRowCount(0);
    for(auto v:edges){auto e=v.toObject();int n=table->rowCount();table->insertRow(n);QStringList cols{e["from"].toString()+" → "+e["to"].toString(),e["relation"].toString(),e["topic"].toString(),e["polarity"]=="contradicts"?"相反观点":"作者观点"};for(int c=0;c<cols.size();c++)table->setItem(n,c,new QTableWidgetItem(cols[c]));}
    clearForm();dirty=false;bool enabled=version==0&&creatorAnalysis::eligible(row);save->setEnabled(enabled);remove->setEnabled(enabled);selectedText->setEnabled(version==0);for(auto field:{summary,topic,from,to,uncertainty})field->setReadOnly(version!=0);quote->setReadOnly(version!=0);type->setEnabled(version==0);polarity->setEnabled(version==0);draw();
    state->setText(QString("%1\n%2 · %3 条关系 · 全部为作者观点，未外部核验。")
      .arg(creatorAnalysis::sourceLabel(analysis,row),version?"查看历史快照":creatorAnalysis::eligible(row)?analysis.isEmpty()?"当前文稿尚未记录分析":edges.isEmpty()?"本篇已记录：无明确关系":"读取时当前合格关系":"当前正文不满足准入，历史不入当前图").arg(edges.size()));loading=false;
  }
  void acceptRow(const QJsonObject& value){
    row=value;loading=true;id=row["id"].toString();if(!id.isEmpty()&&documents->findData(id)<0)documents->addItem(row["channel"].toString()+" · "+row["title"].toString(),id);documents->setCurrentIndex(documents->findData(id));hash=collectionQuality::bodyHash(row["text"].toString());previous=creatorAnalysis::lastId(row);
    versions->clear();versions->addItem("当前合格分析（可编辑）");auto history=row["creatorAnalyses"].toArray();for(int i=history.size()-1;i>=0;--i)versions->addItem(QString("历史 #%1 · %2 · 只读").arg(i+1).arg(history[i].toObject()["analyzedAt"].toString()),history[i].toObject());
    version=0;analysis=creatorAnalysis::current(row);loading=false;display();readLegacy();setProperty("creatorReady",true);
  }
  void load(const QString& select){
    clean();reads->submit({{"operation","list"},{"kind","collections"},{"selection",select}});state->setText("正在后台读取作品目录；原文和人工稿保留");
  }
  void persist(bool erase){
    business::require(version==0,"历史版本只读");QJsonArray next=edges;
    if(erase){business::require(selected>=0,"先选中需要移除的关系");business::require(!dirty,"编辑尚未保存，请先保存或放弃草稿");next.removeAt(selected);}
    else {QJsonObject e{{"topic",topic->text()},{"from",from->text()},{"to",to->text()},{"relation",type->currentText()},{"quote",quote->toPlainText()},{"polarity",polarity->currentIndex()?"contradicts":"supports"},{"uncertainty",uncertainty->text()}};if(selected<0)next.append(e);else next[selected]=e;}
    store->saveCreatorAnalysis(id,hash,previous,summary->text(),next);dirty=false;load(id);state->setText("关系修订已保存在本机；旧版本与原文保留，事实仍未核验。");
  }
  void openIndexed(const QJsonObject& evidence){safe([&]{
    clean();QString wanted=evidence["documentId"].toString(evidence["id"].toString());QJsonObject target;
    target=BusinessStore::readRecord(store->filePath(),"collections",wanted);business::require(!target.isEmpty(),"文稿已变化，请重读汇总");
    QString versionId=evidence["analysisId"].toString();QJsonObject snapshot;
    if(!versionId.isEmpty()){
      for(auto v:target["creatorAnalyses"].toArray())if(v.toObject()["id"]==versionId)snapshot=v.toObject();
      business::require(!snapshot.isEmpty()&&snapshot["bodyHash"]==evidence["bodyHash"],"分析快照已变化，请重读汇总");
    }
    reads->cancel();acceptRow(target);
    if(!versionId.isEmpty()){for(int i=1;i<versions->count();++i)if(versions->itemData(i).toJsonObject()["id"]==versionId){versions->setCurrentIndex(i);break;}selection(evidence["edgeIndex"].toInt());}
    reader->setCurrentIndex(0);views->setCurrentIndex(0);
  });}
 public:
  bool backInternal(){if(closeComments())return true;if(closeAi())return true;auto index=dynamic_cast<CreatorIndexPage*>(views->currentWidget());return index&&index->back();}
  bool closeAi(){if(!ai||internal->currentWidget()!=ai||!isVisible()||window()->isMinimized()||QGuiApplication::applicationState()!=Qt::ApplicationActive)return false;ai->cancel();internal->setCurrentIndex(0);safe([&]{load(id);});return true;}
  CreatorPage(std::shared_ptr<BusinessStore> s,QWidget* p):QWidget(p),store(s){
    setObjectName("creatorPage");auto outer=new QVBoxLayout(this);auto scroll=new QScrollArea(this);scroll->setObjectName("creatorPageScroll");scroll->setWidgetResizable(true);outer->addWidget(scroll);internal=new QStackedWidget;internal->setObjectName("creatorInternal");scroll->setWidget(internal);auto manual=new QWidget;internal->addWidget(manual);auto root=new QVBoxLayout(manual);auto tools=new QHBoxLayout;root->addLayout(tools);
    documents=new QComboBox;documents->setObjectName("creatorDocuments");documents->setMinimumContentsLength(30);documents->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);tools->addWidget(documents,1);
    auto refresh=new QPushButton("重读文稿");tools->addWidget(refresh);auto analyze=new QPushButton("全文分块关系分析");analyze->setObjectName("creatorAiOpen");tools->addWidget(analyze);auto discard=new QPushButton("放弃草稿 / 重读");discard->setObjectName("creatorDiscard");tools->addWidget(discard);
    state=new QLabel;state->setObjectName("creatorState");state->setWordWrap(true);root->addWidget(state);versions=new QComboBox;versions->setObjectName("creatorVersions");root->addWidget(versions);
    auto split=new QSplitter;root->addWidget(split,1);views=new QTabWidget;views->setObjectName("creatorViews");split->addWidget(views);
    table=new QTableWidget(0,4);table->setObjectName("creatorRelations");table->setHorizontalHeaderLabels({"实体关系","类型","主题","方向"});table->setSelectionBehavior(QAbstractItemView::SelectRows);table->setEditTriggers(QAbstractItemView::NoEditTriggers);table->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch);views->addTab(table,"完整关系列表");
    auto graphPage=new QWidget;auto gl=new QVBoxLayout(graphPage);auto gt=new QHBoxLayout;gl->addLayout(gt);focus=new QLineEdit;focus->setPlaceholderText("定位实体（空白显示首个实体）");gt->addWidget(focus,1);auto locate=new QPushButton("定位");gt->addWidget(locate);auto reset=new QPushButton("重置缩放");gt->addWidget(reset);coverage=new QLabel;coverage->setWordWrap(true);gl->addWidget(coverage);graph=new GraphView(graphPage);graph->setObjectName("creatorGraph");scene=new QGraphicsScene(this);graph->setScene(scene);gl->addWidget(graph,1);views->addTab(graphPage,"局部关系图");
    reader=new QTabWidget;split->addWidget(reader);source=new QPlainTextEdit;source->setObjectName("creatorSource");source->setReadOnly(true);reader->addTab(source,"连续原文 / 快照");auto edit=new QWidget;auto form=new QFormLayout(edit);
    summary=field(form,"本篇摘要","creatorSummary");topic=field(form,"主题","creatorTopic");from=field(form,"来源实体","creatorFrom");to=field(form,"目标实体","creatorTo");type=new QComboBox;type->addItems(creatorAnalysis::types());form->addRow("关系类型",type);polarity=new QComboBox;polarity->addItems({"支持观点","相反观点"});form->addRow("证据方向",polarity);quote=new QPlainTextEdit;quote->setObjectName("creatorQuote");quote->setPlaceholderText("12至500字连续原文，包含两个实体");form->addRow("原文引用",quote);uncertainty=field(form,"疑点 / 观点范围","creatorUncertainty");
    selectedText=new QPushButton("使用原文选中部分");selectedText->setObjectName("creatorUseSelectedText");form->addRow(selectedText);auto actions=new QHBoxLayout;form->addRow(actions);auto fresh=new QPushButton("新增关系");save=new QPushButton("保存关系修订");save->setObjectName("saveCreatorRelation");remove=new QPushButton("移除选中关系");remove->setObjectName("removeCreatorRelation");for(auto b:{fresh,save,remove})actions->addWidget(b);reader->addTab(edit,"编辑关系");
    connect(quote,&QPlainTextEdit::textChanged,this,[this]{if(!loading)dirty=true;});for(auto c:{type,polarity})connect(c,&QComboBox::currentIndexChanged,this,[this]{if(!loading)dirty=true;});
    connect(documents,&QComboBox::currentIndexChanged,this,[this]{if(loading)return;if(!manualAllowed(documents)||dirty){QSignalBlocker blocked(documents);documents->setCurrentIndex(documents->findData(id));if(dirty)state->setText("当前关系尚未保存；人工稿保留，请先保存或放弃草稿");return;}auto wanted=documents->currentData().toString();if(!wanted.isEmpty())reads->record("collections",wanted,documents->itemData(documents->currentIndex(),Qt::UserRole+1).toString());});
    connect(versions,&QComboBox::currentIndexChanged,this,[this](int n){if(loading||!manualAllowed(versions))return;safe([&]{clean();version=n;analysis=n?versions->currentData().toJsonObject():creatorAnalysis::current(row);display();});if(version!=n){QSignalBlocker b(versions);versions->setCurrentIndex(version);}});
    connect(refresh,&QPushButton::clicked,this,[this,refresh]{safe([&]{load(id);},refresh);});connect(discard,&QPushButton::clicked,this,[this,discard]{safe([&]{dirty=false;load(id);},discard);});
    connect(table,&QTableWidget::currentCellChanged,this,[this](int r,int,int,int){if(!loading&&manualAllowed(table))selection(r);});
    connect(scene,&QGraphicsScene::selectionChanged,this,[this]{if(!manualAllowed(graph))return;auto items=scene->selectedItems();if(!items.isEmpty()&&items.first()->data(0).isValid()){selection(items.first()->data(0).toInt());reader->setCurrentIndex(0);}});
    connect(locate,&QPushButton::clicked,this,[this,locate]{if(manualAllowed(locate))draw();});connect(reset,&QPushButton::clicked,this,[this,reset]{if(manualAllowed(reset))graph->resetTransform();});
    connect(fresh,&QPushButton::clicked,this,[this,fresh]{safe([&]{clean();clearForm();reader->setCurrentIndex(1);},fresh);});connect(selectedText,&QPushButton::clicked,this,[this]{if(manualAllowed(selectedText))quote->setPlainText(source->textCursor().selectedText().replace(QChar(0x2029),'\n'));});
    connect(save,&QPushButton::clicked,this,[this]{safe([&]{persist(false);},save);});connect(remove,&QPushButton::clicked,this,[this]{safe([&]{persist(true);},remove);});
    auto legacy=new QWidget(reader);auto legacyLayout=new QVBoxLayout(legacy);legacyState=new QLabel(legacy);legacyState->setObjectName("creatorLegacyState");legacyState->setWordWrap(true);legacyLayout->addWidget(legacyState);legacyOpen=new QPushButton("在原评论研判打开此作品",legacy);legacyOpen->setObjectName("creatorLegacyCommentsOpen");legacyLayout->addWidget(legacyOpen);legacyHistory=new QPlainTextEdit(legacy);legacyHistory->setReadOnly(true);legacyHistory->setObjectName("creatorLegacyHistory");legacyLayout->addWidget(legacyHistory,1);reader->addTab(legacy,"原评论 / 抓取 / 指标");connect(legacyOpen,&QPushButton::clicked,this,[this]{if(manualAllowed(legacyOpen))openLegacyComments();});
    views->addTab(new CreatorIndexPage(store,[this](const QJsonObject& e){openIndexed(e);},this),"跨文稿汇总");
    ai=new CreatorAiPage(store,[this]{closeAi();},internal);internal->addWidget(ai);
    connect(analyze,&QPushButton::clicked,this,[this,analyze]{if(!analyze->isVisible()||!analyze->isEnabled()||!isVisible()||window()->isMinimized()||QGuiApplication::applicationState()!=Qt::ApplicationActive)return;safe([&]{clean();business::require(version==0&&creatorAnalysis::eligible(row),"请先选择当前合格文稿；历史版本只读");ai->open(row);internal->setCurrentWidget(ai);});});
    reads=new BusinessReadRequest(store->filePath(),this);
    reads->shown=[this]{if(!dirty)load(id);};
    reads->completed=[this](QJsonObject result){try{
      if(!result["error"].toString().isEmpty())throw std::runtime_error(result["error"].toString().toStdString());
      business::require(!dirty,"载入期间有未保存关系；人工稿和原图保留");
      if(result["operation"]=="list"){
        auto all=result["rows"].toArray();auto wanted=result["selection"].toString();bool found=wanted.isEmpty();for(auto v:all)found|=v.toObject()["id"]==wanted;business::require(found,"原文稿已不存在；保留原图，请明确选择其他作品");
        {QSignalBlocker block(documents);documents->clear();for(auto v:all){auto r=v.toObject();documents->addItem(r["channel"].toString()+" · "+r["title"].toString(),r["id"].toString());documents->setItemData(documents->count()-1,r["_recordSha256"].toString(),Qt::UserRole+1);}if(!wanted.isEmpty())documents->setCurrentIndex(documents->findData(wanted));}
        if(documents->count())reads->record("collections",documents->currentData().toString(),documents->itemData(documents->currentIndex(),Qt::UserRole+1).toString());else acceptRow({});
      }else{auto value=result["row"].toObject();business::require(!value.isEmpty(),"原文稿已不存在；人工稿和原图保留");acceptRow(value);}
    }catch(const std::exception&e){state->setText(QString::fromUtf8(e.what()));QSignalBlocker block(documents);documents->setCurrentIndex(documents->findData(id));}};
    save->setEnabled(false);remove->setEnabled(false);selectedText->setEnabled(false);state->setText("作品目录尚未加载");split->setSizes({750,550});
  }
};
}
QWidget* creatorPage(std::shared_ptr<BusinessStore> store,QWidget* parent){return new CreatorPage(store,parent);}

bool creatorPageBack(QWidget* page){auto*p=dynamic_cast<CreatorPage*>(page);return p&&p->backInternal();}
