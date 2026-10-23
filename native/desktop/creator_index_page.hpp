#pragma once
#include "business_store.hpp"
#include "creator_index.hpp"
#include "creator_relations_page.hpp"
#include "creator_legacy.hpp"
#include <QtWidgets>
#include <QThreadPool>
#include <atomic>

// Read-only projection; switching filters never writes or runs analysis.
class CreatorIndexPage : public QWidget {
  QStackedWidget* pages;QWidget* indexBody;CreatorRelationsPage* relationsPage=nullptr;
  bool indexActive()const{return isVisible()&&pages->currentWidget()==indexBody;}
  void closeRelations(){if(!relationsPage)return;auto old=relationsPage;relationsPage=nullptr;pages->setCurrentWidget(indexBody);pages->removeWidget(old);old->deleteLater();}
  void openRelations(){
    if(!indexActive()||!result.contains("counts"))return;*cancelled=true;
    relationsPage=new CreatorRelationsPage([s=store]{return s->read("collections");},store->filePath()+".creator-archive.json",[this](const QJsonObject& e){open(e);closeRelations();},pages);
    relationsPage->onBack=[this]{closeRelations();};pages->addWidget(relationsPage);pages->setCurrentWidget(relationsPage);relationsPage->selectAuthor(authors->currentData().toString());relationsPage->selectTopic(topics->currentData().toString());
  }
  std::shared_ptr<BusinessStore> store;
  std::function<void(const QJsonObject&)> open;
  QComboBox *authors,*topics,*mode;
  QLabel *counts,*pageLabel;
  QTableWidget* table;
  QPushButton *previous,*next,*openButton;
  QJsonObject result;
  int page=0;
  bool started=false;
  std::shared_ptr<std::atomic_bool> cancelled=std::make_shared<std::atomic_bool>(false);
  void render(){
    bool docs=mode->currentIndex()==1;auto rows=result[docs?"documents":"relations"].toArray();page=std::clamp(page,0,std::max(0,(int(rows.size())-1)/100));
    table->clearContents();table->setRowCount(0);table->setHorizontalHeaderLabels(docs?QStringList{"文稿","作者 / 身份","状态","说明"}:QStringList{"实体 / 主题","方向 / 类型","来源快照","连续引文"});
    for(int i=page*100;i<std::min(int(rows.size()),page*100+100);++i){auto row=rows[i].toObject();QStringList cols;
      if(docs){static const QMap<QString,QString> labels{{"blocked","未准入"},{"pending","待分析"},{"analyzed","已分析"},{"superseded","来源旧版"}};cols={row["title"].toString(),row["channel"].toString()+"\n"+row["authorKey"].toString(),labels.value(row["status"].toString()),row["reason"].toString()};}
      else{auto edge=row["edge"].toObject(),source=row["sourceSnapshot"].toObject();cols={edge["from"].toString()+" → "+edge["to"].toString()+"\n"+edge["topic"].toString(),(edge["polarity"]=="contradicts"?QString("相反观点"):QString("支持观点"))+" · "+edge["relation"].toString(),source["channel"].toString()+" · "+source["title"].toString()+"\n"+source["publishedAt"].toString(),edge["quote"].toString()};}
      int n=table->rowCount();table->insertRow(n);for(int c=0;c<4;++c){auto item=new QTableWidgetItem(cols[c]);item->setToolTip(cols[c]);table->setItem(n,c,item);}table->item(n,0)->setData(Qt::UserRole,row);table->setRowHeight(n,64);
    }
    pageLabel->setText(QString("第 %1 / %2 页 · %3 条 · 每页100条").arg(page+1).arg(std::max(1,(int(rows.size())+99)/100)).arg(rows.size()));previous->setEnabled(page>0);next->setEnabled((page+1)*100<rows.size());openButton->setEnabled(!rows.isEmpty());
  }
  void accept(const QJsonObject& value,const QString& author,const QString& topic){
    result=value;QSignalBlocker ba(authors),bt(topics);authors->clear();authors->addItem("全部作者（按身份）","");
    QMap<QString,QJsonObject> legacy;QString legacyNote;try{for(auto v:creatorLegacy::channels(store->filePath()+".comment-workshop.sqlite")){auto r=v.toObject();legacy["legacy-webstock:channel:"+creatorLegacy::identity(r["id"])]=r;}legacyNote=QString("旧来源作者资料 %1 条已载入；抓取/指标在原作品中阅读，旧同步未恢复。").arg(legacy.size());}catch(const std::exception&e){legacyNote="旧来源作者资料未载入："+QString::fromUtf8(e.what());}
    for(auto v:result["authors"].toArray()){auto a=v.toObject();QStringList aliases;for(auto n:a["aliases"].toArray())aliases<<n.toString();authors->addItem((aliases.isEmpty()?QString("未知作者"):aliases.join(" / "))+" · "+a["authorKey"].toString(),a["authorKey"].toString());auto raw=legacy.value(a["authorKey"].toString());if(!raw.isEmpty())authors->setItemData(authors->count()-1,QString::fromUtf8(QJsonDocument(raw).toJson())+"\n旧配置原记录，未启用同步。",Qt::ToolTipRole);}
    authors->setCurrentIndex(std::max(0,authors->findData(author)));topics->clear();topics->addItem("全部主题","");for(auto t:result["topics"].toArray())topics->addItem(t.toString(),t.toString());
    if(!topic.isEmpty()&&topics->findData(topic)<0)topics->addItem(topic+"（当前无关系）",topic);topics->setCurrentIndex(std::max(0,topics->findData(topic)));
    auto c=result["counts"].toObject();counts->setText(QString("所选作者：文稿 %1 · 去重作品 %2 · 来源旧版 %3\n已分析 %4（无关系 %5）· 待分析 %6 · 未准入 %7 · 筛选引文 %8 条\n主题仅筛引文，不隐藏未准入文稿；不同观点并列，不等于事实。读取快照，更新后请重读。")
      .arg(c["documents"].toInt()).arg(c["works"].toInt()).arg(c["superseded"].toInt()).arg(c["analyzed"].toInt()).arg(c["empty"].toInt()).arg(c["pending"].toInt()).arg(c["blocked"].toInt()).arg(c["relations"].toInt())+"\n"+legacyNote);render();
  }
  void refresh(){
    started=true;*cancelled=true;cancelled=std::make_shared<std::atomic_bool>(false);auto token=cancelled;auto s=store;QString author=authors->currentData().toString(),topic=topics->currentData().toString();
    page=0;result={};table->setRowCount(0);openButton->setEnabled(false);previous->setEnabled(false);next->setEnabled(false);counts->setText("正在本机读取作者 / 主题；不调用网络，不生成新分析…");QPointer<CreatorIndexPage> self(this);
    QThreadPool::globalInstance()->start([self,s,token,author,topic]{QJsonObject value;QString error;try{value=creatorIndex::build(s->read("collections"),author,topic,[token]{return token->load();});}catch(const std::exception& e){error=QString::fromUtf8(e.what());}
      QMetaObject::invokeMethod(QCoreApplication::instance(),[self,token,value,error,author,topic]{if(!self||token->load())return;if(error.isEmpty())self->accept(value,author,topic);else self->counts->setText(error);},Qt::QueuedConnection);
    });
  }
 protected:
  void hideEvent(QHideEvent* e)override{closeRelations();QWidget::hideEvent(e);}
  void showEvent(QShowEvent* e)override{QWidget::showEvent(e);if(!started)refresh();}
 public:
  bool back(){return isVisible()&&relationsPage&&relationsPage->back();}
  ~CreatorIndexPage(){*cancelled=true;}
  CreatorIndexPage(std::shared_ptr<BusinessStore> s,std::function<void(const QJsonObject&)> action,QWidget* parent=nullptr):QWidget(parent),store(s),open(action){
    auto outer=new QVBoxLayout(this);pages=new QStackedWidget;outer->addWidget(pages);indexBody=new QWidget;indexBody->setObjectName("creatorIndexBody");pages->addWidget(indexBody);auto root=new QVBoxLayout(indexBody);auto bar=new QHBoxLayout;root->addLayout(bar);authors=new QComboBox;authors->setObjectName("creatorIndexAuthor");authors->setMinimumContentsLength(12);authors->setSizeAdjustPolicy(QComboBox::AdjustToMinimumContentsLengthWithIcon);bar->addWidget(authors,2);topics=new QComboBox;topics->setObjectName("creatorIndexTopic");bar->addWidget(topics,1);auto reload=new QPushButton("重读汇总");reload->setObjectName("creatorIndexReload");bar->addWidget(reload);
    auto graphButton=new QPushButton("跨文稿关系图 / 旧作者档案");graphButton->setObjectName("creatorRelationsOpen");bar->addWidget(graphButton);connect(graphButton,&QPushButton::clicked,this,[this]{openRelations();});
    counts=new QLabel;counts->setObjectName("creatorIndexCounts");counts->setWordWrap(true);root->addWidget(counts);mode=new QComboBox;mode->setObjectName("creatorIndexMode");mode->addItems({"合格引文 · 打开对应分析快照","全部文稿 · 查看准入状态 / 原稿"});root->addWidget(mode);
    table=new QTableWidget(0,4);table->setObjectName("creatorIndexRows");table->setSelectionBehavior(QAbstractItemView::SelectRows);table->setSelectionMode(QAbstractItemView::SingleSelection);table->setEditTriggers(QAbstractItemView::NoEditTriggers);table->horizontalHeader()->setSectionResizeMode(QHeaderView::Stretch);root->addWidget(table,1);
    auto nav=new QHBoxLayout;root->addLayout(nav);previous=new QPushButton("上一页");next=new QPushButton("下一页");next->setObjectName("creatorIndexNext");pageLabel=new QLabel;openButton=new QPushButton("打开所选原文");openButton->setObjectName("creatorIndexOpen");for(auto b:{previous,next})nav->addWidget(b);nav->addWidget(pageLabel,1);nav->addWidget(openButton);
    connect(reload,&QPushButton::clicked,this,[this]{if(indexActive())refresh();});for(auto combo:{authors,topics})connect(combo,&QComboBox::currentIndexChanged,this,[this]{if(indexActive())refresh();});connect(mode,&QComboBox::currentIndexChanged,this,[this]{if(indexActive()){page=0;render();}});
    connect(previous,&QPushButton::clicked,this,[this]{if(indexActive()){--page;render();}});connect(next,&QPushButton::clicked,this,[this]{if(indexActive()){++page;render();}});connect(openButton,&QPushButton::clicked,this,[this]{if(indexActive()&&table->currentRow()>=0)open(table->item(table->currentRow(),0)->data(Qt::UserRole).toJsonObject());});
  }
};
