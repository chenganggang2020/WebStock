#include "quant_plugin_center.hpp"
#include "quant_plugin_widget.hpp"
#include "quant_plugin_ui.hpp"
#include <QtWidgets>
#include <QVersionNumber>

using namespace quantPlugin;
QuantPluginCenter::QuantPluginCenter(QString root,QWidget* parent,QString directory,MarketFeed* historyFeed)
    :QWidget(parent),repository_(root),archive_(root,this),historyFeed_(historyFeed),packageDirectory_(directory.isEmpty()?QCoreApplication::applicationDirPath()+"/plugin-packages":directory) {
    setObjectName("quantPluginCenter");auto layout=new QVBoxLayout(this);layout->setSpacing(12);
    auto heading=new QLabel("插件中心");heading->setStyleSheet("font-size:24px;font-weight:600;");layout->addWidget(heading);
    auto note=new QLabel("每个插件独立安装、启停和卸载。安装后，从左侧“我的功能”或“打开功能”进入。");note->setWordWrap(true);layout->addWidget(note);
    auto bar=new QHBoxLayout;search_=new QLineEdit;search_->setObjectName("pluginCenterSearch");search_->setPlaceholderText("搜索插件名称或用途");bar->addWidget(search_,1);
    scope_=new QComboBox;scope_->addItems({"全部插件","已安装","本地可安装","已卸载的历史"});bar->addWidget(scope_);
    auto import=new QPushButton("导入插件包…"),choose=new QPushButton("选择包目录…"),reload=new QPushButton("刷新");reload->setObjectName("pluginCenterRefresh");bar->addWidget(import);bar->addWidget(choose);bar->addWidget(reload);layout->addLayout(bar);
    auto split=new QSplitter;layout->addWidget(split,1);auto left=new QWidget;auto ll=new QVBoxLayout(left);ll->setContentsMargins(0,0,0,0);
    ll->addWidget(new QLabel("我的功能 · 已启用"));shortcuts_=new QListWidget;shortcuts_->setObjectName("pluginShortcuts");shortcuts_->setWordWrap(true);shortcuts_->setSpacing(5);ll->addWidget(shortcuts_,1);
    auto tip=new QLabel("双击功能打开\n停用或卸载后，入口会移除。\n历史档案仍可在右侧查看。");tip->setWordWrap(true);ll->addWidget(tip);split->addWidget(left);
    auto right=new QWidget;auto rl=new QVBoxLayout(right);rl->setContentsMargins(0,0,0,0);
    catalog_=new QTableWidget(0,4);catalog_->setObjectName("pluginCatalog");catalog_->setHorizontalHeaderLabels({"插件 / 功能","用途","版本","安装状态"});
    catalog_->setEditTriggers(QAbstractItemView::NoEditTriggers);catalog_->setSelectionBehavior(QAbstractItemView::SelectRows);catalog_->setSelectionMode(QAbstractItemView::SingleSelection);
    catalog_->verticalHeader()->hide();catalog_->setWordWrap(true);catalog_->horizontalHeader()->setSectionResizeMode(0,QHeaderView::Interactive);catalog_->setColumnWidth(0,225);
    catalog_->horizontalHeader()->setSectionResizeMode(1,QHeaderView::Stretch);catalog_->setColumnWidth(2,88);catalog_->setColumnWidth(3,135);rl->addWidget(catalog_,1);
    detail_=new QLabel;detail_->setObjectName("pluginCenterDetail");detail_->setTextFormat(Qt::PlainText);detail_->setWordWrap(true);detail_->setMinimumHeight(66);rl->addWidget(detail_);
    auto actions=new QHBoxLayout;open_=new QPushButton("打开功能");open_->setObjectName("pluginCenterOpen");install_=new QPushButton("安装");install_->setObjectName("pluginCenterInstall");
    toggle_=new QPushButton("停用");toggle_->setObjectName("pluginCenterToggle");uninstall_=new QPushButton("卸载");uninstall_->setObjectName("pluginCenterUninstall");history_=new QPushButton("查看此插件历史");history_->setObjectName("pluginCenterHistory");
    for(auto b:{open_,install_,toggle_,uninstall_,history_}){b->setMinimumHeight(34);actions->addWidget(b);}rl->addLayout(actions);split->addWidget(right);split->setSizes({230,950});split->setStretchFactor(1,4);
    source_=new QLabel;source_->setWordWrap(true);source_->setTextFormat(Qt::PlainText);layout->addWidget(source_);
    status_=new QLabel;status_->setObjectName("pluginCenterStatus");status_->setWordWrap(true);status_->setTextFormat(Qt::PlainText);layout->addWidget(status_);
    connect(search_,&QLineEdit::textChanged,this,[this]{guard([this]{refresh();});});connect(scope_,&QComboBox::currentIndexChanged,this,[this]{guard([this]{refresh();});});
    connect(catalog_,&QTableWidget::itemSelectionChanged,this,[this]{select();});
    connect(catalog_,&QTableWidget::cellDoubleClicked,this,[this](int,int){guard([this]{if(open_->isEnabled())openPlugin(selectedId());});});
    connect(shortcuts_,&QListWidget::itemDoubleClicked,this,[this](QListWidgetItem* item){guard([this,item]{openPlugin(item->data(Qt::UserRole).toString());});});
    connect(shortcuts_,&QListWidget::currentItemChanged,this,[this](QListWidgetItem* item){if(!item)return;for(int i=0;i<catalog_->rowCount();++i)if(catalog_->item(i,0)->data(Qt::UserRole)==item->data(Qt::UserRole)){catalog_->selectRow(i);break;}});
    connect(reload,&QPushButton::clicked,this,[this]{guard([this]{discover();refresh();});});
    connect(choose,&QPushButton::clicked,this,[this]{auto directory=QFileDialog::getExistingDirectory(this,"选择本地插件包目录",packageDirectory_);if(directory.isEmpty())return;packageDirectory_=directory;guard([this]{discover();refresh();});});
    connect(import,&QPushButton::clicked,this,[this]{guard([this]{auto file=QFileDialog::getOpenFileName(this,"导入可信来源的插件包",packageDirectory_,"WebStock 插件 (*.wspkg)");if(file.isEmpty())return;
        auto bytes=read(file);auto id=object(bytes).value("manifest").toObject().value("id").toString();closeBusiness(id);auto p=repository_.install(bytes);refresh();status_->setText(p.value("name").toString()+" 已安装，可打开功能。");});});
    connect(install_,&QPushButton::clicked,this,[this]{guard([this]{auto id=selectedId();auto offer=available_.value(id);require(!offer.isEmpty(),"没有可用的本地插件包，请导入包或选择目录");closeBusiness(id);
        auto p=repository_.install(read(offer.value("path").toString()));refresh();status_->setText(quantPluginUi::title(id,p.value("name").toString())+" 已安装。"+(repository_.runtimeFor(id).isEmpty()?"运行环境尚未配置；打开功能后可查看缺失说明。":"已复用本机配置的运行环境，可直接打开。"));});});
    connect(open_,&QPushButton::clicked,this,[this]{guard([this]{openPlugin(selectedId());});});
    connect(history_,&QPushButton::clicked,this,[this]{guard([this]{openPlugin(selectedId(),true);});});
    connect(toggle_,&QPushButton::clicked,this,[this]{guard([this]{auto id=selectedId();closeBusiness(id);auto p=repository_.plugin(id);repository_.configure(id,repository_.runtimeFor(id),!p.value("enabled").toBool());refresh();status_->setText(p.value("enabled").toBool()?"插件已停用，功能入口已移除。历史保留。":"插件已启用，功能入口已恢复。");});});
    connect(uninstall_,&QPushButton::clicked,this,[this]{guard([this]{auto id=selectedId();closeBusiness(id);repository_.uninstall(id);refresh();status_->setText("插件已卸载，功能入口已移除。历史和版本缓存保留；可从本地包重新安装。");});});
    guard([this]{discover();refresh();});
}
void QuantPluginCenter::guard(std::function<void()> action){try{action();}catch(const std::exception& e){status_->setText(QString::fromUtf8(e.what()));}}
QString QuantPluginCenter::selectedId() const {auto item=catalog_->item(catalog_->currentRow(),0);return item?item->data(Qt::UserRole).toString():QString();}
void QuantPluginCenter::discover(){
    available_.clear();QStringList problems;
    for(auto file:QDir(packageDirectory_).entryInfoList({"*.wspkg"},QDir::Files,QDir::Name)){
        try {auto bundle=object(read(file.absoluteFilePath()));require(bundle.value("schema")=="webstock.plugin.package.v1","不是插件包");auto m=validateManifest(bundle.value("manifest").toObject());auto id=m.value("id").toString();
            if(!available_.contains(id)||QVersionNumber::fromString(m.value("version").toString())>QVersionNumber::fromString(available_[id].value("manifest").toObject().value("version").toString()))
                available_[id]={{"manifest",m},{"path",file.absoluteFilePath()}};
        }catch(const std::exception& e){problems<<file.fileName()+"："+QString::fromUtf8(e.what());}
    }
    source_->setText(QString("本地包目录：%1\n发现 %2 个可用插件；这是随附本地包目录，尚无在线插件市场。包内含可执行代码，仅安装可信来源。").arg(QDir::toNativeSeparators(packageDirectory_)).arg(available_.size()));
    status_->setText(problems.isEmpty()?"选择插件查看用途、安装状态与操作。":QString("%1 个包无法读取，未加入列表：").arg(problems.size())+problems.join("；"));
}
void QuantPluginCenter::refresh(){
    auto wanted=selectedId();QSignalBlocker block(catalog_),shortBlock(shortcuts_);catalog_->setRowCount(0);shortcuts_->clear();entries_.clear();
    for(auto i=available_.begin();i!=available_.end();++i)entries_[i.key()]=i.value();
    for(auto v:repository_.plugins()){
        auto p=v.toObject();auto id=p.value("id").toString();auto entry=entries_.value(id);entry["installed"]=p;
        try{entry["manifest"]=repository_.plugin(id).value("manifest");}catch(const std::exception& e){entry["error"]=QString::fromUtf8(e.what());}
        entries_[id]=entry;
    }
    for(auto v:archive_.records()){auto r=v.toObject();auto id=r.value("pluginId").toString();if(id.isEmpty())continue;auto entry=entries_.value(id);entry["hasHistory"]=true;
        if(!entry.contains("manifest"))entry["manifest"]=QJsonObject{{"id",id},{"name",r.value("pluginName").toString(id)}};entries_[id]=entry;
    }
    for(auto i=entries_.begin();i!=entries_.end();++i){auto e=i.value(),m=e.value("manifest").toObject(),p=e.value("installed").toObject();bool installed=!p.isEmpty();auto name=quantPluginUi::title(i.key(),m.value("name").toString(p.value("name").toString()));auto purpose=quantPluginUi::purpose(m);
        if(installed&&p.value("enabled").toBool()&&!e.contains("error")){
            auto shortcut=new QListWidgetItem(name+"\n"+(i.key()=="org.webstock.akshare"?QString("AKShare · 获取 / 预览 / 保存"):QString("打开 %1 项功能").arg(m.value("operations").toArray().size())),shortcuts_);shortcut->setData(Qt::UserRole,i.key());shortcut->setToolTip(purpose);shortcut->setSizeHint(QSize(200,66));
        }
        if(scope_->currentIndex()==1&&!installed)continue;if(scope_->currentIndex()==2&&(installed||!available_.contains(i.key())))continue;if(scope_->currentIndex()==3&&(installed||!e.value("hasHistory").toBool()))continue;
        if(!(name+purpose+m.value("name").toString()).contains(search_->text(),Qt::CaseInsensitive))continue;
        int row=catalog_->rowCount();catalog_->insertRow(row);auto item=new QTableWidgetItem(name);item->setData(Qt::UserRole,i.key());catalog_->setItem(row,0,item);catalog_->setItem(row,1,new QTableWidgetItem(purpose));
        catalog_->setItem(row,2,new QTableWidgetItem(installed?p.value("version").toString():m.value("version").toString("—")));
        QString state=installed?(p.value("enabled").toBool()?"已安装 · 已启用":"已安装 · 已停用"):(available_.contains(i.key())?"未安装":"已卸载 · 有历史");
        if(e.contains("error"))state="安装内容需检查";else if(installed&&repository_.runtimeFor(i.key()).isEmpty())state+="\n环境缺失";
        catalog_->setItem(row,3,new QTableWidgetItem(state));catalog_->setRowHeight(row,64);if(i.key()==wanted)catalog_->selectRow(row);
    }
    if(catalog_->currentRow()<0&&catalog_->rowCount())catalog_->selectRow(0);select();
}
void QuantPluginCenter::select(){
    auto id=selectedId();auto e=entries_.value(id),m=e.value("manifest").toObject(),p=e.value("installed").toObject();bool installed=!p.isEmpty();
    open_->setEnabled(installed&&p.value("enabled").toBool()&&!e.contains("error"));toggle_->setEnabled(installed&&!e.contains("error"));uninstall_->setEnabled(installed);history_->setEnabled(e.value("hasHistory").toBool());toggle_->setText(p.value("enabled").toBool()?"停用":"启用");
    auto offer=available_.value(id).value("manifest").toObject();bool update=installed&&QVersionNumber::fromString(offer.value("version").toString())>QVersionNumber::fromString(p.value("version").toString());
    install_->setEnabled(!offer.isEmpty()&&(!installed||update));install_->setText(update?"安装更新 "+offer.value("version").toString():"安装");
    detail_->setText(id.isEmpty()?"没有匹配的插件。":quantPluginUi::title(id,m.value("name").toString())+"\n"+quantPluginUi::purpose(m)+"\n"+(e.contains("error")?e.value("error").toString():installed?(repository_.runtimeFor(id).isEmpty()?"运行环境未找到，打开功能查看高级设置。":"运行环境：已找到本机配置。"):(available_.contains(id)?"安装来源：本地插件包。":"可查看和导出保留的历史档案。")));
}
void QuantPluginCenter::closeBusiness(const QString& id){
    for(auto key:{id,id+"/history"})if(auto window=windows_.value(key)){
        auto widget=window->findChild<QuantPluginWidget*>();require(!widget||!widget->isRunning(),"此插件正在运行，请先取消或等待完成再修改安装状态");window->close();windows_.remove(key);
    }
}
void QuantPluginCenter::openPlugin(const QString& id,bool historyOnly,const QString& datasetId){
    require(!id.isEmpty(),"请选择插件");auto key=id+(historyOnly?"/history":"");
    if(!historyOnly){auto p=repository_.plugin(id);require(p.value("enabled").toBool(),"此插件已停用，请先启用");}
    if(!windows_.value(key)){
        auto dialog=new QDialog(this);dialog->setAttribute(Qt::WA_DeleteOnClose);dialog->resize(1320,900);
        auto m=entries_.value(id).value("manifest").toObject();dialog->setWindowTitle("WebStock · "+quantPluginUi::title(id,m.value("name").toString(id))+(historyOnly?" · 历史档案":""));
        auto layout=new QVBoxLayout(dialog);auto widget=new QuantPluginWidget(repository_.root(),dialog,id,historyOnly,historyFeed_);layout->addWidget(widget);
        widget->openDataConsumer=[this](QString target,QString runId){guard([this,target,runId]{openPlugin(target,false,runId);});};windows_[key]=dialog;
    }
    auto dialog=windows_.value(key);if(!datasetId.isEmpty())dialog->findChild<QuantPluginWidget*>()->useSavedData(datasetId);dialog->show();dialog->raise();dialog->activateWindow();
}
