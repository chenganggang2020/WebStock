#include "window.hpp"
#include "ui_mainwindow.h"
#include "navigation_model.hpp"
#include <QtWidgets>
#include <QJsonDocument>
#include <QSaveFile>

namespace {
// Windows' native check mark can disappear after a live dark/light theme switch.
// Paint only this preference list's indicator; retain Qt's item text, focus and hit testing.
class NavigationCheckDelegate final:public QStyledItemDelegate {
public:
 using QStyledItemDelegate::QStyledItemDelegate;
 void paint(QPainter* painter,const QStyleOptionViewItem& option,const QModelIndex& index)const override{
  QStyledItemDelegate::paint(painter,option,index);QStyleOptionViewItem opt(option);initStyleOption(&opt,index);
  auto* style=opt.widget?opt.widget->style():QApplication::style();auto r=style->subElementRect(QStyle::SE_ItemViewItemCheckIndicator,&opt,opt.widget);
  if(r.isEmpty())return;const bool checked=opt.checkState==Qt::Checked;
  painter->save();painter->setRenderHint(QPainter::Antialiasing);painter->setPen(QPen(QColor("#6784a0"),1));painter->setBrush(checked?QColor("#276db6"):opt.palette.color(QPalette::Base));painter->drawRoundedRect(QRectF(r).adjusted(.5,.5,-.5,-.5),3,3);
  if(checked){painter->setPen(QPen(Qt::white,1.6,Qt::SolidLine,Qt::RoundCap,Qt::RoundJoin));painter->drawPolyline(QPolygonF{QPointF(r.left()+r.width()*.20,r.top()+r.height()*.51),QPointF(r.left()+r.width()*.43,r.top()+r.height()*.72),QPointF(r.left()+r.width()*.80,r.top()+r.height()*.27)});}painter->restore();
 }
};
QTabWidget* sectionTabs(QWidget* page){
 if(auto* tabs=qobject_cast<QTabWidget*>(page))return tabs;
 return page?page->findChild<QTabWidget*>(QString(),Qt::FindDirectChildrenOnly):nullptr;
}
}
QString Window::navigationFilePath() const {return QFileInfo(businessStore->filePath()).absolutePath()+"/navigation-v1.json";}
void Window::readNavigationPreferences(){
 navigationFileBytes.clear();navigationFileError.clear();QJsonObject input;QFile file(navigationFilePath());
 if(file.exists()){
  if(file.size()>65536||!file.open(QIODevice::ReadOnly)){navigationFileError="配置不可读或超过64KiB；使用默认菜单，未改原件。";}
  else{navigationFileBytes=file.readAll();QJsonParseError error;auto doc=QJsonDocument::fromJson(navigationFileBytes,&error);
   if(error.error!=QJsonParseError::NoError||!doc.isObject()||doc.object()["schema"]!="stock-navigation/v1")navigationFileError="配置格式异常；使用默认菜单。显式应用前会备份原件。";
   else input=doc.object();}
 }
 navigationPreferences=navigation::normalized(input);
}
void Window::setupNavigation(){
 readNavigationPreferences();
 moduleNavigation=new QWidget(this);moduleNavigation->setObjectName("moduleNavigation");
 auto* row=new QHBoxLayout(moduleNavigation);row->setContentsMargins(10,2,10,2);row->setSpacing(6);
 auto* group=new QLabel(moduleNavigation);group->setObjectName("navigationGroupLabel");group->hide();
 navigationToolbar=new QToolBar(moduleNavigation);navigationToolbar->setObjectName("navigationToolbar");
 navigationToolbar->setMovable(false);navigationToolbar->setFloatable(false);navigationToolbar->setToolButtonStyle(Qt::ToolButtonTextOnly);
 navigationToolbar->setMinimumWidth(0);navigationToolbar->setSizePolicy(QSizePolicy::Ignored,QSizePolicy::Fixed);row->addWidget(navigationToolbar,1);
 if(auto* more=navigationToolbar->findChild<QToolButton*>("qt_toolbar_ext_button")){more->setText("»");more->setToolButtonStyle(Qt::ToolButtonTextOnly);more->setToolTip("更多本模块菜单");more->setAccessibleName("更多本模块菜单");}
 auto* configure=new QPushButton("导航设置",moduleNavigation);configure->setObjectName("openNavigationSettings");row->addWidget(configure);
 connect(configure,&QPushButton::clicked,this,&Window::navigationSettingsView);
 configure->hide();
 // Keep the existing handlers and data-source semantics; only consolidate their UI.
 auto* gear=findChild<QPushButton*>("theme");
 auto* paletteMenu=gear->menu();paletteMenu->setTitle("配色");
 auto* menu=new QMenu(gear);menu->setObjectName("workbenchSettingsMenu");
 gear->setObjectName("workbenchSettings");gear->setText({});
 // A drawn icon avoids a missing Unicode gear glyph on deployed font sets.
 QPixmap gearImage(40,40);gearImage.setDevicePixelRatio(2);gearImage.fill(Qt::transparent);
 {QPainter painter(&gearImage);painter.setRenderHint(QPainter::Antialiasing);painter.translate(10,10);
  const QColor ink("#859bb5");painter.setPen(Qt::NoPen);painter.setBrush(ink);
  for(int i=0;i<8;++i){painter.drawRoundedRect(QRectF(-1.5,-9,3,4),.5,.5);painter.rotate(45);}
  painter.setBrush(Qt::NoBrush);painter.setPen(QPen(ink,2.3));painter.drawEllipse(QPointF(0,0),5.6,5.6);
  painter.setPen(QPen(ink,1.5));painter.drawEllipse(QPointF(0,0),2.1,2.1);}
 gear->setIcon(QIcon(gearImage));gear->setIconSize(QSize(20,20));
 gear->setAccessibleName("设置");gear->setToolTip("设置与视图");gear->setMenu(menu);
 if(auto* old=findChild<QPushButton*>("workspace设置"))old->hide();
 auto* classic=menu->addAction("看盘");classic->setObjectName("showClassicWorkbench");
 connect(classic,&QAction::triggered,this,[this]{home();setLayoutMode("classic");});
 auto* overview=menu->addAction("报价总览");overview->setObjectName("showQuoteOverview");
 connect(overview,&QAction::triggered,this,[this]{home();setLayoutMode("quotes");});
 auto* details=menu->addAction("显示右侧详情");details->setObjectName("showQuoteDetails");details->setCheckable(true);
 auto* groupView=menu->addAction("展开我的分组");groupView->setObjectName("showWatchlistGroups");groupView->setCheckable(true);groupView->setChecked(settings&&!settings->value("workbench/groupsCollapsed",true).toBool());
 connect(groupView,&QAction::toggled,this,[this](bool shown){if(settings)settings->setValue("workbench/groupsCollapsed",!shown);arrangeWorkspace();});
 details->setChecked(!settings||!settings->value("workbench/detailsCollapsed",false).toBool());
 signalPanel->setObjectName("quoteDetails");
 connect(details,&QAction::toggled,this,[this](bool shown){
   if(settings)settings->setValue("workbench/detailsCollapsed",!shown);
   arrangeWorkspace();save();
 });
 if(auto* refresh=findChild<QPushButton*>("refreshLive")){row->addWidget(refresh);refresh->show();}
 menu->addSeparator();menu->addMenu(paletteMenu);
 auto* pageDetails=menu->addMenu("当前页面 · 来源与记录");pageDetails->setObjectName("pageSourceSettings");
 // Qt does not open an empty submenu, so populate it when its parent opens.
 connect(menu,&QMenu::aboutToShow,this,[this,pageDetails]{
  pageDetails->clear();auto* current=workspaceTabs->currentWidget();if(!current)return;
  for(auto* toggle:current->findChildren<QToolButton*>())if(toggle->property("settingsDisclosure").toBool()){
   auto* action=pageDetails->addAction(toggle->property("disclosureTitle").toString());
   action->setCheckable(true);action->setChecked(toggle->isChecked());
   connect(action,&QAction::toggled,toggle,&QToolButton::setChecked);
  }
  for(auto* control:current->findChildren<QPushButton*>())if(control->property("settingsControl").toBool())
   connect(pageDetails->addAction(control->text()),&QAction::triggered,control,&QPushButton::click);
  if(pageDetails->isEmpty())pageDetails->addAction("本页没有附加原始记录")->setEnabled(false);
 });
 connect(menu->addAction("导航设置"),&QAction::triggered,this,&Window::navigationSettingsView);
 connect(menu->addAction("数据来源与状态"),&QAction::triggered,this,&Window::dataSourceStatusView);
 for(auto name:{"importWatchlist","exportWatchlist"})if(auto* control=findChild<QPushButton*>(name))
   connect(menu->addAction(control->text()),&QAction::triggered,control,&QPushButton::click);
 connect(menu->addAction("全部设置"),&QAction::triggered,this,&Window::settingsView);
 ui->toolbar->hide();marketStrip->hide();
 ui->rootLayout->insertWidget(1,moduleNavigation);
 for(const auto&e:navigation::entries()){
  auto* action=new QAction(e.title,this);action->setObjectName("nav_"+e.id);action->setCheckable(true);action->setData(e.id);navigationActions[e.id]=action;
  connect(action,&QAction::triggered,this,[this,id=e.id]{
   if(!moduleNavigation->isVisible()||!navigationToolbar->actions().contains(navigationActions.value(id)))return;
   try{openNavigation(id);}catch(const std::exception&e){statusBar()->showMessage(QString::fromUtf8(e.what()));syncNavigation();}
  });
 }
 // Navigation moved to the shared strip. Keep original action objects for old entry bindings.
 for(auto name:{"openLegacyArchive","openRecent","openSectorWatch","openMarketOverview","openLegacyHighFrequency","openMarketComparison","openGlobalMarket","openSectorLeaders","openNews"})
  if(auto* old=findChild<QPushButton*>(name))old->hide();
 syncNavigation();
 arrangeWorkspace();
}
void Window::syncNavigation(){
 if(!moduleNavigation)return;auto* page=workspaceTabs->currentWidget();if(!page)return;
 QString key=page==ui->body?"home":pages.key(page);
 if(key.startsWith("auction:"))key="auction";
 if(key=="unifiedBackup")key="unifiedBackupSetup";
 const bool archiveReader=key=="archiveVideo";
 if(archiveReader)key="collection";
 if(key=="methodReport")key="personMethod";
 QString group=page->property("workspace").toString(),selected;
 auto* tabs=archiveReader?nullptr:sectionTabs(page);
 bool sectionsInGlobalMenu=false;
 for(const auto&e:navigation::entries())if(e.page==key&&e.tab>=0)sectionsInGlobalMenu=true;
 // Only hide the module-level duplicate, never manuscript/comment detail tabs.
 if(tabs&&sectionsInGlobalMenu)tabs->tabBar()->hide();
 for(const auto&e:navigation::entries())if(e.page==key){group=e.group;if(e.tab<0||!tabs||tabs->currentIndex()==e.tab){selected=e.id;break;}}
 if(key=="navigationSettings")group="设置";
 if(page->property("workbenchChild").toBool()){group="主页";selected="home";}
 if(group=="行情"||!navigation::groups().contains(group))group="主页";
 page->setProperty("workspace",group);
 if(auto* button=findChild<QPushButton*>("workspace"+group)){activeWorkspace=button;button->setChecked(true);}
 moduleNavigation->setProperty("workspace",group);
 if(auto* refresh=findChild<QPushButton*>("refreshLive"))refresh->setVisible(page==ui->body);
 moduleNavigation->findChild<QLabel*>("navigationGroupLabel")->setText(group+" ›");
 QList<QAction*> desired;
 for(auto id:navigation::ordered(navigationPreferences,group))if(id!="securitiesDirectory"&&id!="businessSearch"&&id!="publicPriceDetails"&&!navigation::hidden(navigationPreferences,group,id))desired << navigationActions.value(id);
 const auto oldActions=navigationToolbar->actions();
 const bool alreadyEmpty=desired.isEmpty()&&oldActions.size()==1&&oldActions.first()->objectName()=="navigationEmpty";
 // Retain action widgets on selection-only changes; rebuild only for group/order/visibility.
 if(oldActions!=desired&&!alreadyEmpty){
  navigationToolbar->clear();
  for(auto* action:oldActions)if(action->objectName()=="navigationEmpty")action->deleteLater();
  navigationToolbar->addActions(desired);
 }
 for(auto it=navigationActions.begin();it!=navigationActions.end();++it)it.value()->setChecked(it.key()==selected);
 if(navigationToolbar->actions().isEmpty()){auto* empty=navigationToolbar->addAction("本模块入口已隐藏，可在右侧恢复");empty->setObjectName("navigationEmpty");empty->setEnabled(false);}
 if(tabs&&!tabs->property("navigationObserved").toBool()){
  tabs->setProperty("navigationObserved",true);connect(tabs,&QTabWidget::currentChanged,this,[this]{syncNavigation();});
 }
 moduleNavigation->show();
}
void Window::openNavigation(const QString& id){
 const auto* e=navigation::find(id);if(!e)return;
 const auto key=e->page;
 if(key=="home")home();
 else if(key=="marketOverview")marketOverviewView();
 else if(key=="globalMarket")globalMarketView();
 else if(key=="marketComparison")marketComparisonView();
 else if(key=="sectorWatch")sectorWatchView();
 else if(key=="securitiesDirectory")securitiesDirectoryView();
 else if(key=="legacyHighFrequency")legacyHighFrequencyView();
 else if(key=="publicPriceDetails")publicPriceDetailView();
 else if(key=="news")newsView();
 else if(key=="watchlistHost")editGroups();
 else if(key=="watchlistWorkspace")watchlistWorkspaceView();
 else if(key=="watchlistReconciliation")watchlistReconciliationView();
 else if(key=="accounts")accountView();
 else if(key=="accountEdit")accountEditView();
 else if(key=="accountReference")accountReferenceView();
 else if(key=="portfolioMirror")portfolioMirrorView();
 else if(key=="recent")recentView();
 else if(key=="sectorLeaders")sectorLeadersView();
 else if(key=="funds")funds();
 else if(key=="darkStocks")darkStockView();
 else if(key=="rotation")rotation();
 else if(key=="etfMonitor")etfMonitorView();
 else if(key=="etfDaily")etfDailyView();
 else if(key=="futuresMonitor")futuresMonitorView();
 else if(key=="cffexDisclosure")cffexDisclosureView();
 else if(key=="auction")auctionView();
 else if(key=="auctionAnalysis")auctionAnalysisView();
 else if(key=="research")researchView();
 else if(key=="stockResearch")stockResearchView();
 else if(key=="businessSearch")businessSearchView();
 else if(key=="localCandidates")localCandidateView();
 else if(key=="industryDiscovery")industryDiscoveryView();
 else if(key=="industryTopic")industryTopicView();
 else if(key=="sectorResearch")sectorResearchView();
 else if(key=="evidenceReview")evidenceReviewView();
 else if(key=="personMethod")personMethodView();
 else if(key=="materialLibrary")materialLibraryView();
 else if(key=="knowledgeAiHost")knowledgeAiHostView();
 else if(key=="quantResearch")quantResearchView();
 else if(key=="collection")collectionView();
 else if(key=="paper")accountView(true);
 else if(key=="paperMonitor")paperMonitorView();
 else if(key=="scenarioTools")scenarioToolsView();
 else if(key=="settings")settingsView();
 else if(key=="unifiedBackupSetup")unifiedBackupView();
 else if(key=="aiSettings")aiSettingsView();
 else if(key=="riskSettings")riskSettingsView();
 else if(key=="dataSafety")dataSafetyView();
 else if(key=="dataSourceStatus")dataSourceStatusView();
 else if(key=="migrationStatus")migrationStatusView();
 else if(key=="legacyArchive")legacyArchiveView();
 if(e->tab>=0&&workspaceTabs->currentWidget()==pages.value(e->page))if(auto* tabs=sectionTabs(workspaceTabs->currentWidget()))tabs->setCurrentIndex(e->tab);
 syncNavigation();
}
void Window::navigationSettingsView(){
 if(auto* page=pages.value("navigationSettings")){activatePage(page);return;}
 auto* page=new QWidget(workspaceTabs);page->setObjectName("navigationSettingsPage");page->setProperty("workspace","设置");page->setProperty("pageTitle","导航显示 / 勾选与排序");pages["navigationSettings"]=page;
 auto* root=new QVBoxLayout(page);auto* title=new QLabel("导航显示设置",page);title->setStyleSheet("font-size:20px;font-weight:600;");root->addWidget(title);
 auto* note=new QLabel("选择一个主菜单，勾选需要显示的入口，用上移/下移调整顺序。\n二级菜单在内部页面持续显示；窗口较窄时点击菜单右侧 »。一级菜单和导航设置始终保留。",page);note->setWordWrap(true);root->addWidget(note);
 auto* groups=new QComboBox(page);groups->setObjectName("navigationSettingsGroup");groups->addItems(navigation::groups());root->addWidget(groups);
 auto* list=new QListWidget(page);list->setObjectName("navigationSettingsList");list->setItemDelegate(new NavigationCheckDelegate(list));root->addWidget(list,1);
 auto* buttons=new QHBoxLayout;root->addLayout(buttons);
 auto add=[&](QString label,QString name){auto* b=new QPushButton(label,page);b->setObjectName(name);buttons->addWidget(b);return b;};
 auto* up=add("上移","navigationMoveUp");auto* down=add("下移","navigationMoveDown");auto* reset=add("恢复本组默认","navigationResetGroup");auto* all=add("恢复全部默认","navigationResetAll");buttons->addStretch();
 auto* cancel=add("取消修改 / 重载","navigationReload");auto* apply=add("应用并保存","navigationApply");
 auto* status=new QLabel(navigationFileError.isEmpty()?"只保存本机菜单偏好，不改业务数据。":navigationFileError,page);status->setObjectName("navigationSettingsStatus");status->setWordWrap(true);root->addWidget(status);
 auto draft=std::make_shared<QJsonObject>(navigationPreferences);auto current=std::make_shared<QString>(groups->currentText());
 auto capture=[list,draft,current]{QJsonArray order,hidden;for(int i=0;i<list->count();++i){auto* item=list->item(i);auto id=item->data(Qt::UserRole).toString();order.append(id);if(item->checkState()!=Qt::Checked)hidden.append(id);}auto gs=(*draft)["groups"].toObject();gs[*current]=QJsonObject{{"order",order},{"hidden",hidden}};(*draft)["groups"]=gs;};
 auto fill=[list,draft,current]{list->clear();for(auto id:navigation::ordered(*draft,*current)){auto* e=navigation::find(id);auto* item=new QListWidgetItem(e->title,list);item->setData(Qt::UserRole,id);item->setFlags(item->flags()|Qt::ItemIsUserCheckable);item->setCheckState(navigation::hidden(*draft,*current,id)?Qt::Unchecked:Qt::Checked);}if(list->count())list->setCurrentRow(0);};
 auto active=[this,page]{return page->isVisible()&&workspaceTabs->currentWidget()==page&&!isMinimized();};
 connect(groups,&QComboBox::currentTextChanged,page,[capture,fill,current](QString g){capture();*current=g;fill();});
 auto move=[list,active](int delta){if(!active())return;int row=list->currentRow(),to=row+delta;if(row<0||to<0||to>=list->count())return;auto* item=list->takeItem(row);list->insertItem(to,item);list->setCurrentRow(to);};
 connect(up,&QPushButton::clicked,page,[move]{move(-1);});connect(down,&QPushButton::clicked,page,[move]{move(1);});
 connect(reset,&QPushButton::clicked,page,[active,draft,current,fill,status]{if(!active())return;auto gs=(*draft)["groups"].toObject();gs.remove(*current);(*draft)["groups"]=gs;fill();status->setText("本组已恢复默认；点击应用并保存才生效。");});
 connect(all,&QPushButton::clicked,page,[active,draft,fill,status]{if(!active())return;*draft=navigation::normalized({});fill();status->setText("全部已恢复默认；点击应用并保存才生效。");});
 connect(cancel,&QPushButton::clicked,page,[this,active,draft,fill,status]{if(!active())return;readNavigationPreferences();*draft=navigationPreferences;fill();syncNavigation();status->setText(navigationFileError.isEmpty()?"已放弃未应用修改，重新载入本机配置。":navigationFileError);});
 connect(apply,&QPushButton::clicked,page,[this,active,capture,draft,status]{if(!active())return;capture();
  try{QFile file(navigationFilePath());QByteArray existing;
   if(file.exists()){business::require(file.size()<=65536&&file.open(QIODevice::ReadOnly),"配置不可读或过大，原件保留，未覆盖");existing=file.readAll();file.close();}
   business::require(existing==navigationFileBytes,"配置已被其他窗口修改，请取消修改 / 重载后再应用");
   auto next=navigation::normalized(*draft);auto raw=QJsonDocument(next).toJson(QJsonDocument::Indented);
   if(raw!=existing){if(file.exists()){auto backup=navigationFilePath()+".before-"+QUuid::createUuid().toString(QUuid::WithoutBraces)+".bak";business::require(QFile::copy(navigationFilePath(),backup),"原菜单配置备份失败，未覆盖");}
    QSaveFile save(navigationFilePath());save.setDirectWriteFallback(false);business::require(save.open(QIODevice::WriteOnly)&&save.write(raw)==raw.size()&&save.commit(),"菜单配置未保存；业务数据不变");}
   navigationPreferences=next;navigationFileBytes=raw;navigationFileError.clear();syncNavigation();status->setText("已保存并立即生效，下次打开仍保留；如替换了原菜单配置，已留备份。业务数据未改动。");
  }catch(const std::exception&e){status->setText(QString::fromUtf8(e.what()));}
 });
 fill();activatePage(page);
}
