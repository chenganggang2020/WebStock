#include "creator_relations_page.hpp"
#include <QFileDialog>
namespace {
class ClaimView : public QGraphicsView {
 public:
 std::function<void(QJsonObject)> selected;
 ClaimView(QGraphicsScene* s,QWidget* p):QGraphicsView(s,p){setDragMode(ScrollHandDrag);setRenderHint(QPainter::Antialiasing);setTransformationAnchor(AnchorUnderMouse);}
 QPoint press;
 void mousePressEvent(QMouseEvent* e)override{press=e->pos();QGraphicsView::mousePressEvent(e);}
 void mouseReleaseEvent(QMouseEvent* e)override{QGraphicsView::mouseReleaseEvent(e);if((press-e->pos()).manhattanLength()>5)return;auto item=itemAt(e->pos());if(item&&!item->data(1).isNull()&&selected)selected(item->data(1).toJsonObject());}
 void wheelEvent(QWheelEvent* e)override{double factor=e->angleDelta().y()>0?1.15:1/1.15;if(transform().m11()*factor>=.25&&transform().m11()*factor<=4)scale(factor,factor);e->accept();}
};
QString compact(const QJsonObject& o){return QString::fromUtf8(QJsonDocument(o).toJson(QJsonDocument::Indented));}
QString statusLabel(const QString& s){static const QMap<QString,QString> labels{{"ready","准入通过，作者观点"},{"unmatched","未匹配作者身份与作品编号"},{"ambiguous","对应多篇文稿，未任选"},{"body-mismatch","正文哈希不符"},{"quality-blocked","当前质检或来源未准入"},{"legacy-rule","旧规则，仅保留历史"},{"invalid-relations","关系或引文不合格"},{"source-changed","原文或来源记录已变"}};return labels.value(s,s);}
}
void CreatorRelationsPage::safe(const std::function<void()>& fn){if(!isVisible()||!isEnabled()||pages->currentWidget()!=workspace)return;try{fn();}catch(const std::exception& e){counts->setText(QString::fromUtf8(e.what()));}}
void CreatorRelationsPage::invalidatePreview(){++epoch;pending={};confirm->setEnabled(false);}
bool CreatorRelationsPage::back(){
 if(!isVisible())return false;
 if(pages->currentWidget()==reading){readerAction={};pages->setCurrentWidget(workspace);backButton->setText("返回作者汇总");return true;}
 if(onBack)onBack();return true;
}
void CreatorRelationsPage::reader(const QString& title,const QString& text){
 if(!isVisible())return;readerAction={};readerTitle->setText(title);fullText->setObjectName("creatorRelationsFullReader");fullText->setPlainText(text);evidenceOpen->hide();pages->setCurrentWidget(reading);backButton->setText("返回图 / 档案");
}
CreatorRelationsPage::CreatorRelationsPage(std::function<QJsonArray()> s,QString path,std::function<void(const QJsonObject&)> action,QWidget* parent):QWidget(parent),source(s),open(action),archive(path){
 setObjectName("creatorRelationsPage");auto outer=new QVBoxLayout(this);backButton=new QPushButton("返回作者汇总");backButton->setObjectName("creatorRelationsBack");outer->addWidget(backButton);connect(backButton,&QPushButton::clicked,this,[this]{if(backButton->isVisible())back();});
 pages=new QStackedWidget;outer->addWidget(pages,1);workspace=new QWidget;workspace->setObjectName("creatorRelationsWorkspace");pages->addWidget(workspace);reading=new QWidget;reading->setObjectName("creatorRelationsReaderPage");pages->addWidget(reading);auto readingLayout=new QVBoxLayout(reading);readerTitle=new QLabel;readerTitle->setWordWrap(true);readingLayout->addWidget(readerTitle);fullText=new QPlainTextEdit;fullText->setReadOnly(true);readingLayout->addWidget(fullText,1);evidenceOpen=new QPushButton;evidenceOpen->setObjectName("creatorRelationsEvidenceOpen");readingLayout->addWidget(evidenceOpen);evidenceOpen->hide();connect(evidenceOpen,&QPushButton::clicked,this,[this]{if(!isVisible()||pages->currentWidget()!=reading||!evidenceOpen->isVisible()||!evidenceOpen->isEnabled()||!readerAction)return;try{readerAction();}catch(const std::exception& e){readerTitle->setText(QString::fromUtf8(e.what()));}});
 auto root=new QVBoxLayout(workspace);auto bar=new QHBoxLayout;root->addLayout(bar);authors=new QComboBox;authors->setObjectName("creatorRelationsAuthor");topics=new QComboBox;topics->setObjectName("creatorRelationsTopic");authors->setMinimumContentsLength(12);authors->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);bar->addWidget(authors,2);bar->addWidget(topics,1);auto refresh=new QPushButton("重读全部");bar->addWidget(refresh);
 auto tools=new QHBoxLayout;root->addLayout(tools);mode=new QComboBox;mode->setObjectName("creatorRelationsMode");mode->addItems({"当前合格引文图","旧档案合格历史图","全部旧记录 / 冲突"});tools->addWidget(mode);focus=new QLineEdit;focus->setObjectName("creatorRelationsFocus");focus->setPlaceholderText("精确实体文字筛选，不合并同名实体");tools->addWidget(focus,1);auto locate=new QPushButton("定位"),reset=new QPushButton("复位");tools->addWidget(locate);tools->addWidget(reset);
 counts=new QLabel;counts->setWordWrap(true);counts->setObjectName("creatorRelationsCounts");root->addWidget(counts);
 scene=new QGraphicsScene(this);auto canvas=new ClaimView(scene,this);view=canvas;view->setObjectName("creatorRelationsGraph");canvas->selected=[this](QJsonObject r){safe([&]{evidence(r);});};root->addWidget(view,1);
 history=new QTableWidget(0,4);history->setObjectName("creatorArchiveRows");history->setHorizontalHeaderLabels({"旧文稿 / 编号","版本 / 冲突","准入状态","摘要"});history->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch);history->setEditTriggers(QAbstractItemView::NoEditTriggers);history->setSelectionBehavior(QAbstractItemView::SelectRows);root->addWidget(history,1);connect(history,&QTableWidget::cellDoubleClicked,this,[this](int n,int){safe([&]{evidence(history->item(n,0)->data(Qt::UserRole).toJsonObject());});});
 auto nav=new QHBoxLayout;root->addLayout(nav);previous=new QPushButton("上一页");next=new QPushButton("下一页");previous->setObjectName("creatorRelationsPrevious");next->setObjectName("creatorRelationsNext");nav->addWidget(previous);nav->addWidget(next);auto choose=new QPushButton("选择旧作者 JSON 预览");choose->setObjectName("creatorArchiveChoose");nav->addWidget(choose);auto readPreview=new QPushButton("完整导入预览");nav->addWidget(readPreview);confirm=new QPushButton("明确保留全部旧版本并导入");confirm->setObjectName("creatorArchiveConfirm");confirm->setEnabled(false);nav->addWidget(confirm);auto cancel=new QPushButton("取消预览");nav->addWidget(cancel);
 connect(refresh,&QPushButton::clicked,this,[this]{safe([&]{reload();});});
 connect(authors,&QComboBox::currentIndexChanged,this,[this]{if(!binding)safe([&]{author=authors->currentData().toString();page=0;reload();});});
 connect(topics,&QComboBox::currentIndexChanged,this,[this]{if(!binding)safe([&]{topic=topics->currentData().toString();page=0;reload();});});
 connect(mode,&QComboBox::currentIndexChanged,this,[this]{safe([&]{page=0;invalidatePreview();render();});});
 connect(locate,&QPushButton::clicked,this,[this]{safe([&]{page=0;render();view->resetTransform();view->centerOn(350,0);});});
 connect(reset,&QPushButton::clicked,this,[this]{safe([&]{view->resetTransform();view->centerOn(350,0);});});
 connect(previous,&QPushButton::clicked,this,[this]{safe([&]{--page;render();});});connect(next,&QPushButton::clicked,this,[this]{safe([&]{++page;render();});});
 connect(choose,&QPushButton::clicked,this,[this]{safe([&]{invalidatePreview();auto ticket=epoch;QPointer<CreatorRelationsPage> self(this);auto file=QFileDialog::getOpenFileName(this,"选择旧作者关系档案",{},"JSON (*.json)");if(!self||!isVisible()||pages->currentWidget()!=workspace||ticket!=epoch||file.isEmpty())return;QFile in(file);creatorAnalysis::require(in.open(QIODevice::ReadOnly)&&in.size()<=creatorArchive::fileLimit,"旧文件不可读或超过 2 MiB");review(in.readAll());});});
 connect(readPreview,&QPushButton::clicked,this,[this]{safe([&]{creatorAnalysis::require(!pending.isEmpty(),"请先选择文件预览");reader("完整旧档案和绑定 / 冲突预览",compact(pending));});});
 connect(confirm,&QPushButton::clicked,this,[this]{safe([&]{creatorAnalysis::require(window()->isActiveWindow()&&!pending.isEmpty(),"导入预览已失效或页面未获焦点");archive.save(pending,source,[this]{return !isVisible()||!window()->isActiveWindow();});pending={};reload();counts->setText("已追加旧档案，所有原字段和旧版本保留；未升级为事实。\n"+counts->text());});});
 connect(cancel,&QPushButton::clicked,this,[this]{safe([&]{invalidatePreview();counts->setText("已取消导入预览，旧档案未修改");});});
 try{reload();}catch(const std::exception& e){counts->setText(QString::fromUtf8(e.what()));}
}
void CreatorRelationsPage::hideEvent(QHideEvent* e){invalidatePreview();readerAction={};QWidget::hideEvent(e);}
void CreatorRelationsPage::reload(){
 invalidatePreview();input=source();index=creatorIndex::build(input,author,topic);projection=creatorArchive::project(archive.read(),input,author,topic);binding=true;authors->clear();authors->addItem("全部作者（按身份）","");
 for(auto v:index["authors"].toArray()){auto a=v.toObject();QStringList names;for(auto n:a["aliases"].toArray())names<<n.toString();authors->addItem(names.join(" / ")+" · "+a["authorKey"].toString(),a["authorKey"].toString());}authors->setCurrentIndex(std::max(0,authors->findData(author)));
 QSet<QString> known;for(auto t:index["topics"].toArray())known.insert(t.toString());for(auto v:projection["records"].toArray())for(auto e:v.toObject()["original"].toObject()["relations"].toArray())known.insert(e.toObject()["topic"].toString());if(!topic.isEmpty())known.insert(topic);QStringList sorted=known.values();std::sort(sorted.begin(),sorted.end());topics->clear();topics->addItem("全部主题","");for(auto t:sorted)topics->addItem(t,t);topics->setCurrentIndex(std::max(0,topics->findData(topic)));binding=false;render();
}
void CreatorRelationsPage::review(const QByteArray& bytes){if(!isVisible()||pages->currentWidget()!=workspace)return;invalidatePreview();pending=creatorArchive::preview(bytes,author,source(),archive.read());confirm->setEnabled(!pending["duplicate"].toBool());counts->setText(QString("完整预览：%1 条旧记录 · 冲突 %2 · 重复文件 %3。未匹配/旧规则/未准入记录仅保留历史。确认将保留全部旧版本，不覆盖原文。").arg(pending["rows"].toArray().size()).arg(pending["conflicts"].toInt()).arg(pending["duplicate"].toBool()?"是":"否"));reader("完整旧文件和绑定预览（尚未导入）",compact(pending));}
void CreatorRelationsPage::render(){
 bool historical=mode->currentIndex()==1,table=mode->currentIndex()==2;view->setVisible(!table);history->setVisible(table);relations=(historical?projection:index)["relations"].toArray();records=projection["records"].toArray();auto graph=creatorArchive::graph(relations,focus->text().trimmed(),page);int total=table?records.size():graph["filtered"].toInt();page=std::clamp(page,0,std::max(0,(total-1)/40));previous->setEnabled(page>0);next->setEnabled((page+1)*40<total);
 if(table){history->setRowCount(0);for(int i=page*40;i<std::min(int(records.size()),page*40+40);++i){auto r=records[i].toObject(),o=r["original"].toObject();int n=history->rowCount();history->insertRow(n);QStringList cells{o["title"].toString()+" · "+QString::number(o["observationId"].toInt()),r["archiveId"].toString().left(12)+":"+QString::number(r["recordIndex"].toInt())+(r["conflict"].toBool()?" · 冲突并存":""),statusLabel(r["status"].toString()),o["summary"].toString()};for(int c=0;c<4;++c)history->setItem(n,c,new QTableWidgetItem(cells[c]));history->item(n,0)->setData(Qt::UserRole,r);history->setRowHeight(n,70);}}
 else{scene->clear();for(auto v:graph["nodes"].toArray()){auto n=v.toObject(),r=n["evidence"].toObject();qreal x=n["x"].toDouble(),y=n["y"].toDouble();auto box=scene->addRect(x,y,160,55,QPen(QColor("#557790")),QBrush(QColor("#e1edf7")));box->setData(1,r);auto label=scene->addText(QFontMetrics(font()).elidedText(n["label"].toString(),Qt::ElideRight,140));label->setToolTip(n["label"].toString());label->setPos(x+6,y);label->setTextWidth(148);label->setDefaultTextColor(Qt::black);label->setData(1,r);}
  for(auto v:graph["edges"].toArray()){auto e=v.toObject(),r=e["evidence"].toObject(),edge=r["edge"].toObject(),s=r["sourceSnapshot"].toObject();double y=e["y"].toDouble();auto color=edge["polarity"]=="contradicts"?QColor("#ac6a29"):QColor("#267998");auto line=scene->addLine(162,y+28,517,y+28,QPen(color,3,Qt::DashLine));line->setData(1,r);auto text=scene->addText(edge["relation"].toString()+" → "+(edge["polarity"]=="contradicts"?"相反观点":"作者观点"));text->setPos(200,y);text->setDefaultTextColor(color);text->setData(1,r);QString fullCaption=s["channel"].toString()+" · "+s["title"].toString()+"\n"+r["documentId"].toString()+" · "+r["analysisId"].toString();auto lines=fullCaption.split("\n");auto caption=scene->addText(QFontMetrics(font()).elidedText(lines.value(0),Qt::ElideRight,675)+"\n"+QFontMetrics(font()).elidedText(lines.value(1),Qt::ElideRight,675));caption->setToolTip(fullCaption);caption->setTextWidth(680);caption->setPos(0,y+57);caption->setDefaultTextColor(palette().color(QPalette::Text));caption->setData(1,r);}
  scene->setSceneRect(scene->itemsBoundingRect().adjusted(-20,-20,20,20));
 }
 auto c=index["counts"].toObject();counts->setText(QString("%1 · 全量文稿 %2 · 未准入 %3 / 来源旧版 %4\n筛选范围关系全量 %5 · 精确文字筛选 %6 · 本页 %7 · 第 %8 页（每页40）\n旧记录 %9（未入历史合格图 %10）；主题仅筛关系。名称不是合并身份，虚线均为未核验作者观点。拖动画布/滚轮缩放，点击节点或连线读精确版本；旧记录双击完整阅读。读取快照，更新后请重读。")
  .arg(table?"全部旧记录":historical?"旧档案历史，只读":"当前合格引文，只读").arg(c["documents"].toInt()).arg(c["blocked"].toInt()).arg(c["superseded"].toInt()).arg(relations.size()).arg(table?records.size():graph["filtered"].toInt()).arg(table?history->rowCount():graph["shown"].toInt()).arg(page+1).arg(records.size()).arg(projection["blocked"].toInt()));
}
void CreatorRelationsPage::evidence(const QJsonObject& item){
 QJsonObject shown=item;bool legacy=item.contains("archiveId");
 if(!legacy){QJsonObject sourceRow,analysis;for(auto v:source())if(v.toObject()["id"]==item["documentId"])sourceRow=v.toObject();for(auto v:sourceRow["creatorAnalyses"].toArray())if(v.toObject()["id"]==item["analysisId"])analysis=v.toObject();auto edges=analysis["relations"].toArray();int n=item["edgeIndex"].toInt(-1);creatorAnalysis::require(!analysis.isEmpty()&&analysis["bodyHash"]==item["bodyHash"]&&n>=0&&n<edges.size()&&researchRuns::fingerprint(edges[n])==researchRuns::fingerprint(item["edge"]),"精确分析或引文已变化，请重读");shown["analysis"]=analysis;}
 else{for(auto v:archive.read()["batches"].toArray())if(v.toObject()["id"]==item["archiveId"])shown["originalFileUtf8"]=v.toObject()["sourceUtf8"];}
 reader("精确文稿 / 引文 / 历史版本 · 作者观点未核验",compact(shown));fullText->setObjectName("creatorRelationsEvidence");
 QString id=item["documentId"].toString(item["source"].toObject()["id"].toString());evidenceOpen->setText(legacy?"打开对应本机文稿（当前内容可能已变）":"回到原有精确分析 / 引文");evidenceOpen->setEnabled(!id.isEmpty());evidenceOpen->show();
 readerAction=[this,item,legacy,id]{open(legacy?QJsonObject{{"id",id}}:item);};
}

